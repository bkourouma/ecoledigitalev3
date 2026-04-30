-- Migration: 0009_evaluations_system.sql
-- Description: Create tables for evaluations and homework system
-- Date: 2025-08-20

-- Create ENUM types for evaluations system
CREATE TYPE assignment_type AS ENUM ('evaluation', 'homework');
CREATE TYPE creation_mode AS ENUM ('manual', 'ai_generated');
CREATE TYPE assignment_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE submission_status AS ENUM ('in_progress', 'submitted', 'graded');
CREATE TYPE question_type AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank');

-- Table principale pour évaluations ET devoirs
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  type assignment_type NOT NULL, -- 'evaluation' (en ligne) ou 'homework' (PDF)
  creation_mode creation_mode DEFAULT 'manual', -- 'manual', 'ai_generated'
  source_document_url text, -- PDF source pour génération IA
  
  -- Paramètres évaluations en ligne
  duration_minutes integer, -- NULL pour devoirs
  starts_at timestamptz,
  ends_at timestamptz NOT NULL,
  max_attempts integer DEFAULT 1,
  shuffle_questions boolean DEFAULT false,
  show_results_mode text DEFAULT 'after_correction', -- 'immediate', 'after_end', 'after_correction'
  
  -- Paramètres devoirs PDF
  subject_content text, -- Sujet saisi dans textarea
  subject_document_url text, -- PDF du sujet
  max_file_size_mb integer DEFAULT 10, -- Taille max PDF soumission
  late_submission_allowed boolean DEFAULT false,
  late_penalty_percent numeric(5,2) DEFAULT 0,
  
  status assignment_status DEFAULT 'draft', -- 'draft', 'published', 'archived'
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Questions uniquement pour évaluations en ligne
CREATE TABLE evaluation_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  type question_type NOT NULL, -- 'single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank'
  question_text text NOT NULL,
  options jsonb, -- Pour QCM: ["option1", "option2", ...]
  correct_answer jsonb, -- Réponse(s) correcte(s)
  points numeric(5,2) DEFAULT 1,
  order_index integer NOT NULL,
  ai_generated boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  
  -- Contrainte : questions seulement pour évaluations
  CONSTRAINT questions_only_for_evaluations CHECK (
    (SELECT type FROM assignments WHERE id = assignment_id) = 'evaluation'
  )
);

-- Soumissions pour évaluations ET devoirs
CREATE TABLE assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_number integer DEFAULT 1,
  
  -- Pour évaluations en ligne
  answers jsonb, -- Réponses aux questions (NULL pour devoirs)
  auto_score numeric(5,2), -- Score IA (NULL pour devoirs)
  
  -- Pour devoirs PDF
  submitted_file_url text, -- Lien vers PDF soumis (NULL pour évaluations)
  submitted_file_name text,
  submitted_file_size_mb numeric(8,2),
  
  -- Commun
  manual_score numeric(5,2),
  final_score numeric(5,2),
  time_spent_seconds integer,
  submitted_at timestamptz,
  graded_at timestamptz,
  graded_by uuid REFERENCES users(id),
  feedback text,
  is_late boolean DEFAULT false,
  status submission_status DEFAULT 'in_progress', -- 'in_progress', 'submitted', 'graded'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(assignment_id, student_id, attempt_number)
);

-- Réponses aux questions (évaluations uniquement)
CREATE TABLE evaluation_question_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES evaluation_questions(id) ON DELETE CASCADE,
  answer jsonb NOT NULL,
  auto_score numeric(5,2), -- Score IA
  manual_score numeric(5,2), -- Score manuel (révision)
  ai_feedback text, -- Feedback généré par IA
  manual_feedback text, -- Feedback enseignant
  time_spent_seconds integer,
  created_at timestamptz DEFAULT now()
);

-- Annotations PDF pour devoirs
CREATE TABLE homework_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  annotation_type text NOT NULL, -- 'highlight', 'comment', 'correction'
  x_position numeric(8,4), -- Position relative sur la page
  y_position numeric(8,4),
  width numeric(8,4),
  height numeric(8,4),
  content text, -- Texte du commentaire
  color text DEFAULT '#FF0000',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_assignments_tenant_id ON assignments(tenant_id);
CREATE INDEX idx_assignments_course_id ON assignments(course_id);
CREATE INDEX idx_assignments_teacher_id ON assignments(teacher_id);
CREATE INDEX idx_assignments_type ON assignments(tenant_id, type);
CREATE INDEX idx_assignments_status ON assignments(tenant_id, status);
CREATE INDEX idx_assignments_ends_at ON assignments(tenant_id, ends_at);

CREATE INDEX idx_evaluation_questions_tenant_id ON evaluation_questions(tenant_id);
CREATE INDEX idx_evaluation_questions_assignment_id ON evaluation_questions(assignment_id);
CREATE INDEX idx_evaluation_questions_order ON evaluation_questions(assignment_id, order_index);

CREATE INDEX idx_assignment_submissions_tenant_id ON assignment_submissions(tenant_id);
CREATE INDEX idx_assignment_submissions_assignment_id ON assignment_submissions(assignment_id);
CREATE INDEX idx_assignment_submissions_student_id ON assignment_submissions(student_id);
CREATE INDEX idx_assignment_submissions_status ON assignment_submissions(tenant_id, status);

CREATE INDEX idx_evaluation_question_responses_tenant_id ON evaluation_question_responses(tenant_id);
CREATE INDEX idx_evaluation_question_responses_submission_id ON evaluation_question_responses(submission_id);
CREATE INDEX idx_evaluation_question_responses_question_id ON evaluation_question_responses(question_id);

CREATE INDEX idx_homework_annotations_tenant_id ON homework_annotations(tenant_id);
CREATE INDEX idx_homework_annotations_submission_id ON homework_annotations(submission_id);

-- Enable Row Level Security (RLS) for all tables
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_question_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_annotations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY assignments_isolation ON assignments 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY evaluation_questions_isolation ON evaluation_questions 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY assignment_submissions_isolation ON assignment_submissions 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY evaluation_question_responses_isolation ON evaluation_question_responses 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY homework_annotations_isolation ON homework_annotations 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Add triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_assignments_updated_at BEFORE UPDATE ON assignments 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignment_submissions_updated_at BEFORE UPDATE ON assignment_submissions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
