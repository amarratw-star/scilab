import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { budgetStatuses, computeOverview } from "@/server/services/overview";
import { budgetSpent, categoryMatches, BUDGET_LEVEL_LABEL } from "@/lib/finance/budgets";
import { addMonths, endOfMonth, formatDateFR, formatMonthLabel, monthKey, startOfMonth } from "@/lib/dates";
import { formatMoney, formatPct } from "@/lib/money";
import { PERIOD_LABELS } from "@/lib/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { BudgetDialog, BudgetMenu } from "./budget-ui";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const user = await requireUser();
  const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
  const statuses = budgetStatuses(fin, today);
  const ov = computeOverview(fin, today, settings);
  const months = [-5, -4, -3, -2, -1, 0].map((n) => startOfMonth(addMonths(today, n)));
  return (
    <div>
      <PageHeader title="Budgets" description="Fixe tes limites et suis-les en temps réel." actions={<BudgetDialog />} />
      {ov.available.status === "ok" && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tu peux dépenser aujourd'hui" accent="info" value={<Money cents={ov.available.recommendedDaily} />} hint="Selon ton disponible et tes budgets" />
          <Stat label="Restant selon tes budgets" value={ov.available.budgetRemaining === null ? <span className="text-base text-subtle">Aucun budget mensuel</span> : <Money cents={ov.available.budgetRemaining} />} hint={`${ov.available.daysLeft} jour(s) restant(s)`} />
          <Stat label="Dépensé ce mois" accent="negative" value={<Money cents={ov.month.netExpenses} />} />
          <Stat label="Budgets dépassés" value={statuses.filter((s) => s.level === "exceeded").length} hint={`sur ${statuses.length} budget(s)`} />
        </div>
      )}
      {statuses.length === 0 ? (
        <EmptyState icon={<Gauge />} title="Aucun budget" description="Crée un budget global mensuel ou des budgets par catégorie (restaurants, courses, loisirs…). Tu seras alerté à 50, 75, 90 et 100 %." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {statuses.map((b) => {
            const recent = fin.txs
              .filter((t) => t.status === "posted" && t.kind === "expense" && t.date >= b.from && t.date <= b.to && (!b.budget.categoryId || categoryMatches(t.categoryId, b.budget.categoryId, fin.cmap)))
              .sort((x, y) => (x.date < y.date ? 1 : -1))
              .slice(0, 3);
            const row = fin.budgetRows.find((r) => r.id === b.budget.id)!;
            return (
              <Card key={b.budget.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{b.budget.name}</CardTitle>
                    <CardDescription>
                      {b.budget.categoryId ? fin.cmap.get(b.budget.categoryId)?.name : "Toutes dépenses"} · {PERIOD_LABELS[b.budget.period]}
                      {b.budget.rollover ? " · avec report" : ""}
                    </CardDescription>
                  </div>
                  <BudgetMenu budget={{ id: row.id, name: row.name, categoryId: row.categoryId, period: row.period, amount: row.amount, startDate: row.startDate, endDate: row.endDate, rollover: row.rollover, alertThresholds: row.alertThresholds }} />
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="tabular text-2xl font-semibold">{formatMoney(b.spent)}</p>
                      <p className="text-xs text-muted">sur {formatMoney(b.effectiveAmount)}{b.carryOver ? ` (dont report ${formatMoney(b.carryOver, undefined, { signed: true })})` : ""}</p>
                    </div>
                    <Badge tone={b.level === "exceeded" || b.level === "danger" ? "negative" : b.level === "warning" ? "warning" : "positive"}>{formatPct(b.ratio, 0)} · {BUDGET_LEVEL_LABEL[b.level]}</Badge>
                  </div>
                  <Progress value={b.ratio} className="mt-3" label={b.budget.name} />
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-subtle">Restant</dt><dd className={`tabular font-medium ${b.remaining < 0 ? "text-negative" : ""}`}>{formatMoney(b.remaining)}</dd></div>
                    <div><dt className="text-subtle">Par jour ({b.daysLeft} j)</dt><dd className="tabular font-medium">{b.dailyRemaining === null ? "—" : formatMoney(b.dailyRemaining)}</dd></div>
                    <div><dt className="text-subtle">Période</dt><dd>{formatDateFR(b.from)} → {formatDateFR(b.to)}</dd></div>
                    <div><dt className="text-subtle">Projection fin de période</dt><dd className={`tabular font-medium ${b.projectedSpend !== null && b.projectedSpend > b.effectiveAmount ? "text-warning" : ""}`}>{b.projectedSpend === null ? "—" : formatMoney(b.projectedSpend)}</dd></div>
                  </dl>
                  {recent.length > 0 && (
                    <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs">
                      {recent.map((t) => (
                        <li key={t.id} className="flex justify-between gap-2">
                          <span className="truncate text-muted">{formatDateFR(t.date)} · {t.merchant || t.description || "Dépense"}</span>
                          <span className="tabular">{formatMoney(-t.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {statuses.some((s) => s.budget.period === "monthly") && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle>Budgets prévus vs dépenses réelles</CardTitle>
              <CardDescription>Six derniers mois (montants mensuels, mois en cours partiel)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-subtle">
                  <th className="py-2 font-medium">Budget</th>
                  {months.map((m) => (
                    <th key={m} className="py-2 text-right font-medium capitalize">{formatMonthLabel(monthKey(m), true)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {statuses.filter((s) => s.budget.period === "monthly").map((s) => (
                  <tr key={s.budget.id}>
                    <td className="py-2 pr-3">{s.budget.name}<span className="block text-xs text-subtle">{formatMoney(s.budget.amount)} / mois</span></td>
                    {months.map((m) => {
                      const spent = budgetSpent(s.budget, fin.txs, fin.cmap, m, endOfMonth(m) > today ? today : endOfMonth(m));
                      const over = spent > s.budget.amount;
                      return (
                        <td key={m} className={`tabular py-2 text-right ${over ? "text-negative" : ""}`}>
                          {formatMoney(spent, undefined, { decimals: false })}
                          <span className="block text-[11px] text-subtle">{formatPct(spent / s.budget.amount, 0)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
