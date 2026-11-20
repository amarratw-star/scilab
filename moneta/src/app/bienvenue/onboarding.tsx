"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FlaskConical, Upload, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AccountForm } from "@/components/forms/account-form";
import { completeOnboardingAction, loadDemoDataAction } from "@/app/actions/account";

export function Onboarding({ today, demoEnabled }: { today: string; demoEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"account" | null>(null);
  const [pending, start] = useTransition();
  const finish = (to: string) =>
    start(async () => {
      await completeOnboardingAction();
      router.push(to);
    });
  return (
    <div className="mt-8 space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <span className="rounded-2xl bg-info-soft p-3 text-info"><Wallet className="size-5" /></span>
          <div className="flex-1">
            <p className="font-medium">Ajouter mon premier compte</p>
            <p className="text-sm text-muted">Indique ton solde actuel : MONETA le fera évoluer à chaque opération.</p>
            {mode === "account" ? (
              <div className="mt-4">
                <AccountForm today={today} onDone={() => finish("/")} />
              </div>
            ) : (
              <Button className="mt-3" onClick={() => setMode("account")}>Commencer</Button>
            )}
          </div>
        </div>
      </Card>
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <span className="rounded-2xl bg-positive-soft p-3 text-positive"><Upload className="size-5" /></span>
          <div className="flex-1">
            <p className="font-medium">Importer un relevé bancaire (CSV)</p>
            <p className="text-sm text-muted">Exporte un relevé depuis l&apos;espace en ligne de ta banque, puis importe-le avec aperçu et détection des doublons.</p>
            <Button variant="outline" className="mt-3" loading={pending} onClick={() => finish("/comptes?nouveau=1&suite=import")}>Créer un compte puis importer</Button>
          </div>
        </div>
      </Card>
      {demoEnabled && (
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="rounded-2xl bg-warning-soft p-3 text-warning"><FlaskConical className="size-5" /></span>
            <div className="flex-1">
              <p className="font-medium">Explorer avec des données fictives</p>
              <p className="text-sm text-muted">Six mois d&apos;opérations inventées, clairement signalées. Un bouton dans les paramètres les supprime pour repartir d&apos;un espace vide.</p>
              <Button
                variant="outline"
                className="mt-3"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await loadDemoDataAction();
                    if (!r.ok) return void toast.error(r.error);
                    router.push("/");
                  })
                }
              >
                Charger les données de démonstration
              </Button>
            </div>
          </div>
        </Card>
      )}
      <button className="text-sm text-muted hover:text-foreground" onClick={() => finish("/")}>Passer pour l&apos;instant →</button>
    </div>
  );
}
