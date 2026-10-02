# Modèle de données — 015-payments

Schéma `finance` (module `finance`, migrations 0500-0599). Une seule table nouvelle : `finance.provider_configs` (migration `0505_finance_provider_config.sql`). Les tables `payments` et `webhook_events` (0502) sont inchangées.

## `finance.provider_configs`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL → `kernel.tenants(id)` | RLS forcée (`kernel.enable_tenant_rls`) |
| `provider` | text, `^[a-z][a-z0-9_]{1,39}$` | `orange_money`, `mtn_momo`, `wave`, `cinetpay`, `tresorpay` |
| `enabled` | boolean, défaut `false` | un fournisseur n'est actif qu'après activation explicite |
| `mode` | text `sandbox` \| `production`, défaut `sandbox` | explicite ; `sandbox` interdit en environnement `production` (registre) |
| `settings` | jsonb objet | réglages **non secrets** (`site_id`, `country`, `channels`, …) |
| `secrets` | jsonb objet `champ → enveloppe` | enveloppes AES-256-GCM ; **jamais de clair** : `CHECK finance.secrets_are_sealed(secrets)` |
| `last_test_at`, `last_test_ok`, `last_test_code` | | résultat du dernier « Tester la connexion » (code, jamais de message amont) |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | |

Contraintes : `UNIQUE (tenant_id, provider)`, `UNIQUE (tenant_id, id)`. Droits `app_user` : `SELECT, INSERT, UPDATE` (pas de `DELETE` : on efface les secrets et on désactive, l'historique reste dans l'audit).

### Enveloppe d'un secret

`v1.<kid>.<iv>.<chiffré>.<tag>` (base64url ; IV 12 octets aléatoires ; GCM, tag 16 octets). Données authentifiées (AAD) : `tenant_id|provider|champ`. `kid` désigne la clé du trousseau d'environnement ; la rotation rechiffre avec la clé active (`POST /providers/rotate-secrets`).

### Configuration lue par le registre

`TenantProviderConfigSource` lit la ligne (système, RLS du tenant demandé), déchiffre les secrets, renvoie `{ mode, enabled, …settings, …secrets }` au `ProviderRegistry`. Cache mémoire à durée courte (15 s par défaut), invalidé par les écritures du processus. Un fournisseur `enabled = false` ne déchiffre rien.

## Aucune modification de `payments` / `webhook_events`

- `payments.provider` = nom stable du fournisseur ; `provider_ref` = référence côté fournisseur (`pay_token` Orange, identifiant `cos-…` Wave, référence MTN, `payment_token` CinetPay) ; `simulated` reste réservé à la sandbox interne.
- `webhook_events.payload` : contenu **expurgé** par l'adaptateur (`storedPayload`) : numéros masqués (`225•••••0304`), jetons de notification retirés.

## Variables d'environnement (voir `.env.example`)

`FINANCE_ENV`, `FINANCE_WEBHOOK_BASE_URL`, `FINANCE_SECRETS_KEYS`, `FINANCE_SECRETS_ACTIVE_KEY`, `FINANCE_PROVIDER_ENV_FALLBACK`, `FINANCE_PROVIDER_CONFIG_CACHE_MS`, `FINANCE_PROVIDER_<NOM>_BASE_URL` / `_SANDBOX_BASE_URL` (points d'accès, niveau plateforme uniquement), `FINANCE_PROVIDER_<NOM>_<CLÉ>` (repli mono-établissement).
