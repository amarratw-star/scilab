import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { listNotifications } from "@/server/services/notifications";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { MarkAllRead } from "./mark-read";

export const metadata: Metadata = { title: "Notifications" };

const ICON = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CheckCircle2 } as const;
const COLOR = { info: "text-info", warning: "text-warning", danger: "text-negative", success: "text-positive" } as const;

export default async function NotificationsPage() {
  const user = await requireUser();
  const list = await runAsUser(user, (ctx) => listNotifications(ctx, 100));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" description={<>Seulement l&apos;essentiel. <Link href="/parametres#notifications" className="text-info hover:underline">Choisir les notifications</Link></>} actions={list.some((n) => !n.readAt) ? <MarkAllRead /> : null} />
      {list.length === 0 ? (
        <EmptyState icon={<Bell />} title="Aucune notification" description="Dépassements de budget, prélèvements à venir, objectifs atteints… apparaîtront ici." />
      ) : (
        <Card className="divide-y divide-border">
          {list.map((n) => {
            const sev = (n.severity in ICON ? n.severity : "info") as keyof typeof ICON;
            const Icon = ICON[sev];
            return (
              <Link key={n.id} href={n.link ?? "#"} className={`flex gap-3 p-4 transition hover:bg-surface-2 ${n.readAt ? "opacity-70" : ""}`}>
                <Icon className={`mt-0.5 size-4 shrink-0 ${COLOR[sev]}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">{n.title}{!n.readAt && <span className="size-2 rounded-full bg-info" aria-label="Non lue" />}</span>
                  <span className="block text-sm text-muted">{n.body}</span>
                  <span className="text-xs text-subtle">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: user.timezone }).format(n.createdAt)}</span>
                </span>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
