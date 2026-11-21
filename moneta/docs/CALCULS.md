# MONETA — formules des indicateurs et audit V2

Toutes les formules sont implémentées dans `src/lib/finance/` (code pur, testé) et assemblées dans
`src/server/services/overview.ts`. Montants en centimes entiers. « Aujourd'hui » = date du jour dans le
fuseau de l'utilisateur.

## Règles communes

| Règle | Mise en œuvre |
|---|---|
| Seules les opérations **effectuées** (`posted`) datées **au plus tard aujourd'hui** forment le solde réel | `computeBalances(…, today)` |
| Opération effectuée **datée dans le futur** | hors solde réel ; traitée comme une sortie/entrée à venir (disponible, prévisions) |
| Opérations **prévues** | jamais dans le solde réel, ni dans les statistiques ; déduites du disponible si ce sont des sorties |
| Opérations **annulées** | sans aucun effet |
| **Transferts** entre comptes personnels | ni revenu ni dépense ; effet nul sur le patrimoine |
| **Remboursements** | augmentent le solde ; viennent en déduction des dépenses (dépenses nettes) |
| **Régularisations** | modifient le solde du compte ; exclues des revenus et dépenses |
| **Revenus attendus** | jamais ajoutés au solde ni au montant dépensable ; affichés à part |

## Indicateurs

| Indicateur | Formule | Fonction |
|---|---|---|
| Argent disponible (solde disponible) | Σ soldes réels des comptes courants, secondaires, espèces non archivés | `summarizeBalances().available` |
| Patrimoine financier | Σ soldes réels de tous les comptes non archivés | `summarizeBalances().totalFinancial` |
| Patrimoine net | patrimoine financier + biens déclarés − dettes déclarées (dernière valeur connue) | `netWorth()` |
| Revenus du mois | Σ revenus effectués du 1er à aujourd'hui | `periodTotals().income` |
| Dépenses du mois | Σ dépenses effectuées − Σ remboursements, du 1er à aujourd'hui | `periodTotals().netExpenses` |
| Épargne du mois | revenus du mois − dépenses du mois (peut être négative avant le salaire) | `periodTotals().netSavings` |
| Taux d'épargne | épargne ÷ revenus ; « — » si aucun revenu | `periodTotals().savingsRate` |
| Charges fixes du mois | payées : dépenses du mois liées à une échéance ou d'une catégorie « fixe » ; à venir : échéances de dépenses du mois non réalisées | `computeOverview()` |
| Reste à vivre prévu | (revenus encaissés + revenus attendus du mois) − charges fixes du mois. Variante « encaissés seulement » affichée en infobulle | `computeOverview().resteAVivre` |
| Après charges fixes | disponible − charges fixes à venir du mois − dépenses prévues du mois | `computeAvailable().afterFixedCharges` |
| Combien puis-je dépenser | après charges fixes − versements d'épargne prévus − épargne mensuelle à préserver − coussin de sécurité | `computeAvailable().spendableUntilMonthEnd` |
| Budget quotidien | max(0, dépensable) ÷ jours restants (aujourd'hui inclus), plafonné par le restant des budgets mensuels | `computeAvailable().recommendedDaily` |
| Prévisions | solde réel + flux connus (échéances, prévues, futures) − dépenses variables moyennes (90 j) ; 3 scénarios ; ±1,28 σ√t | `forecast()` |
| Comparaisons | période comparable (1–21 nov. vs 1–21 oct.) ; pas de pourcentage si la base est nulle ou sans historique | `comparablePreviousPeriod()` |
| Santé financière | voir `src/lib/finance/health.ts` (6 critères pondérés, ratios uniquement, « données insuffisantes » si < 60 j ou < 60 % évaluable) | `healthScore()` |

## Audit V2 — constats et corrections

Valeurs de la capture (démo, 20/11) : disponible 1 516,93 € ; charges fixes restantes 11,99 € ; dépenses
prévues 180 € ; versement d'épargne programmé 200 € ; épargne à préserver 100 € ; coussin 300 €.

- 1 516,93 − 11,99 − 180 = **1 324,94 €** (après charges fixes) ✔
- 1 324,94 − 200 − 100 − 300 = **724,94 €** (dépensable) ✔ — cohérent, périmètres différents.
- Reste à vivre −883,85 € : formule correcte (0 € de revenus encaissés − 883,85 € de charges fixes), mais
  trompeur avant l'arrivée du salaire. **Corrigé** : « reste à vivre prévu » inclut les revenus attendus du mois,
  clairement signalés ; la variante « encaissés seulement » reste visible.

Défauts trouvés et corrigés (tests : `tests/unit/v2-audit.test.ts`) :

1. **Double déduction d'une charge** : une échéance (loyer, abonnement) payée par une opération saisie à la main
   ou importée par CSV, sans rattachement explicite, restait « à payer » et était déduite une seconde fois du
   disponible et des prévisions. → Rapprochement automatique (même type, même compte, montant ±10 %, date ±6 j,
   même catégorie ou libellé apparenté ; une opération ne réalise qu'une échéance).
2. **Opération effectuée datée dans le futur** : elle modifiait le solde réel du jour. → Soldes calculés à la date
   du jour ; l'opération est comptée une seule fois comme sortie à venir.
3. **Transfert futur vers l'épargne** compté à la fois comme « déjà épargné » et « prévu ». → Corrigé.
4. **Devise** : le réglage n'était pas appliqué. → Formatage centralisé (`formatMoney`), devise de l'utilisateur
   partout ; aucune conversion (pas de source de taux) — la limite est expliquée dans les paramètres.

Vérifiés sans anomalie : transferts (aucun effet sur revenus/dépenses/patrimoine), remboursements,
opérations annulées, divisions par zéro, années bissextiles, changement de mois, isolation des utilisateurs.
Les données de démonstration n'ont pas été modifiées pour embellir les chiffres.
