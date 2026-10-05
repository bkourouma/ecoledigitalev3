# Modèle de données — 018-examinations (schéma Postgres `examinations`)

**Statut** : DDL de référence, **exécuté et testé** sur PostgreSQL 17 (`ddl/run.mjs` : 195 tests de comportement (166 du DDL de référence + 29 des ajouts 2003-2004), dont des essais de **concurrence réelle** à plusieurs sessions Postgres via `dblink`). Les fichiers ci-dessous sont les migrations cibles `apps/api/src/modules/examinations/migrations/2000…2004` ; ils font foi sur les noms et les contraintes. Les blocs `<!-- migration: … -->` sont **générés** depuis `ddl/migrations/*.sql` (`node ddl/run.mjs --sync-doc`) et vérifiés par `--check-doc`.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002 (RLS), ADR-005 (types de ligne à la main), ADR-006 (un schéma par module), ADR-007 (UUID, UTC, snake_case anglais), `specs/v2/004-academic-core/data-model.md` (patron), `specs/v2/011-assessments-grades/data-model.md` (révisions, verrous), `specs/v2/013-report-cards/data-model.md` (instantanés, documents officiels).

## 1. Conventions appliquées

| Règle | Application dans `examinations` |
|---|---|
| Un module = un schéma | `examinations` ; aucune FK vers un autre schéma que `kernel.tenants(id)`. Élève, inscription, établissement, classe, évaluation `assess`, document `reportcards`, version de règle `rules` : **UUID sans FK**, vérifiés par les API publiques ; niveaux désignés par leur **code** |
| Toute table de tenant | `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` + `GRANT` explicite. **Aucune table globale** : allowlist d'isolation **vide** (`isolation-allowlist.examinations.ts`) |
| FK internes composites | `(tenant_id, id)` ; `(tenant_id, session_id, id)` pour que candidat, épreuve et centre appartiennent **à la même session** ; `(tenant_id, center_id, room_id)` pour la salle d'un centre |
| Identifiants, dates, montants | UUID fournis par l'application ; `timestamptz` UTC ; **aucun montant** (frais d'examen = `finance`, question Q-E13) |
| Constantes réglementaires | **Aucune**. Types, épreuves, coefficients, barèmes, pièces, formats : données portant leur origine (`source_kind` ∈ `regulation`, `institution`, `platform`, `placeholder`) ; seuils, éligibilité, taux : règles (`rules`) |
| Journaux | `eligibility_checks`, `candidate_history`, `score_revisions`, `result_revisions`, `import_rows` : ajout seul (déclencheur) ; correction d'une note ou d'un résultat publié = **révision insérée dans la même transaction** (`xid`) |
| Audit | Les cas d'usage sensibles (`publish`, `revise`, `apply import`, `override eligibility`, `release results`) appellent `audit.record(tx, …)` ; aucune note ni identité dans l'audit |
| Événements | `kernel.domain_events` via `PgOutboxWriter(tx)`, `{ v: 1, … }`, sans note ni identité |

## 2. Vue d'ensemble

```
exam_types ─< exam_tracks ─< exam_papers (modèles)          document_requirements     export_formats (données, versionnés)
     │
sessions (OFFICIAL | MOCK ; définition copiée puis figée)
     ├─< session_tracks ─< session_papers            ◄── instantiate_session_definition()
     ├─< session_centers >─ centers ─< rooms
     └─< candidates (identité figée ; numéro sans trou)
            ├─< candidate_identifiers (numéro officiel, code CEPE…)
            ├─< eligibility_checks (append-only) ──► candidates.eligibility_status (dérivé)
            ├─< candidate_documents ─> document_requirements
            ├─< seat_assignments (session_centers × rooms × place)
            ├─< candidate_history (append-only, par déclencheur)
            ├─< paper_scores ─< score_revisions (append-only)           paper_assessment_links (MOCK ↔ assess)
            ├─  candidate_results ─< result_revisions (append-only) ──► candidates.outcome (dérivé)
            └─< issued_documents (convocation, attestation, relevé)

import_batches ─< import_rows (append-only)      export_runs      number_sequences + next_number()
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (école de 600 élèves, 1 classe de CM2 de 60 élèves) |
|---|---|---|
| `exam_types`, `exam_tracks`, `exam_papers`, `document_requirements` | Types et leurs données | 1 à 4 types ; 0 à 10 séries ; 3 à 20 épreuves |
| `export_formats` | Formats d'export versionnés | 2 à 10 |
| `centers`, `rooms`, `session_centers` | Centres, salles | 1 à 5 centres ; 5 à 30 salles |
| `sessions`, `session_tracks`, `session_papers` | Sessions et définition figée | 2 à 4 par an (officielle + blancs) |
| `candidates`, `candidate_identifiers`, `candidate_documents` | Candidats | 60 par session |
| `eligibility_checks`, `candidate_history` | Journaux | ≈ 2 + ≈ 6 par candidat |
| `seat_assignments` | Répartition | 60 par session |
| `paper_scores`, `score_revisions` | Notes, corrections | 60 × 3 ; < 2 % |
| `candidate_results`, `result_revisions` | Résultats | 60 ; < 2 % |
| `import_batches`, `import_rows` | Imports | 1 à 5 lots ; ≈ 60 lignes par lot |
| `paper_assessment_links` | Examens blancs | 3 par session blanche |
| `export_runs`, `issued_documents` | Exports, documents | 5 à 20 ; ≈ 2 par candidat |
| `number_sequences` | Compteurs | 1 par session |

## 4. Les décisions de modélisation à connaître

1. **Types d'examens = données ; règles = `rules`.** Aucune colonne ne porte un seuil ; `result_contract_id` désigne le contrat de règles (`exam-national@1`) ; `source_kind = 'regulation'` exige `source_reference` (contrainte) ; `placeholder` marque toute valeur fictive.
2. **Définition de session copiée puis figée.** `instantiate_session_definition` copie séries et épreuves **actives** du type dans `session_tracks`/`session_papers`, puis pose `definition_locked_at` (inaltérable). Une session passée est reproductible quelles que soient les évolutions du modèle (testé : modifier le coefficient du type ne change pas la session).
3. **Identité figée à l'inscription.** Nom, prénom, naissance, sexe sont copiés dans `candidates` (`snapshot_taken_at`) : une liste officielle reste reproductible ; `people` reste la source de l'identité courante.
4. **Statuts dérivés, jamais posés.** `candidates.eligibility_status` vient de `eligibility_checks` (trigger `AFTER INSERT`), `candidates.outcome` vient de `candidate_results` (trigger `AFTER INSERT/UPDATE`) ; le déclencheur du candidat refuse toute écriture directe grâce à `pg_trigger_depth()` (profondeur 1 = application, ≥ 2 = autre déclencheur) — testé.
5. **Numéro de candidat sans trou, attribué par la base.** `candidate_seq` est pris dans `next_number('cand:<session>')` **au moment du passage à `REGISTERED`**, dans la transaction du candidat ; `candidate_number` est formaté par le motif du type (`format_number`, jamais tronqué) ; immuable, unique par session. Un retrait garde son numéro ; aucune réattribution. Concurrence testée (20 inscriptions, 4 sessions : `00001`…`00020`).
6. **Résultats officiels vs blancs dans un seul modèle.** `candidate_results.source` : `IMPORTED` (lot obligatoire), `ENTERED` (auteur obligatoire) — **seules** voies d'une session `OFFICIAL` ; `COMPUTED` (version de règle et empreinte d'entrées obligatoires) — **seule** voie d'une session `MOCK`. Les deux croisements interdits sont des déclencheurs testés.
7. **Révisions tracées avant correction.** Une note (session `RESULTS_ENTERED`) ou un résultat publié ne change que si une révision **de la même transaction** (`xid = txid_current()`) annonce exactement l'ancienne et la nouvelle valeur, approuvée par une personne **différente** du demandeur (`CHECK`). Aucun accès SQL direct d'`app_user` ne contourne cette trace.
8. **Formats d'export sans expression libre.** `valid_export_columns` (fonction immuable, appelée par `CHECK`) n'accepte que des champs de la liste blanche et des transformations de la liste blanche ; un format publié est figé ; un export n'utilise qu'un format publié et en enregistre la version.
9. **Une place, un candidat ; une session, un centre.** Les FK composites imposent que le candidat, le centre (de la **session**) et la salle (du **centre**) soient cohérents ; la capacité de salle et l'état de la salle sont vérifiés ; la répartition est figée dès que la session est en cours.
10. **Publication complète.** Une session ne se publie que si **chaque** candidat inscrit a un résultat ; les documents officiels n'existent que pour un résultat **ADMIS publié** (attestation) ou une place attribuée (convocation).

## 5. DDL de référence

### 5.1 Schéma, numérotation, types d'examens, centres, formats d'export

<!-- migration: 2000_examinations_reference.sql -->
```sql
-- =============================================================================
-- 2000 — Module examinations : schéma, types d'examens, séries, épreuves, centres, pièces, formats d'export
-- =============================================================================
--
-- Plage de numéros réservée au module examinations : 2000–2099 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; ligne à inscrire dans ce tableau).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma ; AUCUNE clé étrangère vers le schéma d'un autre module, sauf
--     `kernel.tenants(id)`. Élève, inscription, classe, évaluation `assess`, document `reportcards`,
--     version de règle `rules` : UUID vérifiés par les API publiques de ces modules ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, `kernel.enable_tenant_rls()`,
--     GRANT explicite à `app_user` ; allowlist d'isolation VIDE (aucune table globale) ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle réglementaire : un TYPE d'examen (CEPE, BEPC, BAC, BTS…) est une ligne de données ;
--     épreuves, coefficients, conditions d'éligibilité, seuil d'admission, mentions, taux de réussite
--     sont des DONNÉES ou des règles (`rules`, contrat `exam-national@1`). Toute valeur porte son origine
--     (`source_kind`) ; `placeholder` = valeur FICTIVE de démonstration, jamais une règle officielle.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS examinations;
REVOKE ALL ON SCHEMA examinations FROM PUBLIC;
GRANT USAGE ON SCHEMA examinations TO app_user;

CREATE FUNCTION examinations.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'examinations.append_only: la table % est en ajout seul (% refusé)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- -----------------------------------------------------------------------------
-- Numérotation transactionnelle SANS TROU (un compteur par portée) : l'incrément vit dans la transaction
-- de l'appelant ; une annulation ne consomme aucun numéro, deux sessions concurrentes se sérialisent.
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.number_sequences (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  scope_key  text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 120),
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope_key)
);
SELECT kernel.enable_tenant_rls('examinations.number_sequences');
GRANT SELECT, INSERT, UPDATE ON examinations.number_sequences TO app_user;

