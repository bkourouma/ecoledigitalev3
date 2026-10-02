-- =============================================================================
-- 2202 — Module schoollife : invariants imposés par la base
-- =============================================================================
--
-- Valables pour tout rôle, superutilisateur compris (déclencheurs) :
--   1. un acte disciplinaire exige un UTILISATEUR identifié (jamais un job ni une règle) ;
--   2. machines à états des incidents, mesures, recours, convocations, barèmes ;
--   3. séparation des tâches : le validateur d'une mesure n'est pas son proposant quand le type l'exige ;
--   4. contenu figé après validation ; confidentialité jamais abaissée ; recours encadrés ;
--   5. barèmes de points : ACTIF/RETIRÉ figés ; mouvements en ajout seul, conformes au barème, inversibles ;
--   6. historique automatique en ajout seul ; lectures confidentielles journalisées en ajout seul.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Visibilité : QUI VOIT QUOI (source unique de la règle, appelée par les lectures des portails)
--   audience : 'GUARDIAN' ou 'STUDENT' (familles) ; 'STAFF_STANDARD' | 'STAFF_RESTRICTED' | 'STAFF_CONFIDENTIAL'
--              (personnel : l'habilitation découle des permissions schoollife.read / .restricted.read / .confidential.read,
--              que l'application traduit en audience ; la PORTÉE — quelles classes — reste un contrôle d'application)
--   personnel : voit tout élément dont la confidentialité n'excède pas son habilitation (STANDARD < RESTRICTED < CONFIDENTIAL)
--   élément CONFIDENTIAL : jamais visible d'un tuteur ni d'un élève ; incident : jamais visible d'une famille ;
--   mesure : visible une fois NOTIFIÉE (puis exécutée / en recours), si l'événement est partageable ;
--   note : visibilité choisie par l'auteur (GUARDIANS ou STUDENT_AND_GUARDIANS) ; convocation : envoyée.
--   audience inconnue : refus.
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.audience_may_see(
  p_audience text, p_kind text, p_confidentiality text, p_shareable boolean, p_status text, p_note_visibility text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_audience IN ('STAFF_STANDARD', 'STAFF_RESTRICTED', 'STAFF_CONFIDENTIAL') THEN
      coalesce(schoollife.confidentiality_rank(p_confidentiality), 99)
        <= CASE p_audience WHEN 'STAFF_STANDARD' THEN 1 WHEN 'STAFF_RESTRICTED' THEN 2 ELSE 3 END
    WHEN p_audience NOT IN ('GUARDIAN', 'STUDENT') THEN false
    WHEN p_confidentiality = 'CONFIDENTIAL' THEN false
    WHEN NOT coalesce(p_shareable, false) THEN false
    WHEN p_kind = 'INCIDENT' THEN false
    WHEN p_kind = 'MEASURE' THEN p_status IN ('NOTIFIED', 'EXECUTED', 'APPEALED')
    WHEN p_kind = 'NOTE' THEN p_status = 'ACTIVE' AND (
      (p_audience = 'GUARDIAN' AND p_note_visibility IN ('GUARDIANS', 'STUDENT_AND_GUARDIANS'))
      OR (p_audience = 'STUDENT' AND p_note_visibility = 'STUDENT_AND_GUARDIANS'))
    WHEN p_kind = 'CONVOCATION' THEN p_audience = 'GUARDIAN' AND p_status IN ('SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW', 'RESCHEDULED')
    ELSE false
  END
$$;

-- Solde de points de conduite : points initiaux + mouvements du périmètre de remise à zéro du barème, borné.
CREATE FUNCTION schoollife.conduct_balance(p_student uuid, p_scale uuid, p_year uuid, p_period uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_scale schoollife.conduct_scales%ROWTYPE;
  v_sum   integer;
BEGIN
  SELECT * INTO v_scale FROM schoollife.conduct_scales WHERE id = p_scale;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schoollife.scale_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT coalesce(sum(m.delta), 0)::integer INTO v_sum
    FROM schoollife.conduct_movements m
   WHERE m.scale_id = p_scale AND m.student_id = p_student
     AND CASE v_scale.reset_scope
           WHEN 'PERIOD' THEN m.academic_period_id IS NOT DISTINCT FROM p_period AND m.academic_year_id = p_year
           WHEN 'YEAR' THEN m.academic_year_id = p_year
           ELSE true
         END;
  RETURN least(coalesce(v_scale.max_points, 2147483647), greatest(coalesce(v_scale.min_points, -2147483648), v_scale.initial_points + v_sum));
END
$$;

-- -----------------------------------------------------------------------------
-- Types d'événements : la famille ne change plus dès qu'un enregistrement l'utilise
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.event_types_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind AND (
       EXISTS (SELECT 1 FROM schoollife.incidents WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)
    OR EXISTS (SELECT 1 FROM schoollife.measures WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)
    OR EXISTS (SELECT 1 FROM schoollife.notes WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)) THEN
    RAISE EXCEPTION 'schoollife.type_kind_locked: la famille d''un type utilisé ne change plus (en créer un autre et désactiver celui-ci)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER event_types_guard BEFORE UPDATE ON schoollife.event_types
  FOR EACH ROW EXECUTE FUNCTION schoollife.event_types_guard();
CREATE TRIGGER event_types_no_delete BEFORE DELETE ON schoollife.event_types
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Incidents
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.incidents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un incident ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.reported_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.reporter_mismatch: le déclarant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'DECLARED' THEN
      RAISE EXCEPTION 'schoollife.initial_status: un incident se déclare DECLARED' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;
    IF v_type.kind IS DISTINCT FROM 'INCIDENT' OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type d''incident actif' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.type_id <> OLD.type_id
     OR NEW.occurred_at <> OLD.occurred_at OR NEW.reported_by <> OLD.reported_by THEN
    RAISE EXCEPTION 'schoollife.incident_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'schoollife.closed: l''incident est clos' USING ERRCODE = 'restrict_violation';
  END IF;
  IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(OLD.confidentiality) THEN
    RAISE EXCEPTION 'schoollife.confidentiality_lowered: la confidentialité ne s''abaisse pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.description <> OLD.description AND OLD.status <> 'DECLARED' THEN
    RAISE EXCEPTION 'schoollife.description_frozen: la description ne change plus après l''ouverture de l''instruction' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('DECLARED', 'UNDER_REVIEW'), ('DECLARED', 'DISMISSED'), ('UNDER_REVIEW', 'CONFIRMED'),
                                         ('UNDER_REVIEW', 'DISMISSED'), ('CONFIRMED', 'CLOSED'), ('DISMISSED', 'CLOSED'))) THEN
      RAISE EXCEPTION 'schoollife.incident_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'CLOSED' THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER incidents_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.incidents
  FOR EACH ROW EXECUTE FUNCTION schoollife.incidents_guard();

