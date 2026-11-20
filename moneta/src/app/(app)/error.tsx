"use client";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <p className="text-lg font-semibold">Un problème est survenu</p>
      <p className="mt-2 text-sm text-muted">Tes données n&apos;ont pas été modifiées. Réessaie ; si le problème persiste, recharge la page.</p>
      {error.digest && <p className="mt-2 text-xs text-subtle">Référence : {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>Réessayer</Button>
    </div>
  );
}
