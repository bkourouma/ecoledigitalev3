-- =============================================================================
-- 1306 — Module reportcards : remplacement d'un document officiel (PV de conseil rouvert puis régénéré)
-- =============================================================================
--
-- ADDITIVE. `official_documents` reste immuable (seul le rendu est mutable) : l'ancien PV est CONSERVÉ tel quel, avec son code, son
-- empreinte, sa signature et son PDF. Quand le module propriétaire (`councils`) remplace le contenu (réouverture de la séance,
-- nouvelle version du PV), il le dit par un événement et `reportcards` ENREGISTRE ici que l'ancien document est remplacé :
-- la vérification publique répond alors « remplacé par une version plus récente » au lieu de « authentique ».
--
--  - Un document n'est remplacé qu'UNE fois (UNIQUE) ; le registre est en ajout seul (ni UPDATE, ni DELETE accordés).
--  - `reason_code` : motif normalisé ; `reason_ref` : référence OPAQUE de l'acte qui le motive (demande de déverrouillage
--    approuvée côté `councils`, où se lit le motif en clair) — jamais de texte libre ni de nom ici.
--  - `source_event_id` : événement d'origine (idempotence du rejeu).
-- =============================================================================

CREATE TABLE reportcards.official_document_supersessions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  document_id     uuid NOT NULL,
  document_kind   text NOT NULL CHECK (document_kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  reason_code     text NOT NULL CHECK (reason_code IN ('COUNCIL_REOPENED')),
  reason_ref      uuid,
  source_event_id uuid,
  superseded_at   timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES reportcards.official_documents (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('reportcards.official_document_supersessions');
GRANT SELECT, INSERT ON reportcards.official_document_supersessions TO app_user;
