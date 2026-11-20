import type { ISODate } from "@/lib/dates";

export type AccountType = "checking" | "savings" | "secondary" | "cash" | "investment" | "placement" | "other";
export type TxKind = "expense" | "income" | "transfer" | "refund" | "adjustment";
export type TxStatus = "posted" | "planned" | "cancelled";
export type Frequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly";
export type PaymentMethod = "card" | "cash" | "transfer" | "direct_debit" | "mobile" | "other";

/** Comptes considérés comme de l'argent « disponible » (liquidités du quotidien). */
export const LIQUID_ACCOUNT_TYPES: readonly AccountType[] = ["checking", "secondary", "cash"];
export const SAVINGS_ACCOUNT_TYPES: readonly AccountType[] = ["savings"];
export const INVESTMENT_ACCOUNT_TYPES: readonly AccountType[] = ["investment", "placement"];

export interface LedgerAccount {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  openedOn: ISODate;
  archived: boolean;
  color?: string;
}

export interface LedgerTx {
  id: string;
  kind: TxKind;
  status: TxStatus;
  amount: number; // > 0 sauf ajustement (signé)
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  date: ISODate;
  recurringId?: string | null;
  occurrenceDate?: ISODate | null;
  merchant?: string | null;
  description?: string | null;
  paymentMethod?: PaymentMethod | null;
  goalId?: string | null;
}

export interface CategoryInfo {
  id: string;
  name: string;
  kind: "expense" | "income";
  parentId: string | null;
  isFixed: boolean;
  color?: string;
  icon?: string;
}

export interface RecurringRule {
  id: string;
  name: string;
  kind: "expense" | "income" | "transfer";
  amount: number;
  frequency: Frequency;
  startDate: ISODate;
  endDate: ISODate | null;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  status: "active" | "paused" | "ended";
  isSubscription: boolean;
  merchant?: string | null;
}

export interface BudgetRule {
  id: string;
  name: string;
  categoryId: string | null;
  period: "monthly" | "weekly" | "custom";
  amount: number;
  startDate: ISODate | null;
  endDate: ISODate | null;
  rollover: boolean;
  alertThresholds: number[];
  active: boolean;
  /** Date de création : le report ne s'applique qu'aux périodes où le budget existait. */
  createdOn?: ISODate;
}

export interface GoalInfo {
  id: string;
  name: string;
  targetAmount: number;
  startDate: ISODate;
  deadline: ISODate | null;
  priority: number;
}

export interface Contribution {
  goalId: string;
  amount: number;
  date: ISODate;
}

export type CategoryMap = Map<string, CategoryInfo>;

export function categoryMap(categories: CategoryInfo[]): CategoryMap {
  return new Map(categories.map((c) => [c.id, c]));
}
