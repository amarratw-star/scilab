/**
 * Indicateurs consolidés — utilisés par le tableau de bord, les analyses, les rapports et le conseiller IA.
 * Tous les chiffres proviennent du moteur de calcul (src/lib/finance), source de vérité unique.
 */
import "server-only";
import { addDays, endOfMonth, startOfMonth, type ISODate } from "@/lib/dates";
import { computeAvailable, resteAVivre } from "@/lib/finance/available";
import { evaluateBudget, type BudgetStatus } from "@/lib/finance/budgets";
import { goalProgress } from "@/lib/finance/goals";
import { unusualExpenses } from "@/lib/finance/insights";
import { scheduledItems } from "@/lib/finance/recurring";
import { comparePeriods, isFixedExpense, periodTotals } from "@/lib/finance/stats";
import { forecast } from "@/lib/finance/forecast";
import { LIQUID_ACCOUNT_TYPES } from "@/lib/finance/types";
import { formatMoneyPlain } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";
import type { Finance } from "./snapshot";
import type { UserSettings } from "@/server/db/schema";

export function budgetStatuses(fin: Finance, today: ISODate): BudgetStatus[] {
  return fin.budgets.filter((b) => b.active).map((b) => evaluateBudget(b, fin.txs, fin.cmap, today));
}

export function computeOverview(fin: Finance, today: ISODate, settings: UserSettings) {
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const month = periodTotals(fin.txs, monthStart, today, fin.cmap);
  const comparison = comparePeriods(fin.txs, monthStart, today, fin.cmap);
  const budgets = budgetStatuses(fin, today);
  const available = computeAvailable({
    today,
    accounts: fin.accounts,
    balances: fin.balances,
    txs: fin.txs,
    rules: fin.rules,
    safetyCushion: settings.safetyCushion ?? 0,
    monthlySavingsTarget: settings.monthlySavingsTarget ?? 0,
    budgets,
  });
  // Charges fixes du mois : payées (dépenses fixes effectuées) + restant à payer (échéances non confirmées)
  const fixedPaid = fin.txs
    .filter((t) => t.status === "posted" && t.kind === "expense" && t.date >= monthStart && t.date <= monthEnd && isFixedExpense(t, fin.cmap))
    .reduce((s, t) => s + t.amount, 0);
  const pendingItems = scheduledItems(fin.rules, fin.txs, monthStart, monthEnd).filter((i) => !i.realized && i.kind === "expense");
  const fixedPending = pendingItems.reduce((s, i) => s + i.amount, 0);
  return {
    today,
    month,
    comparison,
    budgets,
    available,
    fixedPaid,
    fixedPending,
    resteAVivre: resteAVivre(month.income, fixedPaid, fixedPending),
    summary: fin.summary,
  };
}

export type Overview = ReturnType<typeof computeOverview>;

export type AlertItem = {
  id: string;
  severity: "info" | "warning" | "danger" | "success";
  title: string;
  body: string;
  href?: string;
};

/** Alertes pertinentes et limitées (5 au maximum, les plus importantes d'abord). */
export function computeAlerts(fin: Finance, ov: Overview, today: ISODate): AlertItem[] {
  const alerts: (AlertItem & { weight: number })[] = [];
  for (const b of ov.budgets) {
    if (b.level === "exceeded")
      alerts.push({ id: `budget-${b.budget.id}`, weight: 90, severity: "danger", title: `Budget « ${b.budget.name} » dépassé`, body: `${formatMoneyPlain(b.spent)} dépensés pour ${formatMoneyPlain(b.effectiveAmount)} prévus.`, href: "/budgets" });
    else if (b.level === "danger")
      alerts.push({ id: `budget-${b.budget.id}`, weight: 70, severity: "warning", title: `Budget « ${b.budget.name} » bientôt atteint`, body: `Il reste ${formatMoneyPlain(b.remaining)} pour ${b.daysLeft} jour(s).`, href: "/budgets" });
  }
  if (ov.available.status === "ok" && ov.available.spendableUntilMonthEnd < 0)
    alerts.push({ id: "shortfall", weight: 95, severity: "danger", title: "Solde insuffisant prévu", body: `Tes engagements d'ici la fin du mois dépassent ton disponible de ${formatMoneyPlain(-ov.available.spendableUntilMonthEnd)}.`, href: "/disponible" });
  const soon = scheduledItems(fin.rules, fin.txs, today, addDays(today, 3)).filter((i) => !i.realized && i.kind === "expense");
  for (const it of soon.slice(0, 2))
    alerts.push({ id: `debit-${it.ruleId}-${it.date}`, weight: 50, severity: "info", title: `Prélèvement ${it.date === today ? "aujourd'hui" : "le " + formatDateFR(it.date)}`, body: `${it.name} : ${formatMoneyPlain(it.amount)}.`, href: "/abonnements" });
  for (const u of unusualExpenses(fin.txs, addDays(today, -7), today, fin.cmap).slice(0, 2))
    alerts.push({ id: `unusual-${u.tx.id}`, weight: 60, severity: "warning", title: "Dépense inhabituelle", body: `${u.tx.merchant || u.tx.description || "Dépense"} : ${u.reason}`, href: "/transactions" });
  for (const g of fin.goals) {
    const p = goalProgress(g, fin.contributions, today);
    if (p.state === "behind" && g.priority === 1)
      alerts.push({ id: `goal-${g.id}`, weight: 55, severity: "warning", title: `Objectif « ${g.name} » en retard`, body: `${formatMoneyPlain(p.saved)} épargnés sur ${formatMoneyPlain(g.targetAmount)}. Il faudrait ${formatMoneyPlain(p.recommendedMonthly ?? 0)} par mois.`, href: "/epargne" });
  }
  const c = ov.comparison;
  if (c.previous.netExpenses >= 10000 && c.expensesChange !== null && c.expensesChange >= 0.3 && c.current.netExpenses - c.previous.netExpenses >= 10000)
    alerts.push({ id: "spending-up", weight: 65, severity: "warning", title: "Hausse importante des dépenses", body: `${formatMoneyPlain(c.current.netExpenses)} dépensés depuis le début du mois contre ${formatMoneyPlain(c.previous.netExpenses)} sur la même période du mois dernier.`, href: "/analyses" });
  return alerts
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(({ weight: _w, ...a }) => a);
}

export function liquidScope(fin: Finance) {
  return new Set(fin.accounts.filter((a) => !a.archived && LIQUID_ACCOUNT_TYPES.includes(a.type)).map((a) => a.id));
}

export function computeForecast(fin: Finance, today: ISODate, horizonDays: number, scopeKind: "liquid" | "all" = "liquid") {
  const scope = scopeKind === "liquid" ? liquidScope(fin) : new Set(fin.accounts.filter((a) => !a.archived).map((a) => a.id));
  const startBalance = [...scope].reduce((s, id) => s + (fin.balances.get(id) ?? 0), 0);
  return forecast({ today, horizonDays, startBalance, scope, txs: fin.txs, rules: fin.rules });
}
