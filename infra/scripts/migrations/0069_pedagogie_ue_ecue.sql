-- 0069_pedagogie_ue_ecue.sql
-- Feature 030-pedagogie-ue-ecue — Restructuration de l'architecture pédagogique
-- du Module Professionnel : Filière → UE → ECUE.
--
-- ⚠️ MIGRATION DESTRUCTIVE ET À PASSAGE UNIQUE (dev/seed only).
-- Décision PRD D13 : AUCUNE reprise de données. Cette migration SUPPRIME les
-- tables `professional_subject*` / `professional_session*` et recrée le modèle
-- cible (UE administrative ↔ ECUE pédagogique). Contrairement à 0061–0068
-- (idempotentes/non destructives), 0069 droppe puis recrée : ne l'exécuter QUE
-- sur une base de développement sans données à conserver.
--
-- Principe : UE = pôle ADMINISTRATIF (prix, UV, cohortes, inscription, diplôme)
--            ECUE = pôle PÉDAGOGIQUE (supports, devoirs, séances, présence, notes).
--
-- Conventions : id UUID PK, tenant_id NOT NULL → tenants(id) + RLS (GUC
-- app.tenant_id), created_at/updated_at TIMESTAMPTZ ; updated_at maintenu par la
-- couche service. Filière = programmes(id) via la colonne filiere_id.
--
-- Voir specs/030-pedagogie-ue-ecue/data-model.md.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 0. SUPPRESSION des tables obsolètes / à repointer (filles → parents).
--    DROP ... CASCADE : pas de données (D13). `professional_orders` et
--    `professional_payments` sont CONSERVÉES (ne référencent pas les matières).
-- ===========================================================================

-- Pédagogie liée aux sessions/matières (supprimée — repointée sur ECUE/séance)
DROP TABLE IF EXISTS professional_session_attendance       CASCADE;
DROP TABLE IF EXISTS professional_session_materials        CASCADE;
DROP TABLE IF EXISTS professional_subject_material_views   CASCADE;
DROP TABLE IF EXISTS professional_subject_materials        CASCADE;

-- Évaluations (recréées repointées sur ecue_id / ue_session_id)
DROP TABLE IF EXISTS professional_assignment_question_answers CASCADE;
DROP TABLE IF EXISTS professional_assignment_questions        CASCADE;
DROP TABLE IF EXISTS professional_assignment_submissions      CASCADE;
DROP TABLE IF EXISTS professional_assignments                 CASCADE;

-- Inscription (recréée repointée sur ue_session_id) — orders/payments conservés
DROP TABLE IF EXISTS professional_enrollments              CASCADE;

-- Diplômes (recréés : filiere_id, exigences = UE)
DROP TABLE IF EXISTS student_professional_diplomas         CASCADE;
DROP TABLE IF EXISTS professional_diploma_requirements     CASCADE;
DROP TABLE IF EXISTS professional_diplomas                 CASCADE;

-- Référentiel obsolète (matière → ECUE, sessions → cohortes UE)
DROP TABLE IF EXISTS professional_subject_prerequisites    CASCADE;
DROP TABLE IF EXISTS professional_subject_sessions         CASCADE;
DROP TABLE IF EXISTS professional_subjects                 CASCADE;

