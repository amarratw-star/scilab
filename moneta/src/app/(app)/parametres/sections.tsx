"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BellRing, Check, Download, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { IconBadge, ICONS } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/ui/confirm";
import { changePasswordAction, deleteMyAccountAction, loadDemoDataAction, revokeSessionAction, saveProfileAction, savePreferencesAction, savePushSubscriptionAction, wipeDataAction } from "@/app/actions/account";
import { deleteCategoryAction, reorderCategoriesAction, saveCategoryAction } from "@/app/actions/finance";
import { centsToInput } from "@/lib/money";
import type { UserSettings } from "@/server/db/schema";

type Cat = { id: string; name: string; kind: "expense" | "income"; parentId: string | null; icon: string; color: string; isFixed: boolean };
type Props = {
  user: { displayName: string; email: string; isDemo: boolean; hasDemoData: boolean; currency: string; timezone: string; settings: UserSettings };
  prefs: Record<string, boolean>;
  prefLabels: Record<string, string>;
  sessions: { id: string; current: boolean; userAgent: string | null; ip: string | null; lastSeenAt: string; createdAt: string }[];
  categories: Cat[];
  features: { ai: boolean; push: boolean; email: boolean; bank: boolean };
  vapidKey: string | null;
};

const TIMEZONES = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "Europe/Monaco", "Europe/London", "Europe/Madrid", "Europe/Berlin", "America/Montreal", "America/Guadeloupe", "America/Martinique", "Indian/Reunion", "Indian/Mayotte", "America/Cayenne", "Pacific/Noumea", "Pacific/Tahiti", "Africa/Casablanca", "Africa/Dakar", "Africa/Abidjan", "UTC"];
const SECTIONS = [["profil", "Profil"], ["apparence", "Apparence"], ["tableau-de-bord", "Tableau de bord"], ["notifications", "Notifications"], ["categories", "Catégories"], ["confidentialite", "Confidentialité et IA"], ["securite", "Sécurité"], ["donnees", "Mes données"], ["integrations", "Intégrations"]];
const DASH = [["actions", "Actions rapides"], ["kpis", "Indicateurs clés"], ["chart", "Graphique principal"], ["available", "Combien puis-je dépenser"], ["summary", "Ton mois en bref"], ["alerts", "Alertes"], ["categories", "Répartition par catégorie"], ["budgets", "Budgets"], ["recent", "Dernières opérations"], ["upcoming", "Prochains prélèvements"]];

function useDone() {
  const router = useRouter();
  return (r: { ok: boolean; message?: string; error?: string }) => {
    r.ok ? toast.success(r.message ?? "Enregistré") : toast.error(r.error);
    router.refresh();
  };
}

