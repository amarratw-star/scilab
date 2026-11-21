"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Repeat } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { IconBadge } from "@/components/ui/icon";
import { useRefData } from "@/components/app/app-shell";
import { saveTransactionAction, saveRecurringAction, resolveOccurrenceAction } from "@/app/actions/finance";
import { centsToInput, currencySymbol } from "@/lib/money";
import { useCurrency } from "@/components/app/currency";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS, KIND_LABELS } from "@/lib/labels";

export type TxKindUI = "expense" | "income" | "transfer" | "refund" | "adjustment";
export type QuickAddPreset = {
  kind?: TxKindUI;
  editId?: string;
  amount?: number; // centimes
  accountId?: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  date?: string;
  time?: string | null;
  description?: string | null;
  merchant?: string | null;
  paymentMethod?: string | null;
  tags?: string[];
  notes?: string | null;
  status?: "posted" | "planned" | "cancelled";
  refundOfId?: string | null;
};

export function QuickAddDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (o: boolean) => void; preset?: QuickAddPreset }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={preset?.editId ? "Modifier l'opération" : "Nouvelle opération"}
          description={preset?.editId ? undefined : "Montant, catégorie, c'est parti."}
          onOpenAutoFocus={(e) => {
            // Focus immédiat et déterministe sur le montant (pas de minuteur : évite de voler le focus pendant la saisie).
            e.preventDefault();
            document.getElementById("amount")?.focus();
          }}
        >
          <TransactionForm preset={preset} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

