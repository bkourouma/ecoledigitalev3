# Modèle de données — module `reportcards` (013-report-cards)

**Statut** : DDL de **référence**, **implémenté** (migrations `1300-1303` du module ; le DDL exécuté fait foi — voir `spec.md` §16 pour les écarts : supersession en `BEFORE INSERT`, table globale `file_hash_index`, table `settings`, `superseded_by_id`, unicité `(tenant_id, snapshot_hash)`, pas de fonction `SECURITY DEFINER`). Schéma `reportcards`, migrations **`1300-1399`** (plage inscrite dans `module-conventions.md`). Conventions : `tenant_id` + `kernel.enable_tenant_rls()` pour toute table de tenant ; `UNIQUE (tenant_id, id)` + FK composites intra-schéma ; références au cœur par **UUID sans FK** ; objets binaires (logos, signatures, PDF) **uniquement par clé d'objet** `StoragePort` (jamais de `bytea` volumineux en base) ; montants/notes exacts ; horodatages UTC.

## 1. Tables globales (liste blanche d'isolation, écriture `system`)

```sql
CREATE SCHEMA reportcards;

-- Gabarits fournis par la plateforme (versionnés, immuables une fois publiés)
CREATE TABLE reportcards.platform_templates (
  key              text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$'),            -- primary-bulletin, secondary-bulletin, higher-bulletin-credits, higher-bulletin-coef, transcript-credits, diploma-lmd, attestation-success, ...
  version          integer NOT NULL CHECK (version >= 1),
  document_kind    text NOT NULL CHECK (document_kind IN ('REPORT_CARD','TRANSCRIPT','DIPLOMA','ATTESTATION_SUCCESS','ATTESTATION_AUTHENTICITY','PAYSLIP')),
  pack             text NOT NULL CHECK (pack IN ('PRIMARY','SECONDARY','HIGHER','VIRTUAL','CORE')),
  snapshot_schema  text NOT NULL,                       -- ex. 'reportcard/1'
  title            text NOT NULL,
  body             text NOT NULL,                       -- source du gabarit (langage sans logique)
  css              text NOT NULL,
  options_schema   jsonb NOT NULL,                      -- JSON Schema des options configurables par le tenant
  signature_slots  jsonb NOT NULL,                      -- [{ slot, label, required }]
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  content_hash     text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version),
  CHECK (status = 'DRAFT' OR content_hash IS NOT NULL)
);
-- RLS : lecture pour tous ; écriture réservée à kernel.current_actor() = 'system' (patron rbac.permissions)
-- Déclencheur : une version PUBLISHED est immuable (seul status → RETIRED) ; pas de DELETE.

-- Clés publiques de signature (la clé privée n'est JAMAIS en base)
CREATE TABLE reportcards.signing_keys (
  key_id       text PRIMARY KEY CHECK (key_id ~ '^[a-z0-9-]{6,40}$'),
  algorithm    text NOT NULL DEFAULT 'Ed25519' CHECK (algorithm = 'Ed25519'),
  public_key   text NOT NULL,                       -- base64 SPKI
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz,
  CHECK (status <> 'RETIRED' OR retired_at IS NOT NULL)
);

-- Index de vérification : code → document (aucune donnée personnelle)
CREATE TABLE reportcards.verification_index (
  code           text PRIMARY KEY CHECK (code ~ '^[A-Z2-7]{26}$'),             -- 128 bits en base32
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind  text NOT NULL,
  document_id    uuid NOT NULL,                                                -- report_cards.id ou id d'un document de 019/032
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_index_doc_idx ON reportcards.verification_index (tenant_id, document_kind, document_id);
-- Lecture par SystemDb (raison « public-verification »), puis lecture RLS du tenant ; app_user : INSERT par le tenant propriétaire via fonction SECURITY DEFINER qui impose tenant_id = kernel.current_tenant_id().
```

