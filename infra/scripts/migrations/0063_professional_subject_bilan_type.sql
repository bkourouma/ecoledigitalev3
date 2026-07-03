-- 0063_professional_subject_bilan_type.sql
-- Feature 028-professional-module — ajoute le « type de bilan » aux matières
-- professionnelles (alignement sur les matières académiques `courses`).
--
-- Migration IDEMPOTENTE et NON DESTRUCTIVE : ajout d'une colonne nullable
-- (les matières existantes restent valides, bilan_type_id à NULL).

ALTER TABLE professional_subjects
  ADD COLUMN IF NOT EXISTS bilan_type_id UUID REFERENCES bilan_types(id);

CREATE INDEX IF NOT EXISTS idx_professional_subjects_bilan_type
  ON professional_subjects (tenant_id, bilan_type_id);

-- Fin de la migration 0063_professional_subject_bilan_type.sql
