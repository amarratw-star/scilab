import "server-only";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import { sha256Hex } from "@/server/crypto";

export const ALLOWED_DOC_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};
export const MAX_DOC_SIZE = 8 * 1024 * 1024; // 8 Mo
export const DOC_KINDS: Record<string, string> = { receipt: "Ticket de caisse", invoice: "Facture", proof: "Justificatif", other: "Document divers" };

/** Vérifie le type réel du fichier à partir de ses premiers octets (ne fait pas confiance au type déclaré). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buf.subarray(4, 12).toString("ascii").startsWith("ftyphei") || buf.subarray(4, 12).toString("ascii").startsWith("ftypmif1")) return "image/heic";
  return null;
}

export async function uploadDocument(ctx: Ctx, file: { name: string; data: Buffer; kind?: string; transactionId?: string | null }) {
  if (file.data.length === 0) throw new ServiceError("Fichier vide");
  if (file.data.length > MAX_DOC_SIZE) throw new ServiceError("Fichier trop volumineux (8 Mo maximum)");
  const mime = sniffMime(file.data);
  if (!mime || !ALLOWED_DOC_TYPES[mime]) throw new ServiceError("Format non accepté (JPEG, PNG, WebP, HEIC ou PDF uniquement)");
  if (file.transactionId) {
    const [t] = await ctx.tx.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.id, file.transactionId));
    if (!t) throw new ServiceError("Opération introuvable");
  }
  const safeName = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || `document.${ALLOWED_DOC_TYPES[mime]}`;
  const kind = file.kind && DOC_KINDS[file.kind] ? file.kind : "other";
  const [row] = await ctx.tx
    .insert(s.documents)
    .values({ userId: ctx.userId, name: safeName, kind, mimeType: mime, size: file.data.length, sha256: sha256Hex(file.data), data: file.data, transactionId: file.transactionId ?? null })
    .returning({ id: s.documents.id, name: s.documents.name });
  await audit(ctx, "document.upload", "document", row.id, { size: file.data.length, mime });
  return row;
}

export async function listDocuments(ctx: Ctx, q?: string, transactionId?: string) {
  const conds = [];
  if (q?.trim()) {
    const like = `%${q.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    conds.push(or(ilike(s.documents.name, like), ilike(s.transactions.description, like), ilike(s.transactions.merchant, like))!);
  }
  if (transactionId) conds.push(eq(s.documents.transactionId, transactionId));
  return ctx.tx
    .select({
      id: s.documents.id,
      name: s.documents.name,
      kind: s.documents.kind,
      mimeType: s.documents.mimeType,
      size: s.documents.size,
      createdAt: s.documents.createdAt,
      transactionId: s.documents.transactionId,
      txDescription: sql<string | null>`coalesce(${s.transactions.merchant}, ${s.transactions.description})`,
      txDate: s.transactions.date,
      txAmount: s.transactions.amount,
    })
    .from(s.documents)
    .leftJoin(s.transactions, eq(s.transactions.id, s.documents.transactionId))
    .where(conds.length ? sql.join(conds, sql` and `) : undefined)
    .orderBy(desc(s.documents.createdAt))
    .limit(200);
}

export async function getDocument(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.select().from(s.documents).where(eq(s.documents.id, id));
  return row ?? null;
}

export async function linkDocument(ctx: Ctx, id: string, transactionId: string | null) {
  if (transactionId) {
    const [t] = await ctx.tx.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.id, transactionId));
    if (!t) throw new ServiceError("Opération introuvable");
  }
  const [row] = await ctx.tx.update(s.documents).set({ transactionId }).where(eq(s.documents.id, id)).returning({ id: s.documents.id });
  if (!row) throw new ServiceError("Document introuvable");
  await audit(ctx, "document.link", "document", id, { transactionId });
}

export async function deleteDocument(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.delete(s.documents).where(eq(s.documents.id, id)).returning({ id: s.documents.id, name: s.documents.name });
  if (!row) throw new ServiceError("Document introuvable");
  await audit(ctx, "document.delete", "document", id, { name: row.name });
}
