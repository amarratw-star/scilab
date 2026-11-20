import "server-only";
import { withUser, type Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import type { UserSettings } from "@/server/db/schema";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import { auditLog } from "@/server/db/schema";

export interface Ctx {
  tx: Tx;
  userId: string;
  today: ISODate;
  timezone: string;
  currency: string;
  settings: UserSettings;
}

type UserLike = Pick<SessionUser, "id" | "timezone" | "currency" | "settings">;

export function runAsUser<T>(user: UserLike, fn: (ctx: Ctx) => Promise<T>, today?: ISODate): Promise<T> {
  return withUser(user.id, (tx) =>
    fn({
      tx,
      userId: user.id,
      today: today ?? todayInTimeZone(user.timezone),
      timezone: user.timezone,
      currency: user.currency,
      settings: user.settings ?? {},
    }),
  );
}

export async function audit(ctx: Ctx, action: string, entity?: string, entityId?: string, meta: Record<string, unknown> = {}) {
  await ctx.tx.insert(auditLog).values({ userId: ctx.userId, action, entity, entityId, meta });
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}
