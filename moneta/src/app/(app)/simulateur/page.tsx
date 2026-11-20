import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { computeForecast, computeOverview } from "@/server/services/overview";
import { expensesByCategory, monthlySeries } from "@/lib/finance/stats";
import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { Simulator } from "./simulator";

export const metadata: Metadata = { title: "Simulateur" };

export default async function SimulatorPage() {
  const user = await requireUser();
  const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
  const ov = computeOverview(fin, today, settings);
  const from3 = startOfMonth(addMonths(today, -3));
  const to3 = addDays(startOfMonth(today), -1);
  const series = monthlySeries(fin.txs, from3, to3);
  const avgIncome = series.length ? Math.round(series.reduce((s, m) => s + m.income, 0) / series.length) : 0;
  const avgExpenses = series.length ? Math.round(series.reduce((s, m) => s + m.expenses, 0) / series.length) : 0;
  const cats = expensesByCategory(fin.txs, from3, to3, fin.cmap)
    .filter((c) => c.categoryId)
    .map((c) => ({ id: c.categoryId!, name: c.name, monthly: Math.round(c.amount / 3) }));
  const f = computeForecast(fin, today, 365, "all");
  return (
    <div>
      <PageHeader title="Simulateur" description="Teste une décision avant de la prendre. Les résultats sont des estimations basées sur tes données, pas des garanties." />
      <Simulator
        available={ov.available}
        budgets={ov.budgets.map((b) => ({ id: b.budget.id, name: b.budget.name, categoryId: b.budget.categoryId, remaining: b.remaining, status: b }))}
        avgIncome={avgIncome}
        avgExpenses={avgExpenses}
        categories={cats}
        hasHistory={series.some((m) => m.income > 0 || m.expenses > 0)}
        scenarios={{ reliability: f.reliability, start: f.startBalance, milestones: f.milestones, assumptions: f.assumptions }}
      />
    </div>
  );
}
