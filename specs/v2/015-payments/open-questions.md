# Zones d'incertitude documentaire et questions ouvertes — 015-payments

**Statut** : rédigé le 2026-10-02. Aucune documentation n'a pu être consultée en ligne pendant l'implémentation (environnement sans accès réseau externe) : les adaptateurs suivent la documentation publique **telle qu'elle est connue de l'implémenteur**. Chaque point ci-dessous est isolé derrière une méthode ou une constante **nommée** (colonne « Où ») pour être corrigé sans toucher au reste. **À valider contre la documentation officielle et le bac à sable de chaque fournisseur avant la mise en production.**

Légende de confiance : **Haute** (comportement stable et largement documenté), **Moyenne** (connu mais variable selon le compte ou la version), **Faible** (reconstitué, à vérifier impérativement).

## A. Zones d'incertitude techniques

| # | Fournisseur | Point | Hypothèse implémentée | Confiance | Où |
|---|---|---|---|---|---|
| Q-PAY-01 | Orange Money | Authentification des notifications | La notification (`status`, `notif_token`, `txnid`) n'est **pas signée**. Authenticité = URL de notification signée par nous (`?ref=…&sig=HMAC`) **et** vérification active par `transactionstatus` (`order_id`, `amount`, `pay_token`). | Moyenne | `OrangeMoneyProvider.verifySignature`, `buildSignedNotifyUrl` |
| Q-PAY-02 | Orange Money | Segment pays/sandbox des chemins (`/orange-money-webpay/{cm}/v1/…`) et devise de test | `cm = dev` en sandbox, code pays (`ci`) en production ; devise de test `OUV` (sandbox), `XOF` (production) | Moyenne | `OrangeMoneyProvider.pathSegment`, `providerCurrency` |
| Q-PAY-03 | Orange Money | Version du jeton OAuth | `POST /oauth/v3/token`, `Authorization: Basic base64(client_id:client_secret)`, `grant_type=client_credentials` | Moyenne | `OrangeMoneyProvider.tokenRequest` |
| Q-PAY-04 | Orange Money | Longueur maximale de `order_id` | 30 caractères : on envoie l'encodage compact (base 62, 22 caractères) du paiement | Moyenne | `references.encodePaymentReference` |
| Q-PAY-05 | Orange Money | Réponse d'initiation perdue (timeout après traitement) | Sans `pay_token` il n'existe aucun moyen de vérifier : le paiement reste en attente, rapprochement manuel. Pas de reprise automatique du POST (non idempotent). | Haute (limite connue) | `OrangeMoneyProvider.initiate` |
| Q-PAY-06 | MTN MoMo | Méthode HTTP du rappel (callback) | `PUT` (documenté) ; la route accepte `POST` et `PUT` | Moyenne | `http/plugin.ts` |
| Q-PAY-07 | MTN MoMo | Authentification du rappel | Aucune signature publique : URL signée par nous + vérification active `GET /collection/v1_0/requesttopay/{referenceId}` | Moyenne | `MtnMomoProvider.verifySignature` |
| Q-PAY-08 | MTN MoMo | `X-Reference-Id` au format UUID v7 | Les identifiants de paiement sont des UUID v7 ; la plateforme MoMo n'est documentée que pour « UUID » (v4 dans les exemples). À tester en bac à sable. | Moyenne | `MtnMomoProvider.initiate` |
| Q-PAY-09 | TresorPay | Toute l'API | **Aucune documentation publique trouvée.** Contrat repris du client legacy : `POST /payments/initialize`, `GET /payments/{id}/verify`, `POST /refunds`, en-têtes `X-API-Key`, `X-Merchant-ID`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret_key, méthode+chemin+corps+horodatage)` ; webhook `x-signature = HMAC-SHA256(webhook_secret, corps brut)` hexadécimal. Le webhook porte l'identifiant TresorPay (`transaction_id`) : rapprochement par `provider_ref`. | **Faible** | `TresorPayProvider` (toute la classe) ; `signRequest`, `parseWebhook` |
| Q-PAY-10 | MTN MoMo | Remboursement (`POST /collection/v2_0/refund`) | Corps `{amount, currency, externalId, payerMessage, payeeNote, referenceIdToRefund}` ; statut par `GET …/refund/{id}` | **Faible** | `MtnMomoProvider.refund` |
| Q-PAY-11 | MTN MoMo | Devise de test | La sandbox MoMo n'accepte que `EUR` : en mode `sandbox`, la devise envoyée est `EUR` (même montant), correspondance inverse à la lecture | Haute | `MtnMomoProvider.providerCurrency` |
| Q-PAY-12 | Wave | Schéma de signature | `Wave-Signature: t=<horodatage>,v1=<hex>[,v1=…]` ; `HMAC-SHA256(secret, horodatage + corps brut)` ; secret « partagé » alternatif : `Authorization: Bearer <secret>`. Tolérance ± 5 min. | Moyenne | `WaveProvider.verifySignature`, `computeSigningSecretSignature` |
| Q-PAY-13 | Wave | Recherche par référence marchande | `GET /v1/checkout/sessions/search?client_reference=<id>` (utilisée avant création et en cas de réponse ambiguë) | Moyenne | `WaveProvider.findSessionByReference` |
| Q-PAY-14 | Wave | Remboursement | `POST /v1/checkout/sessions/{id}/refund` (total uniquement, sans corps) | Moyenne | `WaveProvider.refund` |
| Q-PAY-15 | Wave | Test de connexion | Recherche d'une référence inexistante : `200` ⇒ clé valide, `401/403` ⇒ clé refusée | Moyenne | `WaveProvider.testConnection` |
| Q-PAY-16 | CinetPay | Jeton HMAC `x-token` des notifications | `HMAC-SHA256(secret_key, cpm_site_id + cpm_trans_id + cpm_trans_date + cpm_amount + cpm_currency + signature + payment_method + cel_phone_num + cpm_phone_prefixe + cpm_language + cpm_version + cpm_payment_config + cpm_page_action + cpm_custom + cpm_designation + cpm_error_message)` ; champs absents = chaîne vide ; hexadécimal | Moyenne | `CinetPayProvider.computeNotifyToken` (liste ordonnée `NOTIFY_TOKEN_FIELDS`) |
| Q-PAY-17 | CinetPay | Contraintes de `transaction_id` et du montant | ≤ 25 caractères alphanumériques (encodage compact du paiement) ; XOF : multiple de 5, minimum 100 | Moyenne | `references`, `CinetPayProvider.assertAmountSupported` |
| Q-PAY-18 | CinetPay | Codes de la vérification `/v2/payment/check` | `code = "00"` et `data.status = "ACCEPTED"` ⇒ succès ; `REFUSED` ⇒ échec ; `WAITING_FOR_CUSTOMER`, `PENDING` ⇒ attente ; `CANCELED` ⇒ annulé ; tout autre ⇒ attente | Moyenne | `CinetPayProvider.mapStatus` |
| Q-PAY-19 | CinetPay | Champs client obligatoires pour la carte | Si le canal inclut la carte (`ALL`, `CREDIT_CARD`), nom et e-mail du payeur sont exigés ; adresse/ville/pays/code postal prennent des valeurs fixes d'établissement (`Abidjan`, `CI`) | Moyenne | `CinetPayProvider.customerFields` |
| Q-PAY-20 | CinetPay | Test de connexion | `check` d'un `transaction_id` inexistant : toute réponse `code` ≠ identifiants refusés ⇒ OK | Faible | `CinetPayProvider.testConnection` |
| Q-PAY-21 | CinetPay | Sandbox | Pas d'hôte de test distinct connu : le mode `sandbox` désigne un compte marchand de test (même hôte) | Moyenne | `catalog.ts` |
| Q-PAY-22 | Tous | Rejeu hors idempotence | Seule Wave porte un horodatage signé ; pour les autres, le rejeu est neutralisé par l'unicité de l'événement et par la vérification active | Haute | |

