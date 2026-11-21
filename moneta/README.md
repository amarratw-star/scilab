# MONETA — centre de contrôle financier personnel

> **V2** : tableau de bord hiérarchisé (4 indicateurs essentiels + indicateurs secondaires), « Combien puis-je
> dépenser ? » détaillé, **Santé financière** (note /100 documentée), **opportunités d'économies**, calendrier de
> **trésorerie** (7/30/90/365 jours, jours à risque), simulateur de scénario complet, conseiller IA enrichi,
> devise d'affichage appliquée partout, audit des calculs : voir [`docs/CALCULS.md`](./docs/CALCULS.md).
>
> **V3** : **synchronisation bancaire automatique** via Powens (DSP2, lecture seule) — connexions multiples, états
> (autorisation expirée, action nécessaire…), webhooks signés + synchronisation de secours, opérations en attente /
> comptabilisées / supprimées, **détection des doublons** avec les saisies manuelles (fusion traçable et réversible),
> virements internes, catégorisation apprenante, page « Opérations à vérifier », page publique *Confidentialité
> bancaire* : voir [`docs/BANQUE.md`](./docs/BANQUE.md). **Non testé contre l'API Powens réelle** (pas d'identifiants).

Application web (PWA installable) de gestion financière personnelle : comptes, opérations, budgets, épargne,
abonnements, calendrier, analyses, prévisions, simulateur, patrimoine, documents, rapports et conseiller IA.

- **Langue** : français · **Devise par défaut** : euro · **Dates** : JJ/MM/AAAA · **Fuseau** : Europe/Paris (configurable)
- **Montants** stockés en **centimes entiers** (aucun flottant dans les calculs)
- **Isolation** des utilisateurs au niveau de PostgreSQL (Row Level Security)
- Le nom « MONETA » se change via `NEXT_PUBLIC_APP_NAME` (et `public/manifest.webmanifest`).

---

## Sommaire

