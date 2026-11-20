import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { features } from "@/server/env";

export const metadata: Metadata = { title: "Connexion" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const notice = sp.reinitialise ? "Mot de passe modifié : tu peux te connecter." : sp.supprime ? "Ton compte et toutes tes données ont été supprimés." : null;
  return <LoginForm next={sp.suite} notice={notice} demoEnabled={features.demo()} />;
}
