-- =============================================================================
-- 1203 — Module results : invariants imposés par la base (défense en profondeur)
-- =============================================================================
--
-- Un résultat FINAL est IMMUABLE pour tout rôle, superuser compris (un déclencheur ne se contourne pas par un rôle
-- puissant) : il ne peut qu'être marqué SUPERSEDED par la clôture suivante. Codes d'erreur stables en PRÉFIXE du message
-- (`results.<code>: …`, ERRCODE restrict_violation 23001).

CREATE FUNCTION results.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'results.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER closures_immutable BEFORE UPDATE OR DELETE ON results.closures
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();
CREATE TRIGGER period_states_no_delete BEFORE DELETE ON results.period_states
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();
CREATE TRIGGER overrides_no_delete BEFORE DELETE ON results.overrides
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON results.decisions
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();
CREATE TRIGGER deliberations_no_delete BEFORE DELETE ON results.deliberations
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();
CREATE TRIGGER appreciations_no_delete BEFORE DELETE ON results.appreciations
  FOR EACH ROW EXECUTE FUNCTION results.forbid_mutation();

-- État (statut) d'une période / année : utilisé par les gardes des tables filles.
CREATE FUNCTION results.state_status(p_tenant uuid, p_state uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT s.status FROM results.period_states s WHERE s.tenant_id = p_tenant AND s.id = p_state
$$;
REVOKE ALL ON FUNCTION results.state_status(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION results.state_status(uuid, uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- États de période : machine à états, identité et PIN de la version de règle figés hors OPEN.
--   OPEN -> GRADING_LOCKED ; GRADING_LOCKED -> DELIBERATED | CLOSED | OPEN ; DELIBERATED -> CLOSED | GRADING_LOCKED | OPEN ;
--   CLOSED -> OPEN (réouverture : compteur, nature et motif obligatoires).
-- La version des résultats ne croît qu'avec une CLÔTURE, et une clôture correspondante doit exister.
-- -----------------------------------------------------------------------------
CREATE FUNCTION results.period_states_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.results_version <> 0 THEN
      RAISE EXCEPTION 'results.invalid_initial_state: un état de période naît OPEN, sans résultats finaux' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.tenant_id, NEW.classroom_id, NEW.academic_period_id, NEW.academic_year_id, NEW.scope, NEW.contract_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.classroom_id, OLD.academic_period_id, OLD.academic_year_id, OLD.scope, OLD.contract_id, OLD.created_at) THEN
    RAISE EXCEPTION 'results.state_identity_immutable: l''identité d''un état de période est figée' USING ERRCODE = 'restrict_violation';
  END IF;

  IF ROW(NEW.rule_version_kind, NEW.rule_version_id, NEW.rule_set_code, NEW.rule_version_no, NEW.definition_hash)
     IS DISTINCT FROM ROW(OLD.rule_version_kind, OLD.rule_version_id, OLD.rule_set_code, OLD.rule_version_no, OLD.definition_hash)
     AND OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'results.pin_frozen: la version de règle épinglée ne change que sur une période ouverte' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'OPEN'           AND NEW.status = 'GRADING_LOCKED') OR
         (OLD.status = 'GRADING_LOCKED' AND NEW.status IN ('DELIBERATED', 'CLOSED', 'OPEN')) OR
         (OLD.status = 'DELIBERATED'    AND NEW.status IN ('CLOSED', 'GRADING_LOCKED', 'OPEN')) OR
         (OLD.status = 'CLOSED'         AND NEW.status = 'OPEN')) THEN
      RAISE EXCEPTION 'results.invalid_state_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'CLOSED' THEN
      IF NEW.reopen_count <> OLD.reopen_count + 1 OR NEW.last_reopen_kind IS NULL OR length(btrim(coalesce(NEW.last_reopen_reason, ''))) < 10 THEN
        RAISE EXCEPTION 'results.reopen_requires_reason: une réouverture porte sa nature, un motif (10 caractères au moins) et incrémente le compteur' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'CLOSED' AND ROW(NEW.locked_at, NEW.deliberated_at, NEW.closed_at, NEW.closed_by, NEW.reopen_count, NEW.results_version)
         IS DISTINCT FROM ROW(OLD.locked_at, OLD.deliberated_at, OLD.closed_at, OLD.closed_by, OLD.reopen_count, OLD.results_version) THEN
    RAISE EXCEPTION 'results.state_closed: une période clôturée ne se modifie plus' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.results_version <> OLD.results_version THEN
    IF NEW.status <> 'CLOSED' OR OLD.status = 'CLOSED' OR NEW.results_version <> OLD.results_version + 1
       OR NOT EXISTS (SELECT 1 FROM results.closures c WHERE c.tenant_id = NEW.tenant_id AND c.state_id = NEW.id AND c.results_version = NEW.results_version) THEN
      RAISE EXCEPTION 'results.version_requires_closure: la version des résultats ne croît qu''avec une clôture enregistrée' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.status = 'CLOSED' AND OLD.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'results.version_requires_closure: une clôture crée une nouvelle version des résultats' USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.row_version := OLD.row_version + 1;
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER period_states_guard BEFORE INSERT OR UPDATE ON results.period_states
  FOR EACH ROW EXECUTE FUNCTION results.period_states_guard();

