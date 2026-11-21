/** Non-régression des corrections de l'audit V2 + santé financière + opportunités d'économies. */
import { describe, expect, it } from "vitest";
import { computeAvailable } from "@/lib/finance/available";
import { computeBalances } from "@/lib/finance/ledger";
import { scheduledItems } from "@/lib/finance/recurring";
import { forecast } from "@/lib/finance/forecast";
import { healthScore, piecewise, levelFor } from "@/lib/finance/health";
import { savingsOpportunities } from "@/lib/finance/opportunities";
import { addDays } from "@/lib/dates";
import { categoryMap, type CategoryInfo, type LedgerAccount, type LedgerTx, type RecurringRule } from "@/lib/finance/types";

let n = 0;
const tx = (p: Partial<LedgerTx> & Pick<LedgerTx, "kind" | "amount" | "date">): LedgerTx => ({ id: `t${++n}`, status: "posted", accountId: "chk", toAccountId: null, categoryId: null, ...p });
const accounts: LedgerAccount[] = [
  { id: "chk", name: "Courant", type: "checking", initialBalance: 200000, openedOn: "2026-01-01", archived: false },
  { id: "sav", name: "Livret", type: "savings", initialBalance: 0, openedOn: "2026-01-01", archived: false },
];
const cats: CategoryInfo[] = [
  { id: "rent", name: "Loyer", kind: "expense", parentId: null, isFixed: true },
  { id: "food", name: "Courses", kind: "expense", parentId: null, isFixed: false },
  { id: "fast", name: "Fast-food", kind: "expense", parentId: null, isFixed: false },
  { id: "sal", name: "Salaire", kind: "income", parentId: null, isFixed: false },
];
const cmap = categoryMap(cats);
const rent: RecurringRule = { id: "r-rent", name: "Loyer", kind: "expense", amount: 70000, frequency: "monthly", startDate: "2026-01-05", endDate: null, accountId: "chk", toAccountId: null, categoryId: "rent", status: "active", isSubscription: false, merchant: "Agence Immo" };

describe("audit : pas de double déduction d'une échéance saisie à la main ou importée", () => {
  it("une opération non rattachée mais correspondante réalise l'échéance", () => {
    const manual = tx({ kind: "expense", amount: 70000, date: "2026-03-04", categoryId: "rent", description: "VIR LOYER MARS" });
    const items = scheduledItems([rent], [manual], "2026-03-01", "2026-03-31");
    expect(items[0].realized).toBe(true);
    expect(items[0].realizedBy).toBe("matched");
    const r = computeAvailable({ today: "2026-03-20", accounts, balances: computeBalances(accounts, [manual], "2026-03-20"), txs: [manual], rules: [rent], safetyCushion: 0, monthlySavingsTarget: 0 });
    if (r.status !== "ok") throw new Error();
    expect(r.availableNow).toBe(130000);
    expect(r.pendingFixedCharges).toBe(0); // et non 70 000 de plus
  });
  it("import CSV : reconnaissance par le libellé si aucune catégorie", () => {
    const imported = tx({ kind: "expense", amount: 70000, date: "2026-03-06", description: "PRLV AGENCE IMMO 03/26" });
    expect(scheduledItems([rent], [imported], "2026-03-01", "2026-03-31")[0].realized).toBe(true);
  });
  it("pas de correspondance abusive : montant trop différent, autre compte, date trop éloignée", () => {
    const tooFar = tx({ kind: "expense", amount: 70000, date: "2026-03-20", categoryId: "rent" });
    const otherAmount = tx({ kind: "expense", amount: 50000, date: "2026-03-05", categoryId: "rent" });
    const otherAccount = tx({ kind: "expense", amount: 70000, date: "2026-03-05", categoryId: "rent", accountId: "sav" });
    expect(scheduledItems([rent], [tooFar, otherAmount, otherAccount], "2026-03-01", "2026-03-31")[0].realized).toBe(false);
  });
  it("une opération ne réalise qu'une seule échéance", () => {
    const weekly: RecurringRule = { ...rent, id: "w", frequency: "weekly", amount: 1000, startDate: "2026-03-02", categoryId: "food" };
    const one = tx({ kind: "expense", amount: 1000, date: "2026-03-05", categoryId: "food" });
    const items = scheduledItems([weekly], [one], "2026-03-01", "2026-03-15");
    expect(items.filter((i) => i.realized)).toHaveLength(1);
  });
  it("une opération déjà rattachée à une autre récurrence n'est pas réutilisée", () => {
    const linked = tx({ kind: "expense", amount: 70000, date: "2026-03-05", categoryId: "rent", recurringId: "autre", occurrenceDate: "2026-03-05" });
    expect(scheduledItems([rent], [linked], "2026-03-01", "2026-03-31")[0].realized).toBe(false);
  });
});

