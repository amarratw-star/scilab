"use server";
import { z } from "zod";
import { act } from "./_helpers";
import {
  accountSchema,
  budgetSchema,
  categorySchema,
  contributionSchema,
  goalSchema,
  isoDate,
  recurringSchema,
  signedAmount,
  transactionSchema,
  valuationSchema,
  wealthItemSchema,
} from "@/lib/validation";
import * as accounts from "@/server/services/accounts";
import * as txs from "@/server/services/transactions";
import * as cats from "@/server/services/categories";
import * as planning from "@/server/services/planning";
import * as docs from "@/server/services/documents";
import { checkDuplicates, importPayloadSchema, importRows } from "@/server/services/imports";
import { markRead } from "@/server/services/notifications";

const id = z.string().uuid();

/* Opérations */
export async function saveTransactionAction(txId: string | null, input: Record<string, unknown>, source?: "ocr" | "assistant") {
  return act(
    async (ctx) => {
      const data = transactionSchema.parse(input);
      if (txId) return { id: (await txs.updateTransaction(ctx, id.parse(txId), data)).id };
      const row = await txs.createTransaction(ctx, data, source ?? "manual");
      return { id: row.id };
    },
    { message: txId ? "Opération modifiée" : "Opération enregistrée" },
  );
}
export async function deleteTransactionAction(txId: string) {
  return act((ctx) => txs.deleteTransaction(ctx, id.parse(txId)).then(() => undefined), { message: "Opération supprimée" });
}
export async function duplicateTransactionAction(txId: string, date: string) {
  return act((ctx) => txs.duplicateTransaction(ctx, id.parse(txId), isoDate.parse(date)).then((r) => ({ id: r.id })), { message: "Opération dupliquée" });
}
export async function confirmPlannedAction(txId: string, date: string) {
  return act((ctx) => txs.confirmPlanned(ctx, id.parse(txId), isoDate.parse(date)).then(() => undefined), { message: "Opération confirmée" });
}

/* Comptes */
export async function saveAccountAction(accountId: string | null, input: Record<string, unknown>) {
  return act(
    async (ctx) => {
      const data = accountSchema.parse(input);
      const row = accountId ? await accounts.updateAccount(ctx, id.parse(accountId), data) : await accounts.createAccount(ctx, data);
      return { id: row.id };
    },
    { message: accountId ? "Compte modifié" : "Compte créé" },
  );
}
export async function archiveAccountAction(accountId: string, archived: boolean) {
  return act((ctx) => accounts.setAccountArchived(ctx, id.parse(accountId), archived).then(() => undefined), { message: archived ? "Compte archivé" : "Compte réactivé" });
}
export async function deleteAccountAction(accountId: string) {
  return act((ctx) => accounts.deleteAccount(ctx, id.parse(accountId)), { message: "Compte supprimé" });
}
export async function reconcileAccountAction(accountId: string, actual: string, date: string, note?: string) {
  return act((ctx) => accounts.reconcileAccount(ctx, id.parse(accountId), signedAmount.parse(actual), isoDate.parse(date), note?.slice(0, 300)), { message: "Rapprochement effectué" });
}

/* Catégories */
export async function saveCategoryAction(categoryId: string | null, input: Record<string, unknown>) {
  return act(async (ctx) => {
    const data = categorySchema.parse(input);
    const row = categoryId ? await cats.updateCategory(ctx, id.parse(categoryId), data) : await cats.createCategory(ctx, data);
    return { id: row.id };
  }, { message: "Catégorie enregistrée" });
}
export async function deleteCategoryAction(categoryId: string, replacementId: string | null) {
  return act((ctx) => cats.deleteCategory(ctx, id.parse(categoryId), replacementId ? id.parse(replacementId) : null), { message: "Catégorie supprimée" });
}
export async function reorderCategoriesAction(ids: string[]) {
  return act((ctx) => cats.reorderCategories(ctx, z.array(id).max(500).parse(ids)));
}

