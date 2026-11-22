/**
 * Client de l'API Powens v2.0 — endpoints vérifiés dans la documentation officielle (docs.powens.com) :
 *   POST /2.0/auth/init                         { client_id, client_secret } → { auth_token, type, id_user }
 *   GET  /2.0/auth/token/code                   → { code, type, access, expires_in }
 *   GET  /2.0/connectors                        → { connectors: [...] }
 *   GET  /2.0/users/me/connections?expand=connector
 *   GET  /2.0/users/me/connections/{id}?expand=connector
 *   PUT  /2.0/users/me/connections/{id}         (demande de synchronisation)
 *   DELETE /2.0/users/me/connections/{id}       (suppression définitive côté Powens)
 *   DELETE /2.0/users/me                        (suppression de l'utilisateur Powens : effacement du compte MONETA)
 *   GET  /2.0/users/me/connections/{id}/accounts?all
 *   GET  /2.0/users/me/transactions?limit=…&last_update=…&all   (limit obligatoire, ≤ 1000 ; pagination _links.next)
 *   Webview : https://webview.powens.com/{lang}/{connect|reconnect|manage}?domain={domain}.biapi.pro&…
 * Lecture seule : aucun endpoint de paiement ou de virement n'est utilisé.
 */
import "server-only";

export class PowensError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public code: string | null = null,
    public retryable = false,
  ) {
    super(message);
  }
}

export interface PowensConnector { id: number; uuid: string; name: string; hidden?: boolean; beta?: boolean; color?: string | null; capabilities?: string[] }
export interface PowensConnection { id: number; id_user?: number | null; id_connector?: number; connector_uuid?: string; state?: string | null; error?: string | null; error_message?: string | null; last_update?: string | null; next_try?: string | null; expire?: string | null; active?: boolean; connector?: PowensConnector | null; accounts?: PowensAccount[] }
export interface PowensAccount { id: number; id_connection?: number | null; id_parent?: number | null; display?: boolean; name?: string; original_name?: string; number?: string | null; iban?: string | null; balance?: number | string | null; coming?: number | string | null; currency?: { id?: string } | null; type?: string | null; usage?: string | null; disabled?: string | boolean | null; deleted?: string | null; last_update?: string | null; transactions?: PowensTransaction[] }
export interface PowensTransaction { id: number; id_account: number; date: string; rdate?: string | null; vdate?: string | null; application_date?: string | null; value: number | string | null; type?: string | null; original_wording?: string | null; simplified_wording?: string | null; wording?: string | null; categories?: { code?: string; parent_code?: string }[] | null; coming?: boolean; active?: boolean; deleted?: string | null; last_update?: string | null; original_currency?: { id?: string } | null; counterparty?: { label?: string | null } | null }

export interface PowensConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
  /** Uniquement pour les tests automatisés (serveur simulé) ; jamais défini en production. */
  apiBaseOverride?: string;
}

