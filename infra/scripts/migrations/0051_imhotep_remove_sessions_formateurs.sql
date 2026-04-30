-- Migration 0051: Imhotep Data (base tables) — catalogue par formation sans sessions ni formateurs
-- Les tables *_aspci (ASPCI) ne sont pas modifiées.
-- Hypothèse: seul le tenant Imhotep Data utilise les tables « base » du module pro.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Capacité session / triggers sur inscriptions (base)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_insert ON inscriptions_professionnelles;
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_update ON inscriptions_professionnelles;
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_delete ON inscriptions_professionnelles;
DROP FUNCTION IF EXISTS update_session_capacity_on_enrollment_change();

-- ---------------------------------------------------------------------------
-- 2) Tables dépendantes des sessions / formateurs (base)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS session_attendance CASCADE;
DROP TABLE IF EXISTS support_session_associations CASCADE;

DROP TABLE IF EXISTS notifications_formateurs CASCADE;
DROP TABLE IF EXISTS formateur_indisponibilites CASCADE;
DROP TABLE IF EXISTS session_formateurs CASCADE;

-- ---------------------------------------------------------------------------
-- 3) support_telechargements : lier à la formation, retirer session
-- ---------------------------------------------------------------------------
ALTER TABLE support_telechargements
  ADD COLUMN IF NOT EXISTS formation_pro_id UUID REFERENCES formations_professionnelles(id) ON DELETE SET NULL;

UPDATE support_telechargements st
SET formation_pro_id = sp.formation_pro_id
FROM sessions_professionnelles sp
WHERE st.session_id IS NOT NULL AND sp.id = st.session_id;

ALTER TABLE support_telechargements DROP CONSTRAINT IF EXISTS support_telechargements_session_id_fkey;
DROP INDEX IF EXISTS idx_support_telechargements_session_id;
ALTER TABLE support_telechargements DROP COLUMN IF EXISTS session_id;

CREATE INDEX IF NOT EXISTS idx_support_telechargements_formation_pro_id
  ON support_telechargements(tenant_id, formation_pro_id);

-- ---------------------------------------------------------------------------
-- 4) documents : formation_pro_id, libérer session_id (FK) pour Imhotep
-- ---------------------------------------------------------------------------
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_session_id_fkey;
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS formation_pro_id UUID REFERENCES formations_professionnelles(id) ON DELETE SET NULL;

UPDATE documents d
SET formation_pro_id = s.formation_pro_id
FROM sessions_professionnelles s
WHERE d.session_id IS NOT NULL AND s.id = d.session_id;

UPDATE documents
SET session_id = NULL
WHERE tenant_id = 'e9f4c59f-0666-4dc7-a7d4-c63004000791'::uuid;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS check_document_relationship;
ALTER TABLE documents ADD CONSTRAINT check_document_relationship CHECK (
  inscription_id IS NOT NULL
  OR session_id IS NOT NULL
  OR entreprise_id IS NOT NULL
  OR formation_pro_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_formation_pro_id
  ON documents(tenant_id, formation_pro_id) WHERE formation_pro_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) reservations_temporaires : formation à la place de session
-- ---------------------------------------------------------------------------
ALTER TABLE reservations_temporaires
  ADD COLUMN IF NOT EXISTS formation_pro_id UUID REFERENCES formations_professionnelles(id) ON DELETE CASCADE;

UPDATE reservations_temporaires r
SET formation_pro_id = s.formation_pro_id
FROM sessions_professionnelles s
WHERE r.session_id IS NOT NULL AND s.id = r.session_id;

DELETE FROM reservations_temporaires WHERE formation_pro_id IS NULL;

ALTER TABLE reservations_temporaires DROP CONSTRAINT IF EXISTS reservations_temporaires_session_id_fkey;
DROP INDEX IF EXISTS idx_reservations_temporaires_session_id;
ALTER TABLE reservations_temporaires DROP COLUMN IF EXISTS session_id;

