"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Combine, Landmark, Loader2, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Trash2, Unplug, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Callout } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { confirmDistinctAccountAction, deleteConnectionAction, mergeAccountsAction, refreshConnectionAction, setAccountSyncAction } from "@/app/actions/bank";
import type { ConnectionView } from "@/server/bank/service";
import { BankInitials, startWebview } from "@/components/bank/bank-ui";

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso)) : null);

const toneIcon = { positive: CheckCircle2, info: Loader2, warning: AlertTriangle, negative: WifiOff, neutral: Clock } as const;

export function BankConnections({ available, unavailableMessage, connections, manualAccounts }: { available: boolean; unavailableMessage: string | null; connections: ConnectionView[]; manualAccounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<ConnectionView | null>(null);
  const [merge, setMerge] = useState<{ bankAccountId: string; name: string } | null>(null);

  const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      setBusy(key);
      const r = await fn();
      setBusy(null);
      if (r.ok) toast.success(r.message ?? "Fait");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <section id="connexions" className="mt-8 scroll-mt-20" aria-labelledby="connexions-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="connexions-title" className="flex items-center gap-2 text-[15px] font-semibold"><Landmark className="size-4" /> Connexions bancaires</h2>
          <p className="text-xs text-muted">Synchronisation en lecture seule via un agrégateur agréé (DSP2). Aucun virement ni paiement possible depuis MONETA.</p>
        </div>
        {available && (
          <Button asChild size="sm">
            <a href="/connecter-banque"><Plus /> Connecter une banque</a>
          </Button>
        )}
      </div>

      {!available && (
        <Callout tone="neutral" icon={<ShieldCheck className="size-4" />} title="Connexion bancaire indisponible">
          {unavailableMessage} <Link href="/confidentialite-bancaire" className="underline">En savoir plus</Link>
        </Callout>
      )}

      {available && connections.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6 text-center">
          <ShieldCheck className="mx-auto size-8 text-muted" />
          <p className="mt-2 font-medium">Aucune banque connectée</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Tes opérations arrivent automatiquement, catégorisées et rapprochées de tes saisies. Tu t&apos;authentifies directement auprès de ta banque : MONETA ne voit jamais tes identifiants.</p>
          <Button asChild className="mt-4"><a href="/connecter-banque">Connecter ma banque</a></Button>
        </div>
      )}

      <div className="space-y-3">
        {connections.map((c) => {
          const Icon = toneIcon[c.info.tone];
          return (
            <article key={c.id} className="min-w-0 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label={`Connexion ${c.name}`}>
              <div className="flex flex-wrap items-start gap-3">
                <BankInitials name={c.name} color={c.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{c.name}</p>
                    <Badge tone={c.info.tone === "neutral" ? "neutral" : c.info.tone}>
                      <Icon className={c.info.tone === "info" ? "animate-spin" : undefined} /> {c.info.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {c.lastSyncAt ? `Dernière synchronisation : ${fmt(c.lastSyncAt)}` : "Jamais synchronisée"}
                    {c.nextSyncAt && c.info.action === "none" ? ` · prochaine : ${fmt(c.nextSyncAt)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {c.info.action === "reconnect" && (
                    <Button size="sm" onClick={() => startWebview({ flow: "reconnect", connectionId: c.id })}>Reconnecter</Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label={`Actualiser ${c.name}`} disabled={pending} onClick={() => run(`r-${c.id}`, () => refreshConnectionAction(c.id))}>
                    <RefreshCw className={busy === `r-${c.id}` ? "animate-spin" : undefined} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Options de ${c.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => startWebview({ flow: "manage", connectionId: c.id })}><Plus /> Ajouter ou retirer des comptes</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => startWebview({ flow: "reconnect", connectionId: c.id })}><ShieldCheck /> Renouveler l&apos;autorisation</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDel(c)}><Unplug /> Supprimer la connexion</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {(c.info.action !== "none" || c.lastError) && (
                <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${c.info.tone === "negative" ? "bg-negative-soft text-negative" : c.info.tone === "warning" ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted"}`} role={c.info.tone === "negative" ? "alert" : undefined}>
                  {c.info.action !== "none" ? c.info.message : `Dernier incident : ${c.lastError}. Les données affichées sont celles de la dernière synchronisation réussie.`}
                </p>
              )}

              {c.accounts.length > 0 && (
                <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                  {c.accounts.map((a) => (
                    <li key={a.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <Link href={`/comptes/${a.accountId}`} className="block truncate font-medium hover:underline">{a.name}</Link>
                        <p className="truncate text-xs text-subtle">
                          {a.ibanMasked ?? "IBAN non communiqué"}
                          {a.disabledAtBank ? " · non partagé avec MONETA" : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        {a.bankBalance !== null ? <Money cents={a.bankBalance} currency={a.currency ?? undefined} className="text-sm font-medium" /> : <span className="text-xs text-subtle">Solde non communiqué</span>}
                        {a.balanceAt && <p className="text-[11px] text-subtle">au {fmt(a.balanceAt)}</p>}
                      </div>
                      {a.duplicateOf ? (
                        <div className="basis-full rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning" role="status">
                          <p>
                            <strong>Compte déjà synchronisé ?</strong> Il ressemble à « {a.duplicateOf} », déjà connecté via une autre connexion. Pour éviter de compter ton argent deux fois, il n&apos;est pas synchronisé et reste hors de tes totaux.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`d-${a.accountId}`, () => confirmDistinctAccountAction(a.accountId))}>
                              C&apos;est un autre compte : le synchroniser
                            </Button>
                            <span className="self-center text-subtle">Sinon, rien à faire (ou retire-le du partage via « ⋯ › Ajouter ou retirer des comptes »).</span>
                          </div>
                        </div>
                      ) : (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <Switch checked={a.syncEnabled} disabled={pending} onCheckedChange={(v) => run(`s-${a.accountId}`, () => setAccountSyncAction(a.accountId, v))} aria-label={`Synchroniser ${a.name}`} />
                        <span className="hidden sm:inline">Synchro</span>
                      </label>
                      )}
                      {manualAccounts.length > 0 && !a.duplicateOf && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Rapprocher un compte manuel de ${a.name}`} title="Rapprocher un compte manuel" onClick={() => setMerge({ bankAccountId: a.accountId, name: a.name })}>
                          <Combine />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent title={`Supprimer la connexion ${del?.name ?? ""}`} description="La connexion sera supprimée chez l'agrégateur (révocation du consentement). Que faire des données déjà importées ?">
          <div className="space-y-2">
            <Button variant="outline" className="h-auto w-full justify-start py-3 text-left whitespace-normal" disabled={pending} onClick={() => { if (del) run("del", () => deleteConnectionAction(del.id, true)); setDel(null); }}>
              <span>
                <span className="block font-medium">Conserver mes comptes et opérations</span>
                <span className="block text-xs text-muted">Ils deviennent des comptes manuels. Recommandé.</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto w-full justify-start border-negative/40 py-3 text-left whitespace-normal text-negative" disabled={pending} onClick={() => { if (del) run("del", () => deleteConnectionAction(del.id, false)); setDel(null); }}>
              <Trash2 />
              <span>
                <span className="block font-medium">Tout supprimer</span>
                <span className="block text-xs">Les comptes synchronisés et leurs opérations seront définitivement effacés de MONETA.</span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <MergeDialog target={merge} manualAccounts={manualAccounts} onClose={() => setMerge(null)} onConfirm={(manualId) => merge && run("merge", () => mergeAccountsAction(manualId, merge.bankAccountId))} />
    </section>
  );
}

function MergeDialog({ target, manualAccounts, onClose, onConfirm }: { target: { bankAccountId: string; name: string } | null; manualAccounts: { id: string; name: string }[]; onClose: () => void; onConfirm: (manualId: string) => void }) {
  const [choice, setChoice] = useState<string>("");
  const [checked, setChecked] = useState(false);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { onClose(); setChoice(""); setChecked(false); } }}>
      <DialogContent title={`Rapprocher un compte manuel de « ${target?.name ?? ""} »`} description="Les opérations du compte manuel sont déplacées vers le compte synchronisé. Les doublons éventuels te seront proposés : rien n'est supprimé sans ton accord.">
        <label className="block text-sm font-medium" htmlFor="merge-manual">Compte manuel représentant le même compte réel</label>
        <select id="merge-manual" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choisir…</option>
          {manualAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>Je confirme qu&apos;il s&apos;agit du même compte bancaire. Le compte manuel sera retiré une fois ses opérations déplacées.</span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button disabled={!choice || !checked} onClick={() => { onConfirm(choice); onClose(); setChoice(""); setChecked(false); }}>Rapprocher</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
