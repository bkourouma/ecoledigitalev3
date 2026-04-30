-- Migration: Add video storage metadata for professional training supports
-- Scope: Imhotep Data module (+ ASPCI mirror table for compatibility)

BEGIN;

ALTER TABLE IF EXISTS supports_cours
  ADD COLUMN IF NOT EXISTS video_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS video_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS url_thumbnail VARCHAR(500),
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20);

ALTER TABLE IF EXISTS supports_cours_aspci
  ADD COLUMN IF NOT EXISTS video_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS video_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS url_thumbnail VARCHAR(500),
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_supports_cours_video_provider
  ON supports_cours(tenant_id, video_provider);

CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_video_provider
  ON supports_cours_aspci(tenant_id, video_provider);

COMMIT;

