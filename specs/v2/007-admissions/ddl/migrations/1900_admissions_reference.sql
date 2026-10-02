-- =============================================================================
-- 1900 — Module admissions : schéma, paramètres, workflow personnalisable, campagnes et capacités
-- =============================================================================
--
-- Plage de numéros réservée au module admissions : 1900–1999 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; ligne à inscrire dans ce tableau).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma ; AUCUNE clé étrangère vers le schéma d'un autre module, sauf
--     `kernel.tenants(id)`. Établissement, année, niveau, élève, inscription, facture : UUID ou codes
--     vérifiés par les API publiques de tenancy / academic / people / finance ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, `kernel.enable_tenant_rls()`,
--     GRANT explicite à `app_user` (seule exception documentée : `public_form_index`, table de
--     résolution de lien public, voir plus bas) ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle académique ou réglementaire : capacités, priorités, durée de validité d'une offre,
--     pièces exigées et étapes du processus sont des DONNÉES de l'établissement.
--
-- Les huit STATUTS CANONIQUES du PRD §9 (DRAFT, SUBMITTED, UNDER_REVIEW, MISSING_DOCUMENT, ACCEPTED,
-- REJECTED, WAITLISTED, ENROLLED) forment le CONTRAT stable (événements, statistiques). Chaque
-- établissement définit ses propres ÉTAPES (`workflow_stages`), chacune rattachée à un statut canonique.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS admissions;
REVOKE ALL ON SCHEMA admissions FROM PUBLIC;
GRANT USAGE ON SCHEMA admissions TO app_user;

CREATE FUNCTION admissions.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admissions.append_only: la table % est en ajout seul (% refusé)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Normalisation d'un nom pour la détection de doublons : minuscules, sans accent courant, sans
-- ponctuation ni espaces multiples. IMMUABLE (colonne générée) ; l'accentuation exhaustive est
-- reprise côté application (`findDuplicateStudents` de people).
CREATE FUNCTION admissions.normalize_name(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           translate(lower(coalesce(p_value, '')),
                     'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
                     'aaaaaaceeeeiiiinooooouuuuyyoa'),
           '[^a-z0-9]+', ' ', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne)
