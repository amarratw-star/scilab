import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { exportAllData } from "@/server/services/user";
import { rateLimit } from "@/server/auth/rate-limit";

/** Export RGPD complet (droit d'accès et de portabilité). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non authentifié", { status: 401 });
  if (!(await rateLimit(`export:${user.id}`, 10, 3600))) return new NextResponse("Trop d'exports, réessaie plus tard.", { status: 429 });
  const data = await runAsUser(user, (ctx) => exportAllData(ctx));
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="moneta-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
