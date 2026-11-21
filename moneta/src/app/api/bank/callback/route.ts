import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { bankStatus, pullSync } from "@/server/bank/service";
import { recordSyncError } from "@/server/bank/ingest";

const STATE_COOKIE = "moneta_bank_state";
const KNOWN_ERRORS = new Set(["access_denied", "server_error", "cancelled", "temporarily_unavailable"]);

/**
 * Retour de la webview Powens : ?connection_id=…&state=… en cas de succès, ?error=…&error_description=… sinon.
 * Le `state` doit correspondre au cookie posé au démarrage. Le contenu de l'URL n'est jamais affiché tel quel.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = process.env.APP_URL ?? url.origin;
  const go = (q: string) => {
    const res = NextResponse.redirect(`${base}/comptes?${q}#connexions`);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/bank/callback" });
    return res;
  };
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${base}/connexion`);
  const [expected, flow] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split(".");
  const state = url.searchParams.get("state") ?? "";
  if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return go("banque=etat");
  const error = url.searchParams.get("error");
  if (error) return go(`banque=${KNOWN_ERRORS.has(error) ? error : "erreur"}`);
  const connectionId = url.searchParams.get("connection_id");
  if (!bankStatus(user).available) return go("banque=indisponible");
  if (connectionId && !/^\d{1,18}$/.test(connectionId)) return go("banque=erreur");
  try {
    const st = await runAsUser(user, (ctx) => pullSync(ctx, "callback", connectionId ?? undefined));
    if (st.error) return go("banque=partiel");
    return go(`banque=ok&flux=${flow === "reconnect" ? "reconnect" : flow === "manage" ? "manage" : "connect"}&nouvelles=${st.created}&doublons=${st.suggested}`);
  } catch (e) {
    console.error("[bank] callback", (e as Error).message);
    await runAsUser(user, (ctx) => recordSyncError(ctx, null, "callback", "Synchronisation initiale échouée")).catch(() => undefined);
    // La connexion existe chez Powens : elle sera synchronisée au prochain webhook ou à la prochaine actualisation
    return go("banque=partiel");
  }
}
