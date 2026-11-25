import Link from "next/link";
import { AlertTriangle, Combine, Inbox } from "lucide-react";

/** Bandeau du tableau de bord : connexions à renouveler, opérations importées à vérifier, doublons possibles. */
export function BankBanner({ review }: { review: { unverified: number; duplicates: number; duplicateAccounts?: number; needAction: string[] } }) {
  if (!review.unverified && !review.duplicates && !review.duplicateAccounts && !review.needAction.length) return null;
  const items = [
    review.needAction.length > 0 && { href: "/comptes#connexions", icon: AlertTriangle, tone: "text-warning", text: review.needAction.length === 1 ? `${review.needAction[0]} : action nécessaire pour reprendre la synchronisation` : `${review.needAction.length} connexions bancaires demandent une action` },
    (review.duplicateAccounts ?? 0) > 0 && { href: "/comptes#connexions", icon: Combine, tone: "text-warning", text: `${review.duplicateAccounts} compte${review.duplicateAccounts! > 1 ? "s" : ""} peut-être connecté${review.duplicateAccounts! > 1 ? "s" : ""} deux fois` },
    review.duplicates > 0 && { href: "/transactions/a-verifier", icon: Combine, tone: "text-warning", text: `${review.duplicates} doublon${review.duplicates > 1 ? "s" : ""} possible${review.duplicates > 1 ? "s" : ""} à examiner` },
    review.unverified > 0 && { href: "/transactions/a-verifier", icon: Inbox, tone: "text-info", text: `${review.unverified} nouvelle${review.unverified > 1 ? "s" : ""} opération${review.unverified > 1 ? "s" : ""} bancaire${review.unverified > 1 ? "s" : ""} à vérifier` },
  ].filter(Boolean) as { href: string; icon: typeof Inbox; tone: string; text: string }[];
  return (
    <nav aria-label="Synchronisation bancaire" className="mb-4 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.text} href={i.href} className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-border-strong hover:bg-surface-2">
          <i.icon className={`size-3.5 shrink-0 ${i.tone}`} />
          <span className="truncate">{i.text}</span>
        </Link>
      ))}
    </nav>
  );
}
