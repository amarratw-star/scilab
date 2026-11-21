/**
 * Opportunités d'économies — toutes calculées à partir des opérations réelles de l'utilisateur.
 * Aucune habitude n'est supposée : une opportunité n'apparaît que si les données la justifient.
 */
import { addDays, addMonths, startOfMonth, type ISODate } from "@/lib/dates";
import { formatMoneyPlain } from "@/lib/money";
import { expensesByCategory } from "./stats";
import { detectRecurringPayments, reviewSubscriptions, categoryTrends } from "./insights";
import type { CategoryMap, LedgerTx, RecurringRule } from "./types";

export interface Opportunity {
  id: string;
  kind: "reduce" | "trend" | "subscription" | "untracked" | "fees";
  title: string;
  detail: string;
  monthlySaving: number;
  annualSaving: number;
  evidence: string;
  href: string;
}

const MIN_MONTHLY = 3000; // 30 € / mois

export function savingsOpportunities(input: { txs: LedgerTx[]; cats: CategoryMap; rules: RecurringRule[]; reviewed: Map<string, ISODate | null>; today: ISODate }): Opportunity[] {
  const { txs, cats, rules, today } = input;
  const from = startOfMonth(addMonths(today, -3));
  const to = addDays(startOfMonth(today), -1);
  const first = txs.filter((t) => t.status === "posted").reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const out: Opportunity[] = [];
  if (!first) return out;
  const monthsCovered = Math.max(1, Math.min(3, Math.round((Date.parse(to) - Date.parse(first > from ? first : from)) / (30.44 * 86400000))));

  // 1. Réduire de 20 % les postes variables significatifs (sous-catégories détaillées)
  const rows = expensesByCategory(txs, from, to, cats, false).filter((r) => r.categoryId && !cats.get(r.categoryId)?.isFixed && !cats.get(cats.get(r.categoryId)?.parentId ?? "")?.isFixed);
  for (const r of rows) {
    const monthly = Math.round(r.amount / monthsCovered);
    if (monthly < MIN_MONTHLY || r.count < 2) continue;
    const saving = Math.round(monthly * 0.2);
    out.push({
      id: `reduce-${r.categoryId}`,
      kind: "reduce",
      title: `${r.name} : −20 %`,
      detail: `Tu dépenses en moyenne ${formatMoneyPlain(monthly)} par mois en ${r.name.toLowerCase()}. En réduisant cette dépense de 20 %, tu pourrais économiser environ ${formatMoneyPlain(saving * 12)} par an.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      evidence: `${r.count} dépense(s) sur ${monthsCovered} mois complet(s).`,
      href: `/transactions?categorie=${r.categoryId}`,
    });
  }

  // 2. Catégories en forte hausse ce mois-ci (projection fin de mois vs moyenne 3 mois)
  for (const t of categoryTrends(txs, startOfMonth(today), today, cats)) {
    if (!t.categoryId || t.average3 === null || t.average3 < MIN_MONTHLY || cats.get(t.categoryId)?.isFixed) continue;
    const gap = t.current - t.average3;
    if (gap >= 2000 && t.current > t.average3 * 1.2) {
      out.push({
        id: `trend-${t.categoryId}`,
        kind: "trend",
        title: `${t.name} déjà au-dessus de ta moyenne`,
        detail: `${formatMoneyPlain(t.current)} dépensés ce mois-ci contre ${formatMoneyPlain(t.average3)} en moyenne par mois. Revenir à ta moyenne éviterait ${formatMoneyPlain(gap)} de dépenses supplémentaires ce mois-ci.`,
        monthlySaving: gap,
        annualSaving: gap,
        evidence: "Mois en cours comparé à la moyenne des 3 mois complets précédents.",
        href: `/transactions?categorie=${t.categoryId}&periode=mois`,
      });
    }
  }

  // 3. Abonnements redondants / à revoir / paiements répétitifs non suivis
  for (const f of reviewSubscriptions(rules, input.reviewed, detectRecurringPayments(txs, rules, today), cats, today)) {
    if (f.potentialMonthlySaving <= 0) continue;
    out.push({
      id: `sub-${f.type}-${f.ruleIds.join("-") || f.title}`,
      kind: f.type === "untracked" ? "untracked" : "subscription",
      title: f.title,
      detail: f.detail,
      monthlySaving: f.potentialMonthlySaving,
      annualSaving: f.potentialMonthlySaving * 12,
      evidence: f.type === "untracked" ? "Paiements répétés détectés dans tes opérations." : "Abonnements enregistrés.",
      href: "/abonnements",
    });
  }

  // 4. Frais bancaires
  const feesCat = [...cats.values()].find((c) => c.name.toLowerCase() === "frais bancaires");
  if (feesCat) {
    const fees = expensesByCategory(txs, from, to, cats).find((r) => r.categoryId === feesCat.id);
    if (fees && fees.amount / monthsCovered >= 300) {
      const monthly = Math.round(fees.amount / monthsCovered);
      out.push({
        id: "fees",
        kind: "fees",
        title: "Frais bancaires",
        detail: `Tu paies en moyenne ${formatMoneyPlain(monthly)} de frais bancaires par mois (${formatMoneyPlain(monthly * 12)} par an). Comparer les offres de ta banque ou d'une banque en ligne pourrait réduire ce montant.`,
        monthlySaving: monthly,
        annualSaving: monthly * 12,
        evidence: "Catégorie « Frais bancaires » sur les derniers mois complets.",
        href: `/transactions?categorie=${feesCat.id}`,
      });
    }
  }

  return out.sort((a, b) => b.annualSaving - a.annualSaving);
}
