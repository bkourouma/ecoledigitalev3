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

## 2. Décisions de conception

1. **Indice contre preuve** : un webhook sans signature de contenu est un *indice* ; la preuve est l'API de statut du fournisseur (`requiresActiveVerification`). Le cas d'usage interroge le fournisseur avant d'ouvrir la transaction de confirmation (aucun appel réseau pendant qu'une ligne de paiement est verrouillée).
2. **Aucun point d'accès configurable par le tenant** : les URL de base sont dans le code (production) ou dans l'environnement de la plateforme ; `http:` n'est accepté qu'en développement/test (serveurs simulés).
3. **Un mode `sandbox` du fournisseur n'est pas la `SandboxProvider`** : il appelle les vrais serveurs de test du fournisseur ; il est interdit en `production`, permis en `staging`.
4. **Pas de repli par l'environnement** pour les secrets d'un tenant (R-PAY-02).
5. **Coffre = port** : le chiffrement par clé maître d'environnement est un adaptateur ; un KMS peut le remplacer sans toucher au reste.
6. **Idempotence à deux niveaux** : celle de 014 (clé du paiement, événement unique) et celle de l'initiation côté fournisseur (référence stable, recherche avant création).

## 3. Vérification

`pnpm check:boundaries`, `pnpm check:secrets`, `pnpm test:isolation` (nouvelle table `provider_configs`), `pnpm --filter @ecoledigitale/api type-check:v2`, tests du module finance (unitaires + intégration Postgres éphémère), `cd apps/web && pnpm test`.
