/**
 * Statistiques de flux sur une période. Source de vérité unique pour :
 *
 *  - Revenus encaissés     = somme des revenus « posted » de la période (hors transferts, hors remboursements).
 *  - Dépenses brutes       = somme des dépenses « posted ».
 *  - Remboursements        = somme des remboursements « posted » (argent récupéré sur une dépense).
 *  - Dépenses nettes       = dépenses brutes − remboursements.
 *  - Épargne nette         = revenus encaissés − dépenses nettes (ce qui reste du mois).
 *  - Taux d'épargne        = épargne nette / revenus encaissés (indisponible si aucun revenu).
 *  - Les transferts internes ne sont NI des revenus NI des dépenses. Un versement vers un livret
 *    est un transfert : il n'est donc pas compté une seconde fois comme dépense.
 *  - Les régularisations (ajustements de solde) sont exclues des revenus et dépenses.
 *  - Les opérations prévues ou annulées sont exclues.
 */
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  eachMonth,
  endOfMonth,
  monthKey,
  parseISO,
  startOfMonth,
  toISO,
  weekdayMonday0,
  type ISODate,
} from "@/lib/dates";
import { pctChange, safeRatio } from "@/lib/money";
import type { CategoryMap, LedgerTx } from "./types";

export interface PeriodTotals {
  from: ISODate;
  to: ISODate;
  days: number;
  income: number;
  grossExpenses: number;
  refunds: number;
  netExpenses: number;
  netSavings: number;
  savingsRate: number | null;
  fixedExpenses: number;
  variableExpenses: number;
  adjustments: number;
  transfers: number;
  expenseCount: number;
  incomeCount: number;
  dailyAverageExpense: number;
}

export function inRange(tx: LedgerTx, from: ISODate, to: ISODate) {
  return tx.date >= from && tx.date <= to;
}

/** Une dépense est « fixe » si elle est liée à une charge récurrente ou si sa catégorie (ou parente) est marquée fixe. */
export function isFixedExpense(tx: LedgerTx, cats?: CategoryMap): boolean {
  if (tx.recurringId) return true;
  if (!cats || !tx.categoryId) return false;
  const c = cats.get(tx.categoryId);
  if (!c) return false;
  if (c.isFixed) return true;
  return c.parentId ? cats.get(c.parentId)?.isFixed ?? false : false;
}

export function periodTotals(txs: LedgerTx[], from: ISODate, to: ISODate, cats?: CategoryMap): PeriodTotals {
  let income = 0;
  let grossExpenses = 0;
  let refunds = 0;
  let fixedExpenses = 0;
  let adjustments = 0;
  let transfers = 0;
  let expenseCount = 0;
  let incomeCount = 0;
  for (const tx of txs) {
    if (tx.status !== "posted" || !inRange(tx, from, to)) continue;
    switch (tx.kind) {
      case "income":
        income += tx.amount;
        incomeCount++;
        break;
      case "expense":
        grossExpenses += tx.amount;
        expenseCount++;
        if (isFixedExpense(tx, cats)) fixedExpenses += tx.amount;
        break;
      case "refund":
        refunds += tx.amount;
        break;
      case "adjustment":
        adjustments += tx.amount;
        break;
      case "transfer":
        transfers += tx.amount;
        break;
    }
  }
  const netExpenses = grossExpenses - refunds;
  const netSavings = income - netExpenses;
  const days = Math.max(1, diffDays(from, to) + 1);
  return {
    from,
    to,
    days,
    income,
    grossExpenses,
    refunds,
    netExpenses,
    netSavings,
    savingsRate: income > 0 ? netSavings / income : null,
    fixedExpenses,
    variableExpenses: grossExpenses - fixedExpenses,
    adjustments,
    transfers,
    expenseCount,
    incomeCount,
    dailyAverageExpense: Math.round(netExpenses / days),
  };
}

export interface CategoryBreakdownRow {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  amount: number; // net des remboursements
  count: number;
  share: number | null;
}

