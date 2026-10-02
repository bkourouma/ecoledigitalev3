-- =============================================================================
-- 1901 — Module admissions : prospects, candidatures, tuteurs, consentements, pièces, entretiens,
--         offres, décisions, journal de transitions, doublons, notifications, numérotation
-- =============================================================================
--
-- Le dossier d'un candidat (applications) est le seul objet qui AVANCE dans le workflow. Toute règle
-- de passage est imposée ici par un déclencheur (`applications_guard`) qui lit le workflow publié :
-- transition déclarée, pièces complètes, consentement, entretien, décision formelle journalisée,
-- capacité, doublons, éléments d'inscription. Les décisions et le journal sont en ajout seul.
--
-- Données personnelles : prénom, nom, naissance du candidat, coordonnées des tuteurs. Elles ne
-- sortent JAMAIS dans un événement (identifiants et codes seulement) ni dans un journal d'audit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numérotation transactionnelle SANS TROU : un compteur par portée (ici : campagne). L'incrément
-- est dans la transaction de la candidature : une annulation ne consomme aucun numéro.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.number_sequences (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  scope_key  text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 120),
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope_key)
);
SELECT kernel.enable_tenant_rls('admissions.number_sequences');
GRANT SELECT, INSERT, UPDATE ON admissions.number_sequences TO app_user;

