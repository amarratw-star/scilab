import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { Logo } from "@/components/app/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/connexion" className="w-fit">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 animate-slide-up">{children}</div>
        <p className="text-xs text-subtle">
          Tes données financières restent privées. <Link href="/confidentialite" className="underline underline-offset-2 hover:text-foreground">Confidentialité</Link>
        </p>
      </div>
      <div className="relative hidden overflow-hidden bg-[#0b0b0b] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(42,120,214,0.35),transparent_55%),radial-gradient(ellipse_at_80%_80%,rgba(26,158,108,0.28),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="max-w-md text-[34px] font-semibold leading-tight tracking-tight">Combien possèdes-tu vraiment&nbsp;? Combien peux-tu dépenser aujourd&apos;hui&nbsp;?</p>
          <p className="mt-4 max-w-md text-white/60">Comptes, budgets, épargne, analyses et prévisions réunis dans un seul centre de contrôle — calculés au centime près.</p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-3 text-sm">
            {["Calculs au centime", "Données isolées", "Sans publicité"].map((t) => (
              <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 backdrop-blur">{t}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