CREATE FUNCTION examinations.next_number(p_scope text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO examinations.number_sequences AS s (tenant_id, scope_key, last_value)
  VALUES (kernel.current_tenant_id(), p_scope, 1)
  ON CONFLICT (tenant_id, scope_key) DO UPDATE SET last_value = s.last_value + 1, updated_at = now()
  RETURNING last_value
$$;
GRANT EXECUTE ON FUNCTION examinations.next_number(text) TO app_user;

-- Motif de numéro de candidat : jetons {TYPE} {YEAR} {SEQ:n} (n chiffres, complétés par des zéros).
CREATE FUNCTION examinations.format_number(p_pattern text, p_type text, p_year integer, p_seq bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_out text := p_pattern;
  v_width integer;
  v_m text[];
BEGIN
  v_out := replace(v_out, '{TYPE}', p_type);
  v_out := replace(v_out, '{YEAR}', p_year::text);
  v_m := regexp_match(v_out, '\{SEQ:([0-9]{1,2})\}');
  IF v_m IS NOT NULL THEN
    v_width := v_m[1]::integer;
    -- lpad TRONQUE un texte plus long que la largeur : un numéro ne doit jamais être tronqué
    v_out := regexp_replace(v_out, '\{SEQ:[0-9]{1,2}\}',
                            CASE WHEN length(p_seq::text) >= v_width THEN p_seq::text ELSE lpad(p_seq::text, v_width, '0') END);
  ELSE
    v_out := replace(v_out, '{SEQ}', p_seq::text);
  END IF;
  RETURN v_out;
END
$$;

-- -----------------------------------------------------------------------------
-- Types d'examens (CEPE, BEPC, BAC, BTS…) : DONNÉES instanciées depuis le modèle de pack
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.exam_types (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  code                     text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  label                    text NOT NULL CHECK (length(btrim(label)) > 0),
  education_level_code     text NOT NULL CHECK (education_level_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  grade_level_code         text CHECK (grade_level_code IS NULL OR grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),   -- niveau de la classe d'examen (ex. CM2)
  result_contract_id       text NOT NULL DEFAULT 'exam-national@1' CHECK (result_contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  candidate_number_pattern text NOT NULL DEFAULT '{TYPE}{YEAR}-{SEQ:5}' CHECK (length(candidate_number_pattern) BETWEEN 3 AND 60),
  source_kind              text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference         text,
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0),
  CHECK (candidate_number_pattern ~ '\{SEQ(:[0-9]{1,2})?\}')
);
SELECT kernel.enable_tenant_rls('examinations.exam_types');
GRANT SELECT, INSERT, UPDATE ON examinations.exam_types TO app_user;

CREATE TABLE examinations.exam_tracks (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id  uuid NOT NULL,
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  label         text NOT NULL CHECK (length(btrim(label)) > 0),
  source_kind   text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_type_id, code),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.exam_tracks');
GRANT SELECT, INSERT, UPDATE ON examinations.exam_tracks TO app_user;

-- Épreuves d'un type (modèle) : copiées dans chaque session à sa création (voir 2001) — modifier le
-- modèle ne change JAMAIS une session existante.
CREATE TABLE examinations.exam_papers (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id  uuid NOT NULL,
  track_code    text,                                      -- NULL = commune à toutes les séries
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,29}$'),
  label         text NOT NULL CHECK (length(btrim(label)) > 0),
  coefficient   numeric(6, 3) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  scale_max     numeric(6, 2) NOT NULL DEFAULT 20 CHECK (scale_max > 0),
  is_optional   boolean NOT NULL DEFAULT false,
  ordinal       integer NOT NULL CHECK (ordinal >= 1),
  source_kind   text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id),
  FOREIGN KEY (tenant_id, exam_type_id, track_code) REFERENCES examinations.exam_tracks (tenant_id, exam_type_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.exam_papers');
CREATE UNIQUE INDEX exam_papers_unique
  ON examinations.exam_papers (tenant_id, exam_type_id, coalesce(track_code, ''), code);
GRANT SELECT, INSERT, UPDATE ON examinations.exam_papers TO app_user;

-- Pièces exigées d'un candidat (par type d'examen) : données
CREATE TABLE examinations.document_requirements (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id  uuid NOT NULL,
  code          text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label         text NOT NULL CHECK (length(btrim(label)) > 0),
  required      boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  source_kind   text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_type_id, code),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.document_requirements');
GRANT SELECT, INSERT, UPDATE ON examinations.document_requirements TO app_user;

-- -----------------------------------------------------------------------------
-- Centres d'examen et salles (centre de l'établissement ou centre d'accueil)
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.centers (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  kind            text NOT NULL CHECK (kind IN ('OWN', 'HOST')),
  authority_code  text,                                    -- code officiel du centre, si l'autorité en attribue un
  locality        text,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.centers');
GRANT SELECT, INSERT, UPDATE ON examinations.centers TO app_user;

CREATE TABLE examinations.rooms (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  center_id   uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,19}$'),
  label       text,
  capacity    integer NOT NULL CHECK (capacity > 0),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, center_id, id),
  UNIQUE (tenant_id, center_id, code),
  FOREIGN KEY (tenant_id, center_id) REFERENCES examinations.centers (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.rooms');
GRANT SELECT, INSERT, UPDATE ON examinations.rooms TO app_user;

-- -----------------------------------------------------------------------------
-- Formats d'export : DONNÉES (colonnes et mapping), versionnés. Une colonne ne peut citer qu'un
-- chemin de champ de la liste blanche (aucune interpolation libre, aucune expression exécutable).
-- -----------------------------------------------------------------------------
CREATE FUNCTION examinations.valid_export_columns(p_columns jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_columns) = 'array'
     AND jsonb_array_length(p_columns) BETWEEN 1 AND 60
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_columns) c
        WHERE jsonb_typeof(c) <> 'object'
           OR coalesce(c ->> 'header', '') = ''
           OR length(c ->> 'header') > 80
           OR coalesce(c ->> 'source', '') NOT IN (
                'candidate.number', 'candidate.official_number', 'candidate.last_name', 'candidate.first_name', 'candidate.birth_date',
                'candidate.birth_place', 'candidate.sex', 'candidate.track', 'candidate.grade_level', 'candidate.institution',
                'candidate.status', 'candidate.identifier.cepe_code', 'candidate.identifier.national_id',
                'assignment.center_code', 'assignment.center_name', 'assignment.room_code', 'assignment.seat_number', 'assignment.table_number',
                'result.code', 'result.average', 'result.rank', 'result.mention', 'result.total_points',
                'paper.score', 'constant')
           OR (c ->> 'source' LIKE 'paper.%' AND coalesce(c ->> 'paper', '') = '')
           OR coalesce(c ->> 'transform', 'none') NOT IN ('none', 'upper', 'lower', 'date_iso', 'date_dmy', 'sex_fm', 'decimal_comma', 'pad_left_8'))
$$;

CREATE TABLE examinations.export_formats (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  exam_type_id     uuid,
  kind             text NOT NULL CHECK (kind IN ('CANDIDATE_LIST', 'CENTER_ASSIGNMENTS', 'RESULTS', 'STATISTICS')),
  file_format      text NOT NULL CHECK (file_format IN ('CSV', 'XLSX', 'FIXED_WIDTH', 'JSON')),
  encoding         text NOT NULL DEFAULT 'UTF-8' CHECK (encoding IN ('UTF-8', 'ISO-8859-1', 'WINDOWS-1252')),
  delimiter        text CHECK (delimiter IS NULL OR delimiter IN (',', ';', E'\t', '|')),
  columns          jsonb NOT NULL CHECK (examinations.valid_export_columns(columns)),
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  source_kind      text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, version),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  CHECK (file_format <> 'CSV' OR delimiter IS NOT NULL),
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.export_formats');
CREATE UNIQUE INDEX export_formats_one_published ON examinations.export_formats (tenant_id, code) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE ON examinations.export_formats TO app_user;

-- Un format publié est figé (une correction = nouvelle version) ; DRAFT -> PUBLISHED -> RETIRED.
CREATE FUNCTION examinations.export_formats_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'examinations.format_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.columns IS DISTINCT FROM OLD.columns OR NEW.file_format <> OLD.file_format OR NEW.encoding <> OLD.encoding
        OR NEW.delimiter IS DISTINCT FROM OLD.delimiter OR NEW.kind <> OLD.kind OR NEW.label <> OLD.label
        OR NEW.exam_type_id IS DISTINCT FROM OLD.exam_type_id OR NEW.source_kind <> OLD.source_kind) THEN
    RAISE EXCEPTION 'examinations.format_published_immutable: un format publié ne se modifie pas (créer une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
    RAISE EXCEPTION 'examinations.format_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER export_formats_guard BEFORE UPDATE ON examinations.export_formats
  FOR EACH ROW EXECUTE FUNCTION examinations.export_formats_guard();
```

### 5.2 Sessions, candidats, éligibilité, pièces, répartition, historique

<!-- migration: 2001_examinations_sessions_candidates.sql -->
```sql
-- =============================================================================
-- 2001 — Module examinations : sessions, définition figée, candidats, éligibilité, pièces, centres, affectations
-- =============================================================================
--
-- Une SESSION est la participation d'un établissement à une édition d'un examen (officiel) ou la
-- tenue d'un examen blanc. À sa préparation, la définition de l'examen (séries, épreuves, coefficients)
-- est COPIÉE dans la session puis figée (`instantiate_session_definition`) : une session passée ne change
-- jamais, même si le modèle du type évolue.
--
-- Statuts de session : PLANNED > REGISTRATION_OPEN > REGISTRATION_CLOSED > IN_PROGRESS > RESULTS_ENTERED
-- > PUBLISHED > ARCHIVED (retour permis : REGISTRATION_CLOSED -> REGISTRATION_OPEN).
-- =============================================================================

