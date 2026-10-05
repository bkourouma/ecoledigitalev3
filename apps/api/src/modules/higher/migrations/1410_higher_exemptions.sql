-- =============================================================================
-- 1410 — Module higher : dispense d'UE manuelle avec motif (direction) — décision O-14
-- =============================================================================
--
-- Une dispense d'UE est une décision HUMAINE (direction) : l'étudiant est dispensé de suivre / valider une UE. Elle est
-- motivée (>= 10 caractères), tracée (auteur, date, audit sensible, événement) et RÉVOCABLE (motif).
--
-- Impact sur les crédits et la validation : PARAMÈTRE de l'établissement `higher.settings.exemption_credit_policy`
-- (jamais une règle codée) :
--   RECORD_ONLY    (défaut) la dispense est seulement enregistrée : aucune écriture au registre de crédits, aucun effet
--                  sur la validation ni sur l'éligibilité au diplôme ;
--   GRANT_CREDITS  la dispense inscrit au registre une acquisition `acquired_via = 'EXEMPTION'` (crédits de l'UE figés à
--                  la dispense) : l'UE compte comme acquise (prérequis, attestation, éligibilité au diplôme).
-- La politique APPLIQUÉE est figée sur la dispense (`credit_policy`) : changer le paramètre plus tard ne réécrit rien.
--
-- Migration ADDITIVE : la colonne de réglage a une valeur par défaut qui ne change aucun comportement existant.
-- =============================================================================

ALTER TABLE higher.settings
  ADD COLUMN exemption_credit_policy text NOT NULL DEFAULT 'RECORD_ONLY' CHECK (exemption_credit_policy IN ('RECORD_ONLY', 'GRANT_CREDITS'));

CREATE TABLE higher.ue_exemptions (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id          uuid NOT NULL,
  enrollment_id       uuid NOT NULL,                              -- inscription au cours de laquelle la dispense est accordée
  ue_node_id          uuid NOT NULL,                              -- lignée de l'UE
  academic_year_id    uuid NOT NULL,
  academic_period_id  uuid NOT NULL,                              -- semestre de rattachement (écriture au registre)
  credits             numeric(8,2) NOT NULL CHECK (credits >= 0), -- crédits de l'UE FIGÉS à la dispense
  reason              text NOT NULL CHECK (length(btrim(reason)) >= 10),
  credit_policy       text NOT NULL CHECK (credit_policy IN ('RECORD_ONLY', 'GRANT_CREDITS')),
  ledger_id           uuid,                                       -- écriture du registre si GRANT_CREDITS
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_by          uuid NOT NULL,
  granted_at          timestamptz NOT NULL,
  revoked_by          uuid,
  revoked_at          timestamptz,
  revoke_reason       text,
  UNIQUE (tenant_id, id),
  CHECK (credit_policy <> 'GRANT_CREDITS' OR ledger_id IS NOT NULL),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 10))
);
-- UNE dispense active par (étudiant, UE)
CREATE UNIQUE INDEX ue_exemptions_active_uq ON higher.ue_exemptions (tenant_id, student_id, ue_node_id) WHERE status = 'ACTIVE';
CREATE INDEX ue_exemptions_student_idx ON higher.ue_exemptions (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('higher.ue_exemptions');
GRANT SELECT, INSERT, UPDATE ON higher.ue_exemptions TO app_user;               -- jamais DELETE

-- Contenu figé : seule la révocation (ACTIVE -> REVOKED) modifie une dispense, une fois.
CREATE FUNCTION higher.ue_exemptions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: ue_exemptions ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.student_id <> OLD.student_id OR NEW.ue_node_id <> OLD.ue_node_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.academic_period_id <> OLD.academic_period_id OR NEW.credits <> OLD.credits
     OR NEW.reason <> OLD.reason OR NEW.credit_policy <> OLD.credit_policy OR NEW.ledger_id IS DISTINCT FROM OLD.ledger_id
     OR NEW.granted_by <> OLD.granted_by OR NEW.granted_at <> OLD.granted_at THEN
    RAISE EXCEPTION 'higher.immutable: le contenu d''une dispense est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'REVOKED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'higher.immutable: une dispense révoquée est terminale' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ue_exemptions_guard BEFORE UPDATE OR DELETE ON higher.ue_exemptions
  FOR EACH ROW EXECUTE FUNCTION higher.ue_exemptions_guard();
