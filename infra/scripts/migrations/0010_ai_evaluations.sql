-- Migration: 0010_ai_evaluations.sql
-- Description: Extend schema for AI-generated evaluations
-- Date: 2025-08-21

-- Add evaluation_type enum to distinguish between different evaluation types
CREATE TYPE evaluation_type AS ENUM ('online', 'pdf', 'ai_generated');

-- Add evaluation_type column to assignments table
ALTER TABLE assignments ADD COLUMN evaluation_type evaluation_type DEFAULT 'online';

-- Update existing records based on type and creation_mode
UPDATE assignments 
SET evaluation_type = CASE 
  WHEN type = 'homework' THEN 'pdf'::evaluation_type
  WHEN type = 'evaluation' AND creation_mode = 'ai_generated' THEN 'ai_generated'::evaluation_type
  ELSE 'online'::evaluation_type
END;

-- Add AI-specific fields to assignments table
ALTER TABLE assignments ADD COLUMN source_documents jsonb; -- Array of document IDs used for AI generation
ALTER TABLE assignments ADD COLUMN ai_config jsonb; -- AI generation configuration (question counts, difficulty, etc.)
ALTER TABLE assignments ADD COLUMN ai_generation_status text DEFAULT 'not_started'; -- 'not_started', 'processing', 'completed', 'failed'
ALTER TABLE assignments ADD COLUMN ai_generation_error text; -- Error message if generation failed

-- Create table for AI-generated questions metadata
CREATE TABLE ai_generated_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  evaluation_question_id uuid NOT NULL REFERENCES evaluation_questions(id) ON DELETE CASCADE,
  question_type text NOT NULL, -- 'mcq', 'short_answer', 'long_answer', 'true_false'
  difficulty_level text DEFAULT 'medium', -- 'easy', 'medium', 'hard'
  source_content text, -- Excerpt from PDF that inspired the question
  ai_prompt_used text, -- The prompt used to generate this question
  ai_model_version text DEFAULT 'gpt-4', -- AI model used for generation
  generation_metadata jsonb, -- Additional metadata from AI generation
  created_at timestamptz DEFAULT now()
);

-- Create table for document processing status
CREATE TABLE ai_document_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  document_id uuid NOT NULL, -- Reference to course_materials.id
  processing_status text DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  extracted_text text, -- Extracted text content
  text_extraction_metadata jsonb, -- Metadata about extraction (page count, word count, etc.)
  processing_error text, -- Error message if processing failed
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create table for AI generation rate limiting
CREATE TABLE ai_generation_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_type text NOT NULL, -- 'question_generation', 'content_extraction'
  questions_generated integer DEFAULT 0,
  tokens_used integer DEFAULT 0,
  cost_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  
  -- Partition by date for efficient cleanup
  CONSTRAINT ai_usage_date_check CHECK (created_at >= DATE_TRUNC('day', created_at))
);

-- Create indexes for performance
CREATE INDEX idx_assignments_evaluation_type ON assignments(tenant_id, evaluation_type);
CREATE INDEX idx_assignments_ai_generation_status ON assignments(tenant_id, ai_generation_status);

CREATE INDEX idx_ai_generated_questions_tenant_id ON ai_generated_questions(tenant_id);
CREATE INDEX idx_ai_generated_questions_assignment_id ON ai_generated_questions(assignment_id);
CREATE INDEX idx_ai_generated_questions_evaluation_question_id ON ai_generated_questions(evaluation_question_id);

CREATE INDEX idx_ai_document_processing_tenant_id ON ai_document_processing(tenant_id);
CREATE INDEX idx_ai_document_processing_assignment_id ON ai_document_processing(assignment_id);
CREATE INDEX idx_ai_document_processing_document_id ON ai_document_processing(document_id);
CREATE INDEX idx_ai_document_processing_status ON ai_document_processing(tenant_id, processing_status);

CREATE INDEX idx_ai_generation_usage_tenant_id ON ai_generation_usage(tenant_id);
CREATE INDEX idx_ai_generation_usage_user_id ON ai_generation_usage(user_id);
CREATE INDEX idx_ai_generation_usage_date ON ai_generation_usage(tenant_id, created_at);

-- Enable Row Level Security (RLS) for new tables
ALTER TABLE ai_generated_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_document_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_usage ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY ai_generated_questions_isolation ON ai_generated_questions 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY ai_document_processing_isolation ON ai_document_processing 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY ai_generation_usage_isolation ON ai_generation_usage 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Add comment to document the AI evaluation workflow
COMMENT ON COLUMN assignments.evaluation_type IS 'Type of evaluation: online (manual QCM), pdf (homework), ai_generated (AI-created questions)';
COMMENT ON COLUMN assignments.source_documents IS 'Array of course_materials.id used for AI question generation';
COMMENT ON COLUMN assignments.ai_config IS 'Configuration for AI generation: {mcq: 5, short_answer: 2, long_answer: 1, true_false: 3, difficulty: "medium"}';
COMMENT ON COLUMN assignments.ai_generation_status IS 'Status of AI generation process';

COMMENT ON TABLE ai_generated_questions IS 'Metadata for questions generated by AI, linked to evaluation_questions';
COMMENT ON TABLE ai_document_processing IS 'Status and results of PDF document text extraction for AI processing';
COMMENT ON TABLE ai_generation_usage IS 'Rate limiting and usage tracking for AI generation features';
