import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CheckCircle2, Info, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { computeAlerts, computeOverview } from "@/server/services/overview";
import { generateNotifications } from "@/server/services/notifications";
import { accountNames, chartSeries, toTxView } from "@/server/services/views";
import { monthSummary } from "@/lib/finance/insights";
import { expensesByCategory } from "@/lib/finance/stats";
import { scheduledItems } from "@/lib/finance/recurring";
import { BUDGET_LEVEL_LABEL } from "@/lib/finance/budgets";
import { addDays, formatDateFR, formatDateLong, formatMonthLabel, monthKey, startOfMonth } from "@/lib/dates";
import { formatMoney, formatPct } from "@/lib/money";
import { resolvePeriod } from "@/lib/periods";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, EmptyState, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { InfoTip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CategoryDonut } from "@/components/charts/charts";
import { DashboardChart, PeriodPicker } from "@/components/app/dashboard-chart";
import { QuickActions } from "@/components/app/quick-actions";
import { TxList } from "@/components/app/tx-list";

export const metadata: Metadata = { title: "Tableau de bord" };

function Delta({ change, inverse }: { change: number | null; inverse?: boolean }) {
  if (change === null) return <span>pas de comparaison possible</span>;
  const good = inverse ? change <= 0 : change >= 0;
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={good ? "text-positive" : "text-negative"}>
      <Icon className="mr-0.5 inline size-3" />
      {formatPct(change, 0, true)} <span className="text-subtle">vs même période du mois dernier</span>
    </span>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await runAsUser(user, async (ctx) => {
    const fin = await loadFinance(ctx);
    await generateNotifications(ctx, fin).catch(() => 0);
    return { fin, today: ctx.today, settings: ctx.settings };
  });
  const { fin, today, settings } = data;
  const hidden = new Set(settings.dashboard?.hidden ?? []);
  const ov = computeOverview(fin, today, settings);
  const alerts = computeAlerts(fin, ov, today);
  const summary = monthSummary(fin.txs, today, fin.cmap);
  const period = resolvePeriod(sp.periode, today, sp.du, sp.au);
  const series = chartSeries(fin, period.from, period.to, period.granularity);
  const cats = expensesByCategory(fin.txs, startOfMonth(today), today, fin.cmap);
  const upcoming = scheduledItems(fin.rules, fin.txs, today, addDays(today, 14)).filter((i) => !i.realized).slice(0, 6);
  const recent = [...fin.txRows].filter((t) => t.status !== "cancelled" && t.date <= today).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 7);
  const names = accountNames(fin);
  const av = ov.available;
  const c = ov.comparison;
  const hasAccounts = fin.accounts.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm capitalize text-muted">{formatDateLong(today)}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Bonjour {user.displayName} 👋</h1>
      </div>

      {!hasAccounts ? (
        <EmptyState
          icon={<Sparkles />}
          title="Commence par ajouter ton premier compte"
          description="Compte courant, livret, espèces… MONETA calcule ensuite tes soldes, budgets et prévisions à partir de tes opérations."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild><Link href="/comptes?nouveau=1">Ajouter un compte</Link></Button>
              <Button asChild variant="outline"><Link href="/import">Importer un relevé CSV</Link></Button>
            </div>
          }
        />
      ) : null}

      {!hidden.has("actions") && <QuickActions />}

      {/* Indicateurs clés */}
      {!hidden.has("kpis") && (
        <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Patrimoine financier"
            tip={<InfoTip>Somme des soldes de tous tes comptes actifs (courants, épargne, placements, espèces). Les biens et dettes déclarés sont dans « Mon patrimoine ».</InfoTip>}
            value={<Money cents={ov.summary.totalFinancial} />}
            hint={<Link href="/patrimoine" className="hover:text-foreground">Patrimoine net →</Link>}
          />
          <Stat
            label="Solde disponible"
            accent="info"
            tip={<InfoTip>Comptes courants, secondaires et espèces : l&apos;argent utilisable tout de suite. L&apos;épargne et les placements n&apos;y sont pas inclus.</InfoTip>}
            value={<Money cents={ov.summary.available} />}
            hint={`Épargne : ${formatMoney(ov.summary.savings)}`}
          />
          <Stat label={`Revenus de ${formatMonthLabel(monthKey(today)).split(" ")[0]}`} accent="positive" tip={<InfoTip>Revenus réellement encaissés ce mois-ci. Les revenus attendus ne sont pas comptés.</InfoTip>} value={<Money cents={ov.month.income} tone={ov.month.income ? "positive" : "none"} />} hint={<Delta change={c.incomeChange} />} />
          <Stat label="Dépenses du mois" accent="negative" tip={<InfoTip>Dépenses nettes : dépenses effectuées moins les remboursements reçus. Les transferts entre tes comptes ne sont pas des dépenses.</InfoTip>} value={<Money cents={ov.month.netExpenses} />} hint={<Delta change={c.expensesChange} inverse />} />
          <Stat label="Épargne du mois" tip={<InfoTip>Épargne nette = revenus encaissés − dépenses nettes. C&apos;est ce qui te reste du mois, qu&apos;il soit sur ton compte courant ou déjà viré sur un livret.</InfoTip>} value={<Money cents={ov.month.netSavings} tone="auto" signed />} hint={`${formatMoney(ov.month.transfers)} transférés entre comptes`} />
          <Stat label="Taux d'épargne" tip={<InfoTip>Épargne nette ÷ revenus encaissés. Indisponible tant qu&apos;aucun revenu n&apos;est encaissé ce mois-ci.</InfoTip>} value={<span className={ov.month.savingsRate === null ? "text-subtle" : ov.month.savingsRate >= 0 ? "" : "text-negative"}>{ov.month.savingsRate === null ? "—" : formatPct(ov.month.savingsRate)}</span>} hint={ov.month.savingsRate === null ? "Aucun revenu encaissé ce mois-ci" : ov.month.savingsRate >= 0.2 ? "Excellent rythme" : ov.month.savingsRate >= 0.1 ? "Rythme correct" : "À améliorer"} />
          <Stat label="Reste à vivre" tip={<InfoTip>Revenus encaissés du mois − charges fixes du mois (déjà payées et restant à payer : loyer, abonnements, assurances…).</InfoTip>} value={<Money cents={ov.resteAVivre} tone={ov.resteAVivre < 0 ? "negative" : "none"} />} hint={`Charges fixes : ${formatMoney(ov.fixedPaid + ov.fixedPending)}`} />
          <Stat
            label="Après charges fixes"
            accent="warning"
            tip={<InfoTip>Solde disponible − charges fixes et dépenses prévues restant à payer d&apos;ici la fin du mois.</InfoTip>}
            value={av.status === "ok" ? <Money cents={av.afterFixedCharges} tone={av.afterFixedCharges < 0 ? "negative" : "none"} /> : <span className="text-base text-subtle">Estimation indisponible</span>}
            hint={av.status === "ok" ? `${av.pendingFixedCount} échéance(s) à venir ce mois` : undefined}
          />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {!hidden.has("chart") && (
          <Card className="xl:col-span-2">
            <CardHeader className="flex-col sm:flex-row sm:items-start">
              <div>
                <CardTitle>Évolution de tes finances</CardTitle>
                <CardDescription>
                  Du {formatDateFR(period.from)} au {formatDateFR(period.to)}
                </CardDescription>
              </div>
              <PeriodPicker value={period.key} from={period.from} to={period.to} basePath="/" />
            </CardHeader>
            <CardContent>{hasAccounts ? <DashboardChart balances={series.balances} flows={series.flows} granularity={period.granularity} /> : <p className="py-16 text-center text-sm text-muted">Les graphiques apparaîtront dès ta première opération.</p>}</CardContent>
          </Card>
        )}

        {!hidden.has("available") && (
          <Card className="flex flex-col">
            <CardHeader>
              <div>
                <CardTitle>Combien puis-je dépenser ?</CardTitle>
                <CardDescription>D&apos;ici la fin du mois, sans toucher à tes engagements</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {av.status === "ok" ? (
                <>
                  <p className={`tabular text-4xl font-semibold tracking-tight ${av.spendableUntilMonthEnd < 0 ? "text-negative" : ""}`}>{formatMoney(av.spendableUntilMonthEnd)}</p>
                  <p className="mt-1 text-sm text-muted">
                    soit <strong className="text-foreground">{formatMoney(av.recommendedDaily)}</strong> par jour pendant {av.daysLeft} jour{av.daysLeft > 1 ? "s" : ""}
                    {av.budgetRemaining !== null && av.recommendedDaily < av.dailyAllowance ? " (limité par tes budgets)" : ""}
                  </p>
                  <dl className="mt-4 space-y-1.5 text-sm">
                    {av.lines.filter((l) => l.amount !== 0 || l.label.startsWith("Solde")).map((l) => (
                      <div key={l.label} className="flex justify-between gap-3">
                        <dt className="text-muted">{l.label}</dt>
                        <dd className="tabular font-medium">{formatMoney(l.amount, "EUR", { signed: l.amount < 0 })}</dd>
                      </div>
                    ))}
                  </dl>
                  {av.nextIncome && (
                    <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
                      Prochaine entrée prévue : <strong className="text-foreground">{formatMoney(av.nextIncome.amount)}</strong> le {formatDateFR(av.nextIncome.date)} ({av.nextIncome.label}) — non comptée tant qu&apos;elle n&apos;est pas encaissée.
                    </p>
                  )}
                  <Link href="/disponible" className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-info hover:underline">
                    Détail du calcul <ArrowRight className="size-3.5" />
                  </Link>
                </>
              ) : (
                <Callout tone="neutral" icon={<Info />} title="Estimation indisponible">
                  {av.reason}
                </Callout>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {!hidden.has("summary") && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ton mois en bref</CardTitle>
                <CardDescription>Calculé à partir de tes opérations réelles</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm"><Link href="/conseiller"><Bot /> Demander</Link></Button>
            </CardHeader>
            <CardContent className="space-y-2 text-[15px] leading-relaxed">
              {summary.sentences.map((s) => (
                <p key={s}>{s}</p>
              ))}
            </CardContent>
          </Card>
        )}
        {!hidden.has("alerts") && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Alertes importantes</CardTitle>
                <CardDescription>Seulement ce qui mérite ton attention</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-positive-soft px-3 py-3 text-sm text-positive">
                  <CheckCircle2 className="size-4" /> Rien à signaler pour l&apos;instant.
                </div>
              ) : (
                alerts.map((a) => (
                  <Link key={a.id} href={a.href ?? "#"} className="flex gap-3 rounded-xl border border-border p-3 transition hover:bg-surface-2">
                    <span className={`mt-0.5 ${a.severity === "danger" ? "text-negative" : a.severity === "warning" ? "text-warning" : "text-info"}`}>
                      {a.severity === "info" ? <CalendarClock className="size-4" /> : <AlertTriangle className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{a.title}</span>
                      <span className="block text-xs text-muted">{a.body}</span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {!hidden.has("categories") && (
          <Card className="xl:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Où part ton argent ce mois-ci</CardTitle>
                <CardDescription>Dépenses nettes par catégorie</CardDescription>
              </div>
              <Link href="/analyses" className="text-sm text-info hover:underline">Analyses</Link>
            </CardHeader>
            <CardContent>{cats.length ? <CategoryDonut data={cats} total={ov.month.netExpenses} /> : <p className="py-10 text-center text-sm text-muted">Aucune dépense ce mois-ci.</p>}</CardContent>
          </Card>
        )}
        {!hidden.has("budgets") && (
          <Card>
            <CardHeader>
              <CardTitle>Budgets</CardTitle>
              <Link href="/budgets" className="text-sm text-info hover:underline">Gérer</Link>
            </CardHeader>
            <CardContent className="space-y-4">
              {ov.budgets.length === 0 && <p className="text-sm text-muted">Aucun budget. <Link className="text-info hover:underline" href="/budgets">En créer un</Link></p>}
              {ov.budgets.slice(0, 5).map((b) => (
                <div key={b.budget.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{b.budget.name}</span>
                    <span className="tabular text-xs text-muted">
                      {formatMoney(b.spent, "EUR", { decimals: false })} / {formatMoney(b.effectiveAmount, "EUR", { decimals: false })}
                    </span>
                  </div>
                  <Progress value={b.ratio} label={b.budget.name} />
                  {b.level !== "ok" && b.level !== "notice" && <p className={`mt-1 text-xs ${b.level === "exceeded" || b.level === "danger" ? "text-negative" : "text-warning"}`}>{BUDGET_LEVEL_LABEL[b.level]}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {!hidden.has("recent") && (
          <Card>
            <CardHeader>
              <CardTitle>Dernières opérations</CardTitle>
              <Link href="/transactions" className="text-sm text-info hover:underline">Tout voir</Link>
            </CardHeader>
            <CardContent>
              <TxList rows={recent.map(toTxView)} accountNames={names} groupByDate={false} emptyText="Aucune opération pour l'instant." />
            </CardContent>
          </Card>
        )}
        {!hidden.has("upcoming") && (
          <Card>
            <CardHeader>
              <CardTitle>Prochains prélèvements et revenus</CardTitle>
              <Link href="/calendrier" className="text-sm text-info hover:underline">Calendrier</Link>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Aucune échéance dans les 14 prochains jours.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {upcoming.map((u) => (
                    <li key={u.ruleId + u.date} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{u.name}</span>
                        <span className="block text-xs text-subtle">{u.date === today ? "Aujourd'hui" : formatDateFR(u.date)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone="info">Prévu</Badge>
                        <span className={`tabular text-sm font-semibold ${u.kind === "income" ? "text-positive" : ""}`}>{formatMoney(u.kind === "income" ? u.amount : -u.amount, "EUR", { signed: true })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
