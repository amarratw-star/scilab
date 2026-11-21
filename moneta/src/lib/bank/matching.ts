/**
 * Rapprochements — fonctions pures.
 *  - Doublon manuel ↔ bancaire : même compte, même sens, même montant, dates proches, libellés apparentés.
 *  - Opération « à venir » remplacée par sa version comptabilisée sous un autre identifiant.
 *  - Virement interne : débit sur un compte, crédit du même montant sur un autre compte de l'utilisateur.
 */
import { normalizeLabel } from "@/lib/finance/labels";

export interface MatchTx {
  id: string;
  accountId: string;
  date: string; // AAAA-MM-JJ
  amount: number; // centimes, signé (−dépense, +entrée)
  label: string;
  merchant?: string | null;
}

const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000;

function labelSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeLabel(a).split(" ").filter((w) => w.length >= 3));
  const wb = new Set(normalizeLabel(b).split(" ").filter((w) => w.length >= 3));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w) || [...wb].some((x) => x.startsWith(w) || w.startsWith(x))) inter++;
  return inter / Math.min(wa.size, wb.size);
}

/** Score 0–100 de probabilité qu'une opération manuelle et une opération bancaire soient la même. */
export function duplicateScore(manual: MatchTx, bank: MatchTx): number {
  if (manual.accountId !== bank.accountId || Math.sign(manual.amount) !== Math.sign(bank.amount)) return 0;
  const diff = Math.abs(manual.amount - bank.amount);
  if (diff > Math.max(1, Math.abs(bank.amount) * 0.01)) return 0; // montant identique (±1 %, arrondis)
  const days = Math.abs(day(manual.date) - day(bank.date));
  if (days > 5) return 0;
  const dateScore = days === 0 ? 30 : days === 1 ? 25 : days <= 3 ? 15 : 5;
  const lab = Math.max(labelSimilarity(`${manual.merchant ?? ""} ${manual.label}`, `${bank.merchant ?? ""} ${bank.label}`), 0);
  return Math.min(100, 50 + dateScore + Math.round(lab * 20) - (diff > 0 ? 5 : 0));
}

export const AUTO_MERGE_SCORE = 80;
export const SUGGEST_SCORE = 55;

/**
 * Décision pour une nouvelle opération bancaire :
 *  - "auto"    : un seul candidat manuel très probable ET aucune autre opération bancaire concurrente → fusion automatique traçable et réversible ;
 *  - "suggest" : candidat plausible ou ambigu (montants identiques légitimes possibles) → proposition à l'utilisateur ;
 *  - "none".
 */
export function decideDuplicate(bank: MatchTx, manualCandidates: MatchTx[], otherBankSameDay: MatchTx[]): { decision: "auto" | "suggest" | "none"; candidate: MatchTx | null; score: number } {
  const scored = manualCandidates.map((m) => ({ m, s: duplicateScore(m, bank) })).filter((x) => x.s >= SUGGEST_SCORE).sort((a, b) => b.s - a.s);
  if (!scored.length) return { decision: "none", candidate: null, score: 0 };
  const best = scored[0];
  const ambiguous = scored.filter((x) => x.s >= best.s - 10).length > 1 || otherBankSameDay.some((o) => o.id !== bank.id && duplicateScore(best.m, o) >= SUGGEST_SCORE);
  return { decision: best.s >= AUTO_MERGE_SCORE && !ambiguous ? "auto" : "suggest", candidate: best.m, score: best.s };
}

/** Opération en attente remplacée par une opération comptabilisée (même compte, même montant, ≤ 7 jours d'écart). */
export function findSupersededPending(booked: MatchTx, pendings: MatchTx[]): MatchTx | null {
  const c = pendings
    .filter((p) => p.accountId === booked.accountId && p.amount === booked.amount && Math.abs(day(p.date) - day(booked.date)) <= 7)
    .sort((a, b) => Math.abs(day(a.date) - day(booked.date)) - Math.abs(day(b.date) - day(booked.date)));
  return c[0] ?? null;
}

/** Virement interne : débit et crédit opposés entre deux comptes distincts de l'utilisateur, à ≤ 3 jours. */
export function findTransferPair(debit: MatchTx, credits: MatchTx[]): MatchTx | null {
  if (debit.amount >= 0) return null;
  const c = credits
    .filter((x) => x.accountId !== debit.accountId && x.amount === -debit.amount && Math.abs(day(x.date) - day(debit.date)) <= 3)
    .sort((a, b) => Math.abs(day(a.date) - day(debit.date)) - Math.abs(day(b.date) - day(debit.date)));
  return c[0] ?? null;
}
