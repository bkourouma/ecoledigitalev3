-- =============================================================================
-- 1407 — Module higher : documents officiels (snapshots immuables) et emplacements de signature datés
-- =============================================================================
-- Ce module produit les DONNÉES immuables d'un document (snapshot JSON versionné + empreinte SHA-256) ; le rendu PDF,
-- le scellement (signature) et l'index de vérification publique relèvent du module reportcards (spec 013), qui renseigne
-- ensuite `signing_key_id`, `signature`, `template_*`, `render_status`, `object_key`, `pdf_hash`.

CREATE TABLE higher.official_documents (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind      text NOT NULL CHECK (document_kind IN ('DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY')),
  award_id           uuid,                                    -- NULL pour une attestation de réussite sans diplôme
  student_id         uuid NOT NULL,
  program_node_id    uuid,                                    -- attestation de réussite : programme / filière
  reference          text NOT NULL,                           -- DIP-… (diplôme) | AUTH/AAAA/NNN | ATT-AAAA-NNNNNN (suffixe /Dn pour un duplicata)
  reference_year     integer NOT NULL,
  reference_seq      bigint NOT NULL CHECK (reference_seq > 0),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id      uuid,                                    -- duplicata : document d'origine
  status             text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'SUPERSEDED', 'REVOKED')),
  snapshot_schema    text NOT NULL CHECK (snapshot_schema IN ('diploma/1', 'attestation-success/1', 'attestation-authenticity/1')),
  snapshot           jsonb NOT NULL,
  snapshot_hash      text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  verification_code  text NOT NULL UNIQUE CHECK (length(verification_code) >= 16),
  signing_key_id     text,                                    -- renseignés au scellement (reportcards)
  signature          text,
  template_key       text,
  template_version   integer,
  config_version     integer,
  render_status      text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'RENDERING', 'RENDERED', 'FAILED')),
  object_key         text,
  pdf_hash           text,
  issued_at          timestamptz NOT NULL,
  issued_by          uuid NOT NULL,
  issued_by_name     text NOT NULL,
  published_at       timestamptz,                             -- visible à l'étudiant
  revoked_at         timestamptz,
  revoke_reason      text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_kind, reference),
  FOREIGN KEY (tenant_id, award_id) REFERENCES higher.diploma_awards (tenant_id, id),
  CHECK (document_kind = 'ATTESTATION_SUCCESS' OR award_id IS NOT NULL),
  CHECK (document_kind <> 'ATTESTATION_SUCCESS' OR program_node_id IS NOT NULL),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) > 0))
);
-- Une seule attestation d'authenticité VIVANTE par octroi (idempotence : régénérer renvoie le même numéro),
-- un seul diplôme émis par octroi (un duplicata remplace l'original : SUPERSEDED), une attestation de réussite par (étudiant, programme).
CREATE UNIQUE INDEX official_documents_auth_uq ON higher.official_documents (tenant_id, award_id)
  WHERE document_kind = 'ATTESTATION_AUTHENTICITY' AND status = 'ISSUED';
CREATE UNIQUE INDEX official_documents_diploma_uq ON higher.official_documents (tenant_id, award_id)
  WHERE document_kind = 'DIPLOMA' AND status = 'ISSUED';
CREATE UNIQUE INDEX official_documents_att_uq ON higher.official_documents (tenant_id, student_id, program_node_id)
  WHERE document_kind = 'ATTESTATION_SUCCESS' AND status = 'ISSUED';
CREATE INDEX official_documents_student_idx ON higher.official_documents (tenant_id, student_id, status);
CREATE INDEX official_documents_award_idx ON higher.official_documents (tenant_id, award_id);
SELECT kernel.enable_tenant_rls('higher.official_documents');
GRANT SELECT, INSERT, UPDATE ON higher.official_documents TO app_user;   -- immuable hors statut, rendu, publication (déclencheur) ; jamais DELETE

-- Emplacements de signature : AUCUNE valeur par défaut (R-HIG-08). Un emplacement sans signataire valide à la date
-- d'émission BLOQUE l'émission. Historique conservé : une affectation se clôt (valid_to), ne se supprime jamais.
CREATE TABLE higher.official_document_slots (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  slot_key      text NOT NULL CHECK (slot_key IN ('DIPLOMA_LEFT', 'DIPLOMA_RIGHT', 'ATTESTATION_SUCCESS', 'AUTHENTICITY')),
  signatory_id  uuid NOT NULL,                                -- reportcards.signatories.id (sans FK : autre module)
  valid_from    date NOT NULL,
  valid_to      date,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (tenant_id WITH =, slot_key WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX official_document_slots_key_idx ON higher.official_document_slots (tenant_id, slot_key, valid_from);
SELECT kernel.enable_tenant_rls('higher.official_document_slots');
GRANT SELECT, INSERT, UPDATE ON higher.official_document_slots TO app_user;
