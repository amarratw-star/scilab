import { cn } from "@/lib/utils";

/** Barre de progression. `value` entre 0 et 1 (peut dépasser 1 : la barre est alors pleine et colorée). */
export function Progress({ value, tone = "auto", className, label }: { value: number | null; tone?: "auto" | "positive" | "info" | "neutral"; className?: string; label?: string }) {
  const v = value ?? 0;
  const pct = Math.max(0, Math.min(1, v)) * 100;
  const color =
    tone === "positive" ? "bg-positive" : tone === "info" ? "bg-info" : tone === "neutral" ? "bg-foreground" : v > 1 ? "bg-negative" : v >= 0.9 ? "bg-negative" : v >= 0.75 ? "bg-warning" : "bg-positive";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
