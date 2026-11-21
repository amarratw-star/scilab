import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { chartSeries } from "@/server/services/views";
import { addDays, addMonths, endOfMonth, formatDateFR, formatMonthLabel, isValidISODate, startOfMonth, startOfYear, weekdayName, type ISODate } from "@/lib/dates";
import { comparablePreviousPeriod, expensesByCategory, incomeByCategory, monthlySeries, periodTotals, spendingByWeekday, topExpenses } from "@/lib/finance/stats";
import { categoryTrends, detectRecurringPayments, recommendations, unusualExpenses } from "@/lib/finance/insights";
import { formatMoney, formatPct, pctChange } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { BalanceChart, CategoryDonut, MonthlyBars, SingleSeriesBars } from "@/components/charts/charts";
import { AnalysisPeriod } from "./period";
import { savingsOpportunities } from "@/lib/finance/opportunities";
import { PiggyBank } from "lucide-react";
import Link2 from "next/link";

export const metadata: Metadata = { title: "Analyse financière" };

const PRESETS = ["mois", "mois-precedent", "3m", "6m", "12m", "annee", "annee-precedente", "perso"] as const;

function range(key: string, today: ISODate, du?: string, au?: string) {
  switch (key) {
    case "mois-precedent": {
      const f = startOfMonth(addMonths(today, -1));
      return { from: f, to: endOfMonth(f) };
    }
    case "3m":
    case "6m":
    case "12m": {
      const n = Number(key.replace("m", ""));
      return { from: startOfMonth(addMonths(today, -n)), to: addDays(startOfMonth(today), -1) };
    }
    case "annee":
      return { from: startOfYear(today), to: today };
    case "annee-precedente": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "perso":
      if (du && au && isValidISODate(du) && isValidISODate(au) && du <= au) return { from: du, to: au > today ? today : au };
      return { from: startOfMonth(today), to: today };
    default:
      return { from: startOfMonth(today), to: today };
  }
}

function Change({ cur, prev, inverse }: { cur: number; prev: number; inverse?: boolean }) {
  const c = pctChange(cur, prev);
  if (c === null) return <span className="text-subtle">—</span>;
  const good = inverse ? c <= 0 : c >= 0;
  return <span className={good ? "text-positive" : "text-negative"}>{formatPct(c, 0, true)}</span>;
}

