/**
 * Montants : toujours des entiers en centimes. Aucune arithmétique sur des flottants en euros.
 */

export type Cents = number;

/** Devises proposées. Changer de devise ne convertit JAMAIS les montants : seul l'affichage change. */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "XOF", "XPF", "MAD"] as const;

/**
 * Devise par défaut de l'affichage. Côté serveur, elle est résolue par requête (devise de l'utilisateur
 * connecté, voir src/server/currency.ts) ; côté client, les composants passent la devise du contexte.
 */
let currencyResolver: (() => string | undefined) | null = null;
export function setCurrencyResolver(fn: () => string | undefined) {
  currencyResolver = fn;
}
export function defaultCurrency(): string {
  try {
    return currencyResolver?.() || "EUR";
  } catch {
    return "EUR";
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, opts: { signed?: boolean; compact?: boolean; decimals?: boolean }) {
  const key = `${currency}|${opts.signed ? 1 : 0}|${opts.compact ? 1 : 0}|${opts.decimals === false ? 0 : 1}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      signDisplay: opts.signed ? "exceptZero" : "auto",
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.decimals === false ? 0 : opts.compact ? 0 : 2,
      maximumFractionDigits: opts.decimals === false ? 0 : opts.compact ? 1 : 2,
    });
    formatters.set(key, f);
  }
  return f;
}

/** 123456 -> "1 234,56 €" (espaces insécables normalisés en espaces fines). */
export function formatMoney(
  cents: Cents | null | undefined,
  currency: string = defaultCurrency(),
  opts: { signed?: boolean; compact?: boolean; decimals?: boolean } = {},
): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  return getFormatter(currency, opts).format(cents / 100);
}

/** Version texte brut (espaces normales) — utile pour le PDF, le CSV et l'IA. */
export function formatMoneyPlain(cents: Cents | null | undefined, currency: string = defaultCurrency(), opts: { signed?: boolean } = {}) {
  return formatMoney(cents, currency, opts).replace(/[  ]/g, " ");
}

/**
 * Convertit une saisie utilisateur en centimes.
 * Accepte : "12", "12,5", "12.50", "1 234,56", "1.234,56", "1,234.56", "-8,90", "12 €".
 * Retourne null si la saisie n'est pas un montant valide.
 */
export function parseAmountToCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.trim().replace(/[\s  €$£]|EUR/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart = "";
  if (lastComma === -1 && lastDot === -1) {
    intPart = s;
  } else {
    const sepIndex = Math.max(lastComma, lastDot);
    const sep = s[sepIndex];
    const after = s.slice(sepIndex + 1);
    const otherSep = sep === "," ? "." : ",";
    const countSep = s.split(sep).length - 1;
    // "1.234" ou "1,234" seuls avec 3 décimales et un seul séparateur : ambiguïté.
    // On considère qu'un séparateur suivi d'exactement 3 chiffres ET répété (ou accompagné de l'autre séparateur avant) est un séparateur de milliers.
    if (countSep > 1 && !s.includes(otherSep)) {
      // "1.234.567" -> milliers
      intPart = s.split(sep).join("");
    } else if (after.length === 3 && !s.includes(otherSep) && countSep === 1 && sep === ".") {
      // "1.234" : en français c'est un séparateur de milliers
      intPart = s.replace(".", "");
    } else {
      intPart = s.slice(0, sepIndex).split(otherSep).join("").split(sep).join("");
      decPart = after;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  if (decPart.length > 2) {
    // arrondi au centime (demi vers le haut)
    const third = Number(decPart[2]);
    decPart = decPart.slice(0, 2);
    const base = Number(intPart || "0") * 100 + Number(decPart.padEnd(2, "0"));
    const value = base + (third >= 5 ? 1 : 0);
    return negative ? -value : value;
  }
  const value = Number(intPart || "0") * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Centimes -> chaîne éditable "12,50". */
export function centsToInput(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Division sûre : retourne null si le dénominateur est nul ou manquant. */
export function safeRatio(numerator: number, denominator: number | null | undefined): number | null {
  if (!denominator || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

/** Variation relative (en fraction). null si la base est nulle. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function formatPct(ratio: number | null | undefined, digits = 1, signed = false): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  })
    .format(ratio)
    .replace(/[  ]/g, " ");
}

export function sumCents(values: Iterable<number>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Symbole d'une devise ("€", "$", "£", "CHF"…). */
export function currencySymbol(currency: string = defaultCurrency()): string {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
