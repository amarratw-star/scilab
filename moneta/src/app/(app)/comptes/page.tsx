import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Wallet } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { IconBadge } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { CategoryDonut } from "@/components/charts/charts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { NewAccountButton } from "./new-account";
import { formatPct } from "@/lib/money";

export const metadata: Metadata = { title: "Comptes" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const active = fin.accountRows.filter((a) => !a.archivedAt);
  const archived = fin.accountRows.filter((a) => a.archivedAt);
  const bal = (id: string) => fin.balances.get(id) ?? 0;
  const positiveTotal = active.reduce((s, a) => s + Math.max(0, bal(a.id)), 0);
  const groups = Object.entries(
    active.reduce<Record<string, typeof active>>((acc, a) => {
      (acc[a.type] ??= []).push(a);
      return acc;
    }, {}),
  );
  return (
    <div>
      <PageHeader title="Comptes" description="Tous tes comptes et la répartition de ton argent." actions={<NewAccountButton today={today} autoOpen={sp.nouveau === "1"} then={sp.suite === "import" ? "/import" : undefined} />} />
      {active.length === 0 ? (
        <EmptyState icon={<Wallet />} title="Aucun compte" description="Ajoute ton compte courant, ton livret, tes espèces… Chaque compte démarre avec un solde initial." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total des comptes" value={<Money cents={fin.summary.totalFinancial} />} />
            <Stat label="Disponible" accent="info" value={<Money cents={fin.summary.available} />} hint="Courants, secondaires, espèces" />
            <Stat label="Épargne" accent="positive" value={<Money cents={fin.summary.savings} />} hint="Livrets" />
            <Stat label="Placements" value={<Money cents={fin.summary.investments} />} hint="Investissements et placements" />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              {groups.map(([type, list]) => (
                <section key={type}>
                  <h2 className="mb-2 text-sm font-medium text-muted">{ACCOUNT_TYPE_LABELS[type]}</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {list.map((a) => (
                      <Link key={a.id} href={`/comptes/${a.id}`} className="group rounded-[var(--radius-card)] border border-border bg-surface p-4 transition hover:border-border-strong hover:shadow-sm">
                        <div className="flex items-center gap-3">
                          <IconBadge icon={a.icon} color={a.color} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{a.name}</p>
                            <p className="truncate text-xs text-subtle">{a.institution ?? ACCOUNT_TYPE_LABELS[a.type]}</p>
                          </div>
                        </div>
                        <p className="mt-4 text-2xl font-semibold tracking-tight">
                          <Money cents={bal(a.id)} tone={bal(a.id) < 0 ? "negative" : "none"} />
                        </p>
                        <p className="text-xs text-subtle">{positiveTotal ? `${formatPct(Math.max(0, bal(a.id)) / positiveTotal, 0)} de ton argent` : ""}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
              {archived.length > 0 && (
                <section>
                  <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted"><Archive className="size-4" /> Comptes archivés</h2>
                  <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                    {archived.map((a) => (
                      <Link key={a.id} href={`/comptes/${a.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2">
                        <span>{a.name} <Badge>Archivé</Badge></span>
                        <Money cents={bal(a.id)} className="text-muted" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <Card className="h-fit">
              <CardHeader>
                <div>
                  <CardTitle>Répartition</CardTitle>
                  <CardDescription>Comptes à solde positif</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <CategoryDonut data={active.filter((a) => bal(a.id) > 0).sort((x, y) => bal(y.id) - bal(x.id)).map((a) => ({ name: a.name, amount: bal(a.id), color: a.color, share: positiveTotal ? bal(a.id) / positiveTotal : null }))} total={positiveTotal} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