CREATE FUNCTION schoollife.involvements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une implication ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM schoollife.require_human_actor();
  SELECT status INTO v_status FROM schoollife.incidents WHERE tenant_id = NEW.tenant_id AND id = NEW.incident_id;
  IF v_status IN ('CLOSED', 'DISMISSED') THEN
    RAISE EXCEPTION 'schoollife.closed: l''incident est %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.incident_id <> OLD.incident_id OR NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.role <> OLD.role) THEN
    RAISE EXCEPTION 'schoollife.involvement_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER involvements_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.incident_involvements
  FOR EACH ROW EXECUTE FUNCTION schoollife.involvements_guard();

-- -----------------------------------------------------------------------------
-- Mesures : circuit de validation défini par le type, séparation des tâches, exclusions sans chevauchement
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.measures_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une mesure ne se supprime pas (la révoquer ou l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.proposed_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.proposer_mismatch: le proposant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_type.kind NOT IN ('SANCTION', 'WARNING', 'TEMP_EXCLUSION') OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type de mesure actif (sanction, avertissement, exclusion temporaire)' USING ERRCODE = 'check_violation';
    END IF;
    NEW.kind := v_type.kind;
    IF v_type.requires_dates AND (NEW.starts_on IS NULL OR NEW.ends_on IS NULL) THEN
      RAISE EXCEPTION 'schoollife.dates_required: ce type de mesure exige des dates de début et de fin' USING ERRCODE = 'check_violation';
    END IF;
    IF v_type.requires_validation AND NEW.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'schoollife.validation_required: ce type de mesure se propose, puis se valide' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PROPOSED', 'VALIDATED') THEN
      RAISE EXCEPTION 'schoollife.initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.visible_to_guardians := NEW.visible_to_guardians AND v_type.visible_to_guardians AND NEW.confidentiality <> 'CONFIDENTIAL';
    IF NEW.incident_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM schoollife.incident_involvements i
          WHERE i.tenant_id = NEW.tenant_id AND i.incident_id = NEW.incident_id AND i.student_id = NEW.student_id AND i.role IN ('AUTHOR', 'OTHER')) THEN
      RAISE EXCEPTION 'schoollife.not_involved: l''élève n''est pas désigné comme auteur de l''incident' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'VALIDATED' THEN
      NEW.validated_by := v_user;
      NEW.validated_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.student_id <> OLD.student_id OR NEW.type_id <> OLD.type_id OR NEW.kind <> OLD.kind
     OR NEW.incident_id IS DISTINCT FROM OLD.incident_id OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at THEN
    RAISE EXCEPTION 'schoollife.measure_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('REJECTED', 'CANCELLED', 'REVOKED') THEN
    RAISE EXCEPTION 'schoollife.measure_final: mesure %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PROPOSED' AND (NEW.reason <> OLD.reason OR NEW.severity_code IS DISTINCT FROM OLD.severity_code) THEN
    RAISE EXCEPTION 'schoollife.measure_frozen: motif et gravité ne changent plus après la validation' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('NOTIFIED', 'EXECUTED', 'APPEALED') AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on) THEN
    RAISE EXCEPTION 'schoollife.measure_frozen: les dates ne changent plus après la notification' USING ERRCODE = 'restrict_violation';
  END IF;
  IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(OLD.confidentiality) THEN
    RAISE EXCEPTION 'schoollife.confidentiality_lowered: la confidentialité ne s''abaisse pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.visible_to_guardians AND NOT OLD.visible_to_guardians THEN
    RAISE EXCEPTION 'schoollife.visibility_widened: une mesure cachée aux familles ne leur est pas rendue visible' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('PROPOSED', 'VALIDATED'), ('PROPOSED', 'REJECTED'), ('PROPOSED', 'CANCELLED'),
          ('VALIDATED', 'NOTIFIED'), ('VALIDATED', 'EXECUTED'), ('VALIDATED', 'CANCELLED'),
          ('NOTIFIED', 'EXECUTED'), ('NOTIFIED', 'APPEALED'), ('NOTIFIED', 'REVOKED'),
          ('EXECUTED', 'APPEALED'), ('EXECUTED', 'REVOKED'),
          ('APPEALED', 'EXECUTED'), ('APPEALED', 'REVOKED'))) THEN
      RAISE EXCEPTION 'schoollife.measure_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'VALIDATED' THEN
      IF v_type.requires_four_eyes AND v_user = OLD.proposed_by THEN
        RAISE EXCEPTION 'schoollife.four_eyes_required: la validation doit venir d''une autre personne que le proposant' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.validated_by := v_user;
      NEW.validated_at := now();
    ELSIF NEW.status = 'NOTIFIED' THEN
      NEW.notified_by := v_user;
      NEW.notified_at := now();
    ELSIF NEW.status = 'EXECUTED' THEN
      NEW.executed_at := coalesce(OLD.executed_at, now());
    ELSIF NEW.status = 'REVOKED' THEN
      NEW.revoked_by := v_user;
      NEW.revoked_at := now();
    ELSIF NEW.status = 'APPEALED' THEN
      IF NOT v_type.appealable OR NOT EXISTS (
           SELECT 1 FROM schoollife.measure_appeals a WHERE a.tenant_id = NEW.tenant_id AND a.measure_id = NEW.id AND a.status = 'FILED') THEN
        RAISE EXCEPTION 'schoollife.not_appealable: un recours déposé sur une mesure susceptible de recours est nécessaire' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER measures_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.measures
  FOR EACH ROW EXECUTE FUNCTION schoollife.measures_guard();

