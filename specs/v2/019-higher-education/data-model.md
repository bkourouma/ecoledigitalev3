# Modèle de données — module `higher` (019-higher-education)

**Statut** : DDL de **référence**. Schéma `higher` (pack `HIGHER`), migrations **`1400-1499`** (plage proposée, à inscrire dans `module-conventions.md`). Conventions : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` ; `UNIQUE (tenant_id, id)` + FK composites **intra-schéma** ; références au cœur par **UUID sans FK** (`curriculum_node_id`, `student_id`, `enrollment_id`, `academic_period_id`, `academic_year_id`, `classroom_id`) ; références aux autres modules (`reportcards.signatories`, `results.period_results`, `assess.*`) par UUID sans FK ; notes et crédits exacts (`numeric`) ; horodatages UTC ; ids UUID v7.

## 1. Diplômes et exigences (migration `1401_higher_diplomas.sql`)

```sql
CREATE SCHEMA higher;

CREATE TABLE higher.diploma_definitions (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  grade_code          text NOT NULL CHECK (grade_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),   -- LICENCE, MASTER, BTS, DOCTORAT… : donnée (jamais déduite d'un libellé)
  curriculum_node_id  uuid NOT NULL,                                     -- nœud « cycle / diplôme » du curriculum (004)
  uv_required         numeric(8,2) NOT NULL CHECK (uv_required > 0),
  auto_award          boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  description         text,
  last_synced_at      timestamptz,
  created_by          uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX diploma_definitions_node_idx ON higher.diploma_definitions (tenant_id, curriculum_node_id) WHERE status = 'ACTIVE';
SELECT kernel.enable_tenant_rls('higher.diploma_definitions');
GRANT SELECT, INSERT, UPDATE ON higher.diploma_definitions TO app_user;      -- DELETE refusé par déclencheur s'il existe un octroi

CREATE TABLE higher.diploma_requirements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  definition_id  uuid NOT NULL,
  ue_node_id     uuid NOT NULL,                                          -- academic.curriculum_nodes.id (UE)
  mandatory      boolean NOT NULL DEFAULT true,
  position       integer NOT NULL DEFAULT 0,
  removed_from_curriculum boolean NOT NULL DEFAULT false,               -- signalé à la synchronisation
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (definition_id, ue_node_id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES higher.diploma_definitions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('higher.diploma_requirements');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.diploma_requirements TO app_user;
```

## 2. Registre de crédits — capitalisation (migration `1402_higher_credit_ledger.sql`)

```sql
CREATE TABLE higher.credit_ledger (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id         uuid NOT NULL,
  enrollment_id      uuid NOT NULL,                       -- inscription au cours de laquelle l'UE a été acquise
  ue_node_id         uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  academic_period_id  uuid NOT NULL,
  credits            numeric(8,2) NOT NULL CHECK (credits >= 0),   -- crédits FIGÉS au résultat
  average_exact      numeric,                                       -- moyenne d'UE exacte au moment de l'acquisition
  acquired_via       text NOT NULL CHECK (acquired_via IN ('DIRECT','RESIT','JURY_OVERRIDE','TRANSFER','EXEMPTION')),
  session_obtained   smallint NOT NULL CHECK (session_obtained IN (1, 2)),
  status             text NOT NULL DEFAULT 'ACQUIRED' CHECK (status IN ('ACQUIRED','REVOKED')),
  compensated_ecue_count smallint NOT NULL DEFAULT 0,             -- transparence : ECUE compensées dans cette UE
  override_id        uuid,                                         -- results.overrides.id si JURY_OVERRIDE
  source_result_id   uuid NOT NULL,                                -- results.period_results.id
  source_results_version integer NOT NULL,
  valid_until        date,                                         -- Q-25 (NULL = sans limite)
  acquired_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoke_reason      text,
  superseded_by_version integer,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CHECK (acquired_via <> 'JURY_OVERRIDE' OR override_id IS NOT NULL),
  CHECK ((acquired_via = 'RESIT') = (session_obtained = 2) OR acquired_via IN ('TRANSFER','EXEMPTION','JURY_OVERRIDE'))
);
-- UNE seule acquisition valide par (étudiant, UE) : une UE n'est jamais recapitalisée
CREATE UNIQUE INDEX credit_ledger_acquired_uq ON higher.credit_ledger (tenant_id, student_id, ue_node_id) WHERE status = 'ACQUIRED';
CREATE INDEX credit_ledger_student_idx ON higher.credit_ledger (tenant_id, student_id, status);
CREATE INDEX credit_ledger_node_idx    ON higher.credit_ledger (tenant_id, ue_node_id, status);
CREATE INDEX credit_ledger_source_idx  ON higher.credit_ledger (tenant_id, source_result_id);
SELECT kernel.enable_tenant_rls('higher.credit_ledger');
GRANT SELECT, INSERT, UPDATE ON higher.credit_ledger TO app_user;       -- UPDATE : uniquement ACQUIRED → REVOKED (déclencheur) ; jamais DELETE
```

Déclencheur `higher.credit_ledger_guard()` : (a) aucune colonne de contenu modifiable (`credits`, `average_exact`, `ue_node_id`, `student_id`, `acquired_via`…) ; seule la transition `ACQUIRED → REVOKED` (avec motif) est permise ; (b) une révocation est **refusée** si un octroi non révoqué (`diploma_awards`) s'appuie sur cette UE (lecture de `awards.requirements_snapshot`) — erreur `higher.credit_in_use` ; (c) `DELETE` interdit.

## 3. Prérequis (migration `1403_higher_prerequisites.sql`)

```sql
CREATE TABLE higher.ue_prerequisites (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  ue_node_id         uuid NOT NULL,                       -- l'UE qui exige
  prerequisite_node_id uuid NOT NULL,                     -- l'UE exigée
  mode               text NOT NULL DEFAULT 'VALIDATED' CHECK (mode IN ('VALIDATED','ATTENDED','MIN_AVERAGE')),   -- Q-26
  min_average        numeric(6,3) CHECK (min_average IS NULL OR min_average BETWEEN 0 AND 20),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ue_node_id, prerequisite_node_id),
  CHECK (ue_node_id <> prerequisite_node_id),
  CHECK ((mode = 'MIN_AVERAGE') = (min_average IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('higher.ue_prerequisites');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.ue_prerequisites TO app_user;
```

Déclencheur différé `higher.ue_prerequisites_acyclic()` : refuse toute insertion qui crée un chemin `ue → … → ue` (parcours récursif `WITH RECURSIVE` borné à 200 niveaux), en défense en profondeur de la validation applicative (parité avec `wouldCreateUePrerequisiteCycle`). La condition « même programme » est vérifiée par l'application (le curriculum est externe) avec un port d'appartenance.

## 4. Rattrapage (migration `1404_higher_resit.sql`)

```sql
CREATE TABLE higher.resit_windows (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  results_state_id   uuid NOT NULL,                        -- results.period_states.id
  opens_on           date NOT NULL,
  closes_on          date NOT NULL,
  node_ids           uuid[],                               -- NULL = toutes les ECUE éligibles
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  opened_by uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid, closed_at timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (closes_on >= opens_on)
);
CREATE UNIQUE INDEX resit_windows_open_uq ON higher.resit_windows (tenant_id, classroom_id, academic_period_id) WHERE status = 'OPEN';
SELECT kernel.enable_tenant_rls('higher.resit_windows');
GRANT SELECT, INSERT, UPDATE ON higher.resit_windows TO app_user;

CREATE TABLE higher.resit_registrations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  window_id          uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  student_id         uuid NOT NULL,
  ecue_node_id       uuid NOT NULL,
  ue_node_id         uuid NOT NULL,
  session1_average   numeric,                              -- note retenue en session 1 (affichage, exacte)
  status             text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','PRESENT','ABSENT','WAIVED','GRADED')),
  outcome            text CHECK (outcome IS NULL OR outcome IN ('VALIDATED','NOT_VALIDATED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (window_id, enrollment_id, ecue_node_id),
  FOREIGN KEY (tenant_id, window_id) REFERENCES higher.resit_windows (tenant_id, id)
);
CREATE INDEX resit_registrations_student_idx ON higher.resit_registrations (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('higher.resit_registrations');
GRANT SELECT, INSERT, UPDATE ON higher.resit_registrations TO app_user;
```

## 5. Numérotation sans trou (migration `1405_higher_counters.sql`)

```sql
CREATE TABLE higher.number_counters (
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  counter_key text NOT NULL CHECK (counter_key IN ('DIPLOMA','AUTHENTICITY','ATTESTATION')),
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  last_value  bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, counter_key, year)
);
SELECT kernel.enable_tenant_rls('higher.number_counters');
GRANT SELECT, INSERT, UPDATE ON higher.number_counters TO app_user;
-- Attribution : INSERT … ON CONFLICT (tenant_id, counter_key, year) DO UPDATE SET last_value = number_counters.last_value + 1 RETURNING last_value
-- dans la TRANSACTION de l'octroi : une annulation ne consomme pas de numéro ; l'UPDATE verrouille la ligne (pas de doublon).
```

Contrainte logique : la fonction `higher.next_number(counter_key, year)` est la **seule** voie d'accès (fonction `SECURITY INVOKER`, `EXECUTE` accordé à `app_user`), et un déclencheur interdit de diminuer `last_value`.

## 6. Octrois et documents (migration `1406_higher_awards.sql`)

```sql
CREATE TABLE higher.diploma_awards (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  definition_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  last_enrollment_id  uuid,
  academic_year_id    uuid NOT NULL,                       -- année de la dernière inscription du cycle
  reference           text NOT NULL CHECK (reference ~ '^DIP-[0-9]{4}-[0-9]{6}$'),
  reference_year      integer NOT NULL,
  reference_seq       bigint NOT NULL,
  status              text NOT NULL DEFAULT 'OBTAINED' CHECK (status IN ('OBTAINED','REVOKED')),
  awarded_via         text NOT NULL CHECK (awarded_via IN ('AUTO','MANUAL','FORCED')),
  forced_reason       text,
  credits_total       numeric(8,2) NOT NULL CHECK (credits_total >= 0),
  requirements_snapshot jsonb NOT NULL,                    -- { uv_required, capturedAt, requirements: [{ ueNodeId, code, label, credits, mandatory, validated, ledgerId }] }
  eligibility         jsonb NOT NULL,                      -- sorties de la règle diplome_eligible + trace
  cycle_average       numeric,                             -- exacte
  mention_code        text,
  rule_set_code       text NOT NULL,
  rule_version_id     uuid NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL,
  awarded_at          timestamptz NOT NULL DEFAULT now(),
  awarded_by          uuid,                                -- NULL = système (octroi automatique)
  awarded_by_name     text NOT NULL,
  acquired_date       date NOT NULL,                       -- date de la dernière acquisition requise
  revoked_at          timestamptz, revoked_by uuid, revoked_by_name text, revoke_reason text,
  predecessor_award_id uuid,                               -- ré-octroi exceptionnel après révocation (Q-22)
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reference),
  UNIQUE (tenant_id, reference_year, reference_seq),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES higher.diploma_definitions (tenant_id, id),
  CHECK (awarded_via <> 'FORCED' OR length(btrim(coalesce(forced_reason, ''))) >= 20),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 10)),
  CHECK (awarded_via = 'AUTO' OR awarded_by IS NOT NULL)
);
-- UN seul octroi non révoqué par (définition, étudiant)
CREATE UNIQUE INDEX diploma_awards_active_uq ON higher.diploma_awards (tenant_id, definition_id, student_id) WHERE status = 'OBTAINED';
CREATE INDEX diploma_awards_student_idx ON higher.diploma_awards (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('higher.diploma_awards');
GRANT SELECT, INSERT, UPDATE ON higher.diploma_awards TO app_user;      -- UPDATE : OBTAINED → REVOKED seulement ; jamais DELETE

CREATE TABLE higher.official_documents (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind      text NOT NULL CHECK (document_kind IN ('DIPLOMA','ATTESTATION_SUCCESS','ATTESTATION_AUTHENTICITY')),
  award_id           uuid,                                  -- NULL pour une attestation de réussite sans diplôme
  student_id         uuid NOT NULL,
  program_node_id    uuid,                                  -- attestation de réussite : programme/filière
  reference          text NOT NULL,                         -- DIP-… (diplôme) | AUTH/AAAA/NNN | ATT-AAAA-NNNNNN
  reference_year     integer NOT NULL,
  reference_seq      bigint NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  supersedes_id      uuid,
  status             text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','SUPERSEDED','REVOKED')),
  snapshot_schema    text NOT NULL,
  snapshot           jsonb NOT NULL,
  snapshot_hash      text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  verification_code  text NOT NULL UNIQUE,                  -- enregistré dans reportcards.verification_index
  signing_key_id     text NOT NULL,
  signature          text NOT NULL,
  template_key       text NOT NULL, template_version integer NOT NULL, config_version integer NOT NULL,
  render_status      text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING','RENDERING','RENDERED','FAILED')),
  object_key         text, pdf_hash text,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  issued_by          uuid NOT NULL, issued_by_name text NOT NULL,
  published_at       timestamptz,                           -- visible à l'étudiant
  revoked_at         timestamptz, revoke_reason text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_kind, reference),
  CHECK (document_kind = 'ATTESTATION_SUCCESS' OR award_id IS NOT NULL),
  CHECK (document_kind <> 'ATTESTATION_SUCCESS' OR program_node_id IS NOT NULL),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
-- Authenticité idempotente : une seule attestation d'authenticité vivante par octroi
CREATE UNIQUE INDEX official_documents_auth_uq ON higher.official_documents (tenant_id, award_id)
  WHERE document_kind = 'ATTESTATION_AUTHENTICITY' AND status = 'ISSUED';
CREATE UNIQUE INDEX official_documents_diploma_uq ON higher.official_documents (tenant_id, award_id)
  WHERE document_kind = 'DIPLOMA' AND status = 'ISSUED';
CREATE UNIQUE INDEX official_documents_att_uq ON higher.official_documents (tenant_id, student_id, program_node_id)
  WHERE document_kind = 'ATTESTATION_SUCCESS' AND status = 'ISSUED';
SELECT kernel.enable_tenant_rls('higher.official_documents');
GRANT SELECT, INSERT, UPDATE ON higher.official_documents TO app_user;   -- immuable hors statut, rendu, publication (déclencheur) ; jamais DELETE

CREATE TABLE higher.official_document_slots (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  slot_key      text NOT NULL CHECK (slot_key IN ('DIPLOMA_LEFT','DIPLOMA_RIGHT','ATTESTATION_SUCCESS','AUTHENTICITY')),
  signatory_id  uuid NOT NULL,                              -- reportcards.signatories.id (sans FK : autre module)
  valid_from    date NOT NULL,
  valid_to      date,
  created_by    uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (tenant_id WITH =, slot_key WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
SELECT kernel.enable_tenant_rls('higher.official_document_slots');
GRANT SELECT, INSERT, UPDATE ON higher.official_document_slots TO app_user;
```

Déclencheurs :

| Déclencheur | Règle |
|---|---|
| `diploma_awards_guard()` | contenu figé ; transition `OBTAINED → REVOKED` seule ; `DELETE` interdit ; un ré-octroi après révocation exige `predecessor_award_id` et `awarded_via = 'MANUAL'` ou `'FORCED'` (Q-22) |
| `official_documents_guard()` | snapshot, hash, signature, références figés ; seuls `status`, `render_status`, `object_key`, `pdf_hash`, `published_at`, `revoked_*` varient ; `DELETE` interdit |
| `diploma_definitions_no_delete()` | refuse `DELETE` si un octroi existe ; sinon autorisé (les exigences partent avec lui par l'application) |
| `award_documents_follow_revocation()` `AFTER UPDATE` | une révocation d'octroi passe ses documents `ISSUED` à `REVOKED` dans la même transaction |
| `official_document_slots_no_delete()` | historique des affectations conservé |

## 7. Contrat de snapshot des documents (`diploma/1`, `attestation-success/1`, `attestation-authenticity/1`)

| Document | Contenu figé |
|---|---|
| `DIPLOMA` | établissement (branding copié), étudiant (nom, matricule, date et lieu de naissance), diplôme (code, libellé, grade), `credits_total`, liste des UE (code, libellé, crédits), mention, date d'obtention, année académique, référence, signataires `DIPLOMA_LEFT`/`DIPLOMA_RIGHT` (nom, qualité, fonction) |
| `ATTESTATION_SUCCESS` | établissement, étudiant, programme, UE validées (code, libellé, crédits), crédits totaux, mention, date d'obtention, année académique, référence, signataire |
| `ATTESTATION_AUTHENTICITY` | établissement, étudiant, diplôme et référence du diplôme, numéro `AUTH/AAAA/NNN`, date, signataire `AUTHENTICITY` |

Le hachage, la signature et l'index de vérification sont ceux de 013 (`DocumentSealer`) : même enveloppe canonique, même clé, même page publique.

## 8. Index, volumétrie, conservation

| Table | Ordre de grandeur (1 000 étudiants, 5 ans) | Conservation |
|---|---|---|
| `credit_ledger` | ~40 UE × 1 000 = 40 000 écritures | durée de vie du tenant |
| `diploma_awards` | quelques centaines / an | illimitée (valeur probante) |
| `official_documents` | ≤ 3 par octroi + attestations | illimitée ; rendus : voir 013 |
| `resit_*` | < 20 % des étudiants / semestre | 5 ans, puis agrégation |
| `number_counters` | 3 × années | illimitée |

## 9. Compatibilité avec les lecteurs existants

Les tableaux de bord owner du legacy (`owner-documents.service.ts`, `owner-pedagogie.service.ts`) lisaient `professional_diplomas`, `student_professional_diplomas`, `professional_signataires` et le JSON des bulletins ; en v2 ils lisent les événements et agrégats de `higher` (`credit_ledger`, `diploma_awards`) via modèles de lecture (tranche 2.8). La détection par l'écran « Documents officiels » des signataires par défaut (`SIGNATAIRES_DEFAULTS`) disparaît avec les valeurs par défaut elles-mêmes : un emplacement sans signataire valide bloque l'émission.
