/**
 * Santé financière — note indicative sur 100 (pas un diagnostic officiel).
 *
 * Méthodologie (voir docs/CALCULS.md) : 6 critères, tous fondés sur des RATIOS et des comportements,
 * jamais sur le niveau absolu des revenus — un revenu modeste n'est pas pénalisé, un revenu élevé
 * ne garantit pas une bonne note.
 *
 *  Critère                     Poids  Mesure
 *  Capacité d'épargne            25   taux d'épargne médian des 3 derniers mois complets
 *  Marge de sécurité             25   (disponible + épargne) ÷ dépenses mensuelles moyennes (mois couverts)
 *  Respect des budgets           15   part des budgets mensuels respectés sur 3 mois
 *  Évolution des dépenses        15   dernier mois complet vs moyenne des 3 mois précédents
 *  Poids des charges fixes       10   charges fixes ÷ revenus (3 mois)
 *  Régularité de la gestion      10   opérations catégorisées, échéances suivies, saisie récente
 *
 * Un critère non évaluable (données manquantes) est exclu et les poids sont redistribués.
 * Si moins de 60 % du poids total est évaluable, ou si l'historique couvre moins de 60 jours,
 * aucune note n'est calculée (« données insuffisantes »).
 */
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth, type ISODate } from "@/lib/dates";
import { formatMoneyPlain, formatPct } from "@/lib/money";
import { computeBalances } from "./ledger";
import { budgetSpent } from "./budgets";
import { scheduledItems } from "./recurring";
import { isFixedExpense, monthlySeries, periodTotals } from "./stats";
import { LIQUID_ACCOUNT_TYPES, type BudgetRule, type CategoryMap, type LedgerAccount, type LedgerTx, type RecurringRule } from "./types";

export interface HealthCriterion {
  key: "savings" | "cushion" | "budgets" | "trend" | "fixed" | "discipline";
  label: string;
  weight: number;
  score: number | null; // 0..100, null = non évaluable
  detail: string;
  recommendation: string | null;
}

export type HealthLevel = "excellent" | "good" | "fair" | "fragile" | "concerning";

export interface HealthResult {
  status: "ok" | "insufficient";
  score: number | null;
  level: HealthLevel | null;
  reasons: string[]; // raisons si données insuffisantes
  criteria: HealthCriterion[];
  strengths: HealthCriterion[];
  weaknesses: HealthCriterion[];
  evaluatedWeight: number;
  historyDays: number;
}

export const HEALTH_LEVEL_LABEL: Record<HealthLevel, string> = {
  excellent: "Excellente",
  good: "Bonne",
  fair: "Correcte",
  fragile: "Fragile",
  concerning: "Préoccupante",
};

