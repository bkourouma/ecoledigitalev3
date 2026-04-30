import { z } from "zod";

// Enum schemas
export const AssignmentTypeSchema = z.enum(['evaluation', 'homework']);
export type AssignmentType = z.infer<typeof AssignmentTypeSchema>;

export const CreationModeSchema = z.enum(['manual', 'ai_generated']);
export type CreationMode = z.infer<typeof CreationModeSchema>;

export const EvaluationTypeSchema = z.enum(['online', 'pdf', 'ai_generated']);
export type EvaluationType = z.infer<typeof EvaluationTypeSchema>;

// Removed EvaluationStatusSchema - assignments no longer have status
// export const EvaluationStatusSchema = z.enum(['draft', 'published', 'archived']);
// export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

export const SubmissionStatusSchema = z.enum(['in_progress', 'submitted', 'graded']);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const QuestionTypeSchema = z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const AIQuestionTypeSchema = z.enum(['mcq', 'short_answer', 'long_answer', 'true_false']);
export type AIQuestionType = z.infer<typeof AIQuestionTypeSchema>;

export const DifficultyLevelSchema = z.enum(['easy', 'medium', 'hard']);
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;

export const AIGenerationStatusSchema = z.enum(['not_started', 'processing', 'completed', 'failed']);
export type AIGenerationStatus = z.infer<typeof AIGenerationStatusSchema>;

export const ShowResultsModeSchema = z.enum(['immediate', 'after_end', 'after_correction']);
export type ShowResultsMode = z.infer<typeof ShowResultsModeSchema>;

// AI Configuration schema
export const AIConfigSchema = z.object({
  mcq: z.number().int().nonnegative().default(0),
  short_answer: z.number().int().nonnegative().default(0),
  long_answer: z.number().int().nonnegative().default(0),
  true_false: z.number().int().nonnegative().default(0),
  difficulty: DifficultyLevelSchema.default('medium'),
});

export type AIConfig = z.infer<typeof AIConfigSchema>;

// Assignment schema
export const AssignmentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  course_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  title: z.string(),
  description: z.string().optional(),
  type: AssignmentTypeSchema,
  creation_mode: CreationModeSchema,
  evaluation_type: EvaluationTypeSchema.optional(),
  source_document_url: z.string().optional(),

  // AI-specific fields
  source_documents: z.array(z.string().uuid()).optional(),
  ai_config: AIConfigSchema.optional(),
  ai_generation_status: AIGenerationStatusSchema.optional(),
  ai_generation_error: z.string().optional(),

  // Evaluation parameters (template defaults; scheduling moved to instances)
  duration_minutes: z.number().int().positive().optional(),
  starts_at: z.date().optional(),
  ends_at: z.date().optional(),
  max_attempts: z.number().int().positive().default(1),
  shuffle_questions: z.boolean().default(false),
  show_results_mode: ShowResultsModeSchema.default('after_correction'),

  // Homework parameters
  subject_content: z.string().optional(),
  subject_document_url: z.string().optional(),
  max_file_size_mb: z.number().positive().default(10),
  late_submission_allowed: z.boolean().default(false),
  late_penalty_percent: z.number().min(0).max(100).default(0),

  // Removed status field - assignments no longer have status
  settings: z.record(z.any()).default({}),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Assignment = z.infer<typeof AssignmentSchema>;

// Create assignment schema
export const CreateAssignmentSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: AssignmentTypeSchema,
  creation_mode: CreationModeSchema.default('manual'),
  evaluation_type: EvaluationTypeSchema.optional(),
  source_document_url: z.string().optional(),

  // AI-specific fields
  source_documents: z.array(z.string().uuid()).optional(),
  ai_config: AIConfigSchema.optional(),

  // Evaluation parameters (template defaults)
  duration_minutes: z.number().int().positive().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  max_attempts: z.number().int().positive().default(1),
  shuffle_questions: z.boolean().default(false),
  show_results_mode: ShowResultsModeSchema.default('after_correction'),

  // Homework parameters
  subject_content: z.string().optional(),
  subject_document_url: z.string().optional(),
  max_file_size_mb: z.number().positive().default(10),
  late_submission_allowed: z.boolean().default(false),
  late_penalty_percent: z.number().min(0).max(100).default(0),

  settings: z.record(z.any()).default({}),
}).refine((data) => {
  if (data.type === 'evaluation' && data.evaluation_type !== 'ai_generated') {
    return data.duration_minutes && data.duration_minutes > 0;
  }
  return true;
}, {
  message: "Duration is required for evaluations",
  path: ["duration_minutes"]
}).refine((data) => {
  if (data.type === 'homework') {
    return data.subject_content || data.subject_document_url;
  }
  return true;
}, {
  message: "Subject content or document is required for homework",
  path: ["subject_content"]
}).refine((data) => {
  if (data.evaluation_type === 'ai_generated') {
    return data.source_documents && data.source_documents.length > 0 && data.ai_config;
  }
  return true;
}, {
  message: "Source documents and AI configuration are required for AI-generated evaluations",
  path: ["source_documents"]
});

