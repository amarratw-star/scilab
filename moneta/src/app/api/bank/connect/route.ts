import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";
import { randomToken } from "@/server/crypto";
import { runAsUser, ServiceError } from "@/server/services/context";
import { bankStatus, webviewFor } from "@/server/bank/service";
import { PowensError } from "@/server/bank/client";

const body = z.object({
  flow: z.enum(["connect", "reconnect", "manage"]).default("connect"),
  connectorUuid: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  connectionId: z.string().uuid().optional(),
});

const STATE_COOKIE = "moneta_bank_state";

/**
 * Démarre le parcours Powens. Le jeton `state` est aléatoire, stocké dans un cookie httpOnly (10 min)
 * et vérifié au retour : protection contre la falsification de requête (CSRF).
 * Les identifiants bancaires sont saisis exclusivement dans la webview Powens, jamais dans MONETA.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const st = bankStatus(user);
  if (!st.available) return NextResponse.json({ error: st.message }, { status: 400 });
  if (!(await rateLimit(`bank-connect:${user.id}`, 10, 600))) return NextResponse.json({ error: "Trop de tentatives, réessaie dans quelques minutes." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  if (parsed.data.flow !== "connect" && !parsed.data.connectionId) return NextResponse.json({ error: "Connexion manquante" }, { status: 400 });
  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const state = randomToken(24);
  try {
    const redirect = await runAsUser(user, (ctx) => webviewFor(ctx, parsed.data.flow, { state, redirectUri: `${origin}/api/bank/callback`, connectorUuid: parsed.data.connectorUuid, connectionId: parsed.data.connectionId }));
    const res = NextResponse.json({ redirect });
    res.cookies.set(STATE_COOKIE, `${state}.${parsed.data.flow}`, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/bank/callback", maxAge: 600 });
    return res;
  } catch (e) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof PowensError) return NextResponse.json({ error: "Le service de connexion bancaire ne répond pas pour le moment. Réessaie dans quelques minutes." }, { status: 502 });
    console.error("[bank] connect", e);
    return NextResponse.json({ error: "Connexion impossible pour le moment." }, { status: 500 });
  }
}
