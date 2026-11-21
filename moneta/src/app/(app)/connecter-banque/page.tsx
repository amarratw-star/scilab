import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Eye, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { bankStatus } from "@/server/bank/service";
import { PageHeader, Callout } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { BankPicker } from "./picker";

export const metadata: Metadata = { title: "Connecter une banque" };

export default async function ConnectBankPage() {
  const user = await requireUser();
  const st = bankStatus(user);
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/comptes#connexions"><ArrowLeft /> Comptes</Link>
      </Button>
      <PageHeader title="Connecter une banque" description="Choisis ta banque : tu seras redirigé vers le parcours sécurisé de l'agrégateur, puis vers ta banque pour t'authentifier." />
      <ol className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: KeyRound, title: "Tu t'authentifies chez ta banque", body: "Identifiants et validation forte (SMS, appli) saisis chez la banque ou l'agrégateur agréé, jamais dans MONETA." },
          { icon: Eye, title: "Tu choisis les comptes partagés", body: "Seuls les comptes que tu sélectionnes sont lus. Lecture seule : aucun virement possible." },
          { icon: Lock, title: "Tu gardes la main", body: "Suspends un compte, renouvelle ou supprime la connexion à tout moment." },
        ].map((s, i) => (
          <li key={s.title} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-muted"><s.icon className="size-4" /> Étape {i + 1}</span>
            <p className="mt-1 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      {st.available ? (
        <>
          {"sandbox" in st && st.sandbox && (
            <Callout tone="warning" className="mb-4" title="Environnement de test (bac à sable)">
              Ce serveur est relié au bac à sable de l&apos;agrégateur : seules des banques de test y sont proposées, aucune donnée réelle.
            </Callout>
          )}
          <BankPicker />
        </>
      ) : (
        <Callout tone="neutral" icon={<ShieldCheck className="size-4" />} title="Connexion bancaire indisponible">{st.message}</Callout>
      )}
      <p className="mt-6 text-xs text-subtle">
        Prestataire : Powens, agrégateur bancaire agréé (service d&apos;information sur les comptes, DSP2). <Link href="/confidentialite-bancaire" className="underline">Confidentialité bancaire</Link>
      </p>
    </div>
  );
}