CREATE FUNCTION admissions.next_number(p_scope text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO admissions.number_sequences AS s (tenant_id, scope_key, last_value)
  VALUES (kernel.current_tenant_id(), p_scope, 1)
  ON CONFLICT (tenant_id, scope_key) DO UPDATE SET last_value = s.last_value + 1, updated_at = now()
  RETURNING last_value
$$;
GRANT EXECUTE ON FUNCTION admissions.next_number(text) TO app_user;

-- -----------------------------------------------------------------------------
-- Prospects (contacts avant candidature)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.prospects (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,
  first_name                text NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name                 text NOT NULL CHECK (length(btrim(last_name)) > 0),
  contact_phone             text CHECK (contact_phone IS NULL OR length(contact_phone) BETWEEN 6 AND 24),
  contact_email             text CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+$'),
  interested_grade_level_code text,
  source_channel            text NOT NULL DEFAULT 'WALK_IN' CHECK (source_channel ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  referrer_label            text,
  status                    text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CONVERTED', 'LOST')),
  lost_reason               text,
  assigned_to               uuid,
  converted_application_id  uuid,
  notes                     text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL),
  CHECK ((status = 'CONVERTED') = (converted_application_id IS NOT NULL)),
  CHECK (status <> 'LOST' OR length(btrim(coalesce(lost_reason, ''))) > 0)
);
SELECT kernel.enable_tenant_rls('admissions.prospects');
-- Un seul prospect actif par e-mail et établissement.
CREATE UNIQUE INDEX prospects_one_active_email
  ON admissions.prospects (tenant_id, institution_id, lower(contact_email))
  WHERE contact_email IS NOT NULL AND status IN ('NEW', 'CONTACTED');
CREATE INDEX prospects_by_status ON admissions.prospects (tenant_id, institution_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON admissions.prospects TO app_user;

-- -----------------------------------------------------------------------------
-- Candidatures
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.applications (
  id                         uuid PRIMARY KEY,
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id             uuid NOT NULL,
  campaign_id                uuid NOT NULL,
  workflow_id                uuid NOT NULL,
  stage_id                   uuid NOT NULL,
  status                     text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                               ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'ACCEPTED', 'REJECTED', 'WAITLISTED', 'ENROLLED')),
  application_number         text NOT NULL CHECK (length(btrim(application_number)) > 0),
  created_via                text NOT NULL CHECK (created_via IN ('PUBLIC_FORM', 'STAFF', 'IMPORT', 'PROSPECT')),
  prospect_id                uuid,
  -- candidat (le dossier permanent est créé dans `people` à l'étape qui crée l'inscription)
  applicant_first_name       text NOT NULL CHECK (length(btrim(applicant_first_name)) > 0),
  applicant_last_name        text NOT NULL CHECK (length(btrim(applicant_last_name)) > 0),
  applicant_birth_date       date NOT NULL CHECK (applicant_birth_date > DATE '1950-01-01'),
  applicant_birth_place      text,
  applicant_gender           text CHECK (applicant_gender IN ('FEMALE', 'MALE')),
  applicant_nationality      text,
  previous_school            text,
  previous_grade_level_code  text,
  is_repeating               boolean NOT NULL DEFAULT false,
  identity_key               text GENERATED ALWAYS AS (
                               admissions.normalize_name(applicant_last_name) || '|' ||
                               admissions.normalize_name(applicant_first_name) || '|' || (applicant_birth_date - DATE '1900-01-01')::text
                             ) STORED,
  -- souhait
  desired_grade_level_code   text NOT NULL CHECK (desired_grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  desired_program_id         uuid,
  funding_type_requested     text NOT NULL DEFAULT 'PRIVATE'
                             CHECK (funding_type_requested IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  assignment_reference       text CHECK (assignment_reference IS NULL OR length(btrim(assignment_reference)) > 0),
  priority_class_code        text,
  source_channel             text NOT NULL DEFAULT 'WALK_IN' CHECK (source_channel ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  referrer_label             text,
  tracking_code_hash         text CHECK (tracking_code_hash IS NULL OR tracking_code_hash ~ '^[0-9a-f]{64}$'),
  extra                      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extra) = 'object'),
  -- traitement
  capacity_override_reason   text,
  waitlist_entered_at        timestamptz,
  submitted_at               timestamptz,
  decided_at                 timestamptz,
  closed_at                  timestamptz,
  -- passage à l'inscription (références vers les autres modules, sans FK)
  student_id                 uuid,
  enrollment_id              uuid,
  invoice_id                 uuid,
  enrollment_confirmed_at    timestamptz,
  enrolled_at                timestamptz,
  created_by                 uuid,
  row_version                integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, application_number),
  CHECK (funding_type_requested <> 'STATE_ASSIGNED' OR assignment_reference IS NOT NULL),
  CHECK (status <> 'ENROLLED' OR (student_id IS NOT NULL AND enrollment_id IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_confirmed_at IS NOT NULL)),
  CHECK ((enrollment_id IS NULL) = (student_id IS NULL)),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES admissions.campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_id, stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.applications');
-- Une candidature « vivante » par enfant et par campagne (le même enfant ne dépose pas deux dossiers ouverts).
CREATE UNIQUE INDEX applications_one_live_per_child
  ON admissions.applications (tenant_id, campaign_id, identity_key) WHERE status <> 'REJECTED';
CREATE UNIQUE INDEX applications_tracking_code ON admissions.applications (tenant_id, tracking_code_hash) WHERE tracking_code_hash IS NOT NULL;
CREATE INDEX applications_by_campaign_status ON admissions.applications (tenant_id, campaign_id, status, desired_grade_level_code);
CREATE INDEX applications_by_identity ON admissions.applications (tenant_id, identity_key);
CREATE INDEX applications_by_stage ON admissions.applications (tenant_id, stage_id, updated_at);
CREATE INDEX applications_waitlist ON admissions.applications (tenant_id, campaign_id, desired_grade_level_code, waitlist_entered_at) WHERE status = 'WAITLISTED';
GRANT SELECT, INSERT, UPDATE ON admissions.applications TO app_user;

CREATE TABLE admissions.application_guardians (
  id                         uuid PRIMARY KEY,
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id             uuid NOT NULL,
  relationship_code          text NOT NULL CHECK (relationship_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  first_name                 text NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name                  text NOT NULL CHECK (length(btrim(last_name)) > 0),
  phone                      text CHECK (phone IS NULL OR length(phone) BETWEEN 6 AND 24),
  email                      text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+$'),
  profession                 text,
  is_primary                 boolean NOT NULL DEFAULT false,
  is_financial_responsible   boolean NOT NULL DEFAULT false,
  can_consent                boolean NOT NULL DEFAULT true,       -- tuteur légal habilité à consentir
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, id),
  CHECK (phone IS NOT NULL OR email IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.application_guardians');
CREATE UNIQUE INDEX application_guardians_one_primary
  ON admissions.application_guardians (tenant_id, application_id) WHERE is_primary;
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.application_guardians TO app_user;

-- Consentements : preuve du consentement parental (texte et version), jamais effacée ; un retrait est
-- une ligne mise à jour UNE fois (`withdrawn_at`).
CREATE TABLE admissions.consents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id  uuid NOT NULL,
  guardian_id     uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('DATA_PROCESSING', 'PHOTO', 'ADMISSION_TERMS', 'COMMUNICATIONS')),
  text_version    text NOT NULL CHECK (length(btrim(text_version)) > 0),
  given_at        timestamptz NOT NULL DEFAULT now(),
  given_via       text NOT NULL CHECK (given_via IN ('PUBLIC_FORM', 'STAFF_ON_BEHALF', 'PAPER')),
  evidence_ref    text,                                  -- pièce justifiant un consentement papier / par délégation
  ip_hash         text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash         text CHECK (ua_hash IS NULL OR ua_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_at    timestamptz,
  withdrawn_reason text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, guardian_id, kind, text_version),
  CHECK (given_via = 'PUBLIC_FORM' OR length(btrim(coalesce(evidence_ref, ''))) > 0),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL)),
  FOREIGN KEY (tenant_id, application_id, guardian_id) REFERENCES admissions.application_guardians (tenant_id, application_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.consents');
GRANT SELECT, INSERT, UPDATE ON admissions.consents TO app_user;

CREATE FUNCTION admissions.consents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admissions.consent_immutable: un consentement ne s''efface pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.application_id <> OLD.application_id OR NEW.guardian_id <> OLD.guardian_id OR NEW.kind <> OLD.kind
     OR NEW.text_version <> OLD.text_version OR NEW.given_at <> OLD.given_at OR NEW.given_via <> OLD.given_via
     OR NEW.evidence_ref IS DISTINCT FROM OLD.evidence_ref OR NEW.ip_hash IS DISTINCT FROM OLD.ip_hash THEN
    RAISE EXCEPTION 'admissions.consent_immutable: seul le retrait d''un consentement est permis' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.consent_already_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consents_guard BEFORE UPDATE OR DELETE ON admissions.consents
  FOR EACH ROW EXECUTE FUNCTION admissions.consents_guard();

-- Le consentement est donné par un tuteur HABILITÉ (can_consent).
CREATE FUNCTION admissions.consents_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admissions.application_guardians g
                  WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.guardian_id AND g.can_consent) THEN
    RAISE EXCEPTION 'admissions.consent_guardian_not_entitled: ce tuteur n''est pas habilité à consentir' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consents_insert_guard BEFORE INSERT ON admissions.consents
  FOR EACH ROW EXECUTE FUNCTION admissions.consents_insert_guard();

