-- =============================================================================
-- 2504 — Module documents : recherche dans le TEXTE des PDF (réponse métier Q-14)
-- =============================================================================
--
-- Le texte des PDF téléversés est extrait HORS de l'API (job du worker, processus fils isolé) puis indexé ici :
--   - `text_index` : UNE ligne par document, pour sa version COURANTE (une nouvelle version repasse la ligne à PENDING et efface
--     l'ancien texte : un texte périmé ne peut jamais répondre à une recherche) ;
--   - statuts : PENDING (à extraire), INDEXED (texte indexé), NO_TEXT (PDF sans couche de texte, typiquement un scan : PAS d'OCR),
--     FAILED (illisible : chiffré, corrompu, trop gros, délai dépassé…) ;
--   - `tsv` : tsvector de la configuration `documents.fr_search` (français + suppression des accents) ; la configuration retombe
--     sur le français seul si le dictionnaire `unaccent` (extension contrib déjà créée par 2500) est absent.
--
-- Donnée DÉRIVÉE du fichier : la ligne est recalculable à tout moment et SUPPRIMÉE avec le document (purge) ; c'est pourquoi
-- `DELETE` est accordé sur cette seule table (les tables d'identité du module n'en ont toujours aucun). RLS forcée.
-- La recherche ne lit JAMAIS cette table sans la même condition de visibilité que la liste des documents (voir repository).
-- =============================================================================

DO $$
BEGIN
  CREATE TEXT SEARCH CONFIGURATION documents.fr_search (COPY = pg_catalog.french);
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_ts_dict d JOIN pg_catalog.pg_namespace n ON n.oid = d.dictnamespace
     WHERE d.dictname = 'unaccent' AND n.nspname = 'public'
  ) THEN
    ALTER TEXT SEARCH CONFIGURATION documents.fr_search
      ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, pg_catalog.french_stem;
  END IF;
END
$$;

CREATE TABLE documents.text_index (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  document_id     uuid NOT NULL,
  -- Version dont le texte est (ou sera) indexé : la recherche exige qu'elle soit la version COURANTE du document.
  version_no      integer NOT NULL CHECK (version_no >= 1),
  status          text NOT NULL CHECK (status IN ('PENDING', 'INDEXED', 'NO_TEXT', 'FAILED')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Texte extrait, BORNÉ (le code plafonne à 500 000 caractères, sous la limite de 1 Mio d'un tsvector) ; seulement si INDEXED.
  content         text,
  tsv             tsvector,
  page_count      integer CHECK (page_count IS NULL OR page_count >= 0),
  pages_indexed   integer CHECK (pages_indexed IS NULL OR pages_indexed >= 0),
  truncated       boolean NOT NULL DEFAULT false,
  char_count      integer CHECK (char_count IS NULL OR char_count >= 0),
  -- Cause d'un échec (code stable, jamais un extrait du document).
  error_code      text CHECK (error_code IS NULL OR length(error_code) <= 40),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  -- PENDING : instant à partir duquel le job peut (re)prendre la ligne ; sert aussi de bail pendant le traitement.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  indexed_at      timestamptz,
  PRIMARY KEY (tenant_id, document_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents.documents (tenant_id, id),
  CHECK ((status = 'INDEXED') = (content IS NOT NULL AND tsv IS NOT NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('documents.text_index');
CREATE INDEX text_index_tsv ON documents.text_index USING gin (tsv);
CREATE INDEX text_index_due ON documents.text_index (tenant_id, next_attempt_at) WHERE status = 'PENDING';
GRANT SELECT, INSERT, UPDATE, DELETE ON documents.text_index TO app_user;

-- -----------------------------------------------------------------------------
-- Reprise de l'existant : chaque PDF courant déjà déposé est mis en file d'indexation (le job du worker le traite).
-- -----------------------------------------------------------------------------
INSERT INTO documents.text_index (tenant_id, document_id, version_no, status)
SELECT d.tenant_id, d.id, d.current_version_no, 'PENDING'
  FROM documents.documents d
  JOIN documents.versions v ON v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.version_no = d.current_version_no
 WHERE d.purged_at IS NULL AND v.state = 'ACTIVE' AND v.detected_mime = 'application/pdf'
ON CONFLICT (tenant_id, document_id) DO NOTHING;