-- ===========================================================================
-- 1. professional_ecue — Élément Constitutif d'UE (PÉDAGOGIE). Ex-matière.
--    SANS prix / nb_uv / filiere_id (portés par l'UE ; mutualisation).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ecue (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    libelle       TEXT NOT NULL,
    description   TEXT,
    bilan_type_id UUID REFERENCES bilan_types(id),
    statut        TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_professional_ecue_tenant_statut
    ON professional_ecue (tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_professional_ecue_bilan_type
    ON professional_ecue (tenant_id, bilan_type_id);

-- ===========================================================================
-- 2. professional_ue — Unité d'Enseignement (ADMINISTRATIF). Porte prix/UV.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ue (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filiere_id  UUID NOT NULL REFERENCES programmes(id),
    code        TEXT NOT NULL,
    libelle     TEXT NOT NULL,
    description TEXT,
    prix        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (prix >= 0),
    devise      TEXT NOT NULL DEFAULT 'XOF',
    nb_uv       INTEGER NOT NULL DEFAULT 0 CHECK (nb_uv >= 0),
    statut      TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif')),
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_professional_ue_tenant_filiere
    ON professional_ue (tenant_id, filiere_id);
CREATE INDEX IF NOT EXISTS idx_professional_ue_tenant_statut
    ON professional_ue (tenant_id, statut);

-- ===========================================================================
-- 3. professional_ue_ecue — Liaison UE ↔ ECUE (mutualisable, inter-filières).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ue_ecue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_id           UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    ecue_id         UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    est_obligatoire BOOLEAN NOT NULL DEFAULT true,
    coefficient     NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    ordre           INTEGER NOT NULL DEFAULT 0 CHECK (ordre >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, ue_id, ecue_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_ue_ecue_ue
    ON professional_ue_ecue (tenant_id, ue_id, ordre);
CREATE INDEX IF NOT EXISTS idx_prof_ue_ecue_ecue
    ON professional_ue_ecue (tenant_id, ecue_id);

-- ===========================================================================
-- 4. professional_ue_prerequisites — Prérequis entre UE (même filière, acyclique).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ue_prerequisites (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_id              UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    prerequisite_ue_id UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ue_id <> prerequisite_ue_id),
    UNIQUE (tenant_id, ue_id, prerequisite_ue_id)
);
-- Validation applicative (service professional-ue) : même filière + acyclique (DFS).
CREATE INDEX IF NOT EXISTS idx_prof_ue_prereq_ue
    ON professional_ue_prerequisites (tenant_id, ue_id);
CREATE INDEX IF NOT EXISTS idx_prof_ue_prereq_prerequisite
    ON professional_ue_prerequisites (tenant_id, prerequisite_ue_id);

-- ===========================================================================
-- 5. professional_ue_sessions — Cohorte d'UE (occurrence inscriptible).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ue_sessions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_id                   UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    libelle                 TEXT NOT NULL,
    date_debut              DATE NOT NULL,
    date_fin                DATE NOT NULL,
    inscription_ouverte_le  TIMESTAMPTZ NOT NULL,
    inscription_fermee_le   TIMESTAMPTZ NOT NULL,
    capacite_max            INTEGER CHECK (capacite_max IS NULL OR capacite_max > 0),
    enseignant_id           UUID REFERENCES teachers(id),
    classroom_id            UUID REFERENCES classrooms(id),
    statut                  TEXT NOT NULL DEFAULT 'brouillon'
                              CHECK (statut IN ('brouillon','ouvert','complet','en_cours','termine','annule')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_fin >= date_debut),
    CHECK (inscription_fermee_le >= inscription_ouverte_le)
);
CREATE INDEX IF NOT EXISTS idx_prof_ue_sessions_ue
    ON professional_ue_sessions (tenant_id, ue_id);
CREATE INDEX IF NOT EXISTS idx_prof_ue_sessions_enrollable
    ON professional_ue_sessions (tenant_id, statut, inscription_ouverte_le, inscription_fermee_le);

-- ===========================================================================
-- 6. professional_ecue_seances — Séance pédagogique (ECUE × cohorte).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ecue_seances (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id       UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    libelle       TEXT,
    date          DATE NOT NULL,
    heure_debut   TIME,
    heure_fin     TIME,
    enseignant_id UUID REFERENCES teachers(id),
    classroom_id  UUID REFERENCES classrooms(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (heure_fin IS NULL OR heure_debut IS NULL OR heure_fin >= heure_debut)
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_seances_session
    ON professional_ecue_seances (tenant_id, ue_session_id, date);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_seances_ecue
    ON professional_ecue_seances (tenant_id, ecue_id);

-- ===========================================================================
-- 7. professional_ecue_attendance — Présence par séance ECUE.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ecue_attendance (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    seance_id  UUID NOT NULL REFERENCES professional_ecue_seances(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    statut     TEXT NOT NULL DEFAULT 'present'
                 CHECK (statut IN ('present','absent','retard','excuse')),
    marked_by  UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, seance_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_attendance_seance
    ON professional_ecue_attendance (tenant_id, seance_id);

-- ===========================================================================
-- 8. professional_ecue_materials (+ views) — Supports pérennes de l'ECUE.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ecue_materials (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id      UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    titre        TEXT NOT NULL,
    description  TEXT,
    kind         VARCHAR(20) NOT NULL DEFAULT 'autre'
                    CHECK (kind IN ('pdf','pptx','video','image','autre')),
    storage_path TEXT NOT NULL,
    mime_type    TEXT,
    file_size    BIGINT,
    uploaded_by  UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_materials_ecue
    ON professional_ecue_materials (tenant_id, ecue_id);

CREATE TABLE IF NOT EXISTS professional_ecue_material_views (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES professional_ecue_materials(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_material_views_material
    ON professional_ecue_material_views (tenant_id, material_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_material_views_user
    ON professional_ecue_material_views (tenant_id, user_id, opened_at DESC);

-- ===========================================================================
-- 9. professional_assignments — Évaluations (repointées sur ECUE + cohorte).
--    Tables filles inchangées dans leur forme (questions/submissions/answers).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_assignments (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id                  UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    ue_session_id            UUID REFERENCES professional_ue_sessions(id) ON DELETE SET NULL,
    titre                    VARCHAR(255) NOT NULL,
    description              TEXT,
    type                     VARCHAR(30) NOT NULL DEFAULT 'devoir'
                                CHECK (type IN ('devoir','controle','examen','projet','qcm','autre')),
    note_max                 NUMERIC(6,2) NOT NULL DEFAULT 20 CHECK (note_max > 0),
    coefficient              NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    consigne_url             TEXT,
    starts_at                TIMESTAMPTZ,
    due_at                   TIMESTAMPTZ,
    statut                   VARCHAR(20) NOT NULL DEFAULT 'publie'
                                CHECK (statut IN ('brouillon','publie','cloture')),
    -- Type d'évaluation (ex-0067)
    evaluation_type          VARCHAR(20) NOT NULL DEFAULT 'pdf'
                                CHECK (evaluation_type IN ('online','pdf','ai_generated')),
    subject_content          TEXT,
    subject_document_url     TEXT,
    duration_minutes         INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    max_attempts             INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
    shuffle_questions        BOOLEAN NOT NULL DEFAULT false,
    show_results_mode        VARCHAR(30) NOT NULL DEFAULT 'after_correction'
                                CHECK (show_results_mode IN ('immediately','after_correction','never')),
    max_file_size_mb         INTEGER NOT NULL DEFAULT 10 CHECK (max_file_size_mb > 0),
    late_submission_allowed  BOOLEAN NOT NULL DEFAULT false,
    late_penalty_percent     NUMERIC(5,2) NOT NULL DEFAULT 0
                                CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100),
    ai_config                JSONB,
    ai_source_material_ids   UUID[],
    created_by               UUID REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_assignments_ecue
    ON professional_assignments (tenant_id, ecue_id);
CREATE INDEX IF NOT EXISTS idx_prof_assignments_ue_session
    ON professional_assignments (tenant_id, ue_session_id);

CREATE TABLE IF NOT EXISTS professional_assignment_submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id   UUID NOT NULL REFERENCES professional_assignments(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    statut          VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                       CHECK (statut IN ('en_attente','soumis','en_correction','note','rejete')),
    file_url        TEXT,
    contenu         TEXT,
    note            NUMERIC(6,2),
    appreciation    TEXT,
    submitted_at    TIMESTAMPTZ,
    graded_at       TIMESTAMPTZ,
    graded_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_submissions_assignment
    ON professional_assignment_submissions (tenant_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_prof_submissions_student
    ON professional_assignment_submissions (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS professional_assignment_questions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id   UUID NOT NULL REFERENCES professional_assignments(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    type            VARCHAR(20) NOT NULL
                       CHECK (type IN ('mcq_single','mcq_multi','short_answer','long_answer','true_false')),
    question_text   TEXT NOT NULL,
    points          NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points > 0),
    options         JSONB,
    correct_answer  TEXT,
    explanation     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_assignment_questions_assignment
    ON professional_assignment_questions (tenant_id, assignment_id, position);

CREATE TABLE IF NOT EXISTS professional_assignment_question_answers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    submission_id       UUID NOT NULL REFERENCES professional_assignment_submissions(id) ON DELETE CASCADE,
    question_id         UUID NOT NULL REFERENCES professional_assignment_questions(id) ON DELETE CASCADE,
    answer_text         TEXT,
    selected_option_ids JSONB,
    is_correct          BOOLEAN,
    points_earned       NUMERIC(6,2),
    graded_manually     BOOLEAN NOT NULL DEFAULT false,
    feedback            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (submission_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_question_answers_submission
    ON professional_assignment_question_answers (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_prof_question_answers_question
    ON professional_assignment_question_answers (tenant_id, question_id);

-- ===========================================================================
-- 10. professional_ecue_results — Résultat ECUE par étudiant/cohorte.
--     validee = (moyenne >= 10) OU validee_manuellement (override tracé).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_ecue_results (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id              UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    student_id           UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    ue_session_id        UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    moyenne              NUMERIC(6,2),
    validee              BOOLEAN NOT NULL DEFAULT false,
    validee_manuellement BOOLEAN NOT NULL DEFAULT false,
    valide_par           UUID REFERENCES users(id),
    date_validation      TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, ecue_id, student_id, ue_session_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_results_session
    ON professional_ecue_results (tenant_id, ue_session_id);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_results_student
    ON professional_ecue_results (tenant_id, student_id);

-- ===========================================================================
-- 11. professional_enrollments — Inscription (repointée sur ue_session_id).
--     order_id → professional_orders (conservée), prix_unitaire = prix UE.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_enrollments (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES professional_orders(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES student_profiles(id),
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id),
    prix_unitaire NUMERIC(14,2) NOT NULL CHECK (prix_unitaire >= 0),
    statut        TEXT NOT NULL DEFAULT 'en_attente_paiement'
                    CHECK (statut IN ('en_attente_paiement','confirmee','terminee','annulee')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_order
    ON professional_enrollments (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_ue_session
    ON professional_enrollments (tenant_id, ue_session_id, statut);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_student
    ON professional_enrollments (tenant_id, student_id, statut);
-- Une seule inscription active (non annulée) par couple (étudiant, cohorte UE).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_enroll_active
    ON professional_enrollments (tenant_id, student_id, ue_session_id)
    WHERE statut <> 'annulee';

-- ===========================================================================
-- 12. Diplômes — composés d'UE (filiere_id, requirements = ue_id).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_diplomas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filiere_id  UUID NOT NULL REFERENCES programmes(id),
    code        VARCHAR(50) NOT NULL,
    libelle     VARCHAR(255) NOT NULL,
    description TEXT,
    uv_required INTEGER NOT NULL CHECK (uv_required > 0),
    statut      VARCHAR(20) NOT NULL DEFAULT 'actif'
                  CHECK (statut IN ('actif','inactif')),
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_professional_diplomas_tenant_filiere
    ON professional_diplomas (tenant_id, filiere_id);
CREATE INDEX IF NOT EXISTS idx_professional_diplomas_tenant_statut
    ON professional_diplomas (tenant_id, statut);

CREATE TABLE IF NOT EXISTS professional_diploma_requirements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    diploma_id      UUID NOT NULL REFERENCES professional_diplomas(id) ON DELETE CASCADE,
    ue_id           UUID NOT NULL REFERENCES professional_ue(id),
    est_obligatoire BOOLEAN NOT NULL DEFAULT false,
    ordre           INTEGER NOT NULL DEFAULT 0 CHECK (ordre >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (diploma_id, ue_id)
);
-- Validation applicative (service professional-diplomas) : ue_id de la même
-- filière que le diplôme.
CREATE INDEX IF NOT EXISTS idx_prof_diploma_req_diploma
    ON professional_diploma_requirements (tenant_id, diploma_id);
CREATE INDEX IF NOT EXISTS idx_prof_diploma_req_ue
    ON professional_diploma_requirements (tenant_id, ue_id);

CREATE TABLE IF NOT EXISTS student_professional_diplomas (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    diploma_id            UUID NOT NULL REFERENCES professional_diplomas(id),
    student_id            UUID NOT NULL REFERENCES student_profiles(id),
    reference             VARCHAR(50) NOT NULL,
    statut                VARCHAR(20) NOT NULL
                            CHECK (statut IN ('en_cours','obtenu','revoque')),
    uv_total_validees     INTEGER NOT NULL DEFAULT 0,
    requirements_snapshot JSONB,
    date_obtention        TIMESTAMPTZ,
    date_revocation       TIMESTAMPTZ,
    motif_revocation      TEXT,
    octroye_par           UUID REFERENCES users(id),
    revoque_par           UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_prof_diploma_active
    ON student_professional_diplomas (diploma_id, student_id)
    WHERE statut <> 'revoque';
CREATE INDEX IF NOT EXISTS idx_student_prof_diploma_diploma
    ON student_professional_diplomas (tenant_id, diploma_id, statut);
CREATE INDEX IF NOT EXISTS idx_student_prof_diploma_student
    ON student_professional_diplomas (tenant_id, student_id, statut);

-- ===========================================================================
-- 13. student_professional_ue_results — Capitalisation des UV par UE.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS student_professional_ue_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_id           UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    ue_session_id   UUID REFERENCES professional_ue_sessions(id) ON DELETE SET NULL,
    statut          TEXT NOT NULL DEFAULT 'en_cours'
                      CHECK (statut IN ('en_cours','validee','echec')),
    uv_acquises     INTEGER NOT NULL DEFAULT 0 CHECK (uv_acquises >= 0),
    date_validation TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, ue_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_student_prof_ue_results_student
    ON student_professional_ue_results (tenant_id, student_id, statut);
CREATE INDEX IF NOT EXISTS idx_student_prof_ue_results_ue
    ON student_professional_ue_results (tenant_id, ue_id);

-- ===========================================================================
-- 14. live_sessions — repointer la 3ᵉ colonne parent sur la séance ECUE.
--     L'ancienne colonne professional_subject_session_id (soft FK, 0066) est
--     supprimée ; nouvelle colonne professional_ecue_seance_id (soft FK).
-- ===========================================================================
DROP INDEX IF EXISTS idx_live_sessions_prof_subject_session;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS professional_subject_session_id;
ALTER TABLE live_sessions
    ADD COLUMN IF NOT EXISTS professional_ecue_seance_id UUID;
CREATE INDEX IF NOT EXISTS idx_live_sessions_prof_ecue_seance
    ON live_sessions(professional_ecue_seance_id);

DO $$ BEGIN
    ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_exactly_one_parent;
    ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_exactly_one_parent CHECK (
        (session_instance_id IS NOT NULL)::int
      + (session_professionnelle_id IS NOT NULL)::int
      + (professional_ecue_seance_id IS NOT NULL)::int
      = 1
    );
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================================================
-- 15. Row-Level Security — isolation multi-tenant (patron 0061).
-- ===========================================================================
ALTER TABLE professional_ecue                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ue                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ue_ecue                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ue_prerequisites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ue_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ecue_seances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ecue_attendance          ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ecue_materials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ecue_material_views      ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignment_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignment_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignment_question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_ecue_results             ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_enrollments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_diplomas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_diploma_requirements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_professional_diplomas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_professional_ue_results       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_ecue_tenant_isolation ON professional_ecue
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ue_tenant_isolation ON professional_ue
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ue_ecue_tenant_isolation ON professional_ue_ecue
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ue_prerequisites_tenant_isolation ON professional_ue_prerequisites
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ue_sessions_tenant_isolation ON professional_ue_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ecue_seances_tenant_isolation ON professional_ecue_seances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ecue_attendance_tenant_isolation ON professional_ecue_attendance
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ecue_materials_tenant_isolation ON professional_ecue_materials
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ecue_material_views_tenant_isolation ON professional_ecue_material_views
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignments_tenant_isolation ON professional_assignments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignment_submissions_tenant_isolation ON professional_assignment_submissions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignment_questions_tenant_isolation ON professional_assignment_questions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignment_question_answers_tenant_isolation ON professional_assignment_question_answers
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_ecue_results_tenant_isolation ON professional_ecue_results
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_enrollments_tenant_isolation ON professional_enrollments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_diplomas_tenant_isolation ON professional_diplomas
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY professional_diploma_requirements_tenant_isolation ON professional_diploma_requirements
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY student_professional_diplomas_tenant_isolation ON student_professional_diplomas
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY student_professional_ue_results_tenant_isolation ON student_professional_ue_results
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fin de la migration 0069_pedagogie_ue_ecue.sql
