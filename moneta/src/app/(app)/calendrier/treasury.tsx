import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { Finance } from "@/server/services/snapshot";
import { computeForecast, liquidScope } from "@/server/services/overview";
import { scheduledItems } from "@/lib/finance/recurring";
import { scopeDelta } from "@/lib/finance/ledger";
import { addDays, formatDateFR, formatDateLong, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/misc";
import { ForecastChart } from "@/components/charts/charts";
import { cn } from "@/lib/utils";

const HORIZONS = [7, 30, 90, 365] as const;

type Ev = { key: string; date: ISODate; label: string; sub: string; delta: number; status: "confirmed" | "planned"; type: "in" | "out" | "transfer" };

/** Trésorerie à venir : flux connus datés, solde prévisionnel et jours à risque (comptes disponibles). */
export function Treasury({ fin, today, horizonParam, cushion, month }: { fin: Finance; today: ISODate; horizonParam?: string; cushion: number; month: string }) {
  const probe = computeForecast(fin, today, 365, "liquid");
  const max = probe.reliability === "insufficient" ? 30 : probe.reliability === "limited" ? 90 : 365;
  let horizon = HORIZONS.find((h) => h === Number(horizonParam)) ?? 30;
  if (horizon > max) horizon = max;
  const f = computeForecast(fin, today, horizon, "liquid");
  const scope = liquidScope(fin);
  const end = addDays(today, horizon);
  const events: Ev[] = [];
  for (const it of scheduledItems(fin.rules, fin.txs, today, end)) {
    if (it.realized) continue;
    const d = scopeDelta({ id: it.ruleId, kind: it.kind, status: "posted", amount: it.amount, accountId: it.accountId, toAccountId: it.toAccountId, categoryId: it.categoryId, date: it.date }, scope);
    if (d === 0) continue;
    events.push({ key: it.ruleId + it.date, date: it.date, label: it.name, sub: it.kind === "income" ? "Revenu attendu" : it.kind === "transfer" ? "Versement d'épargne programmé" : it.isSubscription ? "Abonnement" : "Prélèvement / facture", delta: d, status: "planned", type: it.kind === "income" ? "in" : it.kind === "transfer" ? "transfer" : "out" });
  }
  for (const t of fin.txs) {
    if (t.date <= today || t.date > end || t.status === "cancelled") continue;
    const d = scopeDelta(t, scope, "posted+planned");
    if (d === 0) continue;
    events.push({ key: t.id, date: t.date, label: t.merchant || t.description || "Opération", sub: t.status === "planned" ? "Dépense ou revenu prévu" : "Enregistrée, date future", delta: d, status: t.status === "posted" ? "confirmed" : "planned", type: t.kind === "transfer" ? "transfer" : d > 0 ? "in" : "out" });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pointByDate = new Map(f.points.map((p) => [p.date, p]));
  const risky = f.points.filter((p) => p.date > today && (p.normal < 0 || (cushion > 0 && p.normal < cushion)));
  const firstRisk = risky[0];
  const totalIn = events.filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const totalOut = events.filter((e) => e.delta < 0).reduce((s, e) => s - e.delta, 0);

  return (
    <section className="mb-8 space-y-4" aria-label="Trésorerie à venir">
      <div className="flex flex-wrap items-center gap-2">
        {HORIZONS.map((h) => (
          <Link key={h} href={`/calendrier?horizon=${h}&mois=${month}`} scroll={false} aria-disabled={h > max} className={cn("rounded-full border px-3 py-1 text-sm", h === horizon ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted hover:text-foreground", h > max && "pointer-events-none opacity-40")}>{h === 365 ? "12 mois" : `${h} jours`}</Link>
        ))}
        {max < 365 && <span className="text-xs text-subtle">Horizon limité : historique encore court.</span>}
      </div>
      {firstRisk ? (
        <Callout tone={firstRisk.normal < 0 ? "negative" : "warning"} icon={<AlertTriangle />} title={firstRisk.normal < 0 ? `Solde prévisionnel négatif dès le ${formatDateFR(firstRisk.date)}` : `Solde sous ton montant de sécurité dès le ${formatDateFR(firstRisk.date)}`}>
          {risky.length} jour(s) à risque sur la période · point bas estimé : {formatMoney(f.lowestNormal.balance)} le {formatDateFR(f.lowestNormal.date)}. Anticipe en décalant une dépense ou en réduisant les dépenses variables.
        </Callout>
      ) : (
        <Callout tone="positive" icon={<CheckCircle2 />} title="Aucun jour à risque identifié sur la période">Point bas estimé : {formatMoney(f.lowestNormal.balance)} le {formatDateFR(f.lowestNormal.date)} (scénario normal).</Callout>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Solde disponible prévisionnel</CardTitle>
              <CardDescription>Réel aujourd&apos;hui ({formatMoney(f.startBalance)}), puis estimation : flux connus + dépenses courantes moyennes{f.reliability === "insufficient" ? " (non projetées : historique trop court)" : ""}.</CardDescription>
            </div>
          </CardHeader>
          <CardContent><ForecastChart data={f.points} cushion={cushion || undefined} height={260} /></CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Chronologie des mouvements</CardTitle>
              <CardDescription>
                <span className="text-positive">+{formatMoney(totalIn, undefined, { decimals: false })}</span> attendus · <span className="text-negative">−{formatMoney(totalOut, undefined, { decimals: false })}</span> prévus
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="max-h-[420px] flex-1 overflow-y-auto">
            {events.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucun mouvement connu sur la période. Ajoute tes revenus et charges récurrents dans Abonnements.</p> : (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {events.slice(0, 60).map((e) => {
                  const Icon = e.type === "in" ? ArrowDownLeft : e.type === "transfer" ? ArrowLeftRight : ArrowUpRight;
                  const p = pointByDate.get(e.date);
                  return (
                    <li key={e.key} className="relative">
                      <span className={cn("absolute -left-[23px] top-1 flex size-3.5 items-center justify-center rounded-full ring-4 ring-surface", e.type === "in" ? "bg-positive" : e.type === "transfer" ? "bg-[var(--chart-savings)]" : "bg-negative")} />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] capitalize text-subtle">{formatDateLong(e.date)}</p>
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium"><Icon className="size-3.5 shrink-0 text-muted" />{e.label}</p>
                          <p className="text-xs text-subtle">{e.sub}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("text-sm font-semibold tabular", e.delta > 0 && "text-positive")}>{formatMoney(e.delta, undefined, { signed: true })}</p>
                          <Badge tone={e.status === "confirmed" ? "positive" : "info"}>{e.status === "confirmed" ? "Confirmée" : "Prévue"}</Badge>
                          {p && <p className="mt-0.5 text-[10px] text-subtle tabular">solde estimé {formatMoney(p.normal, undefined, { decimals: false })}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-subtle">Légende : <strong>Confirmée</strong> = opération enregistrée datée dans le futur · <strong>Prévue</strong> = échéance récurrente ou opération planifiée · le « solde estimé » inclut en plus une estimation des dépenses courantes. Aucune projection n&apos;est une garantie.</p>
    </section>
  );
}
