/** Moteur bancaire V3 : catégorisation, doublons, en attente/comptabilisée, virements internes, états, signature des webhooks. */
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import { categorize, merchantKey, ruleSuggestions, CONFIRM_THRESHOLD, type CategorizeContext } from "@/lib/bank/categorize";
import { decideDuplicate, duplicateScore, findSupersededPending, findTransferPair, type MatchTx } from "@/lib/bank/matching";
import { describeConnectionState, maskIban } from "@/lib/bank/states";
import { toCents } from "@/server/bank/client";
import { computeSignature, decodeBody, verifyHmac } from "@/server/bank/webhook";

const cats: CategorizeContext["categories"] = [
  { id: "c-courses", name: "Courses alimentaires", kind: "expense" },
  { id: "c-resto", name: "Restaurants", kind: "expense" },
  { id: "c-transport", name: "Transport", kind: "expense" },
  { id: "c-loisirs", name: "Loisirs", kind: "expense" },
  { id: "c-salaire", name: "Salaire", kind: "income" },
];
const ctx = (over: Partial<CategorizeContext> = {}): CategorizeContext => ({ categories: cats, rules: [], history: new Map(), ...over });

describe("catégorisation automatique", () => {
  it("la règle de l'utilisateur est prioritaire sur tout le reste", () => {
    const g = categorize({ label: "CB CARREFOUR CITY 12/03", bankCategories: ["restaurant"], isIncome: false }, ctx({ rules: [{ pattern: "carrefour", categoryId: "c-loisirs" }] }));
    expect(g).toEqual({ categoryId: "c-loisirs", confidence: 95, source: "rule" });
  });
  it("une règle vers une catégorie de revenu ne s'applique pas à une dépense", () => {
    const g = categorize({ label: "CARREFOUR", isIncome: false }, ctx({ rules: [{ pattern: "carrefour", categoryId: "c-salaire" }] }));
    expect(g.source).not.toBe("rule");
  });
  it("utilise la catégorie bancaire quand elle est reconnue", () => {
    expect(categorize({ label: "XYZ 123", bankCategories: ["supermarket"], isIncome: false }, ctx())).toMatchObject({ categoryId: "c-courses", source: "bank", confidence: 70 });
  });
  it("apprend de l'historique (≥ 3 fois → 85, 2 fois → 75) et ignore un historique partagé", () => {
    const key = merchantKey(null, "PAYPAL CINEMA PATHE");
    expect(categorize({ label: "PAYPAL CINEMA PATHE", isIncome: false }, ctx({ history: new Map([[key, new Map([["c-loisirs", 3]])]]) }))).toMatchObject({ categoryId: "c-loisirs", confidence: 85, source: "history" });
    expect(categorize({ label: "PAYPAL CINEMA PATHE", isIncome: false }, ctx({ history: new Map([[key, new Map([["c-loisirs", 2]])]]) })).confidence).toBe(75);
    const shared = categorize({ label: "PAYPAL CINEMA PATHE", isIncome: false }, ctx({ history: new Map([[key, new Map([["c-loisirs", 2], ["c-resto", 2]])]]) }));
    expect(shared.source).not.toBe("history");
  });
  it("sans indice fiable, la confiance reste sous le seuil de validation", () => {
    const g = categorize({ label: "PRLV SEPA 8F3K2", isIncome: false }, ctx());
    expect(g.confidence).toBeLessThan(CONFIRM_THRESHOLD);
  });
  it("propose une règle après 2 corrections identiques, jamais pour un motif déjà mémorisé", () => {
    const corr = [{ key: "boulangerie paul", categoryId: "c-courses" }, { key: "boulangerie paul", categoryId: "c-courses" }, { key: "sncf", categoryId: "c-transport" }];
    expect(ruleSuggestions(corr, [])).toEqual([{ pattern: "boulangerie paul", categoryId: "c-courses", count: 2 }]);
    expect(ruleSuggestions(corr, [{ pattern: "boulangerie paul" }])).toEqual([]);
  });
});

const tx = (id: string, date: string, amount: number, label: string, accountId = "A"): MatchTx => ({ id, accountId, date, amount, label });

describe("doublons manuel ↔ banque", () => {
  it("même montant, même jour, libellé proche → fusion automatique", () => {
    const bank = tx("b1", "2026-03-10", -4250, "CB MONOPRIX PARIS 10/03");
    const d = decideDuplicate(bank, [tx("m1", "2026-03-10", -4250, "Monoprix")], []);
    expect(d.decision).toBe("auto");
    expect(d.candidate?.id).toBe("m1");
  });
  it("deux saisies manuelles identiques → simple proposition (ambiguïté)", () => {
    const bank = tx("b1", "2026-03-10", -1000, "CB BOULANGERIE");
    expect(decideDuplicate(bank, [tx("m1", "2026-03-10", -1000, "Boulangerie"), tx("m2", "2026-03-10", -1000, "Boulangerie")], []).decision).toBe("suggest");
  });
  it("deux opérations bancaires identiques le même jour (achats légitimes) → pas de fusion automatique", () => {
    const b1 = tx("b1", "2026-03-10", -250, "CB CAFE");
    const b2 = tx("b2", "2026-03-10", -250, "CB CAFE");
    expect(decideDuplicate(b1, [tx("m1", "2026-03-10", -250, "Café")], [b2]).decision).toBe("suggest");
  });
  it("montant différent, autre compte, signe opposé ou écart > 5 jours → aucun doublon", () => {
    const bank = tx("b", "2026-03-10", -5000, "AMAZON");
    expect(duplicateScore(tx("m", "2026-03-10", -5100, "Amazon"), bank)).toBe(0);
    expect(duplicateScore(tx("m", "2026-03-10", -5000, "Amazon", "B"), bank)).toBe(0);
    expect(duplicateScore(tx("m", "2026-03-10", 5000, "Amazon"), bank)).toBe(0);
    expect(duplicateScore(tx("m", "2026-03-02", -5000, "Amazon"), bank)).toBe(0);
  });
  it("décalage de date de 2 jours sans libellé commun → proposition seulement", () => {
    expect(decideDuplicate(tx("b", "2026-03-12", -1999, "PRLV SEPA XYZ"), [tx("m", "2026-03-10", -1999, "Abonnement")], []).decision).toBe("suggest");
  });
});