CREATE TABLE examinations.sessions (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id            uuid NOT NULL,
  institution_id          uuid NOT NULL,                          -- tenancy.institutions.id (sans FK)
  academic_year_id        uuid,                                    -- academic.academic_years.id (sans FK)
  code                    text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label                   text NOT NULL CHECK (length(btrim(label)) > 0),
  session_kind            text NOT NULL DEFAULT 'OFFICIAL' CHECK (session_kind IN ('OFFICIAL', 'MOCK')),
  attempt_kind            text NOT NULL DEFAULT 'NORMAL' CHECK (attempt_kind IN ('NORMAL', 'MAKEUP')),
  session_year            integer NOT NULL CHECK (session_year BETWEEN 2000 AND 2200),
  mock_of_session_id      uuid,
  registration_opens_on   date,
  registration_closes_on  date,
  starts_on               date,
  ends_on                 date,
  status                  text NOT NULL DEFAULT 'PLANNED' CHECK (status IN
                            ('PLANNED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED')),
  definition_locked_at    timestamptz,
  rule_version_ref        uuid,                                    -- version de règle `exam-national@1` épinglée (rules.rule_versions.id)
  source_kind             text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (registration_closes_on IS NULL OR registration_opens_on IS NULL OR registration_closes_on >= registration_opens_on),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CHECK (mock_of_session_id IS NULL OR session_kind = 'MOCK'),
  CHECK (mock_of_session_id IS NULL OR mock_of_session_id <> id),
  CHECK (status IN ('PLANNED') OR definition_locked_at IS NOT NULL),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id),
  FOREIGN KEY (tenant_id, mock_of_session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.sessions');
CREATE INDEX sessions_by_type_year ON examinations.sessions (tenant_id, exam_type_id, session_year, status);
GRANT SELECT, INSERT, UPDATE ON examinations.sessions TO app_user;

-- Définition figée de la session : séries et épreuves copiées du type
CREATE TABLE examinations.session_tracks (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id   uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  label        text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, code),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.session_tracks');
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.session_tracks TO app_user;   -- garde : session non figée

CREATE TABLE examinations.session_papers (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  track_code    text,
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,29}$'),
  label         text NOT NULL,
  coefficient   numeric(6, 3) NOT NULL CHECK (coefficient > 0),
  scale_max     numeric(6, 2) NOT NULL CHECK (scale_max > 0),
  is_optional   boolean NOT NULL DEFAULT false,
  ordinal       integer NOT NULL CHECK (ordinal >= 1),
  source_kind   text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id, track_code) REFERENCES examinations.session_tracks (tenant_id, session_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.session_papers');
CREATE UNIQUE INDEX session_papers_unique ON examinations.session_papers (tenant_id, session_id, coalesce(track_code, ''), code);
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.session_papers TO app_user;   -- garde : session non figée

CREATE FUNCTION examinations.session_definition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_locked timestamptz;
  v_tenant uuid;
  v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_session := OLD.session_id;
  ELSE v_tenant := NEW.tenant_id; v_session := NEW.session_id; END IF;
  SELECT definition_locked_at INTO v_locked FROM examinations.sessions s WHERE s.tenant_id = v_tenant AND s.id = v_session;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.definition_locked: la définition de la session est figée depuis le %', v_locked USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER session_tracks_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.session_tracks
  FOR EACH ROW EXECUTE FUNCTION examinations.session_definition_guard();
CREATE TRIGGER session_papers_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.session_papers
  FOR EACH ROW EXECUTE FUNCTION examinations.session_definition_guard();

-- Copie la définition du type (séries et épreuves ACTIVES) dans la session puis la fige. Renvoie le nombre d'épreuves.
CREATE FUNCTION examinations.instantiate_session_definition(p_session uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_s examinations.sessions%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = kernel.current_tenant_id() AND s.id = p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'examinations.session_not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_s.definition_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.definition_locked: la définition de la session est déjà figée' USING ERRCODE = 'restrict_violation';
  END IF;
  INSERT INTO examinations.session_tracks (id, tenant_id, session_id, code, label)
    SELECT gen_random_uuid(), t.tenant_id, v_s.id, t.code, t.label
      FROM examinations.exam_tracks t WHERE t.tenant_id = v_s.tenant_id AND t.exam_type_id = v_s.exam_type_id AND t.active;
  INSERT INTO examinations.session_papers (id, tenant_id, session_id, track_code, code, label, coefficient, scale_max, is_optional, ordinal, source_kind)
    SELECT gen_random_uuid(), p.tenant_id, v_s.id, p.track_code, p.code, p.label, p.coefficient, p.scale_max, p.is_optional, p.ordinal, p.source_kind
      FROM examinations.exam_papers p WHERE p.tenant_id = v_s.tenant_id AND p.exam_type_id = v_s.exam_type_id AND p.active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'examinations.no_papers: le type d''examen ne compte aucune épreuve active' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE examinations.sessions SET definition_locked_at = now() WHERE tenant_id = v_s.tenant_id AND id = v_s.id;
  RETURN v_n;
END
$$;
GRANT EXECUTE ON FUNCTION examinations.instantiate_session_definition(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Candidats
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidates (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id          uuid NOT NULL,
  institution_id      uuid NOT NULL,
  student_id          uuid NOT NULL,                         -- people.students.id (sans FK)
  enrollment_id       uuid,                                   -- academic.enrollments.id (sans FK)
  grade_level_code    text,
  track_code          text,
  -- identité figée à l'inscription (les listes officielles doivent rester reproductibles)
  last_name           text,
  first_name          text,
  birth_date          date,
  birth_place         text,
  sex                 text CHECK (sex IN ('F', 'M')),
  snapshot_taken_at   timestamptz,
  registration_status text NOT NULL DEFAULT 'DRAFT' CHECK (registration_status IN ('DRAFT', 'PRE_REGISTERED', 'REGISTERED', 'WITHDRAWN')),
  eligibility_status  text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK (eligibility_status IN ('NOT_EVALUATED', 'ELIGIBLE', 'INELIGIBLE', 'NEEDS_REVIEW')),
  outcome             text NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  candidate_seq       bigint,
  candidate_number    text,
  registered_at       timestamptz,
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  created_by          uuid,
  row_version         integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, id),
  UNIQUE (tenant_id, session_id, candidate_number),
  CHECK ((candidate_seq IS NULL) = (candidate_number IS NULL)),
  CHECK (registration_status <> 'REGISTERED' OR (candidate_number IS NOT NULL AND registered_at IS NOT NULL
         AND last_name IS NOT NULL AND first_name IS NOT NULL AND birth_date IS NOT NULL AND sex IS NOT NULL AND snapshot_taken_at IS NOT NULL)),
  CHECK (registration_status <> 'WITHDRAWN' OR (withdrawn_at IS NOT NULL AND length(btrim(coalesce(withdrawn_reason, ''))) >= 5)),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id, track_code) REFERENCES examinations.session_tracks (tenant_id, session_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.candidates');
-- Un élève n'a qu'un candidat vivant par session.
CREATE UNIQUE INDEX candidates_one_live_per_student
  ON examinations.candidates (tenant_id, session_id, student_id) WHERE registration_status <> 'WITHDRAWN';
CREATE INDEX candidates_by_session ON examinations.candidates (tenant_id, session_id, registration_status, outcome);
CREATE INDEX candidates_by_student ON examinations.candidates (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON examinations.candidates TO app_user;

-- Identifiants du candidat (numéro officiel attribué par l'autorité, code CEPE du legacy, identifiant national…)
CREATE TABLE examinations.candidate_identifiers (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  kind          text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,39}$'),   -- OFFICIAL_NUMBER, CEPE_CODE, NATIONAL_ID…
  value         text NOT NULL CHECK (length(btrim(value)) > 0),
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'MIGRATION')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, kind),
  UNIQUE (tenant_id, session_id, kind, value),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_identifiers');
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_identifiers TO app_user;

-- Éligibilité : journal des évaluations (règle `eligibilite` du contrat exam-national@1). Ajout seul.
CREATE TABLE examinations.eligibility_checks (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id     uuid NOT NULL,
  rule_version_ref uuid,                                   -- NULL tant qu'aucune règle n'est liée (résultat manuel)
  result           text NOT NULL CHECK (result IN ('ELIGIBLE', 'INELIGIBLE', 'NEEDS_REVIEW')),
  reasons          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  inputs_hash      text CHECK (inputs_hash IS NULL OR inputs_hash ~ '^[0-9a-f]{64}$'),
  evaluated_by     uuid,
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  overridden_by    uuid,
  override_reason  text,
  UNIQUE (tenant_id, id),
  CHECK ((overridden_by IS NULL) = (override_reason IS NULL)),
  CHECK (override_reason IS NULL OR length(btrim(override_reason)) >= 10),
  CHECK (rule_version_ref IS NOT NULL OR evaluated_by IS NOT NULL),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.eligibility_checks');
CREATE INDEX eligibility_checks_by_candidate ON examinations.eligibility_checks (tenant_id, candidate_id, evaluated_at DESC);
GRANT SELECT, INSERT ON examinations.eligibility_checks TO app_user;
CREATE TRIGGER eligibility_checks_append_only BEFORE UPDATE OR DELETE ON examinations.eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- Pièces des candidats
CREATE TABLE examinations.candidate_documents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id    uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  status          text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  document_ref    uuid,
  storage_key     text,
  rejection_reason text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, requirement_id),
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) > 0),
  CHECK (status NOT IN ('ACCEPTED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id),
  FOREIGN KEY (tenant_id, requirement_id) REFERENCES examinations.document_requirements (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_documents');
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_documents TO app_user;

CREATE FUNCTION examinations.missing_required_documents(p_candidate uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(r.code ORDER BY r.sort_order, r.code), ARRAY[]::text[])
    FROM examinations.candidates c
    JOIN examinations.sessions s ON s.tenant_id = c.tenant_id AND s.id = c.session_id
    JOIN examinations.document_requirements r
      ON r.tenant_id = c.tenant_id AND r.exam_type_id = s.exam_type_id AND r.required AND r.active
    LEFT JOIN examinations.candidate_documents d
      ON d.tenant_id = c.tenant_id AND d.candidate_id = c.id AND d.requirement_id = r.id
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.id = p_candidate
     AND (d.id IS NULL OR d.status <> 'ACCEPTED')
$$;
GRANT EXECUTE ON FUNCTION examinations.missing_required_documents(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Centres de la session et affectations (centre, salle, place)
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.session_centers (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id   uuid NOT NULL,
  center_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, center_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, center_id) REFERENCES examinations.centers (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.session_centers');
GRANT SELECT, INSERT, DELETE ON examinations.session_centers TO app_user;

CREATE TABLE examinations.seat_assignments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  center_id     uuid NOT NULL,
  room_id       uuid NOT NULL,
  seat_number   integer NOT NULL CHECK (seat_number >= 1),
  table_number  text,
  assigned_by   uuid,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, candidate_id),                 -- un candidat, une place par session
  UNIQUE (tenant_id, session_id, room_id, seat_number),         -- une place, un candidat
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id, center_id) REFERENCES examinations.session_centers (tenant_id, session_id, center_id),
  FOREIGN KEY (tenant_id, center_id, room_id) REFERENCES examinations.rooms (tenant_id, center_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.seat_assignments');
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.seat_assignments TO app_user;

CREATE FUNCTION examinations.seat_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap integer;
  v_status text;
  v_cand_status text;
  v_session_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_session_status FROM examinations.sessions s WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.session_id;
    IF v_session_status IN ('IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'examinations.assignment_frozen: la répartition est figée (session %)', v_session_status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_session_status FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  IF v_session_status IN ('IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'examinations.assignment_frozen: la répartition est figée (session %)', v_session_status USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT registration_status INTO v_cand_status FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_cand_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit une place (statut %)', v_cand_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT capacity, CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END INTO v_cap, v_status
    FROM examinations.rooms r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.room_id;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'examinations.room_inactive: la salle est désactivée' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seat_number > v_cap THEN
    RAISE EXCEPTION 'examinations.seat_beyond_capacity: la place % dépasse la capacité de la salle (%)', NEW.seat_number, v_cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER seat_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.seat_assignments
  FOR EACH ROW EXECUTE FUNCTION examinations.seat_assignments_guard();

-- -----------------------------------------------------------------------------
-- Historique du candidat : ajout seul, alimenté automatiquement
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidate_history (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id  uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('CREATED', 'STATUS', 'ELIGIBILITY', 'OUTCOME', 'ASSIGNMENT', 'NOTE')),
  from_value    text,
  to_value      text,
  reason        text,
  actor_id      uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_history');
CREATE INDEX candidate_history_by_candidate ON examinations.candidate_history (tenant_id, candidate_id, occurred_at);
GRANT SELECT, INSERT ON examinations.candidate_history TO app_user;
CREATE TRIGGER candidate_history_append_only BEFORE UPDATE OR DELETE ON examinations.candidate_history
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- =============================================================================
-- Gardes : session
-- =============================================================================
CREATE FUNCTION examinations.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_missing integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.definition_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'examinations.session_initial_state: une session naît PLANNED, définition non figée' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mock_of_session_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM examinations.sessions o WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.mock_of_session_id
            AND o.exam_type_id = NEW.exam_type_id AND o.session_kind = 'OFFICIAL') THEN
      RAISE EXCEPTION 'examinations.mock_target_invalid: un examen blanc prépare une session OFFICIELLE du même type' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.exam_type_id <> OLD.exam_type_id OR NEW.institution_id <> OLD.institution_id OR NEW.session_kind <> OLD.session_kind
     OR NEW.session_year <> OLD.session_year OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'examinations.session_identity_immutable: type, établissement, nature, année et code sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.definition_locked_at IS NOT NULL AND NEW.definition_locked_at IS DISTINCT FROM OLD.definition_locked_at THEN
    RAISE EXCEPTION 'examinations.definition_locked: la date de gel est inaltérable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'examinations.session_archived: une session archivée est figée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'PLANNED'             AND NEW.status = 'REGISTRATION_OPEN') OR
      (OLD.status = 'REGISTRATION_OPEN'   AND NEW.status = 'REGISTRATION_CLOSED') OR
      (OLD.status = 'REGISTRATION_CLOSED' AND NEW.status IN ('REGISTRATION_OPEN', 'IN_PROGRESS')) OR
      (OLD.status = 'IN_PROGRESS'         AND NEW.status = 'RESULTS_ENTERED') OR
      (OLD.status = 'RESULTS_ENTERED'     AND NEW.status IN ('IN_PROGRESS', 'PUBLISHED')) OR
      (OLD.status = 'PUBLISHED'           AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'examinations.session_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'REGISTRATION_OPEN' AND NEW.definition_locked_at IS NULL THEN
      RAISE EXCEPTION 'examinations.definition_not_locked: figer la définition (épreuves, séries) avant d''ouvrir les inscriptions' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' THEN
      SELECT count(*) INTO v_missing
        FROM examinations.candidates c
       WHERE c.tenant_id = NEW.tenant_id AND c.session_id = NEW.id AND c.registration_status = 'REGISTERED'
         AND NOT EXISTS (SELECT 1 FROM examinations.candidate_results r WHERE r.tenant_id = c.tenant_id AND r.candidate_id = c.id);
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'examinations.results_incomplete: % candidat(s) inscrit(s) sans résultat', v_missing USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- (le déclencheur est créé en 2002, une fois `candidate_results` définie)

-- =============================================================================
-- Gardes : candidat
-- =============================================================================
CREATE FUNCTION examinations.candidates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s     examinations.sessions%ROWTYPE;
  v_type  examinations.exam_types%ROWTYPE;
  v_miss  text[];
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  IF NEW.institution_id <> v_s.institution_id THEN
    RAISE EXCEPTION 'examinations.candidate_institution: le candidat doit appartenir à l''établissement de la session' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_s.status NOT IN ('PLANNED', 'REGISTRATION_OPEN') THEN
      RAISE EXCEPTION 'examinations.session_registration_closed: la session est % ; plus de nouveau candidat', v_s.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.registration_status <> 'DRAFT' OR NEW.candidate_number IS NOT NULL OR NEW.outcome <> 'PENDING' THEN
      RAISE EXCEPTION 'examinations.candidate_initial_state: un candidat naît DRAFT, sans numéro ni résultat' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.session_id <> OLD.session_id OR NEW.student_id <> OLD.student_id OR NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: session, élève et établissement sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.candidate_number IS NOT NULL AND (NEW.candidate_number IS DISTINCT FROM OLD.candidate_number OR NEW.candidate_seq IS DISTINCT FROM OLD.candidate_seq) THEN
    RAISE EXCEPTION 'examinations.candidate_number_immutable: le numéro de candidat ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.outcome <> OLD.outcome AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.outcome_derived: l''issue d''un candidat est dérivée de son résultat (saisir le résultat)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.eligibility_status <> OLD.eligibility_status AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.eligibility_derived: le statut d''éligibilité est dérivé du journal des évaluations' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.registration_status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'examinations.candidate_withdrawn: un candidat retiré ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  -- après inscription, l'identité figée ne change plus
  IF OLD.registration_status = 'REGISTERED' AND (NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.birth_date IS DISTINCT FROM OLD.birth_date OR NEW.sex IS DISTINCT FROM OLD.sex OR NEW.birth_place IS DISTINCT FROM OLD.birth_place
       OR NEW.track_code IS DISTINCT FROM OLD.track_code) THEN
    RAISE EXCEPTION 'examinations.candidate_snapshot_frozen: l''identité et la série d''un candidat inscrit sont figées' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.registration_status <> OLD.registration_status THEN
    IF NOT (
      (OLD.registration_status = 'DRAFT'          AND NEW.registration_status IN ('PRE_REGISTERED', 'REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'PRE_REGISTERED' AND NEW.registration_status IN ('REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'REGISTERED'     AND NEW.registration_status = 'WITHDRAWN')) THEN
      RAISE EXCEPTION 'examinations.candidate_transition: % -> % interdit', OLD.registration_status, NEW.registration_status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.registration_status = 'REGISTERED' THEN
      IF v_s.status <> 'REGISTRATION_OPEN' THEN
        RAISE EXCEPTION 'examinations.session_registration_closed: les inscriptions ne sont pas ouvertes (session %)', v_s.status USING ERRCODE = 'check_violation';
      END IF;
      SELECT * INTO v_type FROM examinations.exam_types t WHERE t.tenant_id = v_s.tenant_id AND t.id = v_s.exam_type_id;
      IF v_s.session_kind = 'OFFICIAL' THEN
        IF NEW.eligibility_status <> 'ELIGIBLE' THEN
          RAISE EXCEPTION 'examinations.not_eligible: l''éligibilité doit être établie avant l''inscription (statut %)', NEW.eligibility_status USING ERRCODE = 'check_violation';
        END IF;
        v_miss := examinations.missing_required_documents(NEW.id);
        IF cardinality(v_miss) > 0 THEN
          RAISE EXCEPTION 'examinations.documents_incomplete: pièces non acceptées : %', array_to_string(v_miss, ', ') USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.candidate_seq IS NULL THEN
        NEW.candidate_seq := examinations.next_number('cand:' || NEW.session_id::text);
        NEW.candidate_number := examinations.format_number(v_type.candidate_number_pattern, v_type.code, v_s.session_year, NEW.candidate_seq);
      END IF;
      NEW.registered_at := coalesce(NEW.registered_at, now());
      NEW.snapshot_taken_at := coalesce(NEW.snapshot_taken_at, now());
    END IF;
    IF NEW.registration_status = 'WITHDRAWN' THEN
      IF v_s.status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
        RAISE EXCEPTION 'examinations.withdraw_after_results: retrait impossible une fois les résultats saisis' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.withdrawn_at := coalesce(NEW.withdrawn_at, now());
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER candidates_guard BEFORE INSERT OR UPDATE ON examinations.candidates
  FOR EACH ROW EXECUTE FUNCTION examinations.candidates_guard();

-- Historique automatique (création, statut, éligibilité, issue)
CREATE FUNCTION examinations.candidates_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED', NEW.registration_status, kernel.current_user_id());
    RETURN NULL;
  END IF;
  IF NEW.registration_status <> OLD.registration_status THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, reason, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'STATUS', OLD.registration_status, NEW.registration_status, NEW.withdrawn_reason, kernel.current_user_id());
  END IF;
  IF NEW.eligibility_status <> OLD.eligibility_status THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'ELIGIBILITY', OLD.eligibility_status, NEW.eligibility_status, kernel.current_user_id());
  END IF;
  IF NEW.outcome <> OLD.outcome THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'OUTCOME', OLD.outcome, NEW.outcome, kernel.current_user_id());
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER candidates_log AFTER INSERT OR UPDATE ON examinations.candidates
  FOR EACH ROW EXECUTE FUNCTION examinations.candidates_log();

-- L'éligibilité d'un candidat reflète sa DERNIÈRE évaluation (une dérogation motivée vaut ELIGIBLE).
CREATE FUNCTION examinations.eligibility_checks_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE examinations.candidates
     SET eligibility_status = CASE WHEN NEW.overridden_by IS NOT NULL THEN 'ELIGIBLE' ELSE NEW.result END
   WHERE tenant_id = NEW.tenant_id AND id = NEW.candidate_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER eligibility_checks_apply AFTER INSERT ON examinations.eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION examinations.eligibility_checks_apply();
```

### 5.3 Notes, résultats, imports, examens blancs, exports, documents, statistiques

<!-- migration: 2002_examinations_results_exports.sql -->
```sql
-- =============================================================================
-- 2002 — Module examinations : notes d'épreuves, résultats, imports, exports, documents, statistiques
-- =============================================================================
--
-- Deux régimes de résultats, un seul modèle :
--   - session OFFICIELLE : les résultats viennent de l'autorité (import d'un fichier ou saisie) ; l'admission
--     est celle que l'autorité prononce (`source` IMPORTED / ENTERED). Le module ne recalcule rien.
--   - session BLANCHE (examen blanc) : les notes viennent d'`assess` (`source = ASSESS`) ou de la saisie ; la
--     moyenne et l'issue sont calculées par `rules` (contrat `exam-national@1`), avec version de règle et
--     empreinte d'entrées (`source = COMPUTED`).
-- Une note ou un résultat PUBLIÉ ne se corrige que par une RÉVISION tracée insérée dans la même transaction.
-- =============================================================================

CREATE TABLE examinations.paper_scores (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  paper_id      uuid NOT NULL,
  status        text NOT NULL DEFAULT 'ENTERED' CHECK (status IN ('ENTERED', 'ABSENT', 'EXCUSED', 'MALPRACTICE')),
  score         numeric(6, 2) CHECK (score IS NULL OR score >= 0),
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'ASSESS')),
  source_ref    uuid,                                           -- lot d'import, ou évaluation assess (examen blanc)
  entered_by    uuid,
  verified_by   uuid,                                           -- seconde saisie / contrôle
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, paper_id),
  CHECK ((status = 'ENTERED') = (score IS NOT NULL)),
  CHECK (source = 'MANUAL' OR source_ref IS NOT NULL),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id, paper_id) REFERENCES examinations.session_papers (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.paper_scores');
CREATE INDEX paper_scores_by_session ON examinations.paper_scores (tenant_id, session_id, paper_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.paper_scores TO app_user;   -- DELETE : avant la saisie des résultats (garde)

CREATE TABLE examinations.score_revisions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  score_id      uuid NOT NULL,
  from_status   text NOT NULL,
  from_score    numeric(6, 2),
  to_status     text NOT NULL,
  to_score      numeric(6, 2),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by  uuid NOT NULL,
  approved_by   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  xid           bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (approved_by <> requested_by),
  CHECK (from_status <> to_status OR from_score IS DISTINCT FROM to_score),
  FOREIGN KEY (tenant_id, score_id) REFERENCES examinations.paper_scores (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.score_revisions');
GRANT SELECT, INSERT ON examinations.score_revisions TO app_user;
CREATE TRIGGER score_revisions_append_only BEFORE UPDATE OR DELETE ON examinations.score_revisions
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

CREATE FUNCTION examinations.paper_scores_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_cand   examinations.candidates%ROWTYPE;
  v_max    numeric;
  v_sess   uuid;
  v_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_sess := OLD.session_id; v_tenant := OLD.tenant_id;
  ELSE v_sess := NEW.session_id; v_tenant := NEW.tenant_id; END IF;
  SELECT status INTO v_status FROM examinations.sessions s WHERE s.tenant_id = v_tenant AND s.id = v_sess;

  IF TG_OP = 'DELETE' THEN
    IF v_status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'examinations.scores_frozen: les notes ne se suppriment plus (session %)', v_status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_cand FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_cand.registration_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit des notes (statut %)', v_cand.registration_status USING ERRCODE = 'check_violation';
  END IF;
  IF v_status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED') THEN
    RAISE EXCEPTION 'examinations.scores_closed: la saisie des notes n''est ouverte que session en cours ou résultats saisis (session %)', v_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT scale_max INTO v_max FROM examinations.session_papers p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.paper_id;
  IF NEW.score IS NOT NULL AND NEW.score > v_max THEN
    RAISE EXCEPTION 'examinations.score_above_scale: la note % dépasse le barème % de l''épreuve', NEW.score, v_max USING ERRCODE = 'check_violation';
  END IF;
  -- les candidats d'un examen blanc / officiel : la série du candidat doit couvrir l'épreuve
  IF EXISTS (SELECT 1 FROM examinations.session_papers p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.paper_id
               AND p.track_code IS NOT NULL AND p.track_code IS DISTINCT FROM v_cand.track_code) THEN
    RAISE EXCEPTION 'examinations.paper_not_for_track: cette épreuve ne concerne pas la série du candidat' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.paper_id <> OLD.paper_id OR NEW.session_id <> OLD.session_id THEN
      RAISE EXCEPTION 'examinations.score_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    -- une fois les résultats saisis, toute correction passe par une révision de la même transaction
    IF v_status = 'RESULTS_ENTERED' AND (NEW.score IS DISTINCT FROM OLD.score OR NEW.status <> OLD.status) THEN
      IF NOT EXISTS (SELECT 1 FROM examinations.score_revisions r
                      WHERE r.tenant_id = OLD.tenant_id AND r.score_id = OLD.id AND r.xid = txid_current()
                        AND r.from_status = OLD.status AND r.from_score IS NOT DISTINCT FROM OLD.score
                        AND r.to_status = NEW.status AND r.to_score IS NOT DISTINCT FROM NEW.score) THEN
        RAISE EXCEPTION 'examinations.score_revision_required: une note saisie après clôture ne se corrige que par une révision approuvée' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER paper_scores_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.paper_scores
  FOR EACH ROW EXECUTE FUNCTION examinations.paper_scores_guard();

-- -----------------------------------------------------------------------------
-- Lots d'import (fichiers de numéros, de notes, de résultats) et leurs lignes
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.import_batches (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id     uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('OFFICIAL_NUMBERS', 'SCORES', 'RESULTS')),
  file_name      text NOT NULL CHECK (length(btrim(file_name)) > 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  format_code    text,
  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  ok_count       integer NOT NULL DEFAULT 0 CHECK (ok_count >= 0),
  error_count    integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  status         text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'VALIDATED', 'APPLIED', 'REJECTED')),
  uploaded_by    uuid NOT NULL,
  applied_by     uuid,
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, kind, sha256),                -- le même fichier n'est importé qu'une fois
  CHECK (ok_count + error_count <= row_count),
  CHECK (status <> 'APPLIED' OR (error_count = 0 AND applied_by IS NOT NULL AND applied_at IS NOT NULL AND row_count > 0)),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.import_batches');
GRANT SELECT, INSERT, UPDATE ON examinations.import_batches TO app_user;

CREATE FUNCTION examinations.import_batches_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPLIED', 'REJECTED') THEN
    RAISE EXCEPTION 'examinations.batch_closed: un lot % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.kind <> OLD.kind OR NEW.sha256 <> OLD.sha256 THEN
    RAISE EXCEPTION 'examinations.batch_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'UPLOADED' AND NEW.status IN ('VALIDATED', 'REJECTED')) OR
       (OLD.status = 'VALIDATED' AND NEW.status IN ('APPLIED', 'REJECTED'))) THEN
    RAISE EXCEPTION 'examinations.batch_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER import_batches_guard BEFORE UPDATE ON examinations.import_batches
  FOR EACH ROW EXECUTE FUNCTION examinations.import_batches_guard();

