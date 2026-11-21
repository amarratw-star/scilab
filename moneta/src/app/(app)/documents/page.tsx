import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { FolderOpen } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { listDocuments, DOC_KINDS } from "@/server/services/documents";
import * as s from "@/server/db/schema";
import { formatMoneyPlain } from "@/lib/money";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { DocumentGrid, UploadPanel, DocSearch } from "./documents-ui";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const txFilter = sp.transaction && /^[0-9a-f-]{36}$/i.test(sp.transaction) ? sp.transaction : undefined;
  const { docs, txs } = await runAsUser(user, async (ctx) => ({
    docs: await listDocuments(ctx, sp.q, txFilter),
    txs: await ctx.tx.select({ id: s.transactions.id, date: s.transactions.date, amount: s.transactions.amount, kind: s.transactions.kind, label: s.transactions.description, merchant: s.transactions.merchant }).from(s.transactions).orderBy(desc(s.transactions.date)).limit(150),
  }));
  const txOptions = txs.map((t) => ({ id: t.id, label: `${t.date.split("-").reverse().join("/")} · ${t.merchant || t.label || "Opération"} · ${formatMoneyPlain(t.amount)}` }));
  const docsView = docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), kindLabel: DOC_KINDS[d.kind] ?? d.kind }));
  return (
    <div>
      <PageHeader title="Documents et justificatifs" description="Tickets, factures, reçus — stockés de façon privée, associables à tes opérations. JPEG, PNG, WebP, HEIC ou PDF, 8 Mo maximum." />
      <UploadPanel transactions={txOptions} defaultTransaction={txFilter} />
      <div className="mt-6"><DocSearch /></div>
      {docsView.length === 0 ? (
        <EmptyState className="mt-6" icon={<FolderOpen />} title={txFilter ? "Aucun justificatif pour cette opération" : "Aucun document"} description="Ajoute un justificatif ci-dessus. Pour extraire automatiquement les informations d'un ticket, utilise le scanner." />
      ) : (
        <DocumentGrid docs={docsView} transactions={txOptions} />
      )}
    </div>
  );
}
