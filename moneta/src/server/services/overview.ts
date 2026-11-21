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
import { formatMoneyPlain, formatPct } from "@/lib/money";
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
  const monthItems = scheduledItems(fin.rules, fin.txs, monthStart, monthEnd).filter((i) => !i.realized);
  const fixedPending = monthItems.filter((i) => i.kind === "expense").reduce((s, i) => s + i.amount, 0);
  // Revenus attendus du mois (récurrents non encore reçus + revenus prévus) — jamais ajoutés au solde réel.
  const expectedIncomeMonth =
    monthItems.filter((i) => i.kind === "income").reduce((s, i) => s + i.amount, 0) +
    fin.txs.filter((t) => t.kind === "income" && t.date >= monthStart && t.date <= monthEnd && (t.status === "planned" || (t.status === "posted" && t.date > today)) && !t.recurringId).reduce((s, t) => s + t.amount, 0);
  return {
    today,
    month,
    comparison,
    budgets,
    available,
    fixedPaid,
    fixedPending,
    expectedIncomeMonth,
    /** Reste à vivre prévisionnel du mois : revenus du mois (encaissés + attendus) − charges fixes du mois. */
    resteAVivre: resteAVivre(month.income + expectedIncomeMonth, fixedPaid, fixedPending),
    /** Même calcul limité aux revenus déjà encaissés. */
    resteAVivreEncaisse: resteAVivre(month.income, fixedPaid, fixedPending),
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
  action?: { label: string; href: string };
};

/**
 * Alertes réellement importantes (5 au maximum, par gravité), chacune avec une explication et une action.
 * Anti-bruit : seuils minimaux, une alerte par sujet, pas d'alerte pour un prélèvement modeste.
 */
export function computeAlerts(fin: Finance, ov: Overview, today: ISODate): AlertItem[] {
  const alerts: (AlertItem & { weight: number })[] = [];
  const av = ov.available;
  if (av.status === "ok" && av.spendableUntilMonthEnd < 0)
    alerts.push({ id: "shortfall", weight: 100, severity: "danger", title: "Fin de mois sous tension", body: `Tes engagements d'ici la fin du mois (charges, dépenses prévues, épargne et sécurité) dépassent ton argent disponible de ${formatMoneyPlain(-av.spendableUntilMonthEnd)}.`, action: { label: "Voir le détail", href: "/disponible" } });
  // Solde prévisionnel insuffisant (30 jours, scénario prudent)
  const f = computeForecast(fin, today, 30, "liquid");
  if (f.firstNegativePrudent && f.reliability !== "insufficient")
    alerts.push({ id: "forecast-negative", weight: 95, severity: "danger", title: "Risque de solde négatif", body: `Dans le scénario prudent, ton solde disponible passerait sous zéro vers le ${formatDateFR(f.firstNegativePrudent)}.`, action: { label: "Voir la trésorerie", href: "/calendrier" } });
  for (const b of ov.budgets) {
    if (b.level === "exceeded")
      alerts.push({ id: `budget-${b.budget.id}`, weight: 80, severity: "danger", title: `Budget « ${b.budget.name} » dépassé`, body: `${formatMoneyPlain(b.spent)} dépensés pour ${formatMoneyPlain(b.effectiveAmount)} prévus (+${formatMoneyPlain(b.spent - b.effectiveAmount)}).`, action: { label: "Voir les dépenses", href: b.budget.categoryId ? `/transactions?categorie=${b.budget.categoryId}&periode=mois` : "/budgets" } });
    else if (b.level === "danger" && b.daysLeft > 3)
      alerts.push({ id: `budget-${b.budget.id}`, weight: 60, severity: "warning", title: `Budget « ${b.budget.name} » presque épuisé`, body: `Il reste ${formatMoneyPlain(b.remaining)} pour ${b.daysLeft} jours, soit ${formatMoneyPlain(b.dailyRemaining ?? 0)} par jour.`, action: { label: "Gérer mes budgets", href: "/budgets" } });
  }
  const threshold = Math.max(10000, av.status === "ok" ? Math.round(av.availableNow * 0.1) : 0);
  const big = scheduledItems(fin.rules, fin.txs, today, addDays(today, 5)).filter((i) => !i.realized && i.kind === "expense" && i.amount >= threshold);
  for (const it of big.slice(0, 2))
    alerts.push({ id: `debit-${it.ruleId}-${it.date}`, weight: 50, severity: "info", title: `Prélèvement important ${it.date === today ? "aujourd'hui" : "le " + formatDateFR(it.date)}`, body: `${it.name} : ${formatMoneyPlain(it.amount)}. Vérifie que le compte est suffisamment approvisionné.`, action: { label: "Voir l'échéance", href: "/abonnements" } });
  for (const u of unusualExpenses(fin.txs, addDays(today, -7), today, fin.cmap).slice(0, 1))
    alerts.push({ id: `unusual-${u.tx.id}`, weight: 55, severity: "warning", title: "Dépense inhabituelle", body: `${u.tx.merchant || u.tx.description || "Dépense"} — ${u.reason}`, action: { label: "Vérifier l'opération", href: `/transactions?id=${u.tx.id}` } });
  for (const g of fin.goals) {
    const p = goalProgress(g, fin.contributions, today);
    if ((p.state === "behind" || p.state === "overdue") && g.priority <= 2)
      alerts.push({ id: `goal-${g.id}`, weight: 45, severity: "warning", title: `Objectif « ${g.name} » en retard`, body: `${formatMoneyPlain(p.saved)} épargnés sur ${formatMoneyPlain(g.targetAmount)}.${p.recommendedMonthly ? ` Il faudrait environ ${formatMoneyPlain(p.recommendedMonthly)} par mois pour tenir l'échéance.` : ""}`, action: { label: "Faire un versement", href: "/epargne" } });
  }
  const c = ov.comparison;
  if (c.previous.netExpenses >= 20000 && c.expensesChange !== null && c.expensesChange >= 0.3 && c.current.netExpenses - c.previous.netExpenses >= 15000)
    alerts.push({ id: "spending-up", weight: 40, severity: "warning", title: "Dépenses en forte hausse", body: `${formatMoneyPlain(c.current.netExpenses)} depuis le début du mois contre ${formatMoneyPlain(c.previous.netExpenses)} sur la même période du mois dernier (${formatPct(c.expensesChange, 0, true)}).`, action: { label: "Analyser", href: "/analyses" } });
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