1. [Démarrage rapide (local)](#1-démarrage-rapide-local)
2. [Commandes](#2-commandes)
3. [Configuration (variables d'environnement)](#3-configuration)
4. [Architecture](#4-architecture)
5. [Règles de calcul financier](#5-règles-de-calcul-financier)
6. [Sécurité et RGPD](#6-sécurité-et-rgpd)
7. [Tests](#7-tests)
8. [Déploiement (Vercel + Supabase ou autre PostgreSQL)](#8-déploiement)
9. [Sauvegarde et restauration](#9-sauvegarde-et-restauration)
10. [Intégrations externes](#10-intégrations-externes)
11. [Limites connues](#11-limites-connues)

---

## 1. Démarrage rapide (local)

Prérequis : **Node.js ≥ 20**, **PostgreSQL ≥ 15** (avec les extensions `pg_trgm` et `unaccent`, fournies en standard).

```bash
cd moneta
npm install
cp .env.example .env                 # puis compléter APP_ENCRYPTION_KEY (openssl rand -base64 48)

# Base locale : crée la base + deux rôles (moneta_owner pour les migrations, moneta_app sans BYPASSRLS)
bash scripts/setup-local-db.sh moneta  # nécessite un accès superutilisateur PostgreSQL (sudo -u postgres)
# → reporter les deux URL affichées dans .env (DATABASE_URL et MIGRATION_DATABASE_URL)

npm run db:migrate                     # schéma + contraintes + politiques RLS
npm run dev                            # http://localhost:3000
```

Sur la page de connexion, **« Explorer la démo »** crée un espace isolé rempli de données **fictives**
(supprimé automatiquement après 48 h). Un compte réel peut aussi charger les données de démonstration
depuis l'assistant de bienvenue ; un bouton dans *Paramètres → Mes données* les supprime pour repartir à vide.

## 2. Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` / `npm start` | Build et serveur de production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run db:migrate` | Applique les migrations (`drizzle/`) avec `MIGRATION_DATABASE_URL` |
| `npm run db:generate` | Génère une migration après modification de `src/server/db/schema.ts` |
| `npm run db:setup-local` | Crée une base locale et les rôles |
| `npm run db:backup` / `npm run db:restore` | Sauvegarde / restauration (voir §9) |
| `npm run test:unit` | Tests unitaires du moteur de calcul (Vitest) |
| `npm run test:integration` | Tests d'intégration sur PostgreSQL réel (base `moneta_test`) |
| `npm run test:e2e` | Tests de bout en bout (Playwright, base `moneta_e2e`, nécessite `npm run build`) |
| `npm run icons` | Régénère les icônes PWA depuis `public/icon.svg` |

## 3. Configuration

Toutes les variables sont décrites dans [`.env.example`](./.env.example). **Aucun secret n'est présent dans le code.**

| Variable | Obligatoire | Effet si absente |
|---|---|---|
| `DATABASE_URL` | oui | — (rôle `moneta_app`, soumis à la RLS) |
| `MIGRATION_DATABASE_URL` | pour migrer | — (rôle propriétaire) |
| `APP_URL` | oui | liens des e-mails et redirections |
| `APP_ENCRYPTION_KEY` | recommandé | requis pour la connexion bancaire (chiffrement des jetons) |
| `ANTHROPIC_API_KEY` | non | le conseiller IA et l'analyse de ticket par IA affichent « configuration requise » ; tout le reste fonctionne |
| `SMTP_*` | recommandé en prod | en dev, le lien de réinitialisation est écrit dans la console serveur ; en prod il n'est pas envoyé |
| `VAPID_*` | non | notifications uniquement dans l'application (pas de push) |
| `CRON_SECRET` | recommandé | la tâche quotidienne `/api/cron/daily` refuse toute requête |
| `POWENS_DOMAIN`, `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET` | non | la connexion bancaire est affichée comme non configurée (l'import CSV reste disponible) |
| `POWENS_WEBHOOK_SECRET` | recommandé si Powens | sans clé HMAC, les webhooks sont authentifiés par le jeton utilisateur seulement |

## 4. Architecture

```
moneta/
├── drizzle/                     Migrations SQL (0000 schéma, 0001 contraintes + RLS + droits)
├── public/                      PWA : manifest, service worker, icônes
├── scripts/                     Base locale, migrations, sauvegarde/restauration, icônes
├── src/
│   ├── lib/                     Code pur, partagé client/serveur
│   │   ├── finance/             ★ MOTEUR DE CALCUL — source de vérité unique
│   │   │   ├── ledger.ts          soldes, historique, rapprochement
│   │   │   ├── stats.ts           revenus/dépenses/épargne, catégories, périodes comparables
│   │   │   ├── recurring.ts       échéances, coûts mensuels/annuels
│   │   │   ├── budgets.ts         fenêtres, consommation, report, alertes
│   │   │   ├── goals.ts           progression, effort mensuel, date estimée
│   │   │   ├── available.ts       « Combien puis-je dépenser ? », reste à vivre
│   │   │   ├── forecast.ts        prévisions 3 scénarios + incertitude
│   │   │   ├── insights.ts        anomalies, tendances, récurrences, recommandations, résumé
│   │   │   ├── simulate.ts        achat, plan d'épargne, réduction, revenus
│   │   │   └── wealth.ts          patrimoine brut/net
│   │   ├── money.ts, dates.ts   centimes, formats FR, dates ISO sans fuseau
│   │   ├── validation.ts        schémas Zod (client + serveur)
│   │   ├── csv-import.ts        import CSV (colonnes, montants FR, empreintes anti-doublon)
│   │   └── receipt-parser.ts    analyse du texte OCR d'un ticket
│   ├── server/                  Code serveur uniquement
│   │   ├── db/                  schéma Drizzle + connexion ; withUser() positionne app.user_id (RLS)
│   │   ├── auth/                Argon2id, sessions (cookie httpOnly, jeton haché), limitation de débit
│   │   ├── services/            logique métier (comptes, opérations, budgets, objectifs, import, rapports…)
│   │   ├── ai/                  conseiller IA (outils en lecture seule) + vision ticket
│   │   └── bank/                client Powens (lecture seule), ingestion, service, webhooks — voir docs/BANQUE.md
│   ├── app/                     Next.js App Router
│   │   ├── (auth)/              connexion, inscription, mot de passe
│   │   ├── (app)/               19 pages privées
│   │   ├── actions/             Server Actions (auth → validation Zod → service → revalidation)
│   │   └── api/                 recherche, documents, exports, IA, OCR, banque, cron
│   └── components/              système de design (ui/), graphiques (charts/), coquille (app/)
└── tests/ unit · integration · e2e
```

**Stack** : Next.js 15 (App Router, Server Components, Server Actions) · React 19 · TypeScript strict ·
Tailwind CSS 4 · composants Radix UI façon shadcn/ui · Recharts · Zod 4 · Drizzle ORM + PostgreSQL ·
Argon2id (`@node-rs/argon2`) · SDK Anthropic · pdfkit / exceljs · tesseract.js · Vitest · Playwright.

**Choix notables**
- **PostgreSQL + RLS au lieu de Supabase Auth** : l'authentification est intégrée (sessions en base, Argon2id),
  ce qui permet de fonctionner sur *n'importe quel* PostgreSQL — y compris Supabase comme hébergeur de base.
  L'isolation est garantie par la base elle-même (politiques RLS + clés étrangères composites `(id, user_id)`),
  pas seulement par le code.
- **Calculs à la volée** : les soldes ne sont jamais stockés ; ils sont recalculés depuis le solde initial et les
  opérations. Impossible d'avoir un solde incohérent après modification ou suppression.
- **Documents en base** (`bytea`, 8 Mo max, type vérifié par signature binaire) : stockage privé couvert par la RLS
  et par les sauvegardes, sans service de fichiers supplémentaire.

## 5. Règles de calcul financier

Implémentées dans `src/lib/finance/` et couvertes par les tests unitaires.

| Notion | Définition |
|---|---|
| Effet sur les soldes | dépense −, revenu +, remboursement +, régularisation ± ; transfert : − source / + destination |
| Statuts | seules les opérations **effectuées** comptent ; **prévues** et **annulées** n'ont aucun effet |
| Revenus encaissés | revenus effectués de la période (hors transferts, hors remboursements) |
| Revenus prévisionnels | échéances récurrentes de revenus + revenus prévus — **jamais** ajoutés au disponible |
| Dépenses brutes / nettes | brutes = somme des dépenses ; nettes = brutes − remboursements |
| Épargne nette | revenus encaissés − dépenses nettes |
| Taux d'épargne | épargne nette ÷ revenus encaissés (« — » si aucun revenu) |
| Transferts | ni revenu ni dépense ; un virement vers un livret n'est donc jamais compté deux fois |
| Solde disponible | comptes courants, secondaires et espèces non archivés |
| Patrimoine financier | somme de tous les comptes non archivés |
| Patrimoine brut / net | brut = comptes + actifs déclarés ; net = brut − passifs |
| Charges fixes | dépenses liées à une échéance récurrente ou d'une catégorie marquée « fixe » |
| Reste à vivre | revenus encaissés du mois − charges fixes du mois (payées + à venir) |
| Combien puis-je dépenser | disponible − charges fixes restantes − dépenses prévues − versements d'épargne prévus − épargne mensuelle à préserver − coussin de sécurité ; ÷ jours restants, plafonné par les budgets |
| Comparaisons | toujours sur une **période comparable** (1–20 nov. vs 1–20 oct. ; 29 février géré) |
| Échéances | 31/01 + 1 mois = 28 ou 29/02 ; une échéance est réalisée quand une opération y est rattachée |
| Divisions par zéro | renvoient « indisponible », jamais 0 % ni ∞ |

## 6. Sécurité et RGPD

- Mots de passe : **Argon2id** (paramètres OWASP) ; comparaison à temps constant (pas d'énumération des comptes).
- Sessions : jeton aléatoire 256 bits en cookie `httpOnly`, `SameSite=Lax`, `Secure` en production ; seul son
  **SHA-256** est stocké ; renouvellement glissant 30 jours ; liste et révocation des sessions.
- **RLS** sur toutes les tables financières ; l'application se connecte avec `moneta_app` (sans `BYPASSRLS`, non
  propriétaire) ; clés étrangères composites empêchant de référencer la ressource d'un autre utilisateur.
- Contraintes `CHECK` en base (montants positifs, transferts entre deux comptes distincts…).
- Validation **Zod** côté client et serveur ; requêtes paramétrées (Drizzle) ; protection anti-injection de
  formules dans les exports CSV.
- **Limitation de débit** en base (connexion, inscription, réinitialisation, IA, envois de fichiers, exports).
- En-têtes : CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Documents : type vérifié par signature binaire, 8 Mo max, servis uniquement au propriétaire, `no-store`, CSP `sandbox`.
- **Journal d'audit** (ajout seul) des actions importantes ; jetons bancaires chiffrés AES-256-GCM.
- RGPD : export JSON complet (accès / portabilité), suppression immédiate du compte, politique de confidentialité
  (`/confidentialite`), consentement explicite avant tout envoi à un service d'IA, OCR local par défaut.

## 7. Tests

```bash
npm run test:unit            # 129 tests : moteur de calcul, audit V2, banque V3, santé, opportunités, montants, dates, CSV, OCR
# Intégration : base dédiée
bash scripts/setup-local-db.sh moneta_test
MIGRATION_DATABASE_URL=postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_test npm run db:migrate
npm run test:integration     # 63 tests : RLS, auth, soldes, transferts, import, récurrences, démo, RGPD, outils IA, synchro bancaire
# Bout en bout : base dédiée + build de production
bash scripts/setup-local-db.sh moneta_e2e
MIGRATION_DATABASE_URL=postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_e2e npm run db:migrate
npm run build && npm run test:e2e   # parcours, V2 (20 pages × clair/sombre, console), V3 banque (Powens simulé), mobile Pixel 7 + iPhone SE
```

Synchronisation bancaire : `tests/unit/bank.test.ts` (29 tests) et `tests/integration/bank.test.ts` (37 tests, réponses
Powens simulées). Les tests e2e démarrent `tests/e2e/powens-mock.mjs`, un serveur Powens **fictif** local, et interceptent
la webview réelle : aucune banque réelle n'est contactée.

## 8. Déploiement

### Base de données (Supabase, Neon, RDS, PostgreSQL auto-hébergé…)

1. Créer le projet / la base. Avec **Supabase** : *Project Settings → Database* donne l'URL du rôle `postgres`.
2. Créer le rôle d'exécution (SQL Editor) :
   ```sql
   create role moneta_app login password 'MOT_DE_PASSE_FORT' nosuperuser nobypassrls;
   grant connect on database postgres to moneta_app;
   ```
3. Appliquer les migrations depuis votre poste :
   `MIGRATION_DATABASE_URL=postgres://postgres:...@db.<ref>.supabase.co:5432/postgres npm run db:migrate`
4. `DATABASE_URL` = même hôte avec l'utilisateur `moneta_app`. Avec le *pooler* Supabase en mode transaction
   (port 6543), ajouter `DATABASE_DISABLE_PREPARE=true`.

### Application (Vercel)

1. Importer le dépôt, **Root Directory = `moneta`**, framework Next.js (détecté).
2. Renseigner les variables d'environnement (§3) — au minimum `DATABASE_URL`, `APP_URL`, `APP_ENCRYPTION_KEY`,
   `CRON_SECRET` ; idéalement SMTP, `ANTHROPIC_API_KEY`, VAPID.
3. `vercel.json` déclare la tâche quotidienne (`/api/cron/daily`, 05:17 UTC) : Vercel envoie
   `Authorization: Bearer $CRON_SECRET` automatiquement.
4. Région `cdg1` (Paris) par défaut — placer la base dans la même région.

Autre hébergeur Node : `npm ci && npm run build && npm start` (port 3000) derrière un proxy HTTPS, et appeler
`/api/cron/daily` une fois par jour avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## 9. Sauvegarde et restauration

```bash
npm run db:backup                      # → backups/moneta-AAAAMMJJ-HHMMSS.dump (pg_dump, format custom)
# Restauration dans une base NEUVE et vide :
bash scripts/setup-local-db.sh moneta_restauree
MIGRATION_DATABASE_URL=postgres://moneta_owner:...@localhost:5432/moneta_restauree \
  bash scripts/restore.sh backups/moneta-XXXX.dump
```
La sauvegarde contient schéma, données, politiques RLS et historique des migrations ; le script réapplique les
droits du rôle `moneta_app`. Chiffrez les sauvegardes avant de les stocker hors du serveur (`gpg -c`).
Supabase propose aussi des sauvegardes quotidiennes automatiques (offres payantes : restauration à un instant donné).

## 10. Intégrations externes

| Intégration | État | Ce qu'il faut fournir |
|---|---|---|
| Conseiller IA + vision ticket (Anthropic, modèle `claude-opus-5-5`) | développé, testé sans clé | `ANTHROPIC_API_KEY` |
| E-mail (nodemailer / SMTP) | développé | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| Notifications push Web | développé | `npx web-push generate-vapid-keys` → `VAPID_*` |
| Connexion bancaire DSP2 (Powens) | V3 développée et testée contre un serveur simulé, **non testée contre l'API réelle** | contrat Powens + `POWENS_DOMAIN`, `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET`, `POWENS_WEBHOOK_SECRET`, URL de retour `APP_URL/api/bank/callback` et webhooks `APP_URL/api/webhooks/powens?event=…` déclarés chez Powens ([`docs/BANQUE.md`](./docs/BANQUE.md)) |
| OCR local (tesseract.js) | développé | rien (modèle français téléchargé depuis jsDelivr par le navigateur) |

Le conseiller IA n'accède jamais directement à la base : il appelle des outils en lecture seule qui renvoient
des statistiques calculées par le moteur ; il peut seulement **proposer** une opération que l'utilisateur confirme.

## 11. Limites connues

Voir le rapport de livraison. Principales : connecteur Powens non testé faute d'identifiants ; une seule devise
d'affichage par utilisateur, appliquée partout mais **sans conversion** (aucune source de taux de change configurée) ; interface uniquement en français ; documents limités à 8 Mo et stockés en base ;
l'OCR local est moins précis sur les tickets froissés ; l'historique des conversations IA n'est pas conservé (choix de
confidentialité).
