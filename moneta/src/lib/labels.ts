export const KIND_LABELS = {
  expense: "Dépense",
  income: "Revenu",
  transfer: "Transfert",
  refund: "Remboursement",
  adjustment: "Régularisation",
} as const;

export const STATUS_LABELS = { posted: "Effectuée", planned: "Prévue", cancelled: "Annulée" } as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Carte bancaire",
  cash: "Espèces",
  transfer: "Virement",
  direct_debit: "Prélèvement",
  mobile: "Paiement mobile",
  other: "Autre",
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Compte courant",
  savings: "Livret d'épargne",
  secondary: "Compte secondaire",
  cash: "Espèces",
  investment: "Compte d'investissement",
  placement: "Compte de placement",
  other: "Autre",
};

export const ACCOUNT_TYPE_ICONS: Record<string, string> = {
  checking: "wallet",
  savings: "piggy-bank",
  secondary: "credit-card",
  cash: "banknote",
  investment: "trending-up",
  placement: "line-chart",
  other: "landmark",
};

export const PERIOD_LABELS = { monthly: "Mensuel", weekly: "Hebdomadaire", custom: "Période personnalisée" } as const;
