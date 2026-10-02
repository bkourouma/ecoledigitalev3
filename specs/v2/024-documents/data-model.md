# Modèle de données — gestion documentaire (024)

Schéma Postgres `documents`, migrations `apps/api/src/modules/documents/migrations/1800_documents_reference.sql`, `1801_documents_core.sql`, `1802_documents_guards.sql` (plage 2500-2599). Source de vérité : le DDL ; ce document en explique les choix.

## 1. Principes

- **Toute table porte `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + RLS forcée (`kernel.enable_tenant_rls`) + `GRANT` à `app_user`.** Aucune table globale (allowlist vide). **Aucun `DELETE` accordé** : rien ne s'efface, la rétention marque (`PURGED`) et efface le contenu descriptif.
- **Aucune clé étrangère vers un autre module** : élèves, personnel, utilisateurs (identités IAM) sont des UUID vérifiés par le port `OwnerDirectory` (people, iam). Entre nos tables, clés **composites** `(tenant_id, id)`.
- **Immuabilité** : `versions` (contenu) et `document_events` (journal) sont protégés par des déclencheurs `ENABLE ALWAYS` (actifs même pour un superutilisateur sous `session_replication_role = replica`).
- **Recherche** : `documents.normalize_search(text)` (minuscules, sans accents ; `IMMUTABLE`), colonne `search_key` alimentée par le SQL de l'application (titre, description, étiquettes, nom du fichier courant, valeurs des métadonnées) + index trigramme.
- Instants `timestamptz` UTC, horloge injectée, ids UUID v7 (`newId()`), dates d'échéance `date`.

## 2. Tables

### `settings` (une ligne par tenant, créée à la première lecture ou modification ; défauts du code = défauts de la table, vérifié par test)

| Colonne | Défaut | Règle |
|---|---|---|
| `max_bytes` | 15 728 640 (15 Mio) | 1 à 104 857 600 ; plafond de taille d'un fichier, surchargeable par catégorie |
| `storage_quota_bytes` | `NULL` | quota plus strict choisi par l'établissement ; `NULL` = quota du plan ; jamais supérieur au quota du plan |
| `default_alert_days int[]` | `{30,7,1}` | seuils d'alerte d'expiration (1 à 10 valeurs, 0 à 365, décroissants) |
| `archive_retention_days` | 365 | purge des documents archivés ; `0` = jamais |
| `quarantine_retention_days` | 30 | destruction des fichiers de quarantaine non traités |
| `max_versions` | 50 | versions par document |
| `updated_by`, `updated_at` | | |

### `categories`

| Colonne | Rôle |
|---|---|
| `code` | `^[A-Z][A-Z0-9_]{1,39}$`, unique par tenant, stable (clé d'intégration) |
| `label`, `description`, `sort_order` | libellés (français) |
| `kind` | `STUDENT`, `TEACHER`, `INSTITUTION`, `ACADEMIC`, `FINANCIAL` ; **immuable** dès qu'un document existe |
| `confidentiality` | `INTERNAL`, `RESTRICTED`, `CONFIDENTIAL` → permission de lecture exigée (§spec 4.1 R5) |
| `allowed_extensions text[]` | liste blanche (sous-ensemble des extensions que la plateforme sait vérifier par octets magiques ; CHECK non vide) |
| `max_bytes` | surcharge de la taille maximale (`NULL` = établissement) |
| `audience_owner`, `audience_guardians` | le propriétaire (élève / personnel) et/ou les tuteurs liés peuvent lire (héritage, §spec 4.1 R6-R7) |
| `owner_upload` | le propriétaire / le tuteur lié peut déposer (permissions `*.self.upload`, `*.child.upload`, `*.own.upload`) |
| `requires_expiry`, `alert_days int[]`, `retention_days` | échéance obligatoire ; seuils propres ; rétention d'archivage propre |
| `status` (`ACTIVE`, `ARCHIVED`), `is_system` | les catégories de départ sont `is_system` : modifiables, jamais supprimées |

Jeu de départ (créé à la première lecture d'un tenant, idempotent, `ON CONFLICT DO NOTHING` sur `(tenant_id, code)`) : `STUDENT_IDENTITY`, `STUDENT_ENROLLMENT`, `STUDENT_MEDICAL` (CONFIDENTIAL), `STUDENT_PRIOR_SCHOOLING` · `STAFF_IDENTITY`, `STAFF_CONTRACT` (CONFIDENTIAL), `STAFF_DIPLOMA`, `STAFF_AUTHORIZATION` (échéance obligatoire) · `INSTITUTION_REGULATION` (INTERNAL), `INSTITUTION_LEGAL` (échéance), `INSTITUTION_INSURANCE` (échéance) · `ACADEMIC_PROGRAM` (INTERNAL), `ACADEMIC_CIRCULAR` (INTERNAL), `ACADEMIC_OFFICIAL` (références) · `FINANCIAL_INVOICE`, `FINANCIAL_PAYMENT_PROOF`, `FINANCIAL_ACCOUNTING` (CONFIDENTIAL). La liste vit dans `domain/default-categories.ts`.

### `category_grants` — droits de catégorie par personne

`category_id` (FK composite), `user_id` (identité IAM), `level` (`READ`, `WRITE`), `expires_at`, `note`, `created_by`, `created_at`, `revoked_at`, `revoked_by`. `UNIQUE (tenant_id, category_id, user_id) WHERE revoked_at IS NULL`.

### `documents`

| Colonne | Rôle |
|---|---|
| `kind` | copie du type de la catégorie (filtres, contraintes) |
| `category_id` | FK composite `(tenant_id, category_id)` ; changement possible dans le même type |
| `title` (≤ 200), `description` (≤ 2000), `tags text[]` (≤ 20 × 40 car.), `metadata jsonb` (objet plat, ≤ 20 clés `^[a-z][a-zA-Z0-9_]{0,39}$`, valeurs texte ≤ 500 / nombre / booléen) | descripteurs |
| `owner_type`, `owner_id` | `STUDENT` (élève), `STAFF` (personnel), `NONE` ; CHECK `(owner_type='NONE') = (owner_id IS NULL)`, `kind STUDENT ⇒ STUDENT`, `kind TEACHER ⇒ STAFF` ; `owner_id` sans FK (port) |
| `visibility` | `INHERIT`, `STAFF_ONLY`, `PRIVATE` |
| `current_version_no`, `version_count`, `current_file_name`, `current_size_bytes`, `current_mime` | tête (dénormalisée pour listes et recherche) ; FK composite **différée** vers `versions (tenant_id, document_id, version_no)` |
| `expires_on date`, `alert_days int[]`, `alerts_sent int[]`, `expired_notified_at` | échéance, seuils propres, seuils déjà émis pour l'échéance courante, alerte « échu » émise ; **réarmés** par un changement de `expires_on` |
| `status` (`ACTIVE`, `ARCHIVED`), `archived_at/by`, `archive_reason`, `purge_after`, `purged_at` | cycle de vie ; purge = contenu descriptif effacé (`title = '[purgé]'`, description / métadonnées / étiquettes vides) |
| `created_by`, `created_at`, `updated_by`, `updated_at`, `search_key` | |

Index : `(tenant_id, category_id, status)`, `(tenant_id, owner_type, owner_id)`, `(tenant_id, created_by)`, `(tenant_id, expires_on) WHERE status='ACTIVE' AND expires_on IS NOT NULL`, `(tenant_id, status, purge_after) WHERE purge_after IS NOT NULL`, `search_key` trigramme, `(tenant_id, kind, status, updated_at DESC, id)` (liste paginée).

### `versions` — immuables

`document_id` (FK composite), `version_no` (≥ 1, `UNIQUE (tenant_id, document_id, version_no)`), `storage_key` (`UNIQUE (tenant_id, storage_key)` ; `documents/<tenant>/<document>/<n>-<sha12>`), `file_name` (assaini), `extension`, `detected_mime` (type réel), `size_bytes` (> 0), `sha256` (64 hex minuscules, index `(tenant_id, sha256)`), `scan_status` (`CLEAN`, `UNSCANNED`), `scan_engine`, `scanned_at`, `note`, `uploaded_by`, `created_at`, `state` (`ACTIVE`, `PURGED`), `purged_at`, `rendition_key` / `rendition_at` (PDF dérivé d'un document Office, jetable).
Déclencheur `2502` : toute modification d'une colonne de contenu, tout `DELETE`, et toute transition d'état autre que `ACTIVE → PURGED` sont refusés ; en `PURGED`, `file_name` peut être masqué.

> Une clé de stockage **par version** (et non adressée par contenu) : la purge supprime l'objet d'une version sans jamais risquer l'objet d'une autre. Le dédoublonnage est **logique** (refus d'un doublon, pas de partage physique).

### `shares`

`document_id` (FK composite), `user_id`, `level` (`READ`, `WRITE`), `expires_at`, `note`, `created_by`, `created_at`, `revoked_at`, `revoked_by`. `UNIQUE (tenant_id, document_id, user_id) WHERE revoked_at IS NULL`.

### `document_events` — historique append-only

`document_id` (FK composite), `version_no`, `action` (`CREATED`, `VERSION_ADDED`, `UPDATED`, `VIEWED`, `PREVIEWED`, `DOWNLOADED`, `SHARED`, `UNSHARED`, `ARCHIVED`, `RESTORED`, `EXPIRY_ALERTED`, `EXPIRED`, `PURGED`, `INTEGRITY_FAILED`), `actor_id` (NULL = système), `occurred_at`, `detail jsonb` (identifiants et valeurs non descriptives : jamais de titre). Déclencheur : ni `UPDATE` ni `DELETE`. Index `(tenant_id, document_id, occurred_at DESC)`.

### `quarantine`

`status` (`HELD`, `RELEASED`, `DELETED`), `storage_key` (`documents/<tenant>/quarantine/<id>`), `file_name`, `extension`, `detected_mime`, `size_bytes`, `sha256`, `signature` (nom du programme malveillant), `engine`, `intent jsonb` (ce que l'upload voulait faire : création d'un document avec ses descripteurs, ou nouvelle version d'un document), `uploaded_by`, `created_at`, `decided_by`, `decided_at`, `decision_note`, `released_document_id`. Aucune ligne ne mène à un document tant qu'elle est `HELD`.

## 3. Droits SQL

`app_user` : `SELECT, INSERT, UPDATE` sur `settings`, `categories`, `category_grants`, `documents`, `versions`, `shares`, `quarantine` ; `SELECT, INSERT` sur `document_events`. **Aucun `DELETE`.**

## 4. Requête de visibilité (liste)

La liste filtre **en SQL** avec les mêmes règles que `domain/policy.ts` (R1..R7, §spec 4.1) paramétrées par les capacités et les liens de l'acteur ; un test d'intégration compare, pour une matrice acteur × document, la liste SQL et la décision TypeScript (aucune divergence possible entre « je le vois dans la liste » et « je peux l'ouvrir »).
