"use server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { act } from "./_helpers";
import * as s from "@/server/db/schema";
import * as bank from "@/server/bank/service";
import { audit, ServiceError } from "@/server/services/context";

const id = z.string().uuid();

export async function refreshConnectionAction(connectionId: string) {
  const r = await act((ctx) => bank.refreshConnection(ctx, id.parse(connectionId)), { message: "Synchronisation terminée" });
  // L'erreur a été journalisée (transaction validée) : on la signale sans annuler l'historique
  if (r.ok && r.data?.error) return { ok: false as const, error: r.data.error };
  if (r.ok && r.data) return { ...r, message: r.data.created ? `${r.data.created} nouvelle(s) opération(s)` : "Tout est à jour" };
  return r;
}
export async function deleteConnectionAction(connectionId: string, keepData: boolean) {
  return act((ctx) => bank.deleteConnection(ctx, id.parse(connectionId), z.boolean().parse(keepData)), { message: keepData ? "Connexion supprimée — les comptes sont conservés en manuel" : "Connexion et données supprimées" });
}
export async function setAccountSyncAction(accountId: string, enabled: boolean) {
  return act((ctx) => bank.setAccountSync(ctx, id.parse(accountId), z.boolean().parse(enabled)), { message: enabled ? "Synchronisation réactivée pour ce compte" : "Synchronisation suspendue pour ce compte" });
}
export async function confirmDistinctAccountAction(accountId: string) {
  return act((ctx) => bank.confirmDistinctAccount(ctx, id.parse(accountId)), { message: "Compte réactivé : il sera synchronisé à la prochaine actualisation" });
}
export async function mergeAccountsAction(manualAccountId: string, bankAccountId: string) {
  return act((ctx) => bank.mergeManualIntoBank(ctx, id.parse(manualAccountId), id.parse(bankAccountId)), { message: "Comptes rapprochés" });
}
export async function resolveDuplicateAction(recoId: string, action: "merge" | "keep_both") {
  return act((ctx) => bank.resolveDuplicate(ctx, id.parse(recoId), z.enum(["merge", "keep_both"]).parse(action)), { message: action === "merge" ? "Opérations fusionnées" : "Les deux opérations sont conservées" });
}
export async function undoAutoMergeAction(recoId: string) {
  return act((ctx) => bank.undoAutoMerge(ctx, id.parse(recoId)), { message: "Fusion annulée" });
}
export async function markVerifiedAction(ids: string[] | "all") {
  return act((ctx) => bank.markVerified(ctx, ids === "all" ? "all" : z.array(id).max(500).parse(ids)), { message: "Marquée(s) comme vérifiée(s)" });
}
/** Correction de catégorie sur une opération importée : mémorisée comme choix de l'utilisateur (apprentissage). */
export async function setTxCategoryAction(txId: string, categoryId: string | null) {
  return act(async (ctx) => {
    const cat = categoryId ? id.parse(categoryId) : null;
    const [row] = await ctx.tx
      .update(s.transactions)
      .set({ categoryId: cat, categorySource: "user", categoryConfidence: 100, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.transactions.id, id.parse(txId)))
      .returning({ id: s.transactions.id });
    if (!row) throw new ServiceError("Opération introuvable");
    await audit(ctx, "bank.category_corrected", "transaction", row.id);
  }, { message: "Catégorie enregistrée" });
}
export async function reportMiscategorizedAction(txId: string) {
  return act(async (ctx) => {
    await ctx.tx.update(s.transactions).set({ categoryConfidence: 0, verifiedAt: null }).where(and(eq(s.transactions.id, id.parse(txId))));
    await audit(ctx, "bank.category_reported", "transaction", txId);
  }, { message: "Signalé : l'opération repasse dans la liste à vérifier" });
}
export async function createRuleAction(pattern: string, categoryId: string, applyToExisting: boolean) {
  return act((ctx) => bank.createRule(ctx, z.string().min(3).max(60).parse(pattern), id.parse(categoryId), z.boolean().parse(applyToExisting)), { message: "Règle mémorisée" });
}
export async function deleteRuleAction(ruleId: string) {
  return act((ctx) => bank.deleteRule(ctx, id.parse(ruleId)), { message: "Règle supprimée" });
}
const prefs = z.object({ autoSync: z.boolean(), notifyImport: z.boolean(), notifyErrors: z.boolean(), autoCategorize: z.boolean(), confirmUncertain: z.boolean(), aiCategorize: z.boolean() }).partial();
export async function saveBankPrefsAction(input: unknown) {
  return act(async (ctx) => {
    const p = prefs.parse(input);
    const [u] = await ctx.tx.select({ settings: s.users.settings }).from(s.users).where(eq(s.users.id, ctx.userId));
    await ctx.tx.update(s.users).set({ settings: { ...u.settings, bank: { ...(u.settings.bank ?? {}), ...p } } }).where(eq(s.users.id, ctx.userId));
  }, { message: "Préférences enregistrées" });
}
