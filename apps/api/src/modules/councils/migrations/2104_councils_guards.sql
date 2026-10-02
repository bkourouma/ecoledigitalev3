-- =============================================================================
-- 2104 — Module councils : invariants imposés par la base
-- =============================================================================
--
-- Défense en profondeur (même esprit que academic/0704, results/1203) : le domaine TypeScript applique
-- ces règles, la base les IMPOSE — un bug applicatif ou une requête manuelle ne peut pas les contourner
-- (valables aussi pour un superutilisateur : ce sont des déclencheurs, pas des droits).
--
--   1. l'application ne décide JAMAIS seule : décision, résolution de proposition, signature, ouverture,
--      clôture, déverrouillage exigent une session d'UTILISATEUR identifié (`require_human_actor`) ;
--   2. machine à états de la séance, quorum et président imposés à l'ouverture ;
--   3. séance verrouillée (CLOSED, SIGNED) : plus aucune écriture sur participants, ordre du jour,
--      propositions, décisions ; déverrouillage = demande motivée APPROUVÉE, consommée une fois ;
--   4. décisions : décideur PRÉSENT et habilité, justification d'écart, groupe exclusif, instantané
--      de faits référencé ; propositions de règles jamais acceptées sans humain ;
--   5. procès-verbal : snapshot immuable, hash calculé par la base, signatures datées sur CE hash,
--      passage automatique à SIGNED quand tous les signataires exigés ont signé ;
--   6. effets : file idempotente ; effets d'exclusion = demande à traiter par un humain ;
--   7. journal de séance en ajout seul.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Calculs de séance (lecture seule)
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.check_quorum(
  p_council uuid,
  OUT met boolean, OUT present_count integer, OUT required_min integer,
  OUT missing_roles text[], OUT president_present boolean
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type councils.council_types%ROWTYPE;
BEGIN
  SELECT t.* INTO v_type
    FROM councils.councils c
    JOIN councils.council_types t ON t.tenant_id = c.tenant_id AND t.id = c.council_type_id
   WHERE c.id = p_council;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'councils.not_found: conseil introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*)::integer INTO present_count
    FROM councils.participants p
    JOIN councils.participant_roles r ON r.tenant_id = p.tenant_id AND r.code = p.role_code
   WHERE p.council_id = p_council AND p.presence = 'PRESENT' AND r.counts_for_quorum;
  required_min := v_type.min_participants;
  SELECT coalesce(array_agg(rc ORDER BY rc), '{}'::text[]) INTO missing_roles
    FROM unnest(v_type.required_role_codes) AS rc
   WHERE NOT EXISTS (SELECT 1 FROM councils.participants p
                      WHERE p.council_id = p_council AND p.role_code = rc AND p.presence = 'PRESENT');
  president_present := EXISTS (SELECT 1 FROM councils.participants p
                                WHERE p.council_id = p_council AND p.council_function = 'PRESIDENT' AND p.presence = 'PRESENT');
  met := (required_min IS NULL OR present_count >= required_min) AND cardinality(missing_roles) = 0;
END
$$;

-- Participants PRÉSENTS dont la signature du procès-verbal est exigée (fonctions et rôles du type de conseil).
CREATE FUNCTION councils.required_signers(p_council uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id
    FROM councils.councils c
    JOIN councils.council_types t ON t.tenant_id = c.tenant_id AND t.id = c.council_type_id
    JOIN councils.participants p ON p.tenant_id = c.tenant_id AND p.council_id = c.id
   WHERE c.id = p_council AND p.presence = 'PRESENT'
     AND (p.council_function = ANY (t.signer_functions) OR p.role_code = ANY (t.signer_role_codes))
$$;

CREATE FUNCTION councils.missing_signers(p_minutes uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT s
    FROM councils.minutes m, LATERAL councils.required_signers(m.council_id) AS s
   WHERE m.id = p_minutes
     AND NOT EXISTS (SELECT 1 FROM councils.minute_signatures g WHERE g.minutes_id = m.id AND g.participant_id = s)
$$;

-- Un effet est-il une application qui exige un humain ? (décision dont le type `needs_human_application`)
CREATE FUNCTION councils.effect_needs_human(p_tenant uuid, p_decision uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_kind <> 'NOTIFY_GUARDIANS' AND coalesce(
    (SELECT t.needs_human_application
       FROM councils.decisions d
       JOIN councils.decision_types t ON t.tenant_id = d.tenant_id AND t.id = d.decision_type_id
      WHERE d.tenant_id = p_tenant AND d.id = p_decision), false)
$$;

-- -----------------------------------------------------------------------------
-- Séance : machine à états, quorum, verrouillage, déverrouillage motivé
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.councils_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type councils.council_types%ROWTYPE;
  v_set  councils.settings%ROWTYPE;
  v_req  councils.unlock_requests%ROWTYPE;
  q      record;
  v_n    integer;
BEGIN
  SELECT * INTO v_type FROM councils.council_types WHERE tenant_id = NEW.tenant_id AND id = NEW.council_type_id;
  IF NEW.scope <> v_type.scope THEN
    RAISE EXCEPTION 'councils.scope_mismatch: le type % est de portée % (conseil : %)', v_type.code, v_type.scope, NEW.scope
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = NEW.institution_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.initial_status: un conseil se crée PLANNED' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_type.active THEN
      RAISE EXCEPTION 'councils.type_inactive: le type de conseil % est désactivé', v_type.code USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
     OR NEW.classroom_id <> OLD.classroom_id OR NEW.academic_period_id IS DISTINCT FROM OLD.academic_period_id
     OR NEW.council_type_id <> OLD.council_type_id OR NEW.scope <> OLD.scope THEN
    RAISE EXCEPTION 'councils.identity_immutable: établissement, année, classe, période et type d''un conseil sont figés'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();

  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('CLOSED', 'SIGNED', 'CANCELLED')
       AND (to_jsonb(NEW) - 'row_version' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'updated_at') THEN
      RAISE EXCEPTION 'councils.locked: la séance (%) est verrouillée', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status, NEW.status) IN (
        ('PLANNED', 'OPEN'), ('PLANNED', 'CANCELLED'), ('OPEN', 'CLOSED'), ('OPEN', 'CANCELLED'),
        ('CLOSED', 'SIGNED'), ('CLOSED', 'OPEN'), ('SIGNED', 'OPEN'))) THEN
    RAISE EXCEPTION 'councils.transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'PLANNED' AND NEW.status = 'OPEN' THEN
    NEW.opened_by := councils.require_human_actor();
    NEW.opened_at := now();
    SELECT * INTO q FROM councils.check_quorum(NEW.id);
    IF NOT q.president_present THEN
      RAISE EXCEPTION 'councils.president_required: un président PRÉSENT est nécessaire pour ouvrir la séance' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT q.met THEN
      IF NOT NEW.quorum_waived THEN
        RAISE EXCEPTION 'councils.quorum_not_met: % présent(s) pour un quorum de % ; rôles manquants : %',
          q.present_count, coalesce(q.required_min::text, 'aucun'), coalesce(array_to_string(q.missing_roles, ','), '-')
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_set.tenant_id IS NOT NULL AND NOT v_set.allow_quorum_waiver THEN
        RAISE EXCEPTION 'councils.quorum_waiver_forbidden: l''établissement n''autorise pas l''ouverture sans quorum' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    NEW.closed_by := councils.require_human_actor();
    NEW.closed_at := now();
    IF v_type.requires_decision_per_student THEN
      SELECT count(*) INTO v_n FROM councils.agenda_items a WHERE a.council_id = NEW.id AND a.status <> 'DECIDED';
      IF v_n > 0 THEN
        RAISE EXCEPTION 'councils.undecided_students: % élève(s) sans décision', v_n USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'CLOSED' AND NEW.status = 'SIGNED' THEN
    IF NOT EXISTS (SELECT 1 FROM councils.minutes m WHERE m.tenant_id = NEW.tenant_id AND m.council_id = NEW.id AND m.status = 'SIGNED') THEN
      RAISE EXCEPTION 'councils.minutes_not_signed: aucun procès-verbal signé pour cette séance' USING ERRCODE = 'check_violation';
    END IF;
    NEW.signed_at := coalesce(NEW.signed_at, now());
  ELSIF OLD.status IN ('CLOSED', 'SIGNED') AND NEW.status = 'OPEN' THEN
    PERFORM councils.require_human_actor();
    SELECT * INTO v_req FROM councils.unlock_requests
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status = 'APPROVED' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'councils.unlock_not_approved: le déverrouillage exige une demande motivée approuvée' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_req.four_eyes_waived AND coalesce(v_set.require_separate_unlocker, true) THEN
      RAISE EXCEPTION 'councils.four_eyes_required: l''approbation doit venir d''une autre personne que le demandeur' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM councils.effects e WHERE e.tenant_id = NEW.tenant_id AND e.council_id = NEW.id AND e.status = 'APPLIED') THEN
      RAISE EXCEPTION 'councils.effect_irreversible: des effets appliqués doivent d''abord être annulés (REVERTED)' USING ERRCODE = 'restrict_violation';
    END IF;
    UPDATE councils.unlock_requests SET status = 'CONSUMED', consumed_at = now() WHERE id = v_req.id;
    NEW.reopen_count := OLD.reopen_count + 1;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
    NEW.signed_at := NULL;
  ELSIF NEW.status = 'CANCELLED' THEN
    PERFORM councils.require_human_actor();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER councils_guard BEFORE INSERT OR UPDATE ON councils.councils
  FOR EACH ROW EXECUTE FUNCTION councils.councils_guard();

-- Journal automatique + effets de bord d'une réouverture (procès-verbal remplacé, effets non appliqués écartés).
CREATE FUNCTION councils.councils_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind   text;
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := 'CREATED';
  ELSIF NEW.status = OLD.status THEN
    RETURN NEW;
  ELSIF NEW.status = 'OPEN' AND OLD.status = 'PLANNED' THEN
    v_kind := 'OPENED';
    IF NEW.quorum_waived THEN v_reason := NEW.quorum_waiver_reason; END IF;
  ELSIF NEW.status = 'OPEN' THEN
    v_kind := 'REOPENED';
    SELECT u.reason INTO v_reason FROM councils.unlock_requests u
     WHERE u.tenant_id = NEW.tenant_id AND u.council_id = NEW.id AND u.status = 'CONSUMED'
     ORDER BY u.consumed_at DESC LIMIT 1;
    UPDATE councils.minutes SET status = 'SUPERSEDED'
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status IN ('GENERATED', 'SIGNED');
    UPDATE councils.effects SET status = 'SKIPPED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status IN ('PENDING', 'AWAITING_HUMAN', 'FAILED');
  ELSIF NEW.status = 'CLOSED' THEN
    v_kind := 'CLOSED';
  ELSIF NEW.status = 'SIGNED' THEN
    v_kind := 'SIGNED';
  ELSIF NEW.status = 'CANCELLED' THEN
    v_kind := 'CANCELLED';
    v_reason := NEW.cancel_reason;
  END IF;
  INSERT INTO councils.events (id, tenant_id, council_id, kind, actor_id, actor_kind, reason, data)
  VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, v_kind, kernel.current_user_id(), kernel.current_actor(), v_reason,
          jsonb_build_object('status', NEW.status, 'reopenCount', NEW.reopen_count));
  RETURN NEW;
