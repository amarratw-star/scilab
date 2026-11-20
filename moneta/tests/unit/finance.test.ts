import { describe, expect, it } from "vitest";
import { accountDelta, balanceHistory, computeBalances, scopeDelta, summarizeBalances } from "@/lib/finance/ledger";
import { comparablePreviousPeriod, expensesByCategory, monthlySeries, periodTotals, spendingByWeekday } from "@/lib/finance/stats";
import { annualEquivalent, monthlyEquivalent, occurrences, scheduledItems, subscriptionTotals } from "@/lib/finance/recurring";
import { budgetWindow, evaluateBudget } from "@/lib/finance/budgets";
import { goalProgress, monthlyNeeded } from "@/lib/finance/goals";
import { computeAvailable } from "@/lib/finance/available";
import { forecast } from "@/lib/finance/forecast";
import { detectRecurringPayments, monthSummary, normalizeLabel, unusualExpenses } from "@/lib/finance/insights";
import { incomeChangeImpact, savingsPlan, simulatePurchase } from "@/lib/finance/simulate";
import { netWorth } from "@/lib/finance/wealth";
import { categoryMap, type BudgetRule, type CategoryInfo, type LedgerAccount, type LedgerTx, type RecurringRule } from "@/lib/finance/types";

let seq = 0;
const tx = (p: Partial<LedgerTx> & Pick<LedgerTx, "kind" | "amount" | "date">): LedgerTx => ({
  id: `t${++seq}`,
  status: "posted",
  accountId: "chk",
  toAccountId: null,
  categoryId: null,
  ...p,
});

const accounts: LedgerAccount[] = [
  { id: "chk", name: "Courant", type: "checking", initialBalance: 100000, openedOn: "2026-01-01", archived: false },
  { id: "sav", name: "Livret A", type: "savings", initialBalance: 500000, openedOn: "2026-01-01", archived: false },
  { id: "cash", name: "Espèces", type: "cash", initialBalance: 5000, openedOn: "2026-01-01", archived: false },
  { id: "old", name: "Ancien", type: "checking", initialBalance: 7000, openedOn: "2025-01-01", archived: true },
];

const cats: CategoryInfo[] = [
  { id: "food", name: "Courses alimentaires", kind: "expense", parentId: null, isFixed: false },
  { id: "resto", name: "Restaurants", kind: "expense", parentId: null, isFixed: false },
  { id: "resto-sub", name: "Fast-food", kind: "expense", parentId: "resto", isFixed: false },
  { id: "rent", name: "Logement", kind: "expense", parentId: null, isFixed: true },
  { id: "salary", name: "Salaire", kind: "income", parentId: null, isFixed: false },
];
const cmap = categoryMap(cats);

