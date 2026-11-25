/**
 * Génère un relevé PDF FICTIF imitant la mise en page d'un relevé Banque Populaire (réseau BPCE) :
 * deux comptes, colonnes DATE / LIBELLE / DATE VALEUR / DEBIT / CREDIT, libellés sur deux lignes,
 * changement d'année, saut de page avec en-tête répété. Données 100 % inventées.
 */
import PDFDocument from "pdfkit";

type Op = [string, string, string | null, string, "D" | "C"];

export function makeStatementPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font("Helvetica").fontSize(9);
    let y = 40;
    const row = (cells: [string, number, number?, ("left" | "right")?][]) => {
      for (const [txt, x, w, align] of cells) doc.text(txt, x, y, { width: w ?? 300, align: align ?? "left", lineBreak: false });
      y += 14;
    };
    const header = () => row([["DATE", 40], ["LIBELLE / REFERENCE", 90], ["DATE VALEUR", 330, 60], ["DEBIT", 400, 70, "right"], ["CREDIT", 480, 70, "right"]]);
    row([["BANQUE POPULAIRE — RELEVE DE COMPTE (DOCUMENT FICTIF DE TEST)", 40, 500]]);
    row([["Relevé n° 11 du 20/12/2025 au 19/01/2026", 40, 400]]);
    y += 10;
    row([["COMPTE CHEQUES N° 00000000001", 40, 400]]);
    header();
    row([["SOLDE CREDITEUR AU 19/12/2025", 90, 250], ["1 250,00", 480, 70, "right"]]);
    const ops: Op[] = [
      ["22/12", "CB CARREFOUR MARKET", "PARIS 20/12", "54,30", "D"],
      ["24/12", "VIR SEPA RECU EMPLOYEUR FICTIF", "SALAIRE DECEMBRE", "2 100,00", "C"],
      ["29/12", "PRLV SEPA FOURNISSEUR ENERGIE", null, "89,90", "D"],
      ["05/01", "CB RESTAURANT LE BISTROT", null, "23,50", "D"],
      ["12/01", "RETRAIT DAB 11/01", null, "60,00", "D"],
    ];
    for (const [d, l1, l2, a, side] of ops) {
      row([[d, 40], [l1, 90, 230], [d, 330, 60], [a, side === "D" ? 400 : 480, 70, "right"]]);
      if (l2) row([[l2, 90, 230]]);
    }
    doc.addPage();
    y = 40;
    header();
    row([["15/01", 40], ["COTISATION CARTE", 90, 230], ["15/01", 330, 60], ["1 024,10", 400, 70, "right"]]);
    row([["TOTAL DES MOUVEMENTS", 90, 250], ["1 251,80", 400, 70, "right"], ["2 100,00", 480, 70, "right"]]);
    row([["NOUVEAU SOLDE CREDITEUR AU 19/01/2026", 90, 250], ["2 098,20", 480, 70, "right"]]);
    y += 16;
    row([["LIVRET A N° 00000000002", 40, 400]]);
    header();
    row([["SOLDE CREDITEUR AU 19/12/2025", 90, 250], ["5 000,00", 480, 70, "right"]]);
    row([["31/12", 40], ["INTERETS ANNUELS", 90, 230], ["31/12", 330, 60], ["37,50", 480, 70, "right"]]);
    row([["NOUVEAU SOLDE CREDITEUR AU 19/01/2026", 90, 250], ["5 037,50", 480, 70, "right"]]);
    doc.end();
  });
}
