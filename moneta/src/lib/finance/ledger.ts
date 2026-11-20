/**
 * Grand livre : effet de chaque opération sur le solde des comptes.
 *
 * Règles (PARTIE 28) :
 *  1. Une dépense diminue le solde du compte concerné.
 *  2. Un revenu augmente le solde du compte concerné.
 *  3. Un transfert diminue un compte et augmente l'autre (effet net nul sur le total).
 *  4. Un remboursement augmente le solde du compte concerné.
 *  5. Une régularisation (ajustement) applique son montant signé.
 *  6. Seules les opérations « posted » (réellement effectuées) modifient les soldes.
 *     Les opérations prévues ou annulées n'ont aucun effet.
 */
import { addDays, type ISODate } from "@/lib/dates";
import { LIQUID_ACCOUNT_TYPES, type LedgerAccount, type LedgerTx } from "./types";

/** Effet signé (en centimes) d'une opération sur un compte donné. */
export function accountDelta(tx: LedgerTx, accountId: string): number {
  if (tx.status !== "posted") return 0;
  switch (tx.kind) {
    case "expense":
      return tx.accountId === accountId ? -tx.amount : 0;
    case "income":
    case "refund":
      return tx.accountId === accountId ? tx.amount : 0;
    case "adjustment":
      return tx.accountId === accountId ? tx.amount : 0;
    case "transfer": {
      let d = 0;
      if (tx.accountId === accountId) d -= tx.amount;
      if (tx.toAccountId === accountId) d += tx.amount;
      return d;
    }
  }
}

/** Effet signé d'une opération sur un ensemble de comptes (les transferts internes à l'ensemble s'annulent). */
export function scopeDelta(tx: LedgerTx, scope: Set<string>, includeStatus: "posted" | "posted+planned" = "posted"): number {
  if (tx.status === "cancelled") return 0;
  if (tx.status === "planned" && includeStatus === "posted") return 0;
  const t = tx.status === "planned" ? { ...tx, status: "posted" as const } : tx;
  let d = 0;
  if (scope.has(t.accountId)) d += accountDelta(t, t.accountId);
  if (t.kind === "transfer" && t.toAccountId && scope.has(t.toAccountId)) d += accountDelta(t, t.toAccountId);
  return d;
}

/** Soldes actuels (ou à une date) : solde initial + somme des effets des opérations effectuées. */
export function computeBalances(accounts: LedgerAccount[], txs: LedgerTx[], asOf?: ISODate): Map<string, number> {
  const balances = new Map<string, number>(accounts.map((a) => [a.id, a.initialBalance]));
  for (const tx of txs) {
    if (tx.status !== "posted") continue;
    if (asOf && tx.date > asOf) continue;
    if (balances.has(tx.accountId)) balances.set(tx.accountId, balances.get(tx.accountId)! + accountDelta(tx, tx.accountId));
    if (tx.kind === "transfer" && tx.toAccountId && balances.has(tx.toAccountId)) {
      balances.set(tx.toAccountId, balances.get(tx.toAccountId)! + accountDelta(tx, tx.toAccountId));
    }
  }
  return balances;
}

export function isLiquid(a: Pick<LedgerAccount, "type">): boolean {
  return LIQUID_ACCOUNT_TYPES.includes(a.type);
}

export interface BalanceSummary {
  /** Somme des soldes de tous les comptes non archivés (patrimoine financier). */
  totalFinancial: number;
  /** Somme des soldes des comptes courants / secondaires / espèces non archivés. */
  available: number;
  savings: number;
  investments: number;
  byAccount: { id: string; name: string; type: LedgerAccount["type"]; balance: number; color?: string; archived: boolean }[];
}

export function summarizeBalances(accounts: LedgerAccount[], balances: Map<string, number>): BalanceSummary {
  let totalFinancial = 0;
  let available = 0;
  let savings = 0;
  let investments = 0;
  const byAccount = accounts.map((a) => {
    const balance = balances.get(a.id) ?? a.initialBalance;
    if (!a.archived) {
      totalFinancial += balance;
      if (isLiquid(a)) available += balance;
      else if (a.type === "savings") savings += balance;
      else if (a.type === "investment" || a.type === "placement") investments += balance;
    }
    return { id: a.id, name: a.name, type: a.type, balance, color: a.color, archived: a.archived };
  });
  return { totalFinancial, available, savings, investments, byAccount };
}

/**
 * Historique quotidien du solde d'un ensemble de comptes entre `from` et `to` inclus.
 * Calculé à partir du solde initial et des opérations effectuées (aucune donnée inventée).
 */
export function balanceHistory(
  accounts: LedgerAccount[],
  txs: LedgerTx[],
  from: ISODate,
  to: ISODate,
  scopeIds?: Set<string>,
): { date: ISODate; balance: number }[] {
  const scope = scopeIds ?? new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  let balance = accounts.filter((a) => scope.has(a.id)).reduce((s, a) => s + a.initialBalance, 0);
  const deltasByDate = new Map<ISODate, number>();
  for (const tx of txs) {
    if (tx.status !== "posted") continue;
    const d = scopeDelta(tx, scope);
    if (d === 0) continue;
    if (tx.date < from) balance += d;
    else if (tx.date <= to) deltasByDate.set(tx.date, (deltasByDate.get(tx.date) ?? 0) + d);
  }
  const out: { date: ISODate; balance: number }[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
    balance += deltasByDate.get(cur) ?? 0;
    out.push({ date: cur, balance });
  }
  return out;
}

/**
 * Rapprochement : écart entre le solde théorique (calculé) et le solde réel constaté.
 * Un écart non nul se corrige par une opération de régularisation traçable.
 */
export function reconciliationGap(computedBalance: number, actualBalance: number): number {
  return actualBalance - computedBalance;
}
