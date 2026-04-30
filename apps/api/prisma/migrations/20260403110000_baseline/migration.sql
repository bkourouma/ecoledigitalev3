-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."academic_calendar_event_type" AS ENUM ('semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone');

-- CreateEnum
CREATE TYPE "public"."assignment_contract_type" AS ENUM ('salarie', 'vacataire');

-- CreateEnum
CREATE TYPE "public"."assignment_status" AS ENUM ('active', 'paused', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."assignment_type" AS ENUM ('evaluation', 'homework');

-- CreateEnum
CREATE TYPE "public"."attendance_status" AS ENUM ('present', 'absent', 'late', 'excused', 'medical_leave');

-- CreateEnum
CREATE TYPE "public"."classroom_status" AS ENUM ('disponible', 'occupe', 'maintenance', 'hors_service');

-- CreateEnum
CREATE TYPE "public"."classroom_type" AS ENUM ('amphitheatre', 'salle_cours', 'laboratoire', 'salle_informatique', 'atelier', 'bibliotheque', 'salle_reunion', 'autre');

-- CreateEnum
CREATE TYPE "public"."contract_type" AS ENUM ('permanent', 'temporary', 'freelance');

-- CreateEnum
CREATE TYPE "public"."conversation_status" AS ENUM ('active', 'archived', 'closed');

-- CreateEnum
CREATE TYPE "public"."course_status" AS ENUM ('draft', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "public"."creation_mode" AS ENUM ('manual', 'ai_generated');

-- CreateEnum
CREATE TYPE "public"."cycle_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "public"."cycle_type" AS ENUM ('academic', 'professional', 'short', 'certification');

-- CreateEnum
CREATE TYPE "public"."delivery_mode" AS ENUM ('presential', 'remote', 'hybrid', 'elearning');

-- CreateEnum
CREATE TYPE "public"."document_type" AS ENUM ('convention', 'attestation_presence', 'attestation_reussite', 'devis', 'facture', 'facture_groupee');

-- CreateEnum
CREATE TYPE "public"."enrollment_professional_status" AS ENUM ('en_attente', 'confirmee', 'annulee', 'terminee');

-- CreateEnum
CREATE TYPE "public"."enrollment_status" AS ENUM ('active', 'suspended', 'completed', 'dropped', 'transferred');

-- CreateEnum
CREATE TYPE "public"."enrollment_type" AS ENUM ('individuelle', 'entreprise');

-- CreateEnum
CREATE TYPE "public"."evaluation_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "public"."evaluation_type" AS ENUM ('online', 'pdf', 'ai_generated');

-- CreateEnum
CREATE TYPE "public"."exam_type" AS ENUM ('midterm', 'final', 'quiz', 'assignment', 'other');

-- CreateEnum
CREATE TYPE "public"."export_type" AS ENUM ('inscriptions', 'paiements', 'presences', 'ca_formation', 'personnalise');

-- CreateEnum
CREATE TYPE "public"."installment_status" AS ENUM ('pending', 'partial', 'completed', 'overdue', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."job_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."material_processing_status" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "public"."message_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "public"."notification_type" AS ENUM ('message', 'announcement', 'event', 'grade', 'payment', 'other');

-- CreateEnum
CREATE TYPE "public"."parent_relationship" AS ENUM ('parent', 'guardian', 'emergency_contact');

-- CreateEnum
CREATE TYPE "public"."payment_config_type" AS ENUM ('salary', 'hourly', 'mixed');

-- CreateEnum
CREATE TYPE "public"."payment_fee_type" AS ENUM ('inscription', 'scolarite', 'annexes', 'autres');

-- CreateEnum
CREATE TYPE "public"."payment_method" AS ENUM ('orange_money', 'mtn_money', 'wave', 'carte_bancaire', 'tresorpay', 'virement', 'cheque');

-- CreateEnum
CREATE TYPE "public"."payment_method_type" AS ENUM ('orange_money', 'mtn_money', 'moov_money', 'card', 'bank_transfer', 'especes');

-- CreateEnum
CREATE TYPE "public"."payment_period_status" AS ENUM ('draft', 'active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "public"."payment_professional_status" AS ENUM ('en_attente', 'valide', 'echoue', 'rembourse', 'annule');

-- CreateEnum
CREATE TYPE "public"."payment_status" AS ENUM ('calculated', 'approved', 'paid', 'disputed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."payment_type" AS ENUM ('salary', 'hourly', 'bonus', 'deduction', 'mixed');

-- CreateEnum
CREATE TYPE "public"."programme_status" AS ENUM ('draft', 'review', 'approved', 'active', 'archived');

-- CreateEnum
CREATE TYPE "public"."promo_code_reduction_type" AS ENUM ('pourcentage', 'montant_fixe');

-- CreateEnum
CREATE TYPE "public"."question_type" AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank');

-- CreateEnum
CREATE TYPE "public"."rate_type" AS ENUM ('theory', 'practical', 'exam', 'evaluation', 'supervision');

-- CreateEnum
CREATE TYPE "public"."rsvp_status" AS ENUM ('pending', 'accepted', 'declined', 'tentative');

-- CreateEnum
CREATE TYPE "public"."session_professional_status" AS ENUM ('planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee');

-- CreateEnum
CREATE TYPE "public"."session_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."session_type" AS ENUM ('theory', 'practical', 'exam', 'evaluation', 'regular', 'makeup', 'field_trip', 'lab');

-- CreateEnum
CREATE TYPE "public"."student_status" AS ENUM ('active', 'graduated', 'suspended', 'dropped', 'transfer');

-- CreateEnum
CREATE TYPE "public"."submission_status" AS ENUM ('in_progress', 'submitted', 'graded');

-- CreateEnum
CREATE TYPE "public"."teacher_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "public"."transaction_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded');

-- CreateTable
CREATE TABLE "public"."academic_calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "public"."academic_calendar_event_type" NOT NULL DEFAULT 'special_event',
    "event_date" DATE NOT NULL,
    "description" TEXT,
    "semester" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."academic_year_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_year_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."academic_years" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_student_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority_level" VARCHAR(20),
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_student_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_teacher_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority_level" VARCHAR(20),
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_teacher_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_document_processing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "processing_status" TEXT DEFAULT 'pending',
    "extracted_text" TEXT,
    "text_extraction_metadata" JSONB,
    "processing_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_document_processing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_generated_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "evaluation_question_id" UUID NOT NULL,
    "question_type" TEXT NOT NULL,
    "difficulty_level" TEXT DEFAULT 'medium',
    "source_content" TEXT,
    "ai_prompt_used" TEXT,
    "ai_model_version" TEXT DEFAULT 'gpt-4',
    "generation_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generated_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_generation_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "generation_type" TEXT NOT NULL,
    "questions_generated" INTEGER DEFAULT 0,
    "tokens_used" INTEGER DEFAULT 0,
    "cost_usd" DECIMAL(10,4) DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."announcement_reads" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assignment_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."evaluation_status" DEFAULT 'draft',
    "duration_minutes" INTEGER,
    "max_attempts" INTEGER,
    "shuffle_questions" BOOLEAN,
    "show_results_mode" TEXT,
    "late_submission_allowed" BOOLEAN,
    "late_penalty_percent" DECIMAL(5,2),
    "overrides" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "teacher_id" UUID,

    CONSTRAINT "assignment_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assignment_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_number" INTEGER DEFAULT 1,
    "answers" JSONB,
    "auto_score" DECIMAL(5,2),
    "submitted_file_url" TEXT,
    "submitted_file_name" TEXT,
    "submitted_file_size_mb" DECIMAL(8,2),
    "manual_score" DECIMAL(5,2),
    "final_score" DECIMAL(5,2),
    "time_spent_seconds" INTEGER,
    "submitted_at" TIMESTAMPTZ(6),
    "graded_at" TIMESTAMPTZ(6),
    "graded_by" UUID,
    "feedback" TEXT,
    "is_late" BOOLEAN DEFAULT false,
    "status" "public"."submission_status" DEFAULT 'in_progress',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "assignment_instance_id" UUID,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "public"."assignment_type" NOT NULL,
    "creation_mode" "public"."creation_mode" DEFAULT 'manual',
    "source_document_url" TEXT,
    "duration_minutes" INTEGER,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "max_attempts" INTEGER DEFAULT 1,
    "shuffle_questions" BOOLEAN DEFAULT false,
    "show_results_mode" TEXT DEFAULT 'after_correction',
    "subject_content" TEXT,
    "subject_document_url" TEXT,
    "max_file_size_mb" INTEGER DEFAULT 10,
    "late_submission_allowed" BOOLEAN DEFAULT false,
    "late_penalty_percent" DECIMAL(5,2) DEFAULT 0,
    "status" "public"."evaluation_status" DEFAULT 'draft',
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "evaluation_type" "public"."evaluation_type" DEFAULT 'online',
    "source_documents" JSONB,
    "ai_config" JSONB,
    "ai_generation_status" TEXT DEFAULT 'not_started',
    "ai_generation_error" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "report_period" VARCHAR(100),
    "report_date" DATE NOT NULL,
    "attendance_rate" DECIMAL(5,2) NOT NULL,
    "total_days" INTEGER NOT NULL DEFAULT 0,
    "present_days" INTEGER NOT NULL DEFAULT 0,
    "absent_days" INTEGER NOT NULL DEFAULT 0,
    "report_url" VARCHAR(500),
    "downloadable" BOOLEAN DEFAULT true,
    "viewable" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "class_course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "session_time" TIME(6) NOT NULL,
    "duration_minutes" INTEGER DEFAULT 120,
    "session_type" "public"."session_type" DEFAULT 'theory',
    "location" VARCHAR(255),
    "notes" TEXT,
    "status" "public"."session_status" DEFAULT 'scheduled',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "classroom_id" UUID,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."class_courses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "is_required" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."classes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "max_students" INTEGER DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "classroom_id" UUID,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."classroom_reservations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "start_datetime" TIMESTAMPTZ(6) NOT NULL,
    "end_datetime" TIMESTAMPTZ(6) NOT NULL,
    "reserved_by" UUID NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "status" VARCHAR(20) DEFAULT 'confirmed',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."classrooms" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "type" "public"."classroom_type" NOT NULL DEFAULT 'salle_cours',
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "floor" INTEGER,
    "building" VARCHAR(100),
    "description" TEXT,
    "equipment" TEXT[],
    "status" "public"."classroom_status" NOT NULL DEFAULT 'disponible',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."codes_promo" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "type_reduction" "public"."promo_code_reduction_type" NOT NULL,
    "valeur_reduction" DECIMAL(15,2) NOT NULL,
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "utilisations_max" INTEGER,
    "utilisations_actuelles" INTEGER DEFAULT 0,
    "formations_applicables" JSONB,
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codes_promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."codes_promo_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "type_reduction" "public"."promo_code_reduction_type" NOT NULL,
    "valeur_reduction" DECIMAL(15,2) NOT NULL,
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "utilisations_max" INTEGER,
    "utilisations_actuelles" INTEGER DEFAULT 0,
    "formations_applicables" JSONB,
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codes_promo_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."course_assignments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "academic_year" VARCHAR(9) NOT NULL,
    "semester" INTEGER,
    "hours_assigned" INTEGER NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "hours_validated" DECIMAL(4,2),
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(6),

    CONSTRAINT "course_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."course_hourly_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "course_id" UUID,
    "teacher_id" UUID,
    "rate_amount" DECIMAL(8,2) NOT NULL,
    "rate_type" "public"."rate_type" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_hourly_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."course_materials" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "minio_key" VARCHAR(500) NOT NULL,
    "content_text" TEXT,
    "embedding" JSONB,
    "uploaded_by" UUID NOT NULL,
    "processing_status" "public"."material_processing_status" DEFAULT 'pending',
    "processing_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."courses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "objectives" TEXT[],
    "hours_total" INTEGER NOT NULL,
    "hours_theory" INTEGER DEFAULT 0,
    "hours_practical" INTEGER DEFAULT 0,
    "delivery_mode" "public"."delivery_mode" NOT NULL,
    "prerequisites" TEXT[],
    "evaluation_methods" TEXT[],
    "resources" JSONB DEFAULT '{}',
    "status" "public"."course_status" DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "programme_id" UUID NOT NULL,
    "cm" VARCHAR(255),
    "td" VARCHAR(255),
    "tp" VARCHAR(255),
    "coef" INTEGER,
    "vhh" VARCHAR(255),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cycles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "type" "public"."cycle_type" NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "description" TEXT,
    "certification_level" VARCHAR(50),
    "status" "public"."cycle_status" DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cycles_frais" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "inscription" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "scolarite" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "annexes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "autres" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycles_frais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "type" "public"."document_type" NOT NULL,
    "numero" VARCHAR(50) NOT NULL,
    "inscription_id" UUID,
    "session_id" UUID,
    "entreprise_id" UUID,
    "fichier_url" VARCHAR(500) NOT NULL,
    "date_generation" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "genere_par" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "type" "public"."document_type" NOT NULL,
    "numero" VARCHAR(50) NOT NULL,
    "inscription_id" UUID,
    "session_id" UUID,
    "entreprise_id" UUID,
    "fichier_url" VARCHAR(500) NOT NULL,
    "date_generation" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "genere_par" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."emergency_contacts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "contact_name" VARCHAR(255) NOT NULL,
    "relationship" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."entreprises_clientes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "raison_sociale" VARCHAR(255) NOT NULL,
    "siret" VARCHAR(14),
    "forme_juridique" VARCHAR(50),
    "adresse" TEXT,
    "code_postal" VARCHAR(10),
    "ville" VARCHAR(100),
    "pays" VARCHAR(100) DEFAULT 'Côte d''Ivoire',
    "contact_nom" VARCHAR(100),
    "contact_prenom" VARCHAR(100),
    "contact_email" VARCHAR(255),
    "contact_telephone" VARCHAR(20),
    "secteur_activite" VARCHAR(100),
    "nombre_employes" INTEGER,
    "notes" TEXT,
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entreprises_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."entreprises_clientes_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "raison_sociale" VARCHAR(255) NOT NULL,
    "siret" VARCHAR(14),
    "forme_juridique" VARCHAR(50),
    "adresse" TEXT,
    "code_postal" VARCHAR(10),
    "ville" VARCHAR(100),
    "pays" VARCHAR(100) DEFAULT 'Côte d''Ivoire',
    "contact_nom" VARCHAR(100),
    "contact_prenom" VARCHAR(100),
    "contact_email" VARCHAR(255),
    "contact_telephone" VARCHAR(20),
    "secteur_activite" VARCHAR(100),
    "nombre_employes" INTEGER,
    "notes" TEXT,
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entreprises_clientes_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_question_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "auto_score" DECIMAL(5,2),
    "manual_score" DECIMAL(5,2),
    "ai_feedback" TEXT,
    "manual_feedback" TEXT,
    "time_spent_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_question_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "type" "public"."question_type" NOT NULL,
    "question_text" TEXT NOT NULL,
    "options" JSONB,
    "correct_answer" JSONB,
    "points" DECIMAL(5,2) DEFAULT 1,
    "order_index" INTEGER NOT NULL,
    "ai_generated" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_invitations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "event_id" UUID,
    "parent_id" UUID NOT NULL,
    "student_id" UUID,
    "event_name" VARCHAR(255) NOT NULL,
    "event_description" TEXT,
    "event_date" TIMESTAMPTZ(6) NOT NULL,
    "event_location" VARCHAR(255),
    "organizer_id" UUID NOT NULL,
    "rsvp_status" "public"."rsvp_status" DEFAULT 'pending',
    "rsvp_deadline" DATE,
    "rsvp_response_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."exam_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "public"."exam_type" NOT NULL DEFAULT 'other',
    "exam_date" DATE NOT NULL,
    "exam_time" TIME(6),
    "duration" INTEGER,
    "location" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."export_jobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "type" "public"."export_type" NOT NULL,
    "status" "public"."job_status" DEFAULT 'pending',
    "fichier_url" VARCHAR(500),
    "progress" INTEGER DEFAULT 0,
    "total_items" INTEGER,
    "processed_items" INTEGER DEFAULT 0,
    "config" JSONB NOT NULL,
    "error_message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."export_jobs_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "type" "public"."export_type" NOT NULL,
    "status" "public"."job_status" DEFAULT 'pending',
    "fichier_url" VARCHAR(500),
    "progress" INTEGER DEFAULT 0,
    "total_items" INTEGER,
    "processed_items" INTEGER DEFAULT 0,
    "config" JSONB NOT NULL,
    "error_message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formateur_indisponibilites" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "raison" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formateur_indisponibilites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formateur_indisponibilites_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "raison" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formateur_indisponibilites_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formateurs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "civilite" VARCHAR(20),
    "nom" VARCHAR(100) NOT NULL,
    "prenom" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "telephone" VARCHAR(20),
    "specialites" JSONB,
    "bio" TEXT,
    "cv_url" VARCHAR(500),
    "photo_url" VARCHAR(500),
    "linkedin_url" VARCHAR(500),
    "tarif_journalier" DECIMAL(15,2),
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formateurs_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "civilite" VARCHAR(20),
    "nom" VARCHAR(100) NOT NULL,
    "prenom" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "telephone" VARCHAR(20),
    "specialites" JSONB,
    "bio" TEXT,
    "cv_url" VARCHAR(500),
    "photo_url" VARCHAR(500),
    "linkedin_url" VARCHAR(500),
    "tarif_journalier" DECIMAL(15,2),
    "actif" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formateurs_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formations_professionnelles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255),
    "description_courte" TEXT,
    "description_complete" TEXT,
    "objectifs" JSONB,
    "programme_detaille" JSONB,
    "prerequis" TEXT,
    "public_cible" TEXT,
    "duree_jours" INTEGER,
    "duree_heures" INTEGER,
    "prix_ht" DECIMAL(15,2),
    "prix_ttc" DECIMAL(15,2),
    "type_certification" VARCHAR(100),
    "nom_certification" VARCHAR(255),
    "brochure_pdf_url" VARCHAR(500),
    "themes" JSONB,
    "niveau" VARCHAR(50),
    "actif" BOOLEAN DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "carriere" VARCHAR(255),

    CONSTRAINT "formations_professionnelles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."formations_professionnelles_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255),
    "description_courte" TEXT,
    "description_complete" TEXT,
    "objectifs" JSONB,
    "programme_detaille" JSONB,
    "prerequis" TEXT,
    "public_cible" TEXT,
    "duree_jours" INTEGER,
    "duree_heures" INTEGER,
    "prix_ht" DECIMAL(15,2),
    "prix_ttc" DECIMAL(15,2),
    "type_certification" VARCHAR(100),
    "nom_certification" VARCHAR(255),
    "brochure_pdf_url" VARCHAR(500),
    "themes" JSONB,
    "niveau" VARCHAR(50),
    "carriere" VARCHAR(255),
    "actif" BOOLEAN DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formations_professionnelles_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."homework_annotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "annotation_type" TEXT NOT NULL,
    "x_position" DECIMAL(8,4),
    "y_position" DECIMAL(8,4),
    "width" DECIMAL(8,4),
    "height" DECIMAL(8,4),
    "content" TEXT,
    "color" TEXT DEFAULT '#FF0000',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inscriptions_professionnelles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "numero_inscription" VARCHAR(50),
    "session_id" UUID NOT NULL,
    "apprenant_id" UUID NOT NULL,
    "entreprise_id" UUID,
    "type_inscription" "public"."enrollment_type" NOT NULL,
    "statut" "public"."enrollment_professional_status" DEFAULT 'en_attente',
    "montant_ht" DECIMAL(15,2) NOT NULL,
    "montant_ttc" DECIMAL(15,2) NOT NULL,
    "code_promo_utilise" VARCHAR(50),
    "reduction_appliquee" DECIMAL(15,2) DEFAULT 0,
    "date_inscription" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inscriptions_professionnelles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inscriptions_professionnelles_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "numero_inscription" VARCHAR(50),
    "session_id" UUID NOT NULL,
    "apprenant_id" UUID NOT NULL,
    "entreprise_id" UUID,
    "type_inscription" "public"."enrollment_type" NOT NULL,
    "statut" "public"."enrollment_professional_status" DEFAULT 'en_attente',
    "montant_ht" DECIMAL(15,2) NOT NULL,
    "montant_ttc" DECIMAL(15,2) NOT NULL,
    "code_promo_utilise" VARCHAR(50),
    "reduction_appliquee" DECIMAL(15,2) DEFAULT 0,
    "date_inscription" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "facture_numero" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inscriptions_professionnelles_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_preferences" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "notification_type" "public"."notification_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "delivery_methods" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "notification_type" "public"."notification_type" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "action_link" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications_formateurs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "lue" BOOLEAN DEFAULT false,
    "lue_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_formateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications_formateurs_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "lue" BOOLEAN DEFAULT false,
    "lue_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_formateurs_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."paiements_professionnels" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "numero_transaction" VARCHAR(100),
    "montant" DECIMAL(15,2) NOT NULL,
    "methode_paiement" "public"."payment_method" NOT NULL,
    "statut" "public"."payment_professional_status" DEFAULT 'en_attente',
    "reference_externe" VARCHAR(255),
    "date_paiement" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paiements_professionnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."paiements_professionnels_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "numero_transaction" VARCHAR(100),
    "montant" DECIMAL(15,2) NOT NULL,
    "methode_paiement" "public"."payment_method" NOT NULL,
    "statut" "public"."payment_professional_status" DEFAULT 'en_attente',
    "reference_externe" VARCHAR(255),
    "date_paiement" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paiements_professionnels_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parent_school_conversation_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_school_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parent_school_conversations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_school_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parent_school_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_school_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parent_teacher_conversations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" "public"."conversation_status" DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_teacher_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "reason" TEXT,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_hour_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "teaching_hours_id" UUID NOT NULL,
    "hours_count" DECIMAL(4,2) NOT NULL,
    "hourly_rate" DECIMAL(8,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "is_overtime" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_hour_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "notification_type" VARCHAR(50) NOT NULL,
    "fee_type" "public"."payment_fee_type",
    "tuition_installment_id" UUID,
    "transaction_id" UUID,
    "sent_to" VARCHAR(255) NOT NULL,
    "sent_via" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "public"."payment_period_status" DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "receipt_number" VARCHAR(50) NOT NULL,
    "receipt_url" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "tuition_installment_id" UUID,
    "fee_type" "public"."payment_fee_type" NOT NULL,
    "external_transaction_id" VARCHAR(100),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) DEFAULT 'XOF',
    "payment_method" "public"."payment_method_type",
    "status" "public"."transaction_status" DEFAULT 'pending',
    "gateway_response" JSONB,
    "receipt_url" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."programmes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "version" VARCHAR(10) DEFAULT '1.0',
    "description" TEXT,
    "objectives" TEXT[],
    "ects_credits" INTEGER,
    "academic_year" VARCHAR(9),
    "status" "public"."programme_status" DEFAULT 'draft',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "semester" INTEGER NOT NULL,
    "report_date" DATE NOT NULL,
    "overall_grade" DECIMAL(5,2) NOT NULL,
    "report_url" VARCHAR(500),
    "downloadable" BOOLEAN DEFAULT true,
    "viewable" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reservations_temporaires" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "expire_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_temporaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reservations_temporaires_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "expire_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_temporaires_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rso_activities" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" INTEGER NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "date_activite" TIMESTAMPTZ(6) NOT NULL,
    "statut" VARCHAR(20) NOT NULL DEFAULT 'planifie',
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rso_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."school_announcements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority_level" "public"."message_priority",
    "posted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_attendance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "present" BOOLEAN NOT NULL,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_attendance_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "present" BOOLEAN NOT NULL,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_attendance_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_formateurs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "role" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_formateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_formateurs_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "role" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_formateurs_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID,
    "session_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "start_datetime" TIMESTAMPTZ(6) NOT NULL,
    "end_datetime" TIMESTAMPTZ(6) NOT NULL,
    "classroom" VARCHAR(255),
    "duration_minutes" INTEGER NOT NULL,
    "status" VARCHAR(50) DEFAULT 'scheduled',
    "attendance_taken" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "session_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions_professionnelles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formation_pro_id" UUID NOT NULL,
    "code_session" VARCHAR(50),
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "horaires" VARCHAR(100),
    "mode_formation" "public"."delivery_mode" NOT NULL,
    "lieu" VARCHAR(500),
    "lien_visio" VARCHAR(500),
    "places_totales" INTEGER NOT NULL,
    "places_reservees" INTEGER DEFAULT 0,
    "places_disponibles" INTEGER DEFAULT (places_totales - places_reservees),
    "prix_ht" DECIMAL(15,2),
    "prix_ttc" DECIMAL(15,2),
    "statut" "public"."session_professional_status" DEFAULT 'planifiee',
    "notes_internes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "notes_formateur" TEXT,
    "notes_updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_professionnelles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions_professionnelles_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formation_pro_id" UUID NOT NULL,
    "code_session" VARCHAR(50),
    "date_debut" DATE NOT NULL,
    "date_fin" DATE NOT NULL,
    "horaires" VARCHAR(100),
    "mode_formation" "public"."delivery_mode" NOT NULL,
    "lieu" VARCHAR(500),
    "lien_visio" VARCHAR(500),
    "places_totales" INTEGER NOT NULL,
    "places_reservees" INTEGER DEFAULT 0,
    "places_disponibles" INTEGER DEFAULT (places_totales - places_reservees),
    "prix_ht" DECIMAL(15,2),
    "prix_ttc" DECIMAL(15,2),
    "statut" "public"."session_professional_status" DEFAULT 'planifiee',
    "notes_internes" TEXT,
    "notes_formateur" TEXT,
    "notes_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_professionnelles_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_attendance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_status" "public"."attendance_status" NOT NULL,
    "arrival_time" TIME(6),
    "departure_time" TIME(6),
    "excuse_reason" TEXT,
    "excuse_document_url" TEXT,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "is_makeup" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_enrollments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "fees" JSONB NOT NULL DEFAULT '{"total": 0, "autres": 0, "annexes": 0, "currency": "XOF", "scolarite": 0, "inscription": 0}',
    "enrollment_date" DATE DEFAULT CURRENT_DATE,
    "status" "public"."enrollment_status" DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_parents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "relationship_type" "public"."parent_relationship" DEFAULT 'parent',
    "is_primary_contact" BOOLEAN DEFAULT false,
    "emergency_contact" BOOLEAN DEFAULT false,
    "can_pickup" BOOLEAN DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_period_course_averages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "academic_year_period_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "average" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_period_course_averages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "student_number" VARCHAR(50),
    "current_year" INTEGER DEFAULT 1,
    "status" "public"."student_status" DEFAULT 'active',
    "bio" TEXT,
    "date_of_birth" DATE,
    "place_of_birth" VARCHAR(255),
    "nationality" VARCHAR(100),
    "address" TEXT,
    "phone" VARCHAR(20),
    "emergency_phone" VARCHAR(20),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "father_name" VARCHAR(255),
    "mother_name" VARCHAR(255),
    "birth_certificate_number" VARCHAR(100),
    "birth_certificate_date" DATE,
    "civil_registry_office" VARCHAR(255),
    "sub_prefecture" VARCHAR(255),
    "origin_school" VARCHAR(255),
    "is_repeating" BOOLEAN DEFAULT false,
    "lv2" VARCHAR(100),
    "scholarship_level" VARCHAR(100),
    "is_transfer" BOOLEAN DEFAULT false,
    "transfer_decision" VARCHAR(255),
    "affectation_status" VARCHAR(50),
    "affectation_decision" VARCHAR(255),
    "cepe_code" VARCHAR(100),
    "is_inscribed" BOOLEAN DEFAULT true,
    "inscription_date" DATE,
    "residence" VARCHAR(255),
    "establishment_matricule" VARCHAR(100),
    "dsps_matricule" VARCHAR(100),
    "dsps_previous_matricule" VARCHAR(100),
    "initial_password" VARCHAR(255),

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_tuition_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "installment_label" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "public"."installment_status" DEFAULT 'pending',
    "amount_paid" DECIMAL(12,2) DEFAULT 0,
    "late_fee" DECIMAL(12,2) DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_tuition_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_session_associations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "support_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_session_associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_session_associations_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "support_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_session_associations_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_telechargements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "support_id" UUID NOT NULL,
    "apprenant_id" UUID,
    "session_id" UUID,
    "downloaded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_telechargements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_telechargements_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "support_id" UUID NOT NULL,
    "apprenant_id" UUID,
    "session_id" UUID,
    "downloaded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_telechargements_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supports_cours" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "session_id" UUID,
    "formation_id" UUID,
    "titre" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type_fichier" VARCHAR(50),
    "fichier_url" VARCHAR(500) NOT NULL,
    "taille_fichier" BIGINT,
    "visible_apprenants" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supports_cours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supports_cours_aspci" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "formateur_id" UUID NOT NULL,
    "session_id" UUID,
    "formation_id" UUID,
    "titre" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type_fichier" VARCHAR(50),
    "fichier_url" VARCHAR(500) NOT NULL,
    "taille_fichier" BIGINT,
    "visible_apprenants" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supports_cours_aspci_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority" VARCHAR(20) DEFAULT 'normal',
    "type" VARCHAR(50) DEFAULT 'general',
    "target_audience" VARCHAR(20) DEFAULT 'class',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_assignments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "class_course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "contract_type" "public"."assignment_contract_type" NOT NULL,
    "datebut" DATE NOT NULL,
    "datefin" DATE NOT NULL,
    "course_amount" DECIMAL(10,2),
    "status" "public"."assignment_status" DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "hours_validated" DECIMAL(5,2),
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(6),

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_assignments_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_assignment_id" UUID,
    "tenant_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,
    "old_row" JSONB,
    "new_row" JSONB,

    CONSTRAINT "teacher_assignments_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_attendance_records" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_status" "public"."attendance_status" NOT NULL,
    "notes" TEXT,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_attendance_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "class_course_id" UUID,
    "session_date" DATE NOT NULL,
    "time_slot" VARCHAR(20) NOT NULL,
    "session_title" VARCHAR(255) NOT NULL,
    "duration_hours" INTEGER NOT NULL,
    "teacher_id" UUID NOT NULL,
    "status" VARCHAR(50) DEFAULT 'completed',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority_level" "public"."message_priority",
    "sent_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_payment_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "config_type" "public"."payment_config_type" NOT NULL,
    "monthly_salary" DECIMAL(10,2),
    "annual_salary" DECIMAL(12,2),
    "default_hourly_rate" DECIMAL(8,2),
    "overtime_threshold" INTEGER DEFAULT 40,
    "overtime_multiplier" DECIMAL(3,2) DEFAULT 1.5,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_payment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "payment_period_id" UUID NOT NULL,
    "payment_config_id" UUID,
    "payment_type" "public"."payment_type" NOT NULL,
    "base_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtime_amount" DECIMAL(10,2) DEFAULT 0,
    "bonus_amount" DECIMAL(10,2) DEFAULT 0,
    "deductions" DECIMAL(10,2) DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) DEFAULT 'XOF',
    "calculation_details" JSONB,
    "status" "public"."payment_status" DEFAULT 'calculated',
    "calculated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teacher_student_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "sender_type" VARCHAR(20) NOT NULL,
    "recipient_type" VARCHAR(20) NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "priority" VARCHAR(20) DEFAULT 'normal',
    "is_read" BOOLEAN DEFAULT false,
    "parent_message_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_student_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teachers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_number" VARCHAR(20),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "specialties" TEXT[],
    "bio" TEXT,
    "qualifications" TEXT[],
    "hire_date" DATE,
    "contract_type" "public"."contract_type" NOT NULL,
    "hourly_rate" DECIMAL(8,2),
    "status" "public"."teacher_status" DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teaching_hours" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "hours_taught" DECIMAL(4,2) NOT NULL,
    "session_type" "public"."session_type" NOT NULL,
    "notes" TEXT,
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teaching_units" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "ects_credits" INTEGER,
    "semester" INTEGER,
    "is_mandatory" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "settings_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."time_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "day_of_week" VARCHAR(20) NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "priority" INTEGER DEFAULT 1,
    "is_active" BOOLEAN DEFAULT true,
    "max_concurrent_sessions" INTEGER DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."token_blacklist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "token_jti" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "reason" VARCHAR(50),
    "revoked_by" UUID,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tuition_payment_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID,
    "schedule_name" VARCHAR(100) NOT NULL,
    "installments" JSONB NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tuition_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "computed_name" VARCHAR(255) DEFAULT 
CASE
    WHEN ((last_name)::text = ''::text) THEN (first_name)::text
    ELSE (((first_name)::text || ' '::text) || (last_name)::text)
END,
    "role_updated_at" TIMESTAMP(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_calendar_events_tenant_year_name_unique" ON "public"."academic_calendar_events"("tenant_id" ASC, "academic_year_id" ASC, "name" ASC, "event_date" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_calendar_events_academic_year_id" ON "public"."academic_calendar_events"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_calendar_events_event_date" ON "public"."academic_calendar_events"("event_date" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_calendar_events_semester" ON "public"."academic_calendar_events"("semester" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_calendar_events_tenant_id" ON "public"."academic_calendar_events"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_calendar_events_type" ON "public"."academic_calendar_events"("type" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_year_periods_tenant" ON "public"."academic_year_periods"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_year_periods_year" ON "public"."academic_year_periods"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_year_periods_year_sort" ON "public"."academic_year_periods"("academic_year_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenant_id_name_key" ON "public"."academic_years"("tenant_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_years_dates" ON "public"."academic_years"("tenant_id" ASC, "start_date" ASC, "end_date" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_years_tenant_id" ON "public"."academic_years"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_admin_student_messages_admin" ON "public"."admin_student_messages"("admin_id" ASC);

-- CreateIndex
CREATE INDEX "idx_admin_student_messages_student" ON "public"."admin_student_messages"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_admin_student_messages_tenant" ON "public"."admin_student_messages"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_admin_teacher_messages_admin" ON "public"."admin_teacher_messages"("tenant_id" ASC, "admin_id" ASC);

-- CreateIndex
CREATE INDEX "idx_admin_teacher_messages_tenant_teacher" ON "public"."admin_teacher_messages"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_document_processing_assignment_id" ON "public"."ai_document_processing"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_document_processing_document_id" ON "public"."ai_document_processing"("document_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_document_processing_status" ON "public"."ai_document_processing"("tenant_id" ASC, "processing_status" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_document_processing_tenant_id" ON "public"."ai_document_processing"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generated_questions_assignment_id" ON "public"."ai_generated_questions"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generated_questions_evaluation_question_id" ON "public"."ai_generated_questions"("evaluation_question_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generated_questions_tenant_id" ON "public"."ai_generated_questions"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generation_usage_date" ON "public"."ai_generation_usage"("tenant_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generation_usage_tenant_id" ON "public"."ai_generation_usage"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_generation_usage_user_id" ON "public"."ai_generation_usage"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcement_id_parent_id_key" ON "public"."announcement_reads"("announcement_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_announcement_reads_announcement_id" ON "public"."announcement_reads"("announcement_id" ASC);

-- CreateIndex
CREATE INDEX "idx_announcement_reads_parent_id" ON "public"."announcement_reads"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_announcement_reads_tenant_id" ON "public"."announcement_reads"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_assignment" ON "public"."assignment_instances"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_assignment_id" ON "public"."assignment_instances"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_class" ON "public"."assignment_instances"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_class_id" ON "public"."assignment_instances"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_dates" ON "public"."assignment_instances"("starts_at" ASC, "ends_at" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_ends_at" ON "public"."assignment_instances"("ends_at" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_tenant" ON "public"."assignment_instances"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_tenant_id" ON "public"."assignment_instances"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_instances_year" ON "public"."assignment_instances"("academic_year_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_attempt_num_key" ON "public"."assignment_submissions"("assignment_id" ASC, "student_id" ASC, "attempt_number" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_assignment_id" ON "public"."assignment_submissions"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_instance_id" ON "public"."assignment_submissions"("assignment_instance_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_status" ON "public"."assignment_submissions"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_student_id" ON "public"."assignment_submissions"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_tenant_id" ON "public"."assignment_submissions"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_ai_generation_status" ON "public"."assignments"("tenant_id" ASC, "ai_generation_status" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_course_id" ON "public"."assignments"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_ends_at" ON "public"."assignments"("tenant_id" ASC, "ends_at" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_evaluation_type" ON "public"."assignments"("tenant_id" ASC, "evaluation_type" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_status" ON "public"."assignments"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_teacher_id" ON "public"."assignments"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_tenant_id" ON "public"."assignments"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_assignments_type" ON "public"."assignments"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_reports_academic_year_id" ON "public"."attendance_reports"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_reports_report_date" ON "public"."attendance_reports"("report_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_reports_student_id" ON "public"."attendance_reports"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_reports_tenant_id" ON "public"."attendance_reports"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_reports_tenant_student_year" ON "public"."attendance_reports"("tenant_id" ASC, "student_id" ASC, "academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_class_course_date" ON "public"."attendance_sessions"("tenant_id" ASC, "class_course_id" ASC, "session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_classroom_id" ON "public"."attendance_sessions"("classroom_id" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_date" ON "public"."attendance_sessions"("session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_date_range" ON "public"."attendance_sessions"("tenant_id" ASC, "session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_status" ON "public"."attendance_sessions"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_teacher_date" ON "public"."attendance_sessions"("tenant_id" ASC, "teacher_id" ASC, "session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_sessions_tenant_id" ON "public"."attendance_sessions"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "class_courses_tenant_id_class_id_course_id_key" ON "public"."class_courses"("tenant_id" ASC, "class_id" ASC, "course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_class" ON "public"."class_courses"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_class_id" ON "public"."class_courses"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_course" ON "public"."class_courses"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_course_id" ON "public"."class_courses"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_tenant" ON "public"."class_courses"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_class_courses_tenant_id" ON "public"."class_courses"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "classes_tenant_id_code_academic_year_id_key" ON "public"."classes"("tenant_id" ASC, "code" ASC, "academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_academic_year_id" ON "public"."classes"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_classroom_id" ON "public"."classes"("classroom_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_code" ON "public"."classes"("tenant_id" ASC, "code" ASC, "academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_programme_id" ON "public"."classes"("programme_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_tenant" ON "public"."classes"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classes_tenant_id" ON "public"."classes"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classroom_reservations_classroom_id" ON "public"."classroom_reservations"("classroom_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classroom_reservations_datetime" ON "public"."classroom_reservations"("tenant_id" ASC, "start_datetime" ASC, "end_datetime" ASC);

-- CreateIndex
CREATE INDEX "idx_classroom_reservations_tenant_id" ON "public"."classroom_reservations"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_tenant_id_code_key" ON "public"."classrooms"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_classrooms_code" ON "public"."classrooms"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_classrooms_status" ON "public"."classrooms"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_classrooms_tenant" ON "public"."classrooms"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classrooms_tenant_id" ON "public"."classrooms"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_classrooms_type" ON "public"."classrooms"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "codes_promo_tenant_id_code_key" ON "public"."codes_promo"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_actif" ON "public"."codes_promo"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_code" ON "public"."codes_promo"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_dates" ON "public"."codes_promo"("tenant_id" ASC, "date_debut" ASC, "date_fin" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_tenant_id" ON "public"."codes_promo"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "codes_promo_aspci_tenant_id_code_key" ON "public"."codes_promo_aspci"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_aspci_actif" ON "public"."codes_promo_aspci"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_aspci_code" ON "public"."codes_promo_aspci"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_aspci_dates" ON "public"."codes_promo_aspci"("tenant_id" ASC, "date_debut" ASC, "date_fin" ASC);

-- CreateIndex
CREATE INDEX "idx_codes_promo_aspci_tenant_id" ON "public"."codes_promo_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_conversation_messages_conversation_id" ON "public"."conversation_messages"("tenant_id" ASC, "conversation_id" ASC);

-- CreateIndex
CREATE INDEX "idx_conversation_messages_read_at" ON "public"."conversation_messages"("tenant_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE INDEX "idx_conversation_messages_sent_at" ON "public"."conversation_messages"("tenant_id" ASC, "conversation_id" ASC, "sent_at" ASC);

-- CreateIndex
CREATE INDEX "idx_conversation_messages_tenant_id" ON "public"."conversation_messages"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "course_assignments_tenant_id_course_id_teacher_id_academic__key" ON "public"."course_assignments"("tenant_id" ASC, "course_id" ASC, "teacher_id" ASC, "academic_year" ASC, "semester" ASC);

-- CreateIndex
CREATE INDEX "idx_course_assignments_academic_year" ON "public"."course_assignments"("tenant_id" ASC, "academic_year" ASC);

-- CreateIndex
CREATE INDEX "idx_course_assignments_course_id" ON "public"."course_assignments"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_assignments_teacher_id" ON "public"."course_assignments"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_assignments_tenant_id" ON "public"."course_assignments"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_hourly_rates_effective" ON "public"."course_hourly_rates"("effective_from" ASC, "effective_to" ASC);

-- CreateIndex
CREATE INDEX "idx_course_hourly_rates_tenant_course" ON "public"."course_hourly_rates"("tenant_id" ASC, "course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_hourly_rates_tenant_teacher" ON "public"."course_hourly_rates"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_materials_course_id" ON "public"."course_materials"("tenant_id" ASC, "course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_materials_created_at" ON "public"."course_materials"("tenant_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_course_materials_file_type" ON "public"."course_materials"("tenant_id" ASC, "file_type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "idx_course_materials_minio_key_unique" ON "public"."course_materials"("tenant_id" ASC, "minio_key" ASC);

-- CreateIndex
CREATE INDEX "idx_course_materials_processing_status" ON "public"."course_materials"("tenant_id" ASC, "processing_status" ASC);

-- CreateIndex
CREATE INDEX "idx_course_materials_tenant_id" ON "public"."course_materials"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_course_materials_uploaded_by" ON "public"."course_materials"("tenant_id" ASC, "uploaded_by" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_code" ON "public"."courses"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "idx_courses_programme_code_unique" ON "public"."courses"("tenant_id" ASC, "programme_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_programme_id" ON "public"."courses"("programme_id" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_status" ON "public"."courses"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_tenant" ON "public"."courses"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_tenant_id" ON "public"."courses"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_courses_tenant_programme" ON "public"."courses"("tenant_id" ASC, "programme_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cycles_tenant_id_code_key" ON "public"."cycles"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_cycles_code" ON "public"."cycles"("tenant_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "idx_cycles_status" ON "public"."cycles"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_cycles_tenant_id" ON "public"."cycles"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cycles_frais_tenant_id_cycle_id_key" ON "public"."cycles_frais"("tenant_id" ASC, "cycle_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cycles_frais_cycle_id" ON "public"."cycles_frais"("cycle_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cycles_frais_tenant_id" ON "public"."cycles_frais"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_date_generation" ON "public"."documents"("tenant_id" ASC, "date_generation" DESC);

-- CreateIndex
CREATE INDEX "idx_documents_numero" ON "public"."documents"("tenant_id" ASC, "type" ASC, "numero" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_tenant_id" ON "public"."documents"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_type" ON "public"."documents"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_document_numero" ON "public"."documents"("tenant_id" ASC, "type" ASC, "numero" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_aspci_date_generation" ON "public"."documents_aspci"("tenant_id" ASC, "date_generation" DESC);

-- CreateIndex
CREATE INDEX "idx_documents_aspci_numero" ON "public"."documents_aspci"("tenant_id" ASC, "type" ASC, "numero" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_aspci_tenant_id" ON "public"."documents_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documents_aspci_type" ON "public"."documents_aspci"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_document_numero_aspci" ON "public"."documents_aspci"("tenant_id" ASC, "type" ASC, "numero" ASC);

-- CreateIndex
CREATE INDEX "idx_emergency_contacts_parent_id" ON "public"."emergency_contacts"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_emergency_contacts_tenant_id" ON "public"."emergency_contacts"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_emergency_contacts_tenant_parent" ON "public"."emergency_contacts"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "entreprises_clientes_tenant_id_siret_key" ON "public"."entreprises_clientes"("tenant_id" ASC, "siret" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_actif" ON "public"."entreprises_clientes"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_raison_sociale" ON "public"."entreprises_clientes"("tenant_id" ASC, "raison_sociale" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_siret" ON "public"."entreprises_clientes"("tenant_id" ASC, "siret" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_tenant_id" ON "public"."entreprises_clientes"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "entreprises_clientes_aspci_tenant_id_siret_key" ON "public"."entreprises_clientes_aspci"("tenant_id" ASC, "siret" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_aspci_actif" ON "public"."entreprises_clientes_aspci"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_aspci_raison_sociale" ON "public"."entreprises_clientes_aspci"("tenant_id" ASC, "raison_sociale" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_aspci_siret" ON "public"."entreprises_clientes_aspci"("tenant_id" ASC, "siret" ASC);

-- CreateIndex
CREATE INDEX "idx_entreprises_clientes_aspci_tenant_id" ON "public"."entreprises_clientes_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_question_responses_question_id" ON "public"."evaluation_question_responses"("question_id" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_question_responses_submission_id" ON "public"."evaluation_question_responses"("submission_id" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_question_responses_tenant_id" ON "public"."evaluation_question_responses"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_questions_assignment_id" ON "public"."evaluation_questions"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_questions_order" ON "public"."evaluation_questions"("assignment_id" ASC, "order_index" ASC);

-- CreateIndex
CREATE INDEX "idx_evaluation_questions_tenant_id" ON "public"."evaluation_questions"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_event_invitations_event_date" ON "public"."event_invitations"("tenant_id" ASC, "event_date" ASC);

-- CreateIndex
CREATE INDEX "idx_event_invitations_parent_id" ON "public"."event_invitations"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_event_invitations_rsvp_status" ON "public"."event_invitations"("tenant_id" ASC, "parent_id" ASC, "rsvp_status" ASC);

-- CreateIndex
CREATE INDEX "idx_event_invitations_student_id" ON "public"."event_invitations"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_event_invitations_tenant_id" ON "public"."event_invitations"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "exam_schedules_tenant_course_date_unique" ON "public"."exam_schedules"("tenant_id" ASC, "course_id" ASC, "name" ASC, "exam_date" ASC);

-- CreateIndex
CREATE INDEX "idx_exam_schedules_academic_year_id" ON "public"."exam_schedules"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exam_schedules_course_id" ON "public"."exam_schedules"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exam_schedules_exam_date" ON "public"."exam_schedules"("exam_date" ASC);

-- CreateIndex
CREATE INDEX "idx_exam_schedules_tenant_id" ON "public"."exam_schedules"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exam_schedules_type" ON "public"."exam_schedules"("type" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_created_at" ON "public"."export_jobs"("tenant_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_created_by" ON "public"."export_jobs"("created_by" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_status" ON "public"."export_jobs"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_tenant_id" ON "public"."export_jobs"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_aspci_created_at" ON "public"."export_jobs_aspci"("tenant_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_aspci_created_by" ON "public"."export_jobs_aspci"("created_by" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_aspci_status" ON "public"."export_jobs_aspci"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_aspci_tenant_id" ON "public"."export_jobs_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_dates" ON "public"."formateur_indisponibilites"("tenant_id" ASC, "formateur_id" ASC, "date_debut" ASC, "date_fin" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_formateur_id" ON "public"."formateur_indisponibilites"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_tenant_id" ON "public"."formateur_indisponibilites"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_aspci_dates" ON "public"."formateur_indisponibilites_aspci"("tenant_id" ASC, "formateur_id" ASC, "date_debut" ASC, "date_fin" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_aspci_formateur_id" ON "public"."formateur_indisponibilites_aspci"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formateur_indispo_aspci_tenant_id" ON "public"."formateur_indisponibilites_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formateurs_tenant_id_email_key" ON "public"."formateurs"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_actif" ON "public"."formateurs"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_email" ON "public"."formateurs"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_specialites" ON "public"."formateurs" USING GIN ("specialites" jsonb_ops ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_tenant_id" ON "public"."formateurs"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formateurs_aspci_tenant_id_email_key" ON "public"."formateurs_aspci"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_aspci_actif" ON "public"."formateurs_aspci"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_aspci_email" ON "public"."formateurs_aspci"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_aspci_specialites" ON "public"."formateurs_aspci" USING GIN ("specialites" jsonb_ops ASC);

-- CreateIndex
CREATE INDEX "idx_formateurs_aspci_tenant_id" ON "public"."formateurs_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formations_professionnelles_tenant_id_slug_key" ON "public"."formations_professionnelles"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_actif" ON "public"."formations_professionnelles"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_slug" ON "public"."formations_professionnelles"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_tenant_id" ON "public"."formations_professionnelles"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_themes" ON "public"."formations_professionnelles" USING GIN ("themes" jsonb_ops ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formations_professionnelles_aspci_tenant_id_slug_key" ON "public"."formations_professionnelles_aspci"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_aspci_actif" ON "public"."formations_professionnelles_aspci"("tenant_id" ASC, "actif" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_aspci_slug" ON "public"."formations_professionnelles_aspci"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_aspci_tenant_id" ON "public"."formations_professionnelles_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_formations_professionnelles_aspci_themes" ON "public"."formations_professionnelles_aspci" USING GIN ("themes" jsonb_ops ASC);

-- CreateIndex
CREATE INDEX "idx_homework_annotations_submission_id" ON "public"."homework_annotations"("submission_id" ASC);

-- CreateIndex
CREATE INDEX "idx_homework_annotations_tenant_id" ON "public"."homework_annotations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_apprenant_id" ON "public"."inscriptions_professionnelles"("apprenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_entreprise_id" ON "public"."inscriptions_professionnelles"("entreprise_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_numero_inscription" ON "public"."inscriptions_professionnelles"("tenant_id" ASC, "numero_inscription" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_session_id" ON "public"."inscriptions_professionnelles"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_statut" ON "public"."inscriptions_professionnelles"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_tenant_id" ON "public"."inscriptions_professionnelles"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "inscriptions_professionnelles_tenant_id_numero_inscription_key" ON "public"."inscriptions_professionnelles"("tenant_id" ASC, "numero_inscription" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_apprenant_id" ON "public"."inscriptions_professionnelles_aspci"("apprenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_entreprise_id" ON "public"."inscriptions_professionnelles_aspci"("entreprise_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_numero_inscription" ON "public"."inscriptions_professionnelles_aspci"("tenant_id" ASC, "numero_inscription" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_session_id" ON "public"."inscriptions_professionnelles_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_statut" ON "public"."inscriptions_professionnelles_aspci"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_inscriptions_professionnelles_aspci_tenant_id" ON "public"."inscriptions_professionnelles_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "inscriptions_professionnelles__tenant_id_numero_inscription_key" ON "public"."inscriptions_professionnelles_aspci"("tenant_id" ASC, "numero_inscription" ASC);

-- CreateIndex
CREATE INDEX "idx_notification_preferences_parent_id" ON "public"."notification_preferences"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notification_preferences_tenant_id" ON "public"."notification_preferences"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notification_preferences_tenant_parent" ON "public"."notification_preferences"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notification_preferences_type" ON "public"."notification_preferences"("tenant_id" ASC, "parent_id" ASC, "notification_type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_parent_id_notification_t_key" ON "public"."notification_preferences"("tenant_id" ASC, "parent_id" ASC, "notification_type" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_created_at" ON "public"."notifications"("tenant_id" ASC, "parent_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_parent_id" ON "public"."notifications"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_read_at" ON "public"."notifications"("tenant_id" ASC, "parent_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_tenant_id" ON "public"."notifications"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_type" ON "public"."notifications"("tenant_id" ASC, "parent_id" ASC, "notification_type" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_created_at" ON "public"."notifications_formateurs"("tenant_id" ASC, "formateur_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_formateur_id" ON "public"."notifications_formateurs"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_lue" ON "public"."notifications_formateurs"("tenant_id" ASC, "formateur_id" ASC, "lue" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_tenant_id" ON "public"."notifications_formateurs"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_aspci_created_at" ON "public"."notifications_formateurs_aspci"("tenant_id" ASC, "formateur_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_aspci_formateur_id" ON "public"."notifications_formateurs_aspci"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_aspci_lue" ON "public"."notifications_formateurs_aspci"("tenant_id" ASC, "formateur_id" ASC, "lue" ASC);

-- CreateIndex
CREATE INDEX "idx_notifications_formateurs_aspci_tenant_id" ON "public"."notifications_formateurs_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_inscription_id" ON "public"."paiements_professionnels"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_methode_paiement" ON "public"."paiements_professionnels"("tenant_id" ASC, "methode_paiement" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_numero_transaction" ON "public"."paiements_professionnels"("tenant_id" ASC, "numero_transaction" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_statut" ON "public"."paiements_professionnels"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_tenant_id" ON "public"."paiements_professionnels"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "paiements_professionnels_tenant_id_numero_transaction_key" ON "public"."paiements_professionnels"("tenant_id" ASC, "numero_transaction" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_aspci_inscription_id" ON "public"."paiements_professionnels_aspci"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_aspci_methode_paiement" ON "public"."paiements_professionnels_aspci"("tenant_id" ASC, "methode_paiement" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_aspci_numero_transaction" ON "public"."paiements_professionnels_aspci"("tenant_id" ASC, "numero_transaction" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_aspci_statut" ON "public"."paiements_professionnels_aspci"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_paiements_professionnels_aspci_tenant_id" ON "public"."paiements_professionnels_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "paiements_professionnels_aspci_tenant_id_numero_transaction_key" ON "public"."paiements_professionnels_aspci"("tenant_id" ASC, "numero_transaction" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_school_conversation_messages_conversation" ON "public"."parent_school_conversation_messages"("conversation_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_school_conversations_student" ON "public"."parent_school_conversations"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_school_conversations_tenant_parent" ON "public"."parent_school_conversations"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_school_messages_student" ON "public"."parent_school_messages"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_school_messages_tenant_parent" ON "public"."parent_school_messages"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_teacher_conversations_parent_id" ON "public"."parent_teacher_conversations"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_teacher_conversations_student_id" ON "public"."parent_teacher_conversations"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_teacher_conversations_teacher_id" ON "public"."parent_teacher_conversations"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_teacher_conversations_tenant_id" ON "public"."parent_teacher_conversations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_parent_teacher_conversations_updated_at" ON "public"."parent_teacher_conversations"("tenant_id" ASC, "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_audit_log_changed_at" ON "public"."payment_audit_log"("changed_at" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_audit_log_payment" ON "public"."payment_audit_log"("payment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_hour_details_payment" ON "public"."payment_hour_details"("payment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_hour_details_teaching_hours" ON "public"."payment_hour_details"("teaching_hours_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_notifications_sent_at" ON "public"."payment_notifications"("sent_at" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_notifications_student" ON "public"."payment_notifications"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_notifications_type_status" ON "public"."payment_notifications"("notification_type" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_periods_dates" ON "public"."payment_periods"("period_start" ASC, "period_end" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_periods_tenant_status" ON "public"."payment_periods"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_receipts_receipt_number" ON "public"."payment_receipts"("tenant_id" ASC, "receipt_number" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_receipts_transaction" ON "public"."payment_receipts"("transaction_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_tenant_id_receipt_number_key" ON "public"."payment_receipts"("tenant_id" ASC, "receipt_number" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_transactions_enrollment" ON "public"."payment_transactions"("enrollment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_transactions_external_id" ON "public"."payment_transactions"("external_transaction_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_transactions_fee_type" ON "public"."payment_transactions"("tenant_id" ASC, "fee_type" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_transactions_tenant_student" ON "public"."payment_transactions"("tenant_id" ASC, "student_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_programmes_academic_year" ON "public"."programmes"("tenant_id" ASC, "academic_year" ASC);

-- CreateIndex
CREATE INDEX "idx_programmes_code" ON "public"."programmes"("tenant_id" ASC, "code" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "idx_programmes_cycle_id" ON "public"."programmes"("cycle_id" ASC);

-- CreateIndex
CREATE INDEX "idx_programmes_status" ON "public"."programmes"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_programmes_tenant" ON "public"."programmes"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_programmes_tenant_id" ON "public"."programmes"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "programmes_tenant_id_code_version_key" ON "public"."programmes"("tenant_id" ASC, "code" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "idx_report_cards_academic_year_id" ON "public"."report_cards"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_report_cards_report_date" ON "public"."report_cards"("report_date" ASC);

-- CreateIndex
CREATE INDEX "idx_report_cards_semester" ON "public"."report_cards"("semester" ASC);

-- CreateIndex
CREATE INDEX "idx_report_cards_student_id" ON "public"."report_cards"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_report_cards_tenant_id" ON "public"."report_cards"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_tenant_student_year_semester_unique" ON "public"."report_cards"("tenant_id" ASC, "student_id" ASC, "academic_year_id" ASC, "semester" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_expire_at" ON "public"."reservations_temporaires"("expire_at" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_inscription_id" ON "public"."reservations_temporaires"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_session_id" ON "public"."reservations_temporaires"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_tenant_id" ON "public"."reservations_temporaires"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_tenant_inscription" ON "public"."reservations_temporaires"("tenant_id" ASC, "inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_aspci_expire_at" ON "public"."reservations_temporaires_aspci"("expire_at" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_aspci_inscription_id" ON "public"."reservations_temporaires_aspci"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_aspci_session_id" ON "public"."reservations_temporaires_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reservations_temporaires_aspci_tenant_id" ON "public"."reservations_temporaires_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_tenant_inscription_aspci" ON "public"."reservations_temporaires_aspci"("tenant_id" ASC, "inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_roles_key" ON "public"."roles"("tenant_id" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "idx_roles_tenant_id" ON "public"."roles"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "public"."roles"("tenant_id" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_created_at" ON "public"."rso_activities"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_created_by" ON "public"."rso_activities"("created_by" ASC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_date_activite" ON "public"."rso_activities"("date_activite" DESC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_installation_id" ON "public"."rso_activities"("installation_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_statut" ON "public"."rso_activities"("statut" ASC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_tenant_id" ON "public"."rso_activities"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_tenant_installation_date" ON "public"."rso_activities"("tenant_id" ASC, "installation_id" ASC, "date_activite" DESC);

-- CreateIndex
CREATE INDEX "idx_rso_activities_type" ON "public"."rso_activities"("type" ASC);

-- CreateIndex
CREATE INDEX "idx_school_announcements_author_id" ON "public"."school_announcements"("tenant_id" ASC, "author_id" ASC);

-- CreateIndex
CREATE INDEX "idx_school_announcements_posted_at" ON "public"."school_announcements"("tenant_id" ASC, "posted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_school_announcements_tenant_id" ON "public"."school_announcements"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_inscription_id" ON "public"."session_attendance"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_marked_by" ON "public"."session_attendance"("marked_by" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_session_id" ON "public"."session_attendance"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_tenant_id" ON "public"."session_attendance"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_session_inscription" ON "public"."session_attendance"("tenant_id" ASC, "session_id" ASC, "inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_aspci_inscription_id" ON "public"."session_attendance_aspci"("inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_aspci_marked_by" ON "public"."session_attendance_aspci"("marked_by" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_aspci_session_id" ON "public"."session_attendance_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_attendance_aspci_tenant_id" ON "public"."session_attendance_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_session_inscription_aspci" ON "public"."session_attendance_aspci"("tenant_id" ASC, "session_id" ASC, "inscription_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_formateur_id" ON "public"."session_formateurs"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_session_id" ON "public"."session_formateurs"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_tenant_id" ON "public"."session_formateurs"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "session_formateurs_tenant_id_session_id_formateur_id_key" ON "public"."session_formateurs"("tenant_id" ASC, "session_id" ASC, "formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_aspci_formateur_id" ON "public"."session_formateurs_aspci"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_aspci_session_id" ON "public"."session_formateurs_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_formateurs_aspci_tenant_id" ON "public"."session_formateurs_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "session_formateurs_aspci_tenant_id_session_id_formateur_id_key" ON "public"."session_formateurs_aspci"("tenant_id" ASC, "session_id" ASC, "formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_class" ON "public"."session_instances"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_course" ON "public"."session_instances"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_date" ON "public"."session_instances"("session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_datetime" ON "public"."session_instances"("start_datetime" ASC, "end_datetime" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_status" ON "public"."session_instances"("status" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_teacher" ON "public"."session_instances"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_session_instances_tenant" ON "public"."session_instances"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_code_session" ON "public"."sessions_professionnelles"("tenant_id" ASC, "code_session" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_date_debut" ON "public"."sessions_professionnelles"("tenant_id" ASC, "date_debut" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_formation_pro_id" ON "public"."sessions_professionnelles"("formation_pro_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_statut" ON "public"."sessions_professionnelles"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_tenant_id" ON "public"."sessions_professionnelles"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_professionnelles_tenant_id_code_session_key" ON "public"."sessions_professionnelles"("tenant_id" ASC, "code_session" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_aspci_code_session" ON "public"."sessions_professionnelles_aspci"("tenant_id" ASC, "code_session" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_aspci_date_debut" ON "public"."sessions_professionnelles_aspci"("tenant_id" ASC, "date_debut" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_aspci_formation_pro_id" ON "public"."sessions_professionnelles_aspci"("formation_pro_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_aspci_statut" ON "public"."sessions_professionnelles_aspci"("tenant_id" ASC, "statut" ASC);

-- CreateIndex
CREATE INDEX "idx_sessions_professionnelles_aspci_tenant_id" ON "public"."sessions_professionnelles_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_professionnelles_aspci_tenant_id_code_session_key" ON "public"."sessions_professionnelles_aspci"("tenant_id" ASC, "code_session" ASC);

-- CreateIndex
CREATE INDEX "idx_student_attendance_marked_by" ON "public"."student_attendance"("tenant_id" ASC, "marked_by" ASC);

-- CreateIndex
CREATE INDEX "idx_student_attendance_session" ON "public"."student_attendance"("tenant_id" ASC, "session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_attendance_student_date" ON "public"."student_attendance"("tenant_id" ASC, "student_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_student_attendance_student_status" ON "public"."student_attendance"("tenant_id" ASC, "student_id" ASC, "attendance_status" ASC);

-- CreateIndex
CREATE INDEX "idx_student_attendance_tenant_id" ON "public"."student_attendance"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_student_session" ON "public"."student_attendance"("tenant_id" ASC, "session_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_enrollments_academic_year_id" ON "public"."student_enrollments"("academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_enrollments_class_id" ON "public"."student_enrollments"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_enrollments_status" ON "public"."student_enrollments"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_student_enrollments_student_id" ON "public"."student_enrollments"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_enrollments_tenant_id" ON "public"."student_enrollments"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_tenant_id_student_id_academic_year_id_key" ON "public"."student_enrollments"("tenant_id" ASC, "student_id" ASC, "academic_year_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_parents_parent_id" ON "public"."student_parents"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_parents_relationship" ON "public"."student_parents"("tenant_id" ASC, "relationship_type" ASC);

-- CreateIndex
CREATE INDEX "idx_student_parents_student_id" ON "public"."student_parents"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_parents_tenant_id" ON "public"."student_parents"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_parents_tenant_id_student_id_parent_id_key" ON "public"."student_parents"("tenant_id" ASC, "student_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sp_ca_class" ON "public"."student_period_course_averages"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sp_ca_period" ON "public"."student_period_course_averages"("academic_year_period_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sp_ca_student" ON "public"."student_period_course_averages"("student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_sp_ca_tenant" ON "public"."student_period_course_averages"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_period_course_averages_unique" ON "public"."student_period_course_averages"("tenant_id" ASC, "academic_year_period_id" ASC, "student_id" ASC, "course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_profiles_current_year" ON "public"."student_profiles"("tenant_id" ASC, "current_year" ASC);

-- CreateIndex
CREATE INDEX "idx_student_profiles_status" ON "public"."student_profiles"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_student_profiles_student_number" ON "public"."student_profiles"("tenant_id" ASC, "student_number" ASC);

-- CreateIndex
CREATE INDEX "idx_student_profiles_tenant_id" ON "public"."student_profiles"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_profiles_user_id" ON "public"."student_profiles"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_tenant_id_student_number_key" ON "public"."student_profiles"("tenant_id" ASC, "student_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_tenant_id_user_id_key" ON "public"."student_profiles"("tenant_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_tuition_installments_due_date" ON "public"."student_tuition_installments"("tenant_id" ASC, "due_date" ASC);

-- CreateIndex
CREATE INDEX "idx_student_tuition_installments_enrollment" ON "public"."student_tuition_installments"("enrollment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_student_tuition_installments_status" ON "public"."student_tuition_installments"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_student_tuition_installments_tenant_student" ON "public"."student_tuition_installments"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "student_tuition_installments_tenant_id_enrollment_id_instal_key" ON "public"."student_tuition_installments"("tenant_id" ASC, "enrollment_id" ASC, "installment_number" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_session_id" ON "public"."support_session_associations"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_support_id" ON "public"."support_session_associations"("support_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_tenant_id" ON "public"."support_session_associations"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_support_session" ON "public"."support_session_associations"("tenant_id" ASC, "support_id" ASC, "session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_aspci_session_id" ON "public"."support_session_associations_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_aspci_support_id" ON "public"."support_session_associations_aspci"("support_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_session_assoc_aspci_tenant_id" ON "public"."support_session_associations_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_support_session_aspci" ON "public"."support_session_associations_aspci"("tenant_id" ASC, "support_id" ASC, "session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_apprenant_id" ON "public"."support_telechargements"("apprenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_downloaded_at" ON "public"."support_telechargements"("downloaded_at" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_session_id" ON "public"."support_telechargements"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_support_id" ON "public"."support_telechargements"("support_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_tenant_id" ON "public"."support_telechargements"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_aspci_apprenant_id" ON "public"."support_telechargements_aspci"("apprenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_aspci_downloaded_at" ON "public"."support_telechargements_aspci"("downloaded_at" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_aspci_session_id" ON "public"."support_telechargements_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_aspci_support_id" ON "public"."support_telechargements_aspci"("support_id" ASC);

-- CreateIndex
CREATE INDEX "idx_support_telechargements_aspci_tenant_id" ON "public"."support_telechargements_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_formateur_id" ON "public"."supports_cours"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_formation_id" ON "public"."supports_cours"("formation_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_session_id" ON "public"."supports_cours"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_tenant_id" ON "public"."supports_cours"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_visible_apprenants" ON "public"."supports_cours"("tenant_id" ASC, "visible_apprenants" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_aspci_formateur_id" ON "public"."supports_cours_aspci"("formateur_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_aspci_formation_id" ON "public"."supports_cours_aspci"("formation_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_aspci_session_id" ON "public"."supports_cours_aspci"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_aspci_tenant_id" ON "public"."supports_cours_aspci"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_supports_cours_aspci_visible_apprenants" ON "public"."supports_cours_aspci"("tenant_id" ASC, "visible_apprenants" ASC);

-- CreateIndex
CREATE INDEX "idx_announcements_class" ON "public"."teacher_announcements"("class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_announcements_course" ON "public"."teacher_announcements"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_announcements_teacher" ON "public"."teacher_announcements"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_class_course" ON "public"."teacher_assignments"("class_course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_dates" ON "public"."teacher_assignments"("tenant_id" ASC, "datebut" ASC, "datefin" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_status" ON "public"."teacher_assignments"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_teacher" ON "public"."teacher_assignments"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_tenant" ON "public"."teacher_assignments"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_records_session" ON "public"."teacher_attendance_records"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_records_student" ON "public"."teacher_attendance_records"("student_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_records_tenant_id_session_id_student_id_key" ON "public"."teacher_attendance_records"("tenant_id" ASC, "session_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_sessions_assignment" ON "public"."teacher_attendance_sessions"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_sessions_date" ON "public"."teacher_attendance_sessions"("session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_sessions_teacher" ON "public"."teacher_attendance_sessions"("teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_att_sessions_tenant" ON "public"."teacher_attendance_sessions"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_sessions_tenant_id_assignment_id_session_key" ON "public"."teacher_attendance_sessions"("tenant_id" ASC, "assignment_id" ASC, "session_date" ASC, "time_slot" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_parent_id" ON "public"."teacher_messages"("tenant_id" ASC, "parent_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_read_at" ON "public"."teacher_messages"("tenant_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_sent_at" ON "public"."teacher_messages"("tenant_id" ASC, "sent_at" DESC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_student_id" ON "public"."teacher_messages"("tenant_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_teacher_id" ON "public"."teacher_messages"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_messages_tenant_id" ON "public"."teacher_messages"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payment_configs_effective" ON "public"."teacher_payment_configs"("effective_from" ASC, "effective_to" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payment_configs_tenant_teacher" ON "public"."teacher_payment_configs"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payments_dates" ON "public"."teacher_payments"("calculated_at" ASC, "approved_at" ASC, "paid_at" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payments_period" ON "public"."teacher_payments"("payment_period_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payments_status" ON "public"."teacher_payments"("status" ASC);

-- CreateIndex
CREATE INDEX "idx_teacher_payments_tenant_teacher" ON "public"."teacher_payments"("tenant_id" ASC, "teacher_id" ASC);

-- CreateIndex
CREATE INDEX "idx_messages_course" ON "public"."teacher_student_messages"("course_id" ASC);

-- CreateIndex
CREATE INDEX "idx_messages_created_at" ON "public"."teacher_student_messages"("created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_messages_recipient" ON "public"."teacher_student_messages"("recipient_id" ASC);

-- CreateIndex
CREATE INDEX "idx_messages_sender" ON "public"."teacher_student_messages"("sender_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teachers_contract_type" ON "public"."teachers"("tenant_id" ASC, "contract_type" ASC);

-- CreateIndex
CREATE INDEX "idx_teachers_email" ON "public"."teachers"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_teachers_status" ON "public"."teachers"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_teachers_tenant" ON "public"."teachers"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teachers_tenant_id" ON "public"."teachers"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "teachers_tenant_id_email_key" ON "public"."teachers"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_hours_assignment_id" ON "public"."teaching_hours"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_hours_session_date" ON "public"."teaching_hours"("tenant_id" ASC, "session_date" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_hours_tenant_id" ON "public"."teaching_hours"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_units_programme_id" ON "public"."teaching_units"("programme_id" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_units_semester" ON "public"."teaching_units"("tenant_id" ASC, "semester" ASC);

-- CreateIndex
CREATE INDEX "idx_teaching_units_tenant_id" ON "public"."teaching_units"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tenants_slug" ON "public"."tenants"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "public"."tenants"("slug" ASC);

-- CreateIndex
CREATE INDEX "idx_time_slots_active" ON "public"."time_slots"("is_active" ASC);

-- CreateIndex
CREATE INDEX "idx_time_slots_day" ON "public"."time_slots"("day_of_week" ASC);

-- CreateIndex
CREATE INDEX "idx_time_slots_tenant" ON "public"."time_slots"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idx_blacklist_cleanup" ON "public"."token_blacklist"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_blacklist_lookup" ON "public"."token_blacklist"("tenant_id" ASC, "token_jti" ASC, "expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_blacklist_user" ON "public"."token_blacklist"("tenant_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_tenant_token" ON "public"."token_blacklist"("tenant_id" ASC, "token_jti" ASC);

-- CreateIndex
CREATE INDEX "idx_tuition_payment_schedules_class" ON "public"."tuition_payment_schedules"("tenant_id" ASC, "class_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tuition_payment_schedules_tenant_academic_year" ON "public"."tuition_payment_schedules"("tenant_id" ASC, "academic_year_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tuition_payment_schedules_tenant_id_academic_year_id_class__key" ON "public"."tuition_payment_schedules"("tenant_id" ASC, "academic_year_id" ASC, "class_id" ASC, "schedule_name" ASC);

-- CreateIndex
CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles"("role_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "public"."user_roles"("user_id" ASC, "role_id" ASC);

-- CreateIndex
CREATE INDEX "idx_users_email" ON "public"."users"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "idx_users_first_name" ON "public"."users"("tenant_id" ASC, "first_name" ASC);

-- CreateIndex
CREATE INDEX "idx_users_full_name" ON "public"."users"("tenant_id" ASC, "first_name" ASC, "last_name" ASC);

-- CreateIndex
CREATE INDEX "idx_users_last_name" ON "public"."users"("tenant_id" ASC, "last_name" ASC);

-- CreateIndex
CREATE INDEX "idx_users_role_updated_at" ON "public"."users"("id" ASC, "role_updated_at" ASC);

-- CreateIndex
CREATE INDEX "idx_users_tenant_id" ON "public"."users"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "public"."users"("tenant_id" ASC, "email" ASC);

-- AddForeignKey
ALTER TABLE "public"."academic_calendar_events" ADD CONSTRAINT "academic_calendar_events_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."academic_calendar_events" ADD CONSTRAINT "academic_calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."academic_year_periods" ADD CONSTRAINT "academic_year_periods_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."academic_year_periods" ADD CONSTRAINT "academic_year_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."academic_years" ADD CONSTRAINT "academic_years_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_student_messages" ADD CONSTRAINT "admin_student_messages_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_student_messages" ADD CONSTRAINT "admin_student_messages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_student_messages" ADD CONSTRAINT "admin_student_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_teacher_messages" ADD CONSTRAINT "admin_teacher_messages_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_teacher_messages" ADD CONSTRAINT "admin_teacher_messages_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."admin_teacher_messages" ADD CONSTRAINT "admin_teacher_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_document_processing" ADD CONSTRAINT "ai_document_processing_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_document_processing" ADD CONSTRAINT "ai_document_processing_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_generated_questions" ADD CONSTRAINT "ai_generated_questions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_generated_questions" ADD CONSTRAINT "ai_generated_questions_evaluation_question_id_fkey" FOREIGN KEY ("evaluation_question_id") REFERENCES "public"."evaluation_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_generated_questions" ADD CONSTRAINT "ai_generated_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_generation_usage" ADD CONSTRAINT "ai_generation_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ai_generation_usage" ADD CONSTRAINT "ai_generation_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."school_announcements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."announcement_reads" ADD CONSTRAINT "announcement_reads_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."announcement_reads" ADD CONSTRAINT "announcement_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "assignment_instances_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "assignment_instances_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "assignment_instances_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "assignment_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "fk_assignment_instances_assignment_id" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_instances" ADD CONSTRAINT "fk_assignment_instances_class_id" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_instance_id_fkey" FOREIGN KEY ("assignment_instance_id") REFERENCES "public"."assignment_instances"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_reports" ADD CONSTRAINT "attendance_reports_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_reports" ADD CONSTRAINT "attendance_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_reports" ADD CONSTRAINT "attendance_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_class_course_id_fkey" FOREIGN KEY ("class_course_id") REFERENCES "public"."class_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."class_courses" ADD CONSTRAINT "class_courses_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."class_courses" ADD CONSTRAINT "class_courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classes" ADD CONSTRAINT "classes_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classes" ADD CONSTRAINT "classes_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classes" ADD CONSTRAINT "classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classroom_reservations" ADD CONSTRAINT "classroom_reservations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classroom_reservations" ADD CONSTRAINT "classroom_reservations_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classroom_reservations" ADD CONSTRAINT "classroom_reservations_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classroom_reservations" ADD CONSTRAINT "classroom_reservations_reserved_by_fkey" FOREIGN KEY ("reserved_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classroom_reservations" ADD CONSTRAINT "classroom_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."classrooms" ADD CONSTRAINT "classrooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."codes_promo" ADD CONSTRAINT "codes_promo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."codes_promo_aspci" ADD CONSTRAINT "codes_promo_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."parent_teacher_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_messages" ADD CONSTRAINT "conversation_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_assignments" ADD CONSTRAINT "course_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_assignments" ADD CONSTRAINT "course_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_assignments" ADD CONSTRAINT "course_assignments_validated_by_fkey" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_hourly_rates" ADD CONSTRAINT "course_hourly_rates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_hourly_rates" ADD CONSTRAINT "course_hourly_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_hourly_rates" ADD CONSTRAINT "course_hourly_rates_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_hourly_rates" ADD CONSTRAINT "course_hourly_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_materials" ADD CONSTRAINT "course_materials_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_materials" ADD CONSTRAINT "course_materials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."course_materials" ADD CONSTRAINT "course_materials_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."courses" ADD CONSTRAINT "fk_courses_programme" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."cycles" ADD CONSTRAINT "cycles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."cycles_frais" ADD CONSTRAINT "cycles_frais_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."cycles_frais" ADD CONSTRAINT "cycles_frais_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises_clientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_genere_par_fkey" FOREIGN KEY ("genere_par") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents_aspci" ADD CONSTRAINT "documents_aspci_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises_clientes_aspci"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents_aspci" ADD CONSTRAINT "documents_aspci_genere_par_fkey" FOREIGN KEY ("genere_par") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents_aspci" ADD CONSTRAINT "documents_aspci_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles_aspci"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents_aspci" ADD CONSTRAINT "documents_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."documents_aspci" ADD CONSTRAINT "documents_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."entreprises_clientes" ADD CONSTRAINT "entreprises_clientes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."entreprises_clientes_aspci" ADD CONSTRAINT "entreprises_clientes_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."evaluation_question_responses" ADD CONSTRAINT "evaluation_question_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."evaluation_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."evaluation_question_responses" ADD CONSTRAINT "evaluation_question_responses_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."evaluation_question_responses" ADD CONSTRAINT "evaluation_question_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."evaluation_questions" ADD CONSTRAINT "evaluation_questions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."evaluation_questions" ADD CONSTRAINT "evaluation_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_invitations" ADD CONSTRAINT "event_invitations_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_invitations" ADD CONSTRAINT "event_invitations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_invitations" ADD CONSTRAINT "event_invitations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."event_invitations" ADD CONSTRAINT "event_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."exam_schedules" ADD CONSTRAINT "exam_schedules_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."exam_schedules" ADD CONSTRAINT "exam_schedules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."exam_schedules" ADD CONSTRAINT "exam_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."export_jobs" ADD CONSTRAINT "export_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."export_jobs_aspci" ADD CONSTRAINT "export_jobs_aspci_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."export_jobs_aspci" ADD CONSTRAINT "export_jobs_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateur_indisponibilites" ADD CONSTRAINT "formateur_indisponibilites_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateur_indisponibilites" ADD CONSTRAINT "formateur_indisponibilites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateur_indisponibilites_aspci" ADD CONSTRAINT "formateur_indisponibilites_aspci_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateur_indisponibilites_aspci" ADD CONSTRAINT "formateur_indisponibilites_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateurs" ADD CONSTRAINT "formateurs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateurs" ADD CONSTRAINT "formateurs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateurs_aspci" ADD CONSTRAINT "formateurs_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formateurs_aspci" ADD CONSTRAINT "formateurs_aspci_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formations_professionnelles" ADD CONSTRAINT "formations_professionnelles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formations_professionnelles" ADD CONSTRAINT "formations_professionnelles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formations_professionnelles_aspci" ADD CONSTRAINT "formations_professionnelles_aspci_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."formations_professionnelles_aspci" ADD CONSTRAINT "formations_professionnelles_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."homework_annotations" ADD CONSTRAINT "homework_annotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."homework_annotations" ADD CONSTRAINT "homework_annotations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."homework_annotations" ADD CONSTRAINT "homework_annotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles" ADD CONSTRAINT "inscriptions_professionnelles_apprenant_id_fkey" FOREIGN KEY ("apprenant_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles" ADD CONSTRAINT "inscriptions_professionnelles_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises_clientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles" ADD CONSTRAINT "inscriptions_professionnelles_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles" ADD CONSTRAINT "inscriptions_professionnelles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles_aspci" ADD CONSTRAINT "inscriptions_professionnelles_aspci_apprenant_id_fkey" FOREIGN KEY ("apprenant_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles_aspci" ADD CONSTRAINT "inscriptions_professionnelles_aspci_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises_clientes_aspci"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles_aspci" ADD CONSTRAINT "inscriptions_professionnelles_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inscriptions_professionnelles_aspci" ADD CONSTRAINT "inscriptions_professionnelles_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications_formateurs" ADD CONSTRAINT "notifications_formateurs_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications_formateurs" ADD CONSTRAINT "notifications_formateurs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications_formateurs_aspci" ADD CONSTRAINT "notifications_formateurs_aspci_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications_formateurs_aspci" ADD CONSTRAINT "notifications_formateurs_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."paiements_professionnels" ADD CONSTRAINT "paiements_professionnels_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."paiements_professionnels" ADD CONSTRAINT "paiements_professionnels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."paiements_professionnels_aspci" ADD CONSTRAINT "paiements_professionnels_aspci_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."paiements_professionnels_aspci" ADD CONSTRAINT "paiements_professionnels_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversation_messages" ADD CONSTRAINT "parent_school_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."parent_school_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversation_messages" ADD CONSTRAINT "parent_school_conversation_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversation_messages" ADD CONSTRAINT "parent_school_conversation_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversations" ADD CONSTRAINT "parent_school_conversations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversations" ADD CONSTRAINT "parent_school_conversations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_conversations" ADD CONSTRAINT "parent_school_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_messages" ADD CONSTRAINT "parent_school_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_messages" ADD CONSTRAINT "parent_school_messages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_school_messages" ADD CONSTRAINT "parent_school_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_teacher_conversations" ADD CONSTRAINT "parent_teacher_conversations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_teacher_conversations" ADD CONSTRAINT "parent_teacher_conversations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_teacher_conversations" ADD CONSTRAINT "parent_teacher_conversations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."parent_teacher_conversations" ADD CONSTRAINT "parent_teacher_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_audit_log" ADD CONSTRAINT "payment_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_audit_log" ADD CONSTRAINT "payment_audit_log_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."teacher_payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_audit_log" ADD CONSTRAINT "payment_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_hour_details" ADD CONSTRAINT "payment_hour_details_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."teacher_payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_hour_details" ADD CONSTRAINT "payment_hour_details_teaching_hours_id_fkey" FOREIGN KEY ("teaching_hours_id") REFERENCES "public"."teaching_hours"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_hour_details" ADD CONSTRAINT "payment_hour_details_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_notifications" ADD CONSTRAINT "payment_notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_notifications" ADD CONSTRAINT "payment_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_notifications" ADD CONSTRAINT "payment_notifications_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_notifications" ADD CONSTRAINT "payment_notifications_tuition_installment_id_fkey" FOREIGN KEY ("tuition_installment_id") REFERENCES "public"."student_tuition_installments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_periods" ADD CONSTRAINT "payment_periods_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_periods" ADD CONSTRAINT "payment_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_receipts" ADD CONSTRAINT "payment_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_receipts" ADD CONSTRAINT "payment_receipts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_tuition_installment_id_fkey" FOREIGN KEY ("tuition_installment_id") REFERENCES "public"."student_tuition_installments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."programmes" ADD CONSTRAINT "programmes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."programmes" ADD CONSTRAINT "programmes_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."programmes" ADD CONSTRAINT "programmes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."report_cards" ADD CONSTRAINT "report_cards_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."report_cards" ADD CONSTRAINT "report_cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."report_cards" ADD CONSTRAINT "report_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires" ADD CONSTRAINT "reservations_temporaires_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires" ADD CONSTRAINT "reservations_temporaires_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires" ADD CONSTRAINT "reservations_temporaires_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires_aspci" ADD CONSTRAINT "reservations_temporaires_aspci_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires_aspci" ADD CONSTRAINT "reservations_temporaires_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reservations_temporaires_aspci" ADD CONSTRAINT "reservations_temporaires_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."rso_activities" ADD CONSTRAINT "rso_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."school_announcements" ADD CONSTRAINT "school_announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."school_announcements" ADD CONSTRAINT "school_announcements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance" ADD CONSTRAINT "session_attendance_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance" ADD CONSTRAINT "session_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."formateurs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance" ADD CONSTRAINT "session_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance" ADD CONSTRAINT "session_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance_aspci" ADD CONSTRAINT "session_attendance_aspci_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance_aspci" ADD CONSTRAINT "session_attendance_aspci_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."formateurs_aspci"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance_aspci" ADD CONSTRAINT "session_attendance_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_attendance_aspci" ADD CONSTRAINT "session_attendance_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs" ADD CONSTRAINT "session_formateurs_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs" ADD CONSTRAINT "session_formateurs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs" ADD CONSTRAINT "session_formateurs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs_aspci" ADD CONSTRAINT "session_formateurs_aspci_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs_aspci" ADD CONSTRAINT "session_formateurs_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_formateurs_aspci" ADD CONSTRAINT "session_formateurs_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_instances" ADD CONSTRAINT "session_instances_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_instances" ADD CONSTRAINT "session_instances_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_instances" ADD CONSTRAINT "session_instances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_instances" ADD CONSTRAINT "session_instances_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."session_instances" ADD CONSTRAINT "session_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sessions_professionnelles" ADD CONSTRAINT "sessions_professionnelles_formation_pro_id_fkey" FOREIGN KEY ("formation_pro_id") REFERENCES "public"."formations_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sessions_professionnelles" ADD CONSTRAINT "sessions_professionnelles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sessions_professionnelles_aspci" ADD CONSTRAINT "sessions_professionnelles_aspci_formation_pro_id_fkey" FOREIGN KEY ("formation_pro_id") REFERENCES "public"."formations_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sessions_professionnelles_aspci" ADD CONSTRAINT "sessions_professionnelles_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_attendance" ADD CONSTRAINT "student_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_attendance" ADD CONSTRAINT "student_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_attendance" ADD CONSTRAINT "student_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_attendance" ADD CONSTRAINT "student_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_enrollments" ADD CONSTRAINT "student_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_parents" ADD CONSTRAINT "student_parents_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_parents" ADD CONSTRAINT "student_parents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_parents" ADD CONSTRAINT "student_parents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_period_course_averages" ADD CONSTRAINT "student_period_course_averages_academic_year_period_id_fkey" FOREIGN KEY ("academic_year_period_id") REFERENCES "public"."academic_year_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_period_course_averages" ADD CONSTRAINT "student_period_course_averages_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_period_course_averages" ADD CONSTRAINT "student_period_course_averages_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_period_course_averages" ADD CONSTRAINT "student_period_course_averages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_period_course_averages" ADD CONSTRAINT "student_period_course_averages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_profiles" ADD CONSTRAINT "student_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_tuition_installments" ADD CONSTRAINT "student_tuition_installments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_tuition_installments" ADD CONSTRAINT "student_tuition_installments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."tuition_payment_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_tuition_installments" ADD CONSTRAINT "student_tuition_installments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."student_tuition_installments" ADD CONSTRAINT "student_tuition_installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations" ADD CONSTRAINT "support_session_associations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations" ADD CONSTRAINT "support_session_associations_support_id_fkey" FOREIGN KEY ("support_id") REFERENCES "public"."supports_cours"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations" ADD CONSTRAINT "support_session_associations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations_aspci" ADD CONSTRAINT "support_session_associations_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations_aspci" ADD CONSTRAINT "support_session_associations_aspci_support_id_fkey" FOREIGN KEY ("support_id") REFERENCES "public"."supports_cours_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_session_associations_aspci" ADD CONSTRAINT "support_session_associations_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements" ADD CONSTRAINT "support_telechargements_apprenant_id_fkey" FOREIGN KEY ("apprenant_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements" ADD CONSTRAINT "support_telechargements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements" ADD CONSTRAINT "support_telechargements_support_id_fkey" FOREIGN KEY ("support_id") REFERENCES "public"."supports_cours"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements" ADD CONSTRAINT "support_telechargements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements_aspci" ADD CONSTRAINT "support_telechargements_aspci_apprenant_id_fkey" FOREIGN KEY ("apprenant_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements_aspci" ADD CONSTRAINT "support_telechargements_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements_aspci" ADD CONSTRAINT "support_telechargements_aspci_support_id_fkey" FOREIGN KEY ("support_id") REFERENCES "public"."supports_cours_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."support_telechargements_aspci" ADD CONSTRAINT "support_telechargements_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours" ADD CONSTRAINT "supports_cours_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours" ADD CONSTRAINT "supports_cours_formation_id_fkey" FOREIGN KEY ("formation_id") REFERENCES "public"."formations_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours" ADD CONSTRAINT "supports_cours_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours" ADD CONSTRAINT "supports_cours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours_aspci" ADD CONSTRAINT "supports_cours_aspci_formateur_id_fkey" FOREIGN KEY ("formateur_id") REFERENCES "public"."formateurs_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours_aspci" ADD CONSTRAINT "supports_cours_aspci_formation_id_fkey" FOREIGN KEY ("formation_id") REFERENCES "public"."formations_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours_aspci" ADD CONSTRAINT "supports_cours_aspci_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions_professionnelles_aspci"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."supports_cours_aspci" ADD CONSTRAINT "supports_cours_aspci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_class_course_id_fkey" FOREIGN KEY ("class_course_id") REFERENCES "public"."class_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_validated_by_fkey" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."teacher_attendance_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_sessions" ADD CONSTRAINT "teacher_attendance_sessions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."teacher_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_sessions" ADD CONSTRAINT "teacher_attendance_sessions_class_course_id_fkey" FOREIGN KEY ("class_course_id") REFERENCES "public"."class_courses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_sessions" ADD CONSTRAINT "teacher_attendance_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_attendance_sessions" ADD CONSTRAINT "teacher_attendance_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_messages" ADD CONSTRAINT "teacher_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_messages" ADD CONSTRAINT "teacher_messages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_messages" ADD CONSTRAINT "teacher_messages_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_messages" ADD CONSTRAINT "teacher_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payment_configs" ADD CONSTRAINT "teacher_payment_configs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payment_configs" ADD CONSTRAINT "teacher_payment_configs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payment_configs" ADD CONSTRAINT "teacher_payment_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_payment_config_id_fkey" FOREIGN KEY ("payment_config_id") REFERENCES "public"."teacher_payment_configs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_payment_period_id_fkey" FOREIGN KEY ("payment_period_id") REFERENCES "public"."payment_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_payments" ADD CONSTRAINT "teacher_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teacher_student_messages" ADD CONSTRAINT "teacher_student_messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "public"."teacher_student_messages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teachers" ADD CONSTRAINT "teachers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teaching_hours" ADD CONSTRAINT "teaching_hours_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."course_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teaching_hours" ADD CONSTRAINT "teaching_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teaching_hours" ADD CONSTRAINT "teaching_hours_validated_by_fkey" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teaching_units" ADD CONSTRAINT "teaching_units_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teaching_units" ADD CONSTRAINT "teaching_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."token_blacklist" ADD CONSTRAINT "fk_token_blacklist_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."token_blacklist" ADD CONSTRAINT "fk_token_blacklist_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."tuition_payment_schedules" ADD CONSTRAINT "tuition_payment_schedules_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."tuition_payment_schedules" ADD CONSTRAINT "tuition_payment_schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."tuition_payment_schedules" ADD CONSTRAINT "tuition_payment_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."tuition_payment_schedules" ADD CONSTRAINT "tuition_payment_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

