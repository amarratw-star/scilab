"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, ImageUp, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/misc";
import { useRefData } from "@/components/app/app-shell";
import { parseReceiptText, type ReceiptExtraction } from "@/lib/receipt-parser";
import { suggestCategoryName } from "@/lib/csv-import";
import { saveTransactionAction } from "@/app/actions/finance";
import { centsToInput, formatMoney } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";

type Conf = "high" | "medium" | "low" | "none";
const CONF: Record<Conf, { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  high: { label: "Fiable", tone: "positive" },
  medium: { label: "À vérifier", tone: "warning" },
  low: { label: "Incertain", tone: "negative" },
  none: { label: "Non trouvé", tone: "neutral" },
};

export function Scanner({ cloudAvailable, cloudAllowed }: { cloudAvailable: boolean; cloudAllowed: boolean }) {
  const { accounts, categories, today } = useRefData();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{ merchant: Conf; date: Conf; total: Conf; items: { label: string; amount: number }[]; raw?: string } | null>(null);
  const [form, setForm] = useState({ merchant: "", date: today, amount: "", categoryId: "", accountId: accounts.find((a) => a.type === "checking")?.id ?? accounts[0]?.id ?? "" });
  const [saving, setSaving] = useState(false);
  const [attach, setAttach] = useState(true);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const applyCategory = (merchant: string, suggested?: string | null) => {
    const name = suggested ?? suggestCategoryName(merchant, false);
    const c = name ? categories.find((x) => x.kind === "expense" && x.name.toLowerCase() === name.toLowerCase()) : undefined;
    return c?.id ?? "";
  };

  const analyzeLocal = async (f: File) => {
    setStatus("Lecture du ticket sur ton appareil (OCR local)…");
    const Tesseract = (await import("tesseract.js")).default;
    const { data } = await Tesseract.recognize(f, "fra", { logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && setStatus(`Lecture du ticket… ${Math.round(m.progress * 100)} %`) });
    const r: ReceiptExtraction = parseReceiptText(data.text);
    setExtraction({ merchant: r.merchant.confidence, date: r.date.confidence, total: r.total.confidence, items: r.items, raw: r.rawText });
    setForm((s) => ({ ...s, merchant: r.merchant.value ?? "", date: r.date.value ?? today, amount: r.total.value ? centsToInput(r.total.value) : "", categoryId: applyCategory(r.merchant.value ?? "") }));
  };

  const analyzeCloud = async (f: File) => {
    setStatus("Analyse du ticket par l'IA…");
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch("/api/receipt", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const conf: Conf = data.confidence ?? "low";
    setExtraction({ merchant: data.merchant ? conf : "none", date: data.date && isValidISODate(data.date) ? conf : "none", total: data.total_euros ? conf : "none", items: (data.items ?? []).map((i: { label: string; amount_euros: number }) => ({ label: i.label, amount: Math.round(i.amount_euros * 100) })) });
    setForm((s) => ({ ...s, merchant: data.merchant ?? "", date: data.date && isValidISODate(data.date) ? data.date : today, amount: data.total_euros ? String(data.total_euros).replace(".", ",") : "", categoryId: applyCategory(data.merchant ?? "", data.suggested_category) }));
    if (data.notes) toast.info(data.notes);
  };

  const onFile = async (f: File | undefined, mode: "local" | "cloud") => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return void toast.error("Choisis une image (photo du ticket).");
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setExtraction(null);
    try {
      if (mode === "cloud") await analyzeCloud(f);
      else await analyzeLocal(f);
    } catch (e) {
      toast.error(`Analyse impossible : ${(e as Error).message || "erreur"}. Tu peux saisir les informations manuellement.`);
      setExtraction({ merchant: "none", date: "none", total: "none", items: [] });
    } finally {
      setStatus(null);
    }
  };

  const save = async () => {
    setSaving(true);
    const r = await saveTransactionAction(null, { kind: "expense", amount: form.amount, accountId: form.accountId, categoryId: form.categoryId || null, date: form.date, merchant: form.merchant, description: form.merchant ? `Ticket ${form.merchant}` : "Ticket de caisse", paymentMethod: "card", status: "posted" }, "ocr");
    if (!r.ok) {
      setSaving(false);
      return void toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
    }
    if (attach && file) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", "receipt");
      fd.set("transactionId", r.data!.id);
      const up = await fetch("/api/documents", { method: "POST", body: fd });
      if (!up.ok) toast.warning("Dépense enregistrée, mais le justificatif n'a pas pu être joint.");
    }
    setSaving(false);
    toast.success("Dépense enregistrée");
    router.push("/transactions");
  };

  const mode: "local" | "cloud" = cloudAvailable && cloudAllowed ? "cloud" : "local";
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><div><CardTitle>1. Photo du ticket</CardTitle><CardDescription>{mode === "cloud" ? "Analyse par l'IA (activée dans tes paramètres)." : "Analyse locale : l'image ne quitte pas ton appareil pendant la lecture."}</CardDescription></div></CardHeader>
        <CardContent>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Ticket" className="max-h-[420px] w-full rounded-2xl object-contain bg-surface-2" />
          ) : (
            <div className="flex h-60 items-center justify-center rounded-2xl border border-dashed border-border-strong text-sm text-muted">Aucune image</div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"><Camera className="size-4" /> Prendre une photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0], mode)} /></label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2"><ImageUp className="size-4" /> Importer une image<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0], mode)} /></label>
          </div>
          {status && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> {status}</p>}
          {cloudAvailable && !cloudAllowed && <p className="mt-3 flex items-start gap-1.5 text-xs text-subtle"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> Une analyse plus précise par IA (l&apos;image est alors envoyée à Anthropic) peut être activée dans Paramètres → Confidentialité.</p>}
          {mode === "cloud" && <p className="mt-3 flex items-start gap-1.5 text-xs text-subtle"><Sparkles className="mt-0.5 size-3.5 shrink-0" /> L&apos;image est envoyée au service d&apos;IA d&apos;Anthropic pour l&apos;analyse.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>2. Vérifier et corriger</CardTitle><CardDescription>Chaque champ indique son niveau de confiance.</CardDescription></div></CardHeader>
        <CardContent className="space-y-4">
          {!extraction ? <p className="text-sm text-muted">Les informations extraites apparaîtront ici.</p> : (
            <>
              {(extraction.total !== "high" || extraction.date === "none") && <Callout tone="warning" title="Informations incertaines">Vérifie le montant et la date avant d&apos;enregistrer.</Callout>}
              <Field label={<span className="flex items-center gap-2">Commerçant <Badge tone={CONF[extraction.merchant].tone}>{CONF[extraction.merchant].label}</Badge></span>} htmlFor="smerch"><Input id="smerch" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={<span className="flex items-center gap-2">Date <Badge tone={CONF[extraction.date].tone}>{CONF[extraction.date].label}</Badge></span>} htmlFor="sdate"><Input id="sdate" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                <Field label={<span className="flex items-center gap-2">Total <Badge tone={CONF[extraction.total].tone}>{CONF[extraction.total].label}</Badge></span>} htmlFor="samount"><Input id="samount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Catégorie proposée" htmlFor="scat"><Select id="scat" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Sans catégorie</option>{categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.parentId ? "↳ " : ""}{c.name}</option>)}</Select></Field>
                <Field label="Compte" htmlFor="sacc"><Select id="sacc" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
              </div>
              {extraction.items.length > 0 && (
                <details className="rounded-xl border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{extraction.items.length} article(s) identifié(s)</summary>
                  <ul className="mt-2 space-y-1">{extraction.items.map((i, k) => <li key={k} className="flex justify-between"><span className="truncate">{i.label}</span><span className="tabular">{formatMoney(i.amount)}</span></li>)}</ul>
                </details>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="size-4" /> Joindre la photo comme justificatif</label>
              <Button className="w-full" loading={saving} onClick={save}>Enregistrer la dépense</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
