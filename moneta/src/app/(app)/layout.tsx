import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import * as s from "@/server/db/schema";
import { asc, isNull } from "drizzle-orm";
import { unreadCount } from "@/server/services/notifications";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ref = await runAsUser(user, async (ctx) => {
    const [accounts, categories, unread] = await Promise.all([
      ctx.tx.select({ id: s.accounts.id, name: s.accounts.name, type: s.accounts.type, color: s.accounts.color, icon: s.accounts.icon, currency: s.accounts.currency, archivedAt: s.accounts.archivedAt }).from(s.accounts).orderBy(asc(s.accounts.sortOrder)),
      ctx.tx
        .select({ id: s.categories.id, name: s.categories.name, kind: s.categories.kind, parentId: s.categories.parentId, icon: s.categories.icon, color: s.categories.color })
        .from(s.categories)
        .where(isNull(s.categories.archivedAt))
        .orderBy(asc(s.categories.sortOrder), asc(s.categories.name)),
      unreadCount(ctx),
    ]);
    return { accounts: accounts.filter((a) => !a.archivedAt).map(({ archivedAt: _a, ...a }) => a), categories, unread, today: ctx.today, currency: user.currency };
  });
  if (!user.onboardedAt && !user.isDemo && ref.accounts.length === 0) {
    // Premier lancement : assistant de démarrage
    return redirect("/bienvenue");
  }
  return (
    <AppShell
      user={{ displayName: user.displayName, email: user.isDemo ? "Espace de démonstration" : user.email, isDemo: user.isDemo, hasDemoData: user.hasDemoData }}
      refData={ref}
    >
      {children}
    </AppShell>
  );
}
