-- Migration 0056 — restore Formation Pro sessions & formateurs in the unified schema
--
-- Reverses migration 0051. After this migration:
--   * Every tenant (not just ASPCI) can use sessions, formateurs, and the
--     session-based catalogue.
--   * The previous "catalogue par formation only" path still works:
--     formation_pro_id columns and indexes added by 0051 are kept.
--   * Inscriptions and réservations may target either a session OR a formation
--     directly (both columns nullable; downstream code enforces the choice).
--
-- Source of truth for table/column/index/FK shapes: prisma baseline migration
-- (apps/api/prisma/migrations/20260403110000_baseline) plus migration 9999 for
-- the capacity trigger.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Recreate the dropped Pro tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS formateurs (
  id                UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id         UUID            NOT NULL,
  user_id           UUID,
  civilite          VARCHAR(20),
  nom               VARCHAR(100)    NOT NULL,
  prenom            VARCHAR(100)    NOT NULL,
  email             VARCHAR(255)    NOT NULL,
  telephone         VARCHAR(20),
  specialites       JSONB,
  bio               TEXT,
  cv_url            VARCHAR(500),
  photo_url         VARCHAR(500),
  linkedin_url      VARCHAR(500),
  tarif_journalier  DECIMAL(15,2),
  actif             BOOLEAN         DEFAULT true,
  initial_password  VARCHAR(255),
  created_at        TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT formateurs_pkey PRIMARY KEY (id),
  CONSTRAINT formateurs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT formateurs_user_id_fkey   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS formateurs_tenant_id_email_key ON formateurs(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_formateurs_actif       ON formateurs(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_formateurs_email       ON formateurs(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_formateurs_specialites ON formateurs USING GIN (specialites);
CREATE INDEX IF NOT EXISTS idx_formateurs_tenant_id   ON formateurs(tenant_id);

CREATE TABLE IF NOT EXISTS sessions_professionnelles (
  id                  UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id           UUID            NOT NULL,
  formation_pro_id    UUID            NOT NULL,
  code_session        VARCHAR(50),
  date_debut          DATE            NOT NULL,
  date_fin            DATE            NOT NULL,
  horaires            VARCHAR(100),
  mode_formation      delivery_mode   NOT NULL,
  lieu                VARCHAR(500),
  lien_visio          VARCHAR(500),
  places_totales      INTEGER         NOT NULL,
  places_reservees    INTEGER         DEFAULT 0,
  places_disponibles  INTEGER         GENERATED ALWAYS AS (places_totales - COALESCE(places_reservees, 0)) STORED,
  prix_ht             DECIMAL(15,2),
  prix_ttc            DECIMAL(15,2),
  statut              session_professional_status DEFAULT 'planifiee',
  notes_internes      TEXT,
  notes_formateur     TEXT,
  notes_updated_at    TIMESTAMPTZ(6),
  created_at          TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sessions_professionnelles_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_professionnelles_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT sessions_professionnelles_formation_pro_id_fkey
    FOREIGN KEY (formation_pro_id) REFERENCES formations_professionnelles(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_professionnelles_tenant_id_code_session_key
  ON sessions_professionnelles(tenant_id, code_session);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_code_session
  ON sessions_professionnelles(tenant_id, code_session);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_date_debut
  ON sessions_professionnelles(tenant_id, date_debut);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_formation_pro_id
  ON sessions_professionnelles(formation_pro_id);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_statut
  ON sessions_professionnelles(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_tenant_id
  ON sessions_professionnelles(tenant_id);

CREATE TABLE IF NOT EXISTS session_formateurs (
  id            UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID            NOT NULL,
  session_id    UUID            NOT NULL,
  formateur_id  UUID            NOT NULL,
  role          VARCHAR(50),
  created_at    TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT session_formateurs_pkey PRIMARY KEY (id),
  CONSTRAINT session_formateurs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT session_formateurs_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
  CONSTRAINT session_formateurs_formateur_id_fkey
    FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS session_formateurs_tenant_id_session_id_formateur_id_key
  ON session_formateurs(tenant_id, session_id, formateur_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_session_id   ON session_formateurs(session_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_formateur_id ON session_formateurs(formateur_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_tenant_id    ON session_formateurs(tenant_id);

CREATE TABLE IF NOT EXISTS formateur_indisponibilites (
  id            UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID            NOT NULL,
  formateur_id  UUID            NOT NULL,
  date_debut    DATE            NOT NULL,
  date_fin      DATE            NOT NULL,
  raison        TEXT,
  created_at    TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT formateur_indisponibilites_pkey PRIMARY KEY (id),
  CONSTRAINT formateur_indisponibilites_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT formateur_indisponibilites_formateur_id_fkey
    FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_dates
  ON formateur_indisponibilites(tenant_id, formateur_id, date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_formateur_id ON formateur_indisponibilites(formateur_id);
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_tenant_id    ON formateur_indisponibilites(tenant_id);

CREATE TABLE IF NOT EXISTS notifications_formateurs (
  id            UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID            NOT NULL,
  formateur_id  UUID            NOT NULL,
  type          VARCHAR(50)     NOT NULL,
  titre         VARCHAR(255)    NOT NULL,
  message       TEXT,
  metadata      JSONB,
  lue           BOOLEAN         DEFAULT false,
  lue_at        TIMESTAMPTZ(6),
  created_at    TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_formateurs_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_formateurs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT notifications_formateurs_formateur_id_fkey
    FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_created_at
  ON notifications_formateurs(tenant_id, formateur_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_lue
  ON notifications_formateurs(tenant_id, formateur_id, lue);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_formateur_id
  ON notifications_formateurs(formateur_id);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_tenant_id
  ON notifications_formateurs(tenant_id);

CREATE TABLE IF NOT EXISTS session_attendance (
  id              UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id       UUID            NOT NULL,
  session_id      UUID            NOT NULL,
  inscription_id  UUID            NOT NULL,
  present         BOOLEAN         NOT NULL,
  marked_by       UUID            NOT NULL,
  marked_at       TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT session_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT session_attendance_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT session_attendance_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
  CONSTRAINT session_attendance_inscription_id_fkey
    FOREIGN KEY (inscription_id) REFERENCES inscriptions_professionnelles(id) ON DELETE CASCADE,
  CONSTRAINT session_attendance_marked_by_fkey
    FOREIGN KEY (marked_by) REFERENCES formateurs(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_session_inscription
  ON session_attendance(tenant_id, session_id, inscription_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_session_id     ON session_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_inscription_id ON session_attendance(inscription_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_marked_by      ON session_attendance(marked_by);
CREATE INDEX IF NOT EXISTS idx_session_attendance_tenant_id      ON session_attendance(tenant_id);

CREATE TABLE IF NOT EXISTS support_session_associations (
  id          UUID            NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id   UUID            NOT NULL,
  support_id  UUID            NOT NULL,
  session_id  UUID            NOT NULL,
  created_at  TIMESTAMPTZ(6)  DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT support_session_associations_pkey PRIMARY KEY (id),
  CONSTRAINT support_session_associations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT support_session_associations_support_id_fkey
    FOREIGN KEY (support_id) REFERENCES supports_cours(id) ON DELETE CASCADE,
  CONSTRAINT support_session_associations_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_support_session
  ON support_session_associations(tenant_id, support_id, session_id);
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_support_id ON support_session_associations(support_id);
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_session_id ON support_session_associations(session_id);
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_tenant_id  ON support_session_associations(tenant_id);

-- ---------------------------------------------------------------------------
-- 2) Re-add session_id columns and FKs on tables that 0051 stripped
-- ---------------------------------------------------------------------------

ALTER TABLE inscriptions_professionnelles
  ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE inscriptions_professionnelles
  DROP CONSTRAINT IF EXISTS inscriptions_professionnelles_session_id_fkey;
ALTER TABLE inscriptions_professionnelles
  ADD CONSTRAINT inscriptions_professionnelles_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_session_id
  ON inscriptions_professionnelles(tenant_id, session_id);
ALTER TABLE inscriptions_professionnelles
  ALTER COLUMN formation_pro_id DROP NOT NULL;

ALTER TABLE reservations_temporaires
  ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE reservations_temporaires
  DROP CONSTRAINT IF EXISTS reservations_temporaires_session_id_fkey;
ALTER TABLE reservations_temporaires
  ADD CONSTRAINT reservations_temporaires_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_session_id
  ON reservations_temporaires(tenant_id, session_id);
ALTER TABLE reservations_temporaires
  ALTER COLUMN formation_pro_id DROP NOT NULL;

ALTER TABLE support_telechargements
  ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE support_telechargements
  DROP CONSTRAINT IF EXISTS support_telechargements_session_id_fkey;
ALTER TABLE support_telechargements
  ADD CONSTRAINT support_telechargements_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_telechargements_session_id
  ON support_telechargements(tenant_id, session_id);

-- ---------------------------------------------------------------------------
-- 3) supports_cours: re-attach formateur/session FKs (columns survived 0051)
--    Make formateur_id nullable so formation-only supports remain valid, and
--    drop the 0051 unique-per-formation constraint so a formation can have
--    several supports again (one per session).
-- ---------------------------------------------------------------------------

ALTER TABLE supports_cours
  ALTER COLUMN formateur_id DROP NOT NULL;

DROP INDEX IF EXISTS uniq_supports_cours_tenant_formation;
ALTER TABLE supports_cours DROP CONSTRAINT IF EXISTS supports_cours_formation_required;

-- Clear orphan FK values left behind when 0051 dropped the parent tables.
UPDATE supports_cours
   SET formateur_id = NULL
 WHERE formateur_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM formateurs f WHERE f.id = supports_cours.formateur_id);

UPDATE supports_cours
   SET session_id = NULL
 WHERE session_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sessions_professionnelles s WHERE s.id = supports_cours.session_id);

ALTER TABLE supports_cours
  DROP CONSTRAINT IF EXISTS supports_cours_formateur_id_fkey;
ALTER TABLE supports_cours
  ADD CONSTRAINT supports_cours_formateur_id_fkey
    FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE;

ALTER TABLE supports_cours
  DROP CONSTRAINT IF EXISTS supports_cours_session_id_fkey;
ALTER TABLE supports_cours
  ADD CONSTRAINT supports_cours_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) documents.session_id: re-attach FK to sessions_professionnelles
-- ---------------------------------------------------------------------------

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_session_id_fkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5) Functions and triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_session_code(tenant_uuid UUID, formation_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  year_suffix  VARCHAR(4);
  sequence_num INTEGER;
BEGIN
  year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
  SELECT COALESCE(MAX(CAST(SUBSTRING(code_session FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM sessions_professionnelles
   WHERE tenant_id = tenant_uuid
     AND code_session LIKE 'SES-' || year_suffix || '-%';
  RETURN 'SES-' || year_suffix || '-' || LPAD(sequence_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_session_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code_session IS NULL OR NEW.code_session = '' THEN
    NEW.code_session := generate_session_code(NEW.tenant_id, NEW.formation_pro_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_session_code_trigger ON sessions_professionnelles;
CREATE TRIGGER set_session_code_trigger
  BEFORE INSERT ON sessions_professionnelles
  FOR EACH ROW EXECUTE FUNCTION set_session_code();

DROP TRIGGER IF EXISTS update_sessions_professionnelles_updated_at ON sessions_professionnelles;
CREATE TRIGGER update_sessions_professionnelles_updated_at
  BEFORE UPDATE ON sessions_professionnelles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_formateurs_updated_at ON formateurs;
CREATE TRIGGER update_formateurs_updated_at
  BEFORE UPDATE ON formateurs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_session_capacity_on_enrollment_change()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id        UUID;
  v_tenant_id         UUID;
  v_places_reservees  INTEGER;
  v_places_totales    INTEGER;
  v_places_disponibles INTEGER;
  v_new_statut        session_professional_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_session_id := OLD.session_id;
    v_tenant_id  := OLD.tenant_id;
  ELSE
    v_session_id := NEW.session_id;
    v_tenant_id  := NEW.tenant_id;
  END IF;

  IF v_session_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*)::integer
    INTO v_places_reservees
    FROM inscriptions_professionnelles
   WHERE session_id = v_session_id
     AND tenant_id  = v_tenant_id
     AND statut     = 'confirmee';

  SELECT places_totales, statut
    INTO v_places_totales, v_new_statut
    FROM sessions_professionnelles
   WHERE id = v_session_id AND tenant_id = v_tenant_id;

  v_places_disponibles := GREATEST(0, COALESCE(v_places_totales, 0) - v_places_reservees);

  IF v_places_disponibles = 0 AND COALESCE(v_places_totales, 0) > 0 THEN
    IF v_new_statut = 'ouverte' THEN
      v_new_statut := 'complete';
    END IF;
  ELSIF v_places_disponibles > 0 AND v_new_statut = 'complete' THEN
    v_new_statut := 'ouverte';
  END IF;

  UPDATE sessions_professionnelles
     SET places_reservees = v_places_reservees,
         statut           = v_new_statut,
         updated_at       = NOW()
   WHERE id = v_session_id AND tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_insert ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_insert
  AFTER INSERT ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (NEW.statut = 'confirmee' AND NEW.session_id IS NOT NULL)
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_update ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_update
  AFTER UPDATE ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut OR OLD.session_id IS DISTINCT FROM NEW.session_id)
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_delete ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_delete
  AFTER DELETE ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (OLD.session_id IS NOT NULL)
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

COMMIT;