END
$$;
CREATE TRIGGER councils_after AFTER INSERT OR UPDATE ON councils.councils
  FOR EACH ROW EXECUTE FUNCTION councils.councils_after();

-- -----------------------------------------------------------------------------
-- Participants
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.participants_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council councils.councils%ROWTYPE;
  v_role    councils.participant_roles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_council FROM councils.councils WHERE tenant_id = OLD.tenant_id AND id = OLD.council_id;
    IF v_council.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.participants_frozen: on ne retire un participant que d''une séance planifiée' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_council.status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.participants_frozen: séance %', v_council.status USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_role FROM councils.participant_roles WHERE tenant_id = NEW.tenant_id AND code = NEW.role_code;
  IF v_role.tenant_id IS NULL THEN
    RAISE EXCEPTION 'councils.role_unknown: rôle de participant % inconnu', NEW.role_code USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT v_role.active THEN
      RAISE EXCEPTION 'councils.role_inactive: le rôle % est désactivé', NEW.role_code USING ERRCODE = 'check_violation';
    END IF;
    NEW.is_voting := NEW.is_voting AND v_role.is_voting;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.role_code <> OLD.role_code OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.display_name <> OLD.display_name THEN
      RAISE EXCEPTION 'councils.participant_identity_immutable: rôle, personne et nom d''un participant sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.presence = 'PRESENT' AND NEW.presence <> 'PRESENT' AND EXISTS (
         SELECT 1 FROM councils.decisions d
          WHERE d.tenant_id = NEW.tenant_id AND d.decider_participant_id = NEW.id AND d.status = 'RECORDED') THEN
      RAISE EXCEPTION 'councils.decider_has_decisions: ce participant est le décideur de décisions enregistrées' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.council_function = 'PRESIDENT' AND NOT v_role.can_decide THEN
    RAISE EXCEPTION 'councils.president_role: le rôle % ne peut pas présider (can_decide = false)', NEW.role_code USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER participants_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.participants
  FOR EACH ROW EXECUTE FUNCTION councils.participants_guard();

