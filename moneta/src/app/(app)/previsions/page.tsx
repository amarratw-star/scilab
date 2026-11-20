import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { computeForecast } from "@/server/services/overview";
import { SCENARIOS } from "@/lib/finance/forecast";
import { formatDateFR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ForecastChart } from "@/components/charts/charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Prévisions" };

const HORIZONS = [[7, "7 jours"], [30, "30 jours"], [90, "3 mois"], [180, "6 mois"], [365, "12 mois"]] as const;

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
  const scope = sp.perimetre === "tous" ? "all" : "liquid";
  let horizon = Number(sp.horizon) || 90;
  if (!HORIZONS.some(([h]) => h === horizon)) horizon = 90;
  const full = computeForecast(fin, today, 365, scope);
  // Avec peu d'historique, on limite l'horizon proposé pour ne pas afficher de projection trop ambitieuse.
  const maxHorizon = full.reliability === "insufficient" ? 30 : full.reliability === "limited" ? 90 : 365;
  if (horizon > maxHorizon) horizon = maxHorizon;
  const f = computeForecast(fin, today, horizon, scope);
  const end = f.points[f.points.length - 1];
  const qs = (h: number, p = sp.perimetre ?? "") => `/previsions?horizon=${h}${p ? `&perimetre=${p}` : ""}`;
  return (
    <div>
      <PageHeader title="Prévisions" description="Où en seront tes comptes ? Une projection, jamais une garantie." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {HORIZONS.map(([h, l]) => (
          <Link key={h} href={qs(h)} aria-disabled={h > maxHorizon} className={cn("rounded-full border px-3 py-1 text-sm", h === horizon ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted hover:text-foreground", h > maxHorizon && "pointer-events-none opacity-40")}>{l}</Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <Link href={qs(horizon, "")} className={cn("rounded-full border px-3 py-1 text-sm", scope === "liquid" ? "border-foreground bg-foreground text-background" : "border-border text-muted")}>Argent disponible</Link>
        <Link href={qs(horizon, "tous")} className={cn("rounded-full border px-3 py-1 text-sm", scope === "all" ? "border-foreground bg-foreground text-background" : "border-border text-muted")}>Tous les comptes</Link>
      </div>
      {f.reliability === "insufficient" && <Callout tone="warning" icon={<AlertTriangle />} className="mb-5" title="Historique insuffisant">Moins de 3 semaines d&apos;opérations : les dépenses courantes ne sont pas projetées et l&apos;horizon est limité à 30 jours. La courbe ne reflète que les échéances connues.</Callout>}
      {f.reliability === "limited" && <Callout tone="info" icon={<Info />} className="mb-5" title="Fiabilité limitée">Moins de 2 mois d&apos;historique : horizon limité à 3 mois.</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 rounded-[var(--radius-card)] border border-border bg-surface p-5 lg:col-span-1">
          <p className="text-[13px] text-muted">Solde réel aujourd&apos;hui</p>
          <p className="tabular mt-1 text-2xl font-semibold">{formatMoney(f.startBalance)}</p>
        </div>
        {f.milestones.concat(f.milestones.some((m) => m.days === horizon) ? [] : [{ days: horizon, date: end.date, prudent: end.prudent, normal: end.normal, optimistic: end.optimistic, low: end.low, high: end.high }]).map((m) => (
          <div key={m.days} className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <p className="text-[13px] text-muted">Dans {m.days} jours <span className="text-subtle">({formatDateFR(m.date)})</span></p>
            <p className={`tabular mt-1 text-2xl font-semibold ${m.normal < 0 ? "text-negative" : ""}`}>{formatMoney(m.normal, "EUR", { decimals: false })}</p>
            <p className="tabular text-xs text-subtle">entre {formatMoney(m.low, "EUR", { decimals: false })} et {formatMoney(m.high, "EUR", { decimals: false })}</p>
          </div>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader><div><CardTitle>Solde prévisionnel — {scope === "liquid" ? "argent disponible" : "tous les comptes"}</CardTitle><CardDescription>Fiabilité : <Badge tone={f.reliability === "good" ? "positive" : "warning"}>{f.reliability === "good" ? "bonne" : f.reliability === "limited" ? "limitée" : "insuffisante"}</Badge></CardDescription></div></CardHeader>
        <CardContent><ForecastChart data={f.points} cushion={scope === "liquid" ? settings.safetyCushion : undefined} /></CardContent>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Points d&apos;attention</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Point le plus bas (scénario normal) : <strong className={f.lowestNormal.balance < 0 ? "text-negative" : ""}>{formatMoney(f.lowestNormal.balance)}</strong> le {formatDateFR(f.lowestNormal.date)}.</p>
            <p>{f.firstNegativePrudent ? <span className="text-negative">Dans le scénario prudent, le solde passerait sous zéro le {formatDateFR(f.firstNegativePrudent)}.</span> : "Le solde reste positif même dans le scénario prudent."}</p>
            <p className="text-muted">Flux connus sur la période : {formatMoney(f.scheduledIncome)} de revenus prévus, {formatMoney(f.scheduledOutflows)} de sorties prévues.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Hypothèses</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted">{f.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <ul className="mt-3 space-y-1 text-sm">{Object.values(SCENARIOS).map((s) => <li key={s.label}><strong>{s.label}</strong> : <span className="text-muted">{s.description}</span></li>)}</ul>
            <p className="mt-3 text-xs text-subtle">La marge d&apos;incertitude est un intervalle statistique indicatif (≈ 80 %), pas une garantie.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