export type CreateAssignment = z.infer<typeof CreateAssignmentSchema>;

// Update assignment schema
export const UpdateAssignmentSchema = z.object({
  course_id: z.string().uuid().optional(),
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional(),
  type: AssignmentTypeSchema.optional(),
  creation_mode: CreationModeSchema.optional(),
  evaluation_type: EvaluationTypeSchema.optional(),
  source_document_url: z.string().optional(),
  source_documents: z.array(z.string().uuid()).optional(),
  ai_config: AIConfigSchema.optional(),
  duration_minutes: z.number().int().positive().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  max_attempts: z.number().int().positive().optional(),
  shuffle_questions: z.boolean().optional(),
  show_results_mode: ShowResultsModeSchema.optional(),
  subject_content: z.string().optional(),
  subject_document_url: z.string().optional(),
  max_file_size_mb: z.number().positive().optional(),
  late_submission_allowed: z.boolean().optional(),
  late_penalty_percent: z.number().min(0).max(100).optional(),
  settings: z.record(z.any()).optional(),
});

export type UpdateAssignment = z.infer<typeof UpdateAssignmentSchema>;

// Evaluation question schema
export const EvaluationQuestionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  type: QuestionTypeSchema,
  question_text: z.string(),
  options: z.array(z.string()).optional(),
  correct_answer: z.any(),
  points: z.number().positive().default(1),
  order_index: z.number().int().nonnegative(),
  ai_generated: z.boolean().default(false),
  created_at: z.date(),
});

export type EvaluationQuestion = z.infer<typeof EvaluationQuestionSchema>;

// Create question schema
export const CreateEvaluationQuestionSchema = z.object({
  type: QuestionTypeSchema,
  question_text: z.string().min(1, "Question text is required"),
  options: z.array(z.string()).optional(),
  correct_answer: z.any(),
  points: z.number().positive().default(1),
  order_index: z.number().int().nonnegative(),
  ai_generated: z.boolean().default(false),
}).refine((data) => {
  if (['single_choice', 'multiple_choice'].includes(data.type)) {
    return data.options && data.options.length >= 2;
  }
  return true;
}, {
  message: "At least 2 options required for choice questions",
  path: ["options"]
});

export type CreateEvaluationQuestion = z.infer<typeof CreateEvaluationQuestionSchema>;

// Assignment submission schema
export const AssignmentSubmissionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  student_id: z.string().uuid(),
  attempt_number: z.number().int().positive().default(1),
  
  // Evaluation data
  answers: z.record(z.any()).optional(),
  auto_score: z.number().min(0).optional(),
  
  // Homework data
  submitted_file_url: z.string().optional(),
  submitted_file_name: z.string().optional(),
  submitted_file_size_mb: z.number().positive().optional(),
  
  // Common fields
  manual_score: z.number().min(0).optional(),
  final_score: z.number().min(0).optional(),
  time_spent_seconds: z.number().int().nonnegative().optional(),
  submitted_at: z.date().optional(),
  graded_at: z.date().optional(),
  graded_by: z.string().uuid().optional(),
  feedback: z.string().optional(),
  is_late: z.boolean().default(false),
  status: SubmissionStatusSchema,
  created_at: z.date(),
  updated_at: z.date(),
});

export type AssignmentSubmission = z.infer<typeof AssignmentSubmissionSchema>;

// Question response schema
export const EvaluationQuestionResponseSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  question_id: z.string().uuid(),
  answer: z.any(),
  auto_score: z.number().min(0).optional(),
  manual_score: z.number().min(0).optional(),
  ai_feedback: z.string().optional(),
  manual_feedback: z.string().optional(),
  time_spent_seconds: z.number().int().nonnegative().optional(),
  created_at: z.date(),
});

export type EvaluationQuestionResponse = z.infer<typeof EvaluationQuestionResponseSchema>;