-- -----------------------------------------------------------------------------
-- Ordre du jour : instantané de faits hashé par la base, figé par les décisions
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.agenda_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_has    boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = OLD.tenant_id AND id = OLD.council_id;
    IF v_status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.agenda_frozen: l''ordre du jour ne se réduit qu''avant l''ouverture' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.agenda_frozen: séance %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'councils.agenda_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.facts <> '{}'::jsonb THEN
      NEW.facts_hash := councils.minutes_hash(NEW.facts);
      NEW.facts_version := 1;
      NEW.prepared_at := coalesce(NEW.prepared_at, now());
    ELSE
      NEW.facts_hash := NULL;
      NEW.facts_version := 0;
    END IF;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id THEN
      RAISE EXCEPTION 'councils.agenda_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.facts IS DISTINCT FROM OLD.facts THEN
      IF EXISTS (SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.id AND d.status = 'RECORDED') THEN
        RAISE EXCEPTION 'councils.facts_locked_by_decision: des décisions reposent sur cet instantané' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.facts_hash := councils.minutes_hash(NEW.facts);
      NEW.facts_version := OLD.facts_version + 1;
      NEW.prepared_at := now();
    ELSE
      NEW.facts_hash := OLD.facts_hash;
      NEW.facts_version := OLD.facts_version;
      NEW.prepared_at := OLD.prepared_at;
    END IF;
    -- DECIDED <=> au moins une décision enregistrée.
    v_has := EXISTS (SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.id AND d.status = 'RECORDED');
    IF NEW.status = 'DECIDED' AND NOT v_has THEN
      RAISE EXCEPTION 'councils.no_decision: aucune décision enregistrée pour cet élève' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'DECIDED' AND v_has THEN
      RAISE EXCEPTION 'councils.item_has_decisions: des décisions enregistrées existent pour cet élève' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER agenda_items_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.agenda_items
  FOR EACH ROW EXECUTE FUNCTION councils.agenda_items_guard();