-- Lignes d'un lot : identifiants et valeurs utiles seulement (jamais le nom ni l'adresse du candidat)
CREATE TABLE examinations.import_rows (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  batch_id      uuid NOT NULL,
  line_no       integer NOT NULL CHECK (line_no >= 1),
  status        text NOT NULL CHECK (status IN ('OK', 'ERROR', 'SKIPPED')),
  error_code    text,
  candidate_id  uuid,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, line_no),
  CHECK ((status = 'ERROR') = (error_code IS NOT NULL)),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES examinations.import_batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.import_rows');
GRANT SELECT, INSERT ON examinations.import_rows TO app_user;
CREATE TRIGGER import_rows_append_only BEFORE UPDATE OR DELETE ON examinations.import_rows
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Résultats des candidats
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidate_results (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id        uuid NOT NULL,
  candidate_id      uuid NOT NULL,
  result_code       text NOT NULL CHECK (result_code IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  average           numeric(7, 3) CHECK (average IS NULL OR average >= 0),
  total_points      numeric(9, 3) CHECK (total_points IS NULL OR total_points >= 0),
  rank              integer CHECK (rank IS NULL OR rank >= 1),
  mention_code      text CHECK (mention_code IS NULL OR mention_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  source            text NOT NULL CHECK (source IN ('IMPORTED', 'ENTERED', 'COMPUTED')),
  rule_version_ref  uuid,
  inputs_hash       text CHECK (inputs_hash IS NULL OR inputs_hash ~ '^[0-9a-f]{64}$'),
  import_batch_id   uuid,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_at      timestamptz,
  published_by      uuid,
  entered_by        uuid,
  row_version       integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  CHECK (source <> 'COMPUTED' OR (rule_version_ref IS NOT NULL AND inputs_hash IS NOT NULL)),
  CHECK (source <> 'IMPORTED' OR import_batch_id IS NOT NULL),
  CHECK (source <> 'ENTERED' OR entered_by IS NOT NULL),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (result_code NOT IN ('ABSENT', 'EXCLUDED', 'DEFERRED') OR (average IS NULL AND rank IS NULL AND mention_code IS NULL)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, import_batch_id) REFERENCES examinations.import_batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_results');
CREATE INDEX candidate_results_by_session ON examinations.candidate_results (tenant_id, session_id, result_code);
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_results TO app_user;

CREATE TABLE examinations.result_revisions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  result_id      uuid NOT NULL,
  from_code      text NOT NULL,
  to_code        text NOT NULL,
  from_average   numeric(7, 3),
  to_average     numeric(7, 3),
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by   uuid NOT NULL,
  approved_by    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  xid            bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (approved_by <> requested_by),
  FOREIGN KEY (tenant_id, result_id) REFERENCES examinations.candidate_results (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.result_revisions');
GRANT SELECT, INSERT ON examinations.result_revisions TO app_user;
CREATE TRIGGER result_revisions_append_only BEFORE UPDATE OR DELETE ON examinations.result_revisions
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

CREATE FUNCTION examinations.candidate_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s examinations.sessions%ROWTYPE;
  v_c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_c.registration_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit un résultat' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED') THEN
    RAISE EXCEPTION 'examinations.results_closed: la saisie des résultats exige une session en cours ou à résultats saisis (session %)', v_s.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'OFFICIAL' AND NEW.source = 'COMPUTED' THEN
    RAISE EXCEPTION 'examinations.official_not_computed: l''admission officielle est prononcée par l''autorité (import ou saisie), jamais calculée ici' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'MOCK' AND NEW.source = 'IMPORTED' THEN
    RAISE EXCEPTION 'examinations.mock_not_imported: les résultats d''un examen blanc sont calculés, jamais importés' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id THEN
      RAISE EXCEPTION 'examinations.result_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
      -- un résultat publié ne bouge que par une révision de la même transaction
      IF NEW.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.result_published: un résultat publié ne se dépublie pas (réviser)' USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.result_code <> OLD.result_code OR NEW.average IS DISTINCT FROM OLD.average OR NEW.rank IS DISTINCT FROM OLD.rank
         OR NEW.mention_code IS DISTINCT FROM OLD.mention_code OR NEW.total_points IS DISTINCT FROM OLD.total_points THEN
        IF NOT EXISTS (SELECT 1 FROM examinations.result_revisions r
                        WHERE r.tenant_id = OLD.tenant_id AND r.result_id = OLD.id AND r.xid = txid_current()
                          AND r.from_code = OLD.result_code AND r.to_code = NEW.result_code
                          AND r.from_average IS NOT DISTINCT FROM OLD.average AND r.to_average IS NOT DISTINCT FROM NEW.average) THEN
          RAISE EXCEPTION 'examinations.result_revision_required: un résultat publié ne se corrige que par une révision approuvée' USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  ELSE
    IF NEW.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'examinations.result_initial_state: un résultat naît DRAFT (publication = étape distincte)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER candidate_results_guard BEFORE INSERT OR UPDATE ON examinations.candidate_results
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_results_guard();

-- L'issue du candidat suit son résultat (mise à jour imbriquée, autorisée par pg_trigger_depth()).
CREATE FUNCTION examinations.candidate_results_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE examinations.candidates SET outcome = NEW.result_code WHERE tenant_id = NEW.tenant_id AND id = NEW.candidate_id AND outcome <> NEW.result_code;
  RETURN NULL;
END
$$;
CREATE TRIGGER candidate_results_apply AFTER INSERT OR UPDATE ON examinations.candidate_results
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_results_apply();

-- Déclencheur de session (fonction définie en 2001, après `candidate_results`)
CREATE TRIGGER sessions_guard BEFORE INSERT OR UPDATE ON examinations.sessions
  FOR EACH ROW EXECUTE FUNCTION examinations.sessions_guard();

-- Examen blanc : liens entre épreuves d'un examen blanc et évaluations `assess` d'une classe
CREATE TABLE examinations.paper_assessment_links (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id      uuid NOT NULL,
  paper_id        uuid NOT NULL,
  classroom_id    uuid NOT NULL,                              -- academic.classrooms.id (sans FK)
  assessment_id   uuid NOT NULL,                              -- assess.assessments.id (sans FK)
  linked_by       uuid,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, paper_id, classroom_id),
  UNIQUE (tenant_id, assessment_id),
  FOREIGN KEY (tenant_id, session_id, paper_id) REFERENCES examinations.session_papers (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.paper_assessment_links');
GRANT SELECT, INSERT, DELETE ON examinations.paper_assessment_links TO app_user;

CREATE FUNCTION examinations.paper_assessment_links_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind text; v_status text;
BEGIN
  SELECT session_kind, status INTO v_kind, v_status FROM examinations.sessions s WHERE s.tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND s.id = coalesce(NEW.session_id, OLD.session_id);
  IF v_kind <> 'MOCK' THEN
    RAISE EXCEPTION 'examinations.links_mock_only: seules les épreuves d''un examen blanc se lient à des évaluations' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'examinations.links_frozen: les liens sont figés (session %)', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER paper_assessment_links_guard BEFORE INSERT OR DELETE ON examinations.paper_assessment_links
  FOR EACH ROW EXECUTE FUNCTION examinations.paper_assessment_links_guard();

-- -----------------------------------------------------------------------------
-- Exports et documents émis
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.export_runs (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id      uuid NOT NULL,
  format_id       uuid NOT NULL,
  format_version  integer NOT NULL,
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  status          text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  row_count       integer CHECK (row_count IS NULL OR row_count >= 0),
  file_sha256     text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key     text,
  error_code      text,
  requested_by    uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'DONE' OR (row_count IS NOT NULL AND file_sha256 IS NOT NULL AND storage_key IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, format_id) REFERENCES examinations.export_formats (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.export_runs');
GRANT SELECT, INSERT, UPDATE ON examinations.export_runs TO app_user;

-- Un export s'exécute avec un format PUBLIÉ ; son résultat terminé est immuable.
CREATE FUNCTION examinations.export_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text; v_version integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status, version INTO v_status, v_version FROM examinations.export_formats f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.format_id;
    IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'examinations.format_not_published: un export exige un format publié (état : %)', coalesce(v_status, 'inconnu') USING ERRCODE = 'check_violation';
    END IF;
    NEW.format_version := v_version;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'examinations.export_closed: un export terminé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER export_runs_guard BEFORE INSERT OR UPDATE ON examinations.export_runs
  FOR EACH ROW EXECUTE FUNCTION examinations.export_runs_guard();

CREATE TABLE examinations.issued_documents (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id           uuid NOT NULL,
  candidate_id         uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('CONVOCATION', 'ATTESTATION_REUSSITE', 'RELEVE_NOTES')),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  official_document_id uuid,                                  -- reportcards.official_documents.id une fois scellé
  status               text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ISSUED', 'REVOKED')),
  requested_by         uuid NOT NULL,
  issued_at            timestamptz,
  revoked_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, kind, version),
  CHECK ((status = 'ISSUED') = (issued_at IS NOT NULL AND official_document_id IS NOT NULL) OR status = 'REVOKED'),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.issued_documents');
CREATE UNIQUE INDEX issued_documents_one_live ON examinations.issued_documents (tenant_id, candidate_id, kind) WHERE status <> 'REVOKED';
GRANT SELECT, INSERT, UPDATE ON examinations.issued_documents TO app_user;

CREATE FUNCTION examinations.issued_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_res examinations.candidate_results%ROWTYPE; v_c examinations.candidates%ROWTYPE; v_s text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
    SELECT status INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
    IF v_c.registration_status <> 'REGISTERED' THEN
      RAISE EXCEPTION 'examinations.candidate_not_registered: aucun document pour un candidat non inscrit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'ATTESTATION_REUSSITE' THEN
      SELECT * INTO v_res FROM examinations.candidate_results r WHERE r.tenant_id = NEW.tenant_id AND r.candidate_id = NEW.candidate_id;
      IF v_res.id IS NULL OR v_res.result_code <> 'ADMITTED' OR v_res.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.attestation_requires_admission: l''attestation de réussite exige un résultat ADMIS publié' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.kind = 'CONVOCATION' AND NOT EXISTS (SELECT 1 FROM examinations.seat_assignments a WHERE a.tenant_id = NEW.tenant_id AND a.candidate_id = NEW.candidate_id) THEN
      RAISE EXCEPTION 'examinations.convocation_requires_assignment: la convocation exige une place attribuée' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'REVOKED' THEN
    RAISE EXCEPTION 'examinations.document_revoked: un document révoqué est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ISSUED' AND (NEW.status <> 'REVOKED' OR NEW.official_document_id IS DISTINCT FROM OLD.official_document_id OR NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'examinations.document_issued: un document émis ne change plus (le révoquer, puis en émettre un nouveau)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER issued_documents_guard BEFORE INSERT OR UPDATE ON examinations.issued_documents
  FOR EACH ROW EXECUTE FUNCTION examinations.issued_documents_guard();

-- -----------------------------------------------------------------------------
-- Statistiques : COMPTEURS par groupe (établissement, série, sexe, niveau). Les TAUX (taux de réussite)
-- sont calculés par la règle `taux_reussite` du contrat exam-national@1 (dénominateur : question métier) ;
-- ici seuls des effectifs sont fournis. Lecture sous la RLS de l'appelant.
-- -----------------------------------------------------------------------------
CREATE FUNCTION examinations.result_counts(p_session uuid, p_group_by text)
RETURNS TABLE (group_key text, registered integer, present integer, admitted integer, failed integer, absent integer, excluded integer, deferred integer)
LANGUAGE sql STABLE AS $$
  SELECT CASE p_group_by
           WHEN 'INSTITUTION' THEN c.institution_id::text
           WHEN 'TRACK' THEN coalesce(c.track_code, '-')
           WHEN 'SEX' THEN coalesce(c.sex, '-')
           WHEN 'GRADE' THEN coalesce(c.grade_level_code, '-')
           ELSE 'ALL' END AS group_key,
         count(*)::integer AS registered,
         count(*) FILTER (WHERE c.outcome IN ('ADMITTED', 'FAILED', 'EXCLUDED', 'DEFERRED'))::integer AS present,
         count(*) FILTER (WHERE c.outcome = 'ADMITTED')::integer,
         count(*) FILTER (WHERE c.outcome = 'FAILED')::integer,
         count(*) FILTER (WHERE c.outcome = 'ABSENT')::integer,
         count(*) FILTER (WHERE c.outcome = 'EXCLUDED')::integer,
         count(*) FILTER (WHERE c.outcome = 'DEFERRED')::integer
    FROM examinations.candidates c
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.session_id = p_session AND c.registration_status = 'REGISTERED'
     AND p_group_by IN ('INSTITUTION', 'TRACK', 'SEX', 'GRADE', 'ALL')
   GROUP BY 1
   ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION examinations.result_counts(uuid, text) TO app_user;
```

### 5.4 Corrections après résultats et formats d'import (ajouts 2003 et 2004)

Ajouts au DDL de référence, issus de l'implémentation du module (voir `spec.md` §18) : `revision_requests` (**quatre yeux** : la correction est *demandée* par une personne et *approuvée* par une autre, l'approbateur étant l'utilisateur authentifié), correction d'un résultat **publié** possible même session `PUBLISHED` (R-EXA-08), et `import_formats` (formats d'import en **données**, pendant des formats d'export).

<!-- migration: 2003_examinations_corrections.sql -->
```sql
-- =============================================================================
-- 2003 — Module examinations : demandes de révision (quatre yeux) et correction après publication
-- =============================================================================
--
-- Deux ajouts au DDL de référence (2000–2002), motivés par l'implémentation :
--
--   1. `revision_requests` : une correction après résultats est DEMANDÉE par une personne puis APPROUVÉE par une autre.
--      Le DDL de référence ne portait que la révision appliquée (`score_revisions`, `result_revisions`,
--      approbateur <> demandeur) ; sans file d'attente, une seule personne pouvait jouer les deux rôles en
--      passant deux identifiants dans la requête. La demande est un enregistrement distinct, l'approbation
--      l'applique dans UNE transaction (révision + correction) ; l'approbateur est l'utilisateur authentifié.
--
--   2. `candidate_results_guard` : le DDL de référence refusait toute écriture de résultat dès que la session était
--      PUBLISHED, ce qui rendait impossible la correction d'un résultat déjà publié (R-EXA-08 : « seule la
--      révision le corrige », cas limite « correction d'un résultat déjà transmis »). Un résultat PUBLISHED peut
--      désormais être corrigé par révision tant que la session n'est pas ARCHIVED ; les créations et les
--      résultats non publiés restent limités aux sessions IN_PROGRESS / RESULTS_ENTERED.
--
--   3. `valid_export_columns` : la liste blanche gagne les champs `stat.*` (compteurs d'une statistique). Le DDL de référence
--      prévoyait des exports de nature STATISTICS sans champ exploitable.
-- =============================================================================

CREATE TABLE examinations.revision_requests (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  target_kind   text NOT NULL CHECK (target_kind IN ('SCORE', 'RESULT')),
  score_id      uuid,
  result_id     uuid,
  proposed      jsonb NOT NULL CHECK (jsonb_typeof(proposed) = 'object'),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  revision_id   uuid,                                   -- score_revisions.id / result_revisions.id appliquée à l'approbation
  UNIQUE (tenant_id, id),
  CHECK ((target_kind = 'SCORE') = (score_id IS NOT NULL)),
  CHECK ((target_kind = 'RESULT') = (result_id IS NOT NULL)),
  CHECK (status = 'PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (status <> 'APPROVED' OR revision_id IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(decision_note, ''))) >= 5),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, score_id) REFERENCES examinations.paper_scores (tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES examinations.candidate_results (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.revision_requests');
CREATE INDEX revision_requests_by_session ON examinations.revision_requests (tenant_id, session_id, status, requested_at DESC);
-- Une seule demande en attente par cible : pas de demandes concurrentes sur la même note ou le même résultat.
CREATE UNIQUE INDEX revision_requests_one_pending_score ON examinations.revision_requests (tenant_id, score_id) WHERE status = 'PENDING' AND score_id IS NOT NULL;
CREATE UNIQUE INDEX revision_requests_one_pending_result ON examinations.revision_requests (tenant_id, result_id) WHERE status = 'PENDING' AND result_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON examinations.revision_requests TO app_user;

CREATE FUNCTION examinations.revision_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_res_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'examinations.revision_request_initial_state: une demande naît PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_kind = 'SCORE' AND v_status <> 'RESULTS_ENTERED' THEN
      RAISE EXCEPTION 'examinations.revision_not_needed: une note ne se corrige par révision que session à résultats saisis (session %)', v_status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_kind = 'RESULT' THEN
      SELECT r.status INTO v_res_status FROM examinations.candidate_results r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.result_id;
      IF v_res_status IS DISTINCT FROM 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.revision_not_needed: un résultat non publié se saisit directement' USING ERRCODE = 'check_violation';
      END IF;
      IF v_status NOT IN ('RESULTS_ENTERED', 'PUBLISHED') THEN
        RAISE EXCEPTION 'examinations.revision_not_needed: session % ', v_status USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'examinations.revision_request_closed: une demande % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.target_kind <> OLD.target_kind OR NEW.score_id IS DISTINCT FROM OLD.score_id
     OR NEW.result_id IS DISTINCT FROM OLD.result_id OR NEW.proposed IS DISTINCT FROM OLD.proposed OR NEW.reason <> OLD.reason
     OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'examinations.revision_request_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER revision_requests_guard BEFORE INSERT OR UPDATE ON examinations.revision_requests
  FOR EACH ROW EXECUTE FUNCTION examinations.revision_requests_guard();

-- Liste blanche des champs d'export : ajout des COMPTEURS de statistiques (`stat.*`). Le DDL de référence déclarait des exports de
-- nature STATISTICS sans aucun champ utilisable ; ces champs sont des agrégats (jamais d'identité).
CREATE OR REPLACE FUNCTION examinations.valid_export_columns(p_columns jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_columns) = 'array'
     AND jsonb_array_length(p_columns) BETWEEN 1 AND 60
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_columns) c
        WHERE jsonb_typeof(c) <> 'object'
           OR coalesce(c ->> 'header', '') = ''
           OR length(c ->> 'header') > 80
           OR coalesce(c ->> 'source', '') NOT IN (
                'candidate.number', 'candidate.official_number', 'candidate.last_name', 'candidate.first_name', 'candidate.birth_date',
                'candidate.birth_place', 'candidate.sex', 'candidate.track', 'candidate.grade_level', 'candidate.institution',
                'candidate.status', 'candidate.identifier.cepe_code', 'candidate.identifier.national_id',
                'assignment.center_code', 'assignment.center_name', 'assignment.room_code', 'assignment.seat_number', 'assignment.table_number',
                'result.code', 'result.average', 'result.rank', 'result.mention', 'result.total_points',
                'paper.score',
                'stat.group', 'stat.registered', 'stat.present', 'stat.admitted', 'stat.failed', 'stat.absent', 'stat.excluded', 'stat.deferred', 'stat.rate',
                'constant')
           OR (c ->> 'source' LIKE 'paper.%' AND coalesce(c ->> 'paper', '') = '')
           OR coalesce(c ->> 'transform', 'none') NOT IN ('none', 'upper', 'lower', 'date_iso', 'date_dmy', 'sex_fm', 'decimal_comma', 'pad_left_8'))
$$;

-- Garde des résultats : correction par révision d'un résultat PUBLISHED, y compris session PUBLISHED.
CREATE OR REPLACE FUNCTION examinations.candidate_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s examinations.sessions%ROWTYPE;
  v_c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_c.registration_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit un résultat' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED')
     AND NOT (TG_OP = 'UPDATE' AND v_s.status = 'PUBLISHED' AND OLD.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'examinations.results_closed: la saisie des résultats exige une session en cours ou à résultats saisis (session %)', v_s.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'OFFICIAL' AND NEW.source = 'COMPUTED' THEN
    RAISE EXCEPTION 'examinations.official_not_computed: l''admission officielle est prononcée par l''autorité (import ou saisie), jamais calculée ici' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'MOCK' AND NEW.source = 'IMPORTED' THEN
    RAISE EXCEPTION 'examinations.mock_not_imported: les résultats d''un examen blanc sont calculés, jamais importés' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id THEN
      RAISE EXCEPTION 'examinations.result_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
      -- un résultat publié ne bouge que par une révision de la même transaction
      IF NEW.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.result_published: un résultat publié ne se dépublie pas (réviser)' USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.result_code <> OLD.result_code OR NEW.average IS DISTINCT FROM OLD.average OR NEW.rank IS DISTINCT FROM OLD.rank
         OR NEW.mention_code IS DISTINCT FROM OLD.mention_code OR NEW.total_points IS DISTINCT FROM OLD.total_points THEN
        IF NOT EXISTS (SELECT 1 FROM examinations.result_revisions r
                        WHERE r.tenant_id = OLD.tenant_id AND r.result_id = OLD.id AND r.xid = txid_current()
                          AND r.from_code = OLD.result_code AND r.to_code = NEW.result_code
                          AND r.from_average IS NOT DISTINCT FROM OLD.average AND r.to_average IS NOT DISTINCT FROM NEW.average) THEN
          RAISE EXCEPTION 'examinations.result_revision_required: un résultat publié ne se corrige que par une révision approuvée' USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  ELSE
    IF NEW.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'examinations.result_initial_state: un résultat naît DRAFT (publication = étape distincte)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
```

<!-- migration: 2004_examinations_import_formats.sql -->
```sql
-- =============================================================================
-- 2004 — Module examinations : formats d'import (fichiers d'échange avec l'autorité), en DONNÉES
-- =============================================================================
--
-- Pendant des formats d'export (2000) : un fichier de numéros officiels, de notes ou de résultats fourni par l'autorité a
-- une structure inconnue aujourd'hui (open-questions Q-E10) et qui changera. Le format est une LIGNE DE DONNÉES — colonnes
-- du fichier, champ cible pris dans une liste blanche, table de correspondance des codes —, versionnée, figée une fois
-- publiée. Aucune expression libre : un fichier ne peut alimenter que les cibles listées ici.
--
-- Une ligne d'import ne porte jamais de nom ni d'adresse (2002) : la clé d'un candidat est son numéro (interne ou officiel)
-- ou un identifiant de la nature désignée par le format.
-- =============================================================================

CREATE FUNCTION examinations.valid_import_columns(p_kind text, p_columns jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  WITH cols AS (SELECT CASE WHEN jsonb_typeof(p_columns) = 'array' THEN p_columns ELSE '[]'::jsonb END AS j)
  SELECT jsonb_typeof(p_columns) = 'array'
     AND jsonb_array_length((SELECT j FROM cols)) BETWEEN 2 AND 60
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements((SELECT j FROM cols)) c
        WHERE jsonb_typeof(c) <> 'object'
           OR coalesce(c ->> 'header', '') = ''
           OR length(c ->> 'header') > 80
           OR coalesce(c ->> 'target', '') NOT IN (
                'key.candidate_number', 'key.official_number', 'key.cepe_code', 'key.national_id',
                'identifier.official_number', 'result.code', 'result.average', 'result.rank', 'result.mention', 'result.total_points',
                'paper.score', 'paper.status')
           OR (c ->> 'target' LIKE 'paper.%' AND coalesce(c ->> 'paper', '') = ''))
     -- exactement une colonne clé
     AND (SELECT count(*) FROM jsonb_array_elements((SELECT j FROM cols)) c WHERE c ->> 'target' LIKE 'key.%') = 1
     -- la nature du fichier exige sa colonne utile
     AND CASE p_kind
           WHEN 'RESULTS' THEN EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT j FROM cols)) c WHERE c ->> 'target' = 'result.code')
           WHEN 'SCORES' THEN EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT j FROM cols)) c WHERE c ->> 'target' = 'paper.score')
           WHEN 'OFFICIAL_NUMBERS' THEN EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT j FROM cols)) c WHERE c ->> 'target' = 'identifier.official_number')
           ELSE false END
