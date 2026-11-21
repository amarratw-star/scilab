"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BalanceChart, FlowChart } from "@/components/charts/charts";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";

export function PeriodPicker({ value, from, to, basePath }: { value: PeriodKey; from: string; to: string; basePath: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [du, setDu] = useState(from);
  const [au, setAu] = useState(to);
  const go = (params: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    if (params.periode && params.periode !== "perso") {
      next.delete("du");
      next.delete("au");
    }
    router.replace(`${basePath}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <Segmented size="sm" value={value} onChange={(v) => (v === "perso" ? go({ periode: "perso", du, au }) : go({ periode: v }))} options={PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label }))} />
      {value === "perso" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ periode: "perso", du, au });
          }}
        >
          <Input type="date" value={du} onChange={(e) => setDu(e.target.value)} className="h-8 w-auto text-xs" aria-label="Du" />
          <span className="text-xs text-muted">→</span>
          <Input type="date" value={au} onChange={(e) => setAu(e.target.value)} className="h-8 w-auto text-xs" aria-label="Au" />
          <Button size="sm" variant="secondary" type="submit">Appliquer</Button>
        </form>
      )}
    </div>
  );
}

export function DashboardChart({ balances, flows, granularity, totalLabel }: { balances: { date: string; total: number; available: number }[]; flows: { key: string; income: number; expenses: number; savings: number }[]; granularity: "day" | "week" | "month"; totalLabel?: string }) {
  const [view, setView] = useState<"soldes" | "flux">("soldes");
  return (
    <div>
      <div className="mb-3">
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: "soldes", label: "Solde et patrimoine" }, { value: "flux", label: "Revenus · Dépenses · Épargne" }]} />
      </div>
      {view === "soldes" ? <BalanceChart data={balances} totalLabel={totalLabel} /> : <FlowChart data={flows} granularity={granularity} />}
    </div>
  );
}
