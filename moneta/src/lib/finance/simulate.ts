/**
 * Simulateur : tester une décision avant de la prendre. Aucune projection n'est une garantie.
 */
import type { AvailableResult } from "./available";
import type { BudgetStatus } from "./budgets";

export interface PurchaseSimulation {
  price: number;
  availableBefore: number;
  availableAfter: number;
  spendableBefore: number | null;
  spendableAfter: number | null;
  cushionIntact: boolean;
  budgetImpact: { name: string; remainingBefore: number; remainingAfter: number } | null;
  monthsOfSavings: number | null;
  verdict: "comfortable" | "tight" | "risky" | "not_affordable" | "unknown";
  explanation: string[];
}

export function simulatePurchase(input: {
  price: number;
  available: AvailableResult;
  budget?: BudgetStatus | null;
  averageMonthlySavings?: number | null;
}): PurchaseSimulation {
  const { price, available } = input;
  const explanation: string[] = [];
  if (available.status !== "ok") {
    return {
      price,
      availableBefore: 0,
      availableAfter: 0,
      spendableBefore: null,
      spendableAfter: null,
      cushionIntact: false,
      budgetImpact: null,
      monthsOfSavings: null,
      verdict: "unknown",
      explanation: [available.reason],
    };
  }
  const availableAfter = available.availableNow - price;
  const spendableAfter = available.spendableUntilMonthEnd - price;
  const afterCommitments = available.afterFixedCharges - available.plannedSavingsTransfers - price;
  const cushionIntact = afterCommitments >= available.safetyCushion;
  explanation.push(`Solde disponible actuel : ${fmt(available.availableNow)}. Après l'achat : ${fmt(availableAfter)}.`);
  explanation.push(
    `Engagements restants ce mois-ci (charges, dépenses et versements prévus) : ${fmt(available.pendingFixedCharges + available.plannedExpenses + available.plannedSavingsTransfers)}.`,
  );
  explanation.push(`Après l'achat et ces engagements, il resterait ${fmt(afterCommitments)} (coussin de sécurité souhaité : ${fmt(available.safetyCushion)}).`);
  let verdict: PurchaseSimulation["verdict"];
  if (availableAfter < 0 || afterCommitments < 0) verdict = "not_affordable";
  else if (!cushionIntact) verdict = "risky";
  else if (spendableAfter < 0) verdict = "tight";
  else verdict = "comfortable";
  if (verdict === "tight") explanation.push(`L'achat entamerait l'épargne que tu souhaites préserver ce mois-ci (${fmt(available.savingsToPreserve)}).`);
  let budgetImpact: PurchaseSimulation["budgetImpact"] = null;
  if (input.budget) {
    budgetImpact = {
      name: input.budget.budget.name,
      remainingBefore: input.budget.remaining,
      remainingAfter: input.budget.remaining - price,
    };
    if (budgetImpact.remainingAfter < 0) explanation.push(`Le budget « ${input.budget.budget.name} » serait dépassé de ${fmt(-budgetImpact.remainingAfter)}.`);
  }
  const avg = input.averageMonthlySavings ?? null;
  const monthsOfSavings = avg && avg > 0 ? price / avg : null;
  if (monthsOfSavings !== null) explanation.push(`Cet achat représente environ ${monthsOfSavings.toFixed(1).replace(".", ",")} mois de ton épargne moyenne.`);
  if (available.expectedIncome > 0)
    explanation.push(`Des revenus attendus (${fmt(available.expectedIncome)}) ne sont pas comptés : ils ne sont pas encore encaissés.`);
  return {
    price,
    availableBefore: available.availableNow,
    availableAfter,
    spendableBefore: available.spendableUntilMonthEnd,
    spendableAfter,
    cushionIntact,
    budgetImpact,
    monthsOfSavings,
    verdict,
    explanation,
  };
}

export const PURCHASE_VERDICT: Record<PurchaseSimulation["verdict"], { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  comfortable: { label: "Envisageable", tone: "positive" },
  tight: { label: "Possible mais serré", tone: "warning" },
  risky: { label: "Risqué : entame ton coussin de sécurité", tone: "warning" },
  not_affordable: { label: "Pas raisonnable maintenant", tone: "negative" },
  unknown: { label: "Estimation indisponible", tone: "neutral" },
};

/** Plan d'épargne : versement mensuel nécessaire, avec rendement annuel optionnel (intérêts composés mensuels). */
export function savingsPlan(target: number, months: number, current = 0, annualRate = 0) {
  if (months <= 0 || target <= 0) return null;
  const remaining = Math.max(0, target - current);
  const r = annualRate / 12;
  let monthly: number;
  if (r === 0) monthly = Math.ceil(remaining / months);
  else {
    const fvCurrent = current * (1 + r) ** months;
    const need = Math.max(0, target - fvCurrent);
    monthly = Math.ceil((need * r) / ((1 + r) ** months - 1));
  }
  const schedule: { month: number; balance: number }[] = [];
  let bal = current;
  for (let m = 1; m <= months; m++) {
    bal = bal * (1 + r) + monthly;
    schedule.push({ month: m, balance: Math.round(bal) });
  }
  return { monthly, remaining, months, schedule, totalContributed: monthly * months };
}

/** Économies générées par une réduction mensuelle sur une durée. */
export function reductionSavings(monthlyReduction: number, months: number) {
  return Array.from({ length: months }, (_, i) => ({ month: i + 1, cumulative: monthlyReduction * (i + 1) }));
}

/** Impact d'un changement de revenu ou d'une nouvelle charge fixe sur l'épargne mensuelle. */
export function incomeChangeImpact(input: { monthlyIncome: number; monthlyExpenses: number; incomeDelta: number; newFixedCharge: number }) {
  const before = input.monthlyIncome - input.monthlyExpenses;
  const income = input.monthlyIncome + input.incomeDelta;
  const expenses = input.monthlyExpenses + input.newFixedCharge;
  const after = income - expenses;
  return {
    savingsBefore: before,
    savingsAfter: after,
    rateBefore: input.monthlyIncome > 0 ? before / input.monthlyIncome : null,
    rateAfter: income > 0 ? after / income : null,
    annualDifference: (after - before) * 12,
  };
}

function fmt(c: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(c / 100).replace(/[  ]/g, " ");
}