export function TransactionForm({ preset, onDone }: { preset?: QuickAddPreset; onDone?: () => void }) {
  const { accounts, categories, today } = useRefData();
  const currency = useCurrency();
  const router = useRouter();
  const [kind, setKind] = useState<TxKindUI>(preset?.kind ?? "expense");
  const [amount, setAmount] = useState(preset?.amount ? centsToInput(Math.abs(preset.amount)) : "");
  const [accountId, setAccountId] = useState(preset?.accountId ?? accounts.find((a) => a.type === "checking")?.id ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(preset?.toAccountId ?? accounts.find((a) => a.id !== (preset?.accountId ?? accounts[0]?.id))?.id ?? "");
  const [categoryId, setCategoryId] = useState<string>(preset?.categoryId ?? "");
  const [date, setDate] = useState(preset?.date ?? today);
  const [time, setTime] = useState(preset?.time?.slice(0, 5) ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [merchant, setMerchant] = useState(preset?.merchant ?? "");
  const [paymentMethod, setPaymentMethod] = useState(preset?.paymentMethod ?? (preset?.kind === "income" ? "transfer" : "card"));
  const [tags, setTags] = useState((preset?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(preset?.notes ?? "");
  const [status, setStatus] = useState<"posted" | "planned" | "cancelled">(preset?.status ?? "posted");
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState("monthly");
  const [more, setMore] = useState(Boolean(preset?.editId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);


  const catKind = kind === "income" ? "income" : "expense";
  const parents = useMemo(() => categories.filter((c) => c.kind === catKind && !c.parentId), [categories, catKind]);
  const children = (pid: string) => categories.filter((c) => c.parentId === pid);
  const chips = parents.slice(0, kind === "income" ? 6 : 8);
  const selectedCat = categories.find((c) => c.id === categoryId);

  if (!accounts.length) {
    return (
      <div className="py-6 text-center">
        <p className="font-medium">Crée d&apos;abord un compte</p>
        <p className="mt-1 text-sm text-muted">Chaque opération est rattachée à un compte (courant, espèces, livret…).</p>
        <Button className="mt-4" onClick={() => { onDone?.(); router.push("/comptes?nouveau=1"); }}>Créer un compte</Button>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const payload = {
        kind,
        status,
        amount,
        accountId,
        toAccountId: kind === "transfer" ? toAccountId : null,
        categoryId: kind === "transfer" || kind === "adjustment" ? null : categoryId || null,
        date,
        time: time || null,
        description,
        merchant,
        paymentMethod: kind === "adjustment" ? null : paymentMethod,
        tags,
        notes,
        isRecurring: recurring,
        refundOfId: preset?.refundOfId ?? null,
      };
      if (recurring && !preset?.editId && (kind === "expense" || kind === "income" || kind === "transfer")) {
        // Crée la règle récurrente puis confirme cette première échéance.
        const rule = await saveRecurringAction(null, {
          name: merchant || description || (kind === "income" ? "Revenu récurrent" : "Charge récurrente"),
          kind,
          amount,
          frequency,
          startDate: date,
          accountId,
          toAccountId: kind === "transfer" ? toAccountId : null,
          categoryId: kind === "transfer" ? null : categoryId || null,
          merchant,
          paymentMethod: paymentMethod || "direct_debit",
          isSubscription: selectedCat?.name === "Abonnements",
        });
        if (!rule.ok) {
          setErrors(rule.fieldErrors ?? {});
          toast.error(rule.error);
          return;
        }
        if (status === "posted" && date <= today) await resolveOccurrenceAction(rule.data!.id, date, "pay");
        toast.success("Échéance récurrente créée");
        onDone?.();
        router.refresh();
        return;
      }
      const res = await saveTransactionAction(preset?.editId ?? null, payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Enregistré");
      onDone?.();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId("");
          if (k === "income") setPaymentMethod("transfer");
        }}
        className="w-full [&>button]:flex-1"
        options={(preset?.editId || preset?.kind === "refund" || preset?.kind === "adjustment" ? (["expense", "income", "transfer", "refund", "adjustment"] as const) : (["expense", "income", "transfer"] as const)).map((k) => ({ value: k, label: KIND_LABELS[k] }))}
      />

      <div className="text-center">
        <label htmlFor="amount" className="sr-only">Montant</label>
        <div className="flex items-baseline justify-center gap-1">
          {kind === "expense" && <span className="text-3xl font-semibold text-negative">−</span>}
          {(kind === "income" || kind === "refund") && <span className="text-3xl font-semibold text-positive">+</span>}
          <input
            ref={amountRef}
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            aria-invalid={Boolean(errors.amount)}
            className="tabular w-48 bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-surface-3"
          />
          <span className="text-2xl font-medium text-muted">{currencySymbol(currency)}</span>
        </div>
        {errors.amount && <p className="mt-1 text-xs text-negative">{errors.amount}</p>}
        {kind === "adjustment" && <p className="mt-1 text-xs text-muted">Montant signé : négatif pour diminuer le solde.</p>}
      </div>

      {(kind === "expense" || kind === "income" || kind === "refund") && (
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setCategoryId(c.id === categoryId ? "" : c.id)}
                className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition", categoryId === c.id || selectedCat?.parentId === c.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-border-strong")}
              >
                <IconBadge icon={c.icon} color={c.color} size="sm" />
                {c.name}
              </button>
            ))}
          </div>
          <Select aria-label="Catégorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sans catégorie</option>
            {parents.map((p) => (
              <optgroup key={p.id} label={p.name}>
                <option value={p.id}>{p.name}</option>
                {children(p.id).map((c) => (
                  <option key={c.id} value={c.id}>
                    &nbsp;&nbsp;↳ {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "transfer" ? "Depuis" : "Compte"} htmlFor="account" error={errors.accountId}>
          <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        {kind === "transfer" ? (
          <Field label="Vers" htmlFor="toAccount" error={errors.toAccountId}>
            <Select id="toAccount" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Date" htmlFor="date" error={errors.date}>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        )}
      </div>
      {kind === "transfer" && (
        <Field label="Date" htmlFor="date2" error={errors.date} hint="Un transfert entre tes comptes n'est ni une dépense ni un revenu.">
          <Input id="date2" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      )}

      <Field label={kind === "income" ? "Source / description" : "Description"} htmlFor="description" error={errors.description}>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "income" ? "Salaire de novembre" : "Courses de la semaine"} maxLength={200} />
      </Field>

      <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronDown className={cn("size-4 transition", more && "rotate-180")} /> Plus de détails
      </button>

      {more && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            {kind !== "transfer" && kind !== "adjustment" && (
              <Field label={kind === "income" ? "Payeur" : "Commerçant"} htmlFor="merchant">
                <Input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} />
              </Field>
            )}
            {kind !== "adjustment" && (
              <Field label="Moyen de paiement" htmlFor="pm">
                <Select id="pm" value={paymentMethod ?? ""} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Heure (facultatif)" htmlFor="time" error={errors.time}>
              <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Statut" htmlFor="status">
              <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="posted">Effectuée</option>
                <option value="planned">Prévue</option>
                {preset?.editId && <option value="cancelled">Annulée</option>}
              </Select>
            </Field>
          </div>
          <Field label="Tags" htmlFor="tags" hint="Séparés par des virgules (ex. vacances, travail)">
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
          </Field>
          {!preset?.editId && (kind === "expense" || kind === "income" || kind === "transfer") && (
            <div className="rounded-2xl border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="size-4" />
                <Repeat className="size-4 text-muted" /> Opération récurrente
              </label>
              {recurring && (
                <div className="mt-3">
                  <Select aria-label="Fréquence" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    <option value="weekly">Chaque semaine</option>
                    <option value="monthly">Chaque mois</option>
                    <option value="quarterly">Chaque trimestre</option>
                    <option value="semiannual">Chaque semestre</option>
                    <option value="yearly">Chaque année</option>
                  </Select>
                  <p className="mt-2 text-xs text-muted">Une échéance récurrente est créée. Les prochaines apparaîtront comme « prévues » : tu les confirmes quand elles sont réellement payées.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {preset?.editId ? "Enregistrer les modifications" : status === "planned" ? "Planifier" : "Enregistrer"}
      </Button>
    </form>
  );
}
