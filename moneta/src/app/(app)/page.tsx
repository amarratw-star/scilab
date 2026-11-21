import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CheckCircle2, HeartPulse, PiggyBank, Plus, Sparkles } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { loadWealthItems } from "@/server/services/wealth-data";
import { computeAlerts, computeOverview } from "@/server/services/overview";
import { generateNotifications } from "@/server/services/notifications";
import { accountNames, chartSeries, toTxView } from "@/server/services/views";
import { monthSummary } from "@/lib/finance/insights";
import { comparablePreviousPeriod, expensesByCategory } from "@/lib/finance/stats";
import { scheduledItems } from "@/lib/finance/recurring";
import { computeBalances, summarizeBalances } from "@/lib/finance/ledger";
import { netWorth } from "@/lib/finance/wealth";
import { healthHistory, healthScore, HEALTH_LEVEL_LABEL } from "@/lib/finance/health";
import { savingsOpportunities } from "@/lib/finance/opportunities";
import { addDays, addMonths, formatDateFR, formatDateLong, formatDayShort, startOfMonth } from "@/lib/dates";
import { formatMoney, formatPct, pctChange } from "@/lib/money";
import { resolvePeriod } from "@/lib/periods";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroStat, MiniStat, type Trend } from "@/components/dashboard/hero-stat";
import { HealthRing } from "@/components/dashboard/health-ring";
import { SpendBlock } from "@/components/dashboard/spend-block";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { DashboardChart, PeriodPicker } from "@/components/app/dashboard-chart";
import { QuickActions } from "@/components/app/quick-actions";
import { TxList } from "@/components/app/tx-list";
import { AddButton } from "./transactions/add-button";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, wealth, today, settings } = await runAsUser(user, async (ctx) => {
    const fin = await loadFinance(ctx);
    await generateNotifications(ctx, fin).catch(() => 0);
    return { fin, wealth: await loadWealthItems(ctx), today: ctx.today, settings: ctx.settings };
  });
  const hidden = new Set(settings.dashboard?.hidden ?? []);
  const ov = computeOverview(fin, today, settings);
  const alerts = computeAlerts(fin, ov, today);
  const summary = monthSummary(fin.txs, today, fin.cmap);
  const health = healthScore({ today, accounts: fin.accounts, txs: fin.txs, cats: fin.cmap, rules: fin.rules, budgets: fin.budgets });
  const healthPrev = healthHistory({ today, accounts: fin.accounts, txs: fin.txs, cats: fin.cmap, rules: fin.rules, budgets: fin.budgets }, 1)[0]?.score ?? null;
  const opportunities = savingsOpportunities({ txs: fin.txs, cats: fin.cmap, rules: fin.rules, reviewed: new Map(fin.ruleRows.map((r) => [r.id, r.lastReviewedAt])), today }).slice(0, 3);
  const nw = netWorth(fin.summary.totalFinancial, wealth, today);
  const hasWealth = wealth.some((w) => !w.archived);

  // Graphique principal (patrimoine net si des biens/dettes sont déclarés)
  const period = resolvePeriod(sp.periode, today, sp.du, sp.au);
  const series = chartSeries(fin, period.from, period.to, period.granularity);
  const balances = hasWealth ? series.balances.map((p) => ({ ...p, total: netWorth(p.total, wealth, p.date).net })) : series.balances;

  // Comparaisons (périodes comparables)
  const c = ov.comparison;
  const prevAvail = summarizeBalances(fin.accounts, computeBalances(fin.accounts, fin.txs, addMonths(today, -1))).available;
  const firstTx = fin.txs[0]?.date;
  const hasPrev = Boolean(firstTx && firstTx <= c.previous.from);
  const trend = (cur: number, prev: number, inverse = false): Trend => {
    if (!hasPrev || prev <= 0) return null;
    const v = pctChange(cur, prev);
    return v === null ? null : { kind: "pct", value: v, good: inverse ? v <= 0 : v >= 0, label: "par rapport à la même période du mois précédent" };
  };
  const savingsDelta = c.current.netSavings - c.previous.netSavings;

  // Répartition avec comparaison
  const monthStart = startOfMonth(today);
  const prevRange = comparablePreviousPeriod(monthStart, today);
  const prevByCat = new Map(expensesByCategory(fin.txs, prevRange.from, prevRange.to, fin.cmap).map((r) => [r.categoryId, r.amount]));
  const catRows = expensesByCategory(fin.txs, monthStart, today, fin.cmap).map((r) => ({ categoryId: r.categoryId, name: r.name, color: r.color, amount: r.amount, share: r.share, previous: prevByCat.get(r.categoryId) ?? 0 }));

  // Prochains mouvements : échéances non réalisées + opérations prévues ou datées dans le futur
  const upcomingItems = scheduledItems(fin.rules, fin.txs, today, addDays(today, 21)).filter((i) => !i.realized).map((i) => ({ key: i.ruleId + i.date, date: i.date, label: i.name, amount: i.kind === "income" ? i.amount : -i.amount, kind: i.kind, source: i.isSubscription ? "Abonnement" : i.kind === "income" ? "Revenu récurrent" : i.kind === "transfer" ? "Virement programmé" : "Prélèvement" }));
  const upcomingTx = fin.txRows.filter((t) => t.date > today && t.date <= addDays(today, 21) && t.status !== "cancelled" && !t.recurringId).map((t) => ({ key: t.id, date: t.date, label: t.merchant || t.description || "Opération", amount: t.kind === "expense" || t.kind === "transfer" ? -t.amount : t.amount, kind: t.kind, source: t.status === "planned" ? "Prévue" : "Enregistrée (date future)" }));
  const upcoming = [...upcomingItems, ...upcomingTx].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 7);
  const recent = [...fin.txRows].filter((t) => t.status !== "cancelled" && t.date <= today).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 6);
  const names = accountNames(fin);
  const av = ov.available;
  const hasAccounts = fin.accounts.length > 0;
  const askQ = encodeURIComponent("Analyse mes dépenses du mois et dis-moi où je pourrais économiser.");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm capitalize text-muted">{formatDateLong(today)}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight sm:text-[30px]">Bonjour {user.displayName}</h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Button asChild variant="outline"><Link href="/conseiller"><Bot /> Mon conseiller</Link></Button>
          <AddButton label="Ajouter une opération" />
        </div>
      </header>

      {!hasAccounts && (
        <EmptyState
          icon={<Sparkles />}
          title="Bienvenue ! Ajoute ton premier compte pour commencer"
          description="Compte courant, livret, espèces… MONETA calcule ensuite tes soldes, budgets, prévisions et ta santé financière à partir de tes opérations réelles."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild><Link href="/comptes?nouveau=1"><Plus /> Ajouter un compte</Link></Button>
              <Button asChild variant="outline"><Link href="/import">Importer un relevé CSV</Link></Button>
            </div>
          }
        />
      )}

      {/* Niveau 1 : les quatre indicateurs essentiels */}
      {!hidden.has("kpis") && hasAccounts && (
        <section aria-label="Indicateurs principaux" className="stagger grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <HeroStat
            label="Argent disponible"
            accent="info"
            value={formatMoney(fin.summary.available)}
            definition="Solde actuel de tes comptes courants et espèces (hors épargne et placements)."
            tip="Somme des soldes réels, à aujourd'hui, des comptes courants, secondaires et espèces. Les opérations prévues et les revenus attendus n'y sont pas inclus."
            trend={trend(fin.summary.available, prevAvail)}
            href="/comptes"
            hrefLabel="Comptes"
          />
          <HeroStat
            label="Dépenses du mois"
            accent="negative"
            value={formatMoney(ov.month.netExpenses)}
            definition={`Dépenses effectuées depuis le 1er, remboursements déduits${ov.month.refunds ? ` (${formatMoney(ov.month.refunds)})` : ""}.`}
            tip="Dépenses nettes = dépenses effectuées − remboursements reçus. Les transferts entre tes comptes ne sont pas des dépenses ; les dépenses prévues non plus."
            trend={trend(c.current.netExpenses, c.previous.netExpenses, true)}
            href="/transactions?periode=mois&type=expense,refund"
            hrefLabel="Opérations"
          />
          <HeroStat
            label="Revenus du mois"
            accent="positive"
            value={formatMoney(ov.month.income)}
            definition={ov.expectedIncomeMonth > 0 ? `Encaissés depuis le 1er · ${formatMoney(ov.expectedIncomeMonth)} encore attendus.` : "Revenus réellement encaissés depuis le 1er du mois."}
            tip="Seuls les revenus effectivement reçus sont comptés. Les revenus attendus (salaire à venir…) sont signalés à part et ne sont jamais ajoutés à ton argent disponible."
            trend={trend(c.current.income, c.previous.income)}
            href="/transactions?periode=mois&type=income"
            hrefLabel="Revenus"
          />
          <HeroStat
            label="Épargne du mois"
            accent="savings"
            value={<span className={ov.month.netSavings < 0 ? "text-negative" : ""}>{formatMoney(ov.month.netSavings, undefined, { signed: true })}</span>}
            definition="Revenus encaissés − dépenses nettes du mois. Les virements vers ton livret n'en changent pas le montant."
            tip="Épargne nette = ce qui reste du mois. Elle peut être négative en début de mois, avant l'arrivée du salaire."
            trend={hasPrev && (c.previous.incomeCount + c.previous.expenseCount > 0) ? { kind: "text", text: `${formatMoney(savingsDelta, undefined, { signed: true, decimals: false })} vs mois dernier`, good: savingsDelta >= 0 } : null}
            href="/epargne"
            hrefLabel="Épargne"
          />
        </section>
      )}

      {/* Niveau 2 : indicateurs secondaires */}
      {!hidden.has("kpis") && hasAccounts && (
        <section aria-label="Indicateurs secondaires" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MiniStat label={hasWealth ? "Patrimoine net" : "Patrimoine financier"} href="/patrimoine" value={formatMoney(nw.net)} sub={hasWealth ? `Brut ${formatMoney(nw.gross, undefined, { decimals: false })} − passifs ${formatMoney(nw.liabilitiesTotal, undefined, { decimals: false })}` : "Tous tes comptes"} tip="Patrimoine net = comptes + biens déclarés − dettes déclarées. Un transfert vers l'épargne ne le modifie pas." />
          <MiniStat label="Taux d'épargne" value={ov.month.savingsRate === null ? "—" : formatPct(ov.month.savingsRate)} sub={ov.month.savingsRate === null ? "Aucun revenu encaissé ce mois" : "de tes revenus encaissés"} tip="Épargne nette ÷ revenus encaissés du mois. Indisponible tant qu'aucun revenu n'est encaissé." />
          <MiniStat label="Reste à vivre prévu" value={<span className={ov.resteAVivre < 0 ? "text-negative" : ""}>{formatMoney(ov.resteAVivre)}</span>} sub={ov.expectedIncomeMonth > 0 ? `dont ${formatMoney(ov.expectedIncomeMonth, undefined, { decimals: false })} de revenus attendus` : `Charges fixes : ${formatMoney(ov.fixedPaid + ov.fixedPending, undefined, { decimals: false })}`} tip={`Revenus du mois (encaissés + attendus) − charges fixes du mois (payées et à venir). Sur les seuls revenus encaissés : ${formatMoney(ov.resteAVivreEncaisse)}.`} />
          <MiniStat label="Après charges fixes" href="/disponible" value={av.status === "ok" ? formatMoney(av.afterFixedCharges) : "—"} sub="Disponible − charges et dépenses prévues" tip="Argent disponible aujourd'hui moins les charges fixes et dépenses prévues restant à payer ce mois-ci. Avant épargne et sécurité." />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {!hidden.has("chart") && (
          <Card className="xl:col-span-2">
            <CardHeader className="flex-col sm:flex-row sm:items-start">
              <div>
                <CardTitle>Évolution de tes finances</CardTitle>
                <CardDescription>Du {formatDateFR(period.from)} au {formatDateFR(period.to)}</CardDescription>
              </div>
              <PeriodPicker value={period.key} from={period.from} to={period.to} basePath="/" />
            </CardHeader>
            <CardContent>
              {hasAccounts ? <DashboardChart balances={balances} flows={series.flows} granularity={period.granularity} totalLabel={hasWealth ? "Patrimoine net" : "Patrimoine financier (tous comptes)"} /> : <p className="py-16 text-center text-sm text-muted">Les graphiques apparaîtront dès ta première opération.</p>}
            </CardContent>
          </Card>
        )}
        {!hidden.has("available") && (
          <Card className="flex flex-col">
            <CardHeader>
              <div>
                <CardTitle>Combien puis-je dépenser ?</CardTitle>
                <CardDescription>Sans toucher à tes engagements du mois</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <SpendBlock av={av} />
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {!hidden.has("summary") && (
          <Card className="overflow-hidden border-transparent bg-[image:var(--hero-gradient)] text-[var(--hero-foreground)]">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2 text-[var(--hero-foreground)]"><Sparkles className="size-4 opacity-80" /> Ton mois en bref</CardTitle>
                <CardDescription className="text-white/60">Calculé à partir de tes opérations réelles</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5 text-[15px] leading-relaxed text-white/90">
                {summary.sentences.map((s) => <p key={s}>{s}</p>)}
                {ov.expectedIncomeMonth > 0 && <p className="text-white/70">{formatMoney(ov.expectedIncomeMonth)} de revenus sont encore attendus d&apos;ici la fin du mois.</p>}
              </div>
              <Button asChild variant="secondary" className="mt-5 border-white/10 bg-white/10 text-white hover:bg-white/20">
                <Link href={`/conseiller?q=${askQ}`}><Bot /> Analyse approfondie avec le conseiller</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {!hidden.has("health") && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><HeartPulse className="size-4 text-negative" /> Santé financière</CardTitle>
                <CardDescription>Note indicative, pas un diagnostic officiel</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-5">
                <HealthRing score={health.score} size={104} />
                <div className="min-w-0 flex-1 text-sm">
                  {health.status === "ok" ? (
                    <>
                      <p className="text-base font-semibold">{HEALTH_LEVEL_LABEL[health.level!]}</p>
                      {healthPrev !== null && <p className="text-xs text-muted">{health.score! - healthPrev >= 0 ? "+" : ""}{health.score! - healthPrev} pt(s) depuis la fin du mois dernier</p>}
                      {health.weaknesses[0]?.recommendation && <p className="mt-2 text-muted">À améliorer : <span className="text-foreground">{health.weaknesses[0].label.toLowerCase()}</span>.</p>}
                      {!health.weaknesses.length && health.strengths[0] && <p className="mt-2 text-muted">Point fort : <span className="text-foreground">{health.strengths[0].label.toLowerCase()}</span>.</p>}
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Données insuffisantes</p>
                      <p className="mt-1 text-xs text-muted">{health.reasons[0]}</p>
                    </>
                  )}
                </div>
              </div>
              <Link href="/sante" className="mt-4 flex items-center gap-1 text-sm font-medium text-info hover:underline">Comprendre ma note <ArrowRight className="size-3.5" /></Link>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {!hidden.has("alerts") && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Alertes importantes</CardTitle>
                <CardDescription>Uniquement ce qui mérite ton attention</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-positive-soft px-3 py-3 text-sm text-positive"><CheckCircle2 className="size-4" /> Rien d&apos;important à signaler.</div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="flex gap-3 rounded-xl border border-border p-3">
                    <span className={`mt-0.5 shrink-0 ${a.severity === "danger" ? "text-negative" : a.severity === "warning" ? "text-warning" : "text-info"}`}>{a.severity === "info" ? <CalendarClock className="size-4" /> : <AlertTriangle className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{a.body}</p>
                      {a.action && <Link href={a.action.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">{a.action.label} <ArrowRight className="size-3" /></Link>}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
        {!hidden.has("opportunities") && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><PiggyBank className="size-4 text-positive" /> Opportunités d&apos;économies</CardTitle>
                <CardDescription>Calculées à partir de tes dépenses réelles</CardDescription>
              </div>
              <Link href="/analyses#opportunites" className="text-sm text-info hover:underline">Tout voir</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {opportunities.length === 0 ? (
                <p className="py-4 text-sm text-muted">Pas d&apos;opportunité identifiée pour l&apos;instant : il faut généralement un à trois mois complets d&apos;historique.</p>
              ) : (
                opportunities.map((o) => (
                  <Link key={o.id} href={o.href} className="card-interactive block rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{o.title}</p>
                      <Badge tone="positive" className="shrink-0">≈ {formatMoney(o.annualSaving, undefined, { decimals: false })}/an</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{o.detail}</p>
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
            <CardContent>{catRows.length ? <CategoryBreakdown rows={catRows} total={ov.month.netExpenses} from={monthStart} to={today} /> : <p className="py-10 text-center text-sm text-muted">Aucune dépense ce mois-ci.</p>}</CardContent>
          </Card>
        )}
        {!hidden.has("budgets") && (
          <Card>
            <CardHeader>
              <CardTitle>Budgets</CardTitle>
              <Link href="/budgets" className="text-sm text-info hover:underline">Gérer</Link>
            </CardHeader>
            <CardContent className="space-y-4">
              {ov.budgets.length === 0 && <p className="text-sm text-muted">Aucun budget. <Link className="text-info hover:underline" href="/budgets">En créer un</Link> pour suivre tes limites.</p>}
              {ov.budgets.slice(0, 5).map((b) => (
                <div key={b.budget.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{b.budget.name}</span>
                    <span className={`shrink-0 text-xs tabular ${b.remaining < 0 ? "text-negative" : "text-muted"}`}>{b.remaining < 0 ? `${formatMoney(-b.remaining, undefined, { decimals: false })} de trop` : `reste ${formatMoney(b.remaining, undefined, { decimals: false })}`}</span>
                  </div>
                  <Progress value={b.ratio} label={b.budget.name} />
                  <p className="mt-1 text-[11px] text-subtle tabular">{formatMoney(b.spent, undefined, { decimals: false })} sur {formatMoney(b.effectiveAmount, undefined, { decimals: false })} · {formatPct(b.ratio, 0)}</p>
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
              <div>
                <CardTitle>Prochains mouvements</CardTitle>
                <CardDescription>3 prochaines semaines · rien n&apos;est encore débité</CardDescription>
              </div>
              <Link href="/calendrier" className="text-sm text-info hover:underline">Trésorerie</Link>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Aucun mouvement prévu dans les 3 prochaines semaines.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {upcoming.map((u) => (
                    <li key={u.key} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1 text-center leading-none">
                          <span className="text-sm font-semibold tabular">{u.date.slice(8)}</span>
                          <span className="text-[10px] text-subtle">{formatDayShort(u.date).split(" ")[1]}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{u.label}</span>
                          <span className="text-xs text-subtle">{u.source}{u.date === today ? " · aujourd'hui" : ""}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone="info">Prévu</Badge>
                        <span className={`text-sm font-semibold tabular ${u.amount > 0 ? "text-positive" : ""}`}>{formatMoney(u.amount, undefined, { signed: true })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {!hidden.has("actions") && <div className="lg:hidden"><QuickActions /></div>}
    </div>
  );
}
