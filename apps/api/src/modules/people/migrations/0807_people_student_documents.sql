-- =============================================================================
-- 0807 — Module people (spec 008 AC7.1-7.2) : PIÈCES de l'élève (pièce d'identité, acte de naissance, certificats…)
-- =============================================================================
--
-- Le FICHIER vit dans le stockage objet (`StoragePort`) ; la base ne garde que ses métadonnées et son empreinte SHA-256.
--   - le type réel est vérifié par octets magiques (PDF, JPEG, PNG, WebP), jamais par l'extension ni le type déclaré ;
--   - le contenu d'une pièce est IMMUABLE : remplacer = déposer une nouvelle version (`supersedes_id`), l'ancienne passe
--     `REPLACED` (conservée pour l'historique, lisible des seuls habilités) ; retirer = `REMOVED` motivé, jamais de DELETE ;
--   - au plus une pièce ACTIVE par type (sauf `OTHER`) : une seconde se dépose en REMPLAÇANT la première ;
--   - l'expiration (`expires_on`) est une donnée : l'état « bientôt / expirée » se DÉRIVE à la lecture, `expiry_alerted_for`
--     mémorise la date déjà signalée (une alerte `people.student_document.expiring` par franchissement de seuil).
-- =============================================================================

CREATE TABLE people.student_documents (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id         uuid NOT NULL,
  type_code          text NOT NULL CHECK (type_code IN ('ID_CARD', 'BIRTH_CERTIFICATE', 'MEDICAL_CERTIFICATE', 'PRIOR_REPORT', 'TRANSFER_CERTIFICATE', 'PHOTO_ID', 'OTHER')),
  title              text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200),
  file_name          text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  content_type       text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes         integer NOT NULL CHECK (size_bytes > 0),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  object_key         text NOT NULL CHECK (length(object_key) BETWEEN 10 AND 400),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id      uuid,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REPLACED', 'REMOVED')),
  issued_on          date,
  expires_on         date,
  expiry_alerted_for date,
  uploaded_by        uuid,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  replaced_at        timestamptz,
  removed_at         timestamptz,
  removed_reason     text,
  UNIQUE (tenant_id, id),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
  CHECK (status <> 'REMOVED' OR (removed_at IS NOT NULL AND length(btrim(coalesce(removed_reason, ''))) > 0)),
  CHECK (status <> 'REPLACED' OR replaced_at IS NOT NULL),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES people.student_documents (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.student_documents');
CREATE INDEX student_documents_by_student ON people.student_documents (tenant_id, student_id, status, type_code);
CREATE INDEX student_documents_expiring ON people.student_documents (tenant_id, expires_on) WHERE status = 'ACTIVE' AND expires_on IS NOT NULL;
-- Une seule pièce ACTIVE par type (hors « autre ») : la seconde remplace la première.
CREATE UNIQUE INDEX student_documents_one_active_per_type ON people.student_documents (tenant_id, student_id, type_code) WHERE status = 'ACTIVE' AND type_code <> 'OTHER';
GRANT SELECT, INSERT, UPDATE ON people.student_documents TO app_user;   -- jamais DELETE

-- Contenu immuable ; statut : ACTIVE -> REPLACED | REMOVED, REPLACED -> REMOVED (anonymisation), REMOVED terminal.
-- Seules les MÉTADONNÉES (titre, nom affiché, dates, alerte) restent modifiables.
CREATE FUNCTION people.student_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.student_id <> OLD.student_id OR NEW.type_code <> OLD.type_code
     OR NEW.content_type <> OLD.content_type OR NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256
     OR NEW.object_key <> OLD.object_key OR NEW.version <> OLD.version OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.uploaded_at <> OLD.uploaded_at THEN
    RAISE EXCEPTION 'people.document_immutable: le contenu d''une pièce ne change pas : déposez une nouvelle version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'ACTIVE' AND NEW.status IN ('REPLACED', 'REMOVED')) OR
       (OLD.status = 'REPLACED' AND NEW.status = 'REMOVED')) THEN
    RAISE EXCEPTION 'people.document_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- Une pièce retirée ne change plus (sauf l'effacement du titre et du nom, par l'anonymisation du dossier).
  IF OLD.status = 'REMOVED' AND (NEW.issued_on IS DISTINCT FROM OLD.issued_on OR NEW.expires_on IS DISTINCT FROM OLD.expires_on) THEN
    RAISE EXCEPTION 'people.document_transition: une pièce retirée ne se modifie plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_documents_guard BEFORE UPDATE ON people.student_documents
  FOR EACH ROW EXECUTE FUNCTION people.student_documents_guard();
