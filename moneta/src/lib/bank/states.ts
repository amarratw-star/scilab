/**
 * États de connexion Powens (doc : « SCA & connection states ») → message compréhensible + action proposée.
 * Compatibilité ascendante : tout état inconnu retombe sur un cas générique.
 */
export type ConnectionAction = "reconnect" | "bank_site" | "wait" | "none";
export type ConnectionTone = "positive" | "info" | "warning" | "negative" | "neutral";

export interface StateInfo {
  label: "Connectée" | "Synchronisation en cours" | "Action nécessaire" | "Autorisation expirée" | "Connexion interrompue" | "Erreur temporaire" | "En attente";
  tone: ConnectionTone;
  message: string;
  action: ConnectionAction;
}

export function describeConnectionState(state: string | null | undefined, opts: { syncing?: boolean; expired?: boolean; pending?: boolean } = {}): StateInfo {
  if (opts.syncing) return { label: "Synchronisation en cours", tone: "info", message: "Récupération de tes comptes et opérations en cours. Les données affichées restent celles de la dernière actualisation.", action: "wait" };
  if (opts.pending && !state) return { label: "En attente", tone: "neutral", message: "La connexion n'a pas encore été finalisée.", action: "reconnect" };
  switch (state ?? null) {
    case null:
      if (opts.expired) return { label: "Autorisation expirée", tone: "warning", message: "Ton consentement auprès de la banque a expiré. Renouvelle-le pour reprendre la synchronisation.", action: "reconnect" };
      return { label: "Connectée", tone: "positive", message: "Synchronisation automatique active.", action: "none" };
    case "SCARequired":
    case "webauthRequired":
      return { label: "Autorisation expirée", tone: "warning", message: "Ta banque demande une nouvelle autorisation. Reconnecte ton compte pour reprendre la synchronisation.", action: "reconnect" };
    case "additionalInformationNeeded":
      return { label: "Action nécessaire", tone: "warning", message: "Ta banque demande une information complémentaire (par exemple un code reçu par SMS). Reprends la connexion pour la fournir.", action: "reconnect" };
    case "decoupled":
    case "validating":
      return { label: "Action nécessaire", tone: "info", message: "Une validation est attendue dans l'application de ta banque. Valide la demande puis reviens ici.", action: "reconnect" };
    case "actionNeeded":
      return { label: "Action nécessaire", tone: "warning", message: "Ta banque te demande une action sur son site ou son application (par exemple accepter de nouvelles conditions). Fais-la puis relance la synchronisation.", action: "bank_site" };
    case "passwordExpired":
      return { label: "Action nécessaire", tone: "warning", message: "Ton mot de passe bancaire a expiré. Change-le sur le site de ta banque, puis reconnecte ton compte.", action: "reconnect" };
    case "wrongpass":
      return { label: "Connexion interrompue", tone: "negative", message: "Les identifiants enregistrés par l'agrégateur ne sont plus valides. Reconnecte ton compte via le parcours sécurisé.", action: "reconnect" };
    case "rateLimiting":
    case "websiteUnavailable":
    case "bug":
      return { label: "Erreur temporaire", tone: "neutral", message: "La banque ou l'agrégateur est momentanément indisponible. La synchronisation reprendra automatiquement ; tes dernières données restent affichées.", action: "wait" };
    default:
      return { label: "Connexion interrompue", tone: "negative", message: "La synchronisation a échoué. Reconnecte ton compte ; si le problème persiste, supprime puis recrée la connexion.", action: "reconnect" };
  }
}

/** Masque un IBAN : on ne conserve que le pays et les 4 derniers caractères. */
export function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 8) return null;
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}
