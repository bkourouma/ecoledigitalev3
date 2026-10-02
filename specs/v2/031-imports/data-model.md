# Data model — imports (031-imports)

Schéma Postgres `imports`, migrations **2400-2499** (`2400_imports_init.sql` livrée). Toute table porte `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` et la **RLS forcée** (`kernel.enable_tenant_rls`) ; `GRANT … TO app_user`. **Aucune clé étrangère vers un autre module** : élèves, classes, évaluations, factures sont des UUID produits par les ports. Les clés composites `(tenant_id, id)` empêchent une ligne de pointer vers un autre tenant. Aucune table globale (`isolation-allowlist.imports.ts` est vide).

## 1. Tables

### `imports.settings` (une ligne par tenant, créée à la première modification ; défauts = ceux du code)

| Colonne | Type | Défaut | Contrainte |
|---|---|---|---|
| `tenant_id` | uuid PK | | FK `kernel.tenants` |
| `max_rows` | integer | 5000 | 1-20000 (plafond absolu du produit) |
| `max_columns` | integer | 100 | 1-200 |
| `max_file_bytes` | integer | 5 242 880 | 1024-20 971 520 |
| `batch_size` | integer | 200 | 1-500 (lignes par transaction en `VALID_ONLY`) |
| `all_or_nothing_max_rows` | integer | 5000 | 1-20000, <= `max_rows` (vérifié par le cas d'usage) |
| `max_active_jobs` | integer | 5 | 1-50 (quota : imports non terminés) |
| `max_jobs_per_day` | integer | 50 | 1-1000 (quota : imports créés sur 24 h) |
| `retention_days` | integer | 30 | 1-365 (purge des valeurs brutes) |
| `updated_by`, `updated_at` | | | |

### `imports.mapping_templates` (modèles de mapping)

`id uuid PK`, `importer_key`, `name` (unique par `(tenant, importer_key, lower(name))`), `mapping jsonb` (champ cible -> en-tête), `headers jsonb` (en-têtes vus à l'enregistrement : proposition automatique si >= 80 % retrouvés), `created_by`, dates. `UNIQUE (tenant_id, id)`. DELETE autorisé.

### `imports.jobs` (un fichier = un import)

| Groupe | Colonnes |
|---|---|
| Identité | `id`, `importer_key`, `status` (`UPLOADED`, `MAPPED`, `VALIDATING`, `VALIDATED`, `QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`, `CANCELLED`) |
| Fichier | `file_name`, `file_kind` (`XLSX`/`CSV`), `file_size`, `file_sha256`, `storage_key`, `sheet_name`, `headers jsonb`, `warnings jsonb`, `total_rows`, `duplicate_of_job_id` (même empreinte déjà importée : avertissement) |
| Mapping et options | `mapping jsonb`, `mapping_template_id`, `options jsonb` (options de l'importeur : année, évaluation, version...), `run_mode` (`ALL_OR_NOTHING`/`VALID_ONLY`), `on_existing` (`SKIP`/`UPDATE`) |
| Validation | `valid_rows`, `invalid_rows`, `planned_create`, `planned_update`, `planned_skip`, `validation_progress`, `validated_at` |
| Exécution | `processed_count`, `created_count`, `updated_count`, `skipped_count`, `failed_count`, `run_attempts`, `run_requested_at/by`, `started_at`, `finished_at`, `duration_ms`, `cancel_requested` |
| Bail | `lease_owner`, `lease_until`, `heartbeat_at` : un seul exécutant vivant ; reprise après expiration |
| Acteur figé | `actor_user_id`, `actor_roles text[]`, `actor_mfa`, `actor_institution_id`, `actor_campus_id` : le worker n'a pas de requête HTTP, il reconstruit le contexte de l'auteur |
| Erreur | `error_code`, `error_message` |
| Rétention | `raw_purged_at` |
| Audit | `created_by`, `created_at`, `updated_at` |

Index : `(tenant_id, created_at DESC)`, `(tenant_id, importer_key, file_sha256)`, partiel sur les imports actifs. `UNIQUE (tenant_id, id)`.

### `imports.rows` (lignes brutes, validées, résultat de l'exécution)

`PRIMARY KEY (job_id, row_no)` ; FK composite `(tenant_id, job_id)` -> `jobs` `ON DELETE CASCADE`.

| Colonne | Rôle |
|---|---|
| `row_no` | numéro de ligne dans le fichier (celui que voit le tableur) |
| `raw jsonb` | cellules en TEXTE, dans l'ordre des en-têtes ; `NULL` après purge |
| `normalized jsonb` | valeurs typées après mapping, coercion et schéma ; `NULL` après purge |
| `natural_key` | clé naturelle normalisée (idempotence, doublons internes) |
| `validation` | `PENDING` / `VALID` / `INVALID` |
| `planned_action`, `planned_entity_id` | résultat du plan : `CREATE` / `UPDATE` / `SKIP` / `ERROR` |
| `issues jsonb` | problèmes de validation (`{column, header, code, message, severity}`) |
| `outcome`, `entity_id`, `outcome_issues`, `processed_at` | résultat de l'exécution : `CREATED` / `UPDATED` / `SKIPPED` / `FAILED` |

Index : `(job_id, validation, row_no)`, `(job_id, outcome, row_no)`, partiel `(job_id, natural_key)`.

### `imports.entity_refs` (idempotence)

`PRIMARY KEY (tenant_id, importer_key, natural_key)` -> `entity_type`, `entity_id`, `first_job_id`, `last_job_id`. Écrite **dans la transaction du lot** qui crée l'entité : un arrêt brutal ne laisse jamais une entité sans référence ni l'inverse. Les clés annexes d'un importeur (`relatedKeys`) y figurent aussi (le tuteur d'un lien : `guardians|person|…`).

## 2. Invariants

- **INV-D1** Une ligne ayant un `outcome` n'est jamais rejouée.
- **INV-D2** Un lot `VALID_ONLY` est atomique : écritures des modules cibles, `rows.outcome`, `entity_refs`, compteurs du job sont validés ensemble (ou rien).
- **INV-D3** `ALL_OR_NOTHING` : une seule transaction ; en cas d'échec ou d'annulation, ni entité, ni `entity_refs`, ni compteur.
- **INV-D4** Un seul exécutant vivant par import (`lease_owner` / `lease_until`, horloge de la base) ; le job de filet ne republie que les imports dont le bail est expiré.
- **INV-D5** Les valeurs brutes (`raw`, `normalized`) sont purgées après `retention_days` ; le rapport par ligne (numéro, codes, identifiants) demeure.
- **INV-D6** `jobs.status` ne recule jamais d'un état terminal ; `MAPPED` peut revenir de `VALIDATED` (modification du mapping), jamais après `QUEUED`.

## 3. Événements (outbox, payload `{ v: 1, … }`, aucune donnée personnelle)

`imports.job.created`, `imports.job.validation_requested`, `imports.job.validated`, `imports.run.requested`, `imports.run.started`, `imports.run.completed` (`importerKey`, `created`, `updated`, `skipped`, `failed`, `status`), `imports.run.failed`, `imports.run.cancelled`.

## 4. Audit

`imports.job.create|map|validate|validated|delete`, `imports.run.request|completed|failed|cancelled|cancel_requested`, `imports.template.create|update|delete`, `imports.settings.update` : métadonnées (importeur, décomptes, noms de colonnes, empreinte) ; sévérité `warning` pour les soldes financiers. Chaque écriture des modules cibles est auditée par **leur** audit (`people.student.created`...), avec l'identité de l'auteur de l'import.