/** Répartition des dépenses nettes par catégorie (sous-catégories regroupées sous leur parent si rollup). */
export function expensesByCategory(
  txs: LedgerTx[],
  from: ISODate,
  to: ISODate,
  cats: CategoryMap,
  rollup = true,
): CategoryBreakdownRow[] {
  const totals = new Map<string | null, { amount: number; count: number }>();
  for (const tx of txs) {
    if (tx.status !== "posted" || !inRange(tx, from, to)) continue;
    if (tx.kind !== "expense" && tx.kind !== "refund") continue;
    let cid = tx.categoryId;
    if (rollup && cid) {
      const c = cats.get(cid);
      if (c?.parentId) cid = c.parentId;
    }
    const cur = totals.get(cid) ?? { amount: 0, count: 0 };
    cur.amount += tx.kind === "expense" ? tx.amount : -tx.amount;
    if (tx.kind === "expense") cur.count++;
    totals.set(cid, cur);
  }
  const total = [...totals.values()].reduce((s, v) => s + Math.max(0, v.amount), 0);
  return [...totals.entries()]
    .map(([categoryId, v]) => {
      const c = categoryId ? cats.get(categoryId) : undefined;
      return {
        categoryId,
        name: c?.name ?? "Non catégorisé",
        color: c?.color ?? "#94a3b8",
        icon: c?.icon ?? "tag",
        amount: v.amount,
        count: v.count,
        share: safeRatio(Math.max(0, v.amount), total),
      };
    })
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Revenus par catégorie. */
export function incomeByCategory(txs: LedgerTx[], from: ISODate, to: ISODate, cats: CategoryMap) {
  const totals = new Map<string | null, number>();
  for (const tx of txs) {
    if (tx.status !== "posted" || tx.kind !== "income" || !inRange(tx, from, to)) continue;
    totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.amount);
  }
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: categoryId ? cats.get(categoryId)?.name ?? "Autre" : "Non catégorisé",
      color: categoryId ? cats.get(categoryId)?.color ?? "#94a3b8" : "#94a3b8",
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthlyPoint {
  month: string; // AAAA-MM
  income: number;
  expenses: number; // nettes
  savings: number;
  savingsRate: number | null;
}

export function monthlySeries(txs: LedgerTx[], from: ISODate, to: ISODate): MonthlyPoint[] {
  const months = eachMonth(from, to);
  const map = new Map(months.map((m) => [m, { income: 0, expenses: 0 }]));
  for (const tx of txs) {
    if (tx.status !== "posted" || !inRange(tx, from, to)) continue;
    const m = map.get(monthKey(tx.date));
    if (!m) continue;
    if (tx.kind === "income") m.income += tx.amount;
    else if (tx.kind === "expense") m.expenses += tx.amount;
    else if (tx.kind === "refund") m.expenses -= tx.amount;
  }
  return months.map((month) => {
    const v = map.get(month)!;
    const savings = v.income - v.expenses;
    return { month, income: v.income, expenses: v.expenses, savings, savingsRate: v.income > 0 ? savings / v.income : null };
  });
}

export interface DailyFlowPoint {
  date: ISODate;
  income: number;
  expenses: number;
}

export function dailyFlows(txs: LedgerTx[], from: ISODate, to: ISODate): DailyFlowPoint[] {
  const map = new Map<ISODate, DailyFlowPoint>();
  for (let d = from; d <= to; d = addDays(d, 1)) map.set(d, { date: d, income: 0, expenses: 0 });
  for (const tx of txs) {
    if (tx.status !== "posted" || !inRange(tx, from, to)) continue;
    const p = map.get(tx.date)!;
    if (tx.kind === "income") p.income += tx.amount;
    else if (tx.kind === "expense") p.expenses += tx.amount;
    else if (tx.kind === "refund") p.expenses -= tx.amount;
  }
  return [...map.values()];
}

/**
 * Période précédente COMPARABLE.
 * - Mois en cours jusqu'au jour J  -> même nombre de jours au début du mois précédent (borné à sa fin).
 * - Mois complet                    -> mois complet précédent.
 * - Année jusqu'au jour J           -> même période l'année précédente (29/02 géré).
 * - Autre période                   -> période de même durée juste avant.
 */
export function comparablePreviousPeriod(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  const f = parseISO(from);
  const t = parseISO(to);
  // Début de mois -> on compare au même découpage du mois précédent
  if (f.d === 1 && f.y === t.y && f.m === t.m) {
    const prevStart = addMonths(from, -1);
    const prevMonthEnd = endOfMonth(prevStart);
    const isFullMonth = t.d === daysInMonth(t.y, t.m);
    if (isFullMonth) return { from: prevStart, to: prevMonthEnd };
    const p = parseISO(prevStart);
    const day = Math.min(t.d, daysInMonth(p.y, p.m));
    return { from: prevStart, to: toISO(p.y, p.m, day) };
  }
  // Depuis le 1er janvier -> même période l'an dernier
  if (f.m === 1 && f.d === 1 && f.y === t.y) {
    const py = f.y - 1;
    const day = Math.min(t.d, daysInMonth(py, t.m));
    return { from: toISO(py, 1, 1), to: toISO(py, t.m, day) };
  }
  // Mois complets multiples (ex. 3 derniers mois complets)
  if (f.d === 1 && to === endOfMonth(to)) {
    const months = (t.y - f.y) * 12 + (t.m - f.m) + 1;
    const prevFrom = addMonths(from, -months);
    return { from: prevFrom, to: endOfMonth(addMonths(prevFrom, months - 1)) };
  }
  const len = diffDays(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export interface Comparison {
  current: PeriodTotals;
  previous: PeriodTotals;
  incomeChange: number | null;
  expensesChange: number | null;
  savingsChange: number | null;
}

export function comparePeriods(txs: LedgerTx[], from: ISODate, to: ISODate, cats?: CategoryMap): Comparison {
  const prev = comparablePreviousPeriod(from, to);
  const current = periodTotals(txs, from, to, cats);
  const previous = periodTotals(txs, prev.from, prev.to, cats);
  return {
    current,
    previous,
    incomeChange: pctChange(current.income, previous.income),
    expensesChange: pctChange(current.netExpenses, previous.netExpenses),
    savingsChange: pctChange(current.netSavings, previous.netSavings),
  };
}

/** Dépenses moyennes par jour de la semaine (lundi = 0). */
export function spendingByWeekday(txs: LedgerTx[], from: ISODate, to: ISODate) {
  const totals = Array(7).fill(0) as number[];
  const dayCounts = Array(7).fill(0) as number[];
  for (let d = from; d <= to; d = addDays(d, 1)) dayCounts[weekdayMonday0(d)]++;
  for (const tx of txs) {
    if (tx.status !== "posted" || tx.kind !== "expense" || !inRange(tx, from, to)) continue;
    totals[weekdayMonday0(tx.date)] += tx.amount;
  }
  return totals.map((total, i) => ({ weekday: i, total, average: dayCounts[i] ? Math.round(total / dayCounts[i]) : 0 }));
}

/** Les plus grosses dépenses d'une période. */
export function topExpenses(txs: LedgerTx[], from: ISODate, to: ISODate, limit = 5): LedgerTx[] {
  return txs
    .filter((t) => t.status === "posted" && t.kind === "expense" && inRange(t, from, to))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Moyenne mensuelle des dépenses nettes sur les N derniers mois complets avant `ref`. */
export function averageMonthlyExpenses(txs: LedgerTx[], ref: ISODate, months: number): number | null {
  const end = addDays(startOfMonth(ref), -1);
  const start = startOfMonth(addMonths(startOfMonth(ref), -months));
  const series = monthlySeries(txs, start, end);
  const firstTx = txs.filter((t) => t.status === "posted").reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const valid = series.filter((p) => firstTx && `${p.month}-01` >= startOfMonth(firstTx));
  if (!valid.length) return null;
  return Math.round(valid.reduce((s, p) => s + p.expenses, 0) / valid.length);
}
