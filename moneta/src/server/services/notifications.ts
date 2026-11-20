import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { NotificationType } from "@/server/db/schema";
import type { Ctx } from "./context";
import { loadFinance, type Finance } from "./snapshot";
import { computeOverview } from "./overview";
import { addDays, addMonths, endOfMonth, formatDateFR, formatMonthLabel, monthKey, startOfMonth, startOfWeek } from "@/lib/dates";
import { scheduledItems } from "@/lib/finance/recurring";
import { goalProgress } from "@/lib/finance/goals";
import { unusualExpenses } from "@/lib/finance/insights";
import { periodTotals } from "@/lib/finance/stats";
import { formatMoneyPlain, formatPct } from "@/lib/money";
import { sendPush } from "@/server/push";

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  budget_exceeded: "Dépassement de budget",
  budget_warning: "Budget bientôt atteint",
  upcoming_debit: "Prélèvement à venir",
  goal_reached: "Objectif atteint",
  unusual_expense: "Dépense inhabituelle",
  low_balance: "Solde faible",
  weekly_digest: "Bilan hebdomadaire",
  monthly_digest: "Bilan mensuel",
};

const DEFAULTS: Record<NotificationType, boolean> = {
  budget_exceeded: true,
  budget_warning: true,
  upcoming_debit: true,
  goal_reached: true,
  unusual_expense: true,
  low_balance: true,
  weekly_digest: false,
  monthly_digest: true,
};

export function notificationPrefs(settings: s.UserSettings): Record<NotificationType, boolean> {
  return { ...DEFAULTS, ...(settings.notifications ?? {}) };
}

type NewNotif = { type: NotificationType; severity: "info" | "warning" | "danger" | "success"; title: string; body: string; link?: string; dedupeKey: string };

/**
 * Évalue les règles de notification et insère les nouvelles (idempotent grâce à la clé de déduplication).
 * Une même alerte n'est jamais envoyée deux fois.
 */
