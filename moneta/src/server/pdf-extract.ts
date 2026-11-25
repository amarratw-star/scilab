import "server-only";
import { getDocumentProxy } from "unpdf";
import type { PdfTextItem } from "@/lib/pdf-statement";

/** Extrait les fragments de texte positionnés d'un PDF (en mémoire, rien n'est stocké ni envoyé à un tiers). */
export async function extractPdfItems(data: Uint8Array, maxPages = 60): Promise<{ items: PdfTextItem[]; pages: number }> {
  const pdf = await getDocumentProxy(data);
  const items: PdfTextItem[] = [];
  const pages = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (!it.str || !it.transform) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, page: p });
    }
  }
  await pdf.destroy();
  return { items, pages: pdf.numPages };
}
