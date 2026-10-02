# Plan d'implémentation — 015-payments

**Statut** : implémenté. Tranche du plan : **3** (« finance migrée »), module `finance`. Dépend de 014 (port, registre, webhooks), du module `audit` (via `AuditPort`) et de `rbac` (permission sensible).

## 1. Découpage

| Lot | Contenu | Fichiers (sous `apps/api/src/modules/finance/`) |
|---|---|---|
| L1 | Extensions additives du port, du registre et du cas d'usage webhook : `meta` (requête), `requiresActiveVerification`, `ProviderVerifyRequest.amount`, `refund?`, `testConnection?`, refus du mode `sandbox` en production, fournisseur désactivé, contrôle de référence | `application/ports/payment-provider.ts`, `infrastructure/providers/registry.ts`, `application/online-payments.ts`, `domain/errors.ts` |
| L2 | Briques communes : client HTTP (délai, reprises, journalisation expurgée), cache de jeton, HMAC / comparaison à temps constant, montants entiers stricts, références compactes, masquage | `infrastructure/providers/{http,token-cache,crypto,amounts}.ts` |
| L3 | Adaptateurs | `infrastructure/providers/{orange-money,mtn-momo,wave,cinetpay,tresorpay}.ts`, `definitions.ts`, `catalog.ts` |
| L4 | Coffre : `SecretStorePort`, `AesGcmSecretStore` (trousseau, rotation), migration 0505, dépôt, source de configuration par tenant | `application/ports/secret-store.ts`, `infrastructure/secrets/*`, `migrations/0505_*.sql`, `infrastructure/provider-config-repository.ts` |
| L5 | Cas d'usage d'administration + routes + contrats Zod + permission | `application/provider-admin.ts`, `http/plugin.ts`, `packages/contracts/src/v2/finance.ts`, `manifest.ts` |
| L6 | Écran web, client typé, i18n | `apps/web/src/app/v2/finance/providers/**`, `apps/web/src/platform/v2/finance-providers.ts`, `apps/web/messages/fr-CI.json` |
| L7 | Tests : serveurs HTTP simulés (documentation de chaque fournisseur), contrat du port, sécurité, intégration Postgres | `test/unit/providers-*.test.ts`, `test/integration/providers-*.test.ts`, `test/support/mock-providers.ts` |

### Tranche 2 : rapprochement, remboursement réel, résolution manuelle (US5 à US7, migration `0506`)

| Lot | Contenu | Fichiers (sous `apps/api/src/modules/finance/` sauf mention) |
|---|---|---|
| L8 | Port : capacités de remboursement (`refundCapabilities`), lecture d'état (`refundStatus`, MTN), `cannotVerifyWithoutProviderRef` (Orange, TresorPay) ; sandbox remboursable ; 5xx de TresorPay = réponse ambiguë | `application/ports/payment-provider.ts`, `infrastructure/providers/{mtn-momo,wave,tresorpay,orange-money,sandbox-provider}.ts` |
| L9 | Migration `0506` : états `REFUND_PENDING` / `REFUND_FAILED`, trace d'exécution, `reconciliation_state`, `manual_resolutions` ; domaine, dépôts | `migrations/0506_*.sql`, `domain/{types,refund,records,events,errors}.ts`, `infrastructure/{payments,reconciliation}-repository.ts` |
| L10 | Cas d'usage : remboursement en trois temps (`refunds.ts`), rapprochement (`reconciliation.ts`), résolutions (`manual-resolution.ts`) ; ports d'exploitation facultatifs (alertes, compteurs) | `application/{refunds,reconciliation,manual-resolution,worker-resources}.ts`, `application/ports/operations.ts` |
| L11 | Worker : assemblage partagé API / worker (`infrastructure/runtime.ts`), job `finance.reconcile-pending-payments` | `jobs.ts`, `infrastructure/runtime.ts` |
| L12 | HTTP et contrats : `GET /payments/pending`, `/resolutions`, `manual` dans `approve` / `complete`, permission sensible `finance.payment.reconcile` | `http/{plugin,presenters}.ts`, `manifest.ts`, `packages/contracts/src/v2/finance.ts` |
| L13 | Web : `/v2/finance/payments/pending`, repli manuel dans les remboursements, fr-CI | `apps/web/src/app/v2/finance/**`, `apps/web/src/platform/v2/finance-reconciliation.ts`, `apps/web/messages/fr-CI.json` |
| L14 | Tests : `reconciliation`, `refunds-provider`, `reconciliation-http`, `reconciliation-job` (serveurs HTTP simulés, Postgres réel, vrai journal d'audit) | `test/integration/*`, `test/support/{mock-providers,recon-env}.ts` |

## 2. Décisions de conception

1. **Indice contre preuve** : un webhook sans signature de contenu est un *indice* ; la preuve est l'API de statut du fournisseur (`requiresActiveVerification`). Le cas d'usage interroge le fournisseur avant d'ouvrir la transaction de confirmation (aucun appel réseau pendant qu'une ligne de paiement est verrouillée).
2. **Aucun point d'accès configurable par le tenant** : les URL de base sont dans le code (production) ou dans l'environnement de la plateforme ; `http:` n'est accepté qu'en développement/test (serveurs simulés).
3. **Un mode `sandbox` du fournisseur n'est pas la `SandboxProvider`** : il appelle les vrais serveurs de test du fournisseur ; il est interdit en `production`, permis en `staging`.
4. **Pas de repli par l'environnement** pour les secrets d'un tenant (R-PAY-02).
5. **Coffre = port** : le chiffrement par clé maître d'environnement est un adaptateur ; un KMS peut le remplacer sans toucher au reste.
6. **Idempotence à deux niveaux** : celle de 014 (clé du paiement, événement unique) et celle de l'initiation côté fournisseur (référence stable, recherche avant création).
7. **Intention durable avant l'effet** (remboursement) : `REFUND_PENDING` est validé en transaction AVANT l'appel réseau ; le résultat est appliqué dans une seconde transaction. Un plantage entre les deux laisse un état que le job sait conclure, jamais un second envoi aveugle (le renvoi n'a lieu que pour un fournisseur idempotent, avec la même référence).
8. **Un seul chemin d'application** : webhook, vérification manuelle, job et résolution manuelle passent tous par `applyProviderOutcome` (paiements) et `applyRefundOutcomeInTx` (remboursements) : mêmes contrôles, mêmes écritures, mêmes événements.
9. **Le bail est en base** (`reconciliation_state.next_attempt_at`, `SKIP LOCKED`) : la déduplication entre instances du worker ne dépend pas de Redis.
10. **Alertes et compteurs = ports facultatifs** : finance n'importe pas le module d'observabilité ; la plateforme les branche par `setFinanceWorkerResources`.

## 3. Vérification

`pnpm check:boundaries`, `pnpm check:secrets`, `pnpm test:isolation` (nouvelles tables `provider_configs`, `reconciliation_state`, `manual_resolutions`), `pnpm --filter @ecoledigitale/api type-check:v2`, tests du module finance (unitaires + intégration Postgres éphémère), `pnpm --filter @ecoledigitale/worker build` (le job `finance.reconcile-pending-payments` est embarqué), `pnpm test:phase1` / `test:phase2`, `cd apps/web && pnpm test`.
