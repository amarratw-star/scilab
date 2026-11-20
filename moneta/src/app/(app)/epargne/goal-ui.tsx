"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, History, Minus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { useRefData } from "@/components/app/app-shell";
import { archiveGoalAction, contributeAction, deleteContributionAction, deleteGoalAction, saveGoalAction } from "@/app/actions/finance";
import { centsToInput, formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";
import { ICONS } from "@/components/ui/icon";

type G = { id: string; name: string; description: string | null; targetAmount: number; startDate: string; deadline: string | null; priority: number; accountId: string | null; icon: string; color: string };
type Acc = { id: string; name: string; type: string };
const COLORS = ["#10b981", "#2a78d6", "#6366f1", "#f43f5e", "#f59e0b", "#0ea5e9", "#8b5cf6", "#64748b"];

function GoalForm({ initial, accounts, onDone }: { initial?: G; accounts: Acc[]; onDone: () => void }) {
  const { today } = useRefData();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.currentTarget));
        start(async () => {
          const r = await saveGoalAction(initial?.id ?? null, { ...fd, color });
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
      <Field label="Nom de l'objectif" htmlFor="gname" error={errors.name}><Input id="gname" name="name" defaultValue={initial?.name} required placeholder="Voyage au Japon" maxLength={80} /></Field>
      <Field label="Description" htmlFor="gdesc"><Textarea id="gdesc" name="description" rows={2} defaultValue={initial?.description ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant cible (€)" htmlFor="target" error={errors.targetAmount}><Input id="target" name="targetAmount" inputMode="decimal" required defaultValue={initial ? centsToInput(initial.targetAmount) : ""} /></Field>
        <Field label="Priorité" htmlFor="prio">
          <Select id="prio" name="priority" defaultValue={String(initial?.priority ?? 2)}>
            <option value="1">Haute</option><option value="2">Normale</option><option value="3">Basse</option>
          </Select>
        </Field>
        <Field label="Date de début" htmlFor="gstart" error={errors.startDate}><Input id="gstart" name="startDate" type="date" required defaultValue={initial?.startDate ?? today} /></Field>
        <Field label="Date limite" htmlFor="gdeadline" error={errors.deadline}><Input id="gdeadline" name="deadline" type="date" defaultValue={initial?.deadline ?? ""} /></Field>
      </div>
      <Field label="Compte associé" htmlFor="gacc">
        <Select id="gacc" name="accountId" defaultValue={initial?.accountId ?? ""}>
          <option value="">Aucun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Icône" htmlFor="gicon">
          <Select id="gicon" name="icon" defaultValue={initial?.icon ?? "target"}>
            {Object.keys(ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-medium">Couleur</p>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c} className={`size-6 rounded-full ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`} style={{ background: c }} />)}
          </div>
        </div>
      </div>
      <Button type="submit" className="w-full" loading={pending}>{initial ? "Enregistrer" : "Créer l'objectif"}</Button>
    </form>
  );
}

export function NewGoalButton({ autoOpen, accounts }: { autoOpen?: boolean; accounts: Acc[] }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Nouvel objectif</Button>
      {open && <DialogContent title="Nouvel objectif d'épargne"><GoalForm accounts={accounts} onDone={() => setOpen(false)} /></DialogContent>}
    </Dialog>
  );
}

function ContributionForm({ goal, direction, accounts, onDone }: { goal: G; direction: "deposit" | "withdraw"; accounts: Acc[]; onDone: () => void }) {
  const { today } = useRefData();
  const router = useRouter();
  const [withTransfer, setWithTransfer] = useState(Boolean(goal.accountId));
  const liquid = accounts.filter((a) => ["checking", "secondary", "cash"].includes(a.type));
  const [from, setFrom] = useState(direction === "deposit" ? liquid[0]?.id ?? "" : goal.accountId ?? "");
  const [to, setTo] = useState(direction === "deposit" ? goal.accountId ?? accounts.find((a) => a.type === "savings")?.id ?? "" : liquid[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await contributeAction({ goalId: goal.id, direction, amount: fd.get("amount"), date: fd.get("date"), note: fd.get("note"), fromAccountId: withTransfer ? from : null, toAccountId: withTransfer ? to : null });
          if (!r.ok) return void toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
          toast.success(r.message);
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant (€)" htmlFor="camount"><Input id="camount" name="amount" inputMode="decimal" required autoFocus /></Field>
        <Field label="Date" htmlFor="cdate"><Input id="cdate" name="date" type="date" defaultValue={today} required /></Field>
      </div>
      <Field label="Note" htmlFor="cnote"><Input id="cnote" name="note" maxLength={200} /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={withTransfer} onChange={(e) => setWithTransfer(e.target.checked)} className="mt-0.5 size-4" />
        <span>Enregistrer aussi le virement réel entre mes comptes <span className="block text-xs text-muted">Sans virement, le montant est simplement affecté à l&apos;objectif (l&apos;argent reste où il est).</span></span>
      </label>
      {withTransfer && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Depuis" htmlFor="cfrom"><Select id="cfrom" value={from} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Vers" htmlFor="cto"><Select id="cto" value={to} onChange={(e) => setTo(e.target.value)}>{accounts.filter((a) => a.id !== from).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        </div>
      )}
      <Button type="submit" className="w-full" loading={pending}>{direction === "deposit" ? "Déposer" : "Retirer"}</Button>
    </form>
  );
}

export function GoalActions({ goal, accounts, history }: { goal: G; accounts: Acc[]; history: { id: string; amount: number; date: string; note: string | null }[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"deposit" | "withdraw" | "edit" | "history" | null>(null);
  const done = (r: { ok: boolean; message?: string; error?: string }) => {
    r.ok ? toast.success(r.message) : toast.error(r.error);
    router.refresh();
  };
  return (
    <div className="flex items-center gap-1">
      <Button size="icon-sm" variant="secondary" onClick={() => setDialog("deposit")} aria-label="Déposer"><Plus /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:bg-surface-2" aria-label="Actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setDialog("deposit")}><Plus /> Déposer</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("withdraw")}><Minus /> Retirer</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("history")}><History /> Historique des versements</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("edit")}><Pencil /> Modifier</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={async () => done(await archiveGoalAction(goal.id))}><Archive /> Archiver</DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={async () => { if (confirm(`Supprimer l'objectif « ${goal.name} » et son historique de versements ? Les virements réels déjà enregistrés sont conservés.`)) done(await deleteGoalAction(goal.id)); }}><Trash2 /> Supprimer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {(dialog === "deposit" || dialog === "withdraw") && (
          <DialogContent title={`${dialog === "deposit" ? "Déposer sur" : "Retirer de"} « ${goal.name} »`}>
            <ContributionForm goal={goal} direction={dialog} accounts={accounts} onDone={() => setDialog(null)} />
          </DialogContent>
        )}
        {dialog === "edit" && <DialogContent title="Modifier l'objectif"><GoalForm initial={goal} accounts={accounts} onDone={() => setDialog(null)} /></DialogContent>}
        {dialog === "history" && (
          <DialogContent title="Historique des versements">
            {history.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucun versement.</p> : (
              <ul className="divide-y divide-border">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span><span className="block">{formatDateFR(h.date)}</span><span className="text-xs text-muted">{h.note}</span></span>
                    <span className="flex items-center gap-2">
                      <span className={`tabular font-medium ${h.amount > 0 ? "text-positive" : "text-negative"}`}>{formatMoney(h.amount, "EUR", { signed: true })}</span>
                      <button className="rounded p-1 text-subtle hover:text-negative" aria-label="Supprimer ce versement" onClick={async () => { if (confirm("Supprimer ce versement ? Le virement réel éventuel reste dans tes opérations.")) done(await deleteContributionAction(h.id)); }}><Trash2 className="size-3.5" /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