export function SettingsSections(p: Props) {
  return (
    <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
      <nav className="hidden lg:block" aria-label="Sections des paramètres">
        <ul className="sticky top-24 space-y-1 text-sm">
          {SECTIONS.map(([id, l]) => <li key={id}><a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-foreground">{l}</a></li>)}
        </ul>
      </nav>
      <div className="space-y-6">
        <Profile {...p} />
        <Appearance />
        <Dashboard hidden={p.user.settings.dashboard?.hidden ?? []} />
        <Notifications {...p} />
        <Categories categories={p.categories} />
        <Privacy settings={p.user.settings} ai={p.features.ai} />
        <Security sessions={p.sessions} isDemo={p.user.isDemo} />
        <Data {...p} />
        <Integrations features={p.features} />
      </div>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader><div><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Profile({ user }: Props) {
  const done = useDone();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Section id="profil" title="Profil et préférences financières" description={user.email}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.currentTarget));
          start(async () => {
            const r = await saveProfileAction(fd);
            setErrors(r.ok ? {} : r.fieldErrors ?? {});
            done(r);
          });
        }}
      >
        <Field label="Prénom" htmlFor="pname" error={errors.displayName}><Input id="pname" name="displayName" defaultValue={user.displayName} required maxLength={60} /></Field>
        <Field label="Devise" htmlFor="pcur" hint="Les montants sont affichés dans cette devise (pas de conversion).">
          <Select id="pcur" name="currency" defaultValue={user.currency}>{["EUR", "CHF", "GBP", "USD", "CAD", "XOF", "XPF", "MAD"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Fuseau horaire" htmlFor="ptz" error={errors.timezone} hint="Détermine la « date du jour » pour tous les calculs.">
          <Select id="ptz" name="timezone" defaultValue={user.timezone}>{(TIMEZONES.includes(user.timezone) ? TIMEZONES : [user.timezone, ...TIMEZONES]).map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        </Field>
        <Field label="Langue" htmlFor="plang" hint="Le français est la seule langue disponible pour l'instant."><Select id="plang" disabled defaultValue="fr"><option value="fr">Français</option></Select></Field>
        <Field label="Coussin de sécurité (€)" htmlFor="pcush" error={errors.safetyCushion} hint="Montant à toujours conserver sur tes comptes disponibles."><Input id="pcush" name="safetyCushion" inputMode="decimal" defaultValue={centsToInput(user.settings.safetyCushion ?? 0)} /></Field>
        <Field label="Objectif d'épargne mensuel (€)" htmlFor="psave" error={errors.monthlySavingsTarget} hint="Préservé dans le calcul « Combien puis-je dépenser ? »."><Input id="psave" name="monthlySavingsTarget" inputMode="decimal" defaultValue={centsToInput(user.settings.monthlySavingsTarget ?? 0)} /></Field>
        <div className="sm:col-span-2"><Button type="submit" loading={pending}>Enregistrer</Button></div>
      </form>
    </Section>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <Section id="apparence" title="Apparence">
      <Segmented value={(theme ?? "system") as "light" | "dark" | "system"} onChange={setTheme} options={[{ value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }, { value: "system", label: "Système" }]} />
    </Section>
  );
}

function Dashboard({ hidden }: { hidden: string[] }) {
  const done = useDone();
  const [h, setH] = useState(new Set(hidden));
  return (
    <Section id="tableau-de-bord" title="Personnaliser le tableau de bord" description="Choisis les blocs affichés.">
      <div className="grid gap-2 sm:grid-cols-2">
        {DASH.map(([k, l]) => (
          <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
            {l}
            <Switch
              checked={!h.has(k)}
              onCheckedChange={async (v) => {
                const next = new Set(h);
                v ? next.delete(k) : next.add(k);
                setH(next);
                done(await savePreferencesAction({ dashboard: { hidden: [...next] } }));
              }}
            />
          </label>
        ))}
      </div>
    </Section>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function Notifications({ prefs, prefLabels, features, vapidKey }: Props) {
  const done = useDone();
  const [state, setState] = useState(prefs);
  const enablePush = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return void toast.error("Ton navigateur ne prend pas en charge les notifications push.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return void toast.error("Permission refusée.");
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey!) });
    done(await savePushSubscriptionAction(sub.toJSON()));
  };
  return (
    <Section id="notifications" title="Notifications" description="Affichées dans l'application ; envoyées en push si tu l'actives sur cet appareil.">
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(prefLabels).map(([k, l]) => (
          <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
            {l}
            <Switch checked={state[k]} onCheckedChange={async (v) => { setState({ ...state, [k]: v }); done(await savePreferencesAction({ notifications: { [k]: v } })); }} />
          </label>
        ))}
      </div>
      <div className="mt-4">
        {features.push && vapidKey ? <Button variant="outline" onClick={() => enablePush().catch((e) => toast.error(String(e)))}><BellRing /> Activer les notifications push sur cet appareil</Button> : <p className="text-xs text-subtle">Notifications push non configurées sur ce serveur (clés VAPID absentes). Les notifications restent visibles dans l&apos;application.</p>}
      </div>
    </Section>
  );
}

