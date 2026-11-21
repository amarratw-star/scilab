import type { Metadata } from "next";
import { FileSpreadsheet, FileText, Sheet } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { buildReport, REPORT_LABELS, type ReportKind } from "@/server/services/reports";
import { addMonths, eachMonth, formatDateFR, formatMonthLabel, monthKey } from "@/lib/dates";
import { formatMoney, formatPct } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { CategoryDonut, MonthlyBars } from "@/components/charts/charts";
import { ReportPicker } from "./picker";

export const metadata: Metadata = { title: "Rapports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const kind = (Object.keys(REPORT_LABELS).find((k) => k === sp.type) ?? "monthly") as ReportKind;
  const yearly = kind === "annual" || kind === "savings" || kind === "wealth";
  const first = fin.txs[0]?.date ?? today;
  const months = eachMonth(first < addMonths(today, -36) ? addMonths(today, -36) : first, today).reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const ref = yearly ? (sp.annee && years.includes(sp.annee) ? sp.annee : today.slice(0, 4)) : sp.mois && months.includes(sp.mois) ? sp.mois : (sp.mois ?? monthKey(today));
  const r = buildReport(fin, kind, yearly ? `${ref}-01-01` : `${ref}-01`, today);
  const dl = (format: string) => `/api/export/report?type=${kind}&ref=${ref}&format=${format}`;
  return (
    <div>
      <PageHeader title="Rapports" description="Générés automatiquement à partir de tes données. Exportables en PDF, CSV et Excel." />
      <ReportPicker kind={kind} months={months.map((m) => ({ value: m, label: formatMonthLabel(m) }))} years={years} current={ref} yearly={yearly} />
      <Card className="mt-6">
        <CardHeader className="flex-col sm:flex-row">
          <div>
            <CardTitle className="text-lg capitalize">{r.title}</CardTitle>
            <CardDescription>Du {formatDateFR(r.from)} au {formatDateFR(r.to)}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><a href={dl("pdf")}><FileText /> PDF</a></Button>
            <Button asChild variant="outline"><a href={dl("xlsx")}><FileSpreadsheet /> Excel</a></Button>
            <Button asChild variant="outline"><a href={dl("csv")}><Sheet /> CSV</a></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold">1. Résumé financier</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Revenus" accent="positive" value={formatMoney(r.totals.income)} hint={`avant : ${formatMoney(r.previous.income)}`} />
              <Stat label="Dépenses nettes" accent="negative" value={formatMoney(r.totals.netExpenses)} hint={`avant : ${formatMoney(r.previous.netExpenses)}`} />
              <Stat label="Épargne nette" value={formatMoney(r.totals.netSavings)} hint={`avant : ${formatMoney(r.previous.netSavings)}`} />
              <Stat label="Taux d'épargne" value={formatPct(r.totals.savingsRate)} hint={`avant : ${formatPct(r.previous.savingsRate)}`} />
            </div>
          </section>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section><h3 className="mb-3 text-sm font-semibold">2–3. Revenus et dépenses</h3><MonthlyBars data={r.series} height={220} /></section>
            <section><h3 className="mb-3 text-sm font-semibold">5. Répartition par catégorie</h3>{r.byCategory.length ? <CategoryDonut data={r.byCategory} total={r.totals.netExpenses} /> : <p className="text-sm text-muted">Aucune dépense.</p>}</section>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section>
              <h3 className="mb-2 text-sm font-semibold">4. Épargne et objectifs</h3>
              <ul className="space-y-1 text-sm">{r.goals.length ? r.goals.map((g) => <li key={g.goal.id} className="flex justify-between"><span>{g.goal.name}</span><span className="tabular">{formatPct(g.progress.progress, 0)}</span></li>) : <li className="text-muted">Aucun objectif.</li>}</ul>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">7. Patrimoine financier</h3>
              <p className="text-sm">{formatMoney(r.startBalances.totalFinancial)} → <strong>{formatMoney(r.endBalances.totalFinancial)}</strong></p>
              <p className="text-xs text-muted">Variation : {formatMoney(r.endBalances.totalFinancial - r.startBalances.totalFinancial, undefined, { signed: true })}</p>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">8. Points d&apos;attention</h3>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted">{[...r.points, ...r.recos.map((x) => x.title)].slice(0, 6).map((p) => <li key={p}>{p}</li>)}{!r.points.length && !r.recos.length && <li>Aucun point particulier.</li>}</ul>
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
