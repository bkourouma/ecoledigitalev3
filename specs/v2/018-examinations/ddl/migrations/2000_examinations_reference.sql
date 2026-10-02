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
