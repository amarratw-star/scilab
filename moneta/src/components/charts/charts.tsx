"use client";
/**
 * Graphiques MONETA (Recharts). Couleurs pilotées par les variables CSS du thème (clair/sombre),
 * un seul axe Y par graphique, infobulles au survol, légende pour ≥ 2 séries.
 */
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, formatPct } from "@/lib/money";
import { formatDateFR, formatDayShort, formatMonthLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

const axisProps = {
  stroke: "var(--chart-axis)",
  tick: { fill: "var(--chart-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

const compactEuro = (v: number) => formatMoney(v, undefined, { compact: true }).replace(/\s/g, " ");

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function ChartFrame({ height, children, label }: { height: number; children: React.ReactNode; label: string }) {
  const mounted = useMounted();
  return (
    <div style={{ height }} role="img" aria-label={label} className="w-full">
      {mounted ? children : <div className="h-full w-full animate-pulse rounded-xl bg-surface-2" />}
    </div>
  );
}

type TooltipRow = { name: string; value: number | string; color: string };

function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-44 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full" style={{ background: r.color }} />
            {r.name}
          </span>
          <span className="tabular font-medium text-foreground">{typeof r.value === "number" ? formatMoney(r.value) : r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted", className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.dashed ? <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} /> : <span className="size-2.5 rounded-full" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function formatX(d: string, granularity: "day" | "week" | "month") {
  if (granularity === "month") return formatMonthLabel(d.slice(0, 7), true);
  return formatDayShort(d);
}

/* ------------------------------------------------------------------ */

export function BalanceChart({ data, height = 260, totalLabel = "Patrimoine financier (tous comptes)" }: { data: { date: string; total: number; available: number }[]; height?: number; totalLabel?: string }) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <>
      <Legend className="mb-3" items={[{ label: totalLabel, color: "var(--chart-balance)" }, { label: "Disponible (courants + espèces)", color: "var(--chart-savings)" }]} />
      <ChartFrame height={height} label="Évolution des soldes">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-balance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-balance)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-balance)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => formatDayShort(d)} minTickGap={40} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatDateFR(String(label))}
                    rows={[
                      { name: totalLabel.split(" (")[0], value: Number(payload[0]?.payload.total), color: "var(--chart-balance)" },
                      { name: "Disponible", value: Number(payload[0]?.payload.available), color: "var(--chart-savings)" },
                    ]}
                  />
                ) : null
              }
            />
            <Area type="monotone" dataKey="total" stroke="var(--chart-balance)" strokeWidth={2} fill="url(#g-balance)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
            <Area type="monotone" dataKey="available" stroke="var(--chart-savings)" strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function EmptyChart({ height = 220, text = "Pas encore de données sur cette période." }: { height?: number; text?: string }) {
  return (
    <div style={{ height }} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-center text-sm text-muted">
      <svg viewBox="0 0 64 24" className="h-6 w-16 text-subtle" aria-hidden><path d="M2 20 L14 14 L26 17 L38 8 L50 11 L62 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" /></svg>
      {text}
    </div>
  );
}