$$;

-- Table de correspondance : { "result.code": { "ADMIS": "ADMITTED", ... }, "paper.status": { "ABS": "ABSENT", ... } }
CREATE FUNCTION examinations.valid_import_value_map(p_map jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT CASE WHEN jsonb_typeof(p_map) = 'object' THEN p_map ELSE '{}'::jsonb END AS j)
  SELECT jsonb_typeof(p_map) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_each((SELECT j FROM m)) e WHERE e.key NOT IN ('result.code', 'paper.status') OR jsonb_typeof(e.value) <> 'object')
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each((SELECT j FROM m)) e,
              jsonb_each_text(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value ELSE '{}'::jsonb END) x
        WHERE (e.key = 'result.code' AND x.value NOT IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED'))
           OR (e.key = 'paper.status' AND x.value NOT IN ('ENTERED', 'ABSENT', 'EXCUSED', 'MALPRACTICE')))
$$;

CREATE TABLE examinations.import_formats (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  exam_type_id      uuid,
  kind              text NOT NULL CHECK (kind IN ('OFFICIAL_NUMBERS', 'SCORES', 'RESULTS')),
  encoding          text NOT NULL DEFAULT 'UTF-8' CHECK (encoding IN ('UTF-8', 'ISO-8859-1', 'WINDOWS-1252')),
  delimiter         text NOT NULL DEFAULT ';' CHECK (delimiter IN (',', ';', E'\t', '|')),
  decimal_separator text NOT NULL DEFAULT '.' CHECK (decimal_separator IN ('.', ',')),
  has_header        boolean NOT NULL DEFAULT true,
  columns           jsonb NOT NULL,
  value_map         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (examinations.valid_import_value_map(value_map)),
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  source_kind       text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference  text,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, version),
  CHECK (examinations.valid_import_columns(kind, columns)),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.import_formats');