function Categories({ categories }: { categories: Cat[] }) {
  const done = useDone();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = categories.filter((c) => c.kind === kind);
  const parents = list.filter((c) => !c.parentId);
  const move = async (id: string, dir: -1 | 1) => {
    const ids = parents.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    done(await reorderCategoriesAction(ids));
  };
  return (
    <Section id="categories" title="Catégories" description="Ajoute, renomme, réorganise ou supprime. Une catégorie « fixe » compte dans les charges fixes.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: "Dépenses" }, { value: "income", label: "Revenus" }]} />
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> Nouvelle catégorie</Button>
      </div>
      {adding && <CategoryEditor kind={kind} parents={parents} onDone={() => setAdding(false)} />}
      <ul className="divide-y divide-border">
        {parents.map((c, idx) => (
          <li key={c.id} className="py-2">
            {editing === c.id ? <CategoryEditor kind={kind} parents={parents} initial={c} onDone={() => setEditing(null)} /> : <CatRow c={c} first={idx === 0} last={idx === parents.length - 1} onMove={move} onEdit={() => setEditing(c.id)} all={list} />}
            <ul className="ml-10 divide-y divide-border">
              {list.filter((x) => x.parentId === c.id).map((s) => (
                <li key={s.id} className="py-1.5">{editing === s.id ? <CategoryEditor kind={kind} parents={parents} initial={s} onDone={() => setEditing(null)} /> : <CatRow c={s} onEdit={() => setEditing(s.id)} all={list} />}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CatRow({ c, first, last, onMove, onEdit, all }: { c: Cat; first?: boolean; last?: boolean; onMove?: (id: string, d: -1 | 1) => void; onEdit: () => void; all: Cat[] }) {
  const done = useDone();
  const [replacement, setReplacement] = useState("");
  return (
    <div className="flex items-center gap-2">
      <IconBadge icon={c.icon} color={c.color} size="sm" />
      <span className="flex-1 truncate text-sm">{c.name} {c.isFixed && <Badge>Fixe</Badge>}</span>
      {onMove && (
        <>
          <Button size="icon-sm" variant="ghost" disabled={first} onClick={() => onMove(c.id, -1)} aria-label="Monter"><ArrowUp /></Button>
          <Button size="icon-sm" variant="ghost" disabled={last} onClick={() => onMove(c.id, 1)} aria-label="Descendre"><ArrowDown /></Button>
        </>
      )}
      <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="Modifier"><Pencil /></Button>
      <ConfirmDialog
        trigger={<Button size="icon-sm" variant="ghost" aria-label="Supprimer"><Trash2 /></Button>}
        title={`Supprimer « ${c.name} » ?`}
        description="Les opérations et échéances de cette catégorie (et de ses sous-catégories) seront déplacées vers la catégorie choisie ci-dessous, ou deviendront non catégorisées. Les budgets associés seront supprimés."
        onConfirm={async () => done(await deleteCategoryAction(c.id, replacement || null))}
      >
        <Select aria-label="Catégorie de remplacement" className="mt-3" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
          <option value="">Non catégorisé</option>
          {all.filter((x) => x.id !== c.id && x.parentId !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </ConfirmDialog>
    </div>
  );
}

function CategoryEditor({ kind, parents, initial, onDone }: { kind: "expense" | "income"; parents: Cat[]; initial?: Cat; onDone: () => void }) {
  const done = useDone();
  const [pending, start] = useTransition();
  return (
    <form
      className="my-2 grid gap-2 rounded-2xl border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_110px_90px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.currentTarget));
        start(async () => {
          const r = await saveCategoryAction(initial?.id ?? null, { ...fd, kind, isFixed: fd.isFixed === "on" });
          done(r);
          if (r.ok) onDone();
        });
      }}
    >
      <Input name="name" defaultValue={initial?.name} placeholder="Nom" required maxLength={60} aria-label="Nom" />
      <Select name="parentId" defaultValue={initial?.parentId ?? ""} aria-label="Catégorie parente">
        <option value="">Catégorie principale</option>
        {parents.filter((x) => x.id !== initial?.id).map((x) => <option key={x.id} value={x.id}>Sous-catégorie de {x.name}</option>)}
      </Select>
      <Select name="icon" defaultValue={initial?.icon ?? "tag"} aria-label="Icône">{Object.keys(ICONS).map((k) => <option key={k} value={k}>{k}</option>)}</Select>
      <Input name="color" type="color" defaultValue={initial?.color ?? "#64748b"} className="h-10 p-1" aria-label="Couleur" />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isFixed" defaultChecked={initial?.isFixed} /> Fixe</label>
        <Button type="submit" size="icon-sm" loading={pending} aria-label="Valider"><Check /></Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onDone} aria-label="Annuler"><X /></Button>
      </div>
    </form>
  );
}

function Privacy({ settings, ai }: { settings: UserSettings; ai: boolean }) {
  const done = useDone();
  return (
    <Section id="confidentialite" title="Confidentialité et IA" description={<>Tes données ne sont jamais vendues ni utilisées à des fins publicitaires. <Link href="/confidentialite" className="text-info hover:underline">Politique de confidentialité</Link></>}>
      <div className="space-y-3">
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-3 text-sm">
          <span><span className="font-medium">Conseiller IA</span><span className="block text-xs text-muted">Envoie tes questions et des statistiques calculées au service d&apos;IA d&apos;Anthropic pour y répondre.{!ai && " (Non configuré sur ce serveur.)"}</span></span>
          <Switch checked={Boolean(settings.privacy?.aiEnabled)} disabled={!ai} onCheckedChange={async (v) => done(await savePreferencesAction({ privacy: { aiEnabled: v } }))} />
        </label>
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-3 text-sm">
          <span><span className="font-medium">Analyse des tickets par IA</span><span className="block text-xs text-muted">Plus précise que la lecture locale, mais l&apos;image du ticket est envoyée à Anthropic. Désactivée : la lecture se fait sur ton appareil.</span></span>
          <Switch checked={Boolean(settings.privacy?.ocrCloudEnabled)} disabled={!ai} onCheckedChange={async (v) => done(await savePreferencesAction({ privacy: { ocrCloudEnabled: v } }))} />
        </label>
      </div>
    </Section>
  );
}

function Security({ sessions, isDemo }: { sessions: Props["sessions"]; isDemo: boolean }) {
  const done = useDone();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fmt = (d: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
  return (
    <Section id="securite" title="Sécurité" description="Mot de passe et sessions ouvertes.">
      {!isDemo && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            start(async () => {
              const r = await changePasswordAction({ current: String(fd.get("current")), next: String(fd.get("next")) });
              setErrors(r.ok ? {} : r.fieldErrors ?? {});
              if (r.ok) form.reset();
              done(r);
            });
          }}
        >
          <Field label="Mot de passe actuel" htmlFor="cur" error={errors.current}><Input id="cur" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="Nouveau mot de passe" htmlFor="nxt" error={errors._form}><Input id="nxt" name="next" type="password" autoComplete="new-password" required minLength={10} /></Field>
          <Button type="submit" loading={pending}>Modifier</Button>
        </form>
      )}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Sessions actives</p>{sessions.length > 1 && <Button size="sm" variant="outline" onClick={async () => done(await revokeSessionAction("others"))}><LogOut /> Déconnecter les autres</Button>}</div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate">{s.userAgent ?? "Navigateur inconnu"}</span><span className="text-xs text-subtle">IP {s.ip ?? "?"} · dernière activité {fmt(s.lastSeenAt)}</span></span>
              {s.current ? <Badge tone="positive">Cette session</Badge> : <Button size="sm" variant="ghost" onClick={async () => done(await revokeSessionAction(s.id))}>Déconnecter</Button>}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Data({ user }: Props) {
  const done = useDone();
  const router = useRouter();
  const [password, setPassword] = useState("");
  return (
    <Section id="donnees" title="Mes données" description="Accès, portabilité et suppression (RGPD).">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="text-sm"><span className="font-medium">Exporter toutes mes données</span><span className="block text-xs text-muted">Fichier JSON complet : profil, comptes, opérations, budgets, objectifs, documents, journal d&apos;activité.</span></span>
          <Button asChild variant="outline"><a href="/api/export/data"><Download /> Exporter (JSON)</a></Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="text-sm"><span className="font-medium">{user.hasDemoData ? "Supprimer les données de démonstration" : "Vider mon espace"}</span><span className="block text-xs text-muted">Supprime tous les comptes, opérations, budgets, objectifs et documents. Les catégories sont conservées. Ton compte reste actif.</span></span>
          <ConfirmDialog trigger={<Button variant="outline">{user.hasDemoData ? "Supprimer les données fictives" : "Tout effacer"}</Button>} title="Démarrer avec un espace vide ?" description="Toutes tes données financières seront définitivement supprimées." confirmLabel="Tout supprimer" onConfirm={async () => { done(await wipeDataAction(true)); router.push("/"); }} />
        </div>
        {!user.hasDemoData && !user.isDemo && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <span className="text-sm"><span className="font-medium">Charger des données de démonstration</span><span className="block text-xs text-muted">Uniquement possible dans un espace vide. Les données fictives sont signalées partout.</span></span>
            <Button variant="outline" onClick={async () => done(await loadDemoDataAction())}>Charger</Button>
          </div>
        )}
        <div className="rounded-xl border border-negative/30 bg-negative-soft p-3">
          <p className="text-sm font-medium text-negative">Supprimer définitivement mon compte</p>
          <p className="text-xs text-muted">Ton compte et toutes tes données sont effacés immédiatement et de manière irréversible. Pense à exporter tes données avant.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!user.isDemo && <Input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-60" aria-label="Mot de passe" autoComplete="current-password" />}
            <ConfirmDialog trigger={<Button variant="destructive" disabled={!user.isDemo && !password}><Trash2 /> Supprimer mon compte</Button>} title="Supprimer ton compte ?" description="Cette action est irréversible." confirmLabel="Supprimer définitivement" onConfirm={async () => { const r = await deleteMyAccountAction(password); if (r && !r.ok) toast.error(r.error); }} />
          </div>
        </div>
      </div>
    </Section>
  );
}

function Integrations({ features }: { features: Props["features"] }) {
  const rows: [string, boolean, string][] = [
    ["Conseiller IA (Anthropic)", features.ai, "ANTHROPIC_API_KEY"],
    ["E-mails (réinitialisation du mot de passe)", features.email, "SMTP_HOST, SMTP_FROM…"],
    ["Notifications push", features.push, "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY"],
    ["Connexion bancaire DSP2 (Powens)", features.bank, "POWENS_DOMAIN, POWENS_CLIENT_ID, POWENS_CLIENT_SECRET"],
  ];
  return (
    <Section id="integrations" title="Intégrations" description="Configurées par l'administrateur du serveur via les variables d'environnement.">
      <ul className="divide-y divide-border text-sm">
        {rows.map(([l, ok, vars]) => (
          <li key={l} className="flex items-center justify-between gap-3 py-2.5">
            <span>{l}<span className="block text-xs text-subtle">{vars}</span></span>
            <Badge tone={ok ? "positive" : "neutral"}>{ok ? "Configuré" : "Non configuré"}</Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}
