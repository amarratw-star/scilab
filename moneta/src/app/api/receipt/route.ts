import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import * as s from "@/server/db/schema";
import { extractReceiptWithVision } from "@/server/ai/assistant";
import { features } from "@/server/env";
import { rateLimit } from "@/server/auth/rate-limit";
import { sniffMime } from "@/server/services/documents";

export const maxDuration = 60;

/** Extraction d'un ticket par vision IA — uniquement si configurée ET acceptée par l'utilisateur. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!features.ai()) return NextResponse.json({ error: "Analyse IA non configurée" }, { status: 503 });
  if (!user.settings?.privacy?.ocrCloudEnabled) return NextResponse.json({ error: "Analyse en ligne non autorisée dans tes paramètres" }, { status: 403 });
  if (!(await rateLimit(`ocr:${user.id}`, 20, 3600))) return NextResponse.json({ error: "Trop d'analyses, réessaie plus tard" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Image manquante ou trop lourde (5 Mo max)" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return NextResponse.json({ error: "Format d'image non pris en charge (JPEG, PNG ou WebP)" }, { status: 400 });
  const cats = await runAsUser(user, (ctx) => ctx.tx.select({ name: s.categories.name }).from(s.categories));
  try {
    const result = await extractReceiptWithVision(buf, mime, cats.map((c) => c.name));
    if (!result) return NextResponse.json({ error: "Analyse impossible : saisis les informations manuellement." }, { status: 422 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Le service d'analyse est indisponible : saisis les informations manuellement." }, { status: 502 });
  }
}