ALTER TABLE reservations_temporaires ALTER COLUMN formation_pro_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_formation_pro_id
  ON reservations_temporaires(tenant_id, formation_pro_id);

COMMENT ON TABLE reservations_temporaires IS 'Réservation temporaire (15 min) lors de l’achat d’une formation catalogue';

-- ---------------------------------------------------------------------------
-- 6) inscriptions_professionnelles : formation_pro_id obligatoire
-- ---------------------------------------------------------------------------
ALTER TABLE inscriptions_professionnelles
  ADD COLUMN IF NOT EXISTS formation_pro_id UUID REFERENCES formations_professionnelles(id) ON DELETE CASCADE;

UPDATE inscriptions_professionnelles i
SET formation_pro_id = s.formation_pro_id
FROM sessions_professionnelles s
WHERE i.session_id IS NOT NULL AND s.id = i.session_id;

DELETE FROM inscriptions_professionnelles WHERE formation_pro_id IS NULL;

ALTER TABLE inscriptions_professionnelles DROP CONSTRAINT IF EXISTS inscriptions_professionnelles_session_id_fkey;
DROP INDEX IF EXISTS idx_inscriptions_professionnelles_session_id;
ALTER TABLE inscriptions_professionnelles DROP COLUMN IF EXISTS session_id;

ALTER TABLE inscriptions_professionnelles ALTER COLUMN formation_pro_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_formation_pro_id
  ON inscriptions_professionnelles(tenant_id, formation_pro_id);

COMMENT ON TABLE inscriptions_professionnelles IS 'Inscriptions aux formations professionnelles (catalogue)';

-- ---------------------------------------------------------------------------
-- 7) supports_cours : un support par formation, sans formateur ni session
-- ---------------------------------------------------------------------------
UPDATE supports_cours sc
SET formation_id = s.formation_pro_id
FROM sessions_professionnelles s
WHERE sc.formation_id IS NULL AND sc.session_id IS NOT NULL AND s.id = sc.session_id;

DELETE FROM supports_cours a
USING supports_cours b
WHERE a.tenant_id = b.tenant_id
  AND a.formation_id = b.formation_id
  AND a.formation_id IS NOT NULL
  AND a.id < b.id;

DELETE FROM supports_cours WHERE formation_id IS NULL;

ALTER TABLE supports_cours DROP CONSTRAINT IF EXISTS supports_cours_formateur_id_fkey;
ALTER TABLE supports_cours DROP CONSTRAINT IF EXISTS supports_cours_session_id_fkey;
ALTER TABLE supports_cours DROP CONSTRAINT IF EXISTS supports_cours_check;

DROP INDEX IF EXISTS idx_supports_cours_formateur_id;
DROP INDEX IF EXISTS idx_supports_cours_session_id;

ALTER TABLE supports_cours DROP COLUMN IF EXISTS formateur_id;
ALTER TABLE supports_cours DROP COLUMN IF EXISTS session_id;

ALTER TABLE supports_cours ALTER COLUMN formation_id SET NOT NULL;

ALTER TABLE supports_cours ADD CONSTRAINT supports_cours_formation_required CHECK (formation_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_supports_cours_tenant_formation
  ON supports_cours(tenant_id, formation_id);

COMMENT ON TABLE supports_cours IS 'Support unique (PDF ou vidéo) rattaché à une formation catalogue';

-- ---------------------------------------------------------------------------
-- 8) Supprimer sessions et formateurs (base)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_session_code_trigger ON sessions_professionnelles;
DROP TRIGGER IF EXISTS update_sessions_professionnelles_updated_at ON sessions_professionnelles;
DROP TABLE IF EXISTS sessions_professionnelles CASCADE;

DROP TRIGGER IF EXISTS update_formateurs_updated_at ON formateurs;
DROP TABLE IF EXISTS formateurs CASCADE;

DROP FUNCTION IF EXISTS generate_session_code(UUID, UUID);
DROP FUNCTION IF EXISTS set_session_code();

COMMIT;
