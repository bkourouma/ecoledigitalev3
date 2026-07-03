-- 0067_professional_assignments_extended.sql
-- Extension de `professional_assignments` pour aligner les 3 types
-- d'évaluation sur le système académique (/teacher/assignments/create) :
--   - online        : QCM interactif (durée, tentatives, mélange…)
--   - pdf           : sujet PDF + remise de fichiers
--   - ai_generated  : génération automatique de questions (config IA)
--
-- Migration ADDITIVE / IDEMPOTENTE / NON DESTRUCTIVE.

-- ---------------------------------------------------------------------------
-- Colonnes communes à plusieurs types
-- ---------------------------------------------------------------------------
ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS evaluation_type        VARCHAR(20) NOT NULL DEFAULT 'pdf'
        CHECK (evaluation_type IN ('online','pdf','ai_generated'));

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS subject_content        TEXT;

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS subject_document_url   TEXT;

-- ---------------------------------------------------------------------------
-- Champs spécifiques aux évaluations « online » et « ai_generated »
-- ---------------------------------------------------------------------------
ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS duration_minutes       INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0);

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS max_attempts           INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0);

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS shuffle_questions      BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS show_results_mode      VARCHAR(30) NOT NULL DEFAULT 'after_correction'
        CHECK (show_results_mode IN ('immediately','after_correction','never'));

-- ---------------------------------------------------------------------------
-- Champs spécifiques au type « pdf » (homework)
-- ---------------------------------------------------------------------------
ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS max_file_size_mb       INTEGER NOT NULL DEFAULT 10 CHECK (max_file_size_mb > 0);

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS late_submission_allowed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS late_penalty_percent   NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100);

-- ---------------------------------------------------------------------------
-- Configuration IA (jsonb pour souplesse)
-- Forme attendue :
-- {
--   "mcq": 7, "short_answer": 3, "long_answer": 3, "true_false": 7,
--   "difficulty": "easy" | "medium" | "hard",
--   "instructions": "Texte libre optionnel"
-- }
-- ---------------------------------------------------------------------------
ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS ai_config              JSONB;

-- Liste des supports source utilisés pour la génération IA
-- (FK soft → professional_subject_materials.id).
ALTER TABLE professional_assignments
    ADD COLUMN IF NOT EXISTS ai_source_material_ids UUID[];

-- Fin de la migration 0067_professional_assignments_extended.sql
