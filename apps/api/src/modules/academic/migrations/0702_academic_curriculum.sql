-- =============================================================================
-- 0702 — Module academic : programmes, matières, curriculum polymorphe versionné
-- =============================================================================
--
-- Un seul arbre `curriculum_nodes` exprime tous les packs :
--   primaire / secondaire :  LEVEL > SUBJECT(coefficient)                  ou  LEVEL > GROUP > SUBJECT
--   supérieur (LMD, BTS)  :  LEVEL > PERIOD(semestre) > UE(crédits) > ECUE(crédits, coefficient)
-- La grammaire (quel type sous quel parent) est de la DONNÉE (`curriculum_node_types`),
-- contrôlée par un déclencheur. Un curriculum est versionné par année académique : on le
-- clone d'une année à l'autre (`lineage_id` conserve l'identité d'une position à travers
-- les clones, pour les prérequis et la capitalisation inter-annuelle).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Programmes : filière (supérieur), série / spécialité / option (secondaire), parcours
-- général (primaire). `parent_program_id` modélise série > spécialité (2 niveaux max).
-- Plus aucune détection par expression régulière sur le nom (« licence 1 »…) : le cycle est
-- `education_level_id`, le niveau est un `grade_levels`.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.programs (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,                   -- tenancy.institutions.id (sans FK)
  education_level_id  uuid NOT NULL,
  parent_program_id   uuid,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  kind_code           text NOT NULL DEFAULT 'PROGRAM' CHECK (kind_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  domain_code         text CHECK (domain_code IS NULL OR domain_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  description         text,
  duration_months     integer CHECK (duration_months IS NULL OR duration_months > 0),
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),   -- ex. niveau de certification, type de cycle propre au système éducatif
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (parent_program_id IS NULL OR parent_program_id <> id),
  FOREIGN KEY (tenant_id, education_level_id) REFERENCES academic.education_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_program_id) REFERENCES academic.programs (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.programs');
CREATE INDEX programs_by_institution ON academic.programs (tenant_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON academic.programs TO app_user;

-- Niveaux couverts par un programme (L1, L2, L3 pour une licence ; 2nde, 1ère, Tle pour une série).
CREATE TABLE academic.program_grade_levels (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  program_id     uuid NOT NULL,
  grade_level_id uuid NOT NULL,
  ordinal        integer NOT NULL CHECK (ordinal >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, program_id, grade_level_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.program_grade_levels');
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.program_grade_levels TO app_user;

-- Contrôle d'intégrité : le parent d'un programme est du même établissement, pas de cycle.
CREATE FUNCTION academic.programs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent academic.programs%ROWTYPE;
BEGIN
  IF NEW.parent_program_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM academic.programs WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_program_id;
    IF v_parent.institution_id <> NEW.institution_id THEN
      RAISE EXCEPTION 'academic.program_parent_other_institution: le programme parent est d''un autre établissement'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent.parent_program_id IS NOT NULL THEN
      RAISE EXCEPTION 'academic.program_too_deep: deux niveaux de programmes au plus (série > spécialité)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'academic.program_institution_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER programs_guard BEFORE INSERT OR UPDATE ON academic.programs
  FOR EACH ROW EXECUTE FUNCTION academic.programs_guard();

-- -----------------------------------------------------------------------------
-- Catalogue des matières (Subject / ECUE réutilisable). Une matière peut apparaître dans
-- plusieurs nœuds (mutualisation d'une ECUE entre plusieurs UE, d'une matière entre séries).
-- Les supports de cours, devoirs et évaluations s'accrochent à `subjects.id` lorsqu'ils sont
-- mutualisables, au nœud sinon (choix du module d'évaluation).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.subjects (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid,                                  -- NULL = commune à tous les établissements du tenant
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  short_label    text,
  domain_code    text CHECK (domain_code IS NULL OR domain_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  description    text,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.subjects');
GRANT SELECT, INSERT, UPDATE ON academic.subjects TO app_user;

-- -----------------------------------------------------------------------------
-- Version de curriculum : un programme, une année académique, un arbre.
--   DRAFT      structure librement modifiable
--   PUBLISHED  publiée : seuls libellés, coefficients, crédits, volumes horaires sont modifiables
--              (journalisés dans curriculum_amendments) ; la structure ne bouge que par
--              `amendPublishedCurriculum` (réglage de session `academic.structural_change`)
--   LOCKED     verrouillée à la clôture de l'année : plus aucune modification
--   ARCHIVED   historique
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_versions (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  program_id            uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'LOCKED', 'ARCHIVED')),
  cloned_from_version_id uuid,
  published_at          timestamptz,
  published_by          uuid,
  locked_at             timestamptz,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, program_id, academic_year_id),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, cloned_from_version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_versions');
GRANT SELECT, INSERT, UPDATE ON academic.curriculum_versions TO app_user;

CREATE FUNCTION academic.curriculum_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.program_id <> OLD.program_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'academic.version_identity_immutable: programme et année d''une version sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'     AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status IN ('LOCKED', 'DRAFT')) OR
         (OLD.status = 'LOCKED'    AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'academic.version_transition: % -> % interdit', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_versions_guard BEFORE INSERT OR UPDATE ON academic.curriculum_versions
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_versions_guard();

-- -----------------------------------------------------------------------------
-- Nœuds du curriculum
--   id          identifiant stable consommé par assess / reportcards / higher (curriculum_node_id)
--   lineage_id  identité de la POSITION à travers les clones d'une année à l'autre
--   subject_id  matière du catalogue (types qui l'exigent : SUBJECT, ECUE)
--   grade_level_id  pour LEVEL ; period_type_code + period_ordinal pour PERIOD
--   coefficient / credits : optionnels, autorisés selon le type
--   is_mandatory : obligatoire (true) ou à option (false)
--   is_transversal : matière transversale (ex. conduite) : jamais inscrite à la carte, jamais
--                    affectée à un enseignant, comptée dans les moyennes selon le RuleSet
--   category_code : regroupement d'affichage (ex. UE fondamentale / spécialité / culture générale)
--   attributes : paramètres propres à un type, validés par Zod côté module (ex. choix {min,max})
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_nodes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id        uuid NOT NULL,
  parent_id         uuid,
  node_type_code    text NOT NULL,
  lineage_id        uuid NOT NULL,
  subject_id        uuid,
  grade_level_id    uuid,
  period_type_code  text,
  period_ordinal    integer CHECK (period_ordinal IS NULL OR period_ordinal >= 1),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal           integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  coefficient       numeric(7, 3) CHECK (coefficient IS NULL OR coefficient > 0),
  credits           numeric(6, 2) CHECK (credits IS NULL OR credits >= 0),
  is_mandatory      boolean NOT NULL DEFAULT true,
  is_transversal    boolean NOT NULL DEFAULT false,
  category_code     text CHECK (category_code IS NULL OR category_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  hours_total       numeric(7, 2) CHECK (hours_total IS NULL OR hours_total >= 0),
  hours_lecture     numeric(7, 2) CHECK (hours_lecture IS NULL OR hours_lecture >= 0),      -- CM
  hours_tutorial    numeric(7, 2) CHECK (hours_tutorial IS NULL OR hours_tutorial >= 0),    -- TD
  hours_practical   numeric(7, 2) CHECK (hours_practical IS NULL OR hours_practical >= 0),  -- TP
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, version_id, id),
  UNIQUE (tenant_id, version_id, lineage_id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK ((period_type_code IS NULL) = (period_ordinal IS NULL)),
  CHECK (hours_total IS NULL OR coalesce(hours_lecture, 0) + coalesce(hours_tutorial, 0) + coalesce(hours_practical, 0) <= hours_total),
  FOREIGN KEY (tenant_id, version_id) REFERENCES academic.curriculum_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id, parent_id) REFERENCES academic.curriculum_nodes (tenant_id, version_id, id),
  FOREIGN KEY (tenant_id, node_type_code) REFERENCES academic.curriculum_node_types (tenant_id, code),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES academic.subjects (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, period_type_code) REFERENCES academic.period_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_nodes');
-- Code unique parmi les frères (affichage, imports).
CREATE UNIQUE INDEX curriculum_nodes_sibling_code
  ON academic.curriculum_nodes (tenant_id, version_id, (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)), code);
CREATE INDEX curriculum_nodes_by_parent ON academic.curriculum_nodes (tenant_id, version_id, parent_id, ordinal);
CREATE INDEX curriculum_nodes_by_subject ON academic.curriculum_nodes (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX curriculum_nodes_by_lineage ON academic.curriculum_nodes (tenant_id, lineage_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.curriculum_nodes TO app_user;

CREATE FUNCTION academic.curriculum_nodes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ver     academic.curriculum_versions%ROWTYPE;
  v_type    academic.curriculum_node_types%ROWTYPE;
  v_ptype   text;
  v_cycle   boolean;
  v_depth   integer;
  v_struct  boolean := coalesce(current_setting('academic.structural_change', true), '') = 'on';
  v_row     academic.curriculum_nodes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  SELECT * INTO v_ver FROM academic.curriculum_versions WHERE tenant_id = v_row.tenant_id AND id = v_row.version_id;

  -- Verrouillage par statut de version.
  IF v_ver.status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked: la version du curriculum est % ; aucune modification', v_ver.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_ver.status = 'PUBLISHED' AND NOT v_struct THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'academic.curriculum_published: la structure d''un curriculum publié ne change que par amendement'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.node_type_code <> OLD.node_type_code
       OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id
       OR NEW.period_type_code IS DISTINCT FROM OLD.period_type_code OR NEW.period_ordinal IS DISTINCT FROM OLD.period_ordinal
       OR NEW.is_mandatory <> OLD.is_mandatory OR NEW.is_transversal <> OLD.is_transversal THEN
      RAISE EXCEPTION 'academic.curriculum_published: modification structurelle refusée sur un curriculum publié'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO v_type FROM academic.curriculum_node_types WHERE tenant_id = NEW.tenant_id AND code = NEW.node_type_code;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.lineage_id <> OLD.lineage_id OR NEW.version_id <> OLD.version_id OR NEW.node_type_code <> OLD.node_type_code THEN
      RAISE EXCEPTION 'academic.node_identity_immutable: version, type et lignée d''un nœud sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- Grammaire : le type du parent doit figurer dans les parents admis.
  IF NEW.parent_id IS NULL THEN
    IF NOT ('ROOT' = ANY (v_type.allowed_parent_codes)) THEN
      RAISE EXCEPTION 'academic.node_needs_parent: un nœud % ne peut pas être à la racine', NEW.node_type_code
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT node_type_code INTO v_ptype FROM academic.curriculum_nodes
     WHERE tenant_id = NEW.tenant_id AND version_id = NEW.version_id AND id = NEW.parent_id;
    IF NOT (v_ptype = ANY (v_type.allowed_parent_codes)) THEN
      RAISE EXCEPTION 'academic.node_bad_parent: un nœud % ne peut pas être sous un nœud %', NEW.node_type_code, v_ptype
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      WITH RECURSIVE anc(id, parent_id, depth) AS (
        SELECT n.id, n.parent_id, 1 FROM academic.curriculum_nodes n
         WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.parent_id
        UNION ALL
        SELECT n.id, n.parent_id, a.depth + 1 FROM academic.curriculum_nodes n
          JOIN anc a ON n.id = a.parent_id AND n.tenant_id = NEW.tenant_id
         WHERE a.depth < 16
      )
      SELECT bool_or(id = NEW.id), coalesce(max(depth), 0) INTO v_cycle, v_depth FROM anc;
      IF coalesce(v_cycle, false) THEN
        RAISE EXCEPTION 'academic.node_cycle: ce déplacement créerait un cycle' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Attributs exigés ou interdits par le type.
  IF v_type.requires_subject AND NEW.subject_id IS NULL THEN
    RAISE EXCEPTION 'academic.node_subject_required: un nœud % exige une matière', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_subject AND NEW.subject_id IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_subject_forbidden: un nœud % ne porte pas de matière', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_grade_level AND NEW.grade_level_id IS NULL THEN
    RAISE EXCEPTION 'academic.node_grade_level_required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_grade_level AND NEW.grade_level_id IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_grade_level_forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_period_slot AND NEW.period_type_code IS NULL THEN
    RAISE EXCEPTION 'academic.node_period_slot_required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_period_slot AND NEW.period_type_code IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_period_slot_forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.coefficient IS NOT NULL AND NOT v_type.allows_coefficient THEN
    RAISE EXCEPTION 'academic.node_coefficient_forbidden: pas de coefficient sur un nœud %', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.credits IS NOT NULL AND NOT v_type.allows_credits THEN
    RAISE EXCEPTION 'academic.node_credits_forbidden: pas de crédits sur un nœud %', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;

  -- Un nœud LEVEL ne peut viser qu'un niveau couvert par le programme de la version.
  IF v_type.requires_grade_level AND NOT EXISTS (
       SELECT 1 FROM academic.program_grade_levels pgl
        WHERE pgl.tenant_id = NEW.tenant_id AND pgl.program_id = v_ver.program_id AND pgl.grade_level_id = NEW.grade_level_id) THEN
    RAISE EXCEPTION 'academic.node_level_not_in_program: le niveau n''est pas couvert par le programme' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_nodes_guard BEFORE INSERT OR UPDATE OR DELETE ON academic.curriculum_nodes
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_nodes_guard();

-- -----------------------------------------------------------------------------
-- Prérequis : « pour s'inscrire à ce nœud, il faut avoir VALIDÉ la position X » (logique ET).
-- La cible est une lignée (lineage_id) : le prérequis reste vrai d'une année à l'autre et
-- d'un clone de curriculum à l'autre. Pas d'auto-référence, pas de cycle (déclencheur).
-- Même établissement ; programmes différents admis (mutualisation inter-filières).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_prerequisites (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id           uuid NOT NULL,
  node_id              uuid NOT NULL,
  required_lineage_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, node_id, required_lineage_id),
  FOREIGN KEY (tenant_id, version_id, node_id) REFERENCES academic.curriculum_nodes (tenant_id, version_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('academic.curriculum_prerequisites');
CREATE INDEX curriculum_prerequisites_by_required ON academic.curriculum_prerequisites (tenant_id, required_lineage_id);
GRANT SELECT, INSERT, DELETE ON academic.curriculum_prerequisites TO app_user;

CREATE FUNCTION academic.curriculum_prerequisites_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_node_lineage uuid;
  v_status       text;
  v_institution  uuid;
  v_cycle        boolean;
BEGIN
  SELECT n.lineage_id, v.status, p.institution_id INTO v_node_lineage, v_status, v_institution
    FROM academic.curriculum_nodes n
    JOIN academic.curriculum_versions v ON v.tenant_id = n.tenant_id AND v.id = n.version_id
    JOIN academic.programs p ON p.tenant_id = v.tenant_id AND p.id = v.program_id
   WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.node_id;
  IF v_node_lineage = NEW.required_lineage_id THEN
    RAISE EXCEPTION 'academic.prerequisite_self: un nœud ne peut pas être son propre prérequis' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Un prérequis est de la structure : sur un curriculum publié, seul un amendement le change.
  IF v_status = 'PUBLISHED' AND coalesce(current_setting('academic.structural_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'academic.curriculum_published: un prérequis d''un curriculum publié ne change que par amendement' USING ERRCODE = 'restrict_violation';
  END IF;
  -- La lignée visée existe dans le même établissement.
  IF NOT EXISTS (
       SELECT 1 FROM academic.curriculum_nodes rn
         JOIN academic.curriculum_versions rv ON rv.tenant_id = rn.tenant_id AND rv.id = rn.version_id
         JOIN academic.programs rp ON rp.tenant_id = rv.tenant_id AND rp.id = rv.program_id
        WHERE rn.tenant_id = NEW.tenant_id AND rn.lineage_id = NEW.required_lineage_id AND rp.institution_id = v_institution) THEN
    RAISE EXCEPTION 'academic.prerequisite_unknown_lineage: prérequis inconnu dans cet établissement' USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Cycle : le prérequis ne doit pas (transitivement) exiger le nœud courant.
  WITH RECURSIVE chain(lineage_id, depth) AS (
    SELECT NEW.required_lineage_id, 1
    UNION ALL
    SELECT pr.required_lineage_id, c.depth + 1
      FROM chain c
      JOIN academic.curriculum_nodes cn ON cn.tenant_id = NEW.tenant_id AND cn.lineage_id = c.lineage_id
      JOIN academic.curriculum_prerequisites pr ON pr.tenant_id = NEW.tenant_id AND pr.node_id = cn.id
     WHERE c.depth < 32
  )
  SELECT bool_or(lineage_id = v_node_lineage) INTO v_cycle FROM chain;
  IF coalesce(v_cycle, false) THEN
    RAISE EXCEPTION 'academic.prerequisite_cycle: ce prérequis créerait un cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_prerequisites_guard BEFORE INSERT ON academic.curriculum_prerequisites
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_prerequisites_guard();

CREATE FUNCTION academic.curriculum_prerequisites_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT v.status INTO v_status
    FROM academic.curriculum_versions v WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.version_id;
  IF v_status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_status = 'PUBLISHED' AND coalesce(current_setting('academic.structural_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'academic.curriculum_published: un prérequis d''un curriculum publié ne change que par amendement' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER curriculum_prerequisites_delete_guard BEFORE DELETE ON academic.curriculum_prerequisites
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_prerequisites_delete_guard();

-- -----------------------------------------------------------------------------
-- Journal des amendements d'un curriculum publié (coefficient, crédits, structure).
-- Append-only. Lu par le moteur de résultats pour signaler les recalculs nécessaires.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_amendments (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id  uuid NOT NULL,
  node_id     uuid,
  kind        text NOT NULL CHECK (kind IN ('NODE_ADDED', 'NODE_REMOVED', 'NODE_MOVED', 'COEFFICIENT', 'CREDITS', 'MANDATORY', 'PREREQUISITE', 'OTHER')),
  old_value   jsonb,
  new_value   jsonb,
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 5),
  amended_by  uuid NOT NULL,
  amended_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_amendments');
CREATE INDEX curriculum_amendments_by_version ON academic.curriculum_amendments (tenant_id, version_id, amended_at DESC);
GRANT SELECT, INSERT ON academic.curriculum_amendments TO app_user;
