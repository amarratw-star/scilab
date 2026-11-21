import type { Metadata } from "next";
import { Bot, KeyRound } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { features } from "@/server/env";
import { PageHeader, Callout } from "@/components/ui/misc";
import { Chat, ConsentCard } from "./chat";

export const metadata: Metadata = { title: "Mon conseiller" };

export default async function AdvisorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const configured = features.ai();
  const consent = Boolean(user.settings?.privacy?.aiEnabled);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mon conseiller" description="Pose tes questions en langage naturel. Il calcule à partir de tes vraies données, sans jamais rien modifier sans ton accord." />
      {!configured ? (
        <Callout tone="neutral" icon={<KeyRound />} title="Le conseiller IA nécessite une configuration">
          <p>Ajoute la variable d&apos;environnement <code className="rounded bg-surface-3 px-1">ANTHROPIC_API_KEY</code> côté serveur (voir le README), puis redémarre l&apos;application. Toutes les autres fonctionnalités (calculs, analyses, prévisions, simulateur) fonctionnent sans IA.</p>
        </Callout>
      ) : !consent ? (
        <ConsentCard />
      ) : (
        <Chat name={user.displayName} initialQuestion={sp.q?.slice(0, 500)} />
      )}
      <p className="mt-6 flex items-start gap-2 text-xs text-subtle"><Bot className="mt-0.5 size-3.5 shrink-0" /> Le conseiller fournit des informations calculées à partir de tes données ; ce n&apos;est pas un conseil en investissement réglementé.</p>
    </div>
  );
}