-- -----------------------------------------------------------------------------
-- Résultats : un FINAL ne naît que d'une clôture, ne change plus, et ne peut que devenir SUPERSEDED.
-- -----------------------------------------------------------------------------
CREATE FUNCTION results.period_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_closure results.closures%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'results.final_immutable: un résultat final (ou remplacé) ne se supprime jamais' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  v_state := results.state_status(NEW.tenant_id, NEW.state_id);
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'results.state_not_found: état de période introuvable' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'FINAL' THEN
      SELECT * INTO v_closure FROM results.closures c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.closure_id;
      IF NOT FOUND OR v_closure.state_id <> NEW.state_id THEN
        RAISE EXCEPTION 'results.final_requires_closure: un résultat final naît d''une clôture de la même période' USING ERRCODE = 'restrict_violation';
      END IF;
      IF v_state = 'CLOSED' THEN
        RAISE EXCEPTION 'results.state_closed: la période est déjà clôturée' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status IN ('DRAFT', 'ERROR') THEN
      IF v_state = 'CLOSED' THEN
        RAISE EXCEPTION 'results.state_closed: aucun calcul provisoire sur une période clôturée' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'results.invalid_status: un résultat naît DRAFT, ERROR ou FINAL' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'results.final_immutable: un résultat remplacé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'FINAL' THEN
    IF NEW.status <> 'SUPERSEDED' OR NEW.superseded_at IS NULL OR
       ROW(NEW.id, NEW.tenant_id, NEW.state_id, NEW.enrollment_id, NEW.student_id, NEW.version, NEW.contract_id, NEW.rule_version_id, NEW.definition_hash, NEW.engine_version,
           NEW.inputs_hash, NEW.outputs_hash, NEW.inputs, NEW.average, NEW.average_display, NEW.rank, NEW.cohort_size, NEW.mention_code, NEW.decision_code, NEW.decision_outcome,
           NEW.credits_acquired, NEW.credits_required, NEW.validated, NEW.summary, NEW.closure_id, NEW.line_count, NEW.finalized_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.state_id, OLD.enrollment_id, OLD.student_id, OLD.version, OLD.contract_id, OLD.rule_version_id, OLD.definition_hash, OLD.engine_version,
           OLD.inputs_hash, OLD.outputs_hash, OLD.inputs, OLD.average, OLD.average_display, OLD.rank, OLD.cohort_size, OLD.mention_code, OLD.decision_code, OLD.decision_outcome,
           OLD.credits_acquired, OLD.credits_required, OLD.validated, OLD.summary, OLD.closure_id, OLD.line_count, OLD.finalized_at) THEN
      RAISE EXCEPTION 'results.final_immutable: un résultat final ne peut que devenir SUPERSEDED' USING ERRCODE = 'restrict_violation';
    END IF;
    IF v_state = 'CLOSED' THEN
      RAISE EXCEPTION 'results.state_closed: la période est clôturée : rouvrez-la pour produire une nouvelle version' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- DRAFT / ERROR : modifiables tant que la période est ouverte ; jamais promus FINAL par UPDATE
  IF NEW.status = 'FINAL' THEN
    RAISE EXCEPTION 'results.final_requires_closure: un résultat final naît d''une clôture, jamais d''une mise à jour' USING ERRCODE = 'restrict_violation';
  END IF;
  -- un brouillon périmé peut être marqué SUPERSEDED à la clôture (période verrouillée) ; tout autre calcul exige OPEN
  IF v_state = 'CLOSED' THEN
    RAISE EXCEPTION 'results.state_closed: aucun calcul provisoire sur une période clôturée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.state_id, NEW.enrollment_id, NEW.version) IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.state_id, OLD.enrollment_id, OLD.version) THEN
    RAISE EXCEPTION 'results.identity_immutable: l''identité d''un résultat est figée' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER period_results_guard BEFORE INSERT OR UPDATE OR DELETE ON results.period_results
  FOR EACH ROW EXECUTE FUNCTION results.period_results_guard();