describe("grand livre et soldes", () => {
  it("applique dépenses, revenus, remboursements et ajustements", () => {
    const txs = [
      tx({ kind: "expense", amount: 2500, date: "2026-03-01" }),
      tx({ kind: "income", amount: 200000, date: "2026-03-02" }),
      tx({ kind: "refund", amount: 1000, date: "2026-03-03" }),
      tx({ kind: "adjustment", amount: -150, date: "2026-03-04" }),
    ];
    const b = computeBalances(accounts, txs);
    expect(b.get("chk")).toBe(100000 - 2500 + 200000 + 1000 - 150);
  });

  it("un transfert diminue un compte, augmente l'autre et laisse le total inchangé", () => {
    const t = tx({ kind: "transfer", amount: 30000, date: "2026-03-05", toAccountId: "sav" });
    const b = computeBalances(accounts, [t]);
    expect(b.get("chk")).toBe(70000);
    expect(b.get("sav")).toBe(530000);
    const before = summarizeBalances(accounts, computeBalances(accounts, []));
    const after = summarizeBalances(accounts, b);
    expect(after.totalFinancial).toBe(before.totalFinancial);
    expect(after.available).toBe(before.available - 30000);
    expect(accountDelta(t, "chk")).toBe(-30000);
    expect(accountDelta(t, "sav")).toBe(30000);
  });

  it("ignore les opérations prévues et annulées", () => {
    const txs = [
      tx({ kind: "expense", amount: 9999, date: "2026-03-01", status: "planned" }),
      tx({ kind: "income", amount: 9999, date: "2026-03-01", status: "cancelled" }),
    ];
    expect(computeBalances(accounts, txs).get("chk")).toBe(100000);
  });

  it("exclut les comptes archivés des totaux", () => {
    const s = summarizeBalances(accounts, computeBalances(accounts, []));
    expect(s.totalFinancial).toBe(100000 + 500000 + 5000);
    expect(s.available).toBe(105000);
    expect(s.savings).toBe(500000);
  });

  it("reste cohérent après suppression d'une opération", () => {
    const a = tx({ kind: "expense", amount: 1000, date: "2026-03-01" });
    const b = tx({ kind: "expense", amount: 2000, date: "2026-03-02" });
    expect(computeBalances(accounts, [a, b]).get("chk")).toBe(97000);
    expect(computeBalances(accounts, [b]).get("chk")).toBe(98000);
  });

  it("historique de solde jour par jour", () => {
    const txs = [tx({ kind: "expense", amount: 1000, date: "2026-02-27" }), tx({ kind: "income", amount: 5000, date: "2026-03-01" })];
    const h = balanceHistory(accounts, txs, "2026-02-28", "2026-03-01", new Set(["chk"]));
    expect(h).toEqual([
      { date: "2026-02-28", balance: 99000 },
      { date: "2026-03-01", balance: 104000 },
    ]);
  });

  it("scopeDelta : transfert interne au périmètre = 0", () => {
    const t = tx({ kind: "transfer", amount: 500, date: "2026-03-01", toAccountId: "cash" });
    expect(scopeDelta(t, new Set(["chk", "cash"]))).toBe(0);
    expect(scopeDelta(t, new Set(["chk"]))).toBe(-500);
  });
});

describe("statistiques de période", () => {
  const txs = [
    tx({ kind: "income", amount: 200000, date: "2026-03-01", categoryId: "salary" }),
    tx({ kind: "expense", amount: 80000, date: "2026-03-02", categoryId: "rent" }),
    tx({ kind: "expense", amount: 15000, date: "2026-03-03", categoryId: "food" }),
    tx({ kind: "expense", amount: 5000, date: "2026-03-04", categoryId: "resto-sub" }),
    tx({ kind: "refund", amount: 2000, date: "2026-03-05", categoryId: "food" }),
    tx({ kind: "transfer", amount: 50000, date: "2026-03-06", toAccountId: "sav" }),
    tx({ kind: "adjustment", amount: 300, date: "2026-03-07" }),
    tx({ kind: "expense", amount: 99900, date: "2026-03-08", status: "cancelled" }),
    tx({ kind: "income", amount: 99900, date: "2026-03-09", status: "planned" }),
  ];
  const p = periodTotals(txs, "2026-03-01", "2026-03-31", cmap);

  it("distingue revenus, dépenses brutes/nettes, épargne", () => {
    expect(p.income).toBe(200000);
    expect(p.grossExpenses).toBe(100000);
    expect(p.refunds).toBe(2000);
    expect(p.netExpenses).toBe(98000);
    expect(p.netSavings).toBe(102000);
    expect(p.savingsRate).toBeCloseTo(0.51);
  });

  it("le versement vers l'épargne n'est ni une dépense ni un revenu", () => {
    expect(p.transfers).toBe(50000);
    expect(p.grossExpenses).toBe(100000);
  });

  it("dépenses fixes vs variables", () => {
    expect(p.fixedExpenses).toBe(80000);
    expect(p.variableExpenses).toBe(20000);
  });

  it("taux d'épargne indisponible sans revenu (division par zéro)", () => {
    const q = periodTotals([tx({ kind: "expense", amount: 100, date: "2026-03-01" })], "2026-03-01", "2026-03-31");
    expect(q.savingsRate).toBeNull();
    const empty = periodTotals([], "2026-03-01", "2026-03-31");
    expect(empty.savingsRate).toBeNull();
    expect(empty.dailyAverageExpense).toBe(0);
  });

  it("répartition par catégorie avec regroupement des sous-catégories et remboursements", () => {
    const rows = expensesByCategory(txs, "2026-03-01", "2026-03-31", cmap);
    const food = rows.find((r) => r.categoryId === "food")!;
    const resto = rows.find((r) => r.categoryId === "resto")!;
    expect(food.amount).toBe(13000);
    expect(resto.amount).toBe(5000);
    expect(rows[0].categoryId).toBe("rent");
    const totalShare = rows.reduce((s, r) => s + (r.share ?? 0), 0);
    expect(totalShare).toBeCloseTo(1);
  });

  it("série mensuelle", () => {
    const s = monthlySeries(txs, "2026-02-01", "2026-03-31");
    expect(s.map((x) => x.month)).toEqual(["2026-02", "2026-03"]);
    expect(s[0].savingsRate).toBeNull();
    expect(s[1].expenses).toBe(98000);
  });

  it("dépenses par jour de semaine (lundi = 0)", () => {
    // 2026-03-02 est un lundi
    const w = spendingByWeekday(txs, "2026-03-02", "2026-03-08");
    expect(w[0].total).toBe(80000);
  });
});

