import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { getDocument } from "@/server/services/documents";

/** Sert un document privé : uniquement à son propriétaire (RLS), jamais mis en cache public. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Introuvable", { status: 404 });
  const doc = await runAsUser(user, (ctx) => getDocument(ctx, id));
  if (!doc) return new NextResponse("Introuvable", { status: 404 });
  const download = new URL(req.url).searchParams.has("telecharger");
  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(doc.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