-- -----------------------------------------------------------------------------
-- Propositions : suggestion des règles ≠ décision
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.proposals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_user   uuid;
BEGIN
  SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.proposals_frozen: séance %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM councils.agenda_items a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.agenda_item_id AND a.council_id = NEW.council_id) THEN
    RAISE EXCEPTION 'councils.item_mismatch: l''élève de l''ordre du jour n''appartient pas à cette séance' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'councils.proposal_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origin = 'HUMAN' THEN
      v_user := councils.require_human_actor();
      IF NEW.proposed_by <> v_user THEN
        RAISE EXCEPTION 'councils.proposer_mismatch: l''auteur doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.agenda_item_id <> OLD.agenda_item_id OR NEW.kind <> OLD.kind
       OR NEW.code IS DISTINCT FROM OLD.code OR NEW.body IS DISTINCT FROM OLD.body OR NEW.origin <> OLD.origin
       OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.rule_version_ref IS DISTINCT FROM OLD.rule_version_ref THEN
      RAISE EXCEPTION 'councils.proposal_immutable: le contenu d''une proposition ne change pas (en créer une nouvelle)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'councils.proposal_resolved: proposition déjà traitée (%)', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      v_user := councils.require_human_actor();
      IF NEW.resolved_by IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'councils.resolver_mismatch: la résolution doit venir de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.resolved_at := coalesce(NEW.resolved_at, now());
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER proposals_guard BEFORE INSERT OR UPDATE ON councils.proposals
  FOR EACH ROW EXECUTE FUNCTION councils.proposals_guard();
