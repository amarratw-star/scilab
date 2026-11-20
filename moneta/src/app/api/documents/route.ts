import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, ServiceError } from "@/server/services/context";
import { uploadDocument, MAX_DOC_SIZE } from "@/server/services/documents";
import { rateLimit } from "@/server/auth/rate-limit";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!(await rateLimit(`upload:${user.id}`, 60, 3600))) return NextResponse.json({ error: "Trop de fichiers envoyés. Réessaie plus tard." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier" }, { status: 400 });
  if (file.size > MAX_DOC_SIZE) return NextResponse.json({ error: "Fichier trop volumineux (8 Mo maximum)" }, { status: 413 });
  const tx = String(form?.get("transactionId") ?? "");
  const data = Buffer.from(await file.arrayBuffer());
  try {
    const row = await runAsUser(user, (ctx) =>
      uploadDocument(ctx, { name: file.name, data, kind: String(form?.get("kind") ?? "receipt"), transactionId: /^[0-9a-f-]{36}$/i.test(tx) ? tx : null }),
    );
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Erreur lors de l'envoi" }, { status: 500 });
  }
}
