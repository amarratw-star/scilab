import { addDays, addMonths, diffDays, isValidISODate, startOfYear, type ISODate } from "@/lib/dates";

export const PERIOD_OPTIONS = [
  { value: "7j", label: "7 j" },
  { value: "30j", label: "30 j" },
  { value: "3m", label: "3 mois" },
  { value: "6m", label: "6 mois" },
  { value: "12m", label: "12 mois" },
  { value: "annee", label: "Année" },
  { value: "perso", label: "Personnalisée" },
] as const;

export type PeriodKey = (typeof PERIOD_OPTIONS)[number]["value"];

export function resolvePeriod(key: string | undefined, today: ISODate, du?: string, au?: string): { key: PeriodKey; from: ISODate; to: ISODate; granularity: "day" | "week" | "month" } {
  let from: ISODate;
  let to: ISODate = today;
  let k = (PERIOD_OPTIONS.find((p) => p.value === key)?.value ?? "30j") as PeriodKey;
  switch (k) {
    case "7j":
      from = addDays(today, -6);
      break;
    case "3m":
      from = addDays(addMonths(today, -3), 1);
      break;
    case "6m":
      from = addDays(addMonths(today, -6), 1);
      break;
    case "12m":
      from = addDays(addMonths(today, -12), 1);
      break;
    case "annee":
      from = startOfYear(today);
      break;
    case "perso":
      if (du && au && isValidISODate(du) && isValidISODate(au) && du <= au && diffDays(du, au) <= 3660) {
        from = du;
        to = au;
      } else {
        k = "30j";
        from = addDays(today, -29);
      }
      break;
    default:
      from = addDays(today, -29);
  }
  const len = diffDays(from, to) + 1;
  return { key: k, from, to, granularity: len <= 45 ? "day" : len <= 190 ? "week" : "month" };
}
