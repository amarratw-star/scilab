import "server-only";
import { addDays, monthKey, startOfWeek, type ISODate } from "@/lib/dates";
import { balanceHistory } from "@/lib/finance/ledger";
import { dailyFlows } from "@/lib/finance/stats";
import type { Finance, TxRow } from "./snapshot";
import { liquidScope } from "./overview";
import type { TxView } from "@/components/app/tx-list";

export function toTxView(t: TxRow & { docCount?: number }): TxView {
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    amount: t.amount,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    date: t.date,
    time: t.time,
    description: t.description,
    merchant: t.merchant,
    paymentMethod: t.paymentMethod,
    tags: t.tags,
    notes: t.notes,
    recurringId: t.recurringId,
    refundOfId: t.refundOfId,
    docCount: t.docCount,
    bank: t.externalId ? { pending: t.bankStatus === "coming", unverified: !t.verifiedAt } : null,
  };
}

export function accountNames(fin: Pick<Finance, "accountRows">): Record<string, string> {
  return Object.fromEntries(fin.accountRows.map((a) => [a.id, a.archivedAt ? `${a.name} (archivé)` : a.name]));
}

/** Séries pour le graphique principal : soldes quotidiens et flux regroupés par jour / semaine / mois. */
export function chartSeries(fin: Finance, from: ISODate, to: ISODate, granularity: "day" | "week" | "month") {
  const all = new Set(fin.accounts.filter((a) => !a.archived).map((a) => a.id));
  const liquid = liquidScope(fin);
  const total = balanceHistory(fin.accounts, fin.txs, from, to, all);
  const avail = balanceHistory(fin.accounts, fin.txs, from, to, liquid);
  let balances = total.map((p, i) => ({ date: p.date, total: p.balance, available: avail[i].balance }));
  if (balances.length > 200) {
    const step = Math.ceil(balances.length / 200);
    balances = balances.filter((_, i) => i % step === 0 || i === balances.length - 1);
  }
  const flowsDaily = dailyFlows(fin.txs, from, to);
  const buckets = new Map<string, { key: string; income: number; expenses: number; savings: number }>();
  for (const d of flowsDaily) {
    const key = granularity === "day" ? d.date : granularity === "week" ? startOfWeek(d.date) : `${monthKey(d.date)}-01`;
    const b = buckets.get(key) ?? { key, income: 0, expenses: 0, savings: 0 };
    b.income += d.income;
    b.expenses += d.expenses;
    b.savings = b.income - b.expenses;
    buckets.set(key, b);
  }
  return { balances, flows: [...buckets.values()] };
}

export function lastNDays(today: ISODate, n: number) {
  return { from: addDays(today, -(n - 1)), to: today };
}
