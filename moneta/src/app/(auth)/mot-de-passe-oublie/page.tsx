"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";
import { forgotPasswordAction } from "@/app/actions/auth";

export default function ForgotPage() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
      <p className="mt-1 text-sm text-muted">Indique ton adresse : nous t&apos;enverrons un lien valable une heure.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("email"));
          start(async () => {
            const r = await forgotPasswordAction({ email });
            setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error });
          });
        }}
      >
        <Field label="Adresse e-mail" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        {msg && <Callout tone={msg.ok ? "positive" : "negative"}>{msg.text}</Callout>}
        <Button type="submit" className="w-full" size="lg" loading={pending}>Envoyer le lien</Button>
      </form>
      <Link href="/connexion" className="mt-6 block text-center text-sm text-muted hover:text-foreground">← Retour à la connexion</Link>
    </div>
  );
}
