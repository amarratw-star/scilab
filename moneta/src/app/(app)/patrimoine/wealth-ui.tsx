"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { addValuationAction, createWealthItemAction, deleteWealthItemAction } from "@/app/actions/finance";
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES } from "@/lib/finance/wealth";
import { formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";

export function NewWealthItem({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"asset" | "liability">("asset");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Ajouter un actif ou un passif</Button>
      {open && (
        <DialogContent title="Nouvel élément de patrimoine" description="Les comptes bancaires sont déjà inclus automatiquement.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget));
              start(async () => {
                const r = await createWealthItemAction({ ...fd, kind });
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  return void toast.error(r.error);
                }
                toast.success(r.message);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <Field label="Type" htmlFor="wk">
              <Select id="wk" value={kind} onChange={(e) => setKind(e.target.value as "asset" | "liability")}>
                <option value="asset">Actif (ce que je possède)</option>
                <option value="liability">Passif (ce que je dois)</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Catégorie" htmlFor="wc">
                <Select id="wc" name="category">{Object.entries(kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              </Field>
              <Field label="Nom" htmlFor="wn" error={errors.name}><Input id="wn" name="name" required maxLength={80} placeholder={kind === "asset" ? "Appartement" : "Prêt immobilier"} /></Field>
              <Field label={kind === "asset" ? "Valeur actuelle" : "Capital restant dû"} htmlFor="wv" error={errors.value}><Input id="wv" name="value" inputMode="decimal" required /></Field>
              <Field label="Date de la valeur" htmlFor="wd"><Input id="wd" name="date" type="date" defaultValue={today} required /></Field>
            </div>
            <Field label="Nature de la valeur" htmlFor="wm">
              <Select id="wm" name="method" defaultValue={kind === "asset" ? "estimated" : "manual"}>
                <option value="manual">Valeur connue (relevé, tableau d&apos;amortissement…)</option>
                <option value="estimated">Estimation personnelle</option>
              </Select>
            </Field>
            <Field label="Notes" htmlFor="wnotes"><Textarea id="wnotes" name="notes" rows={2} /></Field>
            <Button type="submit" className="w-full" loading={pending}>Ajouter</Button>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function WealthItemActions({ item, history, today }: { item: { id: string; name: string; kind: "asset" | "liability" }; history: { date: string; value: number; method: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:bg-surface-2" aria-label="Actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}><RefreshCw /> Mettre à jour la valeur</DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={async () => { if (!confirm(`Supprimer « ${item.name} » et son historique ?`)) return; const r = await deleteWealthItemAction(item.id); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); }}><Trash2 /> Supprimer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title={`Valorisation — ${item.name}`}>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget));
                start(async () => {
                  const r = await addValuationAction({ ...fd, itemId: item.id });
                  if (!r.ok) return void toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nouvelle valeur" htmlFor="vv"><Input id="vv" name="value" inputMode="decimal" required autoFocus /></Field>
                <Field label="Date" htmlFor="vd"><Input id="vd" name="date" type="date" defaultValue={today} required /></Field>
              </div>
              <Field label="Nature" htmlFor="vm"><Select id="vm" name="method"><option value="manual">Valeur connue</option><option value="estimated">Estimation</option></Select></Field>
              <Button type="submit" className="w-full" loading={pending}>Enregistrer</Button>
              {history.length > 0 && (
                <ul className="divide-y divide-border border-t border-border pt-2 text-sm">
                  {[...history].reverse().map((h) => <li key={h.date + h.value} className="flex justify-between py-1.5"><span className="text-muted">{formatDateFR(h.date)} · {h.method === "estimated" ? "estimation" : "saisie"}</span><span className="tabular">{formatMoney(h.value)}</span></li>)}
                </ul>
              )}
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
