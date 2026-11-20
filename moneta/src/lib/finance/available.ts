/**
 * « Combien puis-je dépenser ? » — reste à vivre et argent réellement disponible.
 *
 * Formule (jusqu'à la fin du mois en cours) :
 *
 *   disponible maintenant          = solde des comptes courants, secondaires et espèces
 *   − charges fixes restantes      = échéances récurrentes (dépenses) du mois non encore confirmées
 *   − dépenses prévues             = opérations « prévues » datées d'ici la fin du mois
 *   − versements d'épargne prévus  = transferts récurrents/prévus des comptes disponibles vers l'épargne
 *   − épargne à préserver          = objectif d'épargne mensuel restant à mettre de côté
 *   − coussin de sécurité          = montant que l'utilisateur veut toujours conserver
 *   = dépensable d'ici la fin du mois
 *
 * Les revenus attendus (récurrents ou prévus) ne sont JAMAIS ajoutés : ils sont affichés à part.
 * Si aucun compte disponible n'existe, l'estimation est indisponible.
 */
import { diffDays, endOfMonth, startOfMonth, type ISODate } from "@/lib/dates";
import { scheduledItems } from "./recurring";
import { scopeDelta } from "./ledger";
import type { BudgetStatus } from "./budgets";
import type { LedgerAccount, LedgerTx, RecurringRule } from "./types";
import { LIQUID_ACCOUNT_TYPES } from "./types";

export interface AvailableInput {
  today: ISODate;
  accounts: LedgerAccount[];
  balances: Map<string, number>;
  txs: LedgerTx[];
  rules: RecurringRule[];
  safetyCushion: number;
  monthlySavingsTarget: number;
  budgets?: BudgetStatus[];
}

export interface AvailableLine {
  label: string;
  amount: number; // signé : + augmente, − diminue
  hint?: string;
}

export type AvailableResult =
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      availableNow: number;
      pendingFixedCharges: number;
      pendingFixedCount: number;
      overdueToConfirm: number;
      plannedExpenses: number;
      plannedSavingsTransfers: number;
      savingsToPreserve: number;
      savedThisMonth: number;
      safetyCushion: number;
      spendableUntilMonthEnd: number;
      daysLeft: number;
      dailyAllowance: number;
      budgetRemaining: number | null;
      recommendedDaily: number;
      expectedIncome: number;
      nextIncome: { date: ISODate; amount: number; label: string } | null;
      lines: AvailableLine[];
      afterFixedCharges: number;
      warnings: string[];
    };

