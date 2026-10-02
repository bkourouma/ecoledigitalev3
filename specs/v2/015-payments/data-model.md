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

## Rapprochement et remboursement réel (migration `0506_finance_reconciliation.sql`)

Deux tables nouvelles, une table étendue ; toutes sous RLS de tenant (`kernel.enable_tenant_rls`), aucune table globale.

### `finance.refunds` : états et trace d'exécution

États : `REQUESTED → APPROVED → (REFUND_PENDING →) COMPLETED | REFUND_FAILED` ; `REQUESTED | APPROVED → REJECTED` (machine d'états en SQL : `finance.refunds_guard`, miroir de `REFUND_TRANSITIONS`). `COMPLETED` est l'état « remboursé » ; les écritures inverses (`allocation_reversals`, cumul `refunded_amount`) ne sont passées **qu'à `COMPLETED`**. Les remboursements `REQUESTED | APPROVED | REFUND_PENDING` réservent leur montant (`sumOpenRefunds`).

| Colonne ajoutée | Rôle |
|---|---|
| `execution_mode` | `LEDGER` (écriture comptable seule), `PROVIDER` (envoyé au fournisseur), `MANUAL` (fait à la main, avec preuve) ; `null` tant que non exécuté et pour l'historique |
| `provider`, `provider_requested_at` | fournisseur et instant d'envoi (posés en passant `REFUND_PENDING` ; **figés** ensuite : jamais de second envoi ailleurs) |
| `provider_refund_ref`, `provider_status` | référence et dernier statut renvoyés par le fournisseur (`PENDING`, `SUCCEEDED`, `FAILED`, `MANUAL_CONFIRMED`, `MANUAL_FAILED`) |
| `failed_at`, `failure_reason` | refus définitif (`REFUND_FAILED`) : code court, jamais un message du fournisseur |
| `manual_reference`, `manual_note` | preuve d'un remboursement manuel (obligatoire si `execution_mode = MANUAL`) |

Index : `refunds_in_flight_idx` (remboursements `REFUND_PENDING`), `payments_pending_online_idx` (paiements en ligne en attente).

### `finance.reconciliation_state`

Un enregistrement par paiement en attente **ou** remboursement en vol suivi par le job (`CHECK ((payment_id IS NULL) <> (refund_id IS NULL))`, clés composites `(tenant_id, id)`, unicité par sujet).

| Colonne | Rôle |
|---|---|
| `attempts`, `first_attempt_at`, `last_attempt_at` | tentatives du job (plafonnées par `FINANCE_RECONCILIATION_MAX_ATTEMPTS`) |
| `next_attempt_at` | prochaine échéance **et bail** : l'instance qui prend le sujet la repousse de `FINANCE_RECONCILIATION_LEASE_MS` (`FOR UPDATE SKIP LOCKED`) ; un plantage laisse le bail expirer |
| `last_outcome`, `last_error_code` | dernier résultat (`pending`, `provider_error`, `unverifiable`, `mismatch`, `confirmed`, `failed`…) et code d'erreur court |
| `flagged_at`, `flag_reason` | le job ne peut plus conclure : `reconciliation_needed` publié, **plus jamais repris** ; action humaine |
| `resolved_at` | sujet conclu (par le job, un webhook, une vérification manuelle ou une résolution) |

Droits `app_user` : `SELECT, INSERT, UPDATE` (pas de `DELETE` : l'historique du suivi reste lisible).

### `finance.manual_resolutions`

Demande de résolution manuelle à quatre yeux. `outcome` (`SUCCEEDED | FAILED` : ce qui s'est réellement passé), `reason` (≥ 10 caractères), `evidence_ref` (preuve, ≥ 3 caractères), `status` (`REQUESTED → APPROVED | REJECTED`), `requested_by` / `decided_by` (le cas d'usage refuse `decided_by = requested_by`). Une seule demande `REQUESTED` par sujet (index unique partiel). Déclencheur `finance.manual_resolutions_guard` : sujet, issue, motif, preuve et demandeur **figés** ; une demande tranchée ne change plus ; jamais de `DELETE`.

### Variables d'environnement ajoutées

`FINANCE_RECONCILIATION_MIN_AGE_MS` (défaut 900 000), `FINANCE_RECONCILIATION_MAX_ATTEMPTS` (12), `FINANCE_RECONCILIATION_BACKOFF_BASE_MS` (600 000), `FINANCE_RECONCILIATION_BACKOFF_MAX_MS` (14 400 000), `FINANCE_RECONCILIATION_LEASE_MS` (600 000), `FINANCE_RECONCILIATION_BATCH_SIZE` (50). Le worker lit aussi `FINANCE_ENV`, `FINANCE_SECRETS_KEYS`, `FINANCE_SECRETS_ACTIVE_KEY`, `FINANCE_PROVIDER_*` (même assemblage que l'API) et `AUDIT_HMAC_KEY`.
