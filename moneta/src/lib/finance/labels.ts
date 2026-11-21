/** Normalise un libellé bancaire pour regrouper les opérations d'un même commerçant. */
export function normalizeLabel(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(cb|carte|prlv|prelevement|sepa|vir|virement|paiement|achat|retrait|dab|facture|fact|ref|ech|europeen|inst|sct|recu|emis)\b/g, " ")
    .replace(/\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

