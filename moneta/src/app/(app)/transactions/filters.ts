import { addMonths, endOfMonth, endOfWeek, endOfYear, isValidISODate, startOfMonth, startOfWeek, startOfYear, type ISODate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import type { TxFilters } from "@/server/services/transactions";

export const QUICK_PERIODS = [
  { value: "tout", label: "Tout" },
  { value: "aujourdhui", label: "Aujourd'hui" },
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
  { value: "mois-precedent", label: "Mois précédent" },
  { value: "annee", label: "Cette année" },
  { value: "perso", label: "Dates…" },
] as const;

export function parseTxFilters(sp: Record<string, string | undefined>, today: ISODate): TxFilters & { page: number; periode: string } {
  const periode = sp.periode ?? "tout";
  let from: string | undefined;
  let to: string | undefined;
  switch (periode) {
    case "aujourdhui":
      from = to = today;
      break;
    case "semaine":
      from = startOfWeek(today);
      to = endOfWeek(today);
      break;
    case "mois":
      from = startOfMonth(today);
      to = endOfMonth(today);
      break;
    case "mois-precedent":
      from = startOfMonth(addMonths(today, -1));
      to = endOfMonth(from);
      break;
    case "annee":
      from = startOfYear(today);
      to = endOfYear(today);
      break;
    case "perso":
      from = sp.du && isValidISODate(sp.du) ? sp.du : undefined;
      to = sp.au && isValidISODate(sp.au) ? sp.au : undefined;
      break;
  }
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const min = sp.min ? parseAmountToCents(sp.min) : null;
  const max = sp.max ? parseAmountToCents(sp.max) : null;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  return {
    periode,
    q: sp.q?.slice(0, 100),
    from,
    to,
    kind: sp.type ? sp.type.split(",").filter((k) => ["expense", "income", "transfer", "refund", "adjustment"].includes(k)) : undefined,
    status: sp.statut ? sp.statut.split(",").filter((k) => ["posted", "planned", "cancelled"].includes(k)) : undefined,
    accountId: uuid(sp.compte),
    categoryId: sp.categorie === "none" ? "none" : uuid(sp.categorie),
    paymentMethod: sp.moyen && ["card", "cash", "transfer", "direct_debit", "mobile", "other"].includes(sp.moyen) ? sp.moyen : undefined,
    min: min !== null ? Math.abs(min) : undefined,
    max: max !== null ? Math.abs(max) : undefined,
    tag: sp.tag?.slice(0, 30),
    sort: (["date_desc", "date_asc", "amount_desc", "amount_asc"] as const).find((s) => s === sp.tri) ?? "date_desc",
    page,
    limit: 50,
    offset: (page - 1) * 50,
  };
}
