-- =============================================================================
-- 1408 — Module higher : invariants imposés par la base (déclencheurs)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Registre de crédits : aucune colonne de contenu modifiable, jamais de DELETE. Seules transitions :
--   ACQUIRED -> REVOKED (motif obligatoire) | ACQUIRED -> EXPIRED.
-- Révoquer ou expirer une écriture sur laquelle s'appuie un octroi NON révoqué est REFUSÉ
-- (`higher.credit_in_use`) : la révocation du diplôme doit précéder (AC1.4).
-- -----------------------------------------------------------------------------
CREATE FUNCTION higher.credit_ledger_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: credit_ledger ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.ue_node_id <> OLD.ue_node_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.academic_period_id <> OLD.academic_period_id
     OR NEW.credits <> OLD.credits OR NEW.average_exact IS DISTINCT FROM OLD.average_exact OR NEW.acquired_via <> OLD.acquired_via
     OR NEW.session_obtained <> OLD.session_obtained OR NEW.compensated_ecue_count <> OLD.compensated_ecue_count
     OR NEW.override_id IS DISTINCT FROM OLD.override_id OR NEW.source_result_id <> OLD.source_result_id
     OR NEW.source_results_version <> OLD.source_results_version OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.acquired_at <> OLD.acquired_at THEN
    RAISE EXCEPTION 'higher.immutable: le contenu d''une acquisition de crédits ne se modifie pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'ACQUIRED' THEN
      RAISE EXCEPTION 'higher.ledger_transition: % est terminal', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM higher.diploma_awards a
       WHERE a.tenant_id = OLD.tenant_id AND a.student_id = OLD.student_id AND a.status = 'OBTAINED'
         AND a.requirements_snapshot -> 'requirements' @> jsonb_build_array(jsonb_build_object('ledgerId', OLD.id::text))
    ) THEN
      RAISE EXCEPTION 'higher.credit_in_use: un diplôme octroyé s''appuie sur cette acquisition' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
        OR NEW.expired_at IS DISTINCT FROM OLD.expired_at OR NEW.superseded_by_version IS DISTINCT FROM OLD.superseded_by_version THEN
    RAISE EXCEPTION 'higher.immutable: acquisition déjà dans son état final' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER credit_ledger_guard BEFORE UPDATE OR DELETE ON higher.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION higher.credit_ledger_guard();

-- Une dette n'est jamais supprimée.
CREATE TRIGGER ue_debts_no_delete BEFORE DELETE ON higher.ue_debts
  FOR EACH ROW EXECUTE FUNCTION higher.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Définition : suppression refusée s'il existe un octroi (même révoqué : valeur probante).
-- -----------------------------------------------------------------------------
CREATE FUNCTION higher.diploma_definitions_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM higher.diploma_awards a WHERE a.tenant_id = OLD.tenant_id AND a.definition_id = OLD.id) THEN
    RAISE EXCEPTION 'higher.definition_has_awards: une définition ayant des octrois ne se supprime pas (désactivez-la)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER diploma_definitions_no_delete BEFORE DELETE ON higher.diploma_definitions
  FOR EACH ROW EXECUTE FUNCTION higher.diploma_definitions_no_delete();

-- -----------------------------------------------------------------------------
-- Octrois : insertion (ré-octroi après révocation exceptionnel, Q-22) et mise à jour (terminale).
-- -----------------------------------------------------------------------------
CREATE FUNCTION higher.diploma_awards_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM higher.diploma_awards p
                WHERE p.tenant_id = NEW.tenant_id AND p.definition_id = NEW.definition_id AND p.student_id = NEW.student_id AND p.status = 'REVOKED')
       AND (NEW.predecessor_award_id IS NULL OR NEW.awarded_via = 'AUTO') THEN
      RAISE EXCEPTION 'higher.reaward_forbidden: un diplôme révoqué ne se ré-octroie que par décision écrite référencée (octroi manuel ou forcé)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.predecessor_award_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM higher.diploma_awards p
          WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.predecessor_award_id AND p.status = 'REVOKED'
            AND p.definition_id = NEW.definition_id AND p.student_id = NEW.student_id) THEN
      RAISE EXCEPTION 'higher.reaward_invalid_predecessor: le prédécesseur doit être un octroi révoqué de la même définition et du même étudiant'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: diploma_awards ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  -- UPDATE : contenu figé ; seule transition OBTAINED -> REVOKED.
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.definition_id <> OLD.definition_id OR NEW.student_id <> OLD.student_id
     OR NEW.last_enrollment_id IS DISTINCT FROM OLD.last_enrollment_id OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id
     OR NEW.reference <> OLD.reference OR NEW.reference_year <> OLD.reference_year OR NEW.reference_seq <> OLD.reference_seq
     OR NEW.awarded_via <> OLD.awarded_via OR NEW.forced_reason IS DISTINCT FROM OLD.forced_reason OR NEW.credits_total <> OLD.credits_total
     OR NEW.requirements_snapshot <> OLD.requirements_snapshot OR NEW.eligibility <> OLD.eligibility
     OR NEW.cycle_average IS DISTINCT FROM OLD.cycle_average OR NEW.mention_code IS DISTINCT FROM OLD.mention_code
     OR NEW.rule_set_code <> OLD.rule_set_code OR NEW.rule_version_id <> OLD.rule_version_id OR NEW.rule_version_no <> OLD.rule_version_no
     OR NEW.definition_hash <> OLD.definition_hash OR NEW.awarded_at <> OLD.awarded_at OR NEW.awarded_by IS DISTINCT FROM OLD.awarded_by
     OR NEW.awarded_by_name <> OLD.awarded_by_name OR NEW.acquired_date IS DISTINCT FROM OLD.acquired_date
     OR NEW.predecessor_award_id IS DISTINCT FROM OLD.predecessor_award_id OR NEW.reaward_decision IS DISTINCT FROM OLD.reaward_decision THEN
    RAISE EXCEPTION 'higher.immutable: le contenu d''un octroi ne se modifie pas (révoquez puis ré-octroyez)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (OLD.status = 'OBTAINED' AND NEW.status = 'REVOKED') THEN
      RAISE EXCEPTION 'higher.award_transition: % -> % interdit (la révocation est terminale)', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
        OR NEW.revoked_by_name IS DISTINCT FROM OLD.revoked_by_name OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason THEN
    RAISE EXCEPTION 'higher.immutable: octroi déjà dans son état final' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER diploma_awards_guard BEFORE INSERT OR UPDATE OR DELETE ON higher.diploma_awards
  FOR EACH ROW EXECUTE FUNCTION higher.diploma_awards_guard();

