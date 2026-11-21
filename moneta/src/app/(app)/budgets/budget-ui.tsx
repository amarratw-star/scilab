"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { useRefData } from "@/components/app/app-shell";
import { deleteBudgetAction, saveBudgetAction } from "@/app/actions/finance";
import { centsToInput } from "@/lib/money";

type B = { id: string; name: string; categoryId: string | null; period: "monthly" | "weekly" | "custom"; amount: number; startDate: string | null; endDate: string | null; rollover: boolean; alertThresholds: number[] };

function BudgetForm({ initial, onDone }: { initial?: B; onDone: () => void }) {
  const { categories, today } = useRefData();
  const router = useRouter();
  const [period, setPeriod] = useState(initial?.period ?? "monthly");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const thresholds = initial?.alertThresholds ?? [50, 75, 90, 100];
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveBudgetAction(initial?.id ?? null, {
            name: name || (categoryId ? categories.find((c) => c.id === categoryId)?.name : "Budget global"),
            categoryId: categoryId || null,
            period,
            amount: fd.get("amount"),
            startDate: fd.get("startDate"),
            endDate: fd.get("endDate"),
            rollover: fd.get("rollover") === "on",
            alertThresholds: fd.getAll("t").map(Number),
          });
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
      <Field label="Catégorie" htmlFor="cat" hint="Laisse vide pour un budget global (toutes dépenses).">
        <Select id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Budget global — toutes les dépenses</option>
          {categories.filter((c) => c.kind === "expense" && !c.parentId).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Nom" htmlFor="bname">
        <Input id="bname" value={name} onChange={(e) => setName(e.target.value)} placeholder={categoryId ? categories.find((c) => c.id === categoryId)?.name : "Budget global"} maxLength={60} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant" htmlFor="amount" error={errors.amount}>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={initial ? centsToInput(initial.amount) : ""} required placeholder="150" />
        </Field>
        <Field label="Période" htmlFor="period">
          <Select id="period" value={period} onChange={(e) => setPeriod(e.target.value as B["period"])}>
            <option value="monthly">Mensuel</option>
            <option value="weekly">Hebdomadaire</option>
            <option value="custom">Période personnalisée</option>
          </Select>
        </Field>
      </div>
      {period === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début" htmlFor="startDate" error={errors.startDate}><Input id="startDate" name="startDate" type="date" defaultValue={initial?.startDate ?? today} /></Field>
          <Field label="Fin" htmlFor="endDate" error={errors.endDate}><Input id="endDate" name="endDate" type="date" defaultValue={initial?.endDate ?? ""} /></Field>
        </div>
      )}
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Alertes</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {[50, 75, 90, 100].map((t) => (
            <label key={t} className="flex items-center gap-1.5"><input type="checkbox" name="t" value={t} defaultChecked={thresholds.includes(t)} className="size-4" /> {t} %</label>
          ))}
        </div>
      </fieldset>
      {period !== "custom" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="rollover" defaultChecked={initial?.rollover} className="mt-0.5 size-4" />
          <span>Reporter le reliquat (ou le dépassement) de la période précédente</span>
        </label>
      )}
      <Button type="submit" className="w-full" loading={pending}>{initial ? "Enregistrer" : "Créer le budget"}</Button>
    </form>
  );
}

export function BudgetDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Nouveau budget</Button>
      {open && <DialogContent title="Nouveau budget"><BudgetForm onDone={() => setOpen(false)} /></DialogContent>}
    </Dialog>
  );
}

export function BudgetMenu({ budget }: { budget: B }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:bg-surface-2" aria-label="Actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}><Pencil /> Modifier</DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={async () => { if (!confirm(`Supprimer le budget « ${budget.name} » ?`)) return; const r = await deleteBudgetAction(budget.id); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); }}>
            <Trash2 /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>{open && <DialogContent title="Modifier le budget"><BudgetForm initial={budget} onDone={() => setOpen(false)} /></DialogContent>}</Dialog>
    </>
  );
}
