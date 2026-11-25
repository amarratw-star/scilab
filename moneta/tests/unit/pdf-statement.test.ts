/** Import de relevés PDF : lecture d'un relevé FICTIF au format Banque Populaire, généré avec pdfkit. */
import { describe, expect, it } from "vitest";
import { makeStatementPdf } from "../fixtures/make-statement-pdf";
import { extractPdfItems } from "@/server/pdf-extract";
import { parseFrenchAmount, parseStatement, type PdfTextItem } from "@/lib/pdf-statement";

describe("lecture d'un relevé PDF", () => {
  it("montants au format français", () => {
    expect(parseFrenchAmount("1 234,56")).toBe(123456);
    expect(parseFrenchAmount("1.234,56")).toBe(123456);
    expect(parseFrenchAmount("12,30 €")).toBe(1230);
    expect(parseFrenchAmount("45,00-")).toBe(-4500);
    expect(parseFrenchAmount("abc")).toBeNull();
  });

  it("relevé multi-comptes : opérations, signes, années, libellés sur deux lignes, soldes vérifiés", async () => {
    const { items } = await extractPdfItems(new Uint8Array(await makeStatementPdf()));
    const r = parseStatement(items);
    expect(r.period).toEqual({ from: "2025-12-20", to: "2026-01-19" });
    expect(r.sections).toHaveLength(2);
    const [cc, livret] = r.sections;
    expect(cc.title).toMatch(/COMPTE CHEQUES/);
    expect(cc.rows).toEqual([
      { date: "2025-12-22", label: "CB CARREFOUR MARKET PARIS 20/12", amount: -5430 },
      { date: "2025-12-24", label: "VIR SEPA RECU EMPLOYEUR FICTIF SALAIRE DECEMBRE", amount: 210000 },
      { date: "2025-12-29", label: "PRLV SEPA FOURNISSEUR ENERGIE", amount: -8990 },
      { date: "2026-01-05", label: "CB RESTAURANT LE BISTROT", amount: -2350 },
      { date: "2026-01-12", label: "RETRAIT DAB 11/01", amount: -6000 },
      { date: "2026-01-15", label: "COTISATION CARTE", amount: -102410 },
    ]);
    expect(cc.opening).toEqual({ amount: 125000, date: "2025-12-19" });
    expect(cc.closing).toEqual({ amount: 209820, date: "2026-01-19" });
    expect(cc.gap).toBe(0); // lecture complète, vérifiée par les soldes
    expect(livret.title).toMatch(/LIVRET A/);
    expect(livret.rows).toEqual([{ date: "2025-12-31", label: "INTERETS ANNUELS", amount: 3750 }]);
    expect(livret.gap).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("une opération manquante est détectée par l'écart de soldes", async () => {
    const { items } = await extractPdfItems(new Uint8Array(await makeStatementPdf()));
    const without = items.filter((i) => !(i.str === "23,50"));
    const cc = parseStatement(without).sections[0];
    expect(cc.gap).toBe(2350); // un débit de 23,50 € n'a pas été lu : MONETA le signale au lieu de l'ignorer
  });

  it("PDF sans texte (scanné) : aucune opération inventée, message explicite", () => {
    const r = parseStatement([] as PdfTextItem[]);
    expect(r.sections).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/scanné/);
  });
});