describe("audit : opérations effectuées datées dans le futur", () => {
  const future = tx({ kind: "expense", amount: 12000, date: "2026-03-28", categoryId: "food" });
  it("ne touchent pas le solde réel d'aujourd'hui", () => {
    expect(computeBalances(accounts, [future], "2026-03-20").get("chk")).toBe(200000);
  });
  it("sont comptées une seule fois comme dépense à venir dans le disponible", () => {
    const r = computeAvailable({ today: "2026-03-20", accounts, balances: computeBalances(accounts, [future], "2026-03-20"), txs: [future], rules: [], safetyCushion: 0, monthlySavingsTarget: 0 });
    if (r.status !== "ok") throw new Error();
    expect(r.availableNow).toBe(200000);
    expect(r.plannedExpenses).toBe(12000);
    expect(r.spendableUntilMonthEnd).toBe(188000);
  });
  it("apparaissent dans la prévision à leur date", () => {
    const f = forecast({ today: "2026-03-20", horizonDays: 10, startBalance: 200000, scope: new Set(["chk"]), txs: [future], rules: [] });
    expect(f.points[7].scheduled).toBe(200000);
    expect(f.points[8].scheduled).toBe(188000);
  });
  it("un transfert futur vers l'épargne n'est pas compté à la fois comme épargné et comme prévu", () => {
    const t = tx({ kind: "transfer", amount: 20000, date: "2026-03-29", toAccountId: "sav" });
    const r = computeAvailable({ today: "2026-03-20", accounts, balances: computeBalances(accounts, [t], "2026-03-20"), txs: [t], rules: [], safetyCushion: 0, monthlySavingsTarget: 30000 });
    if (r.status !== "ok") throw new Error();
    expect(r.savedThisMonth).toBe(0);
    expect(r.plannedSavingsTransfers).toBe(20000);
    expect(r.savingsToPreserve).toBe(10000);
  });
});

describe("santé financière", () => {
  const history = (incomePerMonth: number, spendPerMonth: number) => {
    const out: LedgerTx[] = [];
    for (let m = 0; m < 6; m++) {
      const month = `2026-0${m + 1}`;
      out.push(tx({ kind: "income", amount: incomePerMonth, date: `${month}-01`, categoryId: "sal" }));
      out.push(tx({ kind: "expense", amount: Math.round(spendPerMonth * 0.4), date: `${month}-05`, categoryId: "rent" }));
      for (let d = 0; d < 6; d++) out.push(tx({ kind: "expense", amount: Math.round((spendPerMonth * 0.6) / 6), date: `${month}-${String(8 + d * 3).padStart(2, "0")}`, categoryId: "food" }));
    }
    return out;
  };
  it("interpolation et niveaux", () => {
    expect(piecewise(0.05, [[0, 30], [0.1, 70]])).toBe(50);
    expect(piecewise(-1, [[0, 30], [0.1, 70]])).toBe(30);
    expect(levelFor(82)).toBe("excellent");
    expect(levelFor(40)).toBe("fragile");
  });
  it("données insuffisantes : pas de note", () => {
    const r = healthScore({ today: "2026-01-20", accounts, txs: [tx({ kind: "expense", amount: 100, date: "2026-01-10" })], cats: cmap, rules: [], budgets: [] });
    expect(r.status).toBe("insufficient");
    expect(r.score).toBeNull();
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("indépendante du niveau de revenu : mêmes ratios → même note", () => {
    const low = healthScore({ today: "2026-06-20", accounts: accounts.map((a) => ({ ...a, initialBalance: a.initialBalance / 10 })), txs: history(120000, 96000), cats: cmap, rules: [], budgets: [] });
    const high = healthScore({ today: "2026-06-20", accounts, txs: history(1200000, 960000), cats: cmap, rules: [], budgets: [] });
    expect(low.status).toBe("ok");
    expect(high.score).not.toBeNull();
    const pick = (r: typeof low, k: string) => r.criteria.find((c) => c.key === k)!.score;
    expect(pick(low, "savings")).toBe(pick(high, "savings"));
    expect(pick(low, "fixed")).toBe(pick(high, "fixed"));
  });
  it("un revenu élevé ne garantit pas une bonne note", () => {
    const spender = healthScore({ today: "2026-06-20", accounts: accounts.map((a) => ({ ...a, initialBalance: 0 })), txs: history(1000000, 1050000), cats: cmap, rules: [], budgets: [] });
    expect(spender.score!).toBeLessThan(50);
  });
});

describe("opportunités d'économies", () => {
  it("calculées à partir des dépenses réelles (−20 %)", () => {
    const txs: LedgerTx[] = [];
    for (const m of ["2026-01", "2026-02", "2026-03"]) for (const d of ["05", "15", "25"]) txs.push(tx({ kind: "expense", amount: 3167, date: `${m}-${d}`, categoryId: "fast" }));
    const ops = savingsOpportunities({ txs, cats: cmap, rules: [], reviewed: new Map(), today: "2026-04-10" });
    const o = ops.find((x) => x.id === "reduce-fast")!;
    expect(o.monthlySaving).toBe(Math.round(9501 * 0.2));
    expect(o.annualSaving).toBe(o.monthlySaving * 12);
    expect(o.detail).toContain("95,01 €");
  });
  it("aucune opportunité inventée sans données", () => {
    expect(savingsOpportunities({ txs: [], cats: cmap, rules: [], reviewed: new Map(), today: "2026-04-10" })).toEqual([]);
  });
  it("les charges fixes ne sont pas proposées à la réduction de 20 %", () => {
    const txs = ["2026-01-05", "2026-02-05", "2026-03-05"].map((d) => tx({ kind: "expense", amount: 70000, date: d, categoryId: "rent" }));
    expect(savingsOpportunities({ txs, cats: cmap, rules: [], reviewed: new Map(), today: "2026-04-10" }).some((o) => o.id === "reduce-rent")).toBe(false);
  });
});

it("addDays reste cohérent (contrôle)", () => expect(addDays("2026-02-28", 1)).toBe("2026-03-01"));
