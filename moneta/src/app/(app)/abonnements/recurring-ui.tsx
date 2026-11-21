"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, MoreHorizontal, Pause, Pencil, Play, Plus, SkipForward, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { useRefData } from "@/components/app/app-shell";
import { deleteRecurringAction, markReviewedAction, resolveOccurrenceAction, saveRecurringAction, setRecurringStatusAction } from "@/app/actions/finance";
import { centsToInput } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";

type R = { id: string; name: string; kind: "expense" | "income" | "transfer"; amount: number; frequency: string; startDate: string; endDate: string | null; accountId: string; toAccountId: string | null; categoryId: string | null; isSubscription: boolean; merchant: string | null; paymentMethod: string; status: string; notes: string | null };

function RecurringForm({ initial, preset, onDone }: { initial?: R; preset?: { name?: string; amount?: number }; onDone: () => void }) {
  const { accounts, categories, today } = useRefData();
  const router = useRouter();
  const [kind, setKind] = useState<R["kind"]>(initial?.kind ?? "expense");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const catKind = kind === "income" ? "income" : "expense";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.currentTarget));
        start(async () => {
          const r = await saveRecurringAction(initial?.id ?? null, { ...fd, kind, accountId, isSubscription: fd.isSubscription === "on", status: initial?.status ?? "active" });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success(r.message);
          router.refresh();
          onDone();
        });
      }}
    >
      <Field label="Type" htmlFor="rkind">
        <Select id="rkind" value={kind} onChange={(e) => setKind(e.target.value as R["kind"])}>
          <option value="expense">Charge / abonnement</option>
          <option value="income">Revenu récurrent</option>
          <option value="transfer">Virement programmé (ex. vers l&apos;épargne)</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom" htmlFor="rname" error={errors.name}><Input id="rname" name="name" required defaultValue={initial?.name ?? preset?.name} placeholder="Abonnement musique" /></Field>
        <Field label="Montant" htmlFor="ramount" error={errors.amount}><Input id="ramount" name="amount" inputMode="decimal" required defaultValue={initial ? centsToInput(initial.amount) : preset?.amount ? centsToInput(preset.amount) : ""} /></Field>
        <Field label="Fréquence" htmlFor="rfreq">
          <Select id="rfreq" name="frequency" defaultValue={initial?.frequency ?? "monthly"}>
            <option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option><option value="semiannual">Semestrielle</option><option value="yearly">Annuelle</option>
          </Select>
        </Field>
        <Field label="Première échéance / prélèvement" htmlFor="rstart" error={errors.startDate}><Input id="rstart" name="startDate" type="date" required defaultValue={initial?.startDate ?? today} /></Field>
        <Field label={kind === "transfer" ? "Depuis" : "Compte"} htmlFor="racc">
          <Select id="racc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        {kind === "transfer" ? (
          <Field label="Vers" htmlFor="rto" error={errors.toAccountId}>
            <Select id="rto" name="toAccountId" defaultValue={initial?.toAccountId ?? ""}>{accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        ) : (
          <Field label="Catégorie" htmlFor="rcat">
            <Select id="rcat" name="categoryId" defaultValue={initial?.categoryId ?? ""}>
              <option value="">Aucune</option>
              {categories.filter((c) => c.kind === catKind).map((c) => <option key={c.id} value={c.id}>{c.parentId ? "↳ " : ""}{c.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Date de fin (facultatif)" htmlFor="rend" error={errors.endDate}><Input id="rend" name="endDate" type="date" defaultValue={initial?.endDate ?? ""} /></Field>
        <Field label="Moyen de paiement" htmlFor="rpm">
          <Select id="rpm" name="paymentMethod" defaultValue={initial?.paymentMethod ?? "direct_debit"}>{Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
      </div>
      <Field label="Organisme / commerçant" htmlFor="rmerchant"><Input id="rmerchant" name="merchant" defaultValue={initial?.merchant ?? ""} /></Field>
      {kind === "expense" && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSubscription" defaultChecked={initial?.isSubscription ?? true} className="size-4" /> C&apos;est un abonnement (service résiliable)</label>
      )}
      <Field label="Notes" htmlFor="rnotes"><Textarea id="rnotes" name="notes" rows={2} defaultValue={initial?.notes ?? ""} /></Field>
      <Button type="submit" className="w-full" loading={pending}>{initial ? "Enregistrer" : "Ajouter"}</Button>
    </form>
  );
}

export function RecurringDialog({ compact, preset }: { compact?: boolean; preset?: { name?: string; amount?: number } }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size={compact ? "sm" : "default"} variant={compact ? "outline" : "default"} onClick={() => setOpen(true)}><Plus /> {compact ? "L'ajouter" : "Nouvelle échéance"}</Button>
      {open && <DialogContent title="Nouvelle échéance récurrente"><RecurringForm preset={preset} onDone={() => setOpen(false)} /></DialogContent>}
    </Dialog>
  );
}

export function RecurringMenu({ rule }: { rule: R }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const done = (r: { ok: boolean; message?: string; error?: string }) => {
    r.ok ? toast.success(r.message) : toast.error(r.error);
    router.refresh();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:bg-surface-2" aria-label="Actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}><Pencil /> Modifier</DropdownMenuItem>
          {rule.status === "active" ? (
            <DropdownMenuItem onSelect={async () => done(await setRecurringStatusAction(rule.id, "paused"))}><Pause /> Suspendre</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={async () => done(await setRecurringStatusAction(rule.id, "active"))}><Play /> Réactiver</DropdownMenuItem>
          )}
          {rule.status !== "ended" && <DropdownMenuItem onSelect={async () => done(await setRecurringStatusAction(rule.id, "ended"))}><Square /> Marquer comme terminé (résilié)</DropdownMenuItem>}
          <DropdownMenuItem onSelect={async () => done(await markReviewedAction(rule.id))}><Check /> Marquer comme vérifié</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={async () => { if (confirm(`Supprimer « ${rule.name} » ? Les opérations déjà enregistrées sont conservées.`)) done(await deleteRecurringAction(rule.id)); }}><Trash2 /> Supprimer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>{open && <DialogContent title="Modifier l'échéance"><RecurringForm initial={rule} onDone={() => setOpen(false)} /></DialogContent>}</Dialog>
    </>
  );
}

export function OccurrenceActions({ ruleId, date }: { ruleId: string; date: string; amount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: "pay" | "skip") =>
    start(async () => {
      const r = await resolveOccurrenceAction(ruleId, date, action);
      r.ok ? toast.success(r.message) : toast.error(r.error);
      router.refresh();
    });
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="positive" loading={pending} onClick={() => run("pay")}><Check /> Payé</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("skip")} title="Cette échéance n'a pas eu lieu"><SkipForward /> Ignorer</Button>
    </span>
  );
}

export function ReviewedButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  return (
    <Button size="sm" variant="outline" onClick={async () => { const r = await markReviewedAction(ruleId); r.ok ? toast.success("Merci ! Marqué comme utilisé.") : toast.error(r.error); router.refresh(); }}>
      <Check /> Je l&apos;utilise
    </Button>
  );
}
