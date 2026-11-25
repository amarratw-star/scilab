import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";
import { extractPdfItems } from "@/server/pdf-extract";
import { parseStatement } from "@/lib/pdf-statement";

export const runtime = "nodejs";

/**
 * Lecture d'un relevé bancaire PDF. Le fichier est lu en mémoire sur le serveur MONETA puis oublié :
 * il n'est ni stocké, ni transmis à un service tiers. Seules les opérations reconnues sont renvoyées
 * au navigateur, pour vérification avant tout import.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!(await rateLimit(`pdf-import:${user.id}`, 30, 3600))) return NextResponse.json({ error: "Trop d'imports en peu de temps, réessaie plus tard." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Fichier trop volumineux (10 Mo maximum)." }, { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  if (!(data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) return NextResponse.json({ error: "Ce fichier n'est pas un PDF." }, { status: 400 });
  try {
    const { items, pages } = await extractPdfItems(data);
    const result = parseStatement(items);
    return NextResponse.json({ ...result, pages });
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (/password/i.test(name)) return NextResponse.json({ error: "Ce PDF est protégé par un mot de passe. Télécharge une version sans protection depuis ta banque." }, { status: 400 });
    console.error("[import pdf]", (e as Error).message);
    return NextResponse.json({ error: "Ce PDF n'a pas pu être lu." }, { status: 400 });
  }
}
