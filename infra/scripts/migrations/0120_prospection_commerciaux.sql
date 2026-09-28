-- 0120 — Prospection : provenance des étudiants, commerciaux et commissions
--
-- Objectif : savoir comment chaque étudiant nous est arrivé, et rémunérer les
-- commerciaux qui en amènent.
--
-- Trois tables :
--   * `commerciaux`            — la liste se construit au fil des saisies ;
--   * `student_provenances`    — UNE provenance par étudiant (le canal), et le
--                                référent quand il y en a un ;
--   * `commissions_versements` — ce qui a été effectivement payé au commercial.
--
-- La commission n'est PAS stockée : elle se recalcule à partir de la ligne
-- « Scolarité » du barème effectivement encaissée par l'étudiant (commandes de
-- nature `ue` ou `scolarite`, paiements confirmés) × le taux figé sur sa
-- provenance. Un montant stocké se serait désynchronisé au premier
-- remboursement. Seul le taux est figé : renégocier avec un commercial ne doit
-- pas réécrire ce qui lui est déjà dû sur les étudiants déjà amenés.
--
-- Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Commerciaux
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commerciaux (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nom VARCHAR(255) NOT NULL,
    telephone VARCHAR(30),
    email VARCHAR(255),
    -- Taux proposé par défaut quand ce commercial est choisi sur une nouvelle
    -- provenance. Modifiable étudiant par étudiant au moment de la saisie.
    taux_commission NUMERIC(5, 2) NOT NULL DEFAULT 5,
    actif BOOLEAN NOT NULL DEFAULT true,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT commerciaux_nom_unique_per_tenant UNIQUE (tenant_id, nom),
    CONSTRAINT commerciaux_taux_check CHECK (taux_commission >= 0 AND taux_commission <= 100)
);

CREATE INDEX IF NOT EXISTS idx_commerciaux_tenant ON commerciaux(tenant_id, actif);

ALTER TABLE commerciaux ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commerciaux_tenant_policy ON commerciaux;
CREATE POLICY commerciaux_tenant_policy ON commerciaux
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_commerciaux_updated_at ON commerciaux;
CREATE TRIGGER update_commerciaux_updated_at
    BEFORE UPDATE ON commerciaux
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Provenance de l'étudiant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_provenances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    canal TEXT NOT NULL,
    -- Renseigné pour le canal « commercial » uniquement : lui seul ouvre droit
    -- à commission.
    commercial_id UUID REFERENCES commerciaux(id) ON DELETE RESTRICT,
    taux_commission NUMERIC(5, 2),
    -- Référent sans commission : une connaissance (nom libre) ou un étudiant
    -- déjà inscrit (fiche existante).
    referent_nom VARCHAR(255),
    referent_student_id UUID REFERENCES student_profiles(id) ON DELETE SET NULL,
    -- Précision libre pour les canaux qui en réclament une.
    media_detail VARCHAR(255),
    note TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT student_provenances_unique_per_student UNIQUE (tenant_id, student_id),
    CONSTRAINT student_provenances_canal_check CHECK (
        canal IN ('google', 'facebook', 'autre_media', 'commercial', 'connaissance', 'etudiant')
    ),
    -- Un commercial et son taux vont ensemble, et seulement sur ce canal.
    CONSTRAINT student_provenances_commercial_check CHECK (
        (canal = 'commercial' AND commercial_id IS NOT NULL AND taux_commission IS NOT NULL)
        OR (canal <> 'commercial' AND commercial_id IS NULL AND taux_commission IS NULL)
    ),
    CONSTRAINT student_provenances_taux_check CHECK (
        taux_commission IS NULL OR (taux_commission >= 0 AND taux_commission <= 100)
    ),
    -- Le référent-étudiant n'est pas l'étudiant lui-même.
    CONSTRAINT student_provenances_referent_not_self CHECK (
        referent_student_id IS NULL OR referent_student_id <> student_id
    )
);

CREATE INDEX IF NOT EXISTS idx_student_provenances_tenant_canal
    ON student_provenances(tenant_id, canal);
CREATE INDEX IF NOT EXISTS idx_student_provenances_commercial
    ON student_provenances(tenant_id, commercial_id)
    WHERE commercial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_provenances_student
    ON student_provenances(tenant_id, student_id);

ALTER TABLE student_provenances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_provenances_tenant_policy ON student_provenances;
CREATE POLICY student_provenances_tenant_policy ON student_provenances
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_student_provenances_updated_at ON student_provenances;
CREATE TRIGGER update_student_provenances_updated_at
    BEFORE UPDATE ON student_provenances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Règlements de commissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commissions_versements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Le commercial n'est pas supprimable tant qu'il reste un règlement : cet
    -- historique est une pièce comptable.
    commercial_id UUID NOT NULL REFERENCES commerciaux(id) ON DELETE RESTRICT,
    montant NUMERIC(14, 2) NOT NULL,
    mode TEXT NOT NULL DEFAULT 'especes',
    reference TEXT,
    paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    note TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT commissions_versements_montant_check CHECK (montant > 0),
    CONSTRAINT commissions_versements_mode_check CHECK (
        mode IN ('especes', 'mobile_money', 'virement', 'autre')
    )
);

CREATE INDEX IF NOT EXISTS idx_commissions_versements_commercial
    ON commissions_versements(tenant_id, commercial_id, paid_at DESC);

ALTER TABLE commissions_versements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commissions_versements_tenant_policy ON commissions_versements;
CREATE POLICY commissions_versements_tenant_policy ON commissions_versements
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_commissions_versements_updated_at ON commissions_versements;
CREATE TRIGGER update_commissions_versements_updated_at
    BEFORE UPDATE ON commissions_versements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
