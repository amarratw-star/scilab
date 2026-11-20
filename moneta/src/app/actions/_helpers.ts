import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser, type SessionUser } from "@/server/auth/session";
import { runAsUser, ServiceError, type Ctx } from "@/server/services/context";
import { zodFieldErrors, type ActionResult } from "@/lib/validation";

/** Enveloppe commune des actions serveur : authentification, contexte RLS, erreurs lisibles. */
export async function act<T>(fn: (ctx: Ctx, user: SessionUser) => Promise<T>, opts: { revalidate?: string[]; message?: string } = {}): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    const data = await runAsUser(user, (ctx) => fn(ctx, user));
    for (const p of opts.revalidate ?? ["/", "/(app)"]) revalidatePath(p, "layout");
    return { ok: true, data, message: opts.message };
  } catch (e) {
    return toError(e);
  }
}

export function toError(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (e instanceof ZodError) return { ok: false, error: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(e) };
  if (e instanceof ServiceError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  console.error("[MONETA] Erreur inattendue :", e);
  return { ok: false, error: "Une erreur inattendue est survenue. Réessaie dans un instant." };
}

export const ALL = ["/"];