export function FlowChart({ data, granularity, height = 260 }: { data: { key: string; income: number; expenses: number; savings: number }[]; granularity: "day" | "week" | "month"; height?: number }) {
  if (!data.some((d) => d.income || d.expenses)) return <EmptyChart height={height} text="Aucun revenu ni dépense sur cette période." />;
  return (
    <>
      <Legend className="mb-3" items={[{ label: "Revenus", color: "var(--chart-income)" }, { label: "Dépenses", color: "var(--chart-expense)" }, { label: "Épargne nette", color: "var(--chart-savings)", dashed: true }]} />
      <ChartFrame height={height} label="Revenus et dépenses">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="key" {...axisProps} tickFormatter={(d) => formatX(d, granularity)} minTickGap={24} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.5} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={granularity === "month" ? formatMonthLabel(String(label).slice(0, 7)) : granularity === "week" ? `Semaine du ${formatDateFR(String(label))}` : formatDateFR(String(label))}
                    rows={[
                      { name: "Revenus", value: Number(payload[0]?.payload.income), color: "var(--chart-income)" },
                      { name: "Dépenses", value: Number(payload[0]?.payload.expenses), color: "var(--chart-expense)" },
                      { name: "Épargne nette", value: Number(payload[0]?.payload.savings), color: "var(--chart-savings)" },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={400} />
            <Bar dataKey="expenses" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line type="monotone" dataKey="savings" stroke="var(--chart-savings)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function CategoryDonut({ data, total, height = 200 }: { data: { name: string; amount: number; color: string; share: number | null }[]; total: number; height?: number }) {
  const top = data.filter((d) => d.amount > 0).slice(0, 7);
  const rest = data.filter((d) => d.amount > 0).slice(7).reduce((s, d) => s + d.amount, 0);
  const rows = rest > 0 ? [...top, { name: "Autres catégories", amount: rest, color: "#94a3b8", share: total ? rest / total : null }] : top;
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[180px_1fr]">
      <ChartFrame height={height} label="Répartition des dépenses par catégorie">
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="amount" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} isAnimationActive>
                {rows.map((r) => (
                  <Cell key={r.name} fill={r.color} />
                ))}
              </Pie>
              <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipBox title={String(payload[0].name)} rows={[{ name: "Montant", value: Number(payload[0].value), color: String(payload[0].payload.color) }, { name: "Part", value: formatPct(payload[0].payload.share, 0), color: "transparent" }]} /> : null)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] text-muted">Total</span>
            <span className="tabular text-base font-semibold">{formatMoney(total, undefined, { decimals: false })}</span>
          </div>
        </div>
      </ChartFrame>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="tabular text-muted">{formatPct(r.share, 0)}</span>
            <span className="tabular w-24 text-right font-medium">{formatMoney(r.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MonthlyBars({ data, height = 260 }: { data: { month: string; income: number; expenses: number }[]; height?: number }) {
  return (
    <>
      <Legend className="mb-3" items={[{ label: "Revenus", color: "var(--chart-income)" }, { label: "Dépenses nettes", color: "var(--chart-expense)" }]} />
      <ChartFrame height={height} label="Revenus et dépenses par mois">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="month" {...axisProps} tickFormatter={(m) => formatMonthLabel(m, true)} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatMonthLabel(String(label))}
                    rows={[
                      { name: "Revenus", value: Number(payload[0].payload.income), color: "var(--chart-income)" },
                      { name: "Dépenses nettes", value: Number(payload[0].payload.expenses), color: "var(--chart-expense)" },
                      { name: "Épargne", value: Number(payload[0].payload.income) - Number(payload[0].payload.expenses), color: "var(--chart-savings)" },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Bar dataKey="expenses" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function SingleSeriesBars({ data, color = "var(--chart-expense)", height = 200, label, keyFormat = "raw" }: { data: { key: string; value: number }[]; color?: string; height?: number; label: string; keyFormat?: "raw" | "month" }) {
  const formatKey = keyFormat === "month" ? (k: string) => formatMonthLabel(k, true) : undefined;
  return (
    <ChartFrame height={height} label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="key" {...axisProps} tickFormatter={formatKey} interval={0} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => compactEuro(v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label: l }) => (active && payload?.length ? <TooltipBox title={formatKey ? formatKey(String(l)) : String(l)} rows={[{ name: label, value: Number(payload[0].value), color }]} /> : null)} />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ForecastChart({ data, height = 300, cushion }: { data: { date: string; prudent: number; normal: number; optimistic: number; low: number; high: number }[]; height?: number; cushion?: number }) {
  const rows = data.map((d) => ({ ...d, band: [d.low, d.high] as [number, number] }));
  return (
    <>
      <Legend
        className="mb-3"
        items={[
          { label: "Scénario normal", color: "var(--chart-balance)" },
          { label: "Prudent", color: "var(--chart-prudent)", dashed: true },
          { label: "Optimiste", color: "var(--chart-optimistic)", dashed: true },
          { label: "Marge d'incertitude (≈ 80 %)", color: "color-mix(in oklab, var(--chart-band) 25%, transparent)" },
        ]}
      />
      <ChartFrame height={height} label="Prévision du solde">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => formatDayShort(d)} minTickGap={40} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
            <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.6} />
            {cushion ? <ReferenceLine y={cushion} stroke="var(--warning)" strokeDasharray="2 4" label={{ value: "Coussin", fill: "var(--warning)", fontSize: 10, position: "insideTopLeft" }} /> : null}
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatDateFR(String(label))}
                    rows={[
                      { name: "Normal", value: Number(payload[0].payload.normal), color: "var(--chart-balance)" },
                      { name: "Prudent", value: Number(payload[0].payload.prudent), color: "var(--chart-prudent)" },
                      { name: "Optimiste", value: Number(payload[0].payload.optimistic), color: "var(--chart-optimistic)" },
                      { name: "Fourchette", value: `${formatMoney(payload[0].payload.low, undefined, { decimals: false })} – ${formatMoney(payload[0].payload.high, undefined, { decimals: false })}`, color: "transparent" },
                    ]}
                  />
                ) : null
              }
            />
            <Area type="monotone" dataKey="band" stroke="none" fill="var(--chart-band)" fillOpacity={0.12} isAnimationActive={false} />
            <Line type="monotone" dataKey="prudent" stroke="var(--chart-prudent)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="optimistic" stroke="var(--chart-optimistic)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="normal" stroke="var(--chart-balance)" strokeWidth={2.5} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function NetWorthChart({ data, height = 260 }: { data: { month: string; net: number; accounts: number; assets: number; liabilities: number }[]; height?: number }) {
  return (
    <ChartFrame height={height} label="Évolution du patrimoine net">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-balance)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-balance)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" {...axisProps} tickFormatter={(m) => formatMonthLabel(m, true)} />
          <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={formatMonthLabel(String(label))}
                  rows={[
                    { name: "Patrimoine net", value: Number(payload[0].payload.net), color: "var(--chart-balance)" },
                    { name: "Comptes", value: Number(payload[0].payload.accounts), color: "transparent" },
                    { name: "Autres actifs", value: Number(payload[0].payload.assets), color: "transparent" },
                    { name: "Passifs", value: -Number(payload[0].payload.liabilities), color: "transparent" },
                  ]}
                />
              ) : null
            }
          />
          <Area type="monotone" dataKey="net" stroke="var(--chart-balance)" strokeWidth={2} fill="url(#g-nw)" dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-balance)" }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function Sparkline({ values, color = "var(--chart-balance)", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ChartFrame height={height} label="Tendance">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={color} fillOpacity={0.08} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Comparaison de deux trajectoires (situation actuelle vs scénario simulé). */
export function ScenarioChart({ data, height = 260 }: { data: { label: string; current: number; simulated: number }[]; height?: number }) {
  return (
    <>
      <Legend className="mb-3" items={[{ label: "Situation actuelle", color: "var(--chart-axis)", dashed: true }, { label: "Scénario simulé", color: "var(--chart-balance)" }]} />
      <ChartFrame height={height} label="Comparaison du solde projeté">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => compactEuro(v)} />
            <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.5} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox title={String(label)} rows={[
                    { name: "Actuel", value: Number(payload[0].payload.current), color: "var(--chart-axis)" },
                    { name: "Simulé", value: Number(payload[0].payload.simulated), color: "var(--chart-balance)" },
                    { name: "Écart", value: Number(payload[0].payload.simulated) - Number(payload[0].payload.current), color: "transparent" },
                  ]} />
                ) : null
              }
            />
            <Line type="monotone" dataKey="current" stroke="var(--chart-axis)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="simulated" stroke="var(--chart-balance)" strokeWidth={2.5} dot={{ r: 2.5, fill: "var(--chart-balance)", strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}