-- -----------------------------------------------------------------------------
-- Pièces justificatives d'une candidature. Le stockage passe par le port `documents` (spec 024) ;
-- tant qu'il n'est pas livré, `storage_key` pointe le StoragePort. L'un OU l'autre est exigé.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.application_documents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id  uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  status          text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  document_ref    uuid,                                  -- documents.documents.id (sans FK)
  storage_key     text,
  content_type    text,
  size_bytes      bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  sha256          text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  rejection_reason text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, requirement_id),
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) > 0),
  CHECK (status NOT IN ('ACCEPTED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id),
  FOREIGN KEY (tenant_id, requirement_id) REFERENCES admissions.document_requirements (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.application_documents');
GRANT SELECT, INSERT, UPDATE ON admissions.application_documents TO app_user;

-- Codes des pièces EXIGÉES encore non acceptées (applicabilité : établissement, niveau, financement).
CREATE FUNCTION admissions.missing_required_documents(p_application uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(r.code ORDER BY r.sort_order, r.code), ARRAY[]::text[])
    FROM admissions.applications a
    JOIN admissions.document_requirements r
      ON r.tenant_id = a.tenant_id AND r.institution_id = a.institution_id AND r.active AND r.required
     AND (r.grade_level_code IS NULL OR r.grade_level_code = a.desired_grade_level_code)
     AND (r.applies_to_funding IS NULL OR r.applies_to_funding = a.funding_type_requested)
    LEFT JOIN admissions.application_documents d
      ON d.tenant_id = a.tenant_id AND d.application_id = a.id AND d.requirement_id = r.id
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.id = p_application
     AND (d.id IS NULL OR d.status <> 'ACCEPTED')
$$;
GRANT EXECUTE ON FUNCTION admissions.missing_required_documents(uuid) TO app_user;

-- Consentement valide : un tuteur habilité a donné DATA_PROCESSING et ne l'a pas retiré.
CREATE FUNCTION admissions.has_valid_consent(p_application uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM admissions.consents c
     WHERE c.tenant_id = kernel.current_tenant_id() AND c.application_id = p_application
       AND c.kind = 'DATA_PROCESSING' AND c.withdrawn_at IS NULL)
$$;
GRANT EXECUTE ON FUNCTION admissions.has_valid_consent(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Tests et entretiens (facultatifs). Aucun seuil de réussite : le résultat est SAISI par l'examinateur.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.interviews (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id            uuid NOT NULL,
  kind                      text NOT NULL CHECK (kind IN ('TEST', 'INTERVIEW')),
  scheduled_at              timestamptz NOT NULL,
  venue                     text,
  status                    text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED')),
  conducted_by_staff_id     uuid,
  score                     numeric(7, 3) CHECK (score IS NULL OR score >= 0),
  scale_max                 numeric(7, 3) CHECK (scale_max IS NULL OR scale_max > 0),
  result_code               text CHECK (result_code IN ('PASSED', 'FAILED', 'NOT_APPLICABLE')),
  notes                     text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (score IS NULL OR (scale_max IS NOT NULL AND score <= scale_max)),
  CHECK (status <> 'DONE' OR result_code IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.interviews');
CREATE INDEX interviews_by_application ON admissions.interviews (tenant_id, application_id, scheduled_at);
GRANT SELECT, INSERT, UPDATE ON admissions.interviews TO app_user;

-- -----------------------------------------------------------------------------
-- Offres d'admission : une offre en attente au plus par candidature
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.offers (
  id                          uuid PRIMARY KEY,
  tenant_id                   uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id              uuid NOT NULL,
  status                      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')),
  grade_level_code            text NOT NULL,
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  responded_at                timestamptz,
  responded_by_guardian_id    uuid,
  conditions                  text CHECK (conditions IS NULL OR length(conditions) <= 2000),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (expires_at > issued_at),
  CHECK (status NOT IN ('ACCEPTED', 'DECLINED') OR (responded_at IS NOT NULL AND responded_by_guardian_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.offers');
CREATE UNIQUE INDEX offers_one_pending ON admissions.offers (tenant_id, application_id) WHERE status = 'PENDING';
CREATE INDEX offers_to_expire ON admissions.offers (tenant_id, expires_at) WHERE status = 'PENDING';
GRANT SELECT, INSERT, UPDATE ON admissions.offers TO app_user;

-- -----------------------------------------------------------------------------
-- Journal des DÉCISIONS (formelles) et journal des TRANSITIONS (techniques) : ajout seul.
-- Une décision est insérée AVANT le changement d'étape, dans la même transaction (`xid`) ; le
-- déclencheur de la candidature refuse l'entrée dans une étape « à décision » sans elle.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.decisions (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id   uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('ACCEPT', 'REJECT', 'WAITLIST', 'WITHDRAW', 'RECONSIDER')),
  from_stage_id    uuid NOT NULL,
  to_stage_id      uuid NOT NULL,
  reason_code      text,
  reason_text      text CHECK (reason_text IS NULL OR length(reason_text) <= 2000),
  conditions       text CHECK (conditions IS NULL OR length(conditions) <= 2000),
  offer_id         uuid,
  override_capacity boolean NOT NULL DEFAULT false,
  decided_by       uuid NOT NULL,
  decided_by_name  text NOT NULL CHECK (length(btrim(decided_by_name)) > 0),   -- identité FIGÉE au moment de l'acte
  decided_at       timestamptz NOT NULL DEFAULT now(),
  xid              bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (kind NOT IN ('REJECT', 'WITHDRAW') OR reason_code IS NOT NULL),
  CHECK (NOT override_capacity OR length(btrim(coalesce(reason_text, ''))) >= 10),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.decisions');
CREATE INDEX decisions_by_application ON admissions.decisions (tenant_id, application_id, decided_at);
GRANT SELECT, INSERT ON admissions.decisions TO app_user;
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON admissions.decisions
  FOR EACH ROW EXECUTE FUNCTION admissions.forbid_mutation();

CREATE TABLE admissions.transitions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id uuid NOT NULL,
  from_stage_id  uuid,
  to_stage_id    uuid NOT NULL,
  from_status    text,
  to_status      text NOT NULL,
  actor_id       uuid,
  actor_kind     text NOT NULL DEFAULT 'USER' CHECK (actor_kind IN ('USER', 'SYSTEM', 'APPLICANT')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.transitions');
CREATE INDEX transitions_by_application ON admissions.transitions (tenant_id, application_id, occurred_at);
GRANT SELECT, INSERT ON admissions.transitions TO app_user;
CREATE TRIGGER transitions_append_only BEFORE UPDATE OR DELETE ON admissions.transitions
  FOR EACH ROW EXECUTE FUNCTION admissions.forbid_mutation();

-- Doublons détectés (candidatures, élèves existants, prospects)
CREATE TABLE admissions.duplicate_candidates (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id uuid NOT NULL,
  matched_kind   text NOT NULL CHECK (matched_kind IN ('APPLICATION', 'STUDENT', 'PROSPECT')),
  matched_id     uuid NOT NULL,
  score          smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons        text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED_DUPLICATE', 'DISMISSED')),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, matched_kind, matched_id),
  CHECK (status = 'OPEN' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.duplicate_candidates');
GRANT SELECT, INSERT, UPDATE ON admissions.duplicate_candidates TO app_user;

-- Journal d'envoi des notifications aux familles (canal, gabarit, résultat) : idempotence par `dedupe_key`.
-- L'adresse du destinataire n'est PAS stockée (résolue au moment de l'envoi depuis le tuteur).
CREATE TABLE admissions.notification_log (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id   uuid NOT NULL,
  guardian_id      uuid,
  channel          text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'IN_APP')),
  template_code    text NOT NULL CHECK (template_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  dedupe_key       text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 120),
  status           text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  provider_ref     text,
  error_code       text,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, template_code, dedupe_key),
  CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.notification_log');
GRANT SELECT, INSERT, UPDATE ON admissions.notification_log TO app_user;

-- =============================================================================
-- Garde centrale : passage d'une candidature d'une étape à une autre
-- =============================================================================
CREATE FUNCTION admissions.applications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_stage     admissions.workflow_stages%ROWTYPE;
  v_from      admissions.workflow_stages%ROWTYPE;
  v_camp      admissions.campaigns%ROWTYPE;
  v_set       admissions.settings%ROWTYPE;
  v_cap       admissions.intake_capacities%ROWTYPE;
  v_taken     integer;
  v_wait      integer;
  v_missing   text[];
BEGIN
  SELECT * INTO v_camp FROM admissions.campaigns c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.campaign_id;
  IF v_camp.institution_id <> NEW.institution_id OR v_camp.workflow_id <> NEW.workflow_id THEN
    RAISE EXCEPTION 'admissions.application_campaign_mismatch: l''établissement et le workflow doivent être ceux de la campagne' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_stage FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.stage_id;
  SELECT * INTO v_set FROM admissions.settings st WHERE st.tenant_id = NEW.tenant_id AND st.institution_id = NEW.institution_id;
  -- valeurs par défaut du paramétrage si l'établissement n'a pas encore de ligne
  IF NOT FOUND THEN
    v_set.capacity_policy := 'HARD'; v_set.duplicate_policy := 'WARN'; v_set.consent_required := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_stage.is_initial THEN
      RAISE EXCEPTION 'admissions.application_initial_stage: une candidature naît à l''étape initiale du workflow' USING ERRCODE = 'check_violation';
    END IF;
    IF v_camp.status NOT IN ('OPEN', 'DRAFT') THEN
      RAISE EXCEPTION 'admissions.campaign_closed: la campagne est % ; aucun dossier ne peut être créé', v_camp.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := v_stage.canonical_status;
    RETURN NEW;
  END IF;

  -- ---------------------------------------------------------------- UPDATE
  IF NEW.institution_id <> OLD.institution_id OR NEW.campaign_id <> OLD.campaign_id
     OR NEW.workflow_id <> OLD.workflow_id OR NEW.application_number <> OLD.application_number THEN
    RAISE EXCEPTION 'admissions.application_identity_immutable: établissement, campagne, workflow et numéro sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.student_id IS NOT NULL AND (
       NEW.applicant_first_name <> OLD.applicant_first_name OR NEW.applicant_last_name <> OLD.applicant_last_name
       OR NEW.applicant_birth_date <> OLD.applicant_birth_date OR NEW.desired_grade_level_code <> OLD.desired_grade_level_code
       OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
    RAISE EXCEPTION 'admissions.application_frozen_after_enrollment: l''identité est portée par le dossier de l''élève (people) une fois créé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.enrolled_at IS NOT NULL AND NEW.status <> 'ENROLLED' THEN
    RAISE EXCEPTION 'admissions.application_enrolled_final: une candidature inscrite ne change plus d''étape' USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();

  IF NEW.stage_id <> OLD.stage_id THEN
    SELECT * INTO v_from FROM admissions.workflow_stages s WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.stage_id;
    IF NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                    WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.workflow_id
                      AND t.from_stage_id = OLD.stage_id AND t.to_stage_id = NEW.stage_id) THEN
      RAISE EXCEPTION 'admissions.transition_not_allowed: le passage de % à % n''est pas déclaré dans le workflow', v_from.code, v_stage.code USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.status := v_stage.canonical_status;

    IF v_stage.requires_consent AND v_set.consent_required AND NOT admissions.has_valid_consent(NEW.id) THEN
      RAISE EXCEPTION 'admissions.consent_missing: le consentement parental est requis avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage.requires_documents_complete THEN
      v_missing := admissions.missing_required_documents(NEW.id);
      IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'admissions.documents_incomplete: pièces non acceptées : %', array_to_string(v_missing, ', ') USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF v_stage.requires_interview_done AND NOT EXISTS (
         SELECT 1 FROM admissions.interviews i WHERE i.tenant_id = NEW.tenant_id AND i.application_id = NEW.id AND i.status = 'DONE') THEN
      RAISE EXCEPTION 'admissions.interview_missing: un test ou un entretien terminé est requis avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage.requires_decision THEN
      IF NOT EXISTS (SELECT 1 FROM admissions.decisions d
                      WHERE d.tenant_id = NEW.tenant_id AND d.application_id = NEW.id
                        AND d.from_stage_id = OLD.stage_id AND d.to_stage_id = NEW.stage_id AND d.xid = txid_current()) THEN
        RAISE EXCEPTION 'admissions.decision_missing: l''étape % exige une décision formelle journalisée dans la même transaction', v_stage.code USING ERRCODE = 'check_violation';
      END IF;
      NEW.decided_at := now();
    END IF;
    IF v_stage.creates_enrollment THEN
      IF NEW.student_id IS NULL OR NEW.enrollment_id IS NULL THEN
        RAISE EXCEPTION 'admissions.enrollment_missing: l''élève et l''inscription doivent être créés avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
      END IF;
      IF v_set.duplicate_policy = 'BLOCK' AND EXISTS (
           SELECT 1 FROM admissions.duplicate_candidates d WHERE d.tenant_id = NEW.tenant_id AND d.application_id = NEW.id AND d.status = 'OPEN') THEN
        RAISE EXCEPTION 'admissions.duplicates_pending: un doublon possible doit être tranché avant l''inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- capacité : entrée dans une étape qui RÉSERVE une place (la ligne de capacité est verrouillée : sérialise les concurrents)
    IF v_stage.holds_seat AND NOT v_from.holds_seat AND v_set.capacity_policy <> 'NONE' THEN
      SELECT * INTO v_cap FROM admissions.intake_capacities c
       WHERE c.tenant_id = NEW.tenant_id AND c.campaign_id = NEW.campaign_id AND c.grade_level_code = NEW.desired_grade_level_code
         AND (c.program_id IS NOT DISTINCT FROM NEW.desired_program_id OR c.program_id IS NULL)
       ORDER BY (c.program_id IS NULL) ASC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        SELECT count(*) INTO v_taken
          FROM admissions.applications a
          JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
         WHERE a.tenant_id = NEW.tenant_id AND a.campaign_id = NEW.campaign_id AND a.desired_grade_level_code = NEW.desired_grade_level_code
           AND (v_cap.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM v_cap.program_id)
           AND a.id <> NEW.id AND s.holds_seat;
        IF v_taken >= v_cap.seats THEN
          IF v_set.capacity_policy = 'HARD' THEN
            RAISE EXCEPTION 'admissions.capacity_full: % places occupées pour % (niveau %)', v_taken, v_cap.seats, NEW.desired_grade_level_code USING ERRCODE = 'check_violation';
          ELSIF length(btrim(coalesce(NEW.capacity_override_reason, ''))) < 10 THEN
            RAISE EXCEPTION 'admissions.capacity_override_reason: un dépassement de capacité exige un motif d''au moins 10 caractères' USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END IF;
    END IF;

    -- liste d'attente : horodatage d'entrée et plafond éventuel
    IF NEW.status = 'WAITLISTED' AND OLD.status <> 'WAITLISTED' THEN
      NEW.waitlist_entered_at := now();
      SELECT * INTO v_cap FROM admissions.intake_capacities c
       WHERE c.tenant_id = NEW.tenant_id AND c.campaign_id = NEW.campaign_id AND c.grade_level_code = NEW.desired_grade_level_code
         AND (c.program_id IS NOT DISTINCT FROM NEW.desired_program_id OR c.program_id IS NULL)
       ORDER BY (c.program_id IS NULL) ASC LIMIT 1 FOR UPDATE;
      IF FOUND AND v_cap.waitlist_limit IS NOT NULL THEN
        SELECT count(*) INTO v_wait FROM admissions.applications a
         WHERE a.tenant_id = NEW.tenant_id AND a.campaign_id = NEW.campaign_id
           AND a.desired_grade_level_code = NEW.desired_grade_level_code AND a.status = 'WAITLISTED' AND a.id <> NEW.id;
        IF v_wait >= v_cap.waitlist_limit THEN
          RAISE EXCEPTION 'admissions.waitlist_full: la liste d''attente compte déjà % dossiers (plafond %)', v_wait, v_cap.waitlist_limit USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;

    IF NEW.status <> 'DRAFT' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF v_stage.canonical_status = 'ENROLLED' THEN
      NEW.enrolled_at := coalesce(NEW.enrolled_at, now());
    END IF;
    IF v_stage.is_terminal THEN NEW.closed_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_guard BEFORE INSERT OR UPDATE ON admissions.applications
  FOR EACH ROW EXECUTE FUNCTION admissions.applications_guard();

-- Journal automatique des transitions (création comprise) : complet quel que soit le code appelant.
CREATE FUNCTION admissions.applications_log_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id <> OLD.stage_id THEN
    INSERT INTO admissions.transitions (id, tenant_id, application_id, from_stage_id, to_stage_id, from_status, to_status, actor_id, actor_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END, NEW.stage_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            kernel.current_user_id(),
            CASE WHEN kernel.current_user_id() IS NULL THEN 'SYSTEM' ELSE 'USER' END);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER applications_log_transition AFTER INSERT OR UPDATE ON admissions.applications
  FOR EACH ROW EXECUTE FUNCTION admissions.applications_log_transition();

-- Garde des décisions : l'étape de départ est l'étape COURANTE du dossier, la transition existe, le type de
-- décision correspond au statut canonique visé ; un refus / retrait cite son motif (si la table des motifs existe).
CREATE FUNCTION admissions.decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_app  admissions.applications%ROWTYPE;
  v_to   admissions.workflow_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM admissions.applications a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id;
  IF v_app.stage_id <> NEW.from_stage_id THEN
    RAISE EXCEPTION 'admissions.decision_stale: la décision part d''une étape qui n''est plus l''étape courante du dossier' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                  WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = v_app.workflow_id
                    AND t.from_stage_id = NEW.from_stage_id AND t.to_stage_id = NEW.to_stage_id) THEN
    RAISE EXCEPTION 'admissions.transition_not_allowed: transition non déclarée dans le workflow' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_to FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.to_stage_id;
  IF NOT ((NEW.kind = 'ACCEPT'     AND v_to.canonical_status = 'ACCEPTED')
       OR (NEW.kind = 'REJECT'     AND v_to.canonical_status = 'REJECTED' AND v_to.closure_kind IS NOT DISTINCT FROM 'REJECTED_BY_SCHOOL')
       OR (NEW.kind = 'WAITLIST'   AND v_to.canonical_status = 'WAITLISTED')
       OR (NEW.kind = 'WITHDRAW'   AND v_to.canonical_status = 'REJECTED' AND v_to.closure_kind IN ('WITHDRAWN_BY_FAMILY', 'OFFER_EXPIRED', 'NO_SHOW', 'DUPLICATE'))
       OR (NEW.kind = 'RECONSIDER' AND v_to.canonical_status IN ('SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT'))) THEN
    RAISE EXCEPTION 'admissions.decision_kind_mismatch: le type de décision % ne correspond pas à l''étape visée (%)', NEW.kind, v_to.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_guard BEFORE INSERT ON admissions.decisions
  FOR EACH ROW EXECUTE FUNCTION admissions.decisions_guard();

-- -----------------------------------------------------------------------------
-- Liste d'attente : ordre = classe de priorité (rang croissant), puis date d'entrée, puis identifiant.
-- Lue sous la RLS de l'appelant. Une priorité absente passe après toutes les classes déclarées.
-- -----------------------------------------------------------------------------
CREATE FUNCTION admissions.waitlist_order(p_campaign uuid, p_grade text)
RETURNS TABLE (queue_position integer, application_id uuid, priority_rank integer, waitlist_entered_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT (row_number() OVER (ORDER BY coalesce(pc.rank, 2147483647), a.waitlist_entered_at, a.id))::integer,
         a.id, coalesce(pc.rank, 2147483647), a.waitlist_entered_at
    FROM admissions.applications a
    LEFT JOIN admissions.priority_classes pc
      ON pc.tenant_id = a.tenant_id AND pc.institution_id = a.institution_id AND pc.code = a.priority_class_code AND pc.active
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.campaign_id = p_campaign
     AND a.desired_grade_level_code = p_grade AND a.status = 'WAITLISTED'
   ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION admissions.waitlist_order(uuid, text) TO app_user;

-- Places restantes pour un niveau : capacité − dossiers qui réservent une place (NULL si aucun plafond).
CREATE FUNCTION admissions.seats_left(p_campaign uuid, p_grade text, p_program uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT c.seats - (SELECT count(*)::integer
                      FROM admissions.applications a
                      JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
                     WHERE a.tenant_id = c.tenant_id AND a.campaign_id = c.campaign_id AND a.desired_grade_level_code = c.grade_level_code
                       AND (c.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM c.program_id) AND s.holds_seat)
    FROM admissions.intake_capacities c
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.campaign_id = p_campaign AND c.grade_level_code = p_grade
     AND (c.program_id IS NOT DISTINCT FROM p_program OR c.program_id IS NULL)
   ORDER BY (c.program_id IS NULL) ASC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION admissions.seats_left(uuid, text, uuid) TO app_user;