CREATE TRIGGER proposals_no_delete BEFORE DELETE ON councils.proposals
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Décisions : l'acte humain
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user    uuid;
  v_council councils.councils%ROWTYPE;
  v_item    councils.agenda_items%ROWTYPE;
  v_type    councils.decision_types%ROWTYPE;
  v_part    councils.participants%ROWTYPE;
  v_role    councils.participant_roles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: une décision ne se supprime pas (la retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := councils.require_human_actor();
  SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_council.status <> 'OPEN' THEN
    RAISE EXCEPTION 'councils.not_open: les décisions se prennent séance ouverte (séance %)', v_council.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.council_id <> OLD.council_id OR NEW.agenda_item_id <> OLD.agenda_item_id OR NEW.enrollment_id <> OLD.enrollment_id
       OR NEW.student_id <> OLD.student_id OR NEW.decision_type_id <> OLD.decision_type_id
       OR NEW.decision_type_code <> OLD.decision_type_code OR NEW.family <> OLD.family
       OR NEW.exclusive_group IS DISTINCT FROM OLD.exclusive_group OR NEW.suggested_code IS DISTINCT FROM OLD.suggested_code
       OR NEW.suggestion_ref IS DISTINCT FROM OLD.suggestion_ref OR NEW.differs_from_suggestion <> OLD.differs_from_suggestion
       OR NEW.justification IS DISTINCT FROM OLD.justification OR NEW.decision_mode <> OLD.decision_mode
       OR NEW.votes_for IS DISTINCT FROM OLD.votes_for OR NEW.votes_against IS DISTINCT FROM OLD.votes_against
       OR NEW.votes_abstain IS DISTINCT FROM OLD.votes_abstain
       OR NEW.target_program_id IS DISTINCT FROM OLD.target_program_id OR NEW.target_grade_level_id IS DISTINCT FROM OLD.target_grade_level_id
       OR NEW.target_label IS DISTINCT FROM OLD.target_label OR NEW.decider_participant_id <> OLD.decider_participant_id
       OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_by_name <> OLD.recorded_by_name
       OR NEW.facts_version <> OLD.facts_version OR NEW.facts_hash IS DISTINCT FROM OLD.facts_hash
       OR NEW.decided_at <> OLD.decided_at OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
      RAISE EXCEPTION 'councils.decision_immutable: une décision enregistrée ne se modifie pas (la retirer puis en enregistrer une autre)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'RECORDED' THEN
      RAISE EXCEPTION 'councils.decision_final: décision déjà %', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.recorded_by <> v_user THEN
    RAISE EXCEPTION 'councils.recorder_mismatch: l''enregistrant doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> 'RECORDED' THEN
    RAISE EXCEPTION 'councils.decision_initial_status' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_item FROM councils.agenda_items WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id;
  IF v_item.council_id <> NEW.council_id OR v_item.enrollment_id <> NEW.enrollment_id OR v_item.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'councils.item_mismatch: l''élève ne correspond pas à l''ordre du jour' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_type FROM councils.decision_types WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_type_id;
  IF NOT v_type.active THEN
    RAISE EXCEPTION 'councils.decision_type_inactive: type % désactivé', v_type.code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.applies_to <> 'BOTH' AND v_type.applies_to <> v_council.scope THEN
    RAISE EXCEPTION 'councils.decision_scope: le type % ne s''applique pas à un conseil de portée %', v_type.code, v_council.scope USING ERRCODE = 'check_violation';
  END IF;
  NEW.decision_type_code := v_type.code;
  NEW.family := v_type.family;
  NEW.exclusive_group := v_type.exclusive_group;

  SELECT * INTO v_part FROM councils.participants WHERE tenant_id = NEW.tenant_id AND id = NEW.decider_participant_id;
  IF v_part.council_id <> NEW.council_id OR v_part.presence <> 'PRESENT' THEN
    RAISE EXCEPTION 'councils.decider_not_present: le décideur doit être un participant PRÉSENT de la séance' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_role FROM councils.participant_roles WHERE tenant_id = NEW.tenant_id AND code = v_part.role_code;
  IF NOT v_role.can_decide THEN
    RAISE EXCEPTION 'councils.decider_not_allowed: le rôle % ne peut pas porter une décision', v_part.role_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_vote AND NEW.decision_mode <> 'VOTE' THEN
    RAISE EXCEPTION 'councils.vote_required: ce type de décision exige un vote' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_justification AND length(btrim(coalesce(NEW.justification, ''))) < 10 THEN
    RAISE EXCEPTION 'councils.justification_required: ce type de décision exige une justification (10 caractères au moins)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_target AND NEW.target_grade_level_id IS NULL THEN
    RAISE EXCEPTION 'councils.target_required: ce type de décision exige une série / un niveau visé' USING ERRCODE = 'check_violation';
  END IF;
  NEW.facts_version := v_item.facts_version;
  NEW.facts_hash := v_item.facts_hash;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.decisions
  FOR EACH ROW EXECUTE FUNCTION councils.decisions_guard();

CREATE FUNCTION councils.decisions_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE councils.agenda_items SET status = 'DECIDED' WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id AND status <> 'DECIDED';
  ELSIF NEW.status <> OLD.status AND NOT EXISTS (
          SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.agenda_item_id AND d.status = 'RECORDED') THEN
    UPDATE councils.agenda_items SET status = 'REVIEWED' WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id AND status = 'DECIDED';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_after AFTER INSERT OR UPDATE ON councils.decisions
  FOR EACH ROW EXECUTE FUNCTION councils.decisions_after();

-- -----------------------------------------------------------------------------
-- Effets : file idempotente, exclusion = demande à traiter par un humain
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.effects_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council councils.councils%ROWTYPE;
  v_dec     councils.decisions%ROWTYPE;
  v_prop    councils.proposals%ROWTYPE;
  v_set     councils.settings%ROWTYPE;
  v_trigger text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF NEW.decision_id IS NOT NULL THEN
      SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
      IF v_dec.council_id <> NEW.council_id OR v_dec.status <> 'RECORDED' THEN
        RAISE EXCEPTION 'councils.effect_decision: la décision doit être enregistrée dans cette séance' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      -- appréciation générale ou distinction : seule une proposition ACCEPTÉE par un humain produit un effet
      SELECT * INTO v_prop FROM councils.proposals WHERE tenant_id = NEW.tenant_id AND id = NEW.proposal_id;
      IF v_prop.council_id <> NEW.council_id OR v_prop.status <> 'ACCEPTED'
         OR NOT ((NEW.effect_kind = 'RESULTS_APPRECIATION' AND v_prop.kind = 'APPRECIATION')
              OR (NEW.effect_kind = 'RESULTS_DISTINCTION' AND v_prop.kind = 'DISTINCTION')) THEN
        RAISE EXCEPTION 'councils.effect_proposal: la proposition doit être ACCEPTÉE dans cette séance et correspondre à la nature de l''effet' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_council.institution_id;
    v_trigger := coalesce(v_set.effects_trigger, 'SIGNED');
    IF (v_trigger = 'SIGNED' AND v_council.status <> 'SIGNED') OR (v_trigger = 'CLOSED' AND v_council.status NOT IN ('CLOSED', 'SIGNED')) THEN
      RAISE EXCEPTION 'councils.effects_too_early: les effets ne naissent qu''à l''état % (séance %)', v_trigger, v_council.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PENDING', 'AWAITING_HUMAN') THEN
      RAISE EXCEPTION 'councils.effect_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF councils.effect_needs_human(NEW.tenant_id, NEW.decision_id, NEW.effect_kind) AND NEW.status <> 'AWAITING_HUMAN' THEN
      RAISE EXCEPTION 'councils.human_application_required: cet effet attend l''acte d''un humain habilité' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.council_id <> OLD.council_id OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
     OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.effect_kind <> OLD.effect_kind THEN
    RAISE EXCEPTION 'councils.effect_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (
        ('PENDING', 'APPLIED'), ('PENDING', 'FAILED'), ('PENDING', 'SKIPPED'),
        ('FAILED', 'PENDING'), ('FAILED', 'APPLIED'), ('FAILED', 'SKIPPED'),
        ('AWAITING_HUMAN', 'APPLIED'), ('AWAITING_HUMAN', 'SKIPPED'),
        ('APPLIED', 'REVERTED'), ('SKIPPED', 'PENDING'), ('SKIPPED', 'AWAITING_HUMAN'))) THEN
    RAISE EXCEPTION 'councils.effect_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'REVERTED' AND OLD.irreversible THEN
    RAISE EXCEPTION 'councils.effect_irreversible: cet effet ne peut plus être annulé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'AWAITING_HUMAN' AND NEW.status = 'APPLIED' THEN
    NEW.applied_by := councils.require_human_actor();
  END IF;
  IF NEW.status = 'PENDING' AND councils.effect_needs_human(NEW.tenant_id, NEW.decision_id, NEW.effect_kind) THEN
    RAISE EXCEPTION 'councils.human_application_required: cet effet attend l''acte d''un humain habilité' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER effects_guard BEFORE INSERT OR UPDATE ON councils.effects
  FOR EACH ROW EXECUTE FUNCTION councils.effects_guard();
