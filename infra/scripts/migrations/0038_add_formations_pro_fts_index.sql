-- Migration: 0038_add_formations_pro_fts_index.sql
-- Description: Add full-text search index for formations_professionnelles table
-- Date: 2025-11-14
-- Dependencies: 0037_imhotep_data_professional_training.sql (formations_professionnelles table must exist)

-- This migration creates a GIN index for full-text search on the formations_professionnelles table
-- to enable fast text search on training titles and descriptions in French language.

BEGIN;

-- Create full-text search index using GIN (Generalized Inverted Index)
-- This index enables fast full-text search on titre, description_courte, and description_complete
-- Using 'french' language configuration for proper French text processing
CREATE INDEX IF NOT EXISTS idx_formations_pro_fts 
ON formations_professionnelles 
USING GIN (
  to_tsvector(
    'french',
    COALESCE(titre, '') || ' ' || 
    COALESCE(description_courte, '') || ' ' || 
    COALESCE(description_complete, '')
  )
);

-- Add comment for documentation
COMMENT ON INDEX idx_formations_pro_fts IS 'Full-text search index on formations_professionnelles for searching titles and descriptions in French';

COMMIT;