describe("périodes comparables", () => {
  it("mois en cours jusqu'au 20 -> 1er au 20 du mois précédent", () => {
    expect(comparablePreviousPeriod("2026-11-01", "2026-11-20")).toEqual({ from: "2026-10-01", to: "2026-10-20" });
  });
  it("31 mars en cours -> borné à la fin février (année bissextile)", () => {
    expect(comparablePreviousPeriod("2028-03-01", "2028-03-30")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(comparablePreviousPeriod("2027-03-01", "2027-03-30")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });
  it("mois complet -> mois complet précédent", () => {
    expect(comparablePreviousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("janvier -> décembre de l'année précédente (changement d'année)", () => {
    expect(comparablePreviousPeriod("2027-01-01", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-15" });
  });
  it("année en cours -> même période l'an dernier, 29/02 géré", () => {
    expect(comparablePreviousPeriod("2028-01-01", "2028-02-29")).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });
  it("trois mois complets -> trois mois précédents", () => {
    expect(comparablePreviousPeriod("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
  it("période libre -> même durée juste avant", () => {
    expect(comparablePreviousPeriod("2026-03-10", "2026-03-16")).toEqual({ from: "2026-03-03", to: "2026-03-09" });
  });
});

describe("récurrences", () => {
  const rule: RecurringRule = {
    id: "r1",
    name: "Loyer",
    kind: "expense",
    amount: 80000,
    frequency: "monthly",
    startDate: "2026-01-31",
    endDate: null,
    accountId: "chk",
    toAccountId: null,
    categoryId: "rent",
    status: "active",
    isSubscription: false,
  };
  it("échéances mensuelles le 31 bornées au dernier jour du mois", () => {
    expect(occurrences(rule, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences({ ...rule, startDate: "2028-01-31" }, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });
  it("respecte la date de fin et le statut", () => {
    expect(occurrences({ ...rule, endDate: "2026-02-28" }, "2026-01-01", "2026-12-31")).toHaveLength(2);
    expect(occurrences({ ...rule, status: "paused" }, "2026-01-01", "2026-12-31")).toHaveLength(0);
  });
  it("hebdomadaire et trimestrielle", () => {
    expect(occurrences({ ...rule, frequency: "weekly", startDate: "2026-03-02" }, "2026-03-10", "2026-03-31")).toEqual(["2026-03-16", "2026-03-23", "2026-03-30"]);
    expect(occurrences({ ...rule, frequency: "quarterly", startDate: "2026-01-15" }, "2026-01-01", "2026-12-31")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  });
  it("saut rapide sur une longue période sans perdre d'échéance", () => {
    expect(occurrences({ ...rule, startDate: "2020-05-10" }, "2026-03-01", "2026-03-31")).toEqual(["2026-03-10"]);
  });
  it("équivalents mensuels et annuels", () => {
    expect(monthlyEquivalent(1200, "weekly")).toBe(5200);
    expect(monthlyEquivalent(12000, "yearly")).toBe(1000);
    expect(annualEquivalent(999, "monthly")).toBe(11988);
    expect(subscriptionTotals([{ ...rule, isSubscription: true, amount: 1399 }]).annual).toBe(16788);
  });
  it("échéances réalisées via recurring_id + occurrence_date", () => {
    const paid = tx({ kind: "expense", amount: 80000, date: "2026-02-27", recurringId: "r1", occurrenceDate: "2026-02-28" });
    const items = scheduledItems([rule], [paid], "2026-02-01", "2026-03-31");
    expect(items.map((i) => i.realized)).toEqual([true, false]);
  });
});

describe("budgets", () => {
  const b: BudgetRule = {
    id: "b1",
    name: "Restaurants",
    categoryId: "resto",
    period: "monthly",
    amount: 15000,
    startDate: null,
    endDate: null,
    rollover: false,
    alertThresholds: [50, 75, 90, 100],
    active: true,
  };
  const txs = [
    tx({ kind: "expense", amount: 6000, date: "2026-03-03", categoryId: "resto" }),
    tx({ kind: "expense", amount: 6000, date: "2026-03-10", categoryId: "resto-sub" }),
    tx({ kind: "refund", amount: 500, date: "2026-03-11", categoryId: "resto" }),
    tx({ kind: "expense", amount: 9000, date: "2026-03-12", categoryId: "food" }),
    tx({ kind: "expense", amount: 4000, date: "2026-02-10", categoryId: "resto" }),
  ];
  it("consommation incluant les sous-catégories et remboursements", () => {
    const s = evaluateBudget(b, txs, cmap, "2026-03-15");
    expect(s.spent).toBe(11500);
    expect(s.remaining).toBe(3500);
    expect(s.reachedThreshold).toBe(75);
    expect(s.level).toBe("warning");
    expect(s.daysLeft).toBe(17);
  });
  it("dépassement", () => {
    const s = evaluateBudget({ ...b, amount: 10000 }, txs, cmap, "2026-03-15");
    expect(s.level).toBe("exceeded");
    expect(s.remaining).toBe(-1500);
    expect(s.dailyRemaining).toBe(0);
  });
  it("report du reliquat du mois précédent", () => {
    const s = evaluateBudget({ ...b, rollover: true }, txs, cmap, "2026-03-15");
    expect(s.carryOver).toBe(11000);
    expect(s.effectiveAmount).toBe(26000);
  });
  it("pas de report avant la création du budget", () => {
    const s = evaluateBudget({ ...b, rollover: true, createdOn: "2026-03-01" }, txs, cmap, "2026-03-15");
    expect(s.carryOver).toBe(0);
  });
  it("budget global et hebdomadaire", () => {
    const g = evaluateBudget({ ...b, categoryId: null, amount: 100000 }, txs, cmap, "2026-03-15");
    expect(g.spent).toBe(20500);
    expect(budgetWindow({ ...b, period: "weekly" }, "2026-03-15")).toEqual({ from: "2026-03-09", to: "2026-03-15" });
  });
});

describe("objectifs d'épargne", () => {
  const goal = { id: "g1", name: "Voyage", targetAmount: 300000, startDate: "2026-01-01", deadline: "2026-12-31", priority: 2 };
  it("progression, reste et versement recommandé", () => {
    const p = goalProgress(goal, [{ goalId: "g1", amount: 100000, date: "2026-02-01" }, { goalId: "g1", amount: -10000, date: "2026-03-01" }], "2026-06-30");
    expect(p.saved).toBe(90000);
    expect(p.remaining).toBe(210000);
    expect(p.recommendedMonthly).toBe(35000);
    expect(p.state).toBe("behind");
  });
  it("objectif atteint", () => {
    const p = goalProgress(goal, [{ goalId: "g1", amount: 300000, date: "2026-02-01" }], "2026-03-01");
    expect(p.state).toBe("reached");
    expect(p.progress).toBe(1);
  });
  it("calcul mensuel nécessaire", () => {
    expect(monthlyNeeded(300000, 12)).toBe(25000);
    expect(monthlyNeeded(300000, 0)).toBeNull();
  });
});

describe("combien puis-je dépenser ?", () => {
  const rules: RecurringRule[] = [
    { id: "rent", name: "Loyer", kind: "expense", amount: 60000, frequency: "monthly", startDate: "2026-01-25", endDate: null, accountId: "chk", toAccountId: null, categoryId: "rent", status: "active", isSubscription: false },
    { id: "sal", name: "Salaire", kind: "income", amount: 200000, frequency: "monthly", startDate: "2026-01-28", endDate: null, accountId: "chk", toAccountId: null, categoryId: "salary", status: "active", isSubscription: false },
    { id: "save", name: "Virement livret", kind: "transfer", amount: 20000, frequency: "monthly", startDate: "2026-01-29", endDate: null, accountId: "chk", toAccountId: "sav", categoryId: null, status: "active", isSubscription: false },
  ];
  it("calcule le disponible sans compter les revenus attendus", () => {
    const r = computeAvailable({
      today: "2026-03-20",
      accounts,
      balances: computeBalances(accounts, []),
      txs: [tx({ kind: "expense", amount: 5000, date: "2026-03-25", status: "planned" })],
      rules,
      safetyCushion: 10000,
      monthlySavingsTarget: 30000,
    });
    if (r.status !== "ok") throw new Error("attendu ok");
    expect(r.availableNow).toBe(105000);
    expect(r.pendingFixedCharges).toBe(60000);
    expect(r.plannedExpenses).toBe(5000);
    expect(r.plannedSavingsTransfers).toBe(20000);
    expect(r.savingsToPreserve).toBe(10000);
    expect(r.spendableUntilMonthEnd).toBe(105000 - 60000 - 5000 - 20000 - 10000 - 10000);
    expect(r.expectedIncome).toBe(200000);
    expect(r.nextIncome?.date).toBe("2026-03-28");
    expect(r.daysLeft).toBe(12);
    expect(r.dailyAllowance).toBe(Math.floor(0 / 12));
  });
  it("une échéance confirmée n'est plus comptée", () => {
    const paid = tx({ kind: "expense", amount: 60000, date: "2026-03-20", recurringId: "rent", occurrenceDate: "2026-03-25" });
    const r = computeAvailable({ today: "2026-03-20", accounts, balances: computeBalances(accounts, [paid]), txs: [paid], rules, safetyCushion: 0, monthlySavingsTarget: 0 });
    if (r.status !== "ok") throw new Error();
    expect(r.pendingFixedCharges).toBe(0);
    expect(r.availableNow).toBe(45000);
  });
  it("estimation indisponible sans compte courant", () => {
    const r = computeAvailable({ today: "2026-03-20", accounts: [accounts[1]], balances: new Map(), txs: [], rules: [], safetyCushion: 0, monthlySavingsTarget: 0 });
    expect(r.status).toBe("unavailable");
  });
  it("solde insuffisant -> avertissement et montant négatif", () => {
    const r = computeAvailable({ today: "2026-03-20", accounts, balances: new Map([["chk", 1000], ["cash", 0]]), txs: [], rules, safetyCushion: 0, monthlySavingsTarget: 0 });
    if (r.status !== "ok") throw new Error();
    expect(r.spendableUntilMonthEnd).toBeLessThan(0);
    expect(r.dailyAllowance).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("prévisions", () => {
  it("historique insuffisant : pas de dépenses variables projetées", () => {
    const f = forecast({ today: "2026-03-10", horizonDays: 30, startBalance: 100000, scope: new Set(["chk"]), txs: [tx({ kind: "expense", amount: 1000, date: "2026-03-09" })], rules: [] });
    expect(f.reliability).toBe("insufficient");
    expect(f.points[30].normal).toBe(100000);
  });
  it("projette les dépenses variables et les échéances", () => {
    const hist: LedgerTx[] = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      hist.push(tx({ kind: "expense", amount: 1000, date: d }));
    }
    const rule: RecurringRule = { id: "sal", name: "Salaire", kind: "income", amount: 200000, frequency: "monthly", startDate: "2026-01-28", endDate: null, accountId: "chk", toAccountId: null, categoryId: null, status: "active", isSubscription: false };
    const paid = [tx({ kind: "income", amount: 200000, date: "2026-03-28", recurringId: "sal", occurrenceDate: "2026-03-28" })];
    const f = forecast({ today: "2026-03-31", horizonDays: 30, startBalance: 100000, scope: new Set(["chk"]), txs: [...hist, ...paid], rules: [rule] });
    expect(f.reliability).toBe("good");
    // 30 jours à ~10 €/j (moyenne 90 j légèrement < 10 € à cause des jours sans dépense) + salaire du 28/04
    expect(f.points[30].normal).toBeGreaterThan(100000 + 200000 - 31000);
    expect(f.points[30].prudent).toBeLessThan(f.points[30].normal);
    expect(f.points[30].optimistic).toBeGreaterThanOrEqual(f.points[30].normal);
    expect(f.milestones.map((m) => m.days)).toEqual([7, 30]);
  });
});

describe("détections", () => {
  it("normalise les libellés bancaires", () => {
    expect(normalizeLabel("PRLV SEPA NETFLIX.COM 12/03")).toBe("netflix com");
    expect(normalizeLabel("CB CARREFOUR MARKET 0503")).toBe("carrefour market");
  });
  it("détecte un paiement mensuel répétitif", () => {
    const txs = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-04"].map((d) => tx({ kind: "expense", amount: 1399, date: d, description: `PRLV SPOTIFY ${d}` }));
    const c = detectRecurringPayments(txs, [], "2026-04-20");
    expect(c).toHaveLength(1);
    expect(c[0].frequency).toBe("monthly");
  });
  it("détecte une dépense inhabituelle", () => {
    const txs = [
      ...["2026-01-05", "2026-01-15", "2026-02-05", "2026-02-20", "2026-03-01"].map((d) => tx({ kind: "expense", amount: 2500, date: d, categoryId: "resto" })),
      tx({ kind: "expense", amount: 18000, date: "2026-03-10", categoryId: "resto" }),
    ];
    const u = unusualExpenses(txs, "2026-03-01", "2026-03-31", cmap);
    expect(u).toHaveLength(1);
    expect(u[0].tx.amount).toBe(18000);
  });
  it("résumé du mois sans données", () => {
    const s = monthSummary([], "2026-03-10", cmap);
    expect(s.hasData).toBe(false);
  });
  it("résumé du mois avec taux d'épargne", () => {
    const s = monthSummary([tx({ kind: "income", amount: 200000, date: "2026-03-01" }), tx({ kind: "expense", amount: 135000, date: "2026-03-02" })], "2026-03-10", cmap);
    expect(s.sentences[0]).toContain("32,5 %");
  });
});

describe("simulateur et patrimoine", () => {
  it("achat : verdict selon le coussin de sécurité", () => {
    const available = computeAvailable({ today: "2026-03-20", accounts, balances: computeBalances(accounts, []), txs: [], rules: [], safetyCushion: 50000, monthlySavingsTarget: 0 });
    expect(simulatePurchase({ price: 20000, available }).verdict).toBe("comfortable");
    expect(simulatePurchase({ price: 60000, available }).verdict).toBe("risky");
    expect(simulatePurchase({ price: 200000, available }).verdict).toBe("not_affordable");
  });
  it("plan d'épargne avec et sans rendement", () => {
    expect(savingsPlan(300000, 12)!.monthly).toBe(25000);
    expect(savingsPlan(300000, 12, 0, 0.03)!.monthly).toBeLessThan(25000);
    expect(savingsPlan(300000, 0)).toBeNull();
  });
  it("impact d'un changement de revenu", () => {
    const r = incomeChangeImpact({ monthlyIncome: 200000, monthlyExpenses: 150000, incomeDelta: 10000, newFixedCharge: 3000 });
    expect(r.savingsAfter).toBe(57000);
    expect(r.annualDifference).toBe(84000);
  });
  it("patrimoine net = actifs − passifs", () => {
    const nw = netWorth(100000, [
      { id: "a", kind: "asset", name: "Voiture", category: "vehicle", archived: false, valuations: [{ date: "2026-01-01", value: 800000, method: "estimated" }] },
      { id: "l", kind: "liability", name: "Prêt", category: "car_loan", archived: false, valuations: [{ date: "2026-01-01", value: 500000, method: "manual" }, { date: "2026-03-01", value: 450000, method: "manual" }] },
    ], "2026-03-15");
    expect(nw.gross).toBe(900000);
    expect(nw.net).toBe(450000);
    expect(nw.estimatedShare).toBe(1);
  });
});
