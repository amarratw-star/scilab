import "server-only";
import { features } from "./env";

type Sub = { endpoint: string; p256dh: string; auth: string };

/** Envoie des notifications push Web (si les clés VAPID sont configurées). Ne transmet aucun montant détaillé au-delà du titre. */
export async function sendPush(subs: Sub[], items: { title: string; body: string; link: string | null }[]) {
  if (!features.push() || !subs.length) return;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  for (const sub of subs) {
    for (const it of items.slice(0, 3)) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: it.title, body: it.body, url: it.link ?? "/" }),
          { TTL: 3600 },
        );
      } catch {
        // abonnement expiré : ignoré (nettoyé lors de la prochaine désinscription)
      }
    }
  }
}