-- Recours : dépôt (mesure notifiée ou exécutée, type susceptible de recours) puis issue
CREATE FUNCTION schoollife.appeals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_m    schoollife.measures%ROWTYPE;
  v_t    schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un recours ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.filed_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.filer_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'FILED' THEN
      RAISE EXCEPTION 'schoollife.initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_m FROM schoollife.measures WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id;
    SELECT * INTO v_t FROM schoollife.event_types WHERE tenant_id = v_m.tenant_id AND id = v_m.type_id;
    IF NOT v_t.appealable OR v_m.status NOT IN ('NOTIFIED', 'EXECUTED') THEN
      RAISE EXCEPTION 'schoollife.not_appealable: la mesure n''est pas susceptible de recours dans son état (%)', v_m.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.measure_id <> OLD.measure_id OR NEW.filed_by <> OLD.filed_by OR NEW.filed_at <> OLD.filed_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'schoollife.appeal_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'FILED' THEN
    RAISE EXCEPTION 'schoollife.appeal_final: recours déjà %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('UPHELD', 'OVERTURNED') THEN
    IF NEW.decided_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'schoollife.decider_mismatch: l''issue du recours est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appeals_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.appeals_guard();

-- Effets du recours sur la mesure : dépôt -> APPEALED ; confirmé ou retiré -> EXECUTED ; annulé -> REVOKED
CREATE FUNCTION schoollife.appeals_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE schoollife.measures SET status = 'APPEALED' WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id;
  ELSIF NEW.status = 'UPHELD' OR NEW.status = 'WITHDRAWN' THEN
    UPDATE schoollife.measures SET status = 'EXECUTED' WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id AND status = 'APPEALED';
  ELSIF NEW.status = 'OVERTURNED' THEN
    UPDATE schoollife.measures SET status = 'REVOKED', revoked_reason = NEW.decision_note
     WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id AND status = 'APPEALED';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appeals_after AFTER INSERT OR UPDATE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.appeals_after();