CREATE TRIGGER effects_no_delete BEFORE DELETE ON councils.effects
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Procès-verbal : snapshot immuable, hash par la base
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.minutes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: un procès-verbal ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.generated_by <> v_user THEN
      RAISE EXCEPTION 'councils.generator_mismatch: l''auteur doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status <> 'CLOSED' THEN
      RAISE EXCEPTION 'councils.not_closed: le procès-verbal se génère séance close (séance %)', v_status USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM councils.required_signers(NEW.council_id)) THEN
      RAISE EXCEPTION 'councils.no_signer: aucun signataire exigé n''est présent' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'GENERATED' THEN
      RAISE EXCEPTION 'councils.minutes_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(version), 0) + 1 INTO NEW.version FROM councils.minutes WHERE tenant_id = NEW.tenant_id AND council_id = NEW.council_id;
    SELECT id INTO NEW.supersedes_id FROM councils.minutes
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.council_id ORDER BY version DESC LIMIT 1;
    NEW.snapshot_hash := councils.minutes_hash(NEW.snapshot);
    RETURN NEW;
  END IF;

  IF NEW.council_id <> OLD.council_id OR NEW.version <> OLD.version OR NEW.schema_name <> OLD.schema_name
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash <> OLD.snapshot_hash
     OR NEW.generated_at <> OLD.generated_at OR NEW.generated_by <> OLD.generated_by
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'councils.minutes_immutable: le contenu d''un procès-verbal ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'REVOKED') AND (to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'councils.minutes_final: procès-verbal %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason THEN
      RAISE EXCEPTION 'councils.minutes_immutable: signature et révocation ne changent que par transition' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'GENERATED' AND NEW.status = 'SIGNED' THEN
    IF NOT EXISTS (SELECT 1 FROM councils.minute_signatures g WHERE g.minutes_id = NEW.id)
       OR EXISTS (SELECT 1 FROM councils.missing_signers(NEW.id)) THEN
      RAISE EXCEPTION 'councils.signatures_missing: toutes les signatures exigées ne sont pas recueillies' USING ERRCODE = 'check_violation';
    END IF;
    NEW.signed_at := coalesce(NEW.signed_at, now());
  ELSIF OLD.status IN ('GENERATED', 'SIGNED') AND NEW.status = 'SUPERSEDED' THEN
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status <> 'OPEN' THEN
      RAISE EXCEPTION 'councils.supersede_requires_reopen: un procès-verbal n''est remplacé qu''après réouverture motivée de la séance' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD.status IN ('GENERATED', 'SIGNED') AND NEW.status = 'REVOKED' THEN
    PERFORM councils.require_human_actor();
  ELSE
    RAISE EXCEPTION 'councils.minutes_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER minutes_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.minutes
  FOR EACH ROW EXECUTE FUNCTION councils.minutes_guard();

