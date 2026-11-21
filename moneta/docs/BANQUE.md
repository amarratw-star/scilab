# Synchronisation bancaire (V3)

MONETA lit les comptes bancaires de l'utilisateur via **Powens**, agrégateur agréé DSP2
(service d'information sur les comptes). L'intégration est **en lecture seule** : aucun endpoint de
paiement ou de virement n'est appelé, et aucune fonctionnalité de paiement n'existe dans l'application.

> État honnête : l'intégration a été développée d'après la documentation officielle
> (docs.powens.com, consultée le 21/11/2026) et testée contre un **serveur Powens simulé**.
> Elle n'a **jamais été exécutée contre l'API Powens réelle** (aucun identifiant client disponible).
> Voir « Avant la mise en production ».

## 1. Principes de sécurité

| Règle | Mise en œuvre |
| --- | --- |
| L'utilisateur ne transmet jamais ses identifiants bancaires à MONETA | Authentification exclusivement dans la webview Powens / chez la banque (SCA). Aucun champ identifiant/mot de passe bancaire dans MONETA. |
| Pas de contournement de l'authentification forte | Les états `SCARequired`, `webauthRequired`, `decoupled`… renvoient vers la webview de **reconnexion**. |
| Jetons jamais exposés au navigateur | Jeton permanent Powens chiffré AES-256-GCM (`bank_users.access_token_enc`), utilisé uniquement côté serveur. Les vues envoyées au client ne contiennent ni jeton ni identifiant externe (testé). |
| IBAN jamais complet | Seul `FR76 •••• •••• 1234` est stocké (`maskIban`). |
| Pas de clé inventée | Sans `POWENS_DOMAIN` / `POWENS_CLIENT_ID` / `POWENS_CLIENT_SECRET` / `APP_ENCRYPTION_KEY`, la fonctionnalité est désactivée et l'interface l'indique. |
| Démonstration séparée | Espaces de démo et espaces contenant des données fictives : connexion bancaire refusée (UI + API + webhooks ignorés). |
| Webhook non fiable par défaut | Signature HMAC (si clé configurée) et/ou jeton utilisateur vérifiés en temps constant, déduplication, contenu validé, l'utilisateur est retrouvé uniquement via une fonction SQL `SECURITY DEFINER` restreinte. |
| CSRF du parcours | `state` aléatoire (24 octets) en cookie `httpOnly` `SameSite=Lax` limité à `/api/bank/callback`, 10 min, comparé en temps constant. |
| Hôte de test | `POWENS_API_BASE_OVERRIDE` n'est accepté que sur `127.0.0.1`/`localhost`. |

## 2. Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `POWENS_DOMAIN` | Domaine client Powens (`monappli-sandbox` ou `monappli-sandbox.biapi.pro`). Le bac à sable est un domaine distinct de la production ; l'interface affiche un avertissement si le nom contient `sandbox`/`test`. |
| `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET` | Identifiants de l'application (console Powens). Utilisés uniquement pour `POST /auth/init`. |
| `POWENS_WEBHOOK_SECRET` | Clé HMAC des webhooks (facultative mais **recommandée**). Si définie, la signature devient obligatoire. |
| `APP_ENCRYPTION_KEY` | ≥ 32 caractères, chiffrement des jetons. **Ne jamais la changer** sans re-chiffrer `bank_users`. |
| `APP_URL` | URL publique : sert à construire `redirect_uri` = `{APP_URL}/api/bank/callback` (à déclarer dans la console Powens). |
| `CRON_SECRET` | Tâche quotidienne (synchronisation de secours). |
| `POWENS_API_BASE_OVERRIDE` | **Tests uniquement** (serveur simulé local). |

## 3. Configuration côté Powens (console)

1. Déclarer l'URL de retour : `{APP_URL}/api/bank/callback`.
2. Enregistrer un webhook **par événement**, avec le nom dans l'URL :
   - `{APP_URL}/api/webhooks/powens?event=CONNECTION_SYNCED`
   - `…?event=CONNECTION_DELETED`, `…?event=ACCOUNT_DISABLED`, `…?event=ACCOUNT_ENABLED`, `…?event=USER_DELETED`
3. Choisir l'authentification HMAC et reporter la clé dans `POWENS_WEBHOOK_SECRET` (sinon : jeton utilisateur par défaut).
4. La compression gzip des webhooks est supportée.

## 4. Endpoints Powens utilisés (vérifiés dans la documentation)

| Usage | Appel |
| --- | --- |
| Créer l'utilisateur Powens (1 par utilisateur MONETA) | `POST /2.0/auth/init` `{client_id, client_secret}` → `{auth_token, id_user}` |
| Code temporaire pour la webview | `GET /2.0/auth/token/code` |
| Webview | `https://webview.powens.com/fr/{connect|reconnect|manage}?domain=…&client_id=…&redirect_uri=…&code=…&state=…[&connection_id][&connector_uuids&connector_capabilities=bank]` |
| Liste des banques | `GET /2.0/connectors` (filtre `hidden`, capacité `bank`) — **pas de logo documenté** : pastille couleur + initiales |
| Connexions | `GET /2.0/users/me/connections?expand=connector`, `GET …/connections/{id}` |
| Demande de synchronisation | `PUT /2.0/users/me/connections/{id}` |
| Suppression | `DELETE /2.0/users/me/connections/{id}`, `DELETE /2.0/users/me` (effacement du compte) |
| Comptes | `GET /2.0/users/me/connections/{id}/accounts?all` |
| Opérations | `GET /2.0/users/me/transactions?limit=1000&min_date|last_update&all` + pagination `_links.next` (même origine uniquement) |

Retries : 3 tentatives avec attente progressive sur erreur réseau, 429 et 5xx ; délai de 25 s par appel.

## 5. Flux

```
Utilisateur ── Comptes › Connecter une banque ──► /connecter-banque (recherche, GET /api/bank/connectors)
   └─► POST /api/bank/connect  → bank user (auth/init si besoin) → code temporaire → URL webview + cookie state
        └─► webview Powens → banque (SCA) → choix des comptes partagés
             └─► GET /api/bank/callback?connection_id&state   (ou ?error=access_denied…)
                  vérif. state → pullSync(connexion) → /comptes?banque=ok&nouvelles=N
Ensuite : webhooks CONNECTION_SYNCED (toutes les ~24 h côté Powens) ; bouton « Actualiser » (limité à 1 / 5 min) ;
cron quotidien de secours si aucune mise à jour depuis 26 h (et préférence « synchronisation automatique » active).
```

## 6. Modèle de données

- `bank_users` : utilisateur Powens + jeton chiffré (RLS).
- `bank_connections` : état Powens (`state`), `last_sync_at`, `next_sync_at`, `expires_at`, `syncing`, banque (nom, couleur).
- `bank_account_links` : compte Powens ↔ compte MONETA, `sync_enabled`, IBAN masqué, **dernier solde bancaire connu** (jamais remplacé par une valeur absente), `disabled_at_bank`.
- `transactions` : `external_id` (unique par utilisateur), `bank_status` (`coming|booked|deleted`), `bank_label`, `bank_category`, `value_date`, `category_source`, `category_confidence`, `imported_at`, `verified_at`.
- `tx_reconciliations` : traçabilité (doublon suggéré/fusionné/conservé/annulé, attente remplacée, virement interne).
- `merchant_rules` : règles de catégorisation de l'utilisateur.
- `sync_runs` : historique (sans donnée sensible). `webhook_events` : déduplication `id_webhook_data`.

## 7. Règles d'ingestion

| Cas | Comportement |
| --- | --- |
| Opération comptabilisée | `status = posted` |
| En attente (`coming`) | `status = planned` : déduite **une seule fois** du disponible (« dépenses prévues »), absente des statistiques |
| En attente → comptabilisée, même id | mise à jour de la même ligne |
| En attente → comptabilisée, nouvel id | l'attente (même compte, même montant, ≤ 7 j) est annulée et tracée (`pending_superseded`) |
| Supprimée par la banque | `status = cancelled`, conservée |
| Modifiée | montant/date/libellé bancaire mis à jour ; la catégorie choisie par l'utilisateur n'est jamais écrasée |
| Rejeu, webhooks dupliqués, synchros concurrentes | idempotent : index unique + verrou consultatif par utilisateur + `webhook_events` |
| Donnée incomplète (date/montant absent) | ignorée et comptée (`skipped`), jamais inventée |
| Remboursement (`payback`) | `kind = refund` |
| Virement entre deux comptes de l'utilisateur | débit converti en transfert, crédit annulé (tracé) : ni revenu ni dépense |
| Opération supprimée par l'utilisateur | masquée (`cancelled`) pour ne pas être réimportée |
| Premier import d'un compte | solde initial = solde bancaire − effet des opérations importées → le moteur V2 retrouve exactement le solde bancaire |

### Doublons manuel ↔ banque (`src/lib/bank/matching.ts`)

Score 0–100 : même compte et même sens, montant identique (±1 %), ≤ 5 jours, + proximité de date et similarité de libellé.
- **≥ 80 et non ambigu** (un seul candidat, aucune autre opération bancaire identique) → fusion automatique :
  la saisie manuelle est enrichie des données bancaires, l'instantané d'origine est conservé, **annulable**.
- **≥ 55** ou ambigu (achats identiques légitimes) → proposition dans « Opérations à vérifier » : *Fusionner* (la saisie est annulée, jamais supprimée ; catégorie, notes et justificatifs reportés) ou *Garder les deux*.
- Rapprochement d'un compte manuel avec un compte synchronisé : uniquement sur confirmation explicite ; les doublons résultants sont **proposés**.

### Catégorisation (`src/lib/bank/categorize.ts`)

Ordre : règle de l'utilisateur (95) › catégorie bancaire reconnue (70) › historique du commerçant (85 si ≥ 3, 75 si 2, part ≥ 80 %) › moteur local (60).
Sous 70 : signalée « incertaine » à valider. Une correction devient un choix utilisateur (apprentissage) ; après 2 corrections identiques, MONETA propose une règle. Une règle ne s'applique au passé **que si l'utilisateur coche la case**. La catégorisation par IA n'est **pas** implémentée dans cette version.

## 8. États de connexion (`src/lib/bank/states.ts`)

| État Powens | Libellé | Action proposée |
| --- | --- | --- |
| `null` | Connectée | — |
| `SCARequired`, `webauthRequired` | Autorisation expirée | Reconnecter |
| `additionalInformationNeeded` | Action nécessaire | Reprendre la connexion |
| `decoupled`, `validating` | Action nécessaire | Valider dans l'appli bancaire |
| `actionNeeded` | Action nécessaire | Action sur le site de la banque |
| `passwordExpired` | Action nécessaire | Changer le mot de passe puis reconnecter |
| `wrongpass` | Connexion interrompue | Reconnecter |
| `rateLimiting`, `websiteUnavailable`, `bug` | Erreur temporaire | Attendre (reprise automatique) |
| inconnu | Connexion interrompue | Reconnecter (compatibilité ascendante) |

Dans tous les cas, les dernières données connues restent affichées.

## 9. Tests

- `tests/unit/bank.test.ts` : catégorisation, doublons, attente/comptabilisée, virements, états, IBAN, centimes, signature HMAC, gzip.
- `tests/integration/bank.test.ts` (PostgreSQL + RLS, Powens simulé par `fetch` factice) : première synchro, idempotence, concurrence, solde absent, données incomplètes, cycle de vie, doublons (auto/proposé/annulation), apprentissage, préférences, isolation, webhooks (jeton, doublon, HMAC, corps invalide, erreur), erreurs 5xx/réseau, pagination sûre, gestion des comptes et connexions.
- `tests/e2e/v3-banque.spec.ts` + `tests/e2e/powens-mock.mjs` : parcours complet dans un vrai navigateur contre un serveur Powens simulé ; la webview réelle est interceptée.

## 10. Avant la mise en production

1. Contrat Powens, domaine sandbox puis production, `client_id` / `client_secret`.
2. Tester en **bac à sable** : création d'utilisateur, webview, connecteur de test, webhooks réels (format exact de `CONNECTION_SYNCED`, en-têtes HMAC), pagination, états SCA.
3. Points non documentés à confirmer : identifiant d'une opération en attente une fois comptabilisée (les deux cas sont gérés), codes de catégories Powens (rapprochement par mots-clés), logos des banques.
4. Déclarer les webhooks par événement, activer HMAC, configurer `CRON_SECRET` et la tâche quotidienne.
5. Revue juridique : mentions DSP2 / RGPD, durée de conservation, sous-traitance Powens.
