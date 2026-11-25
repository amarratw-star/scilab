"use client";
import { toast } from "sonner";
import { readableColor } from "@/lib/color";

/** Pastille de banque : couleur du connecteur + initiales (aucun logo n'est fourni par l'API Powens). */
export function BankInitials({ name, color, size = 40 }: { name: string; color: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "B";
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-xl text-xs font-semibold text-white" style={{ width: size, height: size, background: color ? readableColor(color) : "var(--color-primary)" }}>
      {initials}
    </span>
  );
}

/** Démarre le parcours Powens (connexion, reconnexion, gestion) : le serveur renvoie l'URL de la webview. */
export async function startWebview(body: { flow: "connect" | "reconnect" | "manage"; connectionId?: string; connectorUuid?: string }) {
  const res = await fetch("/api/bank/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.redirect) return void toast.error(data.error ?? "Connexion impossible pour le moment.");
  window.location.assign(data.redirect);
}

