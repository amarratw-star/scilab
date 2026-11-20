import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { features } from "@/server/env";
import { PageHeader } from "@/components/ui/misc";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scanner un ticket" };

export default async function ScannerPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Scanner un ticket de caisse" description="Photographie ou importe un ticket : MONETA propose les informations, tu vérifies, puis tu enregistres. Rien n'est enregistré automatiquement." />
      <Scanner cloudAvailable={features.ai()} cloudAllowed={Boolean(user.settings?.privacy?.ocrCloudEnabled)} />
    </div>
  );
}