--   capacity_policy   HARD  : refus au-delà de la capacité (défaut) ; SOFT : dépassement motivé ; NONE : pas de contrôle
--   duplicate_policy  BLOCK : un doublon non tranché empêche l'inscription ; WARN : simple alerte ; OFF
--   offer_validity_days : durée de validité d'une offre d'admission (politique de l'établissement)
--   payment_deadline_days : délai de paiement des frais d'inscription après acceptation de l'offre ; NULL = pas de délai
--                           (question métier) ; passé ce délai, le travail planifié annule l'inscription en attente
--   waitlist_promotion  MANUAL : le secrétariat propose la place libérée ; AUTO : proposée au premier de la liste
--   rejected_retention_months : NULL = durée de conservation d'un dossier refusé NON DÉTERMINÉE (question métier)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.settings (
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,                       -- tenancy.institutions.id (sans FK)
  public_form_enabled       boolean NOT NULL DEFAULT false,
  capacity_policy           text NOT NULL DEFAULT 'HARD' CHECK (capacity_policy IN ('HARD', 'SOFT', 'NONE')),
  duplicate_policy          text NOT NULL DEFAULT 'WARN' CHECK (duplicate_policy IN ('BLOCK', 'WARN', 'OFF')),
  waitlist_enabled          boolean NOT NULL DEFAULT true,
  consent_required          boolean NOT NULL DEFAULT true,
  consent_text_version      text,
  offer_validity_days       integer NOT NULL DEFAULT 14 CHECK (offer_validity_days BETWEEN 1 AND 365),
  payment_deadline_days     integer CHECK (payment_deadline_days IS NULL OR payment_deadline_days BETWEEN 1 AND 365),
  waitlist_promotion        text NOT NULL DEFAULT 'MANUAL' CHECK (waitlist_promotion IN ('MANUAL', 'AUTO')),
  minimum_form_seconds      integer NOT NULL DEFAULT 5 CHECK (minimum_form_seconds BETWEEN 0 AND 600),
  rejected_retention_months integer CHECK (rejected_retention_months IS NULL OR rejected_retention_months > 0),
  application_number_pattern text NOT NULL DEFAULT '{YEAR}-{SEQ:5}'
                             CHECK (length(application_number_pattern) BETWEEN 3 AND 60),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id),
  CHECK (NOT consent_required OR public_form_enabled IS NOT TRUE OR consent_text_version IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('admissions.settings');
GRANT SELECT, INSERT, UPDATE ON admissions.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Lien public par établissement : résolution `slug -> (tenant, établissement)` AVANT toute
-- connaissance du tenant (route publique). TABLE GLOBALE (allowlist d'isolation, justification :
-- aucune donnée personnelle ; le slug est un jeton opaque de 96 bits au moins, donc non énumérable).
-- Lecture ouverte ; écriture limitée au tenant courant (un tenant ne publie que ses propres liens).
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.public_form_index (
  slug           text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]{16,40}$'),
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id)
);
ALTER TABLE admissions.public_form_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions.public_form_index FORCE ROW LEVEL SECURITY;
CREATE POLICY pfi_read   ON admissions.public_form_index FOR SELECT USING (true);
CREATE POLICY pfi_insert ON admissions.public_form_index FOR INSERT WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY pfi_update ON admissions.public_form_index FOR UPDATE USING (tenant_id = kernel.current_tenant_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY pfi_delete ON admissions.public_form_index FOR DELETE USING (tenant_id = kernel.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.public_form_index TO app_user;

-- -----------------------------------------------------------------------------
-- Classes de priorité (liste d'attente) et motifs de décision : DONNÉES de l'établissement.
-- `rank` : plus petit = plus prioritaire. Aucune priorité n'est imposée par la plateforme.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.priority_classes (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  rank           integer NOT NULL CHECK (rank >= 1),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.priority_classes');
GRANT SELECT, INSERT, UPDATE ON admissions.priority_classes TO app_user;

CREATE TABLE admissions.decision_reasons (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  kind       text NOT NULL CHECK (kind IN ('ACCEPT', 'REJECT', 'WAITLIST', 'WITHDRAW', 'RECONSIDER')),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.decision_reasons');
GRANT SELECT, INSERT, UPDATE ON admissions.decision_reasons TO app_user;

-- -----------------------------------------------------------------------------
-- Textes de consentement : la PREUVE de ce que le parent a accepté. Chaque version est publiée une fois
-- et ne change plus ; `consents.text_version` la désigne. Un texte retiré reste lisible.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.consent_texts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('DATA_PROCESSING', 'PHOTO', 'ADMISSION_TERMS', 'COMMUNICATIONS')),
  version        text NOT NULL CHECK (version ~ '^[A-Za-z0-9._-]{1,20}$'),
  language       text NOT NULL DEFAULT 'fr' CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 20000),
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid,
  retired_at     timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, kind, version)
);
SELECT kernel.enable_tenant_rls('admissions.consent_texts');
GRANT SELECT, INSERT, UPDATE ON admissions.consent_texts TO app_user;

-- Le corps d'un texte publié ne change jamais ; seul son retrait (une fois) est permis ; pas de suppression.
CREATE FUNCTION admissions.consent_texts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admissions.consent_text_immutable: un texte de consentement ne se supprime pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.body <> OLD.body OR NEW.kind <> OLD.kind OR NEW.version <> OLD.version OR NEW.language <> OLD.language
     OR NEW.institution_id <> OLD.institution_id OR NEW.published_at <> OLD.published_at THEN
    RAISE EXCEPTION 'admissions.consent_text_immutable: un texte publié ne change pas (publier une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.consent_text_retired: un texte retiré est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consent_texts_guard BEFORE UPDATE OR DELETE ON admissions.consent_texts
  FOR EACH ROW EXECUTE FUNCTION admissions.consent_texts_guard();

-- -----------------------------------------------------------------------------
-- Workflow : étapes + transitions, VERSIONNÉ. Brouillon librement modifiable ; publié, il est figé
-- (corriger = nouvelle version). Les dossiers en cours restent épinglés à la version qui les a créés.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.workflows (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  education_level_code text CHECK (education_level_code IS NULL OR education_level_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),  -- NULL = tous les cycles
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at         timestamptz,
  published_by         uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code, version),
  CHECK ((status = 'DRAFT') = (published_at IS NULL))
);
SELECT kernel.enable_tenant_rls('admissions.workflows');
-- Un seul workflow publié par (établissement, cycle).
CREATE UNIQUE INDEX workflows_one_published
  ON admissions.workflows (tenant_id, institution_id, coalesce(education_level_code, '')) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflows TO app_user;   -- DELETE : brouillon (garde)

