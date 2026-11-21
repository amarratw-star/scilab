"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Link2, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { deleteDocumentAction, linkDocumentAction } from "@/app/actions/finance";
import { formatDateFR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

type Doc = { id: string; name: string; kind: string; kindLabel: string; mimeType: string; size: number; createdAt: string; transactionId: string | null; txDescription: string | null; txDate: string | null; txAmount: number | null };
type TxOpt = { id: string; label: string };

export function UploadPanel({ transactions, defaultTransaction }: { transactions: TxOpt[]; defaultTransaction?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("receipt");
  const [tx, setTx] = useState(defaultTransaction ?? "");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("kind", kind);
      if (tx) fd.set("transactionId", tx);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      res.ok ? toast.success(`« ${f.name} » ajouté`) : toast.error(`${f.name} : ${data.error ?? "erreur"}`);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  };
  return (
    <Card
      className={`border-dashed p-5 transition ${drag ? "border-info bg-info-soft" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm"><span className="mb-1.5 block text-[13px] font-medium">Type</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="receipt">Ticket de caisse</option><option value="invoice">Facture</option><option value="proof">Justificatif</option><option value="other">Document divers</option></Select>
        </label>
        <label className="text-sm"><span className="mb-1.5 block text-[13px] font-medium">Associer à une opération</span>
          <Select value={tx} onChange={(e) => setTx(e.target.value)}><option value="">Aucune</option>{transactions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
        </label>
        <Button loading={busy} onClick={() => input.current?.click()}><Upload /> Choisir des fichiers</Button>
      </div>
      <p className="mt-3 text-center text-xs text-subtle">…ou glisse-dépose tes fichiers ici</p>
      <input ref={input} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => upload(e.target.files)} />
    </Card>
  );
}

export function DocSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input defaultValue={sp.get("q") ?? ""} placeholder="Rechercher un document…" className="pl-9" onChange={(e) => { const p = new URLSearchParams(sp.toString()); e.target.value ? p.set("q", e.target.value) : p.delete("q"); router.replace(`/documents?${p}`); }} aria-label="Rechercher un document" />
    </div>
  );
}

export function DocumentGrid({ docs, transactions }: { docs: Doc[]; transactions: TxOpt[] }) {
  const router = useRouter();
  const highlight = useSearchParams().get("id");
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {docs.map((d) => (
        <Card key={d.id} className={`overflow-hidden ${highlight === d.id ? "ring-2 ring-info" : ""}`}>
          <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="flex h-40 items-center justify-center bg-surface-2">
            {d.mimeType.startsWith("image/") && d.mimeType !== "image/heic" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${d.id}`} alt={d.name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <FileText className="size-10 text-subtle" />
            )}
          </a>
          <div className="p-3">
            <p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
            <p className="text-xs text-subtle">{d.kindLabel} · {(d.size / 1024).toFixed(0)} Ko · {formatDateFR(d.createdAt.slice(0, 10))}</p>
            {d.transactionId ? (
              <Badge tone="info" className="mt-2 max-w-full truncate">{d.txDescription ?? "Opération"} · {d.txAmount !== null ? formatMoney(d.txAmount) : ""}</Badge>
            ) : (
              <Badge className="mt-2">Non associé</Badge>
            )}
            <div className="mt-3 flex gap-1">
              <Select aria-label="Associer" className="h-8 text-xs" value={d.transactionId ?? ""} onChange={async (e) => { const r = await linkDocumentAction(d.id, e.target.value || null); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); }}>
                <option value="">— Associer à…</option>
                {transactions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <Button asChild size="icon-sm" variant="ghost"><a href={`/api/documents/${d.id}?telecharger=1`} aria-label="Télécharger"><Download /></a></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Supprimer" onClick={async () => { if (!confirm(`Supprimer « ${d.name} » ?`)) return; const r = await deleteDocumentAction(d.id); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); }}><Trash2 /></Button>
            </div>
          </div>
        </Card>
      ))}
      <span className="hidden"><Link2 /></span>
    </div>
  );
}