-- -----------------------------------------------------------------------------
-- Encouragements et observations
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.notes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une note ne se supprime pas (la retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id <> v_user THEN
      RAISE EXCEPTION 'schoollife.author_mismatch: l''auteur est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;
    IF v_type.kind NOT IN ('ENCOURAGEMENT', 'OBSERVATION') OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type d''encouragement ou d''observation actif' USING ERRCODE = 'check_violation';
    END IF;
    NEW.kind := v_type.kind;
    IF NEW.visibility <> 'STAFF_ONLY' AND NOT v_type.visible_to_guardians THEN
      RAISE EXCEPTION 'schoollife.visibility_forbidden: ce type d''événement n''est pas partageable avec les familles' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.body <> OLD.body OR NEW.kind <> OLD.kind OR NEW.type_id <> OLD.type_id OR NEW.student_id <> OLD.student_id
     OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.author_id <> OLD.author_id OR NEW.occurred_on <> OLD.occurred_on
     OR NEW.visibility <> OLD.visibility OR NEW.confidentiality <> OLD.confidentiality THEN
    RAISE EXCEPTION 'schoollife.note_immutable: une note ne change pas (la retirer et en écrire une autre)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'schoollife.note_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'WITHDRAWN' THEN
    NEW.withdrawn_by := v_user;
    NEW.withdrawn_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER notes_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.notes
  FOR EACH ROW EXECUTE FUNCTION schoollife.notes_guard();

-- -----------------------------------------------------------------------------
-- Convocations
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.convocations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une convocation ne se supprime pas (l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.convened_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.convener_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'schoollife.initial_status: une convocation se crée DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.convened_by <> OLD.convened_by
     OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'schoollife.convocation_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.guardian_ids <> OLD.guardian_ids OR NEW.reason <> OLD.reason OR NEW.reason_kind <> OLD.reason_kind) THEN
    RAISE EXCEPTION 'schoollife.convocation_frozen: destinataires et motif ne changent plus après l''envoi' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED') THEN
    RAISE EXCEPTION 'schoollife.convocation_final: convocation %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('DRAFT', 'SENT'), ('DRAFT', 'CANCELLED'),
          ('SENT', 'ACKNOWLEDGED'), ('SENT', 'HELD'), ('SENT', 'NO_SHOW'), ('SENT', 'CANCELLED'), ('SENT', 'RESCHEDULED'),
          ('ACKNOWLEDGED', 'HELD'), ('ACKNOWLEDGED', 'NO_SHOW'), ('ACKNOWLEDGED', 'CANCELLED'), ('ACKNOWLEDGED', 'RESCHEDULED'))) THEN
      RAISE EXCEPTION 'schoollife.convocation_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'SENT' THEN
      NEW.sent_at := now();
    ELSIF NEW.status = 'ACKNOWLEDGED' THEN
      IF NEW.acknowledged_by_guardian_id IS NULL OR NOT (NEW.acknowledged_by_guardian_id = ANY (NEW.guardian_ids)) THEN
        RAISE EXCEPTION 'schoollife.acknowledger: l''accusé de réception doit venir d''un tuteur convoqué' USING ERRCODE = 'check_violation';
      END IF;
      NEW.acknowledged_at := now();
    ELSIF NEW.status = 'HELD' THEN
      NEW.held_at := now();
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER convocations_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.convocations
  FOR EACH ROW EXECUTE FUNCTION schoollife.convocations_guard();