CREATE FUNCTION results.line_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  h results.period_results%ROWTYPE;
  v_state text;
  v_lines integer;
BEGIN
  SELECT * INTO h FROM results.period_results r
   WHERE r.tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
     AND r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.period_result_id ELSE NEW.period_result_id END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'results.result_not_found: en-tête de résultat introuvable' USING ERRCODE = 'restrict_violation';
  END IF;
  v_state := results.state_status(h.tenant_id, h.state_id);

  IF h.status = 'SUPERSEDED' AND h.finalized_at IS NULL THEN
    -- brouillon périmé : ses lignes ne changent plus, mais la purge (90 jours) peut les supprimer avec lui
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'results.final_immutable: les lignes d''un résultat remplacé ne changent plus' USING ERRCODE = 'restrict_violation';
  END IF;

  IF h.status = 'FINAL' OR h.finalized_at IS NOT NULL THEN
    -- Lignes d'un résultat final : insérées UNE fois, avec l'en-tête, jusqu'au nombre scellé ; jamais modifiées ni supprimées.
    IF TG_OP = 'INSERT' THEN
      SELECT count(*) INTO v_lines FROM results.line_results l WHERE l.tenant_id = h.tenant_id AND l.period_result_id = h.id;
      IF h.status <> 'FINAL' OR v_state = 'CLOSED' OR h.line_count IS NULL OR v_lines >= h.line_count THEN
        RAISE EXCEPTION 'results.final_immutable: les lignes d''un résultat final sont scellées' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'results.final_immutable: les lignes d''un résultat final sont immuables' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_state = 'CLOSED' THEN
    RAISE EXCEPTION 'results.state_closed: aucun calcul provisoire sur une période clôturée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER line_results_guard BEFORE INSERT OR UPDATE OR DELETE ON results.line_results
  FOR EACH ROW EXECUTE FUNCTION results.line_results_guard();

