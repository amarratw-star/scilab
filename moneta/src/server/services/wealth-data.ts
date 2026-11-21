import "server-only";
import { asc } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { Ctx } from "./context";
import type { WealthItemInput } from "@/lib/finance/wealth";

export async function loadWealthItems(ctx: Ctx): Promise<WealthItemInput[]> {
  const [items, vals] = await Promise.all([
    ctx.tx.select().from(s.wealthItems).orderBy(asc(s.wealthItems.createdAt)),
    ctx.tx.select().from(s.wealthValuations).orderBy(asc(s.wealthValuations.date)),
  ]);
  return items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, category: i.category, archived: Boolean(i.archivedAt), valuations: vals.filter((v) => v.itemId === i.id).map((v) => ({ date: v.date, value: v.value, method: v.method })) }));
}
