"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowUp, Check, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { savePreferencesAction } from "@/app/actions/account";
import { saveTransactionAction } from "@/app/actions/finance";
import { formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Proposal = { kind: "expense" | "income"; amount: number; accountId: string; accountName: string; categoryId: string | null; categoryName: string | null; date: string; description: string };
type Msg = { role: "user" | "assistant"; content: string; proposals?: Proposal[]; tools?: string[]; error?: boolean };

const SUGGESTIONS = [
  "Analyse mes dépenses du mois.",
  "Où puis-je économiser ?",
  "Puis-je me permettre un achat de 500 € ?",
  "Prépare-moi un plan d'épargne.",
  "Compare mes trois derniers mois.",
  "Ma situation financière s'améliore-t-elle ?",
  "Quelle est ma santé financière ?",
  "Combien puis-je dépenser jusqu'à la fin du mois ?",
];

const TOOL_LABELS: Record<string, string> = {
  get_overview: "Vue d'ensemble",
  get_period_stats: "Statistiques de période",
  compare_periods: "Comparaison de périodes",
  monthly_history: "Historique mensuel",
  search_transactions: "Opérations",
  get_budgets: "Budgets",
  get_goals: "Objectifs",
  get_subscriptions: "Abonnements",
  get_insights: "Analyses",
  simulate_purchase: "Simulation d'achat",
  savings_plan: "Plan d'épargne",
  forecast: "Prévisions",
  get_health_score: "Santé financière",
  get_savings_opportunities: "Opportunités d'économies",
  propose_transaction: "Proposition d'opération",
};

export function ConsentCard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <span className="rounded-2xl bg-info-soft p-3 text-info"><ShieldCheck className="size-5" /></span>
        <div>
          <p className="font-medium">Avant de commencer</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">
            <li>Pour répondre, le conseiller transmet ta question et des <strong>statistiques calculées</strong> (totaux, catégories, soldes, opérations demandées) au service d&apos;IA d&apos;Anthropic.</li>
            <li>Il n&apos;a aucun accès direct à ta base de données et ne peut rien modifier ni supprimer : il peut seulement te <strong>proposer</strong> une opération que tu confirmes toi-même.</li>
            <li>L&apos;historique de conversation n&apos;est pas enregistré par MONETA. Tu peux désactiver le conseiller à tout moment dans les paramètres.</li>
          </ul>
          <Button className="mt-4" loading={pending} onClick={() => start(async () => { const r = await savePreferencesAction({ privacy: { aiEnabled: true } }); if (!r.ok) return void toast.error(r.error); router.refresh(); })}>
            <Sparkles /> J&apos;ai compris, activer le conseiller
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Rendu Markdown minimal et sûr (aucun HTML injecté) : paragraphes, listes, gras. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={k + i}>{part.slice(2, -2)}</strong> : <span key={k + i}>{part}</span>));
  return (
    <div className="prose-chat">
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        return <p key={bi}>{lines.map((l, li) => <span key={li}>{inline(l.replace(/^#+\s*/, ""), `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "dismissed">("idle");
  if (state === "dismissed") return <p className="text-xs text-subtle">Proposition ignorée.</p>;
  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-subtle">Proposition — non enregistrée</p>
      <p className="mt-1 text-sm font-medium">{p.description}</p>
      <p className="text-sm text-muted">
        <span className={p.kind === "income" ? "text-positive" : ""}>{formatMoney(p.kind === "income" ? p.amount : -p.amount, undefined, { signed: true })}</span> · {formatDateFR(p.date)} · {p.accountName}
        {p.categoryName ? ` · ${p.categoryName}` : ""}
      </p>
      {state === "saved" ? (
        <p className="mt-2 flex items-center gap-1 text-sm text-positive"><Check className="size-4" /> Enregistrée</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            loading={state === "saving"}
            onClick={async () => {
              setState("saving");
              const r = await saveTransactionAction(null, { kind: p.kind, amount: String(p.amount / 100).replace(".", ","), accountId: p.accountId, categoryId: p.categoryId, date: p.date, description: p.description, status: "posted" }, "assistant");
              if (!r.ok) {
                setState("idle");
                return void toast.error(r.error);
              }
              setState("saved");
              toast.success("Opération enregistrée");
              router.refresh();
            }}
          >
            <Check /> Confirmer et enregistrer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState("dismissed")}><X /> Ignorer</Button>
        </div>
      )}
    </div>
  );
}

export function Chat({ name, initialQuestion }: { name: string; initialQuestion?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, loading]);
  const sentInitial = useRef(false);
  useEffect(() => {
    if (initialQuestion && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) setMessages((m) => [...m, { role: "assistant", content: data.error ?? "Erreur", error: true }]);
      else setMessages((m) => [...m, { role: "assistant", content: data.reply, proposals: data.proposals, tools: data.toolsUsed }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Connexion impossible. Vérifie ta connexion internet.", error: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60dvh] flex-col">
      {messages.length === 0 && (
        <div className="mb-6">
          <p className="text-lg font-medium">Bonjour {name}, que veux-tu savoir ?</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm transition hover:border-border-strong hover:bg-surface-2">{s}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex-1 space-y-4" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed", m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "border border-negative/30 bg-negative-soft" : "border border-border bg-surface")}>
              {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
              {m.proposals?.map((p, j) => <ProposalCard key={j} p={p} />)}
              {m.tools && m.tools.length > 0 && (
                <p className="mt-2 border-t border-border pt-2 text-[11px] text-subtle">Données consultées : {[...new Set(m.tools)].map((t) => TOOL_LABELS[t] ?? t).join(" · ")}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Je consulte tes données…</div>
        )}
        <div ref={endRef} />
      </div>
      <form className="sticky bottom-20 mt-6 lg:bottom-4" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface p-2 shadow-lg">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            maxLength={4000}
            placeholder="Est-ce que je dépense trop en restaurants ?"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-subtle"
            aria-label="Ta question"
          />
          <Button type="submit" size="icon" className="rounded-2xl" disabled={!input.trim() || loading} aria-label="Envoyer"><ArrowUp /></Button>
        </div>
      </form>
    </div>
  );
}
