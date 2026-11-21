import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { PageHeader, Callout } from "@/components/ui/misc";
import { ImportWizard } from "./wizard";


export const metadata: Metadata = { title: "Importer un relevé" };

export default async function ImportPage() {
  await requireUser();
  return (
    <div>
      <PageHeader title="Importer des opérations" description="Relevé CSV exporté depuis ta banque : correspondance automatique des colonnes, aperçu, détection des doublons et catégorisation avant validation." />
      <ImportWizard />
      <div className="mt-10">
        <Callout tone="info" title="Synchronisation automatique">
          Tu préfères que tes opérations arrivent toutes seules ? <Link href="/comptes#connexions" className="font-medium underline">Connecte ta banque</Link> via un agrégateur agréé (DSP2) : tes identifiants restent chez ta banque.
        </Callout>
      </div>
    </div>
  );
}
