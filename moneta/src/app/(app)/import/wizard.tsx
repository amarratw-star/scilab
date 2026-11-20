"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRefData } from "@/components/app/app-shell";
import { extractRows, guessMapping, parseCsvText, suggestCategoryName, type ColumnMapping, type ParsedCsv } from "@/lib/csv-import";
import { checkImportDuplicatesAction, importCsvAction } from "@/app/actions/finance";
import { formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";

type Row = { index: number; date: string; label: string; amount: number; categoryId: string | null; include: boolean; status: "new" | "imported" | "in_file" | "possible" };

const ROLES: [keyof ColumnMapping, string][] = [
  ["date", "Date"],
  ["label", "Libellé"],
  ["amount", "Montant (signé)"],
  ["debit", "Débit"],
  ["credit", "Crédit"],
  ["account", "Compte (info)"],
  ["category", "Catégorie (info)"],
];

export function ImportWizard() {
  const { accounts, categories } = useRefData();
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const extracted = useMemo(() => (csv && mapping ? extractRows(csv, mapping) : []), [csv, mapping]);
  const valid = extracted.filter((r) => r.errors.length === 0);
  const invalid = extracted.length - valid.length;

  if (!accounts.length) return <p className="text-sm text-muted">Crée d&apos;abord un compte dans lequel importer les opérations.</p>;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return void toast.error("Fichier trop volumineux (5 Mo maximum).");
    let text = await f.text();
    if (text.includes("�")) {
      // Repli : beaucoup de banques françaises exportent en Windows-1252
      text = new TextDecoder("windows-1252").decode(await f.arrayBuffer());
    }
    const parsed = parseCsvText(text);
    if (!parsed.headers.length || !parsed.rows.length) return void toast.error("Fichier vide ou illisible.");
    setCsv(parsed);
    setFileName(f.name);
    setMapping(guessMapping(parsed));
    setRows(null);
    setResult(null);
  };

  const preview = async () => {
    setBusy(true);
    const base = valid.map((r) => ({ date: r.date!, label: r.label.slice(0, 200), amount: r.amount! }));
    const dup = await checkImportDuplicatesAction(accountId, base);
    setBusy(false);
    if (!dup.ok) return void toast.error(dup.error);
    setRows(
      valid.map((r, i) => {
        const isIncome = (r.amount ?? 0) > 0;
        const fromCsv = r.categoryLabel ? categories.find((c) => c.name.toLowerCase() === r.categoryLabel!.toLowerCase()) : undefined;
        const suggested = suggestCategoryName(r.label, isIncome);
        const cat = fromCsv ?? categories.find((c) => c.name === suggested && c.kind === (isIncome ? "income" : "expense"));
        const status = dup.data![i].status;
        return { index: r.index, date: r.date!, label: r.label.slice(0, 200), amount: r.amount!, categoryId: cat?.id ?? null, include: status === "new" || status === "possible", status };
      }),
    );
  };

  const doImport = async () => {
    if (!rows) return;
    setBusy(true);
    const r = await importCsvAction({ accountId, rows: rows.map(({ date, label, amount, categoryId, include }) => ({ date, label, amount, categoryId, include })) });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setResult(r.data!);
    toast.success(`${r.data!.imported} opération(s) importée(s)`);
    router.refresh();
  };

  if (result)
    return (
      <Card className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-positive" />
        <p className="mt-3 text-lg font-semibold">{result.imported} opération(s) importée(s)</p>
        <p className="text-sm text-muted">{result.skipped} doublon(s) ignoré(s).</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => router.push("/transactions")}>Voir les opérations</Button>
          <Button variant="outline" onClick={() => { setCsv(null); setRows(null); setResult(null); }}>Importer un autre fichier</Button>
        </div>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><div><CardTitle>1. Fichier et compte</CardTitle><CardDescription>Formats acceptés : CSV (séparateur ; , ou tabulation), encodage UTF-8 ou Windows-1252.</CardDescription></div></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Compte de destination" htmlFor="iacc">
            <Select id="iacc" value={accountId} onChange={(e) => { setAccountId(e.target.value); setRows(null); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border-strong p-4 text-sm text-muted hover:bg-surface-2">
            <FileUp className="size-5" />
            {fileName ? <span className="font-medium text-foreground">{fileName}</span> : "Choisir un fichier CSV"}
            <input type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </CardContent>
      </Card>

      {csv && mapping && (
        <Card>
          <CardHeader><div><CardTitle>2. Correspondance des colonnes</CardTitle><CardDescription>Détectée automatiquement — vérifie et corrige si besoin. Utilise soit « Montant », soit « Débit » + « Crédit ».</CardDescription></div></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {ROLES.map(([role, label]) => (
                <Field key={role} label={label} htmlFor={`map-${role}`}>
                  <Select id={`map-${role}`} value={mapping[role] ?? ""} onChange={(e) => { setMapping({ ...mapping, [role]: e.target.value === "" ? null : Number(e.target.value) }); setRows(null); }}>
                    <option value="">—</option>
                    {csv.headers.map((h, i) => <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="bg-surface-2 text-left"><tr><th className="p-2">Date</th><th className="p-2">Libellé</th><th className="p-2 text-right">Montant</th><th className="p-2">Contrôle</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {extracted.slice(0, 6).map((r) => (
                    <tr key={r.index}><td className="p-2">{r.date ? formatDateFR(r.date) : "?"}</td><td className="p-2">{r.label}</td><td className={`tabular p-2 text-right ${(r.amount ?? 0) > 0 ? "text-positive" : ""}`}>{r.amount === null ? "?" : formatMoney(r.amount, "EUR", { signed: true })}</td><td className="p-2">{r.errors.length ? <span className="text-negative">{r.errors.join(", ")}</span> : <span className="text-positive">OK</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">{extracted.length} ligne(s) lue(s), {valid.length} valide(s){invalid ? `, ${invalid} ignorée(s) (date ou montant invalide)` : ""}.</p>
            <Button className="mt-4" disabled={!valid.length} loading={busy} onClick={preview}>Prévisualiser l&apos;import</Button>
          </CardContent>
        </Card>
      )}

      {rows && (
        <Card>
          <CardHeader>
            <div><CardTitle>3. Aperçu et catégories</CardTitle><CardDescription>{rows.filter((r) => r.include).length} opération(s) sélectionnée(s) · {rows.filter((r) => r.status === "imported" || r.status === "in_file").length} doublon(s) exclu(s)</CardDescription></div>
            <Button loading={busy} disabled={!rows.some((r) => r.include)} onClick={doImport}>Importer</Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-subtle"><tr><th className="w-8 pb-2"><input type="checkbox" aria-label="Tout sélectionner" checked={rows.every((r) => r.include)} onChange={(e) => setRows(rows.map((r) => ({ ...r, include: r.status === "imported" || r.status === "in_file" ? false : e.target.checked })))} /></th><th className="pb-2">Date</th><th className="pb-2">Libellé</th><th className="pb-2 text-right">Montant</th><th className="pb-2 pl-3">Catégorie</th><th className="pb-2">État</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={r.index} className={r.include ? "" : "opacity-50"}>
                    <td className="py-1.5"><input type="checkbox" checked={r.include} disabled={r.status === "imported" || r.status === "in_file"} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} aria-label="Inclure" /></td>
                    <td className="py-1.5 whitespace-nowrap">{formatDateFR(r.date)}</td>
                    <td className="max-w-64 truncate py-1.5" title={r.label}>{r.label}</td>
                    <td className={`tabular py-1.5 text-right ${r.amount > 0 ? "text-positive" : ""}`}>{formatMoney(r.amount, "EUR", { signed: true })}</td>
                    <td className="py-1.5 pl-3">
                      <Select aria-label="Catégorie" className="h-8 text-xs" value={r.categoryId ?? ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, categoryId: e.target.value || null } : x)))}>
                        <option value="">Non catégorisé</option>
                        {categories.filter((c) => c.kind === (r.amount > 0 ? "income" : "expense")).map((c) => <option key={c.id} value={c.id}>{c.parentId ? "↳ " : ""}{c.name}</option>)}
                      </Select>
                    </td>
                    <td className="py-1.5">{r.status === "new" ? <Badge tone="positive">Nouvelle</Badge> : r.status === "possible" ? <Badge tone="warning">Doublon possible</Badge> : r.status === "imported" ? <Badge>Déjà importée</Badge> : <Badge>En double dans le fichier</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">« Doublon possible » : une opération du même montant existe déjà ce jour-là sur ce compte (saisie manuelle ?). Décoche-la si c&apos;est la même.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