-- -----------------------------------------------------------------------------
-- Barèmes de points de conduite
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.conduct_scales_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un barème ne se supprime pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'schoollife.initial_status: un barème se crée DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.institution_id <> OLD.institution_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'schoollife.scale_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.initial_points <> OLD.initial_points OR NEW.min_points IS DISTINCT FROM OLD.min_points
       OR NEW.max_points IS DISTINCT FROM OLD.max_points OR NEW.reset_scope <> OLD.reset_scope
       OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id OR NEW.effective_from <> OLD.effective_from
       OR NEW.source_kind <> OLD.source_kind) THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: un barème actif ou retiré ne change plus (en créer un nouveau)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'RETIRED' AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: barème retiré' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('DRAFT', 'ACTIVE'), ('DRAFT', 'RETIRED'), ('ACTIVE', 'RETIRED'))) THEN
      RAISE EXCEPTION 'schoollife.scale_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
      PERFORM schoollife.require_human_actor();
      IF NOT EXISTS (SELECT 1 FROM schoollife.conduct_scale_items i WHERE i.tenant_id = NEW.tenant_id AND i.scale_id = NEW.id) THEN
        RAISE EXCEPTION 'schoollife.scale_empty: un barème actif contient au moins une valeur' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER conduct_scales_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_scales
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_scales_guard();

CREATE FUNCTION schoollife.conduct_scale_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row  schoollife.conduct_scale_items%ROWTYPE;
  v_stat text;
  v_kind text;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT status INTO v_stat FROM schoollife.conduct_scales WHERE tenant_id = v_row.tenant_id AND id = v_row.scale_id;
  IF v_stat <> 'DRAFT' THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: les valeurs d''un barème ne se modifient qu''en brouillon (barème %)', v_stat USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT kind INTO v_kind FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.event_type_id;
    IF v_kind IN ('INCIDENT', 'OBSERVATION') THEN
      RAISE EXCEPTION 'schoollife.type_kind: seuls les mesures et les encouragements ont une valeur en points' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER conduct_scale_items_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_scale_items
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_scale_items_guard();

