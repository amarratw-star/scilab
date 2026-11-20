import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { features } from "@/server/env";
import { runAsUser } from "@/server/services/context";
import * as s from "@/server/db/schema";
import { PageHeader, Callout } from "@/components/ui/misc";
import { ImportWizard } from "./wizard";
import { BankConnectPanel } from "./bank-panel";

export const metadata: Metadata = { title: "Importer un relevé" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const connections = await runAsUser(user, (ctx) => ctx.tx.select({ id: s.bankConnections.id, status: s.bankConnections.status, lastSyncAt: s.bankConnections.lastSyncAt, lastError: s.bankConnections.lastError }).from(s.bankConnections));
  return (
    <div>
      <PageHeader title="Importer des opérations" description="Relevé CSV exporté depuis ta banque : correspondance automatique des colonnes, aperçu, détection des doublons et catégorisation avant validation." />
      {sp.banque === "ok" && <Callout tone="positive" className="mb-4" title="Connexion bancaire établie">La synchronisation a été lancée.</Callout>}
      {sp.banque === "erreur" && <Callout tone="negative" className="mb-4" title="La connexion bancaire n'a pas abouti">Aucune donnée n&apos;a été importée.</Callout>}
      <ImportWizard />
      <div className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Landmark className="size-4" /> Connexion bancaire automatique (DSP2)</h2>
        <BankConnectPanel configured={features.bank()} connections={connections.map((c) => ({ ...c, lastSyncAt: c.lastSyncAt?.toISOString() ?? null }))} />
      </div>
    </div>
  );
}
