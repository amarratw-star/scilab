/**
 * Analyse du texte OCR d'un ticket de caisse (français).
 * Retourne des champs avec un niveau de confiance : rien n'est enregistré sans validation de l'utilisateur.
 */
import { parseFrenchDate, type ISODate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";

export interface ReceiptField<T> {
  value: T | null;
  confidence: "high" | "medium" | "low" | "none";
}

export interface ReceiptExtraction {
  merchant: ReceiptField<string>;
  date: ReceiptField<ISODate>;
  total: ReceiptField<number>;
  items: { label: string; amount: number }[];
  rawText: string;
  needsReview: boolean;
}

const AMOUNT_RE = /(-?\d{1,6}(?:[ .]\d{3})*[,.]\d{2})\s*(?:€|eur|e\b)?/gi;

export function parseReceiptText(text: string): ReceiptExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Commerçant : première ligne « textuelle » significative
  let merchant: ReceiptField<string> = { value: null, confidence: "none" };
  for (const l of lines.slice(0, 6)) {
    const letters = l.replace(/[^a-zA-ZÀ-ÿ]/g, "");
    if (letters.length >= 3 && !/(ticket|facture|bienvenue|merci|tel|t[ée]l[ée]phone|siret|tva|www|http)/i.test(l)) {
      merchant = { value: l.slice(0, 60), confidence: letters.length >= 5 ? "medium" : "low" };
      break;
    }
  }

  // Date
  let date: ReceiptField<ISODate> = { value: null, confidence: "none" };
  for (const l of lines) {
    const m = l.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2}))/);
    if (m) {
      const d = parseFrenchDate(m[1]);
      if (d) {
        date = { value: d, confidence: m[1].length >= 10 ? "high" : "medium" };
        break;
      }
    }
  }

  // Total : ligne contenant TOTAL / À PAYER / NET A PAYER, sinon plus grand montant
  let total: ReceiptField<number> = { value: null, confidence: "none" };
  const totalLines = lines.filter((l) => /(total\s*(ttc)?|net\s*[àa]\s*payer|[àa]\s*payer|montant\s*d[ûu]|cb\s*emv|carte\s*bancaire)/i.test(l) && !/sous[- ]?total|total\s*ht|tva/i.test(l));
  for (const l of totalLines) {
    const amounts = [...l.matchAll(AMOUNT_RE)].map((m) => parseAmountToCents(m[1])).filter((v): v is number => v !== null && v > 0);
    if (amounts.length) {
      total = { value: amounts[amounts.length - 1], confidence: /total|payer/i.test(l) ? "high" : "medium" };
      break;
    }
  }
  const allAmounts = lines.flatMap((l) => [...l.matchAll(AMOUNT_RE)].map((m) => parseAmountToCents(m[1]))).filter((v): v is number => v !== null && v > 0);
  if (total.value === null && allAmounts.length) {
    total = { value: Math.max(...allAmounts), confidence: "low" };
  }

  // Articles : lignes « libellé ... montant » avant la ligne de total
  const items: { label: string; amount: number }[] = [];
  const stopIndex = lines.findIndex((l) => /total|[àa] payer/i.test(l));
  for (const l of lines.slice(0, stopIndex >= 0 ? stopIndex : lines.length)) {
    const m = l.match(/^(.{2,40}?)\s+(-?\d{1,5}[,.]\d{2})\s*(?:€|eur)?\s*[A-Z]?$/i);
    if (m && /[a-zA-ZÀ-ÿ]{2}/.test(m[1])) {
      const amount = parseAmountToCents(m[2]);
      if (amount !== null && amount !== 0) items.push({ label: m[1].trim(), amount });
    }
  }
  // Cohérence : si la somme des articles correspond au total, la confiance augmente
  if (total.value !== null && items.length >= 2) {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    if (Math.abs(sum - total.value) <= 1 && total.confidence !== "high") total = { ...total, confidence: "high" };
  }

  const needsReview = total.confidence !== "high" || date.confidence === "none" || merchant.confidence !== "high";
  return { merchant, date, total, items: items.slice(0, 50), rawText: text, needsReview };
}
