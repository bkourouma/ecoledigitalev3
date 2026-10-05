# Feature Specification : Paiements en ligne — adaptateurs réels et configuration par tenant (015-payments)

**Statut** : rédigée et implémentée dans le module `apps/api/src/modules/finance` (`infrastructure/providers/`, migration `0505`). Le port `PaymentProvider`, le `ProviderRegistry`, la `SandboxProvider` et les webhooks idempotents appartiennent à `014-finance` (README du module) ; cette spec ajoute les **adaptateurs réels**, le **coffre des identifiants marchands**, l'**écran d'administration**, puis (migration `0506`) le **rapprochement planifié** des paiements en attente, le **remboursement réel chez le fournisseur** et la **résolution manuelle à quatre yeux** (US5 à US7). Décisions et zones d'incertitude : `open-questions.md`. Reprise du legacy : `parity.md`.

## 1. Objectifs

1. Encaisser la scolarité par Mobile Money et carte en Côte d'Ivoire : **Orange Money** (Web Payment), **MTN MoMo** (Collection), **Wave** (Checkout), **CinetPay** (agrégateur cartes + mobile money), **TresorPay** (hérité du legacy, voir §6).
2. Zéro faille héritée du legacy : signatures de webhook vérifiées (jamais « true » par défaut), montants entiers (`Money`), aucun repli silencieux en simulation, aucun secret en clair.
3. Chaque établissement porte **ses propres** identifiants marchands : l'argent d'un établissement n'arrive jamais sur le compte d'un autre ni de la plateforme.

## 2. Acteurs

| Acteur | Besoin |
|---|---|
| Parent / élève | Payer une facture depuis son portail (`POST /finance/me/learners/:id/payments/online`), avec Orange Money, MTN MoMo, Wave ou carte. |
| Économe / direction | Voir le paiement passer de « en attente » à « confirmé » sans saisie ; rapprocher un paiement divergent. |
| Administrateur d'établissement (permission `finance.provider.manage`, **sensible : MFA**) | Activer un fournisseur, saisir les identifiants marchands (jamais réaffichés), tester la connexion, copier l'URL de webhook, faire tourner les clés de chiffrement. |
| Opérateur plateforme | Fixer l'environnement (`FINANCE_ENV`), la clé maître (`FINANCE_SECRETS_KEYS`), les points d'accès de production. |

## 3. User stories et critères d'acceptation

### US1 — Initier un paiement avec un fournisseur réel
- **AC1.1** La référence de commande envoyée au fournisseur est **l'identifiant du paiement** (ou son encodage compact réversible quand le fournisseur impose une longueur : CinetPay ≤ 25, Orange ≤ 30).
- **AC1.2** Montants **entiers** en XOF : aucun flottant ni conversion décimale ; un montant que le fournisseur ne peut pas porter (CinetPay : multiple de 5, minimum 100) est refusé **avant** l'appel (`finance.invalid_amount`).
- **AC1.3** L'initiation est **rejouable** : même paiement ⇒ pas de seconde transaction côté fournisseur (MTN : `X-Reference-Id` stable ; Wave : recherche par `client_reference` avant création ; CinetPay : `transaction_id` unique).
- **AC1.4** Délais d'attente par appel (15 s par défaut), reprises bornées avec attente exponentielle **uniquement** pour les appels sûrs à rejouer (lectures, jetons, appels idempotents) ; un POST non idempotent n'est jamais rejoué après une réponse ambiguë.
- **AC1.5** Jetons OAuth (Orange, MTN) : mis en cache jusqu'à 60 s avant l'expiration, **une seule requête de renouvellement** à la fois (single-flight), invalidés et rejoués une fois sur 401.
- **AC1.6** Mode `sandbox` / `production` **explicite** par tenant (jamais de valeur par défaut) : `sandbox` est refusé en `production` (`finance.provider_sandbox_forbidden`).

