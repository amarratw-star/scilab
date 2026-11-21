"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCheck, Combine, Flag, Pencil, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { useQuickAdd } from "@/components/app/app-shell";
import type { TxView } from "@/components/app/tx-list";
import { formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";
import { CONFIRM_THRESHOLD } from "@/lib/bank/categorize";
import { createRuleAction, markVerifiedAction, reportMiscategorizedAction, resolveDuplicateAction, setTxCategoryAction, undoAutoMergeAction } from "@/app/actions/bank";
import type { ReviewFilters, ReviewTx, reviewData } from "@/server/bank/service";

type Data = Awaited<ReturnType<typeof reviewData>>;
type Result = { ok: boolean; error?: string; message?: string };

const SOURCE_LABEL: Record<string, string> = { rule: "Ta règle", bank: "Catégorie bancaire", history: "Tes habitudes", local: "Suggestion", user: "Ton choix", ai: "IA" };

const signed = (t: Pick<ReviewTx, "kind" | "amount">) => (t.kind === "expense" ? -t.amount : t.kind === "transfer" ? -t.amount : t.amount);

export function ReviewBoard({ data, filters }: { data: Data; filters: ReviewFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Fait");
      else toast.error(r.error);
      router.refresh();
    });
  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v);
    else q.delete(k);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      {data.duplicates.length > 0 && (
        <section aria-labelledby="dups">
          <h2 id="dups" className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><Combine className="size-4" /> Doublons possibles <Badge tone="warning">{data.duplicates.length}</Badge></h2>
          <p className="mb-3 text-xs text-muted">Une opération saisie à la main ressemble à une opération bancaire. Fusionner conserve l&apos;opération bancaire (avec ta catégorie, tes notes et justificatifs) et annule la saisie manuelle — elle reste consultable.</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.duplicates.map((d) => (
              <Card key={d.id} className="min-w-0 p-4">
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  {[{ t: d.bank, l: "Banque" }, { t: d.manual, l: "Saisie manuelle" }].map(({ t, l }) => (
                    <div key={l} className="min-w-0 rounded-xl bg-surface-2 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">{l}</p>
                      <p className="truncate font-medium">{t.description ?? t.bankLabel ?? "Opération"}</p>
                      <p className="text-xs text-muted">{formatDateFR(t.date)} · {t.accountName}</p>
                      <p className="tabular mt-1 font-semibold">{formatMoney(signed(t), undefined, { signed: true })}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">Ressemblance : {d.score} / 100</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveDuplicateAction(d.id, "keep_both"))}>Garder les deux</Button>
                    <Button size="sm" disabled={pending} onClick={() => run(() => resolveDuplicateAction(d.id, "merge"))}><Combine /> Fusionner</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {data.suggestions.length > 0 && (
        <section aria-labelledby="rules">
          <h2 id="rules" className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4" /> Mémoriser tes choix ?</h2>
          <div className="space-y-2">
            {data.suggestions.slice(0, 5).map((s) => (
              <RuleSuggestion key={s.pattern} s={s} catName={catName.get(s.categoryId) ?? "Catégorie"} pending={pending} run={run} />
            ))}
          </div>
        </section>
      )}

      {data.autoMerged.length > 0 && (
        <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Fusions automatiques récentes ({data.autoMerged.length})</summary>
          <p className="mt-1 text-xs text-muted">Ces saisies manuelles correspondaient sans ambiguïté à une opération bancaire et ont été complétées par celle-ci. Tu peux annuler chaque fusion.</p>
          <ul className="mt-2 divide-y divide-border">
            {data.autoMerged.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{m.tx.description ?? m.tx.bankLabel} · {formatDateFR(m.tx.date)} · <span className="tabular">{formatMoney(signed(m.tx), undefined, { signed: true })}</span></span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => undoAutoMergeAction(m.id))}><Undo2 /> Annuler la fusion</Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="list">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="list" className="mr-auto text-[15px] font-semibold">Opérations importées</h2>
          <Segmented size="sm" value={filters.statut ?? "non"} onChange={(v) => setParam("statut", v === "non" ? null : v)} options={[{ value: "non", label: "Non vérifiées" }, { value: "oui", label: "Vérifiées" }, { value: "tous", label: "Toutes" }]} />
          <select aria-label="Type" className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" value={filters.type ?? ""} onChange={(e) => setParam("type", e.target.value || null)}>
            <option value="">Tous types</option><option value="expense">Dépenses</option><option value="income">Revenus</option><option value="transfer">Virements internes</option>
          </select>
          <select aria-label="Compte" className="h-8 max-w-40 rounded-lg border border-border bg-surface px-2 text-xs" value={filters.compte ?? ""} onChange={(e) => setParam("compte", e.target.value || null)}>
            <option value="">Tous comptes</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label="Catégorie" className="h-8 max-w-40 rounded-lg border border-border bg-surface px-2 text-xs" value={filters.categorie ?? ""} onChange={(e) => setParam("categorie", e.target.value || null)}>
            <option value="">Toutes catégories</option><option value="aucune">Sans catégorie</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted">Du
            <input type="date" className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground" value={filters.du ?? ""} onChange={(e) => setParam("du", e.target.value || null)} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">au
            <input type="date" className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground" value={filters.au ?? ""} onChange={(e) => setParam("au", e.target.value || null)} />
          </label>
        </div>
        {data.txs.length === 0 ? (
          <EmptyState icon={<CheckCheck />} title={filters.statut === "non" || !filters.statut ? "Tout est vérifié" : "Aucune opération"} description={filters.statut === "non" || !filters.statut ? "Les nouvelles opérations bancaires apparaîtront ici après chaque synchronisation." : "Aucune opération importée ne correspond à ces filtres."} action={<Button asChild variant="outline" size="sm"><Link href="/comptes#connexions">Mes connexions bancaires</Link></Button>} />
        ) : (
          <>
            {(filters.statut ?? "non") === "non" && (
              <div className="mb-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markVerifiedAction(data.txs.filter((t) => (t.confidence ?? 0) >= CONFIRM_THRESHOLD && t.categoryId).map((t) => t.id)))}>
                  <CheckCheck /> Valider les catégories sûres
                </Button>
              </div>
            )}
            <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
              {data.txs.map((t) => <ReviewRow key={t.id} t={t} categories={data.categories} pending={pending} run={run} />)}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function RuleSuggestion({ s, catName, pending, run }: { s: { pattern: string; categoryId: string; count: number }; catName: string; pending: boolean; run: (fn: () => Promise<Result>) => void }) {
  const [apply, setApply] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
      <span className="min-w-0 flex-1">Tu as classé {s.count} fois « <strong>{s.pattern}</strong> » en <strong>{catName}</strong>. Toujours le faire automatiquement ?</span>
      <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Appliquer aussi aux opérations passées</label>
      <Button size="sm" disabled={pending} onClick={() => run(() => createRuleAction(s.pattern, s.categoryId, apply))}>Créer la règle</Button>
    </div>
  );
}

function ReviewRow({ t, categories, pending, run }: { t: ReviewTx; categories: Data["categories"]; pending: boolean; run: (fn: () => Promise<Result>) => void }) {
  const quick = useQuickAdd();
  const uncertain = !t.categoryId || (t.confidence ?? 0) < CONFIRM_THRESHOLD;
  const amount = signed(t);
  const kindCats = categories.filter((c) => (amount < 0 ? c.kind === "expense" : c.kind === "income"));
  const title = t.description ?? t.bankLabel ?? "Opération";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{title}</span>
          {!t.verified && <Badge tone="solid">Nouvelle</Badge>}
          {t.bankStatus === "coming" && <Badge tone="info">En attente</Badge>}
          {t.kind === "transfer" && <Badge tone="info">Virement interne</Badge>}
        </div>
        <p className="truncate text-xs text-subtle">
          {formatDateFR(t.date)} · {t.accountName}
          {t.bankLabel && t.bankLabel !== title ? ` · ${t.bankLabel}` : ""}
        </p>
      </div>
      <span className={`tabular shrink-0 text-right sm:w-24 text-sm font-semibold ${amount > 0 && t.kind !== "transfer" ? "text-positive" : ""}`}>{formatMoney(amount, undefined, { signed: true })}</span>
      {t.kind !== "transfer" && (
        <div className="flex min-w-[10rem] flex-1 items-center gap-2 sm:w-56 sm:min-w-0 sm:flex-none">
          <select
            aria-label={`Catégorie de ${title}`}
            className={`h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2 text-xs ${uncertain ? "border-warning" : "border-border"}`}
            value={t.categoryId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => setTxCategoryAction(t.id, e.target.value || null))}
          >
            <option value="">À catégoriser…</option>
            {kindCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {t.categorySource && t.categorySource !== "user" && (
            <span title={`${SOURCE_LABEL[t.categorySource] ?? t.categorySource} · confiance ${t.confidence ?? 0} %`} className={`shrink-0 text-[11px] ${uncertain ? "text-warning" : "text-subtle"}`}>
              {uncertain ? <AlertTriangle className="inline size-3" aria-label="Catégorie incertaine" /> : null} {t.confidence ?? 0} %
            </span>
          )}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {!t.verified ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Marquer ${title} comme vérifiée`} title="Marquer comme vérifiée" disabled={pending} onClick={() => run(() => markVerifiedAction([t.id]))}><Check /></Button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label={`Signaler une erreur de catégorie pour ${title}`} title="Signaler une mauvaise catégorie" disabled={pending} onClick={() => run(() => reportMiscategorizedAction(t.id))}><Flag /></Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Modifier ${title}`}
          title="Modifier (description, notes, justificatif)"
          onClick={() => quick({ editId: t.id, kind: t.kind as TxView["kind"], amount: t.amount, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, date: t.date, time: t.time, description: t.description, merchant: t.merchant, paymentMethod: t.paymentMethod, tags: t.tags, notes: t.notes, status: t.status as TxView["status"], refundOfId: t.refundOfId })}
        >
          <Pencil />
        </Button>
      </div>
    </li>
  );
}
