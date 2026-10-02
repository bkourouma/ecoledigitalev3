-- =============================================================================
-- 1800 — Module primary_school : schéma, paramètres, échelles d'appréciation, référentiels de compétences
-- =============================================================================
--
-- Plage de numéros réservée au module primary_school : 1800–1899 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; ligne à inscrire dans ce tableau).
--
-- Pourquoi `primary_school` et non `primary` : PRIMARY est un mot réservé de SQL (`PRIMARY KEY`) ;
-- un schéma `primary` obligerait à citer l'identifiant partout. La clé de module (manifest) est la
-- même : `primary_school` (route `/api/v1/primary_school`).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma ; AUCUNE clé étrangère vers le schéma d'un autre module, sauf
--     `kernel.tenants(id)`. Établissement, année, période, classe, inscription, élève, enseignant,
--     délibération : UUID vérifiés par les API publiques de academic / people / results ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle réglementaire : ce module ne calcule ni moyenne, ni rang, ni passage. Il porte
--     des DONNÉES pédagogiques (compétences, échelles d'appréciation) et des journaux. Toute valeur
--     de ces données porte son origine (`source_kind`) ; `placeholder` = valeur fictive de démonstration.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS primary_school;
REVOKE ALL ON SCHEMA primary_school FROM PUBLIC;
GRANT USAGE ON SCHEMA primary_school TO app_user;

-- Garde commune : table en ajout seul (journaux).
CREATE FUNCTION primary_school.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'primary_school.append_only: la table % est en ajout seul (% refusé)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- -----------------------------------------------------------------------------
-- Échelles d'appréciation (ex. niveaux de maîtrise). Données de pack ou de l'établissement ; le
-- modèle de pack ne livre qu'une échelle `placeholder` tant que le référentiel officiel n'est pas fourni.
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.rating_scales (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  source_kind      text NOT NULL DEFAULT 'institution'
                   CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  -- un référentiel déclaré « réglementaire » cite son texte
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0)
);
SELECT kernel.enable_tenant_rls('primary_school.rating_scales');
GRANT SELECT, INSERT, UPDATE ON primary_school.rating_scales TO app_user;

-- `meets_expectation` : drapeau PÉDAGOGIQUE servant aux synthèses (« compétences atteintes ») ; ce n'est
-- ni un seuil de passage ni une règle : le module ne décide rien avec.
CREATE TABLE primary_school.rating_levels (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id           uuid NOT NULL,
  code               text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  label              text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal            integer NOT NULL CHECK (ordinal >= 1),
  meets_expectation  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scale_id, id),
  UNIQUE (tenant_id, scale_id, code),
  UNIQUE (tenant_id, scale_id, ordinal),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.rating_levels');
GRANT SELECT, INSERT, UPDATE ON primary_school.rating_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne). Politiques d'établissement, PAS des règles réglementaires.
--   require_homeroom_for_activation : une classe du primaire ne s'active qu'avec un titulaire (HOMEROOM)
--   council_required_for_bilan      : le bilan annuel ne se scelle qu'avec une décision du conseil des maîtres
--   archive_retention_years         : NULL = durée de conservation non déterminée (question métier)
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.settings (
  tenant_id                       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id                  uuid NOT NULL,                 -- tenancy.institutions.id (sans FK)
  require_homeroom_for_activation boolean NOT NULL DEFAULT true,
  council_required_for_bilan      boolean NOT NULL DEFAULT true,
  phrase_bank_enabled             boolean NOT NULL DEFAULT true,
  default_rating_scale_id         uuid,
  archive_retention_years         integer CHECK (archive_retention_years IS NULL OR archive_retention_years > 0),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id),
  FOREIGN KEY (tenant_id, default_rating_scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.settings');
GRANT SELECT, INSERT, UPDATE ON primary_school.settings TO app_user;

-- Versions de modèle de pack appliquées (idempotence de instantiatePrimaryReferenceData).
CREATE TABLE primary_school.template_applications (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  education_system text NOT NULL,
  template_version integer NOT NULL CHECK (template_version >= 1),
  applied_at       timestamptz NOT NULL DEFAULT now(),
  applied_by       uuid,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, education_system, template_version)
);
SELECT kernel.enable_tenant_rls('primary_school.template_applications');
GRANT SELECT, INSERT ON primary_school.template_applications TO app_user;

-- -----------------------------------------------------------------------------
-- Référentiels de compétences. Un référentiel est VERSIONNÉ : une fois publié, sa structure (domaines,
-- compétences) ne change plus ; corriger = nouvelle version (copie). Les niveaux (PS, CP1…) sont
-- désignés par leur CODE (`academic.grade_levels.code`) : pas de FK inter-schémas.
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.competency_frameworks (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  scale_id         uuid NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  source_kind      text NOT NULL DEFAULT 'institution'
                   CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference text,
  published_at     timestamptz,
  published_by     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, version),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_frameworks');
-- Une seule version publiée par code de référentiel.
CREATE UNIQUE INDEX competency_frameworks_one_published
  ON primary_school.competency_frameworks (tenant_id, code) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_frameworks TO app_user;   -- DELETE : brouillon seulement (garde)