describe("opérations en attente et virements internes", () => {
  it("une opération comptabilisée remplace l'opération en attente la plus proche (même montant, ≤ 7 j)", () => {
    const booked = tx("b", "2026-03-12", -3000, "CB SNCF");
    expect(findSupersededPending(booked, [tx("p1", "2026-03-01", -3000, ""), tx("p2", "2026-03-10", -3000, ""), tx("p3", "2026-03-11", -2999, "")])?.id).toBe("p2");
    expect(findSupersededPending(booked, [tx("p4", "2026-03-12", -3000, "", "B")])).toBeNull();
  });
  it("apparie un débit et un crédit opposés sur deux comptes à ≤ 3 jours", () => {
    const debit = tx("d", "2026-03-05", -20000, "VIR VERS LIVRET");
    expect(findTransferPair(debit, [tx("c1", "2026-03-06", 20000, "VIR RECU", "L"), tx("c2", "2026-03-05", 20000, "x", "A")])?.id).toBe("c1");
    expect(findTransferPair(debit, [tx("c3", "2026-03-10", 20000, "", "L")])).toBeNull();
  });
});

describe("états de connexion et données sensibles", () => {
  it.each([
    ["SCARequired", "Autorisation expirée", "reconnect"],
    ["webauthRequired", "Autorisation expirée", "reconnect"],
    ["additionalInformationNeeded", "Action nécessaire", "reconnect"],
    ["decoupled", "Action nécessaire", "reconnect"],
    ["validating", "Action nécessaire", "reconnect"],
    ["actionNeeded", "Action nécessaire", "bank_site"],
    ["passwordExpired", "Action nécessaire", "reconnect"],
    ["wrongpass", "Connexion interrompue", "reconnect"],
    ["websiteUnavailable", "Erreur temporaire", "wait"],
    ["unEtatFuturInconnu", "Connexion interrompue", "reconnect"],
  ])("%s → %s", (state, label, action) => {
    const i = describeConnectionState(state);
    expect(i.label).toBe(label);
    expect(i.action).toBe(action);
    expect(i.message.length).toBeGreaterThan(20);
  });
  it("connexion saine, en cours de synchronisation ou expirée", () => {
    expect(describeConnectionState(null).label).toBe("Connectée");
    expect(describeConnectionState(null, { syncing: true }).label).toBe("Synchronisation en cours");
    expect(describeConnectionState(null, { expired: true }).action).toBe("reconnect");
  });
  it("masque l'IBAN (jamais affiché en entier)", () => {
    expect(maskIban("FR76 3000 6000 0112 3456 7890 189")).toBe("FR76 •••• •••• 0189");
    expect(maskIban(null)).toBeNull();
    expect(maskIban("123")).toBeNull();
  });
  it("convertit les montants Powens en centimes sans dérive, et refuse l'absent ou l'invalide", () => {
    expect(toCents(-42.5)).toBe(-4250);
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("authenticité des webhooks", () => {
  const secret = "secret-de-test";
  const body = JSON.stringify({ id_webhook_data: 1 });
  const date = new Date("2026-03-10T10:00:00Z").toISOString();
  const headers = (sig: string, d = date) => new Headers({ "bi-signature": sig, "bi-signature-date": d });
  it("signature conforme à la documentation : BASE64(HMAC_SHA256(METHOD.endpoint.date.payload))", () => {
    const expected = createHmac("sha256", secret).update(`POST./api/webhooks/powens.${date}.${body}`).digest("base64");
    expect(computeSignature(secret, "post", "/api/webhooks/powens", date, body)).toBe(expected);
  });
  it("accepte une signature valide, refuse une signature, un corps ou une date falsifiés", () => {
    const now = Date.parse(date) + 60_000;
    const sig = computeSignature(secret, "POST", "/api/webhooks/powens", date, body);
    expect(verifyHmac(headers(sig), "/api/webhooks/powens", "/api/webhooks/powens?event=X", body, secret, now)).toBe(true);
    expect(verifyHmac(headers(sig), "/api/webhooks/powens", "/api/webhooks/powens", body + " ", secret, now)).toBe(false);
    expect(verifyHmac(headers(sig.replace(/^./, "A")), "/api/webhooks/powens", "/api/webhooks/powens", body, "autre", now)).toBe(false);
    expect(verifyHmac(headers(sig), "/api/webhooks/powens", "/api/webhooks/powens", body, secret, now + 3600_000)).toBe(false); // rejeu tardif
    expect(verifyHmac(new Headers(), "/api/webhooks/powens", "/api/webhooks/powens", body, secret, now)).toBe(false);
  });
  it("décompresse un corps gzip", () => {
    expect(decodeBody(gzipSync(Buffer.from(body)), "gzip")).toBe(body);
    expect(decodeBody(Buffer.from(body), null)).toBe(body);
  });
});
