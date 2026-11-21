import Link from "next/link";
import { Logo } from "@/components/app/logo";

export const metadata = { title: "Confidentialité" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Politique de confidentialité</h1>
      <p className="mt-2 text-sm text-muted">Transparence sur le traitement de tes données (RGPD).</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        <section><h2 className="font-semibold">Données traitées</h2><p className="text-muted">Ton prénom, ton adresse e-mail, un mot de passe haché (Argon2id, jamais stocké en clair), et les données financières que tu saisis ou importes : comptes, opérations, budgets, objectifs, abonnements, patrimoine et justificatifs. Nous ne collectons aucune donnée publicitaire et n&apos;utilisons aucun traceur tiers.</p></section>
        <section><h2 className="font-semibold">Finalité</h2><p className="text-muted">Uniquement le fonctionnement du service : calculer tes soldes, budgets, analyses et prévisions. Tes données ne sont ni vendues, ni partagées, ni utilisées pour entraîner un modèle.</p></section>
        <section><h2 className="font-semibold">Isolation et sécurité</h2><p className="text-muted">Chaque espace est isolé au niveau de la base de données (politiques de sécurité par ligne) : aucun utilisateur ne peut accéder aux finances d&apos;un autre. Les sessions utilisent des cookies sécurisés, les requêtes sensibles sont limitées en débit, les documents sont stockés de manière privée et les actions importantes sont journalisées.</p></section>
        <section><h2 className="font-semibold">Services externes (uniquement si tu les actives)</h2><ul className="list-disc space-y-1 pl-5 text-muted"><li><strong>Conseiller IA</strong> : ta question et des statistiques calculées sont transmises à Anthropic pour générer une réponse. Activation explicite requise.</li><li><strong>Analyse de tickets par IA</strong> : l&apos;image du ticket est transmise à Anthropic. Par défaut, la lecture se fait localement sur ton appareil.</li><li><strong>Connexion bancaire</strong> : via un agrégateur agréé DSP2 (Powens), avec ton consentement explicite auprès de ta banque. MONETA ne voit jamais tes identifiants bancaires. <Link href="/confidentialite-bancaire" className="text-info hover:underline">Détails</Link></li></ul></section>
        <section><h2 className="font-semibold">Tes droits</h2><p className="text-muted">Accès et portabilité : export complet en un clic (Paramètres → Mes données). Rectification : modifie tes données à tout moment. Effacement : suppression immédiate et définitive de ton compte et de toutes tes données. Les espaces de démonstration sont supprimés automatiquement sous 48 heures.</p></section>
        <section><h2 className="font-semibold">Conservation</h2><p className="text-muted">Tant que ton compte existe. Les sauvegardes de la base sont chiffrées et conservées selon la politique de l&apos;hébergeur (voir la documentation technique).</p></section>
      </div>
    </div>
  );
}