CREATE TABLE admissions.workflow_stages (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES kernel.tenants (id),
  workflow_id                   uuid NOT NULL,
  code                          text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label                         text NOT NULL CHECK (length(btrim(label)) > 0),
  canonical_status              text NOT NULL CHECK (canonical_status IN
                                  ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'ACCEPTED', 'REJECTED', 'WAITLISTED', 'ENROLLED')),
  ordinal                       integer NOT NULL CHECK (ordinal >= 1),
  is_initial                    boolean NOT NULL DEFAULT false,
  is_terminal                   boolean NOT NULL DEFAULT false,
  holds_seat                    boolean NOT NULL DEFAULT false,
  requires_consent              boolean NOT NULL DEFAULT false,
  requires_documents_complete   boolean NOT NULL DEFAULT false,
  requires_interview_done       boolean NOT NULL DEFAULT false,
  requires_decision             boolean NOT NULL DEFAULT false,
  creates_enrollment            boolean NOT NULL DEFAULT false,
  closure_kind                  text CHECK (closure_kind IN ('REJECTED_BY_SCHOOL', 'WITHDRAWN_BY_FAMILY', 'OFFER_EXPIRED', 'NO_SHOW', 'DUPLICATE')),
  sla_hours                     integer CHECK (sla_hours IS NULL OR sla_hours > 0),
  notify_template_code          text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, id),
  UNIQUE (tenant_id, workflow_id, code),
  UNIQUE (tenant_id, workflow_id, ordinal),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES admissions.workflows (tenant_id, id),
  CHECK (NOT is_initial OR canonical_status = 'DRAFT'),
  CHECK (canonical_status <> 'DRAFT' OR is_initial),
  CHECK (NOT (is_initial AND is_terminal)),
  CHECK (canonical_status <> 'ENROLLED' OR is_terminal),
  CHECK (NOT (canonical_status = 'REJECTED' AND is_terminal AND closure_kind IS NULL)),
  CHECK (closure_kind IS NULL OR (is_terminal AND canonical_status = 'REJECTED')),
  CHECK (NOT (holds_seat AND canonical_status IN ('DRAFT', 'REJECTED'))),
  CHECK (NOT creates_enrollment OR canonical_status = 'ACCEPTED'),
  CHECK (NOT requires_decision OR canonical_status IN ('ACCEPTED', 'REJECTED', 'WAITLISTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'SUBMITTED'))
);
SELECT kernel.enable_tenant_rls('admissions.workflow_stages');
-- Une seule étape initiale par workflow.
CREATE UNIQUE INDEX workflow_stages_one_initial ON admissions.workflow_stages (tenant_id, workflow_id) WHERE is_initial;
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflow_stages TO app_user;

CREATE TABLE admissions.workflow_transitions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  workflow_id     uuid NOT NULL,
  from_stage_id   uuid NOT NULL,
  to_stage_id     uuid NOT NULL,
  permission_key  text NOT NULL CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  requires_reason boolean NOT NULL DEFAULT false,
  is_automatic    boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, from_stage_id, to_stage_id),
  CHECK (from_stage_id <> to_stage_id),
  FOREIGN KEY (tenant_id, workflow_id, from_stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id),
  FOREIGN KEY (tenant_id, workflow_id, to_stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.workflow_transitions');
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflow_transitions TO app_user;

-- Structure d'un workflow publié : figée.
CREATE FUNCTION admissions.workflow_structure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_tenant uuid;
  v_wf     uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_wf := OLD.workflow_id;
  ELSE v_tenant := NEW.tenant_id; v_wf := NEW.workflow_id; END IF;
  SELECT status INTO v_status FROM admissions.workflows w WHERE w.tenant_id = v_tenant AND w.id = v_wf;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'admissions.workflow_published_immutable: le workflow est % ; créer une nouvelle version pour le modifier', coalesce(v_status, 'inconnu')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER workflow_stages_guard BEFORE INSERT OR UPDATE OR DELETE ON admissions.workflow_stages
  FOR EACH ROW EXECUTE FUNCTION admissions.workflow_structure_guard();
CREATE TRIGGER workflow_transitions_guard BEFORE INSERT OR UPDATE OR DELETE ON admissions.workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION admissions.workflow_structure_guard();

-- Cycle de vie + VALIDATION À LA PUBLICATION. Un workflow publié est cohérent : une étape initiale,
-- les statuts canoniques indispensables, un seul ENROLLED terminal, aucune sortie d'une étape
-- terminale, toute étape non terminale a une issue, tout est atteignable depuis l'étape initiale,
-- ENROLLED est atteignable, exactement une étape « crée l'inscription » et elle précède ENROLLED.
CREATE FUNCTION admissions.workflows_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_n        integer;
  v_unreach  text;
  v_bad      text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'admissions.workflow_delete_forbidden: un workflow % ne se supprime pas', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code <> OLD.code OR NEW.version <> OLD.version OR NEW.institution_id <> OLD.institution_id THEN
      RAISE EXCEPTION 'admissions.workflow_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND (NEW.label <> OLD.label OR NEW.education_level_code IS DISTINCT FROM OLD.education_level_code) THEN
      RAISE EXCEPTION 'admissions.workflow_published_immutable: un workflow publié ne se modifie pas' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'admissions.workflow_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT' THEN
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_initial;
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_initial: il faut exactement une étape initiale (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      FOR v_bad IN SELECT c FROM unnest(ARRAY['SUBMITTED', 'ACCEPTED', 'REJECTED', 'ENROLLED']) AS c
                    WHERE NOT EXISTS (SELECT 1 FROM admissions.workflow_stages s
                                       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.canonical_status = c)
      LOOP
        RAISE EXCEPTION 'admissions.workflow_missing_status: le workflow doit comporter une étape de statut %', v_bad USING ERRCODE = 'check_violation';
      END LOOP;
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.canonical_status = 'ENROLLED';
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_enrolled: une seule étape ENROLLED est permise (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.creates_enrollment;
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_creates_enrollment: exactement une étape doit créer l''inscription (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      -- au moins une étape à décision pour ACCEPTED et pour REJECTED
      FOR v_bad IN SELECT c FROM unnest(ARRAY['ACCEPTED', 'REJECTED']) AS c
                    WHERE NOT EXISTS (SELECT 1 FROM admissions.workflow_stages s
                                       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id
                                         AND s.canonical_status = c AND s.requires_decision)
      LOOP
        RAISE EXCEPTION 'admissions.workflow_decision_missing: une étape de statut % doit exiger une décision formelle', v_bad USING ERRCODE = 'check_violation';
      END LOOP;
      -- étapes terminales sans sortie ; étapes non terminales avec issue
      SELECT string_agg(s.code, ', ') INTO v_bad
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_terminal
         AND EXISTS (SELECT 1 FROM admissions.workflow_transitions t WHERE t.tenant_id = s.tenant_id AND t.from_stage_id = s.id);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_terminal_exit: étape(s) terminale(s) avec sortie : %', v_bad USING ERRCODE = 'check_violation';
      END IF;
      SELECT string_agg(s.code, ', ') INTO v_bad
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND NOT s.is_terminal
         AND NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t WHERE t.tenant_id = s.tenant_id AND t.from_stage_id = s.id);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_dead_end: étape(s) sans issue : %', v_bad USING ERRCODE = 'check_violation';
      END IF;
      -- atteignabilité depuis l'étape initiale
      WITH RECURSIVE reach(stage_id) AS (
        SELECT s.id FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_initial
        UNION
        SELECT t.to_stage_id FROM admissions.workflow_transitions t JOIN reach r ON r.stage_id = t.from_stage_id
         WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.id
      )
      SELECT string_agg(s.code, ', ') INTO v_unreach
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.id NOT IN (SELECT stage_id FROM reach);
      IF v_unreach IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_unreachable: étape(s) inatteignable(s) : %', v_unreach USING ERRCODE = 'check_violation';
      END IF;
      -- l'étape qui crée l'inscription précède ENROLLED (ENROLLED n'est atteignable que par elle ou après elle)
      IF EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                   JOIN admissions.workflow_stages e ON e.tenant_id = t.tenant_id AND e.id = t.to_stage_id AND e.canonical_status = 'ENROLLED'
                   JOIN admissions.workflow_stages f ON f.tenant_id = t.tenant_id AND f.id = t.from_stage_id
                  WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.id AND NOT f.creates_enrollment) THEN
        RAISE EXCEPTION 'admissions.workflow_enrolled_entry: ENROLLED ne s''atteint que depuis l''étape qui crée l''inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER workflows_guard BEFORE UPDATE OR DELETE ON admissions.workflows
  FOR EACH ROW EXECUTE FUNCTION admissions.workflows_guard();

-- -----------------------------------------------------------------------------
-- Campagnes d'admission (une par année et établissement, ou davantage) et capacités par niveau
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.campaigns (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,                         -- academic.academic_years.id (sans FK)
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  workflow_id      uuid NOT NULL,
  opens_at         timestamptz NOT NULL,
  closes_at        timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (closes_at > opens_at),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES admissions.workflows (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.campaigns');
CREATE INDEX campaigns_by_year ON admissions.campaigns (tenant_id, institution_id, academic_year_id, status);
GRANT SELECT, INSERT, UPDATE ON admissions.campaigns TO app_user;

-- Une campagne n'ouvre qu'avec un workflow PUBLIÉ ; son workflow est figé dès l'ouverture.
CREATE FUNCTION admissions.campaigns_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_wf admissions.workflows%ROWTYPE;
BEGIN
  SELECT * INTO v_wf FROM admissions.workflows w WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.workflow_id;
  IF v_wf.institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'admissions.campaign_workflow_institution: le workflow appartient à un autre établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('OPEN', 'CLOSED') AND v_wf.status NOT IN ('PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'admissions.campaign_workflow_not_published: la campagne ne s''ouvre qu''avec un workflow publié' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'admissions.campaign_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND NEW.workflow_id <> OLD.workflow_id THEN
      RAISE EXCEPTION 'admissions.campaign_workflow_frozen: le workflow d''une campagne ouverte est figé' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'OPEN') OR
         (OLD.status = 'OPEN' AND NEW.status IN ('CLOSED', 'DRAFT')) OR
         (OLD.status = 'CLOSED' AND NEW.status IN ('OPEN', 'ARCHIVED'))) THEN
      RAISE EXCEPTION 'admissions.campaign_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER campaigns_guard BEFORE INSERT OR UPDATE ON admissions.campaigns
  FOR EACH ROW EXECUTE FUNCTION admissions.campaigns_guard();

-- Capacités d'accueil par niveau (et, au choix, par programme). Absence de ligne = pas de plafond configuré.
CREATE TABLE admissions.intake_capacities (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  campaign_id       uuid NOT NULL,
  grade_level_code  text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  program_id        uuid,                                  -- academic.programs.id (sans FK)
  seats             integer NOT NULL CHECK (seats >= 0),
  waitlist_limit    integer CHECK (waitlist_limit IS NULL OR waitlist_limit >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES admissions.campaigns (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.intake_capacities');
CREATE UNIQUE INDEX intake_capacities_unique
  ON admissions.intake_capacities (tenant_id, campaign_id, grade_level_code, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE ON admissions.intake_capacities TO app_user;

-- Pièces justificatives exigées (données de l'établissement). `applies_to_funding` : pièce propre à un
-- type de financement (ex. la décision d'affectation pour STATE_ASSIGNED).
CREATE TABLE admissions.document_requirements (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  grade_level_code    text,                                -- NULL = tous les niveaux
  applies_to_funding  text CHECK (applies_to_funding IS NULL OR applies_to_funding IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  required            boolean NOT NULL DEFAULT true,
  accepts_mime        text[] NOT NULL DEFAULT ARRAY['application/pdf', 'image/jpeg', 'image/png'],
  max_size_kb         integer NOT NULL DEFAULT 5120 CHECK (max_size_kb BETWEEN 1 AND 51200),
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.document_requirements');
GRANT SELECT, INSERT, UPDATE ON admissions.document_requirements TO app_user;