-- -----------------------------------------------------------------------------
-- Surcharges : contenu immuable ; REQUESTED -> APPROVED | REJECTED | REVOKED ; APPROVED -> REVOKED ; rien sur une période clôturée.
-- -----------------------------------------------------------------------------
CREATE FUNCTION results.overrides_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF results.state_status(NEW.tenant_id, NEW.state_id) = 'CLOSED' THEN
    RAISE EXCEPTION 'results.state_closed: la période est clôturée : rouvrez-la pour surcharger un résultat' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'results.override_transition: une surcharge naît à l''état REQUESTED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.state_id, NEW.enrollment_id, NEW.level, NEW.curriculum_node_id, NEW.rule_key, NEW.kind, NEW.original_value,
         NEW.override_value, NEW.override_flag, NEW.justification, NEW.requested_by, NEW.requested_by_name, NEW.requested_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.state_id, OLD.enrollment_id, OLD.level, OLD.curriculum_node_id, OLD.rule_key, OLD.kind, OLD.original_value,
         OLD.override_value, OLD.override_flag, OLD.justification, OLD.requested_by, OLD.requested_by_name, OLD.requested_at) THEN
    RAISE EXCEPTION 'results.override_immutable: le contenu d''une surcharge ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'REVOKED')) OR
       (OLD.status = 'APPROVED'  AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'results.override_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status AND ROW(NEW.decided_by, NEW.decided_at, NEW.decision_comment, NEW.revoked_reason, NEW.four_eyes_waived)
                                IS DISTINCT FROM ROW(OLD.decided_by, OLD.decided_at, OLD.decision_comment, OLD.revoked_reason, OLD.four_eyes_waived) THEN
    RAISE EXCEPTION 'results.override_immutable: la décision sur une surcharge ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER overrides_guard BEFORE INSERT OR UPDATE ON results.overrides
  FOR EACH ROW EXECUTE FUNCTION results.overrides_guard();

-- Décisions : la proposition de la règle est conservée ; rien ne change après clôture, sauf la publication (013).
CREATE FUNCTION results.decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF results.state_status(NEW.tenant_id, NEW.state_id) = 'CLOSED' THEN
      RAISE EXCEPTION 'results.state_closed: la période est clôturée' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.state_id, NEW.enrollment_id, NEW.scope, NEW.kind, NEW.source_result_id, NEW.proposed_code, NEW.proposed_outcome)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.state_id, OLD.enrollment_id, OLD.scope, OLD.kind, OLD.source_result_id, OLD.proposed_code, OLD.proposed_outcome) THEN
    -- la proposition peut être RECALCULÉE tant que la décision est PROPOSED ; confirmée, elle est conservée telle quelle
    IF OLD.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'results.decision_immutable: la proposition de la règle est conservée avec la décision confirmée' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF results.state_status(NEW.tenant_id, NEW.state_id) = 'CLOSED' AND NOT (OLD.status = 'CONFIRMED' AND NEW.status = 'PUBLISHED' AND
       ROW(NEW.final_code, NEW.final_outcome, NEW.justification, NEW.decided_by, NEW.decided_at) IS NOT DISTINCT FROM ROW(OLD.final_code, OLD.final_outcome, OLD.justification, OLD.decided_by, OLD.decided_at)) THEN
    RAISE EXCEPTION 'results.state_closed: la période est clôturée : les décisions sont figées' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('PUBLISHED', 'WITHDRAWN') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'results.decision_immutable: une décision publiée ou retirée ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_guard BEFORE INSERT OR UPDATE ON results.decisions
  FOR EACH ROW EXECUTE FUNCTION results.decisions_guard();

-- Appréciations et délibérations : modifiables jusqu'à la clôture, figées ensuite (R-RES-09).
CREATE FUNCTION results.frozen_after_close_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF results.state_status(NEW.tenant_id, NEW.state_id) = 'CLOSED' THEN
    RAISE EXCEPTION 'results.state_closed: la période est clôturée : % figé', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appreciations_frozen BEFORE INSERT OR UPDATE ON results.appreciations
  FOR EACH ROW EXECUTE FUNCTION results.frozen_after_close_guard();
CREATE TRIGGER deliberations_frozen BEFORE INSERT OR UPDATE ON results.deliberations
  FOR EACH ROW EXECUTE FUNCTION results.frozen_after_close_guard();
