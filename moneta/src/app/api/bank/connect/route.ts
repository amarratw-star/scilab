import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, ServiceError } from "@/server/services/context";
import { startConnection } from "@/server/bank/powens";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  try {
    const redirect = await runAsUser(user, (ctx) => startConnection(ctx, process.env.APP_URL ?? "http://localhost:3000"));
    return NextResponse.json({ redirect });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ServiceError ? e.message : "Connexion impossible" }, { status: 400 });
  }
}
