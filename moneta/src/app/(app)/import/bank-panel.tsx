"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateFR } from "@/lib/dates";

export function BankConnectPanel({ configured, connections }: { configured: boolean; connections: { id: string; status: string; lastSyncAt: string | null; lastError: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const call = (url: string, body?: object) =>
    start(async () => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return void toast.error(data.error ?? "Erreur");
      if (data.redirect) window.location.href = data.redirect;
      else {
        toast.success(data.message ?? "Fait");
        router.refresh();
      }
    });
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="rounded-2xl bg-surface-2 p-3"><ShieldCheck className="size-5" /></span>
        <div className="flex-1 text-sm">
          {!configured ? (
            <>
              <p className="font-medium">Non configurée sur ce serveur</p>
              <p className="mt-1 text-muted">La synchronisation automatique passe par un agrégateur agréé DSP2 (Powens). Elle nécessite un contrat avec ce prestataire et les variables <code>POWENS_DOMAIN</code>, <code>POWENS_CLIENT_ID</code>, <code>POWENS_CLIENT_SECRET</code> et <code>APP_ENCRYPTION_KEY</code>. Aucune banque n&apos;est connectée. En attendant, l&apos;import CSV ci-dessus fonctionne avec toutes les banques.</p>
            </>
          ) : (
            <>
              <p className="font-medium">Connecte ta banque en toute sécurité</p>
              <p className="mt-1 text-muted">Tu t&apos;authentifies directement auprès de ta banque via Powens. MONETA ne voit ni ne stocke jamais tes identifiants bancaires.</p>
              <Button className="mt-3" loading={pending} onClick={() => call("/api/bank/connect")}>Connecter une banque</Button>
            </>
          )}
          {connections.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
                  <Badge tone={c.status === "active" ? "positive" : c.status === "error" ? "negative" : "neutral"}>{c.status === "active" ? "Active" : c.status === "error" ? "Erreur" : c.status === "revoked" ? "Révoquée" : "En attente"}</Badge>
                  <span className="flex-1 text-xs text-muted">{c.lastSyncAt ? `Dernière synchro : ${formatDateFR(c.lastSyncAt.slice(0, 10))}` : "Jamais synchronisée"}{c.lastError ? ` · ${c.lastError}` : ""}</span>
                  {configured && c.status !== "revoked" && <Button size="sm" variant="outline" loading={pending} onClick={() => call("/api/bank/sync", { connectionId: c.id })}><RefreshCw /> Synchroniser</Button>}
                  {c.status !== "revoked" && <Button size="sm" variant="ghost" onClick={() => confirm("Révoquer cette connexion bancaire ? Les opérations déjà importées sont conservées.") && call("/api/bank/revoke", { connectionId: c.id })}><Unplug /> Révoquer</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