CREATE TABLE primary_school.framework_grade_levels (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id     uuid NOT NULL,
  grade_level_code text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  PRIMARY KEY (tenant_id, framework_id, grade_level_code),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES primary_school.competency_frameworks (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.framework_grade_levels');
GRANT SELECT, INSERT, DELETE ON primary_school.framework_grade_levels TO app_user;

CREATE TABLE primary_school.competency_domains (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal      integer NOT NULL CHECK (ordinal >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  UNIQUE (tenant_id, framework_id, code),
  UNIQUE (tenant_id, framework_id, ordinal),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES primary_school.competency_frameworks (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_domains');
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_domains TO app_user;

CREATE TABLE primary_school.competencies (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id uuid NOT NULL,
  domain_id    uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  description  text,
  ordinal      integer NOT NULL CHECK (ordinal >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  UNIQUE (tenant_id, framework_id, code),
  UNIQUE (tenant_id, domain_id, ordinal),
  FOREIGN KEY (tenant_id, framework_id, domain_id)
    REFERENCES primary_school.competency_domains (tenant_id, framework_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competencies');
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competencies TO app_user;

-- Banque d'appréciations : phrases réutilisables proposées à l'instituteur (jamais appliquées seules).
CREATE TABLE primary_school.appreciation_phrases (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  scope             text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR', 'COMPETENCY')),
  body              text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 300),
  rating_level_code text,
  grade_level_code  text,
  source_kind       text NOT NULL DEFAULT 'institution'
                    CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('primary_school.appreciation_phrases');
GRANT SELECT, INSERT, UPDATE ON primary_school.appreciation_phrases TO app_user;

-- =============================================================================
-- Gardes
-- =============================================================================

-- Cycle de vie d'un référentiel : DRAFT -> PUBLISHED -> RETIRED. À la publication : au moins une
-- compétence, un niveau d'application, et une échelle d'au moins deux niveaux. Identité figée ensuite.
CREATE FUNCTION primary_school.competency_frameworks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.framework_delete_forbidden: le référentiel % v% est % ; il ne peut plus être supprimé', OLD.code, OLD.version, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.code <> OLD.code OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'primary_school.framework_identity_immutable: code et version sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND (NEW.scale_id <> OLD.scale_id OR NEW.label <> OLD.label
        OR NEW.source_kind <> OLD.source_kind OR NEW.source_reference IS DISTINCT FROM OLD.source_reference) THEN
      RAISE EXCEPTION 'primary_school.framework_published_immutable: un référentiel publié ne se modifie pas (créer une nouvelle version)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
      RAISE EXCEPTION 'primary_school.framework_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT' THEN
      SELECT count(*) INTO v_n FROM primary_school.competencies c
       WHERE c.tenant_id = NEW.tenant_id AND c.framework_id = NEW.id;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'primary_school.framework_empty: un référentiel sans compétence ne se publie pas' USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM primary_school.framework_grade_levels g
       WHERE g.tenant_id = NEW.tenant_id AND g.framework_id = NEW.id;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'primary_school.framework_no_level: indiquer au moins un niveau d''application' USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM primary_school.rating_levels l
       WHERE l.tenant_id = NEW.tenant_id AND l.scale_id = NEW.scale_id;
      IF v_n < 2 THEN
        RAISE EXCEPTION 'primary_school.scale_too_small: l''échelle doit compter au moins deux niveaux' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER competency_frameworks_guard BEFORE UPDATE OR DELETE ON primary_school.competency_frameworks
  FOR EACH ROW EXECUTE FUNCTION primary_school.competency_frameworks_guard();

-- Structure d'un référentiel (domaines, compétences, niveaux d'application) : brouillon seulement.
CREATE FUNCTION primary_school.framework_structure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_tenant uuid;
  v_fw     uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id; v_fw := OLD.framework_id;
  ELSE
    v_tenant := NEW.tenant_id; v_fw := NEW.framework_id;
  END IF;
  SELECT status INTO v_status FROM primary_school.competency_frameworks f WHERE f.tenant_id = v_tenant AND f.id = v_fw;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'primary_school.framework_published_immutable: la structure d''un référentiel % est figée (créer une nouvelle version)', coalesce(v_status, 'inconnu')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER competency_domains_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competency_domains
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();
CREATE TRIGGER competencies_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competencies
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();
CREATE TRIGGER framework_grade_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.framework_grade_levels
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();

-- Niveaux d'une échelle : modifiables tant qu'aucun référentiel PUBLIÉ ne l'emploie (une échelle publiée est figée).
CREATE FUNCTION primary_school.rating_levels_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid;
  v_scale  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_scale := OLD.scale_id;
  ELSE v_tenant := NEW.tenant_id; v_scale := NEW.scale_id; END IF;
  IF EXISTS (SELECT 1 FROM primary_school.competency_frameworks f
              WHERE f.tenant_id = v_tenant AND f.scale_id = v_scale AND f.status IN ('PUBLISHED', 'RETIRED')) THEN
    RAISE EXCEPTION 'primary_school.scale_in_use: l''échelle est employée par un référentiel publié ; créer une nouvelle échelle'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER rating_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.rating_levels
  FOR EACH ROW EXECUTE FUNCTION primary_school.rating_levels_guard();
GRANT DELETE ON primary_school.rating_levels TO app_user;   -- garde ci-dessus
