/**
 * Import de relevés bancaires CSV : détection du séparateur, correspondance intelligente des colonnes,
 * analyse des montants (format français ou international), débit/crédit séparés, empreinte anti-doublon.
 * Fonctions pures : utilisables côté client (aperçu) et côté serveur (validation).
 */
import Papa from "papaparse";
import { parseFrenchDate, type ISODate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import { normalizeLabel } from "@/lib/finance/insights";

export type ColumnRole = "date" | "label" | "amount" | "debit" | "credit" | "account" | "category" | "ignore";

export interface ColumnMapping {
  date: number | null;
  label: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  account: number | null;
  category: number | null;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function parseCsvText(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimiter: "" });
  const data = (res.data as string[][]).filter((r) => r.some((c) => c && c.trim()));
  if (!data.length) return { headers: [], rows: [], delimiter: res.meta.delimiter };
  // Certaines banques ajoutent des lignes d'en-tête (titulaire, période...) : on cherche la première
  // ligne qui ressemble à une ligne d'en-têtes (au moins 2 colonnes, et la suivante contient une date).
  let headerIndex = 0;
  const looksLikeHeader = (row: string[]) =>
    row.some((c) => PATTERNS.date.test(c.trim())) && row.some((c) => PATTERNS.label.test(c) || PATTERNS.amount.test(c.trim()) || PATTERNS.debit.test(c));
  const explicit = data.slice(0, 15).findIndex(looksLikeHeader);
  if (explicit >= 0) headerIndex = explicit;
  else for (let i = 0; i < Math.min(15, data.length - 1); i++) {
    const row = data[i];
    const next = data[i + 1];
    if (row.length >= 2 && next.length === row.length && next.some((c) => parseFrenchDate(c.trim()) !== null) && !row.some((c) => parseFrenchDate(c.trim()) !== null)) {
      headerIndex = i;
      break;
    }
  }
  const headers = data[headerIndex].map((h) => h.trim());
  const rows = data.slice(headerIndex + 1).filter((r) => r.length >= Math.min(2, headers.length));
  return { headers, rows, delimiter: res.meta.delimiter };
}

const PATTERNS: Record<Exclude<ColumnRole, "ignore">, RegExp> = {
  date: /^(date|date op(e|é)ration|date d.op(e|é)ration|date comptable|date de comptabilisation|date valeur|booking date|transaction date|jour)/i,
  label: /(libell(e|é)|description|d(e|é)tail|intitul(e|é)|nature|label|wording|motif|b(e|é)n(e|é)ficiaire|communication|merchant|payee)/i,
  amount: /^(montant|amount|somme|valeur|montant \(eur\)|montant eur|montant en euros)$/i,
  debit: /(d(e|é)bit|sortie|withdrawal|d(e|é)penses?)/i,
  credit: /(cr(e|é)dit|entr(e|é)e|deposit|recettes?)/i,
  account: /(compte|account|iban|rib)/i,
  category: /(cat(e|é)gorie|category)/i,
};

/** Devine la correspondance des colonnes à partir des en-têtes et du contenu. */
export function guessMapping(csv: ParsedCsv): ColumnMapping {
  const m: ColumnMapping = { date: null, label: null, amount: null, debit: null, credit: null, account: null, category: null };
  const used = new Set<number>();
  const pick = (role: keyof ColumnMapping, test: (h: string, i: number) => boolean) => {
    if (m[role] !== null) return;
    const idx = csv.headers.findIndex((h, i) => !used.has(i) && test(h, i));
    if (idx >= 0) {
      m[role] = idx;
      used.add(idx);
    }
  };
  pick("date", (h) => PATTERNS.date.test(h));
  pick("debit", (h) => PATTERNS.debit.test(h) && !PATTERNS.date.test(h));
  pick("credit", (h) => PATTERNS.credit.test(h) && !PATTERNS.date.test(h));
  pick("amount", (h) => PATTERNS.amount.test(h) || /montant/i.test(h));
  pick("label", (h) => PATTERNS.label.test(h));
  pick("category", (h) => PATTERNS.category.test(h));
  pick("account", (h) => PATTERNS.account.test(h));
  const sample = csv.rows.slice(0, 20);
  // Repli sur le contenu
  if (m.date === null) {
    pick("date", (_h, i) => sample.length > 0 && sample.filter((r) => parseFrenchDate((r[i] ?? "").trim())).length >= sample.length * 0.8);
  }
  if (m.amount === null && m.debit === null && m.credit === null) {
    pick("amount", (_h, i) => sample.length > 0 && sample.filter((r) => parseAmountToCents(r[i] ?? "") !== null && /\d/.test(r[i] ?? "")).length >= sample.length * 0.8);
  }
  if (m.label === null) {
    let best = -1;
    let bestLen = 0;
    csv.headers.forEach((_h, i) => {
      if (used.has(i)) return;
      const avg = sample.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / Math.max(1, sample.length);
      if (avg > bestLen) {
        bestLen = avg;
        best = i;
      }
    });
    if (best >= 0) m.label = best;
  }
  // Si débit ET montant détectés, on privilégie débit/crédit uniquement si crédit est aussi présent
  if (m.amount !== null && (m.debit === null || m.credit === null)) {
    m.debit = null;
    m.credit = null;
  }
  return m;
}

