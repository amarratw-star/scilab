import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Wallet } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { IconBadge } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { CategoryDonut } from "@/components/charts/charts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { NewAccountButton } from "./new-account";
import { formatPct } from "@/lib/money";
import { bankStatus, connectionViews } from "@/server/bank/service";
import { BankConnections } from "./connections";
import { describeConnectionState } from "@/lib/bank/states";

const CALLBACK_MESSAGES: Record<string, { tone: "positive" | "warning" | "negative" | "info"; title: string; body: string }> = {
  ok: { tone: "positive", title: "Banque connectée", body: "Tes comptes partagés ont été synchronisés." },
  partiel: { tone: "warning", title: "Connexion établie, synchronisation incomplète", body: "La banque est connectée mais la récupération des opérations a échoué temporairement. Elle reprendra automatiquement ; tu peux aussi actualiser plus tard." },
  access_denied: { tone: "info", title: "Connexion annulée", body: "Tu as interrompu le parcours ou refusé l'accès. Aucune donnée n'a été récupérée." },
  cancelled: { tone: "info", title: "Connexion annulée", body: "Aucune donnée n'a été récupérée." },
  server_error: { tone: "negative", title: "La banque n'a pas pu être jointe", body: "Le service de ta banque ou de l'agrégateur a rencontré un problème. Réessaie dans quelques minutes." },
  temporarily_unavailable: { tone: "negative", title: "Service momentanément indisponible", body: "Réessaie dans quelques minutes." },
  etat: { tone: "negative", title: "Retour de connexion non reconnu", body: "Par sécurité, ce retour a été ignoré (lien expiré ou ouvert dans un autre navigateur). Relance la connexion depuis cette page." },
  indisponible: { tone: "negative", title: "Connexion bancaire indisponible", body: "Elle n'est pas activée pour ce compte." },
  erreur: { tone: "negative", title: "La connexion n'a pas abouti", body: "Aucune donnée n'a été importée. Tu peux réessayer." },
};

export const metadata: Metadata = { title: "Comptes" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const bank = bankStatus(user);
  const { fin, today, connections } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, connections: await connectionViews(ctx) }));
  const linked = new Set(connections.flatMap((c) => c.accounts.map((a) => a.accountId)));
  const manualAccounts = fin.accountRows.filter((a) => !a.archivedAt && !linked.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  const base = sp.banque ? CALLBACK_MESSAGES[sp.banque] ?? CALLBACK_MESSAGES.erreur : null;
  // Message adapté au parcours : connexion, renouvellement d'autorisation ou gestion des comptes partagés
  const cb =
    base && sp.banque === "ok" && sp.flux === "reconnect"
      ? { ...base, title: "Autorisation renouvelée", body: "Ta banque est de nouveau accessible ; la synchronisation a repris." }
      : base && sp.banque === "ok" && sp.flux === "manage"
        ? { ...base, title: "Comptes partagés mis à jour", body: "Les comptes que tu partages avec MONETA ont été mis à jour." }
        : sp.banque === "refus" && sp.code
          ? (() => {
              if (sp.code === "wrongpass") return { tone: "negative" as const, title: "Identifiants refusés par ta banque", body: "Vérifie ton identifiant et ton mot de passe bancaires (saisis chez ta banque, jamais dans MONETA), puis réessaie. Aucune donnée n'a été importée." };
              const i = describeConnectionState(sp.code);
              return { tone: i.tone === "negative" ? ("negative" as const) : ("warning" as const), title: `La connexion n'a pas abouti : ${i.label.toLowerCase()}`, body: `${i.message} Aucune donnée n'a été importée.` };
            })()
          : base;
  const created = Number(sp.nouvelles ?? 0);
  const dups = Number(sp.doublons ?? 0);
  const active = fin.accountRows.filter((a) => !a.archivedAt);
  const archived = fin.accountRows.filter((a) => a.archivedAt);
  const bal = (id: string) => fin.balances.get(id) ?? 0;
  const foreign = (id: string) => fin.foreignAccountIds.has(id);
  const domestic = active.filter((a) => !foreign(a.id));
  const positiveTotal = domestic.reduce((s, a) => s + Math.max(0, bal(a.id)), 0);
  const groups = Object.entries(
    active.reduce<Record<string, typeof active>>((acc, a) => {
      (acc[a.type] ??= []).push(a);
      return acc;
    }, {}),
  );
  return (
    <div>
      <PageHeader title="Comptes" description="Tous tes comptes et la répartition de ton argent." actions={<NewAccountButton today={today} autoOpen={sp.nouveau === "1"} then={sp.suite === "import" ? "/import" : undefined} />} />
      {cb && (
        <Callout tone={cb.tone} className="mb-4" title={cb.title}>
          {cb.body}
          {sp.banque === "ok" && created > 0 && <> {created} nouvelle(s) opération(s){dups ? `, dont ${dups} doublon(s) possible(s)` : ""}. <Link href="/transactions/a-verifier" className="font-medium underline">Les vérifier</Link></>}
        </Callout>
      )}
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
                          <Money cents={bal(a.id)} currency={foreign(a.id) ? a.currency : undefined} tone={bal(a.id) < 0 ? "negative" : "none"} />
                        </p>
                        <p className="text-xs text-subtle">{foreign(a.id) ? `Compte en ${a.currency} : hors totaux (aucune conversion de devise)` : positiveTotal ? `${formatPct(Math.max(0, bal(a.id)) / positiveTotal, 0)} de ton argent` : ""}</p>
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
                        <Money cents={bal(a.id)} currency={foreign(a.id) ? a.currency : undefined} className="text-muted" />
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
                <CategoryDonut data={domestic.filter((a) => bal(a.id) > 0).sort((x, y) => bal(y.id) - bal(x.id)).map((a) => ({ name: a.name, amount: bal(a.id), color: a.color, share: positiveTotal ? bal(a.id) / positiveTotal : null }))} total={positiveTotal} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <BankConnections available={bank.available} unavailableMessage={bank.message} connections={connections} manualAccounts={manualAccounts} />
    </div>
  );
}
