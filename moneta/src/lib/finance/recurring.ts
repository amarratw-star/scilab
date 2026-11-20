/**
 * Charges et revenus récurrents : calcul des échéances et équivalents mensuels / annuels.
 * Une échéance est « réalisée » lorsqu'une opération effectuée (posted) y est rattachée
 * (recurring_id + occurrence_date). Les échéances ne sont JAMAIS converties automatiquement en
 * opérations réelles : l'utilisateur confirme le paiement.
 */
import { addDays, addMonths, parseISO, type ISODate } from "@/lib/dates";
import type { Frequency, LedgerTx, RecurringRule } from "./types";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  yearly: "Annuelle",
};

const MONTH_STEP: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

/** Toutes les échéances d'une règle comprises dans [from, to]. */
export function occurrences(rule: Pick<RecurringRule, "frequency" | "startDate" | "endDate" | "status">, from: ISODate, to: ISODate, opts: { includeInactive?: boolean } = {}): ISODate[] {
  if (!opts.includeInactive && rule.status !== "active") return [];
  const out: ISODate[] = [];
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (end < rule.startDate) return out;
  if (rule.frequency === "weekly") {
    let cur = rule.startDate;
    if (cur < from) {
      const weeks = Math.floor((parseDays(from) - parseDays(cur)) / 7);
      cur = addDays(cur, weeks * 7);
      while (cur < from) cur = addDays(cur, 7);
    }
    for (; cur <= end; cur = addDays(cur, 7)) out.push(cur);
    return out;
  }
  const step = MONTH_STEP[rule.frequency]!;
  const anchorDay = parseISO(rule.startDate).d;
  let i = 0;
  // saut rapide vers la première échéance >= from
  if (rule.startDate < from) {
    const s = parseISO(rule.startDate);
    const f = parseISO(from);
    const monthsBetween = (f.y - s.y) * 12 + (f.m - s.m);
    i = Math.max(0, Math.floor(monthsBetween / step) - 1);
  }
  for (; ; i++) {
    const cur = addMonths(rule.startDate, i * step, anchorDay);
    if (cur > end) break;
    if (cur >= from) out.push(cur);
  }
  return out;
}

function parseDays(s: ISODate) {
  const { y, m, d } = parseISO(s);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function nextOccurrence(rule: RecurringRule, after: ISODate): ISODate | null {
  const list = occurrences(rule, after, addMonths(after, 13));
  return list[0] ?? null;
}

/** Équivalent mensuel en centimes (hebdo : ×52/12). */
export function monthlyEquivalent(amount: number, frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return Math.round((amount * 52) / 12);
    case "monthly":
      return amount;
    case "quarterly":
      return Math.round(amount / 3);
    case "semiannual":
      return Math.round(amount / 6);
    case "yearly":
      return Math.round(amount / 12);
  }
}

export function annualEquivalent(amount: number, frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return amount * 52;
    case "monthly":
      return amount * 12;
    case "quarterly":
      return amount * 4;
    case "semiannual":
      return amount * 2;
    case "yearly":
      return amount;
  }
}

export function realizedKeys(txs: LedgerTx[]): Set<string> {
  const keys = new Set<string>();
  for (const t of txs) {
    if (t.status === "cancelled" || !t.recurringId || !t.occurrenceDate) continue;
    keys.add(`${t.recurringId}|${t.occurrenceDate}`);
  }
  return keys;
}

export interface ScheduledItem {
  ruleId: string;
  name: string;
  kind: RecurringRule["kind"];
  amount: number;
  date: ISODate;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  isSubscription: boolean;
  realized: boolean;
}

/** Échéances de toutes les règles actives dans [from, to], marquées réalisées ou non. */
export function scheduledItems(rules: RecurringRule[], txs: LedgerTx[], from: ISODate, to: ISODate): ScheduledItem[] {
  const done = realizedKeys(txs);
  const items: ScheduledItem[] = [];
  for (const r of rules) {
    for (const date of occurrences(r, from, to)) {
      items.push({
        ruleId: r.id,
        name: r.name,
        kind: r.kind,
        amount: r.amount,
        date,
        accountId: r.accountId,
        toAccountId: r.toAccountId,
        categoryId: r.categoryId,
        isSubscription: r.isSubscription,
        realized: done.has(`${r.id}|${date}`),
      });
    }
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface SubscriptionTotals {
  monthly: number;
  annual: number;
  activeCount: number;
}

export function subscriptionTotals(rules: RecurringRule[], onlySubscriptions = true): SubscriptionTotals {
  let monthly = 0;
  let annual = 0;
  let activeCount = 0;
  for (const r of rules) {
    if (r.status !== "active" || r.kind !== "expense") continue;
    if (onlySubscriptions && !r.isSubscription) continue;
    monthly += monthlyEquivalent(r.amount, r.frequency);
    annual += annualEquivalent(r.amount, r.frequency);
    activeCount++;
  }
  return { monthly, annual, activeCount };
}