CREATE FUNCTION councils.signatures_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_min  councils.minutes%ROWTYPE;
  v_part councils.participants%ROWTYPE;
BEGIN
  v_user := councils.require_human_actor();
  IF NEW.signed_by_user <> v_user THEN
    RAISE EXCEPTION 'councils.signer_mismatch: la signature est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Les signatures d'un même procès-verbal se SÉRIALISENT : deux signataires concurrents ne laissent jamais
  -- la séance non signée parce que chacun ne voyait pas la signature, non validée, de l'autre.
  SELECT * INTO v_min FROM councils.minutes WHERE tenant_id = NEW.tenant_id AND id = NEW.minutes_id FOR UPDATE;
  IF v_min.status <> 'GENERATED' THEN
    RAISE EXCEPTION 'councils.minutes_not_signable: procès-verbal %', v_min.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.signed_hash <> v_min.snapshot_hash THEN
    RAISE EXCEPTION 'councils.signature_hash_mismatch: la signature porte sur un autre contenu que le procès-verbal' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_part FROM councils.participants WHERE tenant_id = NEW.tenant_id AND id = NEW.participant_id;
  IF v_part.council_id <> v_min.council_id THEN
    RAISE EXCEPTION 'councils.participant_not_in_council' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM councils.required_signers(v_min.council_id) rs WHERE rs = NEW.participant_id) THEN
    RAISE EXCEPTION 'councils.not_a_signer: ce participant n''est pas un signataire exigé (ou n''est pas présent)' USING ERRCODE = 'check_violation';
  END IF;
  NEW.role_code := v_part.role_code;
  NEW.signer_name := v_part.display_name;
  NEW.signed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER signatures_guard BEFORE INSERT ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.signatures_guard();
CREATE TRIGGER signatures_immutable BEFORE UPDATE OR DELETE ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- Toutes les signatures exigées recueillies : procès-verbal puis séance passent à SIGNED.
CREATE FUNCTION councils.signatures_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM councils.missing_signers(NEW.minutes_id)) THEN
    UPDATE councils.minutes SET status = 'SIGNED' WHERE tenant_id = NEW.tenant_id AND id = NEW.minutes_id AND status = 'GENERATED'
      RETURNING council_id INTO v_council;
    IF v_council IS NOT NULL THEN
      UPDATE councils.councils SET status = 'SIGNED', signed_at = now() WHERE tenant_id = NEW.tenant_id AND id = v_council AND status = 'CLOSED';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER signatures_after AFTER INSERT ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.signatures_after();

