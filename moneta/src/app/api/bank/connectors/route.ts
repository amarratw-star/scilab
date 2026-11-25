import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { bankStatus, client } from "@/server/bank/service";
import type { PowensConnector } from "@/server/bank/client";
import { readableColor } from "@/lib/color";

let cache: { at: number; list: { uuid: string; name: string; color: string | null; beta: boolean }[] } | null = null;

/** Liste des banques disponibles (connecteurs Powens de type « bank »), mise en cache 6 h côté serveur. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const st = bankStatus(user);
  if (!st.available) return NextResponse.json({ error: st.message }, { status: 400 });
  if (!cache || Date.now() - cache.at > 6 * 3600_000) {
    try {
      const { connectors } = await client().listConnectors();
      const list = (connectors ?? [])
        .filter((c: PowensConnector) => !c.hidden && (!c.capabilities || c.capabilities.includes("bank")))
        .map((c) => ({ uuid: c.uuid, name: c.name, color: c.color ? readableColor(`#${String(c.color).replace(/^#/, "")}`) : null, beta: Boolean(c.beta) }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      cache = { at: Date.now(), list };
    } catch {
      return NextResponse.json({ error: "La liste des banques est momentanément indisponible." }, { status: 502 });
    }
  }
  return NextResponse.json({ connectors: cache.list });
}