Justification d'allowlist (`isolation-allowlist.reportcards.ts`) : `platform_templates` — catalogue identique pour tous les tenants, sans donnée de tenant ; `signing_keys` — clés **publiques** de la plateforme ; `verification_index` — correspondance code → (tenant, document) sans donnée personnelle, nécessaire à une vérification non authentifiée dont le tenant n'est pas connu (A-17) ; accès en lecture réservé à `SystemDb` avec raison, écriture par fonction vérifiant le tenant courant.

## 2. Identité et gabarits du tenant (migration `1301_reportcards_tenant_config.sql`)

```sql
CREATE TABLE reportcards.branding_versions (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid,                                 -- NULL = tout le tenant ; sinon établissement (003)
  version          integer NOT NULL CHECK (version >= 1),
  is_current       boolean NOT NULL DEFAULT false,
  legal_name       text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  short_name       text,
  header_left      jsonb NOT NULL DEFAULT '[]'::jsonb,    -- lignes officielles (ministère, direction régionale…) : texte libre fourni par l'établissement
  header_right     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- République, devise nationale…
  address          text, phone text, email text, website text,
  registration_ref text,                                  -- numéro d'agrément/immatriculation (libre)
  logo_object_key    text,
  emblem_object_key  text,
  primary_color    text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color  text CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  footer_text      text,
  created_by       uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX branding_version_uq ON reportcards.branding_versions
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE UNIQUE INDEX branding_current_uq ON reportcards.branding_versions
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_current;
SELECT kernel.enable_tenant_rls('reportcards.branding_versions');
GRANT SELECT, INSERT, UPDATE ON reportcards.branding_versions TO app_user;      -- UPDATE : seulement is_current (déclencheur) ; versions immuables

CREATE TABLE reportcards.signatories (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id    uuid,
  full_name         text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 160),
  title             text,                                 -- qualité (ex. « Enseignant chercheur »)
  job_function      text,                                 -- fonction (peut contenir un saut de ligne)
  signature_object_key text,                              -- image de signature (optionnelle)
  staff_id          uuid,                                 -- people.staff.id si la personne est un membre du personnel
  active            boolean NOT NULL DEFAULT true,
  valid_from        date, valid_to date,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
SELECT kernel.enable_tenant_rls('reportcards.signatories');
GRANT SELECT, INSERT, UPDATE ON reportcards.signatories TO app_user;            -- jamais DELETE : désactivation ; chaque modif est auditée et horodatée

CREATE TABLE reportcards.template_configs (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id     uuid,
  document_kind      text NOT NULL,
  pack               text NOT NULL,
  template_key       text NOT NULL,
  template_version   integer NOT NULL,
  config_version     integer NOT NULL CHECK (config_version >= 1),
  is_current         boolean NOT NULL DEFAULT false,
  options            jsonb NOT NULL DEFAULT '{}'::jsonb,                   -- validé par platform_templates.options_schema
  signature_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,                -- [{ slot, signatoryId }]
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (template_key, template_version) REFERENCES reportcards.platform_templates (key, version)
);
CREATE UNIQUE INDEX template_configs_current_uq ON reportcards.template_configs
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind, pack) WHERE is_current;
CREATE UNIQUE INDEX template_configs_version_uq ON reportcards.template_configs
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind, pack, config_version);
SELECT kernel.enable_tenant_rls('reportcards.template_configs');
GRANT SELECT, INSERT, UPDATE ON reportcards.template_configs TO app_user;       -- versions immuables (seul is_current change)
```

## 3. Snapshots et rendus (migration `1302_reportcards_snapshots.sql`)

