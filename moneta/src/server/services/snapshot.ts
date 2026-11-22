import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { Ctx } from "./context";
import { computeBalances, summarizeBalances } from "@/lib/finance/ledger";
import { categoryMap, type BudgetRule, type CategoryInfo, type Contribution, type GoalInfo, type LedgerAccount, type LedgerTx, type RecurringRule } from "@/lib/finance/types";

export type AccountRow = typeof s.accounts.$inferSelect;
export type TxRow = typeof s.transactions.$inferSelect;
export type CategoryRow = typeof s.categories.$inferSelect;
export type RecurringRow = typeof s.recurringItems.$inferSelect;
export type BudgetRow = typeof s.budgets.$inferSelect;
export type GoalRow = typeof s.goals.$inferSelect;

export const toLedgerAccount = (a: AccountRow): LedgerAccount => ({
  id: a.id,
  name: a.name,
  type: a.type,
  initialBalance: a.initialBalance,
  openedOn: a.openedOn,
  archived: a.archivedAt !== null,
  color: a.color,
});

export const toLedgerTx = (t: TxRow): LedgerTx => ({
  id: t.id,
  kind: t.kind,
  status: t.status,
  amount: t.amount,
  accountId: t.accountId,
  toAccountId: t.toAccountId,
  categoryId: t.categoryId,
  date: t.date,
  recurringId: t.recurringId,
  occurrenceDate: t.occurrenceDate,
  merchant: t.merchant,
  description: t.description,
  paymentMethod: t.paymentMethod,
  goalId: t.goalId,
});

export const toCategoryInfo = (c: CategoryRow): CategoryInfo => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  parentId: c.parentId,
  isFixed: c.isFixed,
  color: c.color,
  icon: c.icon,
});

export const toRule = (r: RecurringRow): RecurringRule => ({
  id: r.id,
  name: r.name,
  kind: r.kind as RecurringRule["kind"],
  amount: r.amount,
  frequency: r.frequency,
  startDate: r.startDate,
  endDate: r.endDate,
  accountId: r.accountId,
  toAccountId: r.toAccountId,
  categoryId: r.categoryId,
  status: r.status,
  isSubscription: r.isSubscription,
  merchant: r.merchant,
});

export const toBudgetRule = (b: BudgetRow): BudgetRule => ({
  id: b.id,
  name: b.name,
  categoryId: b.categoryId,
  period: b.period,
  amount: b.amount,
  startDate: b.startDate,
  endDate: b.endDate,
  rollover: b.rollover,
  alertThresholds: b.alertThresholds,
  active: b.active,
  createdOn: b.createdAt.toISOString().slice(0, 10),
});

export const toGoalInfo = (g: GoalRow): GoalInfo => ({
  id: g.id,
  name: g.name,
  targetAmount: g.targetAmount,
  startDate: g.startDate,
  deadline: g.deadline,
  priority: g.priority,
});

/**
 * Charge l'ensemble des données financières de l'utilisateur (filtrées par RLS).
 * Pour un usage personnel (quelques milliers d'opérations par an), tout calculer à partir des
 * opérations garantit une source de vérité unique et des soldes toujours cohérents.
 */
export async function loadFinance(ctx: Ctx) {
  const { tx } = ctx;
  const [accountRows, txRows, categoryRows, ruleRows, budgetRows, goalRows, contribRows] = await Promise.all([
    tx.select().from(s.accounts).orderBy(asc(s.accounts.sortOrder), asc(s.accounts.createdAt)),
    tx.select().from(s.transactions).orderBy(asc(s.transactions.date), asc(s.transactions.createdAt)),
    tx.select().from(s.categories).where(isNull(s.categories.archivedAt)).orderBy(asc(s.categories.sortOrder), asc(s.categories.name)),
    tx.select().from(s.recurringItems).orderBy(asc(s.recurringItems.name)),
    tx.select().from(s.budgets).where(eq(s.budgets.active, true)).orderBy(asc(s.budgets.name)),
    tx.select().from(s.goals).where(isNull(s.goals.archivedAt)).orderBy(asc(s.goals.priority), asc(s.goals.createdAt)),
    tx.select().from(s.goalContributions).orderBy(asc(s.goalContributions.date)),
  ]);
  // Comptes dans une autre devise que celle de l'utilisateur (ex. compte en USD importé de la banque) :
  // aucun taux de change n'est configuré, donc ils sont exclus des totaux, statistiques, budgets et prévisions
  // (jamais additionnés à des euros), mais leur solde propre reste calculé et affiché dans leur devise.
  const foreignAccountIds = new Set(accountRows.filter((a) => a.currency && a.currency !== ctx.currency).map((a) => a.id));
  const allAccounts = accountRows.map(toLedgerAccount);
  const accounts = allAccounts.map((a) => (foreignAccountIds.has(a.id) ? { ...a, archived: true } : a));
  const allTxs = txRows.map(toLedgerTx);
  const txs = foreignAccountIds.size ? allTxs.filter((t) => !foreignAccountIds.has(t.accountId)) : allTxs;
  const categories = categoryRows.map(toCategoryInfo);
  const cmap = categoryMap(categories);
  const rules = ruleRows.map(toRule);
  // Soldes réels à la date du jour : une opération datée dans le futur n'est pas encore dans le solde.
  const balances = computeBalances(allAccounts, allTxs, ctx.today);
  const summary = summarizeBalances(accounts, balances);
  const contributions: Contribution[] = contribRows.map((c) => ({ goalId: c.goalId, amount: c.amount, date: c.date }));
  return {
    accountRows,
    txRows,
    categoryRows,
    ruleRows,
    budgetRows,
    goalRows,
    contribRows,
    accounts,
    txs,
    allTxs,
    foreignAccountIds,
    categories,
    cmap,
    rules,
    budgets: budgetRows.map(toBudgetRule),
    goals: goalRows.map(toGoalInfo),
    contributions,
    balances,
    summary,
  };
}

export type Finance = Awaited<ReturnType<typeof loadFinance>>;