export function powensConfig(): PowensConfig | null {
  const domain = process.env.POWENS_DOMAIN?.trim();
  const clientId = process.env.POWENS_CLIENT_ID?.trim();
  const clientSecret = process.env.POWENS_CLIENT_SECRET?.trim();
  if (!domain || !clientId || !clientSecret || !process.env.APP_ENCRYPTION_KEY) return null;
  // Le serveur simulé des tests n'est accepté que sur la boucle locale : impossible de détourner les jetons vers un hôte distant
  const override = process.env.POWENS_API_BASE_OVERRIDE;
  const apiBaseOverride = override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(override) ? override : undefined;
  return { domain: domain.replace(/\.biapi\.pro$/, ""), clientId, clientSecret, apiBaseOverride };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PowensClient {
  readonly base: string;
  constructor(
    private cfg: PowensConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = (cfg.apiBaseOverride ?? `https://${cfg.domain}.biapi.pro`).replace(/\/$/, "") + "/2.0";
  }

  private async request<T>(method: string, path: string, opts: { token?: string; body?: unknown; absolute?: string } = {}): Promise<T> {
    const url = opts.absolute ?? `${this.base}${path}`;
    let lastErr: PowensError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(25_000),
          cache: "no-store",
        });
      } catch (e) {
        lastErr = new PowensError(`Réseau indisponible (${(e as Error).name})`, null, "network", true);
        await sleep(400 * 2 ** attempt);
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return json as T;
      const code = (json as { code?: string } | null)?.code ?? null;
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new PowensError(`Powens a répondu ${res.status}${code ? ` (${code})` : ""}`, res.status, code, retryable);
      if (!retryable) throw lastErr;
      await sleep(Math.min(4000, 500 * 2 ** attempt));
    }
    throw lastErr ?? new PowensError("Erreur inconnue", null);
  }

  createUser() {
    return this.request<{ auth_token: string; type?: string; id_user: number }>("POST", "/auth/init", { body: { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret } });
  }
  temporaryCode(token: string) {
    return this.request<{ code: string; expires_in?: number }>("GET", "/auth/token/code", { token });
  }
  listConnectors() {
    return this.request<{ connectors: PowensConnector[] }>("GET", "/connectors");
  }
  listConnections(token: string) {
    return this.request<{ connections: PowensConnection[] }>("GET", "/users/me/connections?expand=connector", { token });
  }
  getConnection(token: string, id: string) {
    return this.request<PowensConnection>("GET", `/users/me/connections/${encodeURIComponent(id)}?expand=connector`, { token });
  }
  requestSync(token: string, id: string) {
    return this.request<PowensConnection>("PUT", `/users/me/connections/${encodeURIComponent(id)}`, { token });
  }
  deleteConnection(token: string, id: string) {
    return this.request<void>("DELETE", `/users/me/connections/${encodeURIComponent(id)}`, { token });
  }
  /** DELETE /2.0/users/me : supprime l'utilisateur Powens et toutes ses connexions (droit à l'effacement). */
  deleteUser(token: string) {
    return this.request<void>("DELETE", "/users/me", { token });
  }
  listAccounts(token: string, connectionId: string) {
    return this.request<{ accounts: PowensAccount[] }>("GET", `/users/me/connections/${encodeURIComponent(connectionId)}/accounts?all`, { token });
  }

  /** Toutes les opérations modifiées depuis `lastUpdate` (ou depuis `minDate`), pages de 1000, en suivant _links.next. */
  async listTransactions(token: string, opts: { lastUpdate?: string | null; minDate?: string }): Promise<PowensTransaction[]> {
    const params = new URLSearchParams({ limit: "1000" });
    if (opts.lastUpdate) params.set("last_update", opts.lastUpdate);
    else if (opts.minDate) params.set("min_date", opts.minDate);
    params.set("all", ""); // inclut les opérations supprimées par la banque, pour les retirer de MONETA
    const out: PowensTransaction[] = [];
    let page = await this.request<{ transactions: PowensTransaction[]; _links?: { next?: { href?: string } | null } }>("GET", `/users/me/transactions?${params.toString().replace("all=", "all")}`, { token });
    for (let i = 0; i < 100; i++) {
      out.push(...(page.transactions ?? []));
      const next = page._links?.next?.href;
      if (!next || new URL(next).origin !== new URL(this.base).origin) break; // ne suit que l'API Powens
      page = await this.request("GET", "", { token, absolute: next });
    }
    return out;
  }

  webviewUrl(flow: "connect" | "reconnect" | "manage", p: { code: string; redirectUri: string; state: string; connectionId?: string; connectorUuid?: string; lang?: string }) {
    const q = new URLSearchParams({ domain: `${this.cfg.domain}.biapi.pro`, client_id: this.cfg.clientId, code: p.code, state: p.state, redirect_uri: p.redirectUri });
    if (p.connectionId) q.set("connection_id", p.connectionId);
    if (p.connectorUuid && flow === "connect") q.set("connector_uuids", p.connectorUuid);
    if (flow === "connect") q.set("connector_capabilities", "bank");
    return `https://webview.powens.com/${p.lang ?? "fr"}/${flow}?${q.toString()}`;
  }
}

/** Montant décimal Powens → centimes (aucune arithmétique flottante cumulée). */
export function toCents(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
