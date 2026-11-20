"use client";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BarChart3, Gauge, Target } from "lucide-react";
import { useQuickAdd } from "./app-shell";
import type { QuickAddPreset } from "@/components/forms/quick-add";

export function QuickActions() {
  const open = useQuickAdd();
  const btn = "flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface px-2 py-3 text-[12px] font-medium text-foreground transition hover:border-border-strong hover:bg-surface-2 active:scale-[0.98] [&_svg]:size-[18px]";
  const actions: [string, React.ReactNode, QuickAddPreset][] = [
    ["Dépense", <ArrowUpRight key="e" className="text-negative" />, { kind: "expense" }],
    ["Revenu", <ArrowDownLeft key="i" className="text-positive" />, { kind: "income" }],
    ["Transfert", <ArrowLeftRight key="t" className="text-info" />, { kind: "transfer" }],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {actions.map(([label, icon, preset]) => (
        <button key={label} className={btn} onClick={() => open(preset)}>
          {icon}
          {label}
        </button>
      ))}
      <Link href="/epargne?nouveau=1" className={btn}><Target className="text-[var(--chart-savings)]" />Objectif</Link>
      <Link href="/budgets" className={btn}><Gauge className="text-warning" />Budgets</Link>
      <Link href="/analyses" className={btn}><BarChart3 className="text-muted" />Analyses</Link>
    </div>
  );
}
