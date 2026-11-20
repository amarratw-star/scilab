"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { act, toError } from "./_helpers";
import { passwordSchema, settingsSchema, type ActionResult } from "@/lib/validation";
import { changePassword, deleteUserAccount, updateProfile, updateSettingsJson } from "@/server/services/user";
import { seedDemoData, wipeFinancialData } from "@/server/services/demo";
import { destroyCurrentSession, getCurrentSession, requireUser, revokeOtherSessions, revokeSession } from "@/server/auth/session";
import { isValidTimeZone } from "@/lib/dates";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function saveProfileAction(input: Record<string, unknown>) {
  return act(async (ctx) => {
    const data = settingsSchema.parse(input);
    if (!isValidTimeZone(data.timezone)) throw new z.ZodError([{ code: "custom", path: ["timezone"], message: "Fuseau horaire inconnu", input: data.timezone }]);
    await updateProfile(ctx, data);
  }, { message: "Paramètres enregistrés" });
}

const prefsSchema = z.object({
  notifications: z.record(z.string(), z.boolean()).optional(),
  dashboard: z.object({ hidden: z.array(z.string().max(40)).max(30) }).optional(),
  privacy: z.object({ aiEnabled: z.boolean().optional(), ocrCloudEnabled: z.boolean().optional() }).optional(),
});

export async function savePreferencesAction(input: unknown) {
  return act(async (ctx) => {
    const data = prefsSchema.parse(input);
    const merged = {
      ...data,
      notifications: data.notifications ? { ...(ctx.settings.notifications ?? {}), ...data.notifications } : undefined,
      privacy: data.privacy ? { ...(ctx.settings.privacy ?? {}), ...data.privacy } : undefined,
    };
    await updateSettingsJson(ctx, JSON.parse(JSON.stringify(merged)));
  }, { message: "Préférences enregistrées" });
}

export async function changePasswordAction(input: { current: string; next: string }): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const next = passwordSchema.parse(input.next);
    await changePassword(user.id, String(input.current), next);
    const session = await getCurrentSession();
    if (session) await revokeOtherSessions(user.id, session.sessionId);
    return { ok: true, message: "Mot de passe modifié. Les autres sessions ont été déconnectées." };
  } catch (e) {
    return toError(e);
  }
}

export async function revokeSessionAction(sessionId: string | "others") {
  const user = await requireUser();
  const current = await getCurrentSession();
  if (sessionId === "others") await revokeOtherSessions(user.id, current!.sessionId);
  else await revokeSession(user.id, z.string().max(100).parse(sessionId));
  return { ok: true as const, message: "Session(s) déconnectée(s)" };
}

export async function deleteMyAccountAction(password: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteUserAccount(user.id, password || null);
  } catch (e) {
    return toError(e);
  }
  await destroyCurrentSession();
  redirect("/connexion?supprime=1");
}

export async function wipeDataAction(keepCategories: boolean) {
  return act((ctx) => wipeFinancialData(ctx, keepCategories), { message: "Toutes les données financières ont été supprimées. Ton espace est vide." });
}

export async function loadDemoDataAction() {
  return act((ctx) => seedDemoData(ctx).then(() => undefined), { message: "Données de démonstration chargées" });
}

export async function completeOnboardingAction() {
  return act(async (ctx) => {
    await ctx.tx.update(s.users).set({ onboardedAt: new Date() }).where(eq(s.users.id, ctx.userId));
  });
}

const pushSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });
export async function savePushSubscriptionAction(sub: unknown) {
  return act(async (ctx) => {
    const data = pushSchema.parse(sub);
    await ctx.tx.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, data.endpoint));
    await ctx.tx.insert(s.pushSubscriptions).values({ userId: ctx.userId, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth });
  }, { message: "Notifications push activées sur cet appareil" });
}
