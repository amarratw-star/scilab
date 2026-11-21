"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ChevronRight } from "lucide-react";
import { formatMoney, formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";

export type CategoryRow = { categoryId: string | null; name: string; color: string; amount: number; share: number | null; previous: number };

/** Répartition interactive : survol = mise en avant, clic = opérations de la catégorie. */
export function CategoryBreakdown({ rows, total, from, to }: { rows: CategoryRow[]; total: number; from: string; to: string }) {
  const router = useRouter();
  const [active, setActive] = useState<number | null>(null);
  const top = rows.filter((r) => r.amount > 0).slice(0, 6);
  const rest = rows.filter((r) => r.amount > 0).slice(6);
  const restRow: CategoryRow | null = rest.length ? { categoryId: "__autres", name: `Autres (${rest.length})`, color: "var(--subtle)", amount: rest.reduce((s, r) => s + r.amount, 0), previous: rest.reduce((s, r) => s + r.previous, 0), share: total ? rest.reduce((s, r) => s + r.amount, 0) / total : null } : null;
  const data = restRow ? [...top, restRow] : top;
  const go = (r: CategoryRow) => {
    if (r.categoryId === "__autres") return router.push(`/analyses`);
    router.push(`/transactions?categorie=${r.categoryId ?? "none"}&periode=perso&du=${from}&au=${to}`);
  };
  const focused = active !== null ? data[active] : null;
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[176px_1fr]">
      <div className="relative mx-auto size-44" role="img" aria-label="Répartition des dépenses par catégorie">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} onMouseLeave={() => setActive(null)} onMouseEnter={(_, i) => setActive(i)} onClick={(_, i) => go(data[i])} isAnimationActive={false} cursor="pointer">
              {data.map((r, i) => <Cell key={r.name} fill={r.color} opacity={active === null || active === i ? 1 : 0.35} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="truncate text-[11px] text-muted">{focused ? focused.name : "Total du mois"}</span>
          <span className="tabular text-base font-semibold">{formatMoney(focused ? focused.amount : total, undefined, { decimals: false })}</span>
          {focused && <span className="text-[11px] text-subtle">{formatPct(focused.share, 0)}</span>}
        </div>
      </div>
      <ul className="min-w-0 space-y-0.5">
        {data.map((r, i) => {
          const delta = r.previous > 0 ? (r.amount - r.previous) / r.previous : null;
          return (
            <li key={r.name}>
              <button onClick={() => go(r)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} className={cn("group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition", active === i && "bg-surface-2")} aria-label={`${r.name} : ${formatMoney(r.amount)}, voir les opérations`}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="hidden w-14 text-right text-xs tabular sm:inline">{delta === null ? <span className="text-subtle">—</span> : <span className={delta > 0.05 ? "text-negative" : delta < -0.05 ? "text-positive" : "text-muted"}>{formatPct(delta, 0, true)}</span>}</span>
                <span className="w-10 text-right text-xs tabular text-muted">{formatPct(r.share, 0)}</span>
                <span className="w-24 text-right font-medium tabular">{formatMoney(r.amount)}</span>
                <ChevronRight className="size-3.5 shrink-0 text-subtle opacity-0 transition group-hover:opacity-100" />
              </button>
            </li>
          );
        })}
        <li className="px-2 pt-1 text-[11px] text-subtle">Évolution vs même période du mois précédent · clique pour voir les opérations</li>
      </ul>
    </div>
  );
}