CREATE UNIQUE INDEX import_formats_one_published ON examinations.import_formats (tenant_id, code) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE ON examinations.import_formats TO app_user;

-- Un format publié est figé (une correction = nouvelle version) ; DRAFT -> PUBLISHED -> RETIRED.
CREATE FUNCTION examinations.import_formats_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'examinations.format_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.columns IS DISTINCT FROM OLD.columns OR NEW.value_map IS DISTINCT FROM OLD.value_map
        OR NEW.encoding <> OLD.encoding OR NEW.delimiter <> OLD.delimiter OR NEW.decimal_separator <> OLD.decimal_separator
        OR NEW.has_header <> OLD.has_header OR NEW.kind <> OLD.kind OR NEW.label <> OLD.label
        OR NEW.exam_type_id IS DISTINCT FROM OLD.exam_type_id OR NEW.source_kind <> OLD.source_kind) THEN
    RAISE EXCEPTION 'examinations.format_published_immutable: un format publié ne se modifie pas (créer une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
    RAISE EXCEPTION 'examinations.format_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER import_formats_guard BEFORE UPDATE ON examinations.import_formats
  FOR EACH ROW EXECUTE FUNCTION examinations.import_formats_guard();
```

### 5.5 Candidat libre (ajout 2005, décision métier Q-E15)

Ajout au DDL de référence : le **candidat libre** (non élève de l'établissement) est inscrit à une session officielle **sans dossier élève**. `candidates.student_id` devient nullable (`candidate_kind` = `STUDENT` | `EXTERNAL`, contrainte de forme), l'identité est posée dès la création et figée à l'inscription, le numéro interne vient du **même compteur sans trou** que les élèves, les données personnelles restreintes (contact, pièce d'identité, tuteur) vivent dans `external_candidate_profiles` (lecture par permission dédiée), une pièce peut être « vue sur place », et `anonymize_external_candidate` efface le profil et dégrade l'identité (irréversible).

<!-- migration: 2005_examinations_external_candidates.sql -->
```sql
-- =============================================================================
-- 2005 — Module examinations : CANDIDAT LIBRE (décision métier Q-E15)
-- =============================================================================
--
-- Un candidat libre est inscrit à une session SANS dossier élève de l'établissement (`people`) : identité saisie ou importée.
-- Additif : aucune migration existante n'est modifiée ; les candidats-élèves gardent exactement leur comportement.
--
--   * `candidates.student_id` devient NULLABLE ; `candidate_kind` ('STUDENT' | 'EXTERNAL') dit de quel régime relève la ligne
--     (CHECK : élève <=> `student_id` renseigné). L'identité (nom, prénoms, naissance, sexe) est posée dès la création d'un libre
--     et figée à l'inscription comme pour un élève ; le numéro interne (`CEPE2027-00001`) vient du MÊME compteur sans trou
--     par session ; le numéro officiel importé reste un `candidate_identifiers`.
--   * MINIMISATION : les coordonnées, la pièce d'identité et le tuteur vivent dans `external_candidate_profiles`, table à part,
--     lue par une permission dédiée ; l'ANONYMISATION (`anonymize_external_candidate`) efface ces données et dégrade l'identité
--     (nom neutre, année de naissance seule) en conservant numéro, résultat et historique.
--   * ÉLIGIBILITÉ : les faits d'un libre (classe d'examen déclarée, tentatives déclarées) sont SAISIS ; la règle ne change pas.
--   * PIÈCES : un libre n'a pas de GED d'élève ; une pièce peut être « vue sur place » (`presentation_kind = 'SIGHTED'`).
--   * Un libre n'existe que dans une session OFFICIELLE (un examen blanc s'appuie sur des notes d'élèves d'`assess`).
-- =============================================================================

ALTER TABLE examinations.candidates ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE examinations.candidates ADD COLUMN candidate_kind text NOT NULL DEFAULT 'STUDENT' CHECK (candidate_kind IN ('STUDENT', 'EXTERNAL'));
ALTER TABLE examinations.candidates ADD COLUMN anonymized_at timestamptz;
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_kind_student CHECK ((candidate_kind = 'STUDENT') = (student_id IS NOT NULL));
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_external_identity CHECK (
  candidate_kind <> 'EXTERNAL' OR (last_name IS NOT NULL AND first_name IS NOT NULL AND birth_date IS NOT NULL AND sex IS NOT NULL AND enrollment_id IS NULL));
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_anonymized_external CHECK (anonymized_at IS NULL OR candidate_kind = 'EXTERNAL');

-- Un libre vivant ne peut pas être saisi deux fois (même nom, mêmes prénoms, même naissance) dans une session.
CREATE UNIQUE INDEX candidates_one_live_external
  ON examinations.candidates (tenant_id, session_id, lower(btrim(last_name)), lower(btrim(first_name)), birth_date)
  WHERE candidate_kind = 'EXTERNAL' AND registration_status <> 'WITHDRAWN' AND anonymized_at IS NULL;

