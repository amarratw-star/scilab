import { NextResponse } from "next/server";
import { handlePowensWebhook } from "@/server/bank/webhook";

export const dynamic = "force-dynamic";

/**
 * Point de réception des webhooks Powens. URL à déclarer dans la console Powens :
 *   {APP_URL}/api/webhooks/powens?event=CONNECTION_SYNCED (idem pour chaque événement géré)
 * Le nom de l'événement est lu dans le paramètre `event` (ou l'en-tête X-Powens-Event à défaut).
 */
export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 50 * 1024 * 1024) return NextResponse.json({ error: "Trop volumineux" }, { status: 413 });
  const url = new URL(req.url);
  const r = await handlePowensWebhook({
    event: url.searchParams.get("event") ?? req.headers.get("x-powens-event"),
    headers: req.headers,
    rawBody: raw,
    path: url.pathname,
    pathWithQuery: url.pathname + url.search,
  });
  return NextResponse.json(r.body, { status: r.status });
}
