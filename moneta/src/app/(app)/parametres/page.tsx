import type { Metadata } from "next";
import { requireUser, getCurrentSession, listSessions } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { notificationPrefs, NOTIFICATION_LABELS } from "@/server/services/notifications";
import * as s from "@/server/db/schema";
import { asc, desc } from "drizzle-orm";
import { features } from "@/server/env";
import { PageHeader } from "@/components/ui/misc";
import { SettingsSections } from "./sections";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const user = await requireUser();
  const current = await getCurrentSession();
  const sessions = await listSessions(user.id);
  const { cats, rules, runs } = await runAsUser(user, async (ctx) => ({
    cats: await ctx.tx.select().from(s.categories).orderBy(asc(s.categories.kind), asc(s.categories.sortOrder), asc(s.categories.name)),
    rules: await ctx.tx.select().from(s.merchantRules).orderBy(asc(s.merchantRules.pattern)),
    runs: await ctx.tx.select().from(s.syncRuns).orderBy(desc(s.syncRuns.startedAt)).limit(20),
  }));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Paramètres" />
      <SettingsSections
        user={{ displayName: user.displayName, email: user.email, isDemo: user.isDemo, hasDemoData: user.hasDemoData, currency: user.currency, timezone: user.timezone, settings: user.settings }}
        prefs={notificationPrefs(user.settings)}
        prefLabels={NOTIFICATION_LABELS}
        sessions={sessions.map((x) => ({ id: x.id, current: x.id === current?.sessionId, userAgent: x.userAgent, ip: x.ip, lastSeenAt: x.lastSeenAt.toISOString(), createdAt: x.createdAt.toISOString() }))}
        categories={cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, icon: c.icon, color: c.color, isFixed: c.isFixed }))}
        features={{ ai: features.ai(), push: features.push(), email: features.email(), bank: features.bank() }}
        vapidKey={process.env.VAPID_PUBLIC_KEY ?? null}
        bank={{
          rules: rules.map((r) => ({ id: r.id, pattern: r.pattern, category: catName.get(r.categoryId) ?? "Catégorie" })),
          runs: runs.map((r) => ({ id: r.id, at: r.startedAt.toISOString(), trigger: r.trigger, status: r.status, created: r.created, updated: r.updated, merged: r.merged, message: r.message })),
        }}
      />
    </div>
  );
}