### US2 — Confirmer un paiement (webhook et vérification active)
- **AC2.1** Le webhook `POST|PUT /api/v1/finance/webhooks/:provider/:tenantId` est public ; **l'authenticité fait foi** : signature HMAC documentée du fournisseur quand elle existe (Wave : `Wave-Signature`, CinetPay : `x-token`, TresorPay : `x-signature`), sinon **URL à jeton** (Orange : `?ref=<paiement>&t=<HMAC(secret, tenant|fournisseur|paiement)>` ; MTN : `?t=<HMAC(secret, tenant|fournisseur)>`) **plus** vérification active auprès du fournisseur.
- **AC2.2** `verifySignature` renvoie **`false`** si le secret est absent, la signature illisible ou la comparaison échoue ; comparaison **à temps constant**.
- **AC2.3** Un webhook qui n'est qu'un **indice** (Orange, MTN, CinetPay : pas de signature de contenu) est confirmé en interrogeant l'API de statut du fournisseur : seul le montant, la devise et le statut de **cette** réponse sont crus. Réponse indisponible ou incohérente avec l'indice ⇒ erreur 409, rien n'est stocké, le fournisseur réessaie.
- **AC2.4** Avant toute confirmation, finance compare **montant et devise** du fournisseur au paiement en base, et la **référence** fournisseur quand les deux existent ; divergence ⇒ événement `FAILED`, paiement inchangé, audit sensible `finance.webhook.rejected` (rapprochement manuel).
- **AC2.5** **Rejeu** : clé unique `(tenant, fournisseur, event_id)` ; un même événement ne rien retraite. Wave : horodatage de la signature borné à ± 5 minutes (anti-rejeu hors idempotence).
- **AC2.6** Le contenu stocké dans `webhook_events.payload` est **expurgé** par l'adaptateur (numéros masqués, jetons retirés).

