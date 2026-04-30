-- EcoleDigitale Database Schema Migration 0044
-- Description: Add carriere field to formations_professionnelles table
-- Date: 2025-01-27
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (formations_professionnelles table)

-- Add carriere column to formations_professionnelles table
ALTER TABLE formations_professionnelles
ADD COLUMN IF NOT EXISTS carriere VARCHAR(255);

-- Add comment to the column
COMMENT ON COLUMN formations_professionnelles.carriere IS 'Catégorie de carrière pour catégoriser les formations (LES FORMATIONS INTERENTREPRISES d''IMHOTEP DATA, LES FORMATIONS DIPLÔMANTES d''IMHOTEP DATA)';