/* Récurrences */
export async function saveRecurringAction(ruleId: string | null, input: Record<string, unknown>) {
  return act(async (ctx) => {
    const data = recurringSchema.parse(input);
    const row = ruleId ? await planning.updateRecurring(ctx, id.parse(ruleId), data) : await planning.createRecurring(ctx, data);
    return { id: row.id };
  }, { message: "Échéance enregistrée" });
}
export async function setRecurringStatusAction(ruleId: string, status: "active" | "paused" | "ended") {
  return act((ctx) => planning.setRecurringStatus(ctx, id.parse(ruleId), z.enum(["active", "paused", "ended"]).parse(status)).then(() => undefined), {
    message: status === "active" ? "Réactivée" : status === "paused" ? "Suspendue" : "Terminée",
  });
}
export async function deleteRecurringAction(ruleId: string) {
  return act((ctx) => planning.deleteRecurring(ctx, id.parse(ruleId)), { message: "Échéance supprimée" });
}
export async function markReviewedAction(ruleId: string) {
  return act((ctx) => planning.markRecurringReviewed(ctx, id.parse(ruleId)), { message: "Marqué comme vérifié" });
}
export async function resolveOccurrenceAction(ruleId: string, occurrenceDate: string, action: "pay" | "skip", date?: string, amount?: string) {
  return act(
    (ctx) =>
      planning
        .resolveOccurrence(ctx, id.parse(ruleId), isoDate.parse(occurrenceDate), {
          action: z.enum(["pay", "skip"]).parse(action),
          date: date ? isoDate.parse(date) : undefined,
          amount: amount ? z.number().int().positive().parse(signedAmount.parse(amount)) : undefined,
        })
        .then(() => undefined),
    { message: action === "pay" ? "Échéance confirmée" : "Échéance ignorée" },
  );
}

/* Budgets */
export async function saveBudgetAction(budgetId: string | null, input: Record<string, unknown>) {
  return act(async (ctx) => {
    const data = budgetSchema.parse(input);
    const row = budgetId ? await planning.updateBudget(ctx, id.parse(budgetId), data) : await planning.createBudget(ctx, data);
    return { id: row.id };
  }, { message: "Budget enregistré" });
}
export async function deleteBudgetAction(budgetId: string) {
  return act((ctx) => planning.deleteBudget(ctx, id.parse(budgetId)), { message: "Budget supprimé" });
}

/* Objectifs */
export async function saveGoalAction(goalId: string | null, input: Record<string, unknown>) {
  return act(async (ctx) => {
    const data = goalSchema.parse(input);
    const row = goalId ? await planning.updateGoal(ctx, id.parse(goalId), data) : await planning.createGoal(ctx, data);
    return { id: row.id };
  }, { message: "Objectif enregistré" });
}
export async function deleteGoalAction(goalId: string) {
  return act((ctx) => planning.deleteGoal(ctx, id.parse(goalId)), { message: "Objectif supprimé" });
}
export async function archiveGoalAction(goalId: string) {
  return act((ctx) => planning.archiveGoal(ctx, id.parse(goalId)), { message: "Objectif archivé" });
}
export async function contributeAction(input: Record<string, unknown>) {
  return act((ctx) => planning.addContribution(ctx, contributionSchema.parse(input)).then(() => undefined), { message: "Versement enregistré" });
}
export async function deleteContributionAction(contributionId: string) {
  return act((ctx) => planning.deleteContribution(ctx, id.parse(contributionId)), { message: "Versement supprimé" });
}

/* Patrimoine */
export async function createWealthItemAction(input: Record<string, unknown>) {
  return act((ctx) => planning.createWealthItem(ctx, wealthItemSchema.parse(input)).then(() => undefined), { message: "Élément ajouté" });
}
export async function addValuationAction(input: Record<string, unknown>) {
  return act((ctx) => planning.addValuation(ctx, valuationSchema.parse(input)).then(() => undefined), { message: "Valorisation mise à jour" });
}
export async function deleteWealthItemAction(itemId: string) {
  return act((ctx) => planning.deleteWealthItem(ctx, id.parse(itemId)), { message: "Élément supprimé" });
}

/* Documents */
export async function linkDocumentAction(docId: string, transactionId: string | null) {
  return act((ctx) => docs.linkDocument(ctx, id.parse(docId), transactionId ? id.parse(transactionId) : null), { message: "Document associé" });
}
export async function deleteDocumentAction(docId: string) {
  return act((ctx) => docs.deleteDocument(ctx, id.parse(docId)), { message: "Document supprimé" });
}

/* Import CSV */
export async function checkImportDuplicatesAction(accountId: string, rows: { date: string; label: string; amount: number }[]) {
  return act(async (ctx) => checkDuplicates(ctx, id.parse(accountId), z.array(z.object({ date: isoDate, label: z.string().max(200), amount: z.number().int() })).max(5000).parse(rows)), { revalidate: [] });
}
export async function importCsvAction(payload: unknown) {
  return act((ctx) => importRows(ctx, importPayloadSchema.parse(payload)));
}

/* Notifications */
export async function markNotificationsReadAction(notificationId?: string) {
  return act((ctx) => markRead(ctx, notificationId ? id.parse(notificationId) : undefined));
}
