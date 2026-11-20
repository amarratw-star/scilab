/**
 * Budgets : fenêtres de période, consommation, report et alertes.
 * Consommation = dépenses effectuées (nettes des remboursements) de la catégorie et de ses sous-catégories
 * (ou toutes les dépenses pour un budget global) dans la fenêtre.
 */
import { addDays, addMonths, diffDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek, type ISODate } from "@/lib/dates";
import { safeRatio } from "@/lib/money";
import type { BudgetRule, CategoryMap, LedgerTx } from "./types";

export function budgetWindow(b: BudgetRule, today: ISODate): { from: ISODate; to: ISODate } {
  if (b.period === "weekly") return { from: startOfWeek(today), to: endOfWeek(today) };
  if (b.period === "custom") return { from: b.startDate ?? today, to: b.endDate ?? today };
  return { from: startOfMonth(today), to: endOfMonth(today) };
}

export function previousBudgetWindow(b: BudgetRule, today: ISODate): { from: ISODate; to: ISODate } | null {
  if (b.period === "weekly") {
    const from = addDays(startOfWeek(today), -7);
    return { from, to: addDays(from, 6) };
  }
  if (b.period === "monthly") {
    const from = addMonths(startOfMonth(today), -1);
    return { from, to: endOfMonth(from) };
  }
  return null;
}

/** Vrai si la catégorie `categoryId` est `target` ou une de ses sous-catégories. */
export function categoryMatches(categoryId: string | null, target: string, cats: CategoryMap): boolean {
  if (!categoryId) return false;
  if (categoryId === target) return true;
  return cats.get(categoryId)?.parentId === target;
}

export function budgetSpent(b: BudgetRule, txs: LedgerTx[], cats: CategoryMap, from: ISODate, to: ISODate): number {
  let spent = 0;
  for (const tx of txs) {
    if (tx.status !== "posted" || tx.date < from || tx.date > to) continue;
    if (tx.kind !== "expense" && tx.kind !== "refund") continue;
    if (b.categoryId && !categoryMatches(tx.categoryId, b.categoryId, cats)) continue;
    spent += tx.kind === "expense" ? tx.amount : -tx.amount;
  }
  return spent;
}

export type BudgetLevel = "ok" | "notice" | "warning" | "danger" | "exceeded";

export interface BudgetStatus {
  budget: BudgetRule;
  from: ISODate;
  to: ISODate;
  baseAmount: number;
  carryOver: number; // report de la période précédente (positif = reliquat, négatif = dépassement)
  effectiveAmount: number;
  spent: number;
  remaining: number;
  ratio: number | null;
  level: BudgetLevel;
  reachedThreshold: number | null; // plus haut seuil d'alerte atteint
  daysLeft: number; // jours restants dans la fenêtre, aujourd'hui inclus
  dailyRemaining: number | null; // montant restant par jour
  projectedSpend: number | null; // projection linéaire en fin de période
}

export function evaluateBudget(b: BudgetRule, txs: LedgerTx[], cats: CategoryMap, today: ISODate): BudgetStatus {
  const { from, to } = budgetWindow(b, today);
  let carryOver = 0;
  if (b.rollover) {
    const prev = previousBudgetWindow(b, today);
    // Le report n'est calculé que si le budget existait déjà (des données existent sur la période précédente).
    if (prev && (!b.createdOn || b.createdOn <= prev.to)) carryOver = b.amount - budgetSpent(b, txs, cats, prev.from, prev.to);
  }
  const effectiveAmount = Math.max(0, b.amount + carryOver);
  const spent = budgetSpent(b, txs, cats, from, to);
  const remaining = effectiveAmount - spent;
  const ratio = safeRatio(spent, effectiveAmount);
  const thresholds = [...b.alertThresholds].sort((a, c) => a - c);
  const pct = ratio === null ? (spent > 0 ? Infinity : 0) : ratio * 100;
  const reached = thresholds.filter((t) => pct >= t);
  const reachedThreshold = reached.length ? reached[reached.length - 1] : null;
  let level: BudgetLevel = "ok";
  if (pct > 100) level = "exceeded";
  else if (pct >= 90) level = "danger";
  else if (pct >= 75) level = "warning";
  else if (pct >= 50) level = "notice";
  const ref = today < from ? from : today > to ? to : today;
  const daysLeft = Math.max(0, diffDays(ref, to) + 1);
  const elapsed = Math.max(1, diffDays(from, ref) + 1);
  const totalDays = diffDays(from, to) + 1;
  return {
    budget: b,
    from,
    to,
    baseAmount: b.amount,
    carryOver,
    effectiveAmount,
    spent,
    remaining,
    ratio,
    level,
    reachedThreshold,
    daysLeft,
    dailyRemaining: daysLeft > 0 ? Math.floor(Math.max(0, remaining) / daysLeft) : null,
    projectedSpend: today >= from && today <= to ? Math.round((spent / elapsed) * totalDays) : null,
  };
}

export const BUDGET_LEVEL_LABEL: Record<BudgetLevel, string> = {
  ok: "Sous contrôle",
  notice: "Moitié atteinte",
  warning: "À surveiller",
  danger: "Bientôt atteint",
  exceeded: "Dépassé",
};
