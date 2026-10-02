-- =============================================================================
-- 2502 — Module documents : gardes d'immuabilité (versions, historique)
-- =============================================================================
-- ENABLE ALWAYS : actifs même pour le propriétaire des tables et sous session_replication_role = replica.

CREATE FUNCTION documents.guard_versions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'documents.versions : suppression interdite (versions immuables)' USING ERRCODE = '23000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.extension IS DISTINCT FROM OLD.extension
     OR NEW.detected_mime IS DISTINCT FROM OLD.detected_mime
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.scan_status IS DISTINCT FROM OLD.scan_status
     OR NEW.scan_engine IS DISTINCT FROM OLD.scan_engine
     OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'documents.versions : le contenu d''une version est immuable' USING ERRCODE = '23000';
  END IF;
  -- Le nom du fichier ne se masque qu'à la purge.
  IF NEW.file_name IS DISTINCT FROM OLD.file_name AND NEW.state <> 'PURGED' THEN
    RAISE EXCEPTION 'documents.versions : le nom de fichier est immuable' USING ERRCODE = '23000';
  END IF;
  IF OLD.state = 'PURGED' AND (NEW.state <> 'PURGED' OR NEW.purged_at IS DISTINCT FROM OLD.purged_at OR NEW.file_name IS DISTINCT FROM OLD.file_name) THEN
    RAISE EXCEPTION 'documents.versions : une version purgée ne change plus' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER versions_guard BEFORE UPDATE OR DELETE ON documents.versions
  FOR EACH ROW EXECUTE FUNCTION documents.guard_versions();
ALTER TABLE documents.versions ENABLE ALWAYS TRIGGER versions_guard;

CREATE FUNCTION documents.guard_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% : table en ajout seul (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER document_events_guard BEFORE UPDATE OR DELETE ON documents.document_events
  FOR EACH ROW EXECUTE FUNCTION documents.guard_append_only();
ALTER TABLE documents.document_events ENABLE ALWAYS TRIGGER document_events_guard;

CREATE TRIGGER versions_no_truncate BEFORE TRUNCATE ON documents.versions
  FOR EACH STATEMENT EXECUTE FUNCTION documents.guard_append_only();
ALTER TABLE documents.versions ENABLE ALWAYS TRIGGER versions_no_truncate;
CREATE TRIGGER document_events_no_truncate BEFORE TRUNCATE ON documents.document_events
  FOR EACH STATEMENT EXECUTE FUNCTION documents.guard_append_only();
ALTER TABLE documents.document_events ENABLE ALWAYS TRIGGER document_events_no_truncate;