export function computeAvailable(input: AvailableInput): AvailableResult {
  const { today, accounts } = input;
  const liquid = accounts.filter((a) => !a.archived && LIQUID_ACCOUNT_TYPES.includes(a.type));
  if (!liquid.length) {
    return {
      status: "unavailable",
      reason: "Ajoute au moins un compte courant ou un compte espèces pour calculer ton argent disponible.",
    };
  }
  const liquidIds = new Set(liquid.map((a) => a.id));
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysLeft = diffDays(today, monthEnd) + 1;

  const availableNow = liquid.reduce((s, a) => s + (input.balances.get(a.id) ?? a.initialBalance), 0);

  // Échéances du mois non confirmées (y compris celles déjà passées : elles sont « à confirmer »).
  const items = scheduledItems(input.rules, input.txs, monthStart, monthEnd).filter((i) => !i.realized);
  let pendingFixedCharges = 0;
  let pendingFixedCount = 0;
  let overdueToConfirm = 0;
  let plannedSavingsTransfers = 0;
  let expectedIncome = 0;
  let nextIncome: { date: ISODate; amount: number; label: string } | null = null;

  for (const it of items) {
    const fromLiquid = liquidIds.has(it.accountId);
    if (it.kind === "expense" && fromLiquid) {
      pendingFixedCharges += it.amount;
      pendingFixedCount++;
      if (it.date < today) overdueToConfirm += it.amount;
    } else if (it.kind === "transfer" && fromLiquid && it.toAccountId && !liquidIds.has(it.toAccountId)) {
      plannedSavingsTransfers += it.amount;
    } else if (it.kind === "income" && liquidIds.has(it.accountId) && it.date >= today) {
      expectedIncome += it.amount;
      if (!nextIncome || it.date < nextIncome.date) nextIncome = { date: it.date, amount: it.amount, label: it.name };
    }
  }

  // Opérations prévues (hors récurrences déjà comptées) jusqu'à la fin du mois.
  let plannedExpenses = 0;
  for (const tx of input.txs) {
    if (tx.status !== "planned" || tx.date > monthEnd) continue;
    const d = scopeDelta(tx, liquidIds, "posted+planned");
    if (tx.kind === "income" || tx.kind === "refund") {
      if (d > 0 && tx.date >= today) {
        expectedIncome += d;
        if (!nextIncome || tx.date < nextIncome.date) nextIncome = { date: tx.date, amount: d, label: tx.description ?? "Revenu prévu" };
      }
      continue;
    }
    if (tx.kind === "transfer") {
      if (d < 0) plannedSavingsTransfers += -d;
      continue;
    }
    if (d < 0) plannedExpenses += -d;
  }

  // Épargne déjà mise de côté ce mois-ci : transferts nets des comptes disponibles vers les autres comptes.
  let savedThisMonth = 0;
  for (const tx of input.txs) {
    if (tx.status !== "posted" || tx.kind !== "transfer" || tx.date < monthStart || tx.date > monthEnd) continue;
    const fromLiquid = liquidIds.has(tx.accountId);
    const toLiquid = tx.toAccountId ? liquidIds.has(tx.toAccountId) : false;
    if (fromLiquid && !toLiquid) savedThisMonth += tx.amount;
    else if (!fromLiquid && toLiquid) savedThisMonth -= tx.amount;
  }
  const savingsToPreserve = Math.max(0, input.monthlySavingsTarget - Math.max(0, savedThisMonth) - plannedSavingsTransfers);
  const safetyCushion = Math.max(0, input.safetyCushion);

  const afterFixedCharges = availableNow - pendingFixedCharges - plannedExpenses;
  const spendableUntilMonthEnd = afterFixedCharges - plannedSavingsTransfers - savingsToPreserve - safetyCushion;
  const dailyAllowance = daysLeft > 0 ? Math.floor(Math.max(0, spendableUntilMonthEnd) / daysLeft) : 0;

  // Budgets : on retient le budget global s'il existe, sinon la somme des budgets mensuels par catégorie.
  let budgetRemaining: number | null = null;
  if (input.budgets?.length) {
    const monthly = input.budgets.filter((b) => b.budget.active && b.budget.period === "monthly");
    const global = monthly.find((b) => !b.budget.categoryId);
    if (global) budgetRemaining = Math.max(0, global.remaining);
    else if (monthly.length) budgetRemaining = monthly.reduce((s, b) => s + Math.max(0, b.remaining), 0);
  }
  const budgetDaily = budgetRemaining !== null && daysLeft > 0 ? Math.floor(budgetRemaining / daysLeft) : null;
  const recommendedDaily = budgetDaily !== null ? Math.min(dailyAllowance, budgetDaily) : dailyAllowance;

  const warnings: string[] = [];
  if (spendableUntilMonthEnd < 0) warnings.push("Tes engagements d'ici la fin du mois dépassent ton argent disponible.");
  if (overdueToConfirm > 0)
    warnings.push("Certaines échéances passées ne sont pas encore confirmées : elles sont comptées comme restant à payer.");

  const lines: AvailableLine[] = [
    { label: "Solde disponible (comptes courants et espèces)", amount: availableNow },
    { label: "Charges fixes restantes ce mois-ci", amount: -pendingFixedCharges, hint: `${pendingFixedCount} échéance(s) non confirmée(s)` },
    { label: "Dépenses prévues", amount: -plannedExpenses },
    { label: "Versements d'épargne prévus", amount: -plannedSavingsTransfers },
    { label: "Épargne mensuelle à préserver", amount: -savingsToPreserve, hint: "Objectif mensuel restant à mettre de côté" },
    { label: "Coussin de sécurité", amount: -safetyCushion },
  ];

  return {
    status: "ok",
    availableNow,
    pendingFixedCharges,
    pendingFixedCount,
    overdueToConfirm,
    plannedExpenses,
    plannedSavingsTransfers,
    savingsToPreserve,
    savedThisMonth,
    safetyCushion,
    spendableUntilMonthEnd,
    daysLeft,
    dailyAllowance,
    budgetRemaining,
    recommendedDaily,
    expectedIncome,
    nextIncome,
    lines,
    afterFixedCharges,
    warnings,
  };
}

/** Reste à vivre du mois = revenus encaissés − charges fixes du mois (payées + restant à payer). */
export function resteAVivre(incomeThisMonth: number, fixedPaid: number, fixedPending: number): number {
  return incomeThisMonth - fixedPaid - fixedPending;
}
