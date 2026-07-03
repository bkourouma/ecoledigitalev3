-- 0068_professional_assignment_questions.sql
-- Questions interactives pour les évaluations en ligne / IA professionnelles.
-- Auto-correction pour QCM et vrai/faux, correction manuelle pour les réponses
-- courtes et longues.
--
-- ADDITIVE, IDEMPOTENT.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 1. professional_assignment_questions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_assignment_questions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id   UUID NOT NULL REFERENCES professional_assignments(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    type            VARCHAR(20) NOT NULL
                       CHECK (type IN ('mcq_single','mcq_multi','short_answer','long_answer','true_false')),
    question_text   TEXT NOT NULL,
    points          NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points > 0),
    -- Options pour MCQ : tableau JSON d'objets { id, text, is_correct? }.
    -- Pour true_false on stocke aussi 2 options { id: 'true', text: 'Vrai' } / { id: 'false', text: 'Faux' }.
    options         JSONB,
    -- Réponse(s) correcte(s) :
    --   - mcq_single / true_false : un id d'option
    --   - mcq_multi : tableau d'ids d'option (JSON array)
    --   - short_answer : texte attendu (correction manuelle conseillée)
    --   - long_answer  : NULL (correction manuelle)
    correct_answer  TEXT,
    explanation     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_assignment_questions_assignment
    ON professional_assignment_questions (tenant_id, assignment_id, position);

-- ===========================================================================
-- 2. professional_assignment_question_answers
-- Une ligne par (soumission, question).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_assignment_question_answers (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    submission_id      UUID NOT NULL REFERENCES professional_assignment_submissions(id) ON DELETE CASCADE,
    question_id        UUID NOT NULL REFERENCES professional_assignment_questions(id) ON DELETE CASCADE,
    answer_text        TEXT,         -- pour short/long answer
    selected_option_ids JSONB,        -- pour mcq / true_false (tableau d'ids)
    is_correct         BOOLEAN,      -- NULL = pas encore évalué
    points_earned      NUMERIC(6,2), -- NULL = pas encore évalué
    graded_manually    BOOLEAN NOT NULL DEFAULT false,
    feedback           TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (submission_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_question_answers_submission
    ON professional_assignment_question_answers (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_prof_question_answers_question
    ON professional_assignment_question_answers (tenant_id, question_id);

-- ===========================================================================
-- 3. Row-Level Security
-- ===========================================================================
ALTER TABLE professional_assignment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignment_question_answers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_assignment_questions_tenant_isolation
      ON professional_assignment_questions
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignment_question_answers_tenant_isolation
      ON professional_assignment_question_answers
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fin de la migration 0068
