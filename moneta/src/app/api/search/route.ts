import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { globalSearch } from "@/server/services/search";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const hits = await runAsUser(user, (ctx) => globalSearch(ctx, q));
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