```sql
CREATE TABLE reportcards.report_cards (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind       text NOT NULL CHECK (document_kind IN ('REPORT_CARD','TRANSCRIPT')),
  -- clé fonctionnelle (références du cœur : UUID sans FK)
  enrollment_id       uuid,                                  -- NULL pour un relevé cumulé multi-inscriptions
  student_id          uuid NOT NULL,
  classroom_id        uuid,
  academic_year_id    uuid,
  academic_period_id  uuid,                                  -- NULL = bulletin annuel ou relevé cumulé
  scope               text NOT NULL CHECK (scope IN ('PERIOD','YEAR','CUMULATIVE')),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','PUBLISHED','SUPERSEDED','REVOKED')),
  provisional         boolean NOT NULL DEFAULT false,
  -- contenu figé
  snapshot_schema     text NOT NULL,                         -- 'reportcard/1'
  snapshot            jsonb NOT NULL,
  explain             jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_hash       text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  -- provenance des règles / résultats
  rule_set_code       text NOT NULL,
  rule_version_id     uuid NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL,
  results_state_id    uuid NOT NULL,
  results_version     integer NOT NULL,
  closure_hash        text NOT NULL,
  template_key        text NOT NULL,
  template_version    integer NOT NULL,
  config_version      integer NOT NULL,
  -- authenticité
  verification_code   text NOT NULL UNIQUE CHECK (verification_code ~ '^[A-Z2-7]{26}$'),
  signing_key_id      text NOT NULL REFERENCES reportcards.signing_keys (key_id),
  signature           text NOT NULL,                         -- Ed25519 sur (snapshot_hash | verification_code | issued_at), base64
  issued_at           timestamptz NOT NULL,
  issued_by           uuid NOT NULL,
  issued_by_name      text NOT NULL,
  -- cycle de vie
  supersedes_id       uuid,
  supersede_reason    text,
  superseded_at       timestamptz,
  revoked_at          timestamptz, revoked_by uuid, revoked_by_name text, revoke_reason text,
  published_at        timestamptz, published_by uuid,
  withdrawn_at        timestamptz,
  -- rendu courant (champs mutables autorisés)
  render_status       text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING','RENDERING','RENDERED','FAILED')),
  current_render_id   uuid,
  batch_id            uuid,
  UNIQUE (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL)),
  CHECK ((scope = 'CUMULATIVE') = (enrollment_id IS NULL)),
  CHECK (status <> 'SUPERSEDED' OR (superseded_at IS NOT NULL)),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CHECK (version = 1 OR (supersedes_id IS NOT NULL AND supersede_reason IS NOT NULL)),
  CHECK (NOT provisional OR status = 'ISSUED')
);
-- Une seule version « vivante » (ni remplacée ni révoquée) par clé fonctionnelle
CREATE UNIQUE INDEX report_cards_live_uq ON reportcards.report_cards
  (tenant_id, document_kind, coalesce(enrollment_id,'00000000-0000-0000-0000-000000000000'::uuid),
   student_id, coalesce(academic_period_id,'00000000-0000-0000-0000-000000000000'::uuid), scope)
  WHERE status IN ('ISSUED','PUBLISHED') AND NOT provisional;
CREATE UNIQUE INDEX report_cards_version_uq ON reportcards.report_cards
  (tenant_id, document_kind, coalesce(enrollment_id,'00000000-0000-0000-0000-000000000000'::uuid),
   student_id, coalesce(academic_period_id,'00000000-0000-0000-0000-000000000000'::uuid), scope, version)
  WHERE NOT provisional;
CREATE INDEX report_cards_class_idx   ON reportcards.report_cards (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX report_cards_student_idx ON reportcards.report_cards (tenant_id, student_id, status);
CREATE INDEX report_cards_state_idx   ON reportcards.report_cards (tenant_id, results_state_id, results_version);
SELECT kernel.enable_tenant_rls('reportcards.report_cards');
GRANT SELECT, INSERT, UPDATE ON reportcards.report_cards TO app_user;           -- jamais DELETE

CREATE TABLE reportcards.renders (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id   uuid NOT NULL,
  status           text NOT NULL CHECK (status IN ('PENDING','RENDERING','RENDERED','FAILED')),
  object_key       text,                                  -- clé StoragePort
  pdf_hash         text CHECK (pdf_hash IS NULL OR pdf_hash ~ '^[0-9a-f]{64}$'),
  size_bytes       bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  pages            smallint,
  renderer_version text,                                  -- version du moteur de rendu (Chromium/pilote)
  duration_ms      integer,
  attempts         smallint NOT NULL DEFAULT 0,
  error            text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, report_card_id) REFERENCES reportcards.report_cards (tenant_id, id),
  CHECK (status <> 'RENDERED' OR (object_key IS NOT NULL AND pdf_hash IS NOT NULL AND size_bytes IS NOT NULL))
);
CREATE INDEX renders_card_idx ON reportcards.renders (tenant_id, report_card_id, requested_at DESC);
-- (implémentation : pas d'index inter-tenants sur `renders` — sous RLS forcée le système sans tenant n'y voit rien ;
--  la comparaison d'un fichier téléversé passe par la table globale `file_hash_index`, voir spec §16 #2)
SELECT kernel.enable_tenant_rls('reportcards.renders');
GRANT SELECT, INSERT, UPDATE ON reportcards.renders TO app_user;
```

