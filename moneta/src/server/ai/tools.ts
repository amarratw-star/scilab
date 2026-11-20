/**
 * Outils internes exposés au conseiller IA.
 * L'IA n'a AUCUN accès direct à la base : elle ne voit que des statistiques calculées par le moteur
 * financier, pour l'utilisateur connecté uniquement. Elle ne peut rien modifier : `propose_transaction`
 * prépare une proposition que l'utilisateur doit confirmer explicitement dans l'interface.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { addDays, addMonths, endOfMonth, isValidISODate, startOfMonth, startOfWeek, startOfYear, formatDateFR, type ISODate } from "@/lib/dates";
import { formatMoneyPlain, formatPct } from "@/lib/money";
import { comparablePreviousPeriod, expensesByCategory, incomeByCategory, monthlySeries, periodTotals, topExpenses, spendingByWeekday, averageMonthlyExpenses } from "@/lib/finance/stats";
import { goalProgress, GOAL_STATE_LABEL } from "@/lib/finance/goals";
import { categoryTrends, detectRecurringPayments, recommendations, reviewSubscriptions, unusualExpenses } from "@/lib/finance/insights";
import { monthlyEquivalent, nextOccurrence, subscriptionTotals, FREQUENCY_LABELS } from "@/lib/finance/recurring";
import { savingsPlan, simulatePurchase, PURCHASE_VERDICT } from "@/lib/finance/simulate";
import { SCENARIOS } from "@/lib/finance/forecast";
import { computeForecast, computeOverview } from "@/server/services/overview";
import type { Finance } from "@/server/services/snapshot";
import type { UserSettings } from "@/server/db/schema";
import { weekdayName } from "@/lib/dates";

const eur = (c: number | null | undefined) => (c === null || c === undefined ? null : formatMoneyPlain(c));

export interface Proposal {
  kind: "expense" | "income";
  amount: number;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  date: ISODate;
  description: string;
}

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_overview",
    description: "Vue d'ensemble actuelle : soldes (disponible, épargne, total), revenus/dépenses/épargne du mois en cours, taux d'épargne, reste à vivre, argent dépensable jusqu'à la fin du mois. À appeler en premier pour toute question générale.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_period_stats",
    description: "Revenus, dépenses brutes/nettes, épargne, taux d'épargne, répartition par catégorie et plus grosses dépenses sur une période. Préréglages : today, this_week, this_month, last_month, last_3_months, last_6_months, last_12_months, this_year, last_year, ou dates personnalisées.",
    input_schema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["today", "this_week", "this_month", "last_month", "last_3_months", "last_6_months", "last_12_months", "this_year", "last_year", "custom"] },
        from: { type: "string", description: "AAAA-MM-JJ si preset=custom" },
        to: { type: "string", description: "AAAA-MM-JJ si preset=custom" },
        category: { type: "string", description: "Nom de catégorie optionnel pour filtrer (ex. Restaurants)" },
      },
      required: ["preset"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_periods",
    description: "Compare une période à la période précédente comparable (même nombre de jours / même découpage), avec les variations par catégorie.",
    input_schema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["this_month", "last_month", "this_year", "last_3_months", "last_6_months", "last_12_months", "custom"] },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["preset"],
      additionalProperties: false,
    },
  },
  {
    name: "monthly_history",
    description: "Revenus, dépenses et épargne mois par mois sur les N derniers mois (tendance de la situation financière).",
    input_schema: { type: "object", properties: { months: { type: "integer", minimum: 1, maximum: 24 } }, required: ["months"], additionalProperties: false },
  },
  {
    name: "search_transactions",
    description: "Recherche des opérations (30 maximum) par texte, catégorie, type et période.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        kind: { type: "string", enum: ["expense", "income", "transfer", "refund", "adjustment"] },
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_budgets",
    description: "État de tous les budgets actifs : montant, consommé, restant, pourcentage, jours restants.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_goals",
    description: "Objectifs d'épargne : progression, reste à épargner, versement mensuel recommandé, date estimée.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_subscriptions",
    description: "Abonnements et charges récurrentes : coût mensuel/annuel, prochaines échéances, abonnements potentiellement redondants ou oubliés.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_insights",
    description: "Analyses automatiques : catégories en hausse, dépenses inhabituelles, jours où l'utilisateur dépense le plus, recommandations d'économies chiffrées.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "simulate_purchase",
    description: "Simule l'impact d'un achat sur le solde disponible, les engagements du mois, le coussin de sécurité et le budget de la catégorie.",
    input_schema: {
      type: "object",
      properties: { price_euros: { type: "number", exclusiveMinimum: 0 }, category: { type: "string" } },
      required: ["price_euros"],
      additionalProperties: false,
    },
  },
  {
    name: "savings_plan",
    description: "Calcule le versement mensuel nécessaire pour atteindre un montant en N mois, et l'économie cumulée d'une réduction mensuelle de dépenses.",
    input_schema: {
      type: "object",
      properties: {
        target_euros: { type: "number", exclusiveMinimum: 0 },
        months: { type: "integer", minimum: 1, maximum: 600 },
        already_saved_euros: { type: "number", minimum: 0 },
      },
      required: ["target_euros", "months"],
      additionalProperties: false,
    },
  },
  {
    name: "forecast",
    description: "Prévision du solde disponible à N jours (scénarios prudent/normal/optimiste, marge d'incertitude, hypothèses).",
    input_schema: { type: "object", properties: { days: { type: "integer", minimum: 7, maximum: 365 } }, required: ["days"], additionalProperties: false },
  },
  {
    name: "propose_transaction",
    description: "Prépare une dépense ou un revenu à enregistrer. N'ENREGISTRE RIEN : l'utilisateur verra une carte de confirmation et devra valider lui-même. À utiliser uniquement si l'utilisateur demande explicitement d'ajouter une opération.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["expense", "income"] },
        amount_euros: { type: "number", exclusiveMinimum: 0 },
        account: { type: "string", description: "Nom du compte (sinon le premier compte courant)" },
        category: { type: "string" },
        date: { type: "string", description: "AAAA-MM-JJ (par défaut aujourd'hui)" },
        description: { type: "string" },
      },
      required: ["kind", "amount_euros", "description"],
      additionalProperties: false,
    },
  },
];

function resolvePreset(preset: string, today: ISODate, from?: string, to?: string): { from: ISODate; to: ISODate } | { error: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week":
      return { from: startOfWeek(today), to: today };
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const f = startOfMonth(addMonths(today, -1));
      return { from: f, to: endOfMonth(f) };
    }
    case "last_3_months":
    case "last_6_months":
    case "last_12_months": {
      const n = Number(preset.split("_")[1]);
      const f = startOfMonth(addMonths(today, -n));
      return { from: f, to: addDays(startOfMonth(today), -1) };
    }
    case "this_year":
      return { from: startOfYear(today), to: today };
    case "last_year": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      if (!from || !to || !isValidISODate(from) || !isValidISODate(to) || from > to) return { error: "Dates invalides : utiliser AAAA-MM-JJ avec from <= to." };
      return { from, to: to > today ? today : to };
  }
}

function findCategoryId(fin: Finance, name?: string): string | null | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const exact = fin.categories.find((c) => norm(c.name) === n);
  if (exact) return exact.id;
  const partial = fin.categories.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name)));
  return partial ? partial.id : null;
}

export async function runTool(name: string, input: Record<string, unknown>, fin: Finance, today: ISODate, settings: UserSettings, proposals: Proposal[]): Promise<unknown> {
  const accName = new Map(fin.accounts.map((a) => [a.id, a.name]));
  switch (name) {
    case "get_overview": {
      const ov = computeOverview(fin, today, settings);
      const a = ov.available;
      return {
        date_du_jour: formatDateFR(today),
        comptes: fin.summary.byAccount.filter((x) => !x.archived).map((x) => ({ nom: x.name, type: x.type, solde: eur(x.balance) })),
        solde_disponible_comptes_courants_et_especes: eur(fin.summary.available),
        epargne_livrets: eur(fin.summary.savings),
        investissements: eur(fin.summary.investments),
        patrimoine_financier_total: eur(fin.summary.totalFinancial),
        mois_en_cours: {
          revenus_encaisses: eur(ov.month.income),
          depenses_nettes: eur(ov.month.netExpenses),
          remboursements: eur(ov.month.refunds),
          epargne_nette: eur(ov.month.netSavings),
          taux_epargne: formatPct(ov.month.savingsRate),
          reste_a_vivre: eur(ov.resteAVivre),
        },
        disponible:
          a.status === "ok"
            ? {
                charges_fixes_restantes: eur(a.pendingFixedCharges),
                depenses_prevues: eur(a.plannedExpenses),
                versements_epargne_prevus: eur(a.plannedSavingsTransfers),
                epargne_a_preserver: eur(a.savingsToPreserve),
                coussin_securite: eur(a.safetyCushion),
                depensable_jusqu_a_fin_du_mois: eur(a.spendableUntilMonthEnd),
                budget_quotidien_recommande: eur(a.recommendedDaily),
                jours_restants: a.daysLeft,
                revenus_attendus_non_encaisses: eur(a.expectedIncome),
                prochain_revenu: a.nextIncome ? { date: formatDateFR(a.nextIncome.date), montant: eur(a.nextIncome.amount), libelle: a.nextIncome.label } : "inconnu",
              }
            : { indisponible: a.reason },
        nombre_operations_total: fin.txs.length,
        premiere_operation: fin.txs[0]?.date ? formatDateFR(fin.txs[0].date) : "aucune",
      };
    }
    case "get_period_stats": {
      const r = resolvePreset(String(input.preset), today, input.from as string, input.to as string);
      if ("error" in r) return r;
      const catId = findCategoryId(fin, input.category as string | undefined);
      if (catId === null) return { error: `Catégorie « ${input.category} » introuvable. Catégories : ${fin.categories.map((c) => c.name).join(", ")}` };
      const txs = catId ? fin.txs.filter((t) => t.categoryId === catId || fin.cmap.get(t.categoryId ?? "")?.parentId === catId) : fin.txs;
      const p = periodTotals(txs, r.from, r.to, fin.cmap);
      return {
        periode: `${formatDateFR(r.from)} → ${formatDateFR(r.to)} (${p.days} jours)`,
        filtre_categorie: input.category ?? null,
        revenus_encaisses: eur(p.income),
        depenses_brutes: eur(p.grossExpenses),
        remboursements: eur(p.refunds),
        depenses_nettes: eur(p.netExpenses),
        epargne_nette: eur(p.netSavings),
        taux_epargne: formatPct(p.savingsRate),
        depenses_fixes: eur(p.fixedExpenses),
        depenses_variables: eur(p.variableExpenses),
        moyenne_quotidienne_depenses: eur(p.dailyAverageExpense),
        nombre_depenses: p.expenseCount,
        par_categorie: expensesByCategory(txs, r.from, r.to, fin.cmap).slice(0, 12).map((c) => ({ categorie: c.name, montant: eur(c.amount), part: formatPct(c.share), operations: c.count })),
        revenus_par_categorie: incomeByCategory(txs, r.from, r.to, fin.cmap).map((c) => ({ categorie: c.name, montant: eur(c.amount) })),
        plus_grosses_depenses: topExpenses(txs, r.from, r.to, 5).map((t) => ({ date: formatDateFR(t.date), libelle: t.merchant || t.description, montant: eur(t.amount), categorie: t.categoryId ? fin.cmap.get(t.categoryId)?.name : null })),
      };
    }
    case "compare_periods": {
      const r = resolvePreset(String(input.preset), today, input.from as string, input.to as string);
      if ("error" in r) return r;
      const prev = comparablePreviousPeriod(r.from, r.to);
      const cur = periodTotals(fin.txs, r.from, r.to, fin.cmap);
      const before = periodTotals(fin.txs, prev.from, prev.to, fin.cmap);
      const trends = categoryTrends(fin.txs, r.from, r.to, fin.cmap);
      return {
        periode: `${formatDateFR(r.from)} → ${formatDateFR(r.to)}`,
        periode_comparable: `${formatDateFR(prev.from)} → ${formatDateFR(prev.to)}`,
        revenus: { actuel: eur(cur.income), precedent: eur(before.income) },
        depenses_nettes: { actuel: eur(cur.netExpenses), precedent: eur(before.netExpenses) },
        epargne_nette: { actuel: eur(cur.netSavings), precedent: eur(before.netSavings) },
        taux_epargne: { actuel: formatPct(cur.savingsRate), precedent: formatPct(before.savingsRate) },
        variations_par_categorie: trends.slice(0, 12).map((t) => ({ categorie: t.name, actuel: eur(t.current), precedent: eur(t.previous), variation: formatPct(t.change, 0, true) })),
      };
    }
    case "monthly_history": {
      const n = Math.min(24, Math.max(1, Number(input.months) || 6));
      const series = monthlySeries(fin.txs, startOfMonth(addMonths(today, -(n - 1))), today);
      return series.map((m) => ({ mois: m.month, revenus: eur(m.income), depenses_nettes: eur(m.expenses), epargne: eur(m.savings), taux_epargne: formatPct(m.savingsRate), mois_en_cours: m.month === today.slice(0, 7) }));
    }
    case "search_transactions": {
      const catId = findCategoryId(fin, input.category as string | undefined);
      const q = (input.query as string | undefined)?.toLowerCase();
      const limit = Math.min(30, Number(input.limit) || 15);
      const list = fin.txs
        .filter((t) => (!input.kind || t.kind === input.kind) && (!input.from || t.date >= (input.from as string)) && (!input.to || t.date <= (input.to as string)))
        .filter((t) => !catId || t.categoryId === catId || fin.cmap.get(t.categoryId ?? "")?.parentId === catId)
        .filter((t) => !q || `${t.description ?? ""} ${t.merchant ?? ""}`.toLowerCase().includes(q))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return {
        total_trouve: list.length,
        operations: list.slice(0, limit).map((t) => ({
          date: formatDateFR(t.date),
          type: t.kind,
          statut: t.status,
          montant: eur(t.amount),
          libelle: t.merchant || t.description,
          categorie: t.categoryId ? fin.cmap.get(t.categoryId)?.name : null,
          compte: accName.get(t.accountId),
        })),
      };
    }
    case "get_budgets": {
      const ov = computeOverview(fin, today, settings);
      if (!ov.budgets.length) return { budgets: [], note: "Aucun budget défini." };
      return ov.budgets.map((b) => ({ budget: b.budget.name, periode: `${formatDateFR(b.from)} → ${formatDateFR(b.to)}`, montant: eur(b.effectiveAmount), report: eur(b.carryOver), consomme: eur(b.spent), restant: eur(b.remaining), utilise: formatPct(b.ratio, 0), jours_restants: b.daysLeft, projection_fin_periode: eur(b.projectedSpend) }));
    }
    case "get_goals": {
      if (!fin.goals.length) return { objectifs: [], note: "Aucun objectif d'épargne." };
      return fin.goals.map((g) => {
        const p = goalProgress(g, fin.contributions, today);
        return { objectif: g.name, cible: eur(g.targetAmount), epargne: eur(p.saved), restant: eur(p.remaining), progression: formatPct(p.progress, 0), echeance: g.deadline ? formatDateFR(g.deadline) : "aucune", versement_mensuel_recommande: eur(p.recommendedMonthly), moyenne_mensuelle_3_mois: eur(p.averageMonthly), date_estimee: p.estimatedDate ? formatDateFR(p.estimatedDate) : "inconnue", statut: GOAL_STATE_LABEL[p.state] };
      });
    }
    case "get_subscriptions": {
      const totals = subscriptionTotals(fin.rules);
      const all = subscriptionTotals(fin.rules, false);
      const reviewed = new Map(fin.ruleRows.map((r) => [r.id, r.lastReviewedAt]));
      const findings = reviewSubscriptions(fin.rules, reviewed, detectRecurringPayments(fin.txs, fin.rules, today), fin.cmap, today);
      return {
        abonnements_mensuel: eur(totals.monthly),
        abonnements_annuel: eur(totals.annual),
        toutes_charges_recurrentes_mensuel: eur(all.monthly),
        liste: fin.rules.map((r) => ({ nom: r.name, type: r.kind, montant: eur(r.amount), frequence: FREQUENCY_LABELS[r.frequency], cout_mensuel: eur(monthlyEquivalent(r.amount, r.frequency)), abonnement: r.isSubscription, statut: r.status, prochaine_echeance: r.status === "active" ? formatDateFR(nextOccurrence(r, today)) : null })),
        points_a_verifier: findings.map((f) => ({ type: f.type, titre: f.title, detail: f.detail })),
      };
    }
    case "get_insights": {
      const from = startOfMonth(today);
      const recos = recommendations({ txs: fin.txs, cats: fin.cmap, today, rules: fin.rules });
      const weekdays = spendingByWeekday(fin.txs, addDays(today, -89), today);
      const avg = averageMonthlyExpenses(fin.txs, today, 3);
      return {
        moyenne_mensuelle_depenses_3_mois: eur(avg),
        categories_en_variation_ce_mois: categoryTrends(fin.txs, from, today, fin.cmap).slice(0, 8).map((t) => ({ categorie: t.name, ce_mois: eur(t.current), meme_periode_mois_precedent: eur(t.previous), moyenne_3_mois: eur(t.average3), variation: formatPct(t.change, 0, true) })),
        depenses_inhabituelles_90_jours: unusualExpenses(fin.txs, addDays(today, -90), today, fin.cmap).slice(0, 5).map((u) => ({ date: formatDateFR(u.tx.date), libelle: u.tx.merchant || u.tx.description, explication: u.reason })),
        depense_moyenne_par_jour_de_semaine_90j: weekdays.map((w) => ({ jour: weekdayName(w.weekday), moyenne: eur(w.average) })),
        recommandations: recos.map((r) => ({ titre: r.title, detail: r.detail, impact_annuel: eur(r.annualImpact), base: r.evidence })),
      };
    }
    case "simulate_purchase": {
      const price = Math.round(Number(input.price_euros) * 100);
      const ov = computeOverview(fin, today, settings);
      const catId = findCategoryId(fin, input.category as string | undefined);
      const budget = catId ? ov.budgets.find((b) => b.budget.categoryId === catId) ?? null : null;
      const series = monthlySeries(fin.txs, startOfMonth(addMonths(today, -3)), addDays(startOfMonth(today), -1));
      const avgSavings = series.length ? Math.round(series.reduce((s, m) => s + m.savings, 0) / series.length) : null;
      const sim = simulatePurchase({ price, available: ov.available, budget, averageMonthlySavings: avgSavings });
      return { prix: eur(price), verdict: PURCHASE_VERDICT[sim.verdict].label, solde_disponible_avant: eur(sim.availableBefore), solde_disponible_apres: eur(sim.availableAfter), depensable_fin_de_mois_apres: eur(sim.spendableAfter), coussin_securite_preserve: sim.cushionIntact, impact_budget: sim.budgetImpact ? { budget: sim.budgetImpact.name, restant_apres: eur(sim.budgetImpact.remainingAfter) } : null, epargne_moyenne_mensuelle_3_mois: eur(avgSavings), explications: sim.explanation };
    }
    case "savings_plan": {
      const target = Math.round(Number(input.target_euros) * 100);
      const months = Number(input.months);
      const current = Math.round(Number(input.already_saved_euros ?? 0) * 100);
      const plan = savingsPlan(target, months, current);
      const series = monthlySeries(fin.txs, startOfMonth(addMonths(today, -3)), addDays(startOfMonth(today), -1));
      const avgSavings = series.length ? Math.round(series.reduce((s, m) => s + m.savings, 0) / series.length) : null;
      const top = expensesByCategory(fin.txs, startOfMonth(addMonths(today, -3)), addDays(startOfMonth(today), -1), fin.cmap)
        .filter((c) => c.categoryId && !fin.cmap.get(c.categoryId)?.isFixed)
        .slice(0, 4)
        .map((c) => ({ categorie: c.name, moyenne_mensuelle: eur(Math.round(c.amount / 3)), reduction_20_pourcent_par_mois: eur(Math.round(c.amount / 15)) }));
      return { objectif: eur(target), duree_mois: months, deja_epargne: eur(current), versement_mensuel_necessaire: eur(plan?.monthly ?? null), epargne_moyenne_actuelle_par_mois_3_derniers_mois: eur(avgSavings), plus_gros_postes_variables: top };
    }
    case "forecast": {
      const days = Math.min(365, Math.max(7, Number(input.days) || 30));
      const f = computeForecast(fin, today, days);
      const end = f.points[f.points.length - 1];
      return {
        horizon_jours: days,
        fiabilite: f.reliability,
        solde_disponible_actuel: eur(f.startBalance),
        solde_prevu: { prudent: eur(end.prudent), normal: eur(end.normal), optimiste: eur(end.optimistic), fourchette_80_pourcent: [eur(end.low), eur(end.high)] },
        point_bas_scenario_normal: { date: formatDateFR(f.lowestNormal.date), solde: eur(f.lowestNormal.balance) },
        passage_negatif_prudent: f.firstNegativePrudent ? formatDateFR(f.firstNegativePrudent) : "non",
        hypotheses: f.assumptions,
        scenarios: Object.values(SCENARIOS).map((s) => `${s.label} : ${s.description}`),
      };
    }
    case "propose_transaction": {
      const amount = Math.round(Number(input.amount_euros) * 100);
      if (!Number.isFinite(amount) || amount <= 0) return { error: "Montant invalide" };
      const accName2 = (input.account as string | undefined)?.toLowerCase();
      const active = fin.accounts.filter((a) => !a.archived);
      const acc = (accName2 && active.find((a) => a.name.toLowerCase().includes(accName2))) || active.find((a) => a.type === "checking") || active[0];
      if (!acc) return { error: "Aucun compte : l'utilisateur doit d'abord créer un compte." };
      const catId = findCategoryId(fin, input.category as string | undefined) ?? null;
      const date = typeof input.date === "string" && isValidISODate(input.date) ? input.date : today;
      const p: Proposal = { kind: input.kind === "income" ? "income" : "expense", amount, accountId: acc.id, accountName: acc.name, categoryId: catId, categoryName: catId ? fin.cmap.get(catId)?.name ?? null : null, date, description: String(input.description).slice(0, 200) };
      proposals.push(p);
      return { statut: "proposition affichée à l'utilisateur, NON enregistrée", details: { ...p, amount: eur(amount), date: formatDateFR(date) }, consigne: "Dis à l'utilisateur de vérifier puis de confirmer avec le bouton affiché." };
    }
    default:
      return { error: `Outil inconnu : ${name}` };
  }
}
