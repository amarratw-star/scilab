"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { registerAction } from "@/app/actions/auth";

export default function RegisterPage() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Créer ton espace</h1>
      <p className="mt-1 text-sm text-muted">Gratuit, privé, sans connexion bancaire obligatoire.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await registerAction(Object.fromEntries(fd));
            if (res && !res.ok) {
              setError(res.error);
              setFe(res.fieldErrors ?? {});
            }
          });
        }}
      >
        <Field label="Prénom" htmlFor="displayName" error={fe.displayName}>
          <Input id="displayName" name="displayName" autoComplete="given-name" required maxLength={60} />
        </Field>
        <Field label="Adresse e-mail" htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Mot de passe" htmlFor="password" error={fe.password} hint="10 caractères minimum, avec au moins une lettre et un chiffre.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input type="checkbox" name="acceptTerms" className="mt-0.5 size-4 accent-current" required />
          <span>
            J&apos;ai lu la <Link href="/confidentialite" target="_blank" className="text-foreground underline underline-offset-2">politique de confidentialité</Link> et j&apos;accepte le traitement de mes données pour le fonctionnement du service.
          </span>
        </label>
        {fe.acceptTerms && <p className="text-xs text-negative">{fe.acceptTerms}</p>}
        {error && <p className="text-sm text-negative" role="alert">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={pending}>Créer mon compte</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Déjà inscrit ? <Link href="/connexion" className="font-medium text-foreground underline-offset-4 hover:underline">Se connecter</Link>
      </p>
    </div>
  );
}
