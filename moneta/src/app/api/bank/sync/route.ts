import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, ServiceError } from "@/server/services/context";
import { syncConnection } from "@/server/bank/powens";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { connectionId } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(connectionId))) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  try {
    const r = await runAsUser(user, (ctx) => syncConnection(ctx, connectionId));
    return NextResponse.json({ message: `${r.imported} opération(s) importée(s)` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ServiceError ? e.message : "Synchronisation impossible" }, { status: 502 });
  }
}