/** Interpolation linéaire par morceaux, bornée. points = [[x, score], ...] triés par x. */
export function piecewise(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return Math.round(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  return points[points.length - 1][1];
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function levelFor(score: number): HealthLevel {
  return score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "fair" : score >= 35 ? "fragile" : "concerning";
}

export interface HealthInput {
  today: ISODate;
  accounts: LedgerAccount[];
  txs: LedgerTx[];
  cats: CategoryMap;
  rules: RecurringRule[];
  budgets: BudgetRule[];
}

export function healthScore(input: HealthInput): HealthResult {
  const { today, accounts, cats, rules, budgets } = input;
  const txs = input.txs.filter((t) => t.date <= today);
  const posted = txs.filter((t) => t.status === "posted");
  const first = posted.reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const historyDays = first ? diffDays(first, today) + 1 : 0;
  const lastFullEnd = addDays(startOfMonth(today), -1);
  const from3 = startOfMonth(addMonths(today, -3));
  const months3 = monthlySeries(posted, from3, lastFullEnd).filter((m) => first && `${m.month}-31` >= first);
  const criteria: HealthCriterion[] = [];

  // 1. Capacité d'épargne
  const rates = months3.filter((m) => m.income > 0).map((m) => m.savingsRate!);
  if (rates.length >= 2) {
    const r = median(rates);
    criteria.push({
      key: "savings",
      label: "Capacité d'épargne",
      weight: 25,
      score: piecewise(r, [[-0.1, 0], [0, 30], [0.1, 70], [0.2, 100]]),
      detail: `Taux d'épargne médian sur les derniers mois complets : ${formatPct(r)}.`,
      recommendation: r < 0.1 ? "Mets de côté un montant fixe dès la réception de tes revenus (virement programmé vers ton épargne)." : null,
    });
  } else criteria.push({ key: "savings", label: "Capacité d'épargne", weight: 25, score: null, detail: "Au moins deux mois complets avec des revenus sont nécessaires.", recommendation: null });

  // 2. Marge de sécurité (en mois de dépenses couverts)
  const spendMonths = months3.filter((m) => m.expenses > 0);
  const avgSpend = spendMonths.length ? spendMonths.reduce((s, m) => s + m.expenses, 0) / spendMonths.length : 0;
  const balances = computeBalances(accounts, txs, today);
  const reserve = accounts.filter((a) => !a.archived && (LIQUID_ACCOUNT_TYPES.includes(a.type) || a.type === "savings")).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
  if (avgSpend > 0 && spendMonths.length >= 2) {
    const monthsCovered = reserve / avgSpend;
    criteria.push({
      key: "cushion",
      label: "Marge de sécurité",
      weight: 25,
      score: piecewise(monthsCovered, [[0, 0], [1, 40], [3, 80], [6, 100]]),
      detail: `Ton argent disponible et ton épargne (${formatMoneyPlain(reserve)}) couvrent ${monthsCovered.toFixed(1).replace(".", ",")} mois de dépenses moyennes.`,
      recommendation: monthsCovered < 3 ? "Vise une épargne de précaution d'au moins 3 mois de dépenses avant d'autres projets." : null,
    });
  } else criteria.push({ key: "cushion", label: "Marge de sécurité", weight: 25, score: null, detail: "Pas assez de mois complets de dépenses pour estimer une moyenne.", recommendation: null });

  // 3. Respect des budgets (budgets mensuels, mois complets où le budget existait)
  const monthly = budgets.filter((b) => b.active && b.period === "monthly");
  let checks = 0;
  let respected = 0;
  for (const b of monthly) {
    for (const m of months3) {
      const mStart = `${m.month}-01`;
      if (b.createdOn && b.createdOn > endOfMonth(mStart)) continue;
      checks++;
      if (budgetSpent(b, posted, cats, mStart, endOfMonth(mStart)) <= b.amount) respected++;
    }
  }
  if (checks >= 2) {
    const share = respected / checks;
    criteria.push({
      key: "budgets",
      label: "Respect des budgets",
      weight: 15,
      score: Math.round(share * 100),
      detail: `${respected} budget(s)-mois respecté(s) sur ${checks} évalué(s).`,
      recommendation: share < 0.75 ? "Ajuste les budgets souvent dépassés à un niveau réaliste, puis réduis-les progressivement." : null,
    });
  } else criteria.push({ key: "budgets", label: "Respect des budgets", weight: 15, score: null, detail: monthly.length ? "Les budgets sont trop récents pour être évalués." : "Aucun budget mensuel défini.", recommendation: monthly.length ? null : "Crée au moins un budget global mensuel pour suivre tes dépenses." });

  // 4. Évolution des dépenses
  const series5 = monthlySeries(posted, startOfMonth(addMonths(today, -4)), lastFullEnd).filter((m) => first && `${m.month}-01` >= startOfMonth(first));
  if (series5.length >= 4) {
    const last = series5[series5.length - 1].expenses;
    const prev = series5.slice(-4, -1);
    const avg = prev.reduce((s, m) => s + m.expenses, 0) / prev.length;
    if (avg > 0) {
      const change = (last - avg) / avg;
      criteria.push({
        key: "trend",
        label: "Évolution des dépenses",
        weight: 15,
        score: piecewise(change, [[-0.1, 100], [0, 75], [0.1, 50], [0.3, 0]]),
        detail: `Dépenses du dernier mois complet : ${formatMoneyPlain(last)}, contre ${formatMoneyPlain(Math.round(avg))} en moyenne les 3 mois précédents (${formatPct(change, 0, true)}).`,
        recommendation: change > 0.1 ? "Identifie les catégories en hausse dans Analyses et fixe-leur un budget." : null,
      });
    }
  }
  if (!criteria.some((c) => c.key === "trend")) criteria.push({ key: "trend", label: "Évolution des dépenses", weight: 15, score: null, detail: "Il faut au moins 4 mois complets d'historique.", recommendation: null });

  // 5. Poids des charges fixes
  const t3 = periodTotals(posted, from3, lastFullEnd, cats);
  if (t3.income > 0 && months3.filter((m) => m.income > 0).length >= 2) {
    const ratio = t3.fixedExpenses / t3.income;
    criteria.push({
      key: "fixed",
      label: "Poids des charges fixes",
      weight: 10,
      score: piecewise(ratio, [[0.35, 100], [0.5, 60], [0.8, 0]]),
      detail: `Les charges fixes représentent ${formatPct(ratio, 0)} de tes revenus encaissés.`,
      recommendation: ratio > 0.5 ? "Revois les abonnements et contrats (assurance, téléphone, énergie) : ce sont les économies les plus durables." : null,
    });
  } else criteria.push({ key: "fixed", label: "Poids des charges fixes", weight: 10, score: null, detail: "Aucun revenu encaissé sur la période de référence.", recommendation: null });

  // 6. Régularité de la gestion
  const recent = posted.filter((t) => t.date >= addDays(today, -60));
  if (recent.length >= 10) {
    const exp = recent.filter((t) => t.kind === "expense");
    const categorized = exp.length ? exp.filter((t) => t.categoryId).length / exp.length : 1;
    const items = scheduledItems(rules, input.txs, addDays(today, -60), addDays(today, -1));
    const tracked = items.length ? items.filter((i) => i.realized).length / items.length : 1;
    const lastTx = recent.reduce((m, t) => (t.date > m ? t.date : m), recent[0].date);
    const freshness = diffDays(lastTx, today) <= 14 ? 1 : 0.4;
    const score = Math.round((categorized * 0.4 + tracked * 0.4 + freshness * 0.2) * 100);
    criteria.push({
      key: "discipline",
      label: "Régularité de la gestion",
      weight: 10,
      score,
      detail: `${formatPct(categorized, 0)} des dépenses catégorisées, ${formatPct(tracked, 0)} des échéances suivies, dernière opération le ${lastTx.split("-").reverse().join("/")}.`,
      recommendation: score < 70 ? "Catégorise tes opérations et confirme tes échéances chaque semaine pour des analyses fiables." : null,
    });
  } else criteria.push({ key: "discipline", label: "Régularité de la gestion", weight: 10, score: null, detail: "Moins de 10 opérations sur les 60 derniers jours.", recommendation: null });

  const evaluated = criteria.filter((c) => c.score !== null);
  const evaluatedWeight = evaluated.reduce((s, c) => s + c.weight, 0);
  const reasons: string[] = [];
  if (historyDays < 60) reasons.push(`L'historique ne couvre que ${historyDays} jour(s) : il en faut au moins 60.`);
  if (evaluatedWeight < 60) reasons.push(`Seuls ${evaluatedWeight} % des critères sont évaluables (minimum 60 %).`);
  const strengths = evaluated.filter((c) => c.score! >= 70).sort((a, b) => b.score! - a.score!);
  const weaknesses = evaluated.filter((c) => c.score! < 50).sort((a, b) => a.score! - b.score!);
  if (reasons.length) return { status: "insufficient", score: null, level: null, reasons, criteria, strengths, weaknesses, evaluatedWeight, historyDays };
  const score = Math.round(evaluated.reduce((s, c) => s + c.score! * c.weight, 0) / evaluatedWeight);
  return { status: "ok", score, level: levelFor(score), reasons, criteria, strengths, weaknesses, evaluatedWeight, historyDays };
}

/** Note à la fin de chaque mois précédent (évolution). */
export function healthHistory(input: HealthInput, months = 4): { month: string; score: number | null }[] {
  const out: { month: string; score: number | null }[] = [];
  for (let i = months; i >= 1; i--) {
    const end = endOfMonth(addMonths(input.today, -i));
    out.push({ month: end.slice(0, 7), score: healthScore({ ...input, today: end }).score });
  }
  return out;
}

export { isFixedExpense };
