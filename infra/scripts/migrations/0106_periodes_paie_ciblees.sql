-- =============================================================================
-- 0106 — Périodes de paie ciblées (collectives ou individuelles)
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- POURQUOI
-- Une période de paie s'appliquait jusqu'ici à TOUS les enseignants. Or la
-- régularisation d'un seul intervenant — un vacataire oublié, un rattrapage,
-- un solde de tout compte — obligeait à ouvrir une période pour tout
-- l'établissement, puis à recalculer 30 bulletins pour n'en vouloir qu'un.
--
-- `teacher_id` NULL signifie « collective » : c'est le comportement historique,
-- et c'est pourquoi la colonne est nullable plutôt que dotée d'un défaut. Les
-- 24 périodes déjà en base restent collectives sans aucune reprise de données.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- La règle « une seule période en attente à la fois » n'est PAS un index unique.
-- Elle dépend de l'existence de paiements rattachés (`teacher_payments`), donc
-- d'une autre table : aucune contrainte déclarative ne peut l'exprimer. Elle
-- vit dans le service, où le refus peut expliquer POURQUOI il refuse.
-- =============================================================================

BEGIN;

ALTER TABLE payment_periods
    ADD COLUMN IF NOT EXISTS teacher_id uuid NULL REFERENCES teachers(id) ON DELETE RESTRICT;

COMMENT ON COLUMN payment_periods.teacher_id IS
    'Enseignant visé par la période. NULL = période collective (tous les enseignants). '
    'ON DELETE RESTRICT : supprimer un enseignant ne doit pas faire disparaître '
    'silencieusement la période qui justifie ses bulletins.';

-- Les recherches se font toujours dans le périmètre d''un tenant, et le cas
-- « périodes de cet enseignant » est celui qu''on interroge le plus.
CREATE INDEX IF NOT EXISTS idx_payment_periods_tenant_teacher
    ON payment_periods (tenant_id, teacher_id);

-- Repérer la période en attente (celle qui bloque la création d''une suivante)
-- se fait par statut : autant que l''index le serve.
CREATE INDEX IF NOT EXISTS idx_payment_periods_tenant_status
    ON payment_periods (tenant_id, status);

COMMIT;
