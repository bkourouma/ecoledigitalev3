# Feature Specification : Paiements en ligne — adaptateurs réels et configuration par tenant (015-payments)

**Statut** : rédigée et implémentée dans le module `apps/api/src/modules/finance` (`infrastructure/providers/`, migration `0505`). Le port `PaymentProvider`, le `ProviderRegistry`, la `SandboxProvider` et les webhooks idempotents appartiennent à `014-finance` (README du module) ; cette spec ajoute les **adaptateurs réels**, le **coffre des identifiants marchands** et l'**écran d'administration**. Décisions et zones d'incertitude : `open-questions.md`. Reprise du legacy : `parity.md`.

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
- **AC2.1** Le webhook `POST|PUT /api/v1/finance/webhooks/:provider/:tenantId` est public ; **l'authenticité fait foi** : signature HMAC documentée du fournisseur quand elle existe (Wave : `Wave-Signature`, CinetPay : `x-token`, TresorPay : `x-signature`), sinon **URL signée** (Orange, MTN : `?ref=<paiement>&sig=<HMAC(secret)>`) **plus** vérification active auprès du fournisseur.
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

### US5 — Remboursement fournisseur
- **AC5.1** Le port expose une méthode **optionnelle** `refund` ; implémentée pour Wave (remboursement total) et MTN (Refund de la Collection API, zone d'incertitude). Orange Money Web Payment, CinetPay Checkout et TresorPay n'en ont pas de documentée publiquement : `refund` absente ⇒ le remboursement reste comptable (comportement de 014).
- **AC5.2** Le branchement du cas d'usage `completeRefund` sur `refund` est **hors de cette tranche** (point à arbitrer).

## 4. Règles métier

- R-PAY-01 Hors `development`/`test`, un fournisseur non configuré est refusé ; aucune simulation implicite (014).
- R-PAY-02 Un établissement sans configuration propre n'utilise **jamais** les identifiants de l'environnement, sauf `FINANCE_PROVIDER_ENV_FALLBACK=true` (déploiement mono-établissement) ; hors développement, le défaut est « non ».
- R-PAY-03 Un paiement dont le fournisseur renvoie `FAILED`/`EXPIRED`/`CANCELLED` ne peut plus être encaissé : un succès tardif est signalé pour rapprochement, jamais appliqué.
- R-PAY-04 Un statut inconnu du fournisseur est traité comme **en attente**, jamais comme un succès ni un échec définitif.
- R-PAY-05 Aucun montant décimal n'est accepté en retour : `"1000"`, `1000`, `"1000.00"` valent 1000 ; `"1000.5"` ou `1e3` sont rejetés (réponse malformée).

## 5. Endpoints, permissions, événements

| Route (`/api/v1/finance`) | Permission |
|---|---|
| `GET /providers`, `PUT /providers/:provider`, `PATCH /providers/:provider/status`, `POST /providers/:provider/test`, `DELETE /providers/:provider/credentials`, `POST /providers/rotate-secrets` | `finance.provider.manage` (**sensible**) |
| `POST|PUT|GET /webhooks/:provider/:tenantId` | publique (authenticité par adaptateur) |

Événements inchangés (`finance.payment.initiated|completed|failed`). Audit : `finance.provider.configured|status_changed|tested|credentials_cleared|secrets_rotated`, `finance.provider_secret.accessed`, `finance.webhook.rejected`.

## 6. TresorPay

Le legacy l'utilise pour la **scolarité** (`student-payments.ts`, `ENV_EXAMPLE.md` : « Paiement des frais de scolarité »). L'adaptateur est donc livré, mais **aucune documentation publique** n'a été trouvée : le contrat (chemins, signature `HMAC-SHA256(méthode+chemin+corps+horodatage)`, webhook `x-signature`) est celui du client legacy (`tresorpay-gateway.service.ts`), à valider avec TresorPay avant production (`open-questions.md` Q-PAY-09).

## 7. Écrans

`/v2/finance/providers` (client typé `apps/web/src/platform`) : une carte par fournisseur (état, mode, champs, indicateur « enregistré » sans valeur, URL de webhook à copier, bouton « Tester la connexion », activer/désactiver, effacer les identifiants). i18n fr-CI sous `v2FinanceProviders`.

## 8. Cas limites

Perte de la réponse d'initiation Orange (pas de `pay_token`, donc pas de vérification possible : le paiement reste en attente et se rapproche à la main) ; webhook reçu avant que l'API de statut ne reflète la transaction (409, le fournisseur réessaie) ; changement de clé maître en cours de journée (trousseau) ; tenant désactivé pendant un paiement en attente (la vérification active échoue proprement, le paiement reste en attente) ; montant XOF non multiple de 5 pour CinetPay ; numéro de téléphone absent pour MTN (refus avant appel).

## 9. Dépendances

014-finance (port, registre, webhooks, `payments`), 002 auth-rbac (permission sensible), audit, kernel (`Money`, `Result`).