// Homework annotation schema
export const HomeworkAnnotationSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  page_number: z.number().int().positive(),
  annotation_type: z.enum(['highlight', 'comment', 'correction']),
  x_position: z.number(),
  y_position: z.number(),
  width: z.number(),
  height: z.number(),
  content: z.string(),
  color: z.string().default('#FF0000'),
  created_by: z.string().uuid(),
  created_at: z.date(),
});

export type HomeworkAnnotation = z.infer<typeof HomeworkAnnotationSchema>;

// AI-generated questions metadata schema
export const AIGeneratedQuestionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  evaluation_question_id: z.string().uuid(),
  question_type: AIQuestionTypeSchema,
  difficulty_level: DifficultyLevelSchema,
  source_content: z.string(),
  ai_prompt_used: z.string(),
  ai_model_version: z.string(),
  generation_metadata: z.record(z.any()),
  created_at: z.date(),
});

export type AIGeneratedQuestion = z.infer<typeof AIGeneratedQuestionSchema>;

// AI services schemas
export const DocumentExtractionRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()),
  courseId: z.string().uuid(),
});

export type DocumentExtractionRequest = z.infer<typeof DocumentExtractionRequestSchema>;

export const DocumentExtractionResponseSchema = z.object({
  extractedContent: z.string(),
  metadata: z.object({
    totalPages: z.number(),
    totalWords: z.number(),
    totalCharacters: z.number(),
    documentsProcessed: z.number(),
  }),
});

export type DocumentExtractionResponse = z.infer<typeof DocumentExtractionResponseSchema>;

export const AIQuestionGenerationRequestSchema = z.object({
  extractedContent: z.string(),
  questionConfig: AIConfigSchema,
  courseContext: z.string().optional(),
  aiInstructions: z.string().optional(),
});

export type AIQuestionGenerationRequest = z.infer<typeof AIQuestionGenerationRequestSchema>;

export const GeneratedQuestionSchema = z.object({
  type: AIQuestionTypeSchema,
  question_text: z.string(),
  options: z.array(z.string()).optional(),
  correct_answer: z.any(),
  points: z.number().positive().default(1),
  difficulty_level: DifficultyLevelSchema,
  source_content: z.string(),
  explanation: z.string().optional(),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const AIQuestionGenerationResponseSchema = z.object({
  questions: z.array(GeneratedQuestionSchema),
  metadata: z.object({
    totalGenerated: z.number(),
    tokensUsed: z.number(),
    processingTime: z.number(),
    model: z.string(),
  }),
});

// Assignment Instance schemas (scheduling per class)
export const AssignmentInstanceSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  class_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  starts_at: z.date().optional(),
  ends_at: z.date(),
  // Optional parameter overrides
  duration_minutes: z.number().int().positive().optional(),
  max_attempts: z.number().int().positive().optional(),
  shuffle_questions: z.boolean().optional(),
  show_results_mode: ShowResultsModeSchema.optional(),
  late_submission_allowed: z.boolean().optional(),
  late_penalty_percent: z.number().min(0).max(100).optional(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type AssignmentInstance = z.infer<typeof AssignmentInstanceSchema>;

export const CreateAssignmentInstanceSchema = z.object({
  assignment_id: z.string().uuid(),
  class_id: z.string().uuid(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime(),
  // Optional parameter overrides
  duration_minutes: z.number().int().positive().optional(),
  max_attempts: z.number().int().positive().optional(),
  shuffle_questions: z.boolean().optional(),
  show_results_mode: ShowResultsModeSchema.optional(),
  late_submission_allowed: z.boolean().optional(),
  late_penalty_percent: z.number().min(0).max(100).optional(),
});

export type CreateAssignmentInstance = z.infer<typeof CreateAssignmentInstanceSchema>;

export type AIQuestionGenerationResponse = z.infer<typeof AIQuestionGenerationResponseSchema>;

export const CourseDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  file_name: z.string(),
  file_type: z.string(),
  file_size: z.number(),
  created_at: z.date(),
});

export type CourseDocument = z.infer<typeof CourseDocumentSchema>;

export const AIGradingRequestSchema = z.object({
  question: z.string(),
  correct_answer: z.any(),
  student_answer: z.any(),
  max_points: z.number().positive(),
});

export type AIGradingRequest = z.infer<typeof AIGradingRequestSchema>;

// API response schemas
export const AssignmentListResponseSchema = z.object({
  assignments: z.array(AssignmentSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export type AssignmentListResponse = z.infer<typeof AssignmentListResponseSchema>;
