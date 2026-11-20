/**
 * Manipulation de dates calendaires au format ISO "AAAA-MM-JJ".
 * Toutes les opérations se font en UTC sur des dates pures afin d'éviter tout décalage de fuseau.
 * La « date du jour » est calculée dans le fuseau de l'utilisateur via `todayInTimeZone`.
 */

export type ISODate = string; // "2026-11-20"

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== "string") return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** month: 1..12 */
export function daysInMonth(y: number, month: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parseISO(s: ISODate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`Date invalide : ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toUTC(s: ISODate): number {
  const { y, m, d } = parseISO(s);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromUTC(toUTC(s) + n * 86400000);
}

/** Ajoute n mois en bornant au dernier jour du mois (31/01 + 1 mois = 28/02 ou 29/02). */
export function addMonths(s: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, d } = parseISO(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return toISO(ny, nm, day);
}

export function addYears(s: ISODate, n: number): ISODate {
  return addMonths(s, n * 12);
}

/** Nombre de jours entre a et b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Nombre de mois calendaires entiers entre a et b (approximation par jours / 30,4375 pour les fractions). */
export function diffMonthsFractional(a: ISODate, b: ISODate): number {
  return diffDays(a, b) / 30.436875;
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function startOfMonth(s: ISODate): ISODate {
  const { y, m } = parseISO(s);
  return toISO(y, m, 1);
}

export function endOfMonth(s: ISODate): ISODate {
  const { y, m } = parseISO(s);
  return toISO(y, m, daysInMonth(y, m));
}

export function startOfYear(s: ISODate): ISODate {
  return `${s.slice(0, 4)}-01-01`;
}
export function endOfYear(s: ISODate): ISODate {
  return `${s.slice(0, 4)}-12-31`;
}

/** 0 = lundi ... 6 = dimanche (convention française). */
export function weekdayMonday0(s: ISODate): number {
  const dow = new Date(toUTC(s)).getUTCDay(); // 0 = dimanche
  return (dow + 6) % 7;
}

export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayMonday0(s));
}
export function endOfWeek(s: ISODate): ISODate {
  return addDays(startOfWeek(s), 6);
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

/** Liste des dates de from à to inclus. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

/** Liste des clés de mois "AAAA-MM" de from à to inclus. */
export function eachMonth(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  for (let cur = startOfMonth(from); cur <= to; cur = addMonths(cur, 1)) out.push(monthKey(cur));
  return out;
}

export function isWithin(s: ISODate, from: ISODate, to: ISODate): boolean {
  return s >= from && s <= to;
}

/** Date du jour dans un fuseau horaire IANA. */
export function todayInTimeZone(timeZone = "Europe/Paris", now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Affichage (français) ---------------- */

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** "20/11/2026" */
export function formatDateFR(s: ISODate | null | undefined): string {
  if (!s || !isValidISODate(s)) return "—";
  const { y, m, d } = parseISO(s);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "20 nov." */
export function formatDayShort(s: ISODate): string {
  const { m, d } = parseISO(s);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "vendredi 20 novembre 2026" */
export function formatDateLong(s: ISODate): string {
  const { y, m, d } = parseISO(s);
  return `${WEEKDAYS[weekdayMonday0(s)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "novembre 2026" à partir de "2026-11" ou "2026-11-20" */
export function formatMonthLabel(key: string, short = false): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}

export function weekdayName(i: number): string {
  return WEEKDAYS[i];
}

/** Analyse "JJ/MM/AAAA", "JJ/MM/AA", "JJ-MM-AAAA", "AAAA-MM-JJ", "JJ.MM.AAAA". */
export function parseFrenchDate(input: string): ISODate | null {
  const s = input.trim();
  if (isValidISODate(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
  const iso = toISO(y, Number(m[2]), Number(m[1]));
  return isValidISODate(iso) ? iso : null;
}
