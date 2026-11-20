/**
 * Prévisions de solde.
 *
 * Hypothèses (affichées à l'utilisateur) :
 *  - Point de départ : solde réel actuel du périmètre (comptes disponibles par défaut).
 *  - Flux connus : échéances récurrentes actives (revenus, charges, transferts) non encore confirmées
 *    et opérations prévues saisies.
 *  - Dépenses variables : moyenne quotidienne observée sur les 90 derniers jours (dépenses non liées à
 *    une récurrence, nettes des remboursements). Non projetées si l'historique fait moins de 21 jours.
 *  - Revenus irréguliers : ignorés dans les scénarios prudent et normal ; moyenne historique ajoutée
 *    uniquement dans le scénario optimiste.
 *  - Marge d'incertitude : ±1,28 écart-type des dépenses variables quotidiennes × √(nombre de jours)
 *    (≈ intervalle à 80 % si les dépenses étaient indépendantes d'un jour à l'autre).
 *
 * Une prévision n'est jamais une garantie.
 */
import { addDays, diffDays, startOfMonth, type ISODate } from "@/lib/dates";
import { scopeDelta } from "./ledger";
import { scheduledItems } from "./recurring";
import type { LedgerTx, RecurringRule } from "./types";

export const MIN_HISTORY_DAYS = 21;
const HISTORY_WINDOW = 90;

export interface ScenarioParams {
  variableSpendingFactor: number;
  includeIrregularIncome: boolean;
  incomeFactor: number;
}

export const SCENARIOS: Record<"prudent" | "normal" | "optimistic", ScenarioParams & { label: string; description: string }> = {
  prudent: {
    label: "Prudent",
    description: "Dépenses variables +15 %, revenus récurrents −5 %, aucun revenu irrégulier.",
    variableSpendingFactor: 1.15,
    includeIrregularIncome: false,
    incomeFactor: 0.95,
  },
  normal: {
    label: "Normal",
    description: "Dépenses variables au niveau moyen observé, revenus récurrents inchangés, aucun revenu irrégulier.",
    variableSpendingFactor: 1,
    includeIrregularIncome: false,
    incomeFactor: 1,
  },
  optimistic: {
    label: "Optimiste",
    description: "Dépenses variables −10 %, revenus récurrents inchangés, revenus irréguliers au niveau moyen observé.",
    variableSpendingFactor: 0.9,
    includeIrregularIncome: true,
    incomeFactor: 1,
  },
};

export interface HistoryStats {
  historyDays: number;
  variableDailyMean: number;
  variableDailyStd: number;
  irregularIncomeDaily: number;
  sufficient: boolean;
}

/** Statistiques historiques sur le périmètre (dépenses variables et revenus irréguliers). */
export function historyStats(txs: LedgerTx[], scope: Set<string>, today: ISODate): HistoryStats {
  const posted = txs.filter((t) => t.status === "posted" && t.date <= today);
  const inScope = posted.filter((t) => scope.has(t.accountId));
  const first = inScope.reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  if (!first) return { historyDays: 0, variableDailyMean: 0, variableDailyStd: 0, irregularIncomeDaily: 0, sufficient: false };
  const start = addDays(today, -(HISTORY_WINDOW - 1)) > first ? addDays(today, -(HISTORY_WINDOW - 1)) : first;
  const historyDays = diffDays(start, today) + 1;
  const perDay = new Map<ISODate, number>();
  let irregularIncome = 0;
  for (const t of inScope) {
    if (t.date < start) continue;
    if ((t.kind === "expense" || t.kind === "refund") && !t.recurringId) {
      const v = t.kind === "expense" ? t.amount : -t.amount;
      perDay.set(t.date, (perDay.get(t.date) ?? 0) + v);
    } else if (t.kind === "income" && !t.recurringId) {
      irregularIncome += t.amount;
    }
  }
  const values: number[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) values.push(perDay.get(d) ?? 0);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return {
    historyDays,
    variableDailyMean: Math.max(0, mean),
    variableDailyStd: Math.sqrt(variance),
    irregularIncomeDaily: irregularIncome / historyDays,
    sufficient: historyDays >= MIN_HISTORY_DAYS,
  };
}

export interface ForecastPoint {
  date: ISODate;
  prudent: number;
  normal: number;
  optimistic: number;
  low: number;
  high: number;
  scheduled: number; // flux connus seuls (sans dépenses variables)
}

export interface ForecastResult {
  startBalance: number;
  points: ForecastPoint[];
  milestones: { days: number; date: ISODate; prudent: number; normal: number; optimistic: number; low: number; high: number }[];
  history: HistoryStats;
  lowestNormal: { date: ISODate; balance: number };
  firstNegativeNormal: ISODate | null;
  firstNegativePrudent: ISODate | null;
  scheduledIncome: number;
  scheduledOutflows: number;
  reliability: "insufficient" | "limited" | "good";
  assumptions: string[];
  horizonDays: number;
}

export interface ForecastInput {
  today: ISODate;
  horizonDays: number;
  startBalance: number;
  scope: Set<string>;
  txs: LedgerTx[];
  rules: RecurringRule[];
}

