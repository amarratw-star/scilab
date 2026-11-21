import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { todayInTimeZone } from "@/lib/dates";
import { Logo } from "@/components/app/logo";
import { Onboarding } from "./onboarding";
import { features } from "@/server/env";
import { bankStatus } from "@/server/bank/service";

export const metadata = { title: "Bienvenue" };

export default async function WelcomePage() {
  const user = await requireUser();
  if (user.onboardedAt || user.isDemo) redirect("/");
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      <Logo />
      <div className="mt-12 animate-slide-up">
        <h1 className="text-3xl font-semibold tracking-tight">Bienvenue, {user.displayName} !</h1>
        <p className="mt-2 text-muted">Trois façons de démarrer. Tu pourras tout modifier ensuite.</p>
        <Onboarding today={todayInTimeZone(user.timezone)} demoEnabled={features.demo()} bankEnabled={bankStatus(user).available} />
      </div>
    </div>
  );
}
