import "server-only";
import { features } from "./env";

/** Envoi d'e-mail via SMTP (nodemailer). Retourne false si aucun serveur SMTP n'est configuré. */
export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!features.email()) return false;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, ...msg });
  return true;
}
