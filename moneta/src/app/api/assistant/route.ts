import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { askAssistant } from "@/server/ai/assistant";
import { rateLimit } from "@/server/auth/rate-limit";
import { features } from "@/server/env";
import { withCurrency } from "@/server/currency";

export const maxDuration = 120;

const body = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(40) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!features.ai()) return NextResponse.json({ error: "Le conseiller IA n'est pas configuré sur ce serveur (ANTHROPIC_API_KEY manquante)." }, { status: 503 });
  if (!user.settings?.privacy?.aiEnabled) return NextResponse.json({ error: "Active d'abord le conseiller IA (consentement requis)." }, { status: 403 });
  if (!(await rateLimit(`ai:${user.id}`, 30, 600))) return NextResponse.json({ error: "Trop de questions en peu de temps. Réessaie dans quelques minutes." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  try {
    const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
    const result = await withCurrency(user.currency, () => askAssistant({ history: parsed.data.messages, fin, today, settings, displayName: user.displayName }));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "Clé API IA invalide : vérifie ANTHROPIC_API_KEY." }, { status: 502 });
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "Le service IA est momentanément saturé. Réessaie dans un instant." }, { status: 503 });
    if (e instanceof Anthropic.APIConnectionError) return NextResponse.json({ error: "Impossible de joindre le service IA." }, { status: 502 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Erreur du service IA (${e.status ?? "?"}).` }, { status: 502 });
    console.error("[MONETA] assistant", e);
    return NextResponse.json({ error: "Erreur inattendue du conseiller." }, { status: 500 });
  }
}
