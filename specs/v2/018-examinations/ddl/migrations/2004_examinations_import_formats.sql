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
