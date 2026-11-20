import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { syncConnection } from "@/server/bank/powens";

/** Retour de la webview Powens. `state` = identifiant de connexion, vérifié via RLS (appartient à l'utilisateur connecté). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const base = process.env.APP_URL ?? url.origin;
  if (!user) return NextResponse.redirect(`${base}/connexion`);
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.get("error") || !/^[0-9a-f-]{36}$/i.test(state)) return NextResponse.redirect(`${base}/import?banque=erreur`);
  try {
    await runAsUser(user, (ctx) => syncConnection(ctx, state));
    return NextResponse.redirect(`${base}/import?banque=ok`);
  } catch {
    return NextResponse.redirect(`${base}/import?banque=erreur`);
  }
}
