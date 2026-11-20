import "server-only";
import { sql } from "drizzle-orm";
import type { Ctx } from "./context";

export interface SearchHit {
  type: "transaction" | "account" | "subscription" | "category" | "document" | "goal";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
  kind?: string;
}

/**
 * Recherche globale tolérante (trigrammes PostgreSQL + insensible aux accents via normalisation simple).
 * Toutes les requêtes sont filtrées par RLS : seules les données de l'utilisateur sont parcourues.
 */
export async function globalSearch(ctx: Ctx, rawQuery: string): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 80);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const lq = q.toLowerCase();
  const rows = await ctx.tx.execute<{ type: SearchHit["type"]; id: string; title: string; subtitle: string; amount: number | null; kind: string | null; score: number }>(sql`
    (select 'transaction' as type, t.id::text, coalesce(t.merchant, t.description, 'Opération') as title,
            to_char(t.date, 'DD/MM/YYYY') || coalesce(' · ' || c.name, '') as subtitle, t.amount::bigint as amount, t.kind::text as kind,
            greatest(word_similarity(${lq}, lower(coalesce(t.description,'') || ' ' || coalesce(t.merchant,''))), case when t.description ilike ${like} or t.merchant ilike ${like} then 1 else 0 end) as score
       from transactions t left join categories c on c.id = t.category_id
      where t.description ilike ${like} or t.merchant ilike ${like} or t.notes ilike ${like}
         or word_similarity(${lq}, lower(coalesce(t.description,'') || ' ' || coalesce(t.merchant,''))) > 0.4
         or ${lq} = any(t.tags)
      order by score desc, t.date desc limit 8)
    union all
    (select 'account', a.id::text, a.name, coalesce(a.institution, 'Compte'), null, a.type::text, similarity(lower(a.name), ${lq}) + case when a.name ilike ${like} then 1 else 0 end
       from accounts a where a.name ilike ${like} or a.institution ilike ${like} or similarity(lower(a.name), ${lq}) > 0.3 limit 4)
    union all
    (select 'subscription', r.id::text, r.name, 'Échéance récurrente', r.amount::bigint, r.kind::text, similarity(lower(r.name), ${lq}) + case when r.name ilike ${like} then 1 else 0 end
       from recurring_items r where r.name ilike ${like} or r.merchant ilike ${like} or similarity(lower(r.name), ${lq}) > 0.3 limit 4)
    union all
    (select 'category', c.id::text, c.name, case when c.kind = 'income' then 'Catégorie de revenus' else 'Catégorie de dépenses' end, null, c.kind::text, similarity(lower(c.name), ${lq}) + case when c.name ilike ${like} then 1 else 0 end
       from categories c where c.archived_at is null and (c.name ilike ${like} or similarity(lower(c.name), ${lq}) > 0.3) limit 4)
    union all
    (select 'document', d.id::text, d.name, 'Document', null, d.kind, similarity(lower(d.name), ${lq}) + case when d.name ilike ${like} then 1 else 0 end
       from documents d where d.name ilike ${like} or similarity(lower(d.name), ${lq}) > 0.3 limit 4)
    union all
    (select 'goal', g.id::text, g.name, 'Objectif d''épargne', g.target_amount::bigint, null, similarity(lower(g.name), ${lq}) + case when g.name ilike ${like} then 1 else 0 end
       from goals g where g.archived_at is null and (g.name ilike ${like} or g.description ilike ${like} or similarity(lower(g.name), ${lq}) > 0.3) limit 4)
  `);
  const hrefs: Record<SearchHit["type"], (id: string) => string> = {
    transaction: (id) => `/transactions?id=${id}`,
    account: (id) => `/comptes/${id}`,
    subscription: () => `/abonnements`,
    category: (id) => `/transactions?categorie=${id}`,
    document: (id) => `/documents?id=${id}`,
    goal: () => `/epargne`,
  };
  return (rows as unknown as { type: SearchHit["type"]; id: string; title: string; subtitle: string; amount: number | null; kind: string | null }[]).map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    amount: r.amount === null ? undefined : Number(r.amount),
    kind: r.kind ?? undefined,
    href: hrefs[r.type](r.id),
  }));
}
