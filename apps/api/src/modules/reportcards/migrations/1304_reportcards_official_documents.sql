-- =============================================================================
-- 1304 — Module reportcards : documents officiels d'AUTRES modules (reçus de paiement, bulletins de paie)
-- =============================================================================
--
-- Un document officiel d'un autre module (finance : RECEIPT ; payroll : PAYSLIP) est un instantané immuable fourni par le
-- module propriétaire (`snapshot` : son contenu figé + l'identité de l'établissement + la référence du gabarit ; `explain` :
-- le contexte d'impression, dérivé du contenu), scellé comme un bulletin : hash SHA-256 du JSON canonique (RECALCULÉ ici),
-- code de vérification opaque de 128 bits, signature Ed25519. Le PDF est rendu dans le worker, depuis cet instantané seul, et
-- stocké via `StoragePort`.
--
-- Un document est unique par (tenant, nature, source). Le contenu scellé, le code et la signature sont immuables (déclencheur,
-- même pour un superutilisateur) ; seul l'état de rendu évolue (PENDING -> RENDERING -> RENDERED | FAILED) ; jamais de DELETE.
-- La page publique de vérification (`verification_index`) accepte désormais la nature RECEIPT.
-- =============================================================================

ALTER TABLE reportcards.verification_index DROP CONSTRAINT verification_index_document_kind_check;
ALTER TABLE reportcards.verification_index ADD CONSTRAINT verification_index_document_kind_check
  CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP', 'RECEIPT'));
ALTER TABLE reportcards.platform_templates DROP CONSTRAINT platform_templates_document_kind_check;
ALTER TABLE reportcards.platform_templates ADD CONSTRAINT platform_templates_document_kind_check
  CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP', 'RECEIPT'));

CREATE TABLE reportcards.official_documents (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind      text NOT NULL CHECK (document_kind IN ('RECEIPT', 'PAYSLIP')),
  -- objet source dans le module propriétaire (reçu, bulletin de paie) : UUID SANS clé étrangère
  source_id          uuid NOT NULL,
  title              text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 200),
  template_key       text NOT NULL,
  template_version   integer NOT NULL CHECK (template_version >= 1),
  -- contenu figé et scellé
  snapshot           jsonb NOT NULL,
  explain            jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_hash      text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  verification_code  text NOT NULL UNIQUE CHECK (verification_code ~ '^[A-Z2-7]{26}$'),
  signing_key_id     text NOT NULL REFERENCES reportcards.signing_keys (key_id),
  signature          text NOT NULL,
  issued_at          timestamptz NOT NULL,
  requested_by       uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- rendu courant (seuls champs mutables)
  render_status      text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'RENDERING', 'RENDERED', 'FAILED')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         text,
  object_key         text,
  pdf_hash           text CHECK (pdf_hash IS NULL OR pdf_hash ~ '^[0-9a-f]{64}$'),
  size_bytes         bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  pages              integer CHECK (pages IS NULL OR pages >= 1),
  rendered_at        timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_kind, source_id),
  CHECK (render_status <> 'RENDERED' OR (object_key IS NOT NULL AND pdf_hash IS NOT NULL AND rendered_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('reportcards.official_documents');
GRANT SELECT, INSERT, UPDATE ON reportcards.official_documents TO app_user;

CREATE FUNCTION reportcards.official_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reportcards.immutable: official_documents est immuable (DELETE interdit)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- R-RC-09 : le hash est recalculé en SQL (JSON canonique, SHA-256) et doit égaler celui de l'application
    IF NEW.snapshot_hash IS DISTINCT FROM reportcards.canonical_hash(NEW.snapshot, NEW.explain) THEN
      RAISE EXCEPTION 'reportcards.hash_mismatch: le hash du document ne correspond pas à son contenu' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE : le contenu scellé ne bouge jamais
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.document_kind IS DISTINCT FROM OLD.document_kind
     OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.template_key IS DISTINCT FROM OLD.template_key OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.explain IS DISTINCT FROM OLD.explain
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
     OR NEW.signing_key_id IS DISTINCT FROM OLD.signing_key_id OR NEW.signature IS DISTINCT FROM OLD.signature
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'reportcards.immutable: le contenu scellé de official_documents est immuable' USING ERRCODE = 'restrict_violation';
  END IF;
  -- un PDF rendu n'est jamais remplacé par un autre (même empreinte exigée : le rendu est déterministe pour un même moteur)
  IF OLD.render_status = 'RENDERED' AND (NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.pdf_hash IS DISTINCT FROM OLD.pdf_hash) THEN
    RAISE EXCEPTION 'reportcards.immutable: un rendu terminé n''est pas remplaçable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER official_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON reportcards.official_documents
  FOR EACH ROW EXECUTE FUNCTION reportcards.official_documents_guard();
