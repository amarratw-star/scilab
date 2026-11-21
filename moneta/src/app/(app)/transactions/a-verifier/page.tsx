import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { reviewData, type ReviewFilters } from "@/server/bank/service";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ReviewBoard } from "./board";

export const metadata: Metadata = { title: "Opérations à vérifier" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f: ReviewFilters = {
    statut: sp.statut === "oui" || sp.statut === "tous" ? sp.statut : "non",
    type: sp.type === "expense" || sp.type === "income" || sp.type === "transfer" ? sp.type : undefined,
    compte: sp.compte,
    categorie: sp.categorie,
    du: sp.du,
    au: sp.au,
  };
  const data = await runAsUser(user, (ctx) => reviewData(ctx, f));
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/transactions"><ArrowLeft /> Transactions</Link>
      </Button>
      <PageHeader title="Opérations à vérifier" description="Les opérations importées depuis ta banque : vérifie leur catégorie, fusionne les doublons et apprends à MONETA tes habitudes." />
      <ReviewBoard data={data} filters={f} />
    </div>
  );
}