export async function generateNotifications(ctx: Ctx, fin?: Finance, opts: { digests?: boolean } = {}) {
  const f = fin ?? (await loadFinance(ctx));
  const prefs = notificationPrefs(ctx.settings);
  const today = ctx.today;
  const ov = computeOverview(f, today, ctx.settings);
  const out: NewNotif[] = [];

  for (const b of ov.budgets) {
    if (b.reachedThreshold === null) continue;
    const exceeded = b.spent > b.effectiveAmount;
    const type: NotificationType = exceeded ? "budget_exceeded" : "budget_warning";
    if (!exceeded && b.reachedThreshold < 75) continue; // on ne dérange pas pour 50 %
    out.push({
      type,
      severity: exceeded ? "danger" : "warning",
      title: exceeded ? `Budget « ${b.budget.name} » dépassé` : `Budget « ${b.budget.name} » à ${b.reachedThreshold} %`,
      body: `${formatMoneyPlain(b.spent)} dépensés sur ${formatMoneyPlain(b.effectiveAmount)}${exceeded ? "" : ` — il reste ${formatMoneyPlain(b.remaining)}`}.`,
      link: "/budgets",
      dedupeKey: `budget:${b.budget.id}:${b.from}:${exceeded ? "over" : b.reachedThreshold}`,
    });
  }
  for (const it of scheduledItems(f.rules, f.txs, today, addDays(today, 2)).filter((i) => !i.realized && i.kind === "expense")) {
    out.push({
      type: "upcoming_debit",
      severity: "info",
      title: `Prélèvement le ${formatDateFR(it.date)}`,
      body: `${it.name} : ${formatMoneyPlain(it.amount)}.`,
      link: "/calendrier",
      dedupeKey: `debit:${it.ruleId}:${it.date}`,
    });
  }
  for (const g of f.goals) {
    const p = goalProgress(g, f.contributions, today);
    if (p.state === "reached")
      out.push({ type: "goal_reached", severity: "success", title: `Objectif « ${g.name} » atteint 🎉`, body: `Tu as réuni ${formatMoneyPlain(p.saved)}.`, link: "/epargne", dedupeKey: `goal:${g.id}:reached` });
  }
  for (const u of unusualExpenses(f.txs, addDays(today, -3), today, f.cmap)) {
    out.push({ type: "unusual_expense", severity: "warning", title: "Dépense inhabituelle", body: `${u.tx.merchant || u.tx.description || "Dépense"} — ${u.reason}`, link: "/transactions", dedupeKey: `unusual:${u.tx.id}` });
  }
  if (ov.available.status === "ok") {
    const cushion = ctx.settings.safetyCushion ?? 0;
    if (ov.available.availableNow < Math.max(cushion, 0) || ov.available.spendableUntilMonthEnd < 0) {
      out.push({
        type: "low_balance",
        severity: "danger",
        title: "Solde faible",
        body:
          ov.available.spendableUntilMonthEnd < 0
            ? `Tes engagements d'ici la fin du mois dépassent ton disponible de ${formatMoneyPlain(-ov.available.spendableUntilMonthEnd)}.`
            : `Ton solde disponible (${formatMoneyPlain(ov.available.availableNow)}) est sous ton coussin de sécurité.`,
        link: "/disponible",
        dedupeKey: `low:${startOfWeek(today)}`,
      });
    }
  }
  if (opts.digests !== false) {
    // Bilan mensuel du mois précédent (une fois, dès le début du mois)
    const prevStart = startOfMonth(addMonths(today, -1));
    const prev = periodTotals(f.txs, prevStart, endOfMonth(prevStart), f.cmap);
    if (prev.incomeCount + prev.expenseCount > 0)
      out.push({
        type: "monthly_digest",
        severity: "info",
        title: `Bilan de ${formatMonthLabel(monthKey(prevStart))}`,
        body: `Revenus ${formatMoneyPlain(prev.income)}, dépenses ${formatMoneyPlain(prev.netExpenses)}, épargne ${formatMoneyPlain(prev.netSavings)} (${formatPct(prev.savingsRate)}).`,
        link: `/rapports?mois=${monthKey(prevStart)}`,
        dedupeKey: `monthly:${monthKey(prevStart)}`,
      });
    const weekStart = addDays(startOfWeek(today), -7);
    const week = periodTotals(f.txs, weekStart, addDays(weekStart, 6), f.cmap);
    if (week.expenseCount > 0)
      out.push({
        type: "weekly_digest",
        severity: "info",
        title: "Bilan de la semaine dernière",
        body: `${formatMoneyPlain(week.netExpenses)} dépensés, ${formatMoneyPlain(week.income)} reçus.`,
        link: "/analyses",
        dedupeKey: `weekly:${weekStart}`,
      });
  }

  const enabled = out.filter((n) => prefs[n.type]);
  if (!enabled.length) return 0;
  const inserted = await ctx.tx
    .insert(s.notifications)
    .values(enabled.map((n) => ({ ...n, userId: ctx.userId })))
    .onConflictDoNothing()
    .returning({ id: s.notifications.id, title: s.notifications.title, body: s.notifications.body, link: s.notifications.link });
  if (inserted.length) {
    const subs = await ctx.tx.select().from(s.pushSubscriptions);
    if (subs.length) await sendPush(subs, inserted).catch(() => undefined);
  }
  return inserted.length;
}

export async function listNotifications(ctx: Ctx, limit = 30) {
  return ctx.tx.select().from(s.notifications).orderBy(desc(s.notifications.createdAt)).limit(limit);
}

export async function unreadCount(ctx: Ctx) {
  const [r] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.notifications).where(isNull(s.notifications.readAt));
  return r.n;
}

export async function markRead(ctx: Ctx, id?: string) {
  await ctx.tx
    .update(s.notifications)
    .set({ readAt: new Date() })
    .where(id ? and(eq(s.notifications.id, id), isNull(s.notifications.readAt)) : isNull(s.notifications.readAt));
}
