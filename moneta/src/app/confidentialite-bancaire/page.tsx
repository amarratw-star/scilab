import Link from "next/link";
import { Logo } from "@/components/app/logo";

export const metadata = { title: "Confidentialité bancaire" };

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Qui accède à mes comptes ?",
    body: "La lecture de tes comptes passe par Powens, un agrégateur bancaire agréé au titre de la directive européenne sur les services de paiement (DSP2), qui agit comme prestataire de services d'information sur les comptes. MONETA reçoit ensuite, de Powens, les informations des seuls comptes que tu as choisi de partager.",
  },
  {
    title: "Mes identifiants bancaires",
    body: "Tu ne communiques jamais ton identifiant ni ton mot de passe bancaire à MONETA. Ils sont saisis dans le parcours sécurisé de l'agrégateur ou directement sur le site ou l'application de ta banque, qui effectue elle-même l'authentification forte (code SMS, validation dans l'appli…). MONETA ne les voit pas, ne les stocke pas et ne contourne jamais cette authentification.",
  },
  {
    title: "Ce que MONETA reçoit et conserve",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Pour chaque compte partagé : nom, type, devise, solde communiqué par la banque et sa date, IBAN <strong>masqué</strong> (seuls le code pays et les 4 derniers caractères sont conservés).</li>
        <li>Pour chaque opération : date, montant, libellé, catégorie bancaire, statut (en attente, comptabilisée, supprimée) et identifiant technique, pour éviter les doublons.</li>
        <li>Un jeton d&apos;accès technique propre à ton espace, chiffré (AES-256-GCM) dans la base et jamais transmis à ton navigateur.</li>
      </ul>
    ),
  },
  {
    title: "Ce que MONETA ne fait pas",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Aucun virement, aucun paiement : l&apos;accès est en <strong>lecture seule</strong>.</li>
        <li>Aucune revente, aucun usage publicitaire, aucun entraînement de modèle sur tes données.</li>
        <li>Aucune suppression silencieuse : une opération en double ou modifiée par la banque est tracée, et chaque fusion peut être annulée.</li>
      </ul>
    ),
  },
  {
    title: "Durée du consentement",
    body: "Ton autorisation auprès de la banque a une durée limitée fixée par la réglementation et ta banque. Quand elle expire, MONETA te prévient : tu la renouvelles en quelques secondes, toujours auprès de ta banque. En attendant, tes dernières données restent affichées, sans jamais être remplacées par un solde à zéro.",
  },
  {
    title: "Garder le contrôle",
    body: "Depuis Comptes → Connexions bancaires, tu peux suspendre la synchronisation d'un compte, ajouter ou retirer des comptes partagés, renouveler l'autorisation ou supprimer la connexion. La suppression révoque l'accès chez l'agrégateur ; tu choisis alors de conserver tes données en comptes manuels ou de les effacer. La suppression de ton compte MONETA supprime aussi ton profil chez l'agrégateur.",
  },
  {
    title: "Tes droits",
    body: "Accès, export, rectification et effacement depuis Paramètres → Mes données. L'export inclut les connexions, comptes liés, opérations importées et l'historique des synchronisations (sans aucun jeton ni identifiant bancaire).",
  },
];

export default function BankPrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Confidentialité bancaire</h1>
      <p className="mt-2 text-sm text-muted">Comment fonctionne la synchronisation de tes comptes, et ce que MONETA ne fera jamais.</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-semibold">{s.title}</h2>
            <div className="mt-1 text-muted">{s.body}</div>
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm"><Link href="/confidentialite" className="text-info hover:underline">Politique de confidentialité générale</Link></p>
    </div>
  );
}
