-- =============================================================================
-- 0108 — Archivage des bulletins de paie
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- POURQUOI UNE COLONNE ET PAS UN STATUT
-- `teacher_payments.status` décrit le cycle de vie FINANCIER du paiement
-- (calculé, approuvé, payé, contesté, annulé). L'archivage est une notion
-- ORTHOGONALE : il dit « ce bulletin est classé, il quitte le plan de travail ».
--
-- Un bulletin payé peut rester à traiter, un bulletin simplement calculé peut
-- être archivé. Ajouter « archived » à l'énumération obligerait à choisir entre
-- les deux informations et perdrait le statut financier au moment du classement
-- — exactement ce qu'un historique doit conserver.
--
-- CE QUE L'ARCHIVAGE CHANGE
--   - l'écran « Bulletins de paie » ne montre plus le bulletin ;
--   - il apparaît dans l'historique, le plus récent en premier ;
--   - les heures qu'il a consommées restent rattachées (payment_hour_details),
--     donc décomptées des heures « à payer ». L'archivage ne libère RIEN :
--     il classe, il n'annule pas.
-- =============================================================================

BEGIN;

ALTER TABLE teacher_payments
    ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN teacher_payments.archived_at IS
    'Date de classement du bulletin. NULL = encore dans le plan de travail. '
    'Orthogonal à `status`, qui décrit le cycle de vie financier.';
COMMENT ON COLUMN teacher_payments.archived_by IS
    'Auteur du classement. ON DELETE SET NULL : la suppression d''un compte ne '
    'doit pas emporter le bulletin qu''il a archivé.';

-- L'écran de travail filtre systématiquement sur « non archivé », et
-- l'historique sur l'inverse : un index partiel sert les deux sens.
CREATE INDEX IF NOT EXISTS idx_teacher_payments_actifs
    ON teacher_payments (tenant_id, payment_period_id)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_payments_archives
    ON teacher_payments (tenant_id, teacher_id, archived_at DESC)
    WHERE archived_at IS NOT NULL;

COMMIT;