## B. Questions pour le propriétaire du produit

| # | Question | Proposition retenue (▶) | Si la réponse diffère |
|---|---|---|---|
| Q-PAY-30 | Un établissement sans identifiants propres peut-il utiliser ceux de la plateforme ? | ▶ **Non** (R-PAY-02) ; option `FINANCE_PROVIDER_ENV_FALLBACK=true` pour un déploiement mono-établissement | L'argent des parents irait au compte de la plateforme : exige un module de reversement. |
| Q-PAY-31 | Qui peut gérer les fournisseurs ? | ▶ Directeur (via `*`) et propriétaire ; **pas** l'économe. Permission sensible (MFA). | Ajouter `finance.provider.manage` au rôle économe (`rbac/templates/system-roles.ts`). |
| Q-PAY-32 | Remboursement exécuté chez le fournisseur ? | ▶ Non branché : le port expose `refund?` (Wave, MTN), `completeRefund` reste comptable. | Décider qui déclenche le virement (quatre yeux) et comment on traite un échec fournisseur après approbation. |
| Q-PAY-33 | Rattrapage des paiements restés « en attente » (webhook perdu) | ▶ Le bouton « Vérifier » (`POST /payments/:id/verify`) existe ; **aucun job planifié** n'interroge les fournisseurs. | Ajouter un job du worker qui assemble le registre de fournisseurs (clé maître + base) et appelle `verifyPendingPayment`. |
| Q-PAY-34 | Frais d'agrégation (CinetPay, Wave) imputés à la famille ? | ▶ Non modélisés : le montant payé = le montant de la facture. | Ajouter une ligne de frais ou un reversement net. |
| Q-PAY-35 | TresorPay est-il réellement en production ? | ▶ Adaptateur livré parce que le legacy l'utilise pour la scolarité ; contrat à confirmer (Q-PAY-09). | Retirer l'adaptateur (une ligne dans `definitions.ts`). |