### US3 — Configurer les fournisseurs d'un établissement
- **AC3.1** `GET /api/v1/finance/providers` liste, pour chaque fournisseur du catalogue : état (`enabled`, `mode`, `configured`), champs attendus, **présence** de chaque secret (booléen), valeurs non secrètes, URL de webhook, dernier test. **Aucun secret n'est jamais renvoyé.**
- **AC3.2** `PUT /providers/:provider` enregistre mode, réglages non secrets et secrets ; un secret omis est **conservé**, `clearSecrets` en retire. Champs inconnus refusés (aucune URL de point d'accès n'est configurable par le tenant : pas de SSRF).
- **AC3.3** `PATCH /providers/:provider/status` active ou désactive ; l'activation exige une configuration complète ; un fournisseur désactivé répond `finance.provider_disabled`.
- **AC3.4** `POST /providers/:provider/test` interroge le fournisseur **sans jamais créer de paiement** (jeton, recherche d'une référence inexistante) et enregistre le résultat (code, jamais de message du fournisseur).
- **AC3.5** `DELETE /providers/:provider/credentials` efface tous les secrets et désactive. `POST /providers/rotate-secrets` rechiffre les secrets du tenant avec la clé active.
- **AC3.6** Chaque écriture est **auditée** (action `finance.provider.*`, sensible, **noms** des champs, jamais de valeur) ; chaque déchiffrement pour usage est audité (`finance.provider_secret.accessed`) au remplissage du cache de configuration.
- **AC3.7** RLS : un tenant ne lit ni n'écrit la configuration d'un autre (test A/B).

### US4 — Coffre des secrets
- **AC4.1** Chiffrement applicatif **AES-256-GCM**, clé maître d'environnement (`FINANCE_SECRETS_KEYS` = `id:base64(32 octets)[,…]`, `FINANCE_SECRETS_ACTIVE_KEY`), AAD = `tenant|fournisseur|champ` : un chiffré ne se rejoue pas pour un autre tenant ou un autre champ.
- **AC4.2** Aucune clé maître ⇒ le coffre est **indisponible** : saisie et lecture refusées (`finance.secrets_unavailable`), fournisseurs « non configurés » ; jamais de secret en clair en repli.
- **AC4.3** Rotation : nouvelle clé ajoutée au trousseau et déclarée active ; l'ancienne reste lisible jusqu'au rechiffrement complet.
- **AC4.4** La base refuse un secret non scellé (contrainte `CHECK` sur le format de l'enveloppe) ; aucun secret en clair en base, dans les journaux, dans l'audit ni dans une réponse.

### US5 — Remboursement réel chez le fournisseur
- **AC5.1** Le port expose une méthode **optionnelle** `refund` et ses **capacités** (`refundCapabilities` : partiel ?, idempotent ?, lecture d'état ?) ; implémentée pour Wave (total, idempotent, documenté), MTN (Refund de la Collection API : partiel, asynchrone, lecture `GET refund/{id}`, zone d'incertitude Q-PAY-10), TresorPay (contrat legacy, **non idempotent**) et la sandbox (simulation). Orange Money Web Payment et CinetPay Checkout n'ont pas d'API publique de remboursement : `refund` absente.
- **AC5.2** `completeRefund` / `approveRefund` choisissent la **route d'exécution** sans appel réseau (`planRefundRoute`) : `LEDGER` (paiement saisi à la main : écriture comptable, comportement de 014), `PROVIDER` (paiement en ligne dont le fournisseur sait rembourser) ou `MANUAL_REQUIRED` (pas d'API, partiel refusé par le fournisseur, fournisseur désactivé / non configuré, référence du paiement inconnue).
- **AC5.3** **États** : `APPROVED → REFUND_PENDING → COMPLETED | REFUND_FAILED`. `REFUND_PENDING` = envoyé au fournisseur sans conclusion ; `COMPLETED` = remboursé (c'est l'état « REFUNDED » du remboursement : le **paiement** devient `REFUNDED` quand le cumul remboursé égale son montant) ; `REFUND_FAILED` = refus définitif, rien n'est parti. Le grand livre (reprises d'imputation, cumul remboursé, statut des factures) n'est écrit **qu'à `COMPLETED`** et uniquement par écritures inverses immuables ; un remboursement en vol ou refusé ne laisse rien à défaire.
- **AC5.4** **Jamais de double remboursement** : (1) l'intention d'envoi est durable (`REFUND_PENDING` en transaction) **avant** l'appel réseau, qui se fait hors transaction avec une référence d'idempotence stable (l'identifiant du remboursement : `X-Reference-Id` MTN, session Wave) ; (2) le montant d'un remboursement `REFUND_PENDING` reste **réservé** (aucune demande ne peut dépasser le remboursable) ; (3) une réponse **ambiguë** (délai, 5xx, réponse illisible) ne conclut rien et n'autorise **jamais** un renvoi aveugle : le rapprochement lit l'état chez le fournisseur et ne renvoie la **même** demande que si le fournisseur est idempotent ; sinon il signale `finance.refund.reconciliation_needed` ; (4) rejeu d'`approve` / `complete` sur un remboursement en vol ou terminé : conflit, aucun envoi ; (5) approbations concurrentes : un seul envoi.
- **AC5.5** **Refus définitif avant envoi** (validation de l'adaptateur, 4xx non retriable) ⇒ `REFUND_FAILED` ; **réponse ambiguë** ⇒ reste `REFUND_PENDING`.
- **AC5.6** **Repli « remboursement manuel » explicite et audité** (`manual: { reference, note? }` dans `approve` ou `complete`) : accepté seulement pour une route `MANUAL_REQUIRED` ; **refusé** (409 `finance.refund_manual_not_allowed`) quand le fournisseur sait rembourser (risque de double remboursement) ; sans preuve (3 à 120 caractères) ⇒ 409 `finance.refund_manual_required`. Écritures identiques à `LEDGER` avec `execution_mode = MANUAL`, référence conservée, audit sensible `finance.refund.completed_manually`. `approve` sans preuve sur une route manuelle approuve seulement : le remboursement reste `APPROVED`.

### US6 — Rapprochement planifié des paiements en attente
- **AC6.1** Le job du worker `finance.reconcile-pending-payments` (toutes les 2 minutes) parcourt les tenants actifs un à un, par lots (`FINANCE_RECONCILIATION_BATCH_SIZE`), et interroge le fournisseur (registre et coffre assemblés comme dans l'API : `createFinanceProviderRuntime`) pour chaque paiement en ligne `PENDING` plus ancien que `FINANCE_RECONCILIATION_MIN_AGE_MS` (défaut 15 min : laisse sa chance au webhook).
- **AC6.2** L'issue est appliquée par **le même code que le webhook** (`applyProviderOutcome` : montant, devise, référence, paiement simulé) : succès ⇒ confirmé (reçu, imputation, `finance.payment.completed`) ; échec / session expirée ⇒ `FAILED` avec motif ; « en attente » ou fournisseur injoignable ⇒ nouvelle tentative avec attente exponentielle (base 10 min, plafond 4 h) ; montant / référence divergents ⇒ **rien n'est encaissé**, signalé.
- **AC6.3** Le nombre de tentatives est **plafonné** (`FINANCE_RECONCILIATION_MAX_ATTEMPTS`, défaut 12 ≈ 33 h) : au-delà, le sujet est **signalé** (jamais présumé réussi ni échoué).
- **AC6.4** **Signalement** `finance.payment.reconciliation_needed` (événement outbox `{ v: 1, subject, paymentId, learnerId, amount, provider, reason, attempts, lastErrorCode }` + audit sensible + alerte via le port facultatif `FinanceAlertPort`, journal d'erreur `alert: true` par défaut) pour : référence fournisseur absente avec un fournisseur qui n'a aucun moyen de vérifier sans elle (Orange Money sans `pay_token`, TresorPay) — signalé **dès la première passe** sans appel ; tentatives épuisées ; fournisseur désactivé / non configuré ; divergence de montant ou de référence. Un seul signalement par sujet.
- **AC6.5** **Idempotent** (traitement sous verrou de ligne, jamais de second reçu), **plusieurs instances sans doublon** (bail `FOR UPDATE SKIP LOCKED` dans `finance.reconciliation_state`), **reprise après plantage** (le bail expire), **audité** (effets passés par les cas d'usage audités, même clé HMAC `AUDIT_HMAC_KEY` que l'API), **isolé par tenant** (RLS ; un tenant en échec est rapporté sans arrêter les autres : le job échoue APRÈS avoir traité tous les tenants).
- **AC6.6** **Métriques** par le port facultatif `FinanceMetricsPort` : `finance_reconciliation_total{subject, outcome}`, `finance_reconciliation_runs_total`, `finance_provider_refund_total{provider, outcome}` (aucun, par défaut).
- **AC6.7** Les **remboursements** `REFUND_PENDING` sont rapprochés par le même job : lecture d'état si le fournisseur en offre une (MTN) ; sinon renvoi de la **même** demande seulement si le fournisseur est idempotent (Wave) ; sinon signalement `finance.refund.reconciliation_needed` (TresorPay).
- **AC6.8** `GET /payments/pending` (permission `finance.payment.read`) liste les paiements en ligne en attente, signalés d'abord, avec tentatives, prochaine vérification, motif et demande de résolution ouverte ; écran `/v2/finance/payments/pending`. « Vérifier maintenant » reste `POST /payments/:id/verify`.

### US7 — Résolution manuelle par une seule personne (Q-PAY-38, MFA récente)
- **AC7.1** Permission **sensible** `finance.payment.reconcile` (MFA) ET step-up MFA récent (`finance.mfa_required` sinon). Une personne **résout** (`POST /resolutions`, demande et application en une transaction) : sujet (paiement `PENDING` en ligne ou remboursement `REFUND_PENDING`), issue réelle (`SUCCEEDED` : l'argent est arrivé / parti ; `FAILED` : non), motif (10 à 500 caractères) et **preuve** (référence de relevé, 3 à 120 caractères). Une seule demande ouverte par sujet.
- **AC7.2** Aucun second approbateur (décision du 2026-10-05). L'application passe par `applyProviderOutcome` (mêmes reçus, imputations, événements) ou `applyRefundOutcomeInTx` ; audit sensible renforcé `finance.resolution.resolved` (état avant/après, acteur, motif, preuve, fenêtre MFA), atomique avec l'opération. `approve` / `reject` ne servent qu'à clore les demandes ouvertes avant cette décision.
- **AC7.3** Un paiement déjà `FAILED` dont le fournisseur annonce un succès tardif n'est pas réactivable (machine d'états figée) : on encaisse un nouveau paiement. Hors périmètre de cette tranche.

## 4. Règles métier

- R-PAY-01 Hors `development`/`test`, un fournisseur non configuré est refusé ; aucune simulation implicite (014).
- R-PAY-02 (révisée le 2026-10-05, Q-PAY-30) Chaque école utilise SON compte fournisseur ; sans configuration propre elle retombe sur le compte de la plateforme (identifiants d'environnement), sauf `FINANCE_PROVIDER_ENV_FALLBACK=false`. Une configuration propre désactivée n'ouvre pas le repli. Le compte utilisé est enregistré sur le paiement (`provider_account`) et interrogé à chaque vérification, webhook, rapprochement et remboursement ; rapprochement et rapports sont séparés par école. Le reversement des fonds partagés n'est pas modélisé.
- R-PAY-03 Un paiement dont le fournisseur renvoie `FAILED`/`EXPIRED`/`CANCELLED` ne peut plus être encaissé : un succès tardif est signalé pour rapprochement, jamais appliqué.
- R-PAY-04 Un statut inconnu du fournisseur est traité comme **en attente**, jamais comme un succès ni un échec définitif.
- R-PAY-05 Aucun montant décimal n'est accepté en retour : `"1000"`, `1000`, `"1000.00"` valent 1000 ; `"1000.5"` ou `1e3` sont rejetés (réponse malformée).
- R-PAY-06 Le rapprochement ne présume jamais d'une issue : un paiement indéterminé reste `PENDING` et est **signalé** ; seule une preuve du fournisseur (API de statut) ou une résolution manuelle approuvée par une autre personne le conclut.
- R-PAY-07 Un remboursement n'est écrit au grand livre que lorsque le fournisseur l'a confirmé (ou qu'une personne l'atteste avec preuve) ; il ne s'envoie qu'une fois, et se relit ou se renvoie (même référence) seulement si le fournisseur le garantit.

## 5. Endpoints, permissions, événements

| Route (`/api/v1/finance`) | Permission |
|---|---|
| `GET /providers`, `PUT /providers/:provider`, `PATCH /providers/:provider/status`, `POST /providers/:provider/test`, `DELETE /providers/:provider/credentials`, `POST /providers/rotate-secrets` | `finance.provider.manage` (**sensible**) |
| `POST|PUT|GET /webhooks/:provider/:tenantId` | publique (authenticité par adaptateur) |
| `GET /payments/pending`, `GET /resolutions` | `finance.payment.read` |
| `POST /resolutions`, `POST /resolutions/:id/approve`, `POST /resolutions/:id/reject` | `finance.payment.reconcile` (**sensible**, MFA ; l'approbateur ≠ le demandeur) |
| `POST /refunds/:id/approve` (`complete`, `manual?`), `POST /refunds/:id/complete` (`manual?`) | `finance.payment.refund` (**sensible**) |

Événements : `finance.payment.initiated|completed|failed` (inchangés) ; **ajoutés** : `finance.refund.submitted` (envoyé au fournisseur), `finance.refund.failed` (refus définitif), `finance.payment.reconciliation_needed`, `finance.refund.reconciliation_needed` ; `finance.refund.completed` porte `executionMode` (`LEDGER|PROVIDER|MANUAL`) et `provider`. Audit : `finance.provider.configured|status_changed|tested|credentials_cleared|secrets_rotated`, `finance.provider_secret.accessed`, `finance.webhook.rejected` ; **ajoutés** : `finance.refund.submitted|failed|completed_manually`, `finance.payment.reconciliation_needed`, `finance.refund.reconciliation_needed`, `finance.resolution.requested|approved|rejected`.

Variables (worker et API) : `FINANCE_RECONCILIATION_MIN_AGE_MS`, `_MAX_ATTEMPTS`, `_BACKOFF_BASE_MS`, `_BACKOFF_MAX_MS`, `_LEASE_MS`, `_BATCH_SIZE` (valeurs hors plage ignorées : défaut du module).

## 6. TresorPay

Le legacy l'utilise pour la **scolarité** (`student-payments.ts`, `ENV_EXAMPLE.md` : « Paiement des frais de scolarité »). L'adaptateur est donc livré, mais **aucune documentation publique** n'a été trouvée : le contrat (chemins, signature `HMAC-SHA256(méthode+chemin+corps+horodatage)`, webhook `x-signature`) est celui du client legacy (`tresorpay-gateway.service.ts`), à valider avec TresorPay avant production (`open-questions.md` Q-PAY-09).

## 7. Écrans

`/v2/finance/providers` (client typé `apps/web/src/platform`) : une carte par fournisseur (état, mode, champs, indicateur « enregistré » sans valeur, URL de webhook à copier, bouton « Tester la connexion », activer/désactiver, effacer les identifiants). i18n fr-CI sous `v2FinanceProviders`.

## 8. Cas limites

Perte de la réponse d'initiation Orange (pas de `pay_token`, donc pas de vérification possible : le paiement reste en attente, le job le **signale** dès la première passe et il se règle par résolution manuelle à quatre yeux) ; remboursement traité par le fournisseur mais réponse perdue (`REFUND_PENDING`, lecture d'état ou renvoi idempotent, jamais un second envoi aveugle) ; plantage du worker entre l'envoi et l'enregistrement de la conclusion (même reprise) ; remboursement manuel demandé pour un fournisseur qui sait rembourser (refusé) ; webhook reçu avant que l'API de statut ne reflète la transaction (409, le fournisseur réessaie) ; changement de clé maître en cours de journée (trousseau) ; tenant désactivé pendant un paiement en attente (la vérification active échoue proprement, le paiement reste en attente) ; montant XOF non multiple de 5 pour CinetPay ; numéro de téléphone absent pour MTN (refus avant appel).

## 9. Dépendances

014-finance (port, registre, webhooks, `payments`), 002 auth-rbac (permission sensible), audit, kernel (`Money`, `Result`).

## Évolution Q-PAY-32 — remboursement chez le fournisseur toujours manuel (décision du propriétaire, 2026-10)

L'exécution automatique d'un remboursement chez un fournisseur de paiement est **désactivée par défaut** (`config.providerRefundAutoExecution = false`, variable `FINANCE_PROVIDER_REFUND_AUTO=true` pour l'activer). Sans elle, un remboursement approuvé d'un paiement en ligne reste `APPROVED` jusqu'à l'**attestation manuelle avec preuve** (`finance.refund.completed_manually`, audit sensible, quatre yeux inchangés). Un remboursement déjà parti (`REFUND_PENDING`) reste conclu par le rapprochement. Voir `apps/api/src/modules/finance/README.md` § « Remboursement réel ».