-- -----------------------------------------------------------------------------
-- Documents officiels : snapshot, empreinte, références, élève, octroi figés ; ne varient que le statut,
-- le scellement (une fois), le rendu, la publication et la révocation. Jamais de DELETE.
-- -----------------------------------------------------------------------------
CREATE FUNCTION higher.official_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: official_documents ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.document_kind <> OLD.document_kind OR NEW.award_id IS DISTINCT FROM OLD.award_id
     OR NEW.student_id <> OLD.student_id OR NEW.program_node_id IS DISTINCT FROM OLD.program_node_id
     OR NEW.reference <> OLD.reference OR NEW.reference_year <> OLD.reference_year OR NEW.reference_seq <> OLD.reference_seq
     OR NEW.version <> OLD.version OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.snapshot_schema <> OLD.snapshot_schema OR NEW.snapshot <> OLD.snapshot OR NEW.snapshot_hash <> OLD.snapshot_hash
     OR NEW.verification_code <> OLD.verification_code OR NEW.issued_at <> OLD.issued_at OR NEW.issued_by <> OLD.issued_by
     OR NEW.issued_by_name <> OLD.issued_by_name THEN
    RAISE EXCEPTION 'higher.immutable: un document officiel émis est immuable (révocation et réémission)' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Le scellement ne s'écrit qu'une fois.
  IF (OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature)
     OR (OLD.signing_key_id IS NOT NULL AND NEW.signing_key_id IS DISTINCT FROM OLD.signing_key_id) THEN
    RAISE EXCEPTION 'higher.immutable: la signature d''un document ne se modifie pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (OLD.status = 'ISSUED' AND NEW.status IN ('SUPERSEDED', 'REVOKED')) AND NOT (OLD.status = 'SUPERSEDED' AND NEW.status = 'REVOKED') THEN
      RAISE EXCEPTION 'higher.document_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD.status = 'REVOKED' AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'higher.immutable: document déjà révoqué' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER official_documents_guard BEFORE UPDATE OR DELETE ON higher.official_documents
  FOR EACH ROW EXECUTE FUNCTION higher.official_documents_guard();

-- Une révocation d'octroi révoque, dans la même transaction, ses documents encore valables (vérification publique « révoqué »).
CREATE FUNCTION higher.award_documents_follow_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'OBTAINED' AND NEW.status = 'REVOKED' THEN
    UPDATE higher.official_documents
       SET status = 'REVOKED', revoked_at = NEW.revoked_at, revoke_reason = NEW.revoke_reason
     WHERE tenant_id = NEW.tenant_id AND award_id = NEW.id AND status = 'ISSUED';
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER award_documents_follow_revocation AFTER UPDATE ON higher.diploma_awards
  FOR EACH ROW EXECUTE FUNCTION higher.award_documents_follow_revocation();

-- -----------------------------------------------------------------------------
-- Emplacements de signature : historique conservé. On clôt (valid_to) ; rien d'autre ne change, jamais de DELETE.
-- -----------------------------------------------------------------------------
CREATE FUNCTION higher.official_document_slots_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: l''historique des affectations de signataires est conservé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.slot_key <> OLD.slot_key OR NEW.signatory_id <> OLD.signatory_id
     OR NEW.valid_from <> OLD.valid_from OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'higher.immutable: seule la fin de validité d''une affectation peut changer' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER official_document_slots_guard BEFORE UPDATE OR DELETE ON higher.official_document_slots
  FOR EACH ROW EXECUTE FUNCTION higher.official_document_slots_guard();