export default async function AnalysesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const key = PRESETS.find((p) => p === sp.periode) ?? "mois";
  const { from, to } = range(key, today, sp.du, sp.au);
  const prev = comparablePreviousPeriod(from, to);
  const cur = periodTotals(fin.txs, from, to, fin.cmap);
  const before = periodTotals(fin.txs, prev.from, prev.to, fin.cmap);
  const cats = expensesByCategory(fin.txs, from, to, fin.cmap);
  const incomes = incomeByCategory(fin.txs, from, to, fin.cmap);
  const trends = categoryTrends(fin.txs, from, to, fin.cmap).filter((t) => t.current || t.previous).slice(0, 12);
  const unusual = unusualExpenses(fin.txs, from, to, fin.cmap);
  const exceptional = unusual.reduce((s, u) => s + u.tx.amount, 0);
  const weekdays = spendingByWeekday(fin.txs, from, to);
  const maxWd = weekdays.reduce((m, w) => (w.average > m.average ? w : m), weekdays[0]);
  const series12 = monthlySeries(fin.txs, startOfMonth(addMonths(today, -11)), today);
  const months = Math.max(1, cur.days / 30.4375);
  const top = topExpenses(fin.txs, from, to, 8);
  const recurring = detectRecurringPayments(fin.txs, fin.rules, today).slice(0, 6);
  const recos = recommendations({ txs: fin.txs, cats: fin.cmap, today, rules: fin.rules });
  const opps = savingsOpportunities({ txs: fin.txs, cats: fin.cmap, rules: fin.rules, reviewed: new Map(fin.ruleRows.map((r) => [r.id, r.lastReviewedAt])), today });
  const oppTotal = opps.filter((o) => o.kind !== "trend").reduce((s, o) => s + o.annualSaving, 0);
  const balance = chartSeries(fin, from, to, "day").balances;
  const yoyFrom = `${Number(today.slice(0, 4)) - 1}${startOfYear(today).slice(4)}`;
  const yoy = { cur: periodTotals(fin.txs, startOfYear(today), today, fin.cmap), prev: periodTotals(fin.txs, yoyFrom, `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, fin.cmap) };
  const busiest = series12.filter((m) => m.expenses > 0).sort((a, b) => b.expenses - a.expenses)[0];

  return (
    <div>
      <PageHeader title="Analyse financière" description={`Du ${formatDateFR(from)} au ${formatDateFR(to)} · comparé au ${formatDateFR(prev.from)} → ${formatDateFR(prev.to)}`} />
      <AnalysisPeriod value={key} from={from} to={to} />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total des dépenses" accent="negative" value={<Money cents={cur.netExpenses} />} hint={<>vs {formatMoney(before.netExpenses)} · <Change cur={cur.netExpenses} prev={before.netExpenses} inverse /></>} />
        <Stat label="Total des revenus" accent="positive" value={<Money cents={cur.income} />} hint={<>vs {formatMoney(before.income)} · <Change cur={cur.income} prev={before.income} /></>} />
        <Stat label="Taux d'épargne" value={formatPct(cur.savingsRate)} hint={`Épargne nette : ${formatMoney(cur.netSavings)}`} />
        <Stat label="Moyenne quotidienne" value={<Money cents={cur.dailyAverageExpense} />} hint={`≈ ${formatMoney(Math.round(cur.netExpenses / months))} par mois`} />
        <Stat label="Dépenses fixes" value={<Money cents={cur.fixedExpenses} />} hint="Récurrentes ou catégories fixes" />
        <Stat label="Dépenses variables" value={<Money cents={cur.variableExpenses} />} />
        <Stat label="Dépenses exceptionnelles" accent="warning" value={<Money cents={exceptional} />} hint={`${unusual.length} dépense(s) inhabituelle(s)`} />
        <Stat label="Remboursements reçus" value={<Money cents={cur.refunds} />} hint={`Dépenses brutes : ${formatMoney(cur.grossExpenses)}`} />
      </div>

      <Card id="opportunites" className="mt-6 scroll-mt-24">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><PiggyBank className="size-4 text-positive" /> Opportunités d&apos;économies</CardTitle>
            <CardDescription>{opps.length ? `Jusqu'à ${formatMoney(oppTotal, undefined, { decimals: false })} par an au total si tout était appliqué — estimations calculées sur tes dépenses réelles, pas des garanties.` : "Calculées sur les 3 derniers mois complets."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {opps.length === 0 ? <p className="text-sm text-muted">Aucune opportunité identifiée : il faut au moins un mois complet de dépenses, avec des postes variables d&apos;au moins 30 € par mois.</p> : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {opps.map((o) => (
                <Link2 key={o.id} href={o.href} className="card-interactive rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{o.title}</p><Badge tone="positive" className="shrink-0">≈ {formatMoney(o.annualSaving, undefined, { decimals: false })}{o.kind === "trend" ? " ce mois" : "/an"}</Badge></div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{o.detail}</p>
                  <p className="mt-1.5 text-[11px] text-subtle">Base : {o.evidence}</p>
                </Link2>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Revenus et dépenses — 12 derniers mois</CardTitle><CardDescription>{busiest ? `Mois le plus dépensier : ${formatMonthLabel(busiest.month)} (${formatMoney(busiest.expenses)})` : ""}</CardDescription></div></CardHeader>
          <CardContent><MonthlyBars data={series12} /></CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Évolution des soldes</CardTitle><CardDescription>Sur la période analysée</CardDescription></div></CardHeader>
          <CardContent><BalanceChart data={balance} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Répartition par catégorie</CardTitle></CardHeader>
          <CardContent>{cats.length ? <CategoryDonut data={cats} total={cur.netExpenses} /> : <p className="py-8 text-center text-sm text-muted">Aucune dépense sur la période.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Catégories : évolution</CardTitle><CardDescription>Comparées à la période précédente comparable et à la moyenne des 3 mois précédents</CardDescription></div></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-sm">
              <thead><tr className="text-left text-xs text-subtle"><th className="pb-2 font-medium">Catégorie</th><th className="pb-2 text-right font-medium">Période</th><th className="pb-2 text-right font-medium">Avant</th><th className="pb-2 text-right font-medium">Moy. 3 mois</th><th className="pb-2 text-right font-medium">Évol.</th></tr></thead>
              <tbody className="divide-y divide-border">
                {trends.map((t) => (
                  <tr key={t.categoryId ?? "none"}>
                    <td className="py-2"><Link href={`/transactions?categorie=${t.categoryId ?? "none"}&periode=perso&du=${from}&au=${to}`} className="hover:underline">{t.name}</Link></td>
                    <td className="tabular py-2 text-right">{formatMoney(t.current, undefined, { decimals: false })}</td>
                    <td className="tabular py-2 text-right text-muted">{formatMoney(t.previous, undefined, { decimals: false })}</td>
                    <td className="tabular py-2 text-right text-muted">{t.average3 === null ? "—" : formatMoney(t.average3, undefined, { decimals: false })}</td>
                    <td className="tabular py-2 text-right"><Change cur={t.current} prev={t.previous} inverse /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Jours où tu dépenses le plus</CardTitle><CardDescription>Dépense moyenne par jour de la semaine{maxWd?.average ? ` · pic le ${weekdayName(maxWd.weekday)}` : ""}</CardDescription></div></CardHeader>
          <CardContent><SingleSeriesBars data={weekdays.map((w) => ({ key: weekdayName(w.weekday).slice(0, 3), value: w.average }))} label="Dépense moyenne" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Comparaisons</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[
              ["Période analysée vs précédente comparable", cur, before],
              ["Année en cours vs même période l'an dernier", yoy.cur, yoy.prev],
            ].map(([label, a, b]) => {
              const x = a as typeof cur;
              const y = b as typeof cur;
              return (
                <div key={label as string}>
                  <p className="mb-1.5 font-medium">{label as string}</p>
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-xs">
                    <div><p className="text-subtle">Revenus</p><p className="tabular font-medium">{formatMoney(x.income, undefined, { decimals: false })}</p><Change cur={x.income} prev={y.income} /></div>
                    <div><p className="text-subtle">Dépenses</p><p className="tabular font-medium">{formatMoney(x.netExpenses, undefined, { decimals: false })}</p><Change cur={x.netExpenses} prev={y.netExpenses} inverse /></div>
                    <div><p className="text-subtle">Épargne</p><p className="tabular font-medium">{formatMoney(x.netSavings, undefined, { decimals: false })}</p><Change cur={x.netSavings} prev={y.netSavings} /></div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-subtle">Revenus par source : {incomes.map((i) => `${i.name} ${formatMoney(i.amount, undefined, { decimals: false })}`).join(" · ") || "aucun"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-warning" /> Recommandations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {recos.length === 0 && <p className="text-sm text-muted">Pas de recommandation pour l&apos;instant : il faut généralement au moins 3 mois d&apos;historique.</p>}
            {recos.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-sm text-muted">{r.detail}</p>
                <p className="mt-1.5 text-[11px] text-subtle">Base : {r.evidence} Estimation, pas une garantie.</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Dépenses inhabituelles</CardTitle></CardHeader>
            <CardContent>
              {unusual.length === 0 ? <p className="text-sm text-muted">Aucune anomalie détectée sur la période.</p> : (
                <ul className="space-y-2 text-sm">{unusual.slice(0, 6).map((u) => <li key={u.tx.id}><span className="font-medium">{formatDateFR(u.tx.date)} · {u.tx.merchant || u.tx.description}</span><span className="block text-xs text-muted">{u.reason}</span></li>)}</ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Plus grosses dépenses</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">{top.map((t) => <li key={t.id} className="flex justify-between gap-3 py-2"><span className="truncate">{formatDateFR(t.date)} · {t.merchant || t.description || fin.cmap.get(t.categoryId ?? "")?.name}</span><span className="tabular font-medium">{formatMoney(-t.amount)}</span></li>)}</ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Dépenses répétitives détectées</CardTitle></CardHeader>
            <CardContent>
              {recurring.length === 0 ? <p className="text-sm text-muted">Aucune répétition détectée hors échéances déjà suivies.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {recurring.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">{r.label} <span className="text-xs text-subtle">· {r.occurrences}× · {r.frequency === "monthly" ? "mensuel" : r.frequency === "weekly" ? "hebdo" : "annuel"}</span></span>
                      <span className="flex shrink-0 items-center gap-2">{r.matchesExistingRule ? <Badge tone="positive">Suivi</Badge> : <Badge tone="warning">Non suivi</Badge>}<span className="tabular">{formatMoney(r.monthlyCost)}/mois</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-subtle">
        {cur.netExpenses >= before.netExpenses ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        Les comparaisons utilisent des périodes de même longueur. Une variation n&apos;indique pas à elle seule une cause.
      </p>
    </div>
  );
}
