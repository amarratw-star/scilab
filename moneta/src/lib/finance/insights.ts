/**
 * Détection intelligente et recommandations — toujours justifiées par les données.
 * Les formulations restent prudentes : une corrélation n'est jamais présentée comme une certitude.
 */
import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  formatDayShort,
  monthKey,
  startOfMonth,
  type ISODate,
} from "@/lib/dates";
import { formatMoneyPlain, formatPct, pctChange } from "@/lib/money";
import { comparablePreviousPeriod, expensesByCategory, periodTotals, type PeriodTotals } from "./stats";
import { monthlyEquivalent } from "./recurring";
import type { CategoryMap, LedgerTx, RecurringRule } from "./types";

/** Normalise un libellé bancaire pour regrouper les opérations d'un même commerçant. */
export function normalizeLabel(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(cb|carte|prlv|prelevement|sepa|vir|virement|paiement|achat|retrait|dab|facture|fact|ref|ech|europeen|inst|sct|recu|emis)\b/g, " ")
    .replace(/\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ------------------------------------------------------------------ */
/* Dépenses inhabituelles                                              */
/* ------------------------------------------------------------------ */

export interface UnusualExpense {
  tx: LedgerTx;
  categoryName: string;
  typical: number; // médiane de la catégorie
  ratio: number;
  reason: string;
}

/**
 * Une dépense est inhabituelle si elle dépasse largement les montants habituels de sa catégorie
 * (≥ 3 × la médiane ET au-delà de médiane + 4 × écart absolu médian) sur les 180 jours précédents,
 * avec au moins 4 dépenses de référence et un montant d'au moins 30 €.
 */
export function unusualExpenses(txs: LedgerTx[], from: ISODate, to: ISODate, cats: CategoryMap): UnusualExpense[] {
  const out: UnusualExpense[] = [];
  const expenses = txs.filter((t) => t.status === "posted" && t.kind === "expense");
  for (const tx of expenses) {
    if (tx.date < from || tx.date > to || tx.amount < 3000 || tx.recurringId) continue;
    const histFrom = addDays(tx.date, -180);
    const ref = expenses
      .filter((t) => t.id !== tx.id && t.categoryId === tx.categoryId && t.date >= histFrom && t.date < tx.date)
      .map((t) => t.amount);
    if (ref.length < 4) continue;
    const med = median(ref);
    const mad = median(ref.map((v) => Math.abs(v - med))) * 1.4826;
    if (med > 0 && tx.amount >= 3 * med && tx.amount > med + 4 * mad) {
      const name = tx.categoryId ? cats.get(tx.categoryId)?.name ?? "cette catégorie" : "les dépenses non catégorisées";
      out.push({
        tx,
        categoryName: name,
        typical: Math.round(med),
        ratio: tx.amount / med,
        reason: `${formatMoneyPlain(tx.amount)} contre ${formatMoneyPlain(Math.round(med))} habituellement en ${name} (×${(tx.amount / med).toFixed(1).replace(".", ",")}).`,
      });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/* ------------------------------------------------------------------ */
/* Tendances par catégorie                                             */
/* ------------------------------------------------------------------ */

export interface CategoryTrend {
  categoryId: string | null;
  name: string;
  current: number;
  previous: number; // période comparable précédente
  average3: number | null; // moyenne des 3 mois complets précédents
  change: number | null;
}

export function categoryTrends(txs: LedgerTx[], from: ISODate, to: ISODate, cats: CategoryMap): CategoryTrend[] {
  const prev = comparablePreviousPeriod(from, to);
  const cur = expensesByCategory(txs, from, to, cats);
  const before = new Map(expensesByCategory(txs, prev.from, prev.to, cats).map((r) => [r.categoryId, r.amount]));
  // moyenne 3 mois complets précédant `from`
  const avgFrom = startOfMonth(addMonths(from, -3));
  const avgTo = addDays(startOfMonth(from), -1);
  const firstTx = txs.reduce<ISODate | null>((m, t) => (t.status === "posted" && (!m || t.date < m) ? t.date : m), null);
  const enoughHistory = firstTx !== null && firstTx <= avgFrom;
  const avg = new Map(expensesByCategory(txs, avgFrom, avgTo, cats).map((r) => [r.categoryId, r.amount / 3]));
  const ids = new Set([...cur.map((r) => r.categoryId), ...before.keys()]);
  const out: CategoryTrend[] = [];
  for (const id of ids) {
    const c = cur.find((r) => r.categoryId === id);
    const current = c?.amount ?? 0;
    const previous = before.get(id) ?? 0;
    out.push({
      categoryId: id,
      name: c?.name ?? (id ? cats.get(id)?.name ?? "Autre" : "Non catégorisé"),
      current,
      previous,
      average3: enoughHistory ? Math.round(avg.get(id) ?? 0) : null,
      change: pctChange(current, previous),
    });
  }
  return out.sort((a, b) => b.current - b.previous - (a.current - a.previous));
}

/* ------------------------------------------------------------------ */
/* Détection de paiements récurrents                                   */
/* ------------------------------------------------------------------ */

export interface RecurringCandidate {
  key: string;
  label: string;
  occurrences: number;
  averageAmount: number;
  frequency: "weekly" | "monthly" | "yearly";
  lastDate: ISODate;
  monthlyCost: number;
  matchesExistingRule: boolean;
}

export function detectRecurringPayments(txs: LedgerTx[], rules: RecurringRule[], today: ISODate): RecurringCandidate[] {
  const groups = new Map<string, LedgerTx[]>();
  for (const t of txs) {
    if (t.status !== "posted" || t.kind !== "expense" || t.recurringId) continue;
    const key = normalizeLabel(t.merchant || t.description);
    if (key.length < 3) continue;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  const ruleKeys = rules.map((r) => normalizeLabel(r.merchant || r.name));
  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const amounts = list.map((t) => t.amount);
    const med = median(amounts);
    if (!amounts.every((a) => Math.abs(a - med) <= med * 0.15)) continue;
    const gaps = list.slice(1).map((t, i) => diffDays(list[i].date, t.date));
    const g = median(gaps);
    let frequency: RecurringCandidate["frequency"] | null = null;
    if (g >= 6 && g <= 8) frequency = "weekly";
    else if (g >= 26 && g <= 35) frequency = "monthly";
    else if (g >= 350 && g <= 380) frequency = "yearly";
    if (!frequency) continue;
    if (!gaps.every((x) => Math.abs(x - g) <= Math.max(4, g * 0.2))) continue;
    const last = list[list.length - 1].date;
    if (diffDays(last, today) > g * 1.6) continue; // plus actif
    const avgAmount = Math.round(amounts.reduce((s, v) => s + v, 0) / amounts.length);
    out.push({
      key,
      label: list[list.length - 1].merchant || list[list.length - 1].description || key,
      occurrences: list.length,
      averageAmount: avgAmount,
      frequency,
      lastDate: last,
      monthlyCost: monthlyEquivalent(avgAmount, frequency),
      matchesExistingRule: ruleKeys.some((k) => k && (k.includes(key) || key.includes(k))),
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

/* ------------------------------------------------------------------ */
/* Revue des abonnements                                               */
/* ------------------------------------------------------------------ */

export interface SubscriptionFinding {
  type: "redundant" | "review" | "untracked";
  title: string;
  detail: string;
  potentialMonthlySaving: number;
  ruleIds: string[];
}

export function reviewSubscriptions(
  rules: RecurringRule[],
  lastReviewed: Map<string, ISODate | null>,
  candidates: RecurringCandidate[],
  cats: CategoryMap,
  today: ISODate,
): SubscriptionFinding[] {
  const out: SubscriptionFinding[] = [];
  const active = rules.filter((r) => r.status === "active" && r.kind === "expense" && r.isSubscription);
  // Plusieurs abonnements actifs dans la même catégorie : potentiellement redondants
  const byCat = new Map<string, RecurringRule[]>();
  for (const r of active) {
    if (!r.categoryId) continue;
    const list = byCat.get(r.categoryId) ?? [];
    list.push(r);
    byCat.set(r.categoryId, list);
  }
  for (const [cid, list] of byCat) {
    if (list.length < 2) continue;
    const costs = list.map((r) => monthlyEquivalent(r.amount, r.frequency)).sort((a, b) => a - b);
    out.push({
      type: "redundant",
      title: `${list.length} abonnements dans « ${cats.get(cid)?.name ?? "la même catégorie"} »`,
      detail: `${list.map((r) => r.name).join(", ")}. Si certains font doublon, en garder un seul économiserait jusqu'à ${formatMoneyPlain(costs.slice(0, -1).reduce((s, v) => s + v, 0))} par mois. À vérifier selon ton usage réel.`,
      potentialMonthlySaving: costs.slice(0, -1).reduce((s, v) => s + v, 0),
      ruleIds: list.map((r) => r.id),
    });
  }
  // Abonnements jamais revus depuis 6 mois
  for (const r of active) {
    const reviewed = lastReviewed.get(r.id);
    if (!reviewed || reviewed < addMonths(today, -6)) {
      out.push({
        type: "review",
        title: `${r.name} : utilisé régulièrement ?`,
        detail: `Coût annuel : ${formatMoneyPlain(monthlyEquivalent(r.amount, r.frequency) * 12)}. Tu ne l'as pas marqué comme vérifié depuis plus de 6 mois. MONETA ne peut pas savoir si tu l'utilises : confirme-le ou envisage de le résilier toi-même.`,
        potentialMonthlySaving: monthlyEquivalent(r.amount, r.frequency),
        ruleIds: [r.id],
      });
    }
  }
  // Paiements répétitifs non suivis
  for (const c of candidates) {
    if (c.matchesExistingRule) continue;
    out.push({
      type: "untracked",
      title: `Paiement répétitif détecté : ${c.label}`,
      detail: `${c.occurrences} paiements d'environ ${formatMoneyPlain(c.averageAmount)} (${c.frequency === "monthly" ? "mensuel" : c.frequency === "weekly" ? "hebdomadaire" : "annuel"}), dernier le ${formatDayShort(c.lastDate)}. Il ne figure pas dans tes abonnements : est-ce un abonnement oublié ?`,
      potentialMonthlySaving: c.monthlyCost,
      ruleIds: [],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recommandations                                                     */
/* ------------------------------------------------------------------ */

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  annualImpact: number;
  evidence: string;
}

export function recommendations(input: {
  txs: LedgerTx[];
  cats: CategoryMap;
  today: ISODate;
  rules: RecurringRule[];
}): Recommendation[] {
  const { txs, cats, today, rules } = input;
  const from = startOfMonth(today);
  const out: Recommendation[] = [];
  const trends = categoryTrends(txs, from, today, cats);
  // Projection de fin de mois pour comparer à la moyenne mensuelle
  const elapsedShare = (diffDays(from, today) + 1) / (diffDays(from, endOfMonth(today)) + 1);
  for (const t of trends) {
    if (t.average3 === null || t.average3 < 2000 || !t.categoryId) continue;
    const c = t.categoryId ? cats.get(t.categoryId) : undefined;
    if (c?.isFixed) continue;
    const projected = Math.round(t.current / Math.max(0.25, elapsedShare));
    if (elapsedShare >= 0.5 && projected > t.average3 * 1.15 && projected - t.average3 >= 2000) {
      const gap = projected - t.average3;
      out.push({
        id: `trend-${t.categoryId}`,
        title: `${t.name} : au-dessus de ta moyenne`,
        detail: `Tu as dépensé ${formatMoneyPlain(t.current)} en ${t.name.toLowerCase()} ce mois-ci (projection ≈ ${formatMoneyPlain(projected)} en fin de mois) contre ${formatMoneyPlain(t.average3)} en moyenne sur les 3 derniers mois. Revenir à ta moyenne représenterait environ ${formatMoneyPlain(gap * 12)} sur un an si cet écart se répétait chaque mois.`,
        annualImpact: gap * 12,
        evidence: `Mois en cours vs moyenne des 3 mois complets précédents.`,
      });
    }
  }
  // Plus grosse catégorie variable : réduction de 10 %
  const last3From = startOfMonth(addMonths(today, -3));
  const last3To = addDays(startOfMonth(today), -1);
  const byCat = expensesByCategory(txs, last3From, last3To, cats).filter((r) => r.categoryId && !cats.get(r.categoryId!)?.isFixed);
  const top = byCat[0];
  if (top && top.amount / 3 >= 5000) {
    const monthly = Math.round(top.amount / 3);
    const saving = Math.round(monthly * 0.1);
    out.push({
      id: `top-${top.categoryId}`,
      title: `Premier poste variable : ${top.name}`,
      detail: `${top.name} représente ${formatMoneyPlain(monthly)} par mois en moyenne sur les 3 derniers mois. Le réduire de 10 % (${formatMoneyPlain(saving)} par mois) libérerait ${formatMoneyPlain(saving * 12)} sur un an.`,
      annualImpact: saving * 12,
      evidence: `Moyenne des dépenses nettes sur 3 mois complets.`,
    });
  }
  // Abonnements
  const subs = rules.filter((r) => r.status === "active" && r.isSubscription && r.kind === "expense");
  if (subs.length >= 3) {
    const monthly = subs.reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0);
    const cheapest = [...subs].sort((a, b) => monthlyEquivalent(a.amount, a.frequency) - monthlyEquivalent(b.amount, b.frequency))[0];
    out.push({
      id: "subscriptions",
      title: `${subs.length} abonnements actifs`,
      detail: `Ils coûtent ${formatMoneyPlain(monthly)} par mois, soit ${formatMoneyPlain(monthly * 12)} par an. Supprimer un seul abonnement comme « ${cheapest.name} » ferait économiser ${formatMoneyPlain(monthlyEquivalent(cheapest.amount, cheapest.frequency) * 12)} par an.`,
      annualImpact: monthlyEquivalent(cheapest.amount, cheapest.frequency) * 12,
      evidence: `Somme des abonnements actifs enregistrés.`,
    });
  }
  // Taux d'épargne
  const prevMonthFrom = startOfMonth(addMonths(today, -1));
  const prevTotals = periodTotals(txs, prevMonthFrom, endOfMonth(prevMonthFrom), cats);
  if (prevTotals.income > 0 && prevTotals.savingsRate !== null && prevTotals.savingsRate < 0.1) {
    const target = Math.round(prevTotals.income * 0.1);
    out.push({
      id: "savings-rate",
      title: "Taux d'épargne faible le mois dernier",
      detail: `Ton taux d'épargne a été de ${formatPct(prevTotals.savingsRate)}. Viser 10 % représenterait ${formatMoneyPlain(target)} par mois, soit ${formatMoneyPlain(target * 12)} par an, à mettre de côté dès la réception de tes revenus.`,
      annualImpact: (target - Math.max(0, prevTotals.netSavings)) * 12,
      evidence: `Revenus et dépenses du mois précédent.`,
    });
  }
  return out.sort((a, b) => b.annualImpact - a.annualImpact);
}

/* ------------------------------------------------------------------ */
/* « Ton mois en bref »                                                */
/* ------------------------------------------------------------------ */

export function monthSummary(txs: LedgerTx[], today: ISODate, cats: CategoryMap): { sentences: string[]; totals: PeriodTotals; hasData: boolean } {
  const from = startOfMonth(today);
  const totals = periodTotals(txs, from, today, cats);
  const sentences: string[] = [];
  const hasData = totals.incomeCount + totals.expenseCount > 0;
  if (!hasData) {
    sentences.push("Aucune opération enregistrée ce mois-ci pour le moment.");
    return { sentences, totals, hasData };
  }
  const income = formatMoneyPlain(totals.income);
  const spent = formatMoneyPlain(totals.netExpenses);
  if (totals.income > 0) {
    if (totals.netSavings >= 0) {
      sentences.push(
        `Tu as reçu ${income} ce mois-ci et dépensé ${spent}. Tu as donc conservé ${formatMoneyPlain(totals.netSavings)}, soit un taux d'épargne de ${formatPct(totals.savingsRate)}.`,
      );
    } else {
      sentences.push(
        `Tu as reçu ${income} ce mois-ci et dépensé ${spent} : tes dépenses dépassent tes revenus de ${formatMoneyPlain(-totals.netSavings)}.`,
      );
    }
  } else {
    sentences.push(`Tu as dépensé ${spent} ce mois-ci. Aucun revenu n'a encore été encaissé.`);
  }
  if (totals.refunds > 0) sentences.push(`Ce montant tient compte de ${formatMoneyPlain(totals.refunds)} de remboursements.`);
  const trends = categoryTrends(txs, from, today, cats).filter((t) => t.previous >= 2000 && t.change !== null);
  const up = trends.filter((t) => (t.change ?? 0) >= 0.15 && t.current - t.previous >= 1500).sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];
  const down = trends.filter((t) => (t.change ?? 0) <= -0.15 && t.previous - t.current >= 1500).sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];
  if (up)
    sentences.push(
      `Tes dépenses en ${up.name.toLowerCase()} ont augmenté de ${formatPct(up.change, 0)} par rapport à la même période du mois précédent (${formatMoneyPlain(up.current)} contre ${formatMoneyPlain(up.previous)}).`,
    );
  if (down)
    sentences.push(
      `À l'inverse, ${down.name.toLowerCase()} recule de ${formatPct(Math.abs(down.change ?? 0), 0)} (${formatMoneyPlain(down.current)} contre ${formatMoneyPlain(down.previous)}).`,
    );
  const cats3 = expensesByCategory(txs, from, today, cats).slice(0, 1);
  if (cats3[0] && totals.netExpenses > 0)
    sentences.push(`Ton premier poste de dépenses est « ${cats3[0].name} » (${formatMoneyPlain(cats3[0].amount)}, ${formatPct(cats3[0].share, 0)} du total).`);
  return { sentences, totals, hasData };
}

export function monthLabelKey(today: ISODate) {
  return monthKey(today);
}
