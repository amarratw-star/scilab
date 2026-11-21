import "server-only";
import { z } from "zod";

/**
 * Variables d'environnement côté serveur. Aucun secret n'est codé en dur.
 * Les intégrations optionnelles (IA, e-mail, push, banque) sont désactivées proprement si absentes.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("MONETA"),
  APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY doit contenir au moins 32 caractères").optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  POWENS_DOMAIN: z.string().optional(),
  POWENS_CLIENT_ID: z.string().optional(),
  POWENS_CLIENT_SECRET: z.string().optional(),
  POWENS_WEBHOOK_SECRET: z.string().optional(),
  ALLOW_DEMO_ACCOUNTS: z.enum(["true", "false"]).default("true"),
  NODE_ENV: z.string().default("development"),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error("Configuration invalide : " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    cached = parsed.data;
  }
  return cached;
}

export const features = {
  ai: () => Boolean(process.env.ANTHROPIC_API_KEY),
  email: () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
  push: () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  bank: () => Boolean(process.env.POWENS_DOMAIN && process.env.POWENS_CLIENT_ID && process.env.POWENS_CLIENT_SECRET && process.env.APP_ENCRYPTION_KEY),
  demo: () => process.env.ALLOW_DEMO_ACCOUNTS !== "false",
};