-- Mouvements : conformes au barème et à la source, jamais sans les points de conduite activés
CREATE FUNCTION schoollife.conduct_movements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_scale  schoollife.conduct_scales%ROWTYPE;
  v_set    schoollife.settings%ROWTYPE;
  v_orig   schoollife.conduct_movements%ROWTYPE;
  v_type   uuid;
  v_status text;
  v_enr    uuid;
  v_points integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'schoollife.immutable: le registre des points de conduite est en ajout seul (corriger par un mouvement inverse)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF NEW.created_by <> v_user THEN
    RAISE EXCEPTION 'schoollife.author_mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_scale FROM schoollife.conduct_scales WHERE tenant_id = NEW.tenant_id AND id = NEW.scale_id;
  IF v_scale.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'schoollife.scale_not_active: barème %', v_scale.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_set FROM schoollife.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_scale.institution_id;
  IF v_set.tenant_id IS NULL OR NOT v_set.conduct_points_enabled THEN
    RAISE EXCEPTION 'schoollife.conduct_disabled: les points de conduite ne sont pas activés pour cet établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO v_orig FROM schoollife.conduct_movements WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_id;
    IF v_orig.reverses_id IS NOT NULL OR v_orig.scale_id <> NEW.scale_id OR v_orig.enrollment_id <> NEW.enrollment_id
       OR v_orig.student_id <> NEW.student_id OR NEW.delta <> -v_orig.delta THEN
      RAISE EXCEPTION 'schoollife.reversal_mismatch: un mouvement inverse annule exactement un mouvement du même barème et du même élève' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_kind = 'MEASURE' THEN
    SELECT m.type_id, m.status, m.enrollment_id INTO v_type, v_status, v_enr FROM schoollife.measures m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.source_id;
    IF v_status IS NULL OR v_status NOT IN ('VALIDATED', 'NOTIFIED', 'EXECUTED') OR v_enr <> NEW.enrollment_id THEN
      RAISE EXCEPTION 'schoollife.source_invalid: la mesure doit être validée et concerner cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_kind = 'NOTE' THEN
    SELECT n.type_id, n.status, n.enrollment_id INTO v_type, v_status, v_enr FROM schoollife.notes n WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.source_id;
    IF v_status IS NULL OR v_status <> 'ACTIVE' OR v_enr <> NEW.enrollment_id THEN
      RAISE EXCEPTION 'schoollife.source_invalid: la note doit être active et concerner cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.source_kind IN ('MEASURE', 'NOTE') THEN
    SELECT i.points_delta INTO v_points FROM schoollife.conduct_scale_items i WHERE i.tenant_id = NEW.tenant_id AND i.scale_id = NEW.scale_id AND i.event_type_id = v_type;
    IF v_points IS NULL OR v_points <> NEW.delta THEN
      RAISE EXCEPTION 'schoollife.delta_not_in_scale: les points doivent être ceux du barème pour ce type d''événement' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- ajustement manuel : réservé au motif explicite, la valeur reste libre mais jamais nulle
    NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER conduct_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_movements
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_movements_guard();

-- -----------------------------------------------------------------------------
-- Historique automatique (ajout seul) et lectures confidentielles
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.log_life_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_json   jsonb := to_jsonb(NEW);
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM (to_jsonb(OLD)->>'status') THEN
    RETURN NEW;
  END IF;
  v_reason := coalesce(v_json->>'revoked_reason', v_json->>'cancel_reason', v_json->>'resolution_note',
                       v_json->>'withdrawn_reason', v_json->>'validation_note', v_json->>'decision_note');
  INSERT INTO schoollife.life_events (id, tenant_id, entity_kind, entity_id, student_id, action, from_status, to_status, actor_id, actor_kind, reason)
  VALUES (gen_random_uuid(), NEW.tenant_id, TG_ARGV[0], NEW.id, NULLIF(v_json->>'student_id', '')::uuid,
          CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'STATUS_CHANGED' END,
          CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>'status' END, v_json->>'status',
          kernel.current_user_id(), kernel.current_actor(), v_reason);
  RETURN NEW;
END
$$;
CREATE TRIGGER incidents_log AFTER INSERT OR UPDATE ON schoollife.incidents
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('INCIDENT');
CREATE TRIGGER measures_log AFTER INSERT OR UPDATE ON schoollife.measures
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('MEASURE');
CREATE TRIGGER notes_log AFTER INSERT OR UPDATE ON schoollife.notes
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('NOTE');
CREATE TRIGGER convocations_log AFTER INSERT OR UPDATE ON schoollife.convocations
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('CONVOCATION');
CREATE TRIGGER appeals_log AFTER INSERT OR UPDATE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('APPEAL');
CREATE TRIGGER conduct_scales_log AFTER INSERT OR UPDATE ON schoollife.conduct_scales
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('SCALE');

CREATE TRIGGER life_events_immutable BEFORE UPDATE OR DELETE ON schoollife.life_events
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();
CREATE TRIGGER confidential_reads_immutable BEFORE UPDATE OR DELETE ON schoollife.confidential_reads
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();

CREATE FUNCTION schoollife.confidential_reads_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := schoollife.require_human_actor();
BEGIN
  IF NEW.reader_user_id <> v_user THEN
    RAISE EXCEPTION 'schoollife.reader_mismatch: le lecteur journalisé est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER confidential_reads_guard BEFORE INSERT ON schoollife.confidential_reads
  FOR EACH ROW EXECUTE FUNCTION schoollife.confidential_reads_guard();
