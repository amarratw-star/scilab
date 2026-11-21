"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { saveAccountAction } from "@/app/actions/finance";
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { centsToInput } from "@/lib/money";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#2a78d6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#0ea5e9", "#64748b", "#0b0b0b"];

export type AccountFormValues = { id?: string; name: string; institution: string | null; type: string; initialBalance: number; openedOn: string; description: string | null; color: string; icon: string; currency: string };

export function AccountForm({ initial, today, onDone }: { initial?: AccountFormValues; today: string; onDone?: (id: string) => void }) {
  const router = useRouter();
  const [type, setType] = useState(initial?.type ?? "checking");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.currentTarget));
        start(async () => {
          const r = await saveAccountAction(initial?.id ?? null, { ...fd, type, color, icon: ACCOUNT_TYPE_ICONS[type] ?? "wallet", ...(initial?.currency ? { currency: initial.currency } : {}) });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            return;
          }
          toast.success(r.message);
          router.refresh();
          onDone?.(r.data!.id);
        });
      }}
    >
      <Field label="Nom du compte" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" defaultValue={initial?.name} required maxLength={80} placeholder="Compte courant" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="type">
          <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Banque / établissement" htmlFor="institution">
          <Input id="institution" name="institution" defaultValue={initial?.institution ?? ""} maxLength={80} />
        </Field>
        <Field label="Solde initial" htmlFor="initialBalance" error={errors.initialBalance} hint="Solde à la date d'ouverture ci-contre">
          <Input id="initialBalance" name="initialBalance" inputMode="decimal" defaultValue={initial ? centsToInput(initial.initialBalance) : ""} placeholder="0,00" required />
        </Field>
        <Field label="Date d'ouverture / de départ" htmlFor="openedOn" error={errors.openedOn}>
          <Input id="openedOn" name="openedOn" type="date" defaultValue={initial?.openedOn ?? today} required />
        </Field>
      </div>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" name="description" rows={2} defaultValue={initial?.description ?? ""} maxLength={500} />
      </Field>
      <div>
        <p className="mb-2 text-[13px] font-medium">Couleur</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Couleur ${c}`} aria-pressed={color === c} className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface transition", color === c && "ring-2 ring-foreground")} style={{ background: c }} />
          ))}
        </div>
      </div>
      <Button type="submit" className="w-full" loading={pending}>{initial?.id ? "Enregistrer" : "Créer le compte"}</Button>
    </form>
  );
}