export function forecast(input: ForecastInput): ForecastResult {
  const { today, scope } = input;
  const horizonDays = Math.max(1, Math.min(366, Math.round(input.horizonDays)));
  const end = addDays(today, horizonDays);
  const history = historyStats(input.txs, scope, today);

  // Flux connus par jour (à partir de demain ; les échéances passées non confirmées sont reportées à demain).
  const tomorrow = addDays(today, 1);
  const knownIncome = new Map<ISODate, number>();
  const knownOther = new Map<ISODate, number>();
  const add = (m: Map<ISODate, number>, d: ISODate, v: number) => m.set(d, (m.get(d) ?? 0) + v);

  const items = scheduledItems(input.rules, input.txs, startOfMonth(today), end).filter((i) => !i.realized);
  let scheduledIncome = 0;
  let scheduledOutflows = 0;
  for (const it of items) {
    // Une échéance passée de ce mois non confirmée est supposée encore à payer (prudence).
    const date = it.date <= today ? tomorrow : it.date;
    const pseudo: LedgerTx = {
      id: it.ruleId,
      kind: it.kind,
      status: "posted",
      amount: it.amount,
      accountId: it.accountId,
      toAccountId: it.toAccountId,
      categoryId: it.categoryId,
      date,
    };
    const d = scopeDelta(pseudo, scope);
    if (d === 0) continue;
    if (it.kind === "income") {
      add(knownIncome, date, d);
      scheduledIncome += d;
    } else {
      add(knownOther, date, d);
      if (d < 0) scheduledOutflows += -d;
    }
  }
  for (const tx of input.txs) {
    if (tx.status !== "planned" || tx.recurringId || tx.date > end) continue;
    const date = tx.date <= today ? tomorrow : tx.date;
    const d = scopeDelta(tx, scope, "posted+planned");
    if (d === 0) continue;
    if (tx.kind === "income") {
      add(knownIncome, date, d);
      scheduledIncome += d;
    } else {
      add(knownOther, date, d);
      if (d < 0) scheduledOutflows += -d;
    }
  }

  const useVariable = history.sufficient;
  const z = 1.28;
  const balances = { prudent: input.startBalance, normal: input.startBalance, optimistic: input.startBalance, scheduled: input.startBalance };
  const points: ForecastPoint[] = [
    { date: today, prudent: input.startBalance, normal: input.startBalance, optimistic: input.startBalance, low: input.startBalance, high: input.startBalance, scheduled: input.startBalance },
  ];
  let lowestNormal = { date: today, balance: input.startBalance };
  let firstNegativeNormal: ISODate | null = input.startBalance < 0 ? today : null;
  let firstNegativePrudent: ISODate | null = input.startBalance < 0 ? today : null;

  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const inc = knownIncome.get(date) ?? 0;
    const other = knownOther.get(date) ?? 0;
    for (const key of ["prudent", "normal", "optimistic"] as const) {
      const sc = SCENARIOS[key];
      let delta = Math.round(inc * sc.incomeFactor) + other;
      if (useVariable) {
        delta -= history.variableDailyMean * sc.variableSpendingFactor;
        if (sc.includeIrregularIncome) delta += history.irregularIncomeDaily;
      }
      balances[key] += delta;
    }
    balances.scheduled += inc + other;
    const spread = useVariable ? z * history.variableDailyStd * Math.sqrt(i) : 0;
    const p: ForecastPoint = {
      date,
      prudent: Math.round(balances.prudent),
      normal: Math.round(balances.normal),
      optimistic: Math.round(balances.optimistic),
      low: Math.round(balances.normal - spread),
      high: Math.round(balances.normal + spread),
      scheduled: Math.round(balances.scheduled),
    };
    points.push(p);
    if (p.normal < lowestNormal.balance) lowestNormal = { date, balance: p.normal };
    if (!firstNegativeNormal && p.normal < 0) firstNegativeNormal = date;
    if (!firstNegativePrudent && p.prudent < 0) firstNegativePrudent = date;
  }

  const milestones = [7, 30, 90, 180, 365]
    .filter((d) => d <= horizonDays)
    .map((d) => {
      const p = points[d];
      return { days: d, date: p.date, prudent: p.prudent, normal: p.normal, optimistic: p.optimistic, low: p.low, high: p.high };
    });

  const reliability: ForecastResult["reliability"] = !history.sufficient ? "insufficient" : history.historyDays < 60 ? "limited" : "good";
  const assumptions = [
    `Point de départ : solde réel actuel du périmètre choisi.`,
    `Flux connus : ${items.length} échéance(s) récurrente(s) et opérations prévues sur la période.`,
    useVariable
      ? `Dépenses variables : ${(history.variableDailyMean / 100).toFixed(2).replace(".", ",")} €/jour en moyenne sur ${history.historyDays} jours d'historique.`
      : `Dépenses variables non projetées : moins de ${MIN_HISTORY_DAYS} jours d'historique (${history.historyDays} j). La courbe ne reflète que les flux connus et sera donc trop optimiste.`,
    "Revenus irréguliers exclus des scénarios prudent et normal.",
    "Les échéances passées de ce mois non confirmées sont supposées encore à payer.",
  ];

  return {
    startBalance: input.startBalance,
    points,
    milestones,
    history,
    lowestNormal,
    firstNegativeNormal,
    firstNegativePrudent,
    scheduledIncome,
    scheduledOutflows,
    reliability,
    assumptions,
    horizonDays,
  };
}
