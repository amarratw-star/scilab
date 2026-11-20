import type { Metadata } from "next";
import { Target } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { goalProgress, GOAL_STATE_LABEL } from "@/lib/finance/goals";
import { monthlySeries } from "@/lib/finance/stats";
import { addMonths, formatDateFR, formatMonthLabel, startOfMonth } from "@/lib/dates";
import { formatMoney, formatPct } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { IconBadge } from "@/components/ui/icon";
import { SingleSeriesBars } from "@/components/charts/charts";
import { GoalActions, NewGoalButton } from "./goal-ui";

export const metadata: Metadata = { title: "Épargne" };

const PRIORITY = { 1: "Priorité haute", 2: "Priorité normale", 3: "Priorité basse" } as Record<number, string>;

export default async function SavingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const series = monthlySeries(fin.txs, startOfMonth(addMonths(today, -11)), today);
  const last3 = series.slice(-4, -1);
  const avgSavings = last3.length ? Math.round(last3.reduce((s, m) => s + m.savings, 0) / last3.length) : null;
  const goals = fin.goalRows.map((g) => ({ row: g, p: goalProgress(fin.goals.find((x) => x.id === g.id)!, fin.contributions, today), history: fin.contribRows.filter((c) => c.goalId === g.id).sort((a, b) => (a.date < b.date ? 1 : -1)) }));
  const allocated = goals.reduce((s, g) => s + g.p.saved, 0);
  const accounts = fin.accountRows.filter((a) => !a.archivedAt).map((a) => ({ id: a.id, name: a.name, type: a.type }));
  return (
    <div>
      <PageHeader title="Épargne et objectifs" description="Les versements vers l'épargne sont des transferts, jamais des dépenses." actions={<NewGoalButton autoOpen={sp.nouveau === "1"} accounts={accounts} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sur tes livrets" accent="positive" value={<Money cents={fin.summary.savings} />} hint="Comptes d'épargne" />
        <Stat label="Affecté à tes objectifs" value={<Money cents={allocated} />} hint={`${goals.length} objectif(s)`} />
        <Stat label="Épargne nette ce mois" value={<Money cents={series[series.length - 1]?.savings ?? 0} tone="auto" signed />} hint={`Taux : ${formatPct(series[series.length - 1]?.savingsRate ?? null)}`} />
        <Stat label="Moyenne mensuelle (3 mois)" value={avgSavings === null ? "—" : <Money cents={avgSavings} tone="auto" />} hint="Revenus − dépenses nettes" />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Épargne nette mois par mois</CardTitle>
            <CardDescription>Revenus encaissés − dépenses nettes, sur 12 mois</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <SingleSeriesBars data={series.map((m) => ({ key: m.month, value: m.savings }))} color="var(--chart-savings)" label="Épargne nette" keyFormat="month" />
        </CardContent>
      </Card>
      <h2 className="mb-3 mt-8 text-[15px] font-semibold">Mes objectifs</h2>
      {goals.length === 0 ? (
        <EmptyState icon={<Target />} title="Aucun objectif" description="Épargne de sécurité, voyage, ordinateur, apport immobilier… Fixe un montant et une date : MONETA calcule l'effort mensuel nécessaire." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map(({ row: g, p, history }) => (
            <Card key={g.id}>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-3">
                  <IconBadge icon={g.icon} color={g.color} size="lg" />
                  <div className="min-w-0">
                    <CardTitle className="truncate">{g.name}</CardTitle>
                    <CardDescription>{PRIORITY[g.priority]}{g.deadline ? ` · avant le ${formatDateFR(g.deadline)}` : ""}</CardDescription>
                  </div>
                </div>
                <GoalActions goal={{ id: g.id, name: g.name, description: g.description, targetAmount: g.targetAmount, startDate: g.startDate, deadline: g.deadline, priority: g.priority, accountId: g.accountId, icon: g.icon, color: g.color }} accounts={accounts} history={history.map((h) => ({ id: h.id, amount: h.amount, date: h.date, note: h.note }))} />
              </CardHeader>
              <CardContent>
                {g.description && <p className="-mt-1 mb-3 text-sm text-muted">{g.description}</p>}
                <div className="flex items-end justify-between">
                  <p className="tabular text-2xl font-semibold">{formatMoney(p.saved)}</p>
                  <p className="text-sm text-muted">/ {formatMoney(g.targetAmount)}</p>
                </div>
                <Progress value={p.progress} tone={p.state === "behind" || p.state === "overdue" ? "auto" : "positive"} className="mt-2" label={g.name} />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted">{formatPct(p.progress, 0)} · reste {formatMoney(p.remaining)}</span>
                  <Badge tone={p.state === "reached" ? "positive" : p.state === "behind" || p.state === "overdue" ? "warning" : "neutral"}>{GOAL_STATE_LABEL[p.state]}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                  <div><dt className="text-subtle">À épargner / mois</dt><dd className="tabular font-medium">{p.recommendedMonthly === null ? "—" : formatMoney(p.recommendedMonthly)}</dd></div>
                  <div><dt className="text-subtle">Rythme actuel / mois</dt><dd className="tabular font-medium">{p.averageMonthly === null ? "—" : formatMoney(p.averageMonthly)}</dd></div>
                  <div><dt className="text-subtle">Date estimée</dt><dd className="font-medium">{p.state === "reached" ? "Atteint 🎉" : p.estimatedDate ? formatDateFR(p.estimatedDate) : "Pas assez de versements"}</dd></div>
                  <div><dt className="text-subtle">Compte associé</dt><dd className="truncate font-medium">{g.accountId ? fin.accountRows.find((a) => a.id === g.accountId)?.name ?? "—" : "—"}</dd></div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