export interface ImportRow {
  index: number;
  date: ISODate | null;
  label: string;
  amount: number | null; // signé : négatif = sortie
  accountLabel: string | null;
  categoryLabel: string | null;
  errors: string[];
}

export function extractRows(csv: ParsedCsv, mapping: ColumnMapping): ImportRow[] {
  return csv.rows.map((r, index) => {
    const errors: string[] = [];
    const get = (i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
    const date = parseFrenchDate(get(mapping.date));
    if (!date) errors.push("Date invalide");
    let amount: number | null = null;
    if (mapping.amount !== null) {
      amount = parseAmountToCents(get(mapping.amount));
    } else if (mapping.debit !== null || mapping.credit !== null) {
      const d = get(mapping.debit);
      const c = get(mapping.credit);
      const dv = d ? parseAmountToCents(d) : 0;
      const cv = c ? parseAmountToCents(c) : 0;
      if (dv === null || cv === null) amount = null;
      else amount = Math.abs(cv) - Math.abs(dv);
    }
    if (amount === null) errors.push("Montant invalide");
    else if (amount === 0) errors.push("Montant nul");
    const label = get(mapping.label) || "(sans libellé)";
    return {
      index,
      date,
      label,
      amount,
      accountLabel: mapping.account !== null ? get(mapping.account) || null : null,
      categoryLabel: mapping.category !== null ? get(mapping.category) || null : null,
      errors,
    };
  });
}

/** Empreinte stable d'une opération importée (compte + date + montant + libellé normalisé). */
export async function importFingerprint(accountId: string, date: ISODate, amount: number, label: string): Promise<string> {
  const raw = `${accountId}|${date}|${amount}|${normalizeLabel(label) || label.toLowerCase().trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Règles simples de catégorisation automatique à partir du libellé (suggestion, modifiable avant import). */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/(loyer|foncia|nexity|syndic|habitation)/, "Logement"],
  [/(carrefour|leclerc|auchan|lidl|intermarche|monoprix|franprix|casino|super u|picard|aldi|biocoop|grand frais|naturalia)/, "Courses alimentaires"],
  [/(starbucks|cafe|coffee|columbus|boulangerie|paul )/, "Cafés"],
  [/(restaurant|resto|mcdo|mcdonald|burger|kfc|sushi|pizza|deliveroo|uber eats|ubereats|just eat|brasserie|bistrot)/, "Restaurants"],
  [/(sncf|ratp|navigo|uber|bolt|blablacar|transavia|air france|easyjet|ryanair|velib|lime|tcl|tisseo)/, "Transport"],
  [/(total|esso|shell|bp |avia|station|carburant|essence)/, "Essence"],
  [/(pharmacie|docteur|medecin|dentiste|hopital|mutuelle|doctolib|ameli|laboratoire)/, "Santé"],
  [/(basic fit|basic-fit|fitness|salle de sport|decathlon|neoness|keep cool|on air)/, "Sport"],
  [/(netflix|spotify|deezer|disney|canal|amazon prime|prime video|apple com|icloud|youtube|adobe|microsoft|google storage|chatgpt|openai|notion)/, "Abonnements"],
  [/(free mobile|orange|sfr|bouygues|sosh|red by|free telecom|freebox|livebox)/, "Téléphone et Internet"],
  [/(zara|h&m|h et m|uniqlo|kiabi|celio|jules|primark|vinted|zalando|shein)/, "Vêtements"],
  [/(amazon|fnac|darty|boulanger|cdiscount|ikea|leroy merlin|castorama|action )/, "Shopping"],
  [/(cinema|ugc|pathe|gaumont|concert|spectacle|fnac spectacles|ticketmaster|steam|playstation|nintendo)/, "Loisirs"],
  [/(bar |pub |club|soiree)/, "Sorties"],
  [/(airbnb|booking|hotel|ibis|accor|abritel)/, "Voyages"],
  [/(impot|dgfip|tresor public|taxe)/, "Impôts"],
  [/(assurance|maif|macif|matmut|axa|allianz|gmf|groupama|maaf|alan)/, "Assurances"],
  [/(frais|commission|cotisation carte|agios|interets debiteurs)/, "Frais bancaires"],
  [/(edf|engie|electricite|gaz|eau |veolia|suez|total energies|totalenergies)/, "Logement"],
  [/(universite|ecole|cours|formation|udemy|coursera|librairie)/, "Études"],
];

const INCOME_HINTS: [RegExp, string][] = [
  [/(salaire|paie|payroll|remuneration)/, "Salaire"],
  [/(caf |allocation|pole emploi|france travail|apl)/, "Allocations"],
  [/(bourse|crous)/, "Bourses"],
  [/(remboursement|rembt|ameli|cpam|mutuelle)/, "Remboursements"],
  [/(interets|interet)/, "Intérêts"],
  [/(dividende)/, "Dividendes"],
  [/(loyer recu|locataire)/, "Revenus locatifs"],
  [/(facture|prestation|honoraires|malt|urssaf)/, "Revenus indépendants"],
];

export function suggestCategoryName(label: string, isIncome: boolean): string | null {
  const n = " " + normalizeLabel(label) + " ";
  const raw = " " + label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
  for (const [re, name] of isIncome ? INCOME_HINTS : CATEGORY_HINTS) if (re.test(n) || re.test(raw)) return name;
  return null;
}
