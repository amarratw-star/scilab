"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";
import { loginAction, startDemoAction } from "@/app/actions/auth";

export function LoginForm({ next, notice, demoEnabled }: { next?: string; notice: string | null; demoEnabled: boolean }) {
  const [pending, start] = useTransition();
  const [demoPending, startDemo] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Bon retour 👋</h1>
      <p className="mt-1 text-sm text-muted">Connecte-toi à ton espace financier.</p>
      {notice && <Callout tone="positive" className="mt-6">{notice}</Callout>}
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await loginAction({ email: fd.get("email"), password: fd.get("password") }, next);
            if (res && !res.ok) {
              setError(res.error);
              setFieldErrors(res.fieldErrors ?? {});
            }
          });
        }}
      >
        <Field label="Adresse e-mail" htmlFor="email" error={fieldErrors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="toi@exemple.fr" />
        </Field>
        <Field label={<span className="flex w-full justify-between">Mot de passe <Link href="/mot-de-passe-oublie" className="font-normal text-muted hover:text-foreground">Oublié ?</Link></span>} htmlFor="password" error={fieldErrors.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error && <p className="text-sm text-negative" role="alert">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={pending}>Se connecter</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Pas encore de compte ? <Link href="/inscription" className="font-medium text-foreground underline-offset-4 hover:underline">Créer un compte</Link>
      </p>
      {demoEnabled && (
        <div className="mt-8 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm font-medium">Envie de découvrir d&apos;abord ?</p>
          <p className="mt-1 text-xs text-muted">Un espace de démonstration isolé, rempli de données <strong>fictives</strong>, supprimé automatiquement après 48 h.</p>
          <Button variant="outline" className="mt-3 w-full" loading={demoPending} onClick={() => startDemo(async () => { const r = await startDemoAction(); if (r && !r.ok) setError(r.error); })}>
            <Sparkles /> Explorer la démo
          </Button>
        </div>
      )}
    </div>
  );
}
