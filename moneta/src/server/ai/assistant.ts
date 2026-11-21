/**
 * « Mon conseiller » — boucle d'outils côté serveur avec l'API Claude.
 *
 * Choix d'architecture : la boucle tourne sur notre serveur (Messages API) plutôt que sur une
 * infrastructure d'agents hébergée, afin que les données financières restent chez nous, que
 * l'historique de conversation ne soit pas conservé côté fournisseur au-delà de la requête,
 * et que l'IA n'accède qu'aux outils en lecture définis dans ./tools.ts.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI_TOOLS, runTool, type Proposal } from "./tools";
import type { Finance } from "@/server/services/snapshot";
import type { UserSettings } from "@/server/db/schema";
import { formatDateLong, type ISODate } from "@/lib/dates";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  reply: string;
  proposals: Proposal[];
  toolsUsed: string[];
}

const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `Tu es « Mon conseiller », le conseiller financier intégré à MONETA, une application de gestion de finances personnelles. Tu parles français et tu tutoies l'utilisateur.

Ta personnalité : professionnel, clair, pédagogue, honnête et précis. Tu expliques simplement, sans jargon ni moralisation, et tu vas droit au but. Tu félicites sobrement ce qui va bien et tu signales franchement ce qui pose problème, toujours avec une piste d'action concrète.

Règles impératives :
- Tes seules sources sont les outils fournis, qui renvoient des chiffres calculés par MONETA. Appelle l'outil adapté avant de citer un chiffre. N'invente jamais un montant, une date, une habitude, un compte ou une catégorie. Si une donnée manque, dis-le et indique comment l'ajouter dans MONETA.
- Reprends les montants tels que renvoyés (déjà formatés dans la devise de l'utilisateur). Si tu calcules toi-même, montre brièvement le calcul.
- Distingue toujours : argent disponible (comptes courants et espèces), épargne, patrimoine, revenus encaissés et revenus attendus. Un revenu attendu n'est jamais de l'argent disponible.
- Prudence : une projection n'est pas une garantie, une corrélation n'est pas une cause. Signale hypothèses et limites (historique court, données manquantes).
- « Puis-je acheter… » → simulate_purchase, puis : solde actuel, engagements restants, marge de sécurité, conclusion nuancée.
- « Où économiser ? », « mauvaises habitudes » → get_savings_opportunities et get_insights ; ne cite que des habitudes visibles dans les données.
- Plan d'épargne → savings_plan, complété si utile par les opportunités d'économies chiffrées.
- « Ma situation s'améliore-t-elle ? » → monthly_history et get_health_score.
- Tu ne peux rien modifier. Pour ajouter une dépense ou un revenu, utilise propose_transaction : l'utilisateur confirme lui-même via une carte. Tu ne supprimes ni ne modifies jamais d'opération.
- Tu n'es pas un conseiller en investissement agréé : pas de recommandation de produits financiers précis.
- Format : réponses concises (5 à 12 lignes en général), paragraphes courts, listes à puces si utile, **gras** pour les chiffres clés, une recommandation finale actionnable. Pas de tableaux larges.`;

export async function askAssistant(input: { history: ChatTurn[]; fin: Finance; today: ISODate; settings: UserSettings; displayName: string }): Promise<AssistantReply> {
  const client = new Anthropic(); // clé lue côté serveur depuis ANTHROPIC_API_KEY
  const model = process.env.AI_MODEL || "claude-opus-5-5";
  const proposals: Proposal[] = [];
  const toolsUsed: string[] = [];

  const messages: BetaMessageParam[] = input.history.slice(-20).map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("Le dernier message doit venir de l'utilisateur");
  const context = `Contexte : nous sommes le ${formatDateLong(input.today)} (${input.today}). Prénom de l'utilisateur : ${input.displayName}. Devise : euro.`;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ],
      tools: AI_TOOLS,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return { reply: "Je ne peux pas répondre à cette demande. Essaie de reformuler ta question sur tes finances.", proposals, toolsUsed };
    }

    const toolUses = response.content.filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const text = response.content
        .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const truncated = response.stop_reason === "max_tokens" ? "\n\n_(Réponse tronquée.)_" : "";
      return { reply: (text || "Je n'ai pas pu formuler de réponse.") + truncated, proposals, toolsUsed };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        toolsUsed.push(tu.name);
        try {
          const out = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, input.fin, input.today, input.settings, proposals);
          return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(out) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: tu.id, content: `Erreur : ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { reply: "La demande a nécessité trop d'étapes. Peux-tu la préciser ?", proposals, toolsUsed };
}

/* ---------------- Extraction de ticket par vision (optionnelle) ---------------- */

export interface VisionReceipt {
  merchant: string | null;
  date: string | null;
  total_euros: number | null;
  currency: string | null;
  items: { label: string; amount_euros: number }[];
  suggested_category: string | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

export async function extractReceiptWithVision(image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp", categoryNames: string[]): Promise<VisionReceipt | null> {
  const client = new Anthropic();
  const model = process.env.AI_MODEL || "claude-opus-5-5";
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["merchant", "date", "total_euros", "currency", "items", "suggested_category", "confidence", "notes"],
    properties: {
      merchant: { type: ["string", "null"] },
      date: { type: ["string", "null"], description: "AAAA-MM-JJ" },
      total_euros: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      items: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "amount_euros"], properties: { label: { type: "string" }, amount_euros: { type: "number" } } } },
      suggested_category: { type: ["string", "null"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: ["string", "null"] },
    },
  } as const;
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          {
            type: "text",
            text: `Extrais les informations de ce ticket de caisse. Règles : ne devine jamais une valeur illisible (mets null) ; date au format AAAA-MM-JJ ; total TTC payé ; articles uniquement s'ils sont lisibles ; catégorie suggérée parmi : ${categoryNames.join(", ")} (ou null) ; confidence = low si l'image est floue ou partielle. Si l'image n'est pas un ticket, mets tout à null et explique dans notes.`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text) as VisionReceipt;
  } catch {
    return null;
  }
}
