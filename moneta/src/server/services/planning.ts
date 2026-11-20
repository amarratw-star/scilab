/** Charges récurrentes / abonnements, budgets, objectifs d'épargne et patrimoine. */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import type { budgetSchema, contributionSchema, goalSchema, recurringSchema, valuationSchema, wealthItemSchema } from "@/lib/validation";
import { occurrences } from "@/lib/finance/recurring";
import { toRule } from "./snapshot";

/* ---------------- Récurrences ---------------- */

export async function createRecurring(ctx: Ctx, input: z.output<typeof recurringSchema>) {
  const [row] = await ctx.tx.insert(s.recurringItems).values({ ...input, userId: ctx.userId, lastReviewedAt: ctx.today }).returning();
  await audit(ctx, "recurring.create", "recurring", row.id, { amount: row.amount, frequency: row.frequency });
  return row;
}

export async function updateRecurring(ctx: Ctx, id: string, input: z.output<typeof recurringSchema>) {
  const [row] = await ctx.tx.update(s.recurringItems).set({ ...input, updatedAt: new Date() }).where(eq(s.recurringItems.id, id)).returning();
  if (!row) throw new ServiceError("Échéance récurrente introuvable");
  await audit(ctx, "recurring.update", "recurring", id);
  return row;
}

export async function setRecurringStatus(ctx: Ctx, id: string, status: "active" | "paused" | "ended") {
  const [row] = await ctx.tx
    .update(s.recurringItems)
    .set({ status, endDate: status === "ended" ? ctx.today : undefined, updatedAt: new Date() })
    .where(eq(s.recurringItems.id, id))
    .returning();
  if (!row) throw new ServiceError("Échéance récurrente introuvable");
  await audit(ctx, `recurring.${status}`, "recurring", id);
  return row;
}

export async function markRecurringReviewed(ctx: Ctx, id: string) {
  await ctx.tx.update(s.recurringItems).set({ lastReviewedAt: ctx.today }).where(eq(s.recurringItems.id, id));
}

export async function deleteRecurring(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.recurringItems).where(eq(s.recurringItems.id, id)).returning();
  if (!row) throw new ServiceError("Échéance récurrente introuvable");
  await audit(ctx, "recurring.delete", "recurring", id, { name: row.name });
}

/**
 * Confirme une échéance : crée l'opération réellement effectuée (posted) rattachée à l'échéance.
 * `action = "skip"` marque l'échéance comme ignorée (opération annulée, sans effet sur les soldes).
 */
export async function resolveOccurrence(
  ctx: Ctx,
  ruleId: string,
  occurrenceDate: string,
  opts: { action: "pay" | "skip"; date?: string; amount?: number },
) {
  const [rule] = await ctx.tx.select().from(s.recurringItems).where(eq(s.recurringItems.id, ruleId));
  if (!rule) throw new ServiceError("Échéance récurrente introuvable");
  const valid = occurrences(toRule(rule), occurrenceDate, occurrenceDate, { includeInactive: true });
  if (!valid.length) throw new ServiceError("Cette date ne correspond à aucune échéance");
  const [already] = await ctx.tx
    .select({ id: s.transactions.id })
    .from(s.transactions)
    .where(and(eq(s.transactions.recurringId, ruleId), eq(s.transactions.occurrenceDate, occurrenceDate)));
  if (already) throw new ServiceError("Cette échéance a déjà été traitée");
  const [row] = await ctx.tx
    .insert(s.transactions)
    .values({
      userId: ctx.userId,
      kind: rule.kind,
      status: opts.action === "pay" ? "posted" : "cancelled",
      amount: opts.amount ?? rule.amount,
      accountId: rule.accountId,
      toAccountId: rule.kind === "transfer" ? rule.toAccountId : null,
      categoryId: rule.kind === "transfer" ? null : rule.categoryId,
      date: opts.date ?? occurrenceDate,
      description: rule.name,
      merchant: rule.merchant,
      paymentMethod: rule.paymentMethod,
      isRecurring: true,
      recurringId: rule.id,
      occurrenceDate,
      source: "recurring",
    })
    .returning();
  await audit(ctx, opts.action === "pay" ? "recurring.pay" : "recurring.skip", "recurring", ruleId, { occurrenceDate, transactionId: row.id });
  return row;
}

/* ---------------- Budgets ---------------- */

export async function createBudget(ctx: Ctx, input: z.output<typeof budgetSchema>) {
  if (input.categoryId) {
    const [c] = await ctx.tx.select().from(s.categories).where(eq(s.categories.id, input.categoryId));
    if (!c || c.kind !== "expense") throw new ServiceError("Choisis une catégorie de dépenses");
  }
  const [row] = await ctx.tx
    .insert(s.budgets)
    .values({ ...input, userId: ctx.userId, startDate: input.period === "custom" ? input.startDate : null, endDate: input.period === "custom" ? input.endDate : null })
    .returning();
  await audit(ctx, "budget.create", "budget", row.id);
  return row;
}