-- -----------------------------------------------------------------------------
-- Profil du candidat libre : données personnelles RESTREINTES (lecture par permission dédiée, audit des lectures)
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.external_candidate_profiles (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id              uuid NOT NULL,
  candidate_id            uuid NOT NULL,
  contact_phone           text CHECK (contact_phone IS NULL OR length(btrim(contact_phone)) BETWEEN 4 AND 40),
  contact_email           text CHECK (contact_email IS NULL OR (length(btrim(contact_email)) BETWEEN 3 AND 200 AND contact_email LIKE '%@%')),
  address_line            text CHECK (address_line IS NULL OR length(btrim(address_line)) BETWEEN 1 AND 300),
  id_piece_kind           text CHECK (id_piece_kind IS NULL OR id_piece_kind ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  id_piece_number         text CHECK (id_piece_number IS NULL OR length(btrim(id_piece_number)) BETWEEN 1 AND 60),
  guardian_name           text CHECK (guardian_name IS NULL OR length(btrim(guardian_name)) BETWEEN 1 AND 200),
  guardian_relation       text CHECK (guardian_relation IS NULL OR length(btrim(guardian_relation)) BETWEEN 1 AND 60),
  guardian_phone          text CHECK (guardian_phone IS NULL OR length(btrim(guardian_phone)) BETWEEN 4 AND 40),
  guardian_email          text CHECK (guardian_email IS NULL OR (length(btrim(guardian_email)) BETWEEN 3 AND 200 AND guardian_email LIKE '%@%')),
  -- faits d'éligibilité FOURNIS PAR SAISIE (pas de dossier scolaire) : la règle les consomme telles quelles
  declared_in_exam_grade  boolean NOT NULL,
  declared_prior_attempts integer NOT NULL DEFAULT 0 CHECK (declared_prior_attempts BETWEEN 0 AND 50),
  data_source             text NOT NULL DEFAULT 'ENTERED' CHECK (data_source IN ('ENTERED', 'IMPORTED')),
  entered_by              uuid,
  anonymized_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  CHECK ((id_piece_kind IS NULL) = (id_piece_number IS NULL)),
  -- joignable : au moins un moyen de contact (sauf après anonymisation)
  CHECK (anonymized_at IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL OR guardian_phone IS NOT NULL OR guardian_email IS NOT NULL),
  CHECK (anonymized_at IS NULL OR (contact_phone IS NULL AND contact_email IS NULL AND address_line IS NULL AND id_piece_kind IS NULL AND id_piece_number IS NULL
                                   AND guardian_name IS NULL AND guardian_relation IS NULL AND guardian_phone IS NULL AND guardian_email IS NULL)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.external_candidate_profiles');
-- Une même pièce d'identité ne désigne qu'un seul candidat libre par session.
CREATE UNIQUE INDEX external_candidate_profiles_piece
  ON examinations.external_candidate_profiles (tenant_id, session_id, id_piece_kind, id_piece_number) WHERE id_piece_number IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON examinations.external_candidate_profiles TO app_user;

CREATE FUNCTION examinations.external_profiles_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT candidate_kind INTO v_kind FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
    IF v_kind IS DISTINCT FROM 'EXTERNAL' THEN
      RAISE EXCEPTION 'examinations.external_only: un profil de candidat libre ne se rattache qu''à un candidat libre' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: le rattachement du profil est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: un profil anonymisé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER external_profiles_guard BEFORE INSERT OR UPDATE ON examinations.external_candidate_profiles
  FOR EACH ROW EXECUTE FUNCTION examinations.external_profiles_guard();

-- -----------------------------------------------------------------------------
-- Pièces : « vue sur place » pour un candidat libre (aucun document de la GED d'un élève)
-- -----------------------------------------------------------------------------
ALTER TABLE examinations.candidate_documents ADD COLUMN presentation_kind text NOT NULL DEFAULT 'DOCUMENT' CHECK (presentation_kind IN ('DOCUMENT', 'SIGHTED'));
ALTER TABLE examinations.candidate_documents ADD COLUMN sighted_note text CHECK (sighted_note IS NULL OR length(btrim(sighted_note)) BETWEEN 1 AND 300);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'examinations.candidate_documents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%storage_key IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE examinations.candidate_documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;
ALTER TABLE examinations.candidate_documents ADD CONSTRAINT candidate_documents_has_proof
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL OR presentation_kind = 'SIGHTED');
ALTER TABLE examinations.candidate_documents ADD CONSTRAINT candidate_documents_sighted_shape
  CHECK (presentation_kind = 'DOCUMENT' OR (status <> 'MISSING' AND document_ref IS NULL AND storage_key IS NULL));

-- -----------------------------------------------------------------------------
-- Garde du candidat : version 2 (CREATE OR REPLACE ; le déclencheur existant la rappelle)
--   * `student_id` peut être NULL (comparaisons IS DISTINCT FROM) ; le régime d'un candidat ne change jamais ;
--   * un libre n'existe que dans une session OFFICIELLE ;
--   * l'ANONYMISATION (anonymized_at NULL -> renseigné, libre seulement) est la seule modification de l'identité figée permise,
--     y compris pour un candidat retiré ; ensuite l'identité ne change plus.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION examinations.candidates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s     examinations.sessions%ROWTYPE;
  v_type  examinations.exam_types%ROWTYPE;
  v_miss  text[];
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  IF NEW.institution_id <> v_s.institution_id THEN
    RAISE EXCEPTION 'examinations.candidate_institution: le candidat doit appartenir à l''établissement de la session' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_s.status NOT IN ('PLANNED', 'REGISTRATION_OPEN') THEN
      RAISE EXCEPTION 'examinations.session_registration_closed: la session est % ; plus de nouveau candidat', v_s.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.registration_status <> 'DRAFT' OR NEW.candidate_number IS NOT NULL OR NEW.outcome <> 'PENDING' OR NEW.anonymized_at IS NOT NULL THEN
      RAISE EXCEPTION 'examinations.candidate_initial_state: un candidat naît DRAFT, sans numéro ni résultat' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.candidate_kind = 'EXTERNAL' AND v_s.session_kind <> 'OFFICIAL' THEN
      RAISE EXCEPTION 'examinations.external_official_only: un candidat libre n''existe que dans une session officielle' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.session_id <> OLD.session_id OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.institution_id <> OLD.institution_id
     OR NEW.candidate_kind <> OLD.candidate_kind THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: session, élève et établissement sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.candidate_number IS NOT NULL AND (NEW.candidate_number IS DISTINCT FROM OLD.candidate_number OR NEW.candidate_seq IS DISTINCT FROM OLD.candidate_seq) THEN
    RAISE EXCEPTION 'examinations.candidate_number_immutable: le numéro de candidat ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Anonymisation : seule opération autorisée sur l'identité d'un candidat libre déjà inscrit ou retiré.
  IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
    IF OLD.candidate_kind <> 'EXTERNAL' THEN
      RAISE EXCEPTION 'examinations.external_only: seul un candidat libre s''anonymise ici' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.registration_status <> OLD.registration_status OR NEW.outcome <> OLD.outcome OR NEW.eligibility_status <> OLD.eligibility_status THEN
      RAISE EXCEPTION 'examinations.candidate_anonymized: l''anonymisation ne change ni statut, ni issue, ni éligibilité' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.anonymized_at IS NOT NULL AND (NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at OR NEW.last_name IS DISTINCT FROM OLD.last_name
       OR NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.birth_date IS DISTINCT FROM OLD.birth_date OR NEW.birth_place IS DISTINCT FROM OLD.birth_place
       OR NEW.sex IS DISTINCT FROM OLD.sex) THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: un candidat anonymisé ne change plus d''identité' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.outcome <> OLD.outcome AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.outcome_derived: l''issue d''un candidat est dérivée de son résultat (saisir le résultat)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.eligibility_status <> OLD.eligibility_status AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.eligibility_derived: le statut d''éligibilité est dérivé du journal des évaluations' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.registration_status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'examinations.candidate_withdrawn: un candidat retiré ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  -- après inscription, l'identité figée ne change plus
  IF OLD.registration_status = 'REGISTERED' AND (NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.birth_date IS DISTINCT FROM OLD.birth_date OR NEW.sex IS DISTINCT FROM OLD.sex OR NEW.birth_place IS DISTINCT FROM OLD.birth_place
       OR NEW.track_code IS DISTINCT FROM OLD.track_code) THEN
    RAISE EXCEPTION 'examinations.candidate_snapshot_frozen: l''identité et la série d''un candidat inscrit sont figées' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.registration_status <> OLD.registration_status THEN
    IF NOT (
      (OLD.registration_status = 'DRAFT'          AND NEW.registration_status IN ('PRE_REGISTERED', 'REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'PRE_REGISTERED' AND NEW.registration_status IN ('REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'REGISTERED'     AND NEW.registration_status = 'WITHDRAWN')) THEN
      RAISE EXCEPTION 'examinations.candidate_transition: % -> % interdit', OLD.registration_status, NEW.registration_status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.registration_status = 'REGISTERED' THEN
      IF v_s.status <> 'REGISTRATION_OPEN' THEN
        RAISE EXCEPTION 'examinations.session_registration_closed: les inscriptions ne sont pas ouvertes (session %)', v_s.status USING ERRCODE = 'check_violation';
      END IF;
      SELECT * INTO v_type FROM examinations.exam_types t WHERE t.tenant_id = v_s.tenant_id AND t.id = v_s.exam_type_id;
      IF v_s.session_kind = 'OFFICIAL' THEN
        IF NEW.eligibility_status <> 'ELIGIBLE' THEN
          RAISE EXCEPTION 'examinations.not_eligible: l''éligibilité doit être établie avant l''inscription (statut %)', NEW.eligibility_status USING ERRCODE = 'check_violation';
        END IF;
        v_miss := examinations.missing_required_documents(NEW.id);
        IF cardinality(v_miss) > 0 THEN
          RAISE EXCEPTION 'examinations.documents_incomplete: pièces non acceptées : %', array_to_string(v_miss, ', ') USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.candidate_seq IS NULL THEN
        NEW.candidate_seq := examinations.next_number('cand:' || NEW.session_id::text);
        NEW.candidate_number := examinations.format_number(v_type.candidate_number_pattern, v_type.code, v_s.session_year, NEW.candidate_seq);
      END IF;
      NEW.registered_at := coalesce(NEW.registered_at, now());
      NEW.snapshot_taken_at := coalesce(NEW.snapshot_taken_at, now());
    END IF;
    IF NEW.registration_status = 'WITHDRAWN' THEN
      IF v_s.status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
        RAISE EXCEPTION 'examinations.withdraw_after_results: retrait impossible une fois les résultats saisis' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.withdrawn_at := coalesce(NEW.withdrawn_at, now());
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- -----------------------------------------------------------------------------
-- Anonymisation d'un candidat libre (droit à l'effacement) : irréversible, motif obligatoire.
-- Efface profil et identifiants personnels ; l'identité devient neutre (année de naissance seule) ; numéro, résultat, historique restent.
-- -----------------------------------------------------------------------------
CREATE FUNCTION examinations.anonymize_external_candidate(p_candidate uuid, p_reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = kernel.current_tenant_id() AND c.id = p_candidate FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'examinations.candidate_not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_c.candidate_kind <> 'EXTERNAL' THEN
    RAISE EXCEPTION 'examinations.external_only: seul un candidat libre s''anonymise ici' USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: ce candidat est déjà anonymisé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'examinations.invalid_input: le motif d''une anonymisation compte au moins 10 caractères' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE examinations.external_candidate_profiles
     SET contact_phone = NULL, contact_email = NULL, address_line = NULL, id_piece_kind = NULL, id_piece_number = NULL,
         guardian_name = NULL, guardian_relation = NULL, guardian_phone = NULL, guardian_email = NULL, anonymized_at = now()
   WHERE tenant_id = v_c.tenant_id AND candidate_id = v_c.id;
  -- le numéro officiel (attribué par l'autorité) reste ; tout autre identifiant (pièce nationale, code) est rendu neutre
  UPDATE examinations.candidate_identifiers
     SET value = 'ANONYME-' || left(id::text, 8)
   WHERE tenant_id = v_c.tenant_id AND candidate_id = v_c.id AND kind <> 'OFFICIAL_NUMBER';
  UPDATE examinations.candidates
     SET last_name = 'ANONYME', first_name = 'ANONYME', birth_place = NULL,
         birth_date = make_date(extract(year FROM birth_date)::int, 1, 1), anonymized_at = now()
   WHERE tenant_id = v_c.tenant_id AND id = v_c.id;
  INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, reason, actor_id)
    VALUES (gen_random_uuid(), v_c.tenant_id, v_c.id, 'NOTE', 'Anonymisation : ' || btrim(p_reason), kernel.current_user_id());
END
$$;
GRANT EXECUTE ON FUNCTION examinations.anonymize_external_candidate(uuid, text) TO app_user;
```

### 5.6 Frais d'examen intégrés à l'inscription (ajout 2006, décision métier Q-E13)

Ajout au DDL de référence : les frais d'examen sont **intégrés à l'inscription** du candidat (élève ou libre). `exam_fee_items` est le **barème** de l'établissement (par type d'examen : les frais du catalogue de `finance`, catégorie EXAMS, qui s'appliquent) — **vide par défaut, sans aucun montant** ; `candidate_fees` suit l'**obligation** de chaque candidat (une ligne créée dans la transaction d'inscription : à facturer, facturée, à établir à la main pour un libre sans compte famille, annulée, remboursement dû puis confirmé). La facture est demandée à `finance` par un **port** (jamais de SQL croisé) ; le statut de paiement est relu en direct, jamais copié.

<!-- migration: 2006_examinations_exam_fees.sql -->
```sql
-- =============================================================================
-- 2006 — Module examinations : FRAIS D'EXAMEN intégrés à l'inscription du candidat (décision métier Q-E13)
-- =============================================================================
--
-- Les frais d'examen sont perçus par l'établissement et INTÉGRÉS à l'inscription du candidat (élève ou libre) : à l'inscription, une
-- facture est demandée à `finance` par le PORT d'examinations (adaptateur de plateforme, jamais de SQL croisé).
--
--   * `exam_fee_items` : le BARÈME de frais d'examen défini par l'établissement = pour un type d'examen, la liste des frais du catalogue
--     de `finance` (catégorie EXAMS) qui s'appliquent (élèves, libres ou tous). VIDE PAR DÉFAUT : aucun montant n'est inventé, les
--     montants restent ceux du catalogue et des barèmes de `finance` ; ce module ne stocke aucun tarif.
--   * `candidate_fees` : l'obligation d'UN candidat (une ligne par candidat, créée dans la transaction d'inscription) : état de la
--     facturation, identifiant de la facture, instantané des lignes et du total à la facturation (affichage et audit), remboursement.
--     Le statut de PAIEMENT n'est pas stocké : il est relu en direct auprès de `finance` (jamais de copie qui se désynchronise).
--
--   Cycle d'une obligation :
--     NOT_APPLICABLE            aucun frais au barème pour ce type (état final)
--     PENDING_INVOICE           frais dus, facture pas encore établie (port indisponible, erreur : rejouable, idempotent)
--     INVOICED                  facture établie dans `finance`
--     AWAITING_MANUAL_INVOICE   payeur sans compte famille (candidat libre) : la facture à son nom / à celui du tuteur est à établir
--                               par la comptabilité (finance ne facture que des apprenants)
--     CANCELLED                 désinscription avant tout paiement : facture annulée (ou jamais établie)
--     REFUND_DUE                désinscription d'un candidat qui a PAYÉ : remboursement MANUEL à effectuer dans `finance` (Q-PAY-32)
--     REFUND_DONE               remboursement confirmé par une personne habilitée
-- =============================================================================

CREATE TABLE examinations.exam_fee_items (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id  uuid NOT NULL,
  fee_id        uuid NOT NULL,                                   -- finance.fees.id (sans FK : module distinct)
  applies_to    text NOT NULL DEFAULT 'ALL' CHECK (applies_to IN ('ALL', 'STUDENT', 'EXTERNAL')),
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_type_id, fee_id),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.exam_fee_items');
GRANT SELECT, INSERT, UPDATE ON examinations.exam_fee_items TO app_user;     -- jamais de suppression : un frais se désactive

CREATE TABLE examinations.candidate_fees (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id           uuid NOT NULL,
  candidate_id         uuid NOT NULL,
  status               text NOT NULL DEFAULT 'PENDING_INVOICE' CHECK (status IN
                         ('NOT_APPLICABLE', 'PENDING_INVOICE', 'INVOICED', 'AWAITING_MANUAL_INVOICE', 'CANCELLED', 'REFUND_DUE', 'REFUND_DONE')),
  payer_kind           text NOT NULL CHECK (payer_kind IN ('STUDENT', 'EXTERNAL')),
  currency             text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  total_minor          bigint CHECK (total_minor IS NULL OR total_minor >= 0),
  -- frais retenus au barème à l'inscription ; libellés et montants complétés à la facturation (instantané)
  lines                jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  invoice_id           uuid,                                     -- finance.invoices.id (sans FK)
  idempotency_key      text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  last_error_code      text,
  note                 text,
  refund_confirmed_by  uuid,
  refund_confirmed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (status NOT IN ('INVOICED', 'REFUND_DUE', 'REFUND_DONE') OR invoice_id IS NOT NULL),
  CHECK ((status = 'REFUND_DONE') = (refund_confirmed_by IS NOT NULL AND refund_confirmed_at IS NOT NULL)),
  CHECK (status <> 'NOT_APPLICABLE' OR (invoice_id IS NULL AND jsonb_array_length(lines) = 0)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_fees');
CREATE INDEX candidate_fees_by_session ON examinations.candidate_fees (tenant_id, session_id, status);
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_fees TO app_user;      -- jamais de suppression : l'historique d'une obligation reste

-- Identité de l'obligation figée ; transitions du cycle ; une obligation soldée ne se réouvre pas.
CREATE FUNCTION examinations.candidate_fees_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('NOT_APPLICABLE', 'PENDING_INVOICE') THEN
      RAISE EXCEPTION 'examinations.fee_initial_state: une obligation naît sans facture (NOT_APPLICABLE ou PENDING_INVOICE)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id OR NEW.payer_kind <> OLD.payer_kind OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'examinations.fee_identity_immutable: candidat, session, payeur et clé d''idempotence sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'examinations.fee_invoice_immutable: la facture d''une obligation ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_INVOICE'          AND NEW.status IN ('INVOICED', 'AWAITING_MANUAL_INVOICE', 'CANCELLED')) OR
       (OLD.status = 'AWAITING_MANUAL_INVOICE'  AND NEW.status = 'CANCELLED') OR
       (OLD.status = 'INVOICED'                 AND NEW.status IN ('CANCELLED', 'REFUND_DUE')) OR
       (OLD.status = 'REFUND_DUE'               AND NEW.status = 'REFUND_DONE')) THEN
    RAISE EXCEPTION 'examinations.fee_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('NOT_APPLICABLE', 'CANCELLED', 'REFUND_DONE') AND (NEW.lines IS DISTINCT FROM OLD.lines OR NEW.total_minor IS DISTINCT FROM OLD.total_minor) THEN
    RAISE EXCEPTION 'examinations.fee_closed: une obligation close ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER candidate_fees_guard BEFORE INSERT OR UPDATE ON examinations.candidate_fees
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_fees_guard();
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Code de type unique par tenant ; origine citée si réglementaire ; motif de numéro avec compteur | `UNIQUE`, `CHECK` | `createExamType` |
| Une épreuve ne vise qu'une série du même type ; coefficient et barème > 0 ; unicité (NULL = commune) | FK composite, index unique sur `coalesce(track_code,'')` | — |
| Définition de session copiée puis figée ; jamais sans épreuve ; non modifiable ensuite | `instantiate_session_definition`, `session_definition_guard`, `sessions_guard` | `prepareSession` |
| Cycle de session et conditions (définition figée avant ouverture ; résultats complets avant publication) | `sessions_guard` | `transitionSession` |
| Un candidat vivant par élève et par session ; établissement de la session ; série de la session | index unique partiel, `candidates_guard`, FK composite | `createCandidate` |
| Inscription : session ouverte, éligibilité `ELIGIBLE`, pièces obligatoires acceptées (officielle), identité figée | `candidates_guard`, `missing_required_documents` | messages listant les manques |
| Éligibilité dérivée du journal ; dérogation motivée | `eligibility_checks` (`CHECK`, append-only), `eligibility_checks_apply`, `pg_trigger_depth()` | `evaluateEligibility`, `overrideEligibility` |
| Numéro de candidat sans trou, immuable, jamais réattribué, unique par session | `next_number`, `format_number`, `candidates_guard`, `UNIQUE` | — |
| Identifiant officiel unique par session et nature ; un par candidat et nature | `UNIQUE` | `setCandidateIdentifier` |
| Place : candidat inscrit, salle active, numéro ≤ capacité, unique ; répartition figée en cours de session | FK composites, `seat_assignments_guard`, `UNIQUE` | répartition automatique |
| Note : candidat inscrit, session en cours, ≤ barème, série concordante ; correction après résultats = révision | `paper_scores_guard`, `score_revisions` | saisie en lot idempotente |
| Résultat : source cohérente avec la nature de session ; naît `DRAFT` ; publié = immuable sauf révision ; issue dérivée | `candidate_results_guard`, `candidate_results_apply`, `result_revisions` | `publishResults` (sensible) |
| Lot d'import : un fichier une fois ; appliqué = sans erreur et immuable ; lignes en ajout seul | `UNIQUE (session, kind, sha256)`, `import_batches_guard`, `import_rows_append_only` | `applyImport` (sensible) |
| Liens `assess` : examens blancs seulement, figés après résultats | `paper_assessment_links_guard` | — |
| Export : format publié ; version copiée ; terminé = immuable ; format publié figé | `export_runs_guard`, `export_formats_guard`, `valid_export_columns` | `runExport` |
| Documents : un vivant par candidat et nature ; attestation = ADMIS publié ; convocation = place ; émis = immuable | `issued_documents_guard`, index partiel | `issueDocument` |
| Historique complet et en ajout seul | `candidates_log`, `candidate_history_append_only` | — |
| Isolation tenant | RLS forcée, FK composites | test d'isolation générique (A/B) |

## 7. Tests de comportement livrés (`ddl/tests`)

| Fichier | Tests | Couvre |
|---|---|---|
| `10_reference.sql` | 38 | types (unicité, origine, motif), séries et épreuves (NULL traité comme valeur, FK composites), motif de numéro (jamais tronqué), compteurs, **liste blanche d'export** (champ, transformation, épreuve), publication et immuabilité des formats, centres, salles, RLS et `GRANT` |
| `20_sessions_candidates.sql` | 61 | définition de session (copie des épreuves actives, gel, inaltérable), cycle de vie, examen blanc, candidats (éligibilité dérivée et dérogation, pièces, inscription, numéro immuable, **numéro non réattribué**, annulation sans consommation), identifiants, répartition (centre de la session, salle du centre, capacité, unicités, gel), clôture des inscriptions, RLS |
| `30_results_exports.sql` | 67 | notes (barème, absences, lot cité), imports (empreinte unique, lots en erreur, lignes en ajout seul), résultats officiels (jamais calculés), examens blancs (calculés et tracés, jamais importés), publication complète, **révisions** (même transaction, approbateur ≠ demandeur), documents (attestation = ADMIS publié, convocation = place, révocation), exports (format publié), statistiques (par sexe, global, liste blanche), liens `assess`, **concurrence réelle** (20 numéros), RLS |
| `40_corrections_imports.sql` | 29 | demandes de révision (une en attente par cible, séparation des tâches, identité immuable, refus motivé), correction d'un résultat publié **session PUBLISHED**, plus aucune écriture session ARCHIVED, formats d'import (liste blanche, clé unique, colonne utile par nature, table de correspondance, publication figée), RLS |

| `50_external_candidates.sql` | 35 | candidat libre (Q-E15) : régime `STUDENT`/`EXTERNAL` (forme, identité dès la création, un libre vivant par identité, jamais en examen blanc), profil restreint (contact exigé, pièce d'identité unique par session, un profil par candidat), pièce vue sur place, **numéro du même compteur sans trou**, identité figée à l'inscription, **anonymisation** (identité neutre, profil effacé, numéro et résultat conservés, irréversible, tracée), RLS |
| `60_exam_fees.sql` | 28 | frais d'examen (Q-E13) : barème **vide par défaut et sans montant**, unicité d'un frais par type, portée `ALL`/`STUDENT`/`EXTERNAL`, obligation par candidat (naît sans facture), cycle (facturé, remboursement dû puis confirmé par une personne identifiée, annulé), facture et payeur immuables, obligation close figée, RLS, jamais de suppression |

Exécution : `node specs/v2/018-examinations/ddl/run.mjs` (Docker requis, conteneur éphémère supprimé, `ED_PG_IMAGE=postgres:17-alpine`). `ED_ONLY=<motif>` limite les fichiers de test ; `ED_VERBOSE=1` détaille les erreurs. Contrôle documentaire : `--check-doc`.

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Sessions d'un type et d'une année | `WHERE exam_type_id = $1 AND session_year = $2` | `sessions_by_type_year` |
| Candidats d'une session par statut | `WHERE session_id = $1 AND registration_status = $2` | `candidates_by_session` |
| Candidats d'un élève (tentatives) | `WHERE student_id = $1` | `candidates_by_student` |
| Dernière évaluation d'éligibilité | `WHERE candidate_id = $1 ORDER BY evaluated_at DESC` | `eligibility_checks_by_candidate` |
| Historique d'un candidat | `WHERE candidate_id = $1 ORDER BY occurred_at` | `candidate_history_by_candidate` |
| Notes d'une épreuve | `WHERE session_id = $1 AND paper_id = $2` | `paper_scores_by_session` |
| Résultats d'une session par issue | `WHERE session_id = $1 GROUP BY result_code` | `candidate_results_by_session` |
| Statistiques | `result_counts(session, groupe)` | `candidates_by_session` |

## 9. Projections et lectures croisées

Aucune lecture inter-schémas : le module appelle les **ports** `EligibilityFacts` (academic + people), `RulesPort`, `AssessPort`, `OfficialDocumentPort` (reportcards), `DocumentStore`, `StoragePort`. L'**admission en 6e** (006/007) consomme `examinations.result.published` — jamais une jointure. Aucune vue SQL ne traverse les schémas ; les indicateurs de direction (025) consomment les événements.

## 10. Rejeu de l'historique et reprise

Aucune donnée de production n'est reprise (D8) : le legacy n'a **aucun** module d'examens (`student_enrollments.cepe_code` est un champ libre par inscription ; `exam_schedules` est un emploi du temps des épreuves internes → 017). Les environnements de démonstration, de test et d'e2e sont construits par seeds déterministes (type `CEPE` fictif, une session blanche, une session officielle de 40 candidats, formats fictifs). Le `cepe_code` éventuel d'un jeu de test se charge comme `candidate_identifiers` de nature `CEPE_CODE` (`source = MIGRATION`).
