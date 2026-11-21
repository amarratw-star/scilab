"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import { AccountForm, type AccountFormValues } from "@/components/forms/account-form";
import { archiveAccountAction, deleteAccountAction, reconcileAccountAction } from "@/app/actions/finance";
import { formatMoney, parseAmountToCents } from "@/lib/money";

export function AccountActions({ account, balance, today, txCount }: { account: AccountFormValues & { id: string; archived: boolean }; balance: number; today: string; txCount: number }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "reconcile" | null>(null);
  const [actual, setActual] = useState("");
  const [date, setDate] = useState(today);
  const [pending, start] = useTransition();
  const parsed = parseAmountToCents(actual);
  const gap = parsed === null ? null : parsed - balance;
  return (
    <>
      <Button variant="outline" onClick={() => setDialog("reconcile")}><Scale /> Rapprocher</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Plus d'actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setDialog("edit")}><Pencil /> Modifier</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              start(async () => {
                const r = await archiveAccountAction(account.id, !account.archived);
                r.ok ? toast.success(r.message) : toast.error(r.error);
                router.refresh();
              })
            }
          >
            {account.archived ? <ArchiveRestore /> : <Archive />} {account.archived ? "Réactiver" : "Archiver"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ConfirmDialog
            trigger={<DropdownMenuItem destructive onSelect={(e) => e.preventDefault()}><Trash2 /> Supprimer…</DropdownMenuItem>}
            title={`Supprimer « ${account.name} » ?`}
            description={<>Cette action est <strong>irréversible</strong> : le compte et ses {txCount} opération(s) (y compris les transferts qui le concernent) seront supprimés. Pour conserver l&apos;historique, préfère l&apos;archivage.</>}
            confirmLabel="Supprimer définitivement"
            onConfirm={async () => {
              const r = await deleteAccountAction(account.id);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              router.push("/comptes");
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "edit" && (
          <DialogContent title="Modifier le compte">
            <AccountForm initial={account} today={today} onDone={() => setDialog(null)} />
          </DialogContent>
        )}
        {dialog === "reconcile" && (
          <DialogContent title="Rapprochement bancaire" description="Compare le solde calculé par MONETA au solde réel affiché par ta banque.">
            <div className="space-y-4">
              <div className="rounded-2xl bg-surface-2 p-4">
                <p className="text-sm text-muted">Solde théorique (MONETA)</p>
                <p className="tabular text-2xl font-semibold">{formatMoney(balance)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Solde réel constaté (€)" htmlFor="actual">
                  <Input id="actual" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0,00" autoFocus />
                </Field>
                <Field label="Date" htmlFor="rdate">
                  <Input id="rdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
              {gap !== null && (
                <p className={`text-sm ${gap === 0 ? "text-positive" : "text-warning"}`}>
                  {gap === 0 ? "Les soldes concordent : rien à corriger." : `Écart de ${formatMoney(gap, undefined, { signed: true })}. Vérifie d'abord les opérations manquantes ou en double ; sinon, une régularisation traçable sera créée.`}
                </p>
              )}
              <Button
                className="w-full"
                disabled={parsed === null}
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await reconcileAccountAction(account.id, actual, date);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.data?.gap ? `Régularisation de ${formatMoney(r.data.gap, undefined, { signed: true })} créée` : "Les soldes concordent");
                    setDialog(null);
                    router.refresh();
                  })
                }
              >
                {gap ? "Créer la régularisation" : "Valider"}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