export async function updateBudget(ctx: Ctx, id: string, input: z.output<typeof budgetSchema>) {
  const [row] = await ctx.tx
    .update(s.budgets)
    .set({ ...input, startDate: input.period === "custom" ? input.startDate : null, endDate: input.period === "custom" ? input.endDate : null, updatedAt: new Date() })
    .where(eq(s.budgets.id, id))
    .returning();
  if (!row) throw new ServiceError("Budget introuvable");
  await audit(ctx, "budget.update", "budget", id);
  return row;
}

export async function deleteBudget(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.budgets).where(eq(s.budgets.id, id)).returning();
  if (!row) throw new ServiceError("Budget introuvable");
  await audit(ctx, "budget.delete", "budget", id);
}

/* ---------------- Objectifs ---------------- */

export async function createGoal(ctx: Ctx, input: z.output<typeof goalSchema>) {
  const [row] = await ctx.tx.insert(s.goals).values({ ...input, userId: ctx.userId }).returning();
  await audit(ctx, "goal.create", "goal", row.id);
  return row;
}

export async function updateGoal(ctx: Ctx, id: string, input: z.output<typeof goalSchema>) {
  const [row] = await ctx.tx.update(s.goals).set({ ...input, updatedAt: new Date() }).where(eq(s.goals.id, id)).returning();
  if (!row) throw new ServiceError("Objectif introuvable");
  await audit(ctx, "goal.update", "goal", id);
  return row;
}

export async function archiveGoal(ctx: Ctx, id: string) {
  await ctx.tx.update(s.goals).set({ archivedAt: new Date() }).where(eq(s.goals.id, id));
  await audit(ctx, "goal.archive", "goal", id);
}

export async function deleteGoal(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.goals).where(eq(s.goals.id, id)).returning();
  if (!row) throw new ServiceError("Objectif introuvable");
  await audit(ctx, "goal.delete", "goal", id);
}

/**
 * Versement ou retrait sur un objectif. Si deux comptes sont fournis, un transfert réel est enregistré
 * (il n'est ni une dépense ni un revenu) et lié au versement.
 */
export async function addContribution(ctx: Ctx, input: z.output<typeof contributionSchema>) {
  const [goal] = await ctx.tx.select().from(s.goals).where(eq(s.goals.id, input.goalId));
  if (!goal) throw new ServiceError("Objectif introuvable");
  const signed = input.direction === "deposit" ? input.amount : -input.amount;
  let transactionId: string | null = null;
  if (input.fromAccountId && input.toAccountId) {
    if (input.fromAccountId === input.toAccountId) throw new ServiceError("Les deux comptes doivent être différents");
    const [t] = await ctx.tx
      .insert(s.transactions)
      .values({
        userId: ctx.userId,
        kind: "transfer",
        status: "posted",
        amount: input.amount,
        accountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        date: input.date,
        description: `${input.direction === "deposit" ? "Épargne" : "Retrait"} — ${goal.name}`,
        goalId: goal.id,
        source: "manual",
      })
      .returning({ id: s.transactions.id });
    transactionId = t.id;
  }
  const [row] = await ctx.tx
    .insert(s.goalContributions)
    .values({ userId: ctx.userId, goalId: goal.id, amount: signed, date: input.date, note: input.note, transactionId })
    .returning();
  await audit(ctx, "goal.contribution", "goal", goal.id, { amount: signed, transactionId });
  return row;
}

export async function deleteContribution(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.goalContributions).where(eq(s.goalContributions.id, id)).returning();
  if (!row) throw new ServiceError("Versement introuvable");
  await audit(ctx, "goal.contribution.delete", "goal", row.goalId, { amount: row.amount, transactionKept: row.transactionId });
}

/* ---------------- Patrimoine ---------------- */

export async function createWealthItem(ctx: Ctx, input: z.output<typeof wealthItemSchema>) {
  const [item] = await ctx.tx
    .insert(s.wealthItems)
    .values({ userId: ctx.userId, kind: input.kind, category: input.category, name: input.name, notes: input.notes })
    .returning();
  await ctx.tx.insert(s.wealthValuations).values({ userId: ctx.userId, itemId: item.id, date: input.date, value: input.value, method: input.method });
  await audit(ctx, "wealth.create", "wealth", item.id);
  return item;
}

export async function addValuation(ctx: Ctx, input: z.output<typeof valuationSchema>) {
  const [item] = await ctx.tx.select().from(s.wealthItems).where(eq(s.wealthItems.id, input.itemId));
  if (!item) throw new ServiceError("Élément introuvable");
  const [row] = await ctx.tx.insert(s.wealthValuations).values({ ...input, userId: ctx.userId }).returning();
  await audit(ctx, "wealth.valuation", "wealth", input.itemId, { value: input.value, date: input.date });
  return row;
}

export async function deleteWealthItem(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.wealthItems).where(eq(s.wealthItems.id, id)).returning();
  if (!row) throw new ServiceError("Élément introuvable");
  await audit(ctx, "wealth.delete", "wealth", id);
}

export async function deleteValuation(ctx: Ctx, id: string) {
  await ctx.tx.delete(s.wealthValuations).where(eq(s.wealthValuations.id, id));
}