-- -----------------------------------------------------------------------------
-- Demandes de déverrouillage
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.unlock_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_status text;
  v_set    councils.settings%ROWTYPE;
  v_inst   uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: une demande de déverrouillage ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.requested_by <> v_user THEN
      RAISE EXCEPTION 'councils.requester_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'councils.unlock_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status NOT IN ('CLOSED', 'SIGNED') THEN
      RAISE EXCEPTION 'councils.unlock_not_needed: la séance n''est pas verrouillée (%)', v_status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.council_id <> OLD.council_id OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'councils.unlock_immutable: demandeur, date et motif sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('REQUESTED', 'APPROVED'), ('REQUESTED', 'REJECTED'), ('REQUESTED', 'EXPIRED'),
                                       ('APPROVED', 'CONSUMED'), ('APPROVED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'councils.unlock_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('APPROVED', 'REJECTED') THEN
    v_user := councils.require_human_actor();
    IF NEW.decided_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'councils.decider_mismatch: la décision est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT institution_id INTO v_inst FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_inst;
    IF NEW.four_eyes_waived AND coalesce(v_set.require_separate_unlocker, true) THEN
      RAISE EXCEPTION 'councils.four_eyes_required: l''approbation doit venir d''une autre personne que le demandeur' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.decided_at := coalesce(NEW.decided_at, now());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER unlock_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.unlock_requests
  FOR EACH ROW EXECUTE FUNCTION councils.unlock_requests_guard();

-- -----------------------------------------------------------------------------
-- Journal de séance : ajout seul
-- -----------------------------------------------------------------------------
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON councils.events
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Orientation : transfert de série = acte humain sur un parcours autorisé
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.series_transfers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_path councils.orientation_paths%ROWTYPE;
  v_dec  councils.decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: un transfert de série ne se supprime pas (l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.created_by <> v_user THEN
      RAISE EXCEPTION 'councils.creator_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.transfer_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.path_id IS NOT NULL THEN
      SELECT * INTO v_path FROM councils.orientation_paths WHERE tenant_id = NEW.tenant_id AND id = NEW.path_id;
      IF NOT v_path.active
         OR v_path.from_grade_level_id <> NEW.from_grade_level_id
         OR (v_path.from_program_id IS NOT NULL AND v_path.from_program_id <> NEW.from_program_id)
         OR v_path.to_program_id <> NEW.to_program_id OR v_path.to_grade_level_id <> NEW.to_grade_level_id THEN
        RAISE EXCEPTION 'councils.path_mismatch: le parcours désigné ne correspond pas au transfert (ou est désactivé)' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.path_override_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'councils.override_actor: la dérogation de parcours est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.decided_via = 'COUNCIL' THEN
      SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
      IF v_dec.status <> 'RECORDED' OR v_dec.enrollment_id <> NEW.enrollment_id
         OR v_dec.target_grade_level_id IS DISTINCT FROM NEW.to_grade_level_id
         OR v_dec.target_program_id IS DISTINCT FROM NEW.to_program_id THEN
        RAISE EXCEPTION 'councils.decision_target_mismatch: la décision du conseil ne vise pas cette série / ce niveau pour cette inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id OR NEW.from_program_id <> OLD.from_program_id
     OR NEW.from_grade_level_id <> OLD.from_grade_level_id OR NEW.to_program_id <> OLD.to_program_id
     OR NEW.to_grade_level_id <> OLD.to_grade_level_id OR NEW.decided_via <> OLD.decided_via
     OR NEW.decision_id IS DISTINCT FROM OLD.decision_id OR NEW.act_reference IS DISTINCT FROM OLD.act_reference
     OR NEW.path_id IS DISTINCT FROM OLD.path_id OR NEW.effective_kind <> OLD.effective_kind THEN
    RAISE EXCEPTION 'councils.transfer_immutable: le transfert ne change pas (l''annuler et en créer un autre)' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
        ('PLANNED', 'APPLIED'), ('PLANNED', 'CANCELLED'), ('PLANNED', 'FAILED'), ('FAILED', 'PLANNED'), ('FAILED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'councils.transfer_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    PERFORM councils.require_human_actor();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER series_transfers_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.series_transfers
  FOR EACH ROW EXECUTE FUNCTION councils.series_transfers_guard();

-- Dossier d'orientation : DECIDED / APPLIED reposent sur une décision enregistrée de la même inscription ;
-- un transfert dont le parcours exige l'accord de la famille ne s'applique pas sans accord donné.
CREATE FUNCTION councils.orientation_files_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_dec councils.decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
    RAISE EXCEPTION 'councils.orientation_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.decision_id IS NOT NULL AND NEW.decision_id IS DISTINCT FROM OLD.decision_id THEN
    SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
    IF v_dec.enrollment_id <> NEW.enrollment_id OR v_dec.status <> 'RECORDED' THEN
      RAISE EXCEPTION 'councils.orientation_decision: la décision retenue doit être enregistrée pour cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'APPLIED' AND OLD.status <> 'APPLIED' AND NEW.guardian_consent <> 'GIVEN' AND EXISTS (
       SELECT 1 FROM councils.series_transfers t
         JOIN councils.orientation_paths p ON p.tenant_id = t.tenant_id AND p.id = t.path_id
        WHERE t.tenant_id = NEW.tenant_id AND t.enrollment_id = NEW.enrollment_id AND t.status IN ('PLANNED', 'APPLIED')
          AND p.requires_guardian_consent) THEN
    RAISE EXCEPTION 'councils.consent_required: le parcours exige l''accord de la famille' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER orientation_files_guard BEFORE INSERT OR UPDATE ON councils.orientation_files
  FOR EACH ROW EXECUTE FUNCTION councils.orientation_files_guard();
CREATE TRIGGER orientation_files_no_delete BEFORE DELETE ON councils.orientation_files
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();
CREATE TRIGGER council_types_no_delete BEFORE DELETE ON councils.council_types
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();
