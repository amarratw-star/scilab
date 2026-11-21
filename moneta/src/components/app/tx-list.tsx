"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, CheckCircle2, Copy, MoreHorizontal, Paperclip, Pencil, Repeat, Scale, Trash2, Undo2 } from "lucide-react";
import { IconBadge } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { useQuickAdd, useRefData } from "./app-shell";
import { confirmPlannedAction, deleteTransactionAction, duplicateTransactionAction } from "@/app/actions/finance";
import { formatMoney } from "@/lib/money";
import { formatDateFR, formatDateLong } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { KIND_LABELS } from "@/lib/labels";

export type TxView = {
  id: string;
  kind: "expense" | "income" | "transfer" | "refund" | "adjustment";
  status: "posted" | "planned" | "cancelled";
  amount: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  date: string;
  time: string | null;
  description: string | null;
  merchant: string | null;
  paymentMethod: string | null;
  tags: string[];
  notes: string | null;
  recurringId: string | null;
  refundOfId: string | null;
  docCount?: number;
  /** Opération issue de la synchronisation bancaire */
  bank?: { pending: boolean; unverified: boolean } | null;
};

export function signedAmount(t: Pick<TxView, "kind" | "amount">, perspectiveAccountId?: string, toAccountId?: string | null) {
  if (t.kind === "expense") return -t.amount;
  if (t.kind === "transfer") return perspectiveAccountId && toAccountId === perspectiveAccountId ? t.amount : -t.amount;
  return t.amount;
}

export function TxList({ rows, accountNames, groupByDate = true, perspectiveAccountId, emptyText = "Aucune opération." }: { rows: TxView[]; accountNames: Record<string, string>; groupByDate?: boolean; perspectiveAccountId?: string; emptyText?: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>;
  const groups: [string, TxView[]][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (groupByDate && last && last[0] === r.date) last[1].push(r);
    else groups.push([r.date, [r]]);
  }
  return (
    <div className="divide-y divide-border">
      {groups.map(([date, list]) => (
        <div key={date + list[0].id} className="py-1">
          {groupByDate && <p className="px-1 pb-1 pt-3 text-[12px] font-medium capitalize text-subtle">{formatDateLong(date)}</p>}
          {list.map((t) => (
            <TxRow key={t.id} t={t} accountNames={accountNames} perspectiveAccountId={perspectiveAccountId} showDate={!groupByDate} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TxRow({ t, accountNames, perspectiveAccountId, showDate }: { t: TxView; accountNames: Record<string, string>; perspectiveAccountId?: string; showDate: boolean }) {
  const { categories, today } = useRefData();
  const open = useQuickAdd();
  const router = useRouter();
  const cat = t.categoryId ? categories.find((c) => c.id === t.categoryId) : undefined;
  const amount = signedAmount(t, perspectiveAccountId, t.toAccountId);
  const title = t.merchant || t.description || (t.kind === "transfer" ? "Transfert" : t.kind === "adjustment" ? "Régularisation" : cat?.name ?? KIND_LABELS[t.kind]);
  const sub = [
    t.merchant && t.description && t.description !== t.merchant ? t.description : null,
    t.kind === "transfer" ? `${accountNames[t.accountId] ?? "?"} → ${t.toAccountId ? accountNames[t.toAccountId] ?? "?" : "?"}` : cat?.name ?? (t.kind === "adjustment" ? "Régularisation de solde" : "Non catégorisé"),
    t.kind !== "transfer" ? accountNames[t.accountId] : null,
    showDate ? formatDateFR(t.date) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const edit = () =>
    open({ editId: t.id, kind: t.kind, amount: t.amount, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, date: t.date, time: t.time, description: t.description, merchant: t.merchant, paymentMethod: t.paymentMethod, tags: t.tags, notes: t.notes, status: t.status, refundOfId: t.refundOfId });
  const run = async (p: Promise<{ ok: boolean; error?: string; message?: string }>) => {
    const r = await p;
    if (r.ok) toast.success(r.message ?? "Fait");
    else toast.error(r.error);
    router.refresh();
  };

  return (
    <div className={cn("group flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-surface-2/60", t.status === "cancelled" && "opacity-50")}>
      <button onClick={edit} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Modifier ${title}`}>
        {t.kind === "transfer" ? (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info"><ArrowLeftRight className="size-4" /></span>
        ) : t.kind === "adjustment" ? (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"><Scale className="size-4" /></span>
        ) : (
          <IconBadge icon={cat?.icon ?? (t.kind === "refund" ? "undo-2" : "tag")} color={cat?.color} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            {t.recurringId && <Repeat className="size-3 shrink-0 text-subtle" aria-label="Récurrente" />}
            {(t.docCount ?? 0) > 0 && <Paperclip className="size-3 shrink-0 text-subtle" aria-label="Justificatif joint" />}
          </span>
          <span className="block truncate text-xs text-subtle">{sub}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={cn("tabular text-sm font-semibold", t.kind === "transfer" || t.kind === "adjustment" ? "text-foreground" : amount > 0 ? "text-positive" : "")}>
            {formatMoney(amount, undefined, { signed: true })}
          </span>
          {t.bank?.unverified && t.status !== "cancelled" && <Badge tone="solid">Nouvelle</Badge>}
          {t.status === "planned" && <Badge tone="info">{t.bank?.pending ? "En attente" : "Prévue"}</Badge>}
          {t.status === "cancelled" && <Badge>Annulée</Badge>}
          {t.kind === "refund" && <Badge tone="positive">Remboursement</Badge>}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle opacity-100 hover:bg-surface-3 hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Actions">
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={edit}><Pencil /> Modifier</DropdownMenuItem>
          {t.status === "planned" && <DropdownMenuItem onSelect={() => run(confirmPlannedAction(t.id, today))}><CheckCircle2 /> Confirmer (effectuée aujourd&apos;hui)</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => run(duplicateTransactionAction(t.id, today))}><Copy /> Dupliquer à aujourd&apos;hui</DropdownMenuItem>
          {t.kind === "expense" && (
            <DropdownMenuItem onSelect={() => open({ kind: "refund", accountId: t.accountId, categoryId: t.categoryId, refundOfId: t.id, description: `Remboursement — ${title}`, merchant: t.merchant })}>
              <Undo2 /> Enregistrer un remboursement
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => router.push(`/documents?transaction=${t.id}`)}><Paperclip /> Justificatifs</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={() => {
              if (window.confirm(`Supprimer « ${title} » (${formatMoney(amount, undefined, { signed: true })}) ? Les soldes seront recalculés.`)) run(deleteTransactionAction(t.id));
            }}
          >
            <Trash2 /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
