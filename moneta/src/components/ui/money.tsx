"use client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Affiche un montant (centimes). `tone="auto"` colore selon le signe ; `kind` force la couleur d'un type d'opération. */
export function Money({ cents, currency, signed, tone = "none", compact, className }: { cents: number | null | undefined; currency?: string; signed?: boolean; tone?: "none" | "auto" | "positive" | "negative"; compact?: boolean; className?: string }) {
  const color =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : tone === "auto" && cents ? (cents > 0 ? "text-positive" : "text-negative") : "";
  return <span className={cn("tabular whitespace-nowrap", color, className)}>{formatMoney(cents, currency, { signed, compact })}</span>;
}
