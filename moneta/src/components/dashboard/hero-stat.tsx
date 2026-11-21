import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { InfoTip } from "@/components/ui/tooltip";
import { formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";

export type Trend = { kind: "pct"; value: number; good: boolean; label: string } | { kind: "text"; text: string; good: boolean | null } | null;

/** Indicateur principal : montant très lisible, définition, tendance comparable, accès au détail. */
export function HeroStat({ label, value, definition, tip, trend, href, hrefLabel = "Détails", accent, hint }: { label: string; value: React.ReactNode; definition: string; tip?: React.ReactNode; trend: Trend; href: string; hrefLabel?: string; accent: "info" | "negative" | "positive" | "savings"; hint?: React.ReactNode }) {
  const dot = { info: "bg-info", negative: "bg-negative", positive: "bg-positive", savings: "bg-[var(--chart-savings)]" }[accent];
  return (
    <div className="card-interactive group relative flex min-w-0 flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        <span className={cn("size-2 rounded-full", dot)} aria-hidden />
        <span className="truncate">{label}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className="amount-hero mt-2 truncate text-[26px] sm:text-[30px]">{value}</div>
      <p className="mt-1 line-clamp-2 text-xs text-subtle">{definition}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <TrendChip trend={trend} />
        <Link href={href} className="flex items-center gap-0.5 rounded-md text-xs font-medium text-muted transition hover:text-foreground" aria-label={`${hrefLabel} : ${label}`}>
          {hrefLabel} <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function TrendChip({ trend }: { trend: Trend }) {
  if (!trend) return <span className="text-[11px] text-subtle">Pas de comparaison possible</span>;
  if (trend.kind === "text") {
    return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", trend.good === null ? "bg-surface-2 text-muted" : trend.good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")}>{trend.text}</span>;
  }
  const Icon = trend.value > 0.005 ? ArrowUpRight : trend.value < -0.005 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium", trend.good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")} title={trend.label}>
      <Icon className="size-3" aria-hidden />
      {formatPct(trend.value, 0, true)}
      <span className="sr-only"> {trend.label}</span>
    </span>
  );
}

/** Indicateur secondaire, plus discret. */
export function MiniStat({ label, value, sub, tip, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tip?: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-1 text-xs text-muted">
        {href ? <Link href={href} className="hover:text-foreground hover:underline">{label}</Link> : label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className="mt-1 truncate text-lg font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-subtle">{sub}</div>}
    </>
  );
  return <div className="min-w-0 rounded-2xl border border-border bg-surface/60 px-4 py-3">{inner}</div>;
}
