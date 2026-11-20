import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id avec les paramètres recommandés par l'OWASP (19 Mio, 2 itérations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Hachage factice pour égaliser le temps de réponse quand l'e-mail n'existe pas. */
let dummy: string | null = null;
export async function dummyVerify(password: string) {
  dummy ??= await hashPassword("moneta-dummy-password");
  await verifyPassword(dummy, password);
}