### 3.1 Déclencheurs d'intégrité (migration `1303_reportcards_guards.sql`)

Codes d'erreur stables `reportcards.<code>`, `ERRCODE restrict_violation`.

| Déclencheur | Règle |
|---|---|
| `report_cards_immutable()` `BEFORE UPDATE` | Colonnes **figées** : tout sauf `status`, `published_*`, `withdrawn_at`, `superseded_at`, `supersede_reason`, `revoked_*`, `render_status`, `current_render_id`. Transitions de `status` : `ISSUED→PUBLISHED`, `ISSUED|PUBLISHED→SUPERSEDED|REVOKED`, `PUBLISHED→ISSUED` interdit (utiliser `withdrawn_at`). `REVOKED` et `SUPERSEDED` terminaux. |
| `report_cards_no_delete()` `BEFORE DELETE` | Interdit (pour tout rôle applicatif). |
| `report_cards_hash_check()` `BEFORE INSERT` | Recalcule `snapshot_hash` en SQL (fonction `reportcards.canonical_hash(snapshot, explain)`) et refuse si différent du hash fourni (test croisé avec l'implémentation applicative). |
| `report_cards_2_supersede` `BEFORE INSERT` *(corrigé : `AFTER` ne pouvait pas fonctionner — l'index unique partiel refuse l'insertion avant que le déclencheur ne tire)* | Une insertion `version > 1` passe l'ancienne version vivante en `SUPERSEDED` (avec `superseded_at`, `superseded_by_id`) dans la même transaction, AVANT l'insertion ; vérifie que la version remplacée a la même clé fonctionnelle et la version `n-1`. |
| `renders_immutable()` | Une ligne `RENDERED` est immuable (nouvelle tentative = nouvelle ligne). |
| `branding_versions_immutable()`, `template_configs_immutable()` | Seul `is_current` change ; une version est immuable. |
| `verification_index`, `file_hash_index` | Insertion limitée au tenant courant par la RLS (`WITH CHECK tenant_id = kernel.current_tenant_id()`) + déclencheur de garde (le code désigne un document émis, non provisoire, du tenant) ; ni `UPDATE` ni `DELETE`. *(Corrigé : pas de fonction `register_verification` `SECURITY DEFINER`.)* |

## 4. Lots, journaux (migration `1304_reportcards_batches.sql`)

```sql
CREATE TABLE reportcards.batches (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind      text NOT NULL,
  classroom_id       uuid NOT NULL,
  academic_period_id uuid,
  results_state_id   uuid NOT NULL,
  results_version    integer NOT NULL,
  idempotency_key    text NOT NULL,
  provisional        boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SNAPSHOTTING','RENDERING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')),
  total              integer NOT NULL DEFAULT 0,
  issued             integer NOT NULL DEFAULT 0,
  excluded           integer NOT NULL DEFAULT 0,
  failed             integer NOT NULL DEFAULT 0,
  combined_pdf_key   text,                                -- PDF combiné de classe (optionnel)
  requested_by       uuid NOT NULL,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);
SELECT kernel.enable_tenant_rls('reportcards.batches');
GRANT SELECT, INSERT, UPDATE ON reportcards.batches TO app_user;

CREATE TABLE reportcards.batch_items (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  batch_id      uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  report_card_id uuid,
  outcome       text NOT NULL CHECK (outcome IN ('ISSUED','EXCLUDED','FAILED')),
  reason_code   text,                                     -- RESULT_ERROR, NO_FINAL_RESULT, RENDER_FAILED, …
  message       text,
  UNIQUE (tenant_id, id),
  UNIQUE (batch_id, enrollment_id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES reportcards.batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('reportcards.batch_items');
GRANT SELECT, INSERT, UPDATE ON reportcards.batch_items TO app_user;

CREATE TABLE reportcards.verification_events (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id uuid,                                    -- ou document_id d'un autre type
  document_kind  text NOT NULL,
  result         text NOT NULL CHECK (result IN ('AUTHENTIC','SUPERSEDED','REVOKED','FILE_MATCH','FILE_MISMATCH')),
  ip_prefix      text,                                    -- IP tronquée (/24 IPv4, /48 IPv6)
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_events_idx ON reportcards.verification_events (tenant_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('reportcards.verification_events');
GRANT SELECT, INSERT ON reportcards.verification_events TO app_user;               -- rétention 24 mois (job)

CREATE TABLE reportcards.access_log (                    -- téléchargements par élève/tuteur
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id uuid NOT NULL,
  user_id        uuid NOT NULL,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('STUDENT','GUARDIAN')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, report_card_id) REFERENCES reportcards.report_cards (tenant_id, id)
);
CREATE INDEX access_log_card_idx ON reportcards.access_log (tenant_id, report_card_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('reportcards.access_log');
GRANT SELECT, INSERT ON reportcards.access_log TO app_user;
```

## 5. Hash canonique et signature

- **Enveloppe** : `{ "snapshot": <snapshot>, "explain": <explain> }` → JSON canonique (clés triées par ordre d'octets UTF-8, pas d'espaces, nombres exacts écrits en chaînes décimales, Unicode en NFC) → SHA-256 en hexadécimal.
- **Signature** : `Ed25519( "ed-rc/v1" | 0x00 | snapshot_hash | 0x00 | verification_code | 0x00 | issued_at ISO UTC )`, base64 ; `signing_key_id` référence la clé publique. La clé privée est fournie au worker par secret d'environnement (jamais en base ni en journal) ; rotation planifiée (deux clés `ACTIVE` possibles).
- **Tests de contrat** : implémentations SQL et TypeScript du hash identiques sur un jeu de vecteurs (accents, nombres décimaux, listes ordonnées).

## 6. Volumétrie et conservation

| Table | Ordre de grandeur (1 000 élèves, 4 périodes/an) | Conservation |
|---|---|---|
| `report_cards` | 4 000 / an + remplacements (~2 %) | durée de vie du tenant |
| `report_cards.snapshot` | 5-20 Ko (+ `explain` 20-100 Ko) | idem ; `explain` compressé (TOAST) |
| `renders` | 1,1 par bulletin | PDF conservés ; anciens rendus d'un même snapshot purgés après 12 mois **sauf** celui référencé par la vérification |
| Stockage objet | 4 000 PDF/an × ~150 Ko ≈ 600 Mo/an | selon contrat (spec 001) ; chiffré au repos |
| `verification_events` | selon usage | 24 mois |

Les objets (logos, signatures, PDF) référencés par un snapshot ne sont **jamais supprimés** tant que le snapshot existe ; la purge d'un tenant passe par la procédure d'offboarding (spec 001).
