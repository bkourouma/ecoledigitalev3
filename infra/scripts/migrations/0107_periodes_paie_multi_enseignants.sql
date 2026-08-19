-- =============================================================================
-- 0107 — Une période de paie peut viser PLUSIEURS enseignants
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- POURQUOI REMPLACER `payment_periods.teacher_id`
-- La 0106 avait introduit un `teacher_id` unique : une période visait soit tout
-- l'établissement, soit un seul enseignant. Le besoin réel est intermédiaire —
-- régulariser un GROUPE (les trois vacataires d'un semestre, les enseignants
-- d'une filière) sans ouvrir une période pour les trente.
--
-- Une colonne scalaire ne peut pas porter un ensemble. On passe donc par une
-- table de liaison, et la colonne disparaît : la garder à côté donnerait DEUX
-- façons d'exprimer la même chose, et un jour les deux ne diraient plus pareil.
--
-- CONVENTION DE PÉRIMÈTRE
--   aucune ligne  -> période COLLECTIVE (tous les enseignants)
--   N lignes      -> période CIBLÉE sur ces N enseignants
--
-- L'absence vaut « tous » : c'est le comportement historique, et les 24
-- périodes déjà en base restent collectives sans reprise de données.
--
-- SÛRETÉ DE LA BASCULE
-- Aucune période n'utilisait `teacher_id` au moment de cette migration (la
-- 0106 datait du jour même). Le INSERT ... SELECT ci-dessous est donc un
-- filet : il reporte les valeurs s'il y en a, et ne fait rien sinon.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payment_period_teachers (
    tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_period_id  uuid        NOT NULL REFERENCES payment_periods(id) ON DELETE CASCADE,
    -- RESTRICT : supprimer un enseignant ne doit pas retirer silencieusement
    -- le périmètre qui justifie ses bulletins.
    teacher_id         uuid        NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_period_id, teacher_id)
);

COMMENT ON TABLE payment_period_teachers IS
    'Périmètre d''une période de paie. Aucune ligne = période collective '
    '(tous les enseignants) ; N lignes = période ciblée sur ces enseignants.';

-- ON DELETE CASCADE sur la période : supprimer une période emporte son
-- périmètre, qui n''a aucun sens sans elle.
CREATE INDEX IF NOT EXISTS idx_ppt_tenant_teacher
    ON payment_period_teachers (tenant_id, teacher_id);

-- Report des éventuelles valeurs de la 0106.
INSERT INTO payment_period_teachers (tenant_id, payment_period_id, teacher_id)
SELECT pp.tenant_id, pp.id, pp.teacher_id
  FROM payment_periods pp
 WHERE pp.teacher_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE payment_periods DROP COLUMN IF EXISTS teacher_id;
DROP INDEX IF EXISTS idx_payment_periods_tenant_teacher;

-- Isolation multi-tenant, alignée sur payment_periods.
ALTER TABLE payment_period_teachers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY tenant_isolation_policy ON payment_period_teachers
        FOR ALL
        USING (app_is_super_admin_context() OR (tenant_id = app_current_tenant_id()))
        WITH CHECK (app_is_super_admin_context() OR (tenant_id = app_current_tenant_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
