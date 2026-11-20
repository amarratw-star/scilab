import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, ServiceError } from "@/server/services/context";
import { revokeConnection } from "@/server/bank/powens";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { connectionId } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(connectionId))) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  try {
    await runAsUser(user, (ctx) => revokeConnection(ctx, connectionId));
    return NextResponse.json({ message: "Connexion révoquée" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ServiceError ? e.message : "Erreur" }, { status: 400 });
  }
}
