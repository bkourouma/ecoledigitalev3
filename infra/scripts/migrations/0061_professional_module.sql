-- 0061_professional_module.sql
-- Feature 028-professional-module — Module Professionnel (inscription à la carte).
--
-- Crée les 6 tables `professional_*` avec isolation multi-tenant (Row-Level
-- Security), index et contraintes, conformément à
-- specs/028-professional-module/data-model.md.
--
-- Cette migration est IDEMPOTENTE (CREATE ... IF NOT EXISTS, policies en
-- DO $$ ... EXCEPTION WHEN duplicate_object) et NON DESTRUCTIVE (aucun DROP,
-- aucune modification de table existante). Elle peut être rejouée sans risque.
--
-- Contexte tenant : GUC `app.tenant_id`, positionné sur chaque connexion par
-- le plugin apps/api/src/plugins/rls-context.ts.
-- Note : `updated_at` est maintenu par la couche de service (pas de trigger).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 4.1 professional_subjects — Matière professionnelle
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_subjects (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    programme_id UUID NOT NULL REFERENCES programmes(id),
    code         TEXT NOT NULL,
    libelle      TEXT NOT NULL,
    description  TEXT,
    nb_uv        INTEGER NOT NULL DEFAULT 0 CHECK (nb_uv >= 0),
    prix         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (prix >= 0),
    statut       TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_professional_subjects_tenant_programme
    ON professional_subjects (tenant_id, programme_id);
CREATE INDEX IF NOT EXISTS idx_professional_subjects_tenant_statut
    ON professional_subjects (tenant_id, statut);

-- ===========================================================================
-- 4.2 professional_subject_prerequisites — Prérequis entre matières
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_subject_prerequisites (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_subject_id UUID NOT NULL REFERENCES professional_subjects(id) ON DELETE CASCADE,
    prerequisite_subject_id UUID NOT NULL REFERENCES professional_subjects(id) ON DELETE CASCADE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (professional_subject_id <> prerequisite_subject_id),
    UNIQUE (tenant_id, professional_subject_id, prerequisite_subject_id)
);
-- Validation applicative complémentaire (service professional-catalog) :
-- même programme pour les deux matières + graphe acyclique (détection de cycle).
CREATE INDEX IF NOT EXISTS idx_prof_prereq_subject
    ON professional_subject_prerequisites (tenant_id, professional_subject_id);
CREATE INDEX IF NOT EXISTS idx_prof_prereq_prerequisite
    ON professional_subject_prerequisites (tenant_id, prerequisite_subject_id);

-- ===========================================================================
-- 4.3 professional_subject_sessions — Session / Cours professionnel
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_subject_sessions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_subject_id UUID NOT NULL REFERENCES professional_subjects(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_prof_sessions_subject
    ON professional_subject_sessions (tenant_id, professional_subject_id);
CREATE INDEX IF NOT EXISTS idx_prof_sessions_enrollable
    ON professional_subject_sessions (tenant_id, statut, inscription_ouverte_le, inscription_fermee_le);

-- ===========================================================================
-- 4.4 professional_orders — Commande / Panier
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_orders (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES student_profiles(id),
    reference     TEXT NOT NULL,
    montant_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (montant_total >= 0),
    devise        TEXT NOT NULL DEFAULT 'XOF',
    statut        TEXT NOT NULL DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon','en_attente_paiement','payee','annulee')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_prof_orders_student
    ON professional_orders (tenant_id, student_id, statut);
-- Au plus un panier (commande 'brouillon') courant par étudiant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_order_cart
    ON professional_orders (tenant_id, student_id)
    WHERE statut = 'brouillon';

-- ===========================================================================
-- 4.5 professional_enrollments — Inscription (ligne de commande)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_enrollments (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES professional_orders(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES student_profiles(id),
    session_id    UUID NOT NULL REFERENCES professional_subject_sessions(id),
    prix_unitaire NUMERIC(14,2) NOT NULL CHECK (prix_unitaire >= 0),
    statut        TEXT NOT NULL DEFAULT 'en_attente_paiement'
                    CHECK (statut IN ('en_attente_paiement','confirmee','terminee','annulee')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_order
    ON professional_enrollments (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_session
    ON professional_enrollments (tenant_id, session_id, statut);
CREATE INDEX IF NOT EXISTS idx_prof_enroll_student
    ON professional_enrollments (tenant_id, student_id, statut);
-- Une seule inscription active (non annulée) par couple (étudiant, session).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_enroll_active
    ON professional_enrollments (tenant_id, student_id, session_id)
    WHERE statut <> 'annulee';

-- ===========================================================================
-- 4.6 professional_payments — Paiement
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_payments (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id              UUID NOT NULL REFERENCES professional_orders(id) ON DELETE CASCADE,
    montant               NUMERIC(14,2) NOT NULL CHECK (montant >= 0),
    mode                  TEXT NOT NULL CHECK (mode IN ('especes','mobile_money','virement','autre')),
    reference_transaction TEXT,
    statut                TEXT NOT NULL DEFAULT 'initie'
                            CHECK (statut IN ('initie','confirme','echoue','rembourse')),
    paid_at               TIMESTAMPTZ,
    receipt_number        TEXT,
    receipt_url           TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_payments_order
    ON professional_payments (tenant_id, order_id);
-- Idempotence du paiement : une référence de transaction unique par tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_payment_txref
    ON professional_payments (tenant_id, reference_transaction)
    WHERE reference_transaction IS NOT NULL;
-- Numéro de reçu unique par tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_payment_receipt
    ON professional_payments (tenant_id, receipt_number)
    WHERE receipt_number IS NOT NULL;

-- ===========================================================================
-- Row-Level Security — isolation multi-tenant
-- Patron repris de 0060_registration_requests.sql (GUC app.tenant_id).
-- ===========================================================================
ALTER TABLE professional_subjects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_subject_prerequisites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_subject_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_enrollments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_payments               ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_subjects_tenant_isolation ON professional_subjects
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_subject_prerequisites_tenant_isolation ON professional_subject_prerequisites
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_subject_sessions_tenant_isolation ON professional_subject_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_orders_tenant_isolation ON professional_orders
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_enrollments_tenant_isolation ON professional_enrollments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_payments_tenant_isolation ON professional_payments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fin de la migration 0061_professional_module.sql
