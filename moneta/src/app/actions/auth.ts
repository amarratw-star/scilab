"use server";
import { redirect } from "next/navigation";
import { registerSchema, loginSchema, passwordSchema, type ActionResult } from "@/lib/validation";
import { authenticate, registerUser, requestPasswordReset, resetPassword, purgeOldDemoAccounts } from "@/server/services/user";
import { clientInfo, createSession, destroyCurrentSession } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";
import { runAsUser } from "@/server/services/context";
import { seedDemoData } from "@/server/services/demo";
import { features } from "@/server/env";
import { randomToken } from "@/server/crypto";
import { toError } from "./_helpers";
import { z } from "zod";

const TOO_MANY = { ok: false as const, error: "Trop de tentatives. Patiente quelques minutes avant de réessayer." };

export async function registerAction(input: Record<string, unknown>): Promise<ActionResult> {
  const { ip } = await clientInfo();
  if (!(await rateLimit(`register:${ip}`, 5, 3600))) return TOO_MANY;
  try {
    const data = registerSchema.parse(input);
    const user = await registerUser(data);
    await createSession(user.id);
  } catch (e) {
    return toError(e);
  }
  redirect("/bienvenue");
}

export async function loginAction(input: Record<string, unknown>, next?: string): Promise<ActionResult> {
  const { ip } = await clientInfo();
  let userId: string | null = null;
  try {
    const data = loginSchema.parse(input);
    if (!(await rateLimit(`login:${ip}`, 20, 900)) || !(await rateLimit(`login:${data.email}`, 8, 900))) return TOO_MANY;
    const user = await authenticate(data.email, data.password);
    if (!user) return { ok: false, error: "Adresse e-mail ou mot de passe incorrect." };
    userId = user.id;
    await createSession(user.id);
  } catch (e) {
    return toError(e);
  }
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/connexion");
}

export async function forgotPasswordAction(input: { email: string }): Promise<ActionResult> {
  const { ip } = await clientInfo();
  if (!(await rateLimit(`forgot:${ip}`, 5, 3600))) return TOO_MANY;
  const email = z.string().trim().toLowerCase().email().safeParse(input.email);
  if (!email.success) return { ok: false, error: "Adresse e-mail invalide." };
  await requestPasswordReset(email.data, process.env.APP_URL ?? "http://localhost:3000");
  return { ok: true, message: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé." };
}

export async function resetPasswordAction(input: { token: string; password: string }): Promise<ActionResult> {
  const { ip } = await clientInfo();
  if (!(await rateLimit(`reset:${ip}`, 10, 3600))) return TOO_MANY;
  try {
    const password = passwordSchema.parse(input.password);
    await resetPassword(String(input.token).slice(0, 100), password);
  } catch (e) {
    return toError(e);
  }
  redirect("/connexion?reinitialise=1");
}

/** Crée un espace de démonstration isolé (compte temporaire, données fictives clairement signalées). */
export async function startDemoAction(): Promise<ActionResult> {
  if (!features.demo()) return { ok: false, error: "La démonstration est désactivée sur ce serveur." };
  const { ip } = await clientInfo();
  if (!(await rateLimit(`demo:${ip}`, 5, 3600))) return TOO_MANY;
  try {
    await purgeOldDemoAccounts();
    const user = await registerUser({ email: `demo-${randomToken(9).toLowerCase()}@demo.moneta.invalid`, password: randomToken(24), displayName: "Visiteur", isDemo: true });
    await runAsUser(user, (ctx) => seedDemoData(ctx));
    await createSession(user.id);
  } catch (e) {
    return toError(e);
  }
  redirect("/");
}
