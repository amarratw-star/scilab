"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { resetPasswordAction } from "@/app/actions/auth";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!token) return <p className="text-sm text-muted">Lien incomplet. <Link href="/mot-de-passe-oublie" className="underline">Refaire une demande</Link>.</p>;
  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get("password") !== fd.get("confirm")) return setError("Les deux mots de passe ne correspondent pas.");
        start(async () => {
          const r = await resetPasswordAction({ token, password: String(fd.get("password")) });
          if (r && !r.ok) setError(r.fieldErrors?.["_form"] ?? r.error);
        });
      }}
    >
      <Field label="Nouveau mot de passe" htmlFor="password" hint="10 caractères minimum, avec au moins une lettre et un chiffre.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirmation" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {error && <p className="text-sm text-negative" role="alert">{error}</p>}
      <Button type="submit" className="w-full" size="lg" loading={pending}>Enregistrer</Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
      <p className="mt-1 text-sm text-muted">Toutes tes sessions seront déconnectées.</p>
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
