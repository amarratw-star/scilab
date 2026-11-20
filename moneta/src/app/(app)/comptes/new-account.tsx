"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AccountForm } from "@/components/forms/account-form";

export function NewAccountButton({ today, autoOpen, then }: { today: string; autoOpen?: boolean; then?: string }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Nouveau compte</Button>
      {open && (
        <DialogContent title="Nouveau compte" description="Le solde initial est le point de départ de tous les calculs.">
          <AccountForm today={today} onDone={(id) => { setOpen(false); router.push(then ?? `/comptes/${id}`); }} />
        </DialogContent>
      )}
    </Dialog>
  );
}
