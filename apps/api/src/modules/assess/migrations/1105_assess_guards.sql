-- =============================================================================
-- 1105 — Module assess : invariants imposés par la base (défense en profondeur)
-- =============================================================================
--
-- L'application ET ces déclencheurs garantissent l'immuabilité des notes publiées : ils s'appliquent à TOUT rôle,
-- superuser compris (un déclencheur ne se contourne pas par un rôle puissant, seulement par
-- `session_replication_role = replica`, réservé à l'exploitation).
--
-- Codes d'erreur stables, en PRÉFIXE du message : `assess.<code>: …` (ERRCODE restrict_violation 23001, ou
-- check_violation 23514 pour une valeur hors barème). Réglages de transaction lus (posés par l'application après
-- contrôle des droits, puis RE-VÉRIFIÉS ici contre l'état réel de la base — un réglage seul ne suffit jamais) :
--   app.grade_revision_id     révision approuvée en cours d'application (`assess.apply_revision`)
--   app.grade_revision_batch  lot de révisions d'annulation d'une évaluation publiée

CREATE FUNCTION assess.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'assess.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER assessment_transitions_immutable BEFORE UPDATE OR DELETE ON assess.assessment_transitions
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();
CREATE TRIGGER batch_receipts_no_update BEFORE UPDATE ON assess.batch_receipts
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();
CREATE TRIGGER assessments_no_delete BEFORE DELETE ON assess.assessments
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();
CREATE TRIGGER grade_revisions_no_delete BEFORE DELETE ON assess.grade_revisions
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();
CREATE TRIGGER period_locks_no_delete BEFORE DELETE ON assess.period_locks
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();
CREATE TRIGGER assessment_types_no_delete BEFORE DELETE ON assess.assessment_types
  FOR EACH ROW EXECUTE FUNCTION assess.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Une session de la classe × période est-elle verrouillée ?
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.period_locked(p_tenant uuid, p_classroom uuid, p_period uuid, p_session smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM assess.period_locks l
     WHERE l.tenant_id = p_tenant AND l.classroom_id = p_classroom AND l.academic_period_id = p_period
       AND l.released_at IS NULL AND p_session = ANY (l.locked_sessions))
$$;
REVOKE ALL ON FUNCTION assess.period_locked(uuid, uuid, uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assess.period_locked(uuid, uuid, uuid, smallint) TO app_user;

-- Révision désignée par le réglage de transaction (NULL si absent ou mal formé).
CREATE FUNCTION assess.current_revision_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(current_setting('app.grade_revision_id', true), '');
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION assess.current_revision_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assess.current_revision_id() TO app_user;

CREATE FUNCTION assess.current_batch_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(current_setting('app.grade_revision_batch', true), '');
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION assess.current_batch_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assess.current_batch_id() TO app_user;

-- -----------------------------------------------------------------------------
-- Types d'évaluation : code et nature « système » figés ; le groupe d'agrégation (lu par les règles) ne change
-- plus dès qu'une évaluation utilise le type (sinon un recalcul changerait rétroactivement les résultats).
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.assessment_types_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.code <> OLD.code OR NEW.is_system <> OLD.is_system
     OR NEW.template_key IS DISTINCT FROM OLD.template_key THEN
    RAISE EXCEPTION 'assess.type_identity_immutable: code et nature d''un type d''évaluation sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.aggregation_group <> OLD.aggregation_group
     AND EXISTS (SELECT 1 FROM assess.assessments a WHERE a.tenant_id = OLD.tenant_id AND a.type_id = OLD.id) THEN
    RAISE EXCEPTION 'assess.type_in_use: le groupe d''agrégation d''un type utilisé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assessment_types_guard BEFORE UPDATE ON assess.assessment_types
  FOR EACH ROW EXECUTE FUNCTION assess.assessment_types_guard();

-- -----------------------------------------------------------------------------
-- Évaluations : transitions légales, contenu figé, séparation des tâches, verrou de période.
--   DRAFT -> SUBMITTED | CANCELLED ; SUBMITTED -> REVIEWED | DRAFT | CANCELLED ; REVIEWED -> APPROVED | DRAFT | CANCELLED ;
--   APPROVED -> PUBLISHED | DRAFT | CANCELLED ; PUBLISHED -> CANCELLED (seulement par un lot de révisions approuvé) ;
--   CANCELLED terminal.
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.assessments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sep_reviewer boolean;
  v_sep_approver boolean;
  v_grades       integer;
  v_batch        uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'assess.invalid_initial_status: une évaluation naît en brouillon' USING ERRCODE = 'restrict_violation';
    END IF;
    IF assess.period_locked(NEW.tenant_id, NEW.classroom_id, NEW.academic_period_id, NEW.session_no) THEN
      RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'assess.identity_immutable: identité de l''évaluation figée' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Verrou de période : aucune modification, aucune transition (publication comprise) pour la session verrouillée.
  IF assess.period_locked(OLD.tenant_id, OLD.classroom_id, OLD.academic_period_id, OLD.session_no)
     OR assess.period_locked(NEW.tenant_id, NEW.classroom_id, NEW.academic_period_id, NEW.session_no) THEN
    RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    -- Hors brouillon, le contenu et les signatures du circuit sont figés (seuls le titre et le commentaire de retour bougent).
    IF OLD.status <> 'DRAFT' AND (
         ROW(NEW.type_id, NEW.classroom_id, NEW.curriculum_node_id, NEW.academic_period_id, NEW.academic_year_id, NEW.teacher_id,
             NEW.assessed_on, NEW.scale_max, NEW.weight, NEW.session_no,
             NEW.submitted_at, NEW.submitted_by, NEW.reviewed_at, NEW.reviewed_by, NEW.approved_at, NEW.approved_by,
             NEW.published_at, NEW.published_by, NEW.cancelled_at, NEW.cancelled_by, NEW.cancel_reason, NEW.four_eyes_waived)
         IS DISTINCT FROM
         ROW(OLD.type_id, OLD.classroom_id, OLD.curriculum_node_id, OLD.academic_period_id, OLD.academic_year_id, OLD.teacher_id,
             OLD.assessed_on, OLD.scale_max, OLD.weight, OLD.session_no,
             OLD.submitted_at, OLD.submitted_by, OLD.reviewed_at, OLD.reviewed_by, OLD.approved_at, OLD.approved_by,
             OLD.published_at, OLD.published_by, OLD.cancelled_at, OLD.cancelled_by, OLD.cancel_reason, OLD.four_eyes_waived)) THEN
      RAISE EXCEPTION 'assess.assessment_frozen: barème, poids, nœud, période, session, type et signatures sont figés dès la soumission' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.scale_max < OLD.scale_max
       AND EXISTS (SELECT 1 FROM assess.grades g WHERE g.tenant_id = OLD.tenant_id AND g.assessment_id = OLD.id AND g.score > NEW.scale_max) THEN
      RAISE EXCEPTION 'assess.scale_conflict: des notes saisies dépassent le nouveau barème' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NOT (
         (OLD.status = 'DRAFT'     AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
         (OLD.status = 'SUBMITTED' AND NEW.status IN ('REVIEWED', 'DRAFT', 'CANCELLED')) OR
         (OLD.status = 'REVIEWED'  AND NEW.status IN ('APPROVED', 'DRAFT', 'CANCELLED')) OR
         (OLD.status = 'APPROVED'  AND NEW.status IN ('PUBLISHED', 'DRAFT', 'CANCELLED')) OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'CANCELLED')) THEN
      RAISE EXCEPTION 'assess.invalid_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    -- Aucune transition ne modifie le contenu.
    IF ROW(NEW.type_id, NEW.classroom_id, NEW.curriculum_node_id, NEW.academic_period_id, NEW.academic_year_id, NEW.teacher_id,
           NEW.assessed_on, NEW.scale_max, NEW.weight, NEW.session_no)
       IS DISTINCT FROM
       ROW(OLD.type_id, OLD.classroom_id, OLD.curriculum_node_id, OLD.academic_period_id, OLD.academic_year_id, OLD.teacher_id,
           OLD.assessed_on, OLD.scale_max, OLD.weight, OLD.session_no) THEN
      RAISE EXCEPTION 'assess.assessment_frozen: une transition ne modifie pas le contenu de l''évaluation' USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT coalesce(s.require_separate_reviewer, true), coalesce(s.require_separate_approver, true)
      INTO v_sep_reviewer, v_sep_approver
      FROM (SELECT 1) one LEFT JOIN assess.settings s ON s.tenant_id = NEW.tenant_id;

    IF NEW.status = 'SUBMITTED' THEN
      SELECT count(*) INTO v_grades FROM assess.grades g WHERE g.tenant_id = NEW.tenant_id AND g.assessment_id = NEW.id;
      IF v_grades = 0 THEN
        RAISE EXCEPTION 'assess.empty_assessment: une évaluation sans aucune note ne se soumet pas' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'REVIEWED' AND NEW.reviewed_by IS NOT DISTINCT FROM NEW.submitted_by THEN
      IF v_sep_reviewer THEN
        RAISE EXCEPTION 'assess.four_eyes: la personne qui soumet ne relit pas la même évaluation' USING ERRCODE = 'restrict_violation';
      ELSIF NOT NEW.four_eyes_waived THEN
        RAISE EXCEPTION 'assess.four_eyes_waiver_required: la dérogation à la séparation des tâches doit être inscrite' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'APPROVED' AND NEW.approved_by IS NOT DISTINCT FROM NEW.submitted_by THEN
      IF v_sep_approver THEN
        RAISE EXCEPTION 'assess.four_eyes: la personne qui soumet n''approuve pas la même évaluation' USING ERRCODE = 'restrict_violation';
      ELSIF NOT NEW.four_eyes_waived THEN
        RAISE EXCEPTION 'assess.four_eyes_waiver_required: la dérogation à la séparation des tâches doit être inscrite' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'PUBLISHED' AND NEW.published_by IS NOT DISTINCT FROM NEW.submitted_by THEN
      IF v_sep_approver THEN
        RAISE EXCEPTION 'assess.four_eyes: la personne qui soumet ne publie pas la même évaluation' USING ERRCODE = 'restrict_violation';
      ELSIF NOT NEW.four_eyes_waived THEN
        RAISE EXCEPTION 'assess.four_eyes_waiver_required: la dérogation à la séparation des tâches doit être inscrite' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'DRAFT' THEN
      -- Retour en brouillon : les signatures de relecture, d'approbation et de publication tombent.
      NEW.reviewed_at := NULL; NEW.reviewed_by := NULL;
      NEW.approved_at := NULL; NEW.approved_by := NULL;
      NEW.published_at := NULL; NEW.published_by := NULL;
      NEW.four_eyes_waived := false;
    ELSIF NEW.status = 'CANCELLED' AND OLD.status = 'PUBLISHED' THEN
      -- L'annulation d'une évaluation publiée est un lot de révisions (REMOVAL) approuvé en une décision, couvrant
      -- TOUTES les notes de la feuille.
      v_batch := assess.current_batch_id();
      IF v_batch IS NULL OR EXISTS (
           SELECT 1 FROM assess.grades g
            WHERE g.tenant_id = NEW.tenant_id AND g.assessment_id = NEW.id
              AND NOT EXISTS (SELECT 1 FROM assess.grade_revisions r
                               WHERE r.tenant_id = g.tenant_id AND r.batch_id = v_batch AND r.grade_id = g.id
                                 AND r.assessment_id = NEW.id AND r.kind = 'REMOVAL' AND r.status IN ('APPROVED', 'APPLIED'))) THEN
        RAISE EXCEPTION 'assess.published_immutable: une évaluation publiée ne s''annule que par un lot de révisions approuvé' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;

  NEW.row_version := OLD.row_version + 1;
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assessments_guard BEFORE INSERT OR UPDATE ON assess.assessments
  FOR EACH ROW EXECUTE FUNCTION assess.assessments_guard();

-- Le statut de chaque note reflète celui de son évaluation (même transaction).
CREATE FUNCTION assess.assessments_mirror() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assess.grades SET status = NEW.status
   WHERE tenant_id = NEW.tenant_id AND assessment_id = NEW.id AND status <> NEW.status;
  RETURN NULL;
END
$$;
CREATE TRIGGER assessments_mirror AFTER UPDATE OF status ON assess.assessments
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION assess.assessments_mirror();

-- -----------------------------------------------------------------------------
-- Notes : barème, précision, immuabilité après publication, verrou de période.
--   INSERT  : évaluation DRAFT, ou ADDITION approuvée désignée par app.grade_revision_id (feuille PUBLISHED)
--   UPDATE  : valeur/état d'entrée : évaluation DRAFT, ou CORRECTION|REMOVAL approuvée désignée pour CETTE note ET
--             dont la nouvelle valeur est exactement celle écrite ; statut : miroir de l'évaluation uniquement
--   DELETE  : évaluation DRAFT seulement
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.grades_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a          assess.assessments%ROWTYPE;
  g          assess.grades%ROWTYPE;
  rev        assess.grade_revisions%ROWTYPE;
  v_decimals smallint;
  v_changed  boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN g := OLD; ELSE g := NEW; END IF;
  SELECT * INTO a FROM assess.assessments WHERE tenant_id = g.tenant_id AND id = g.assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assess.assessment_not_found: évaluation introuvable' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF a.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'assess.grade_frozen: une note ne se supprime que sur une feuille en brouillon' USING ERRCODE = 'restrict_violation';
    END IF;
    IF assess.period_locked(a.tenant_id, a.classroom_id, a.academic_period_id, a.session_no) THEN
      RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.score IS NOT NULL THEN
    IF NEW.score > a.scale_max THEN
      RAISE EXCEPTION 'assess.score_out_of_scale: la note dépasse le barème (%)', a.scale_max USING ERRCODE = 'check_violation';
    END IF;
    SELECT s.max_score_decimals INTO v_decimals FROM assess.settings s WHERE s.tenant_id = NEW.tenant_id;
    IF NEW.score <> round(NEW.score, coalesce(v_decimals, 2)) THEN
      RAISE EXCEPTION 'assess.score_precision: trop de décimales pour ce tenant' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF assess.period_locked(a.tenant_id, a.classroom_id, a.academic_period_id, a.session_no) THEN
      RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
    END IF;
    IF a.status = 'DRAFT' THEN
      NEW.status := 'DRAFT';
    ELSE
      SELECT * INTO rev FROM assess.grade_revisions WHERE tenant_id = NEW.tenant_id AND id = assess.current_revision_id();
      IF NOT FOUND OR a.status <> 'PUBLISHED' OR rev.kind <> 'ADDITION' OR rev.status <> 'APPROVED'
         OR rev.assessment_id <> NEW.assessment_id OR rev.enrollment_id <> NEW.enrollment_id
         OR rev.new_entry_status <> NEW.entry_status OR rev.new_score IS DISTINCT FROM NEW.score THEN
        RAISE EXCEPTION 'assess.grade_frozen: une note n''est ajoutée à une feuille non brouillon que par une révision approuvée' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.status := a.status;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.assessment_id <> OLD.assessment_id
     OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id THEN
    RAISE EXCEPTION 'assess.identity_immutable: identité de la note figée' USING ERRCODE = 'restrict_violation';
  END IF;

  v_changed := NEW.score IS DISTINCT FROM OLD.score OR NEW.entry_status <> OLD.entry_status OR NEW.comment IS DISTINCT FROM OLD.comment;
  IF v_changed THEN
    IF a.status <> 'DRAFT' THEN
      SELECT * INTO rev FROM assess.grade_revisions WHERE tenant_id = NEW.tenant_id AND id = assess.current_revision_id();
      IF NOT FOUND OR a.status <> 'PUBLISHED' OR rev.kind NOT IN ('CORRECTION', 'REMOVAL') OR rev.status <> 'APPROVED'
         OR rev.grade_id IS DISTINCT FROM OLD.id OR rev.new_entry_status <> NEW.entry_status
         OR rev.new_score IS DISTINCT FROM NEW.score OR NEW.comment IS DISTINCT FROM OLD.comment THEN
        RAISE EXCEPTION 'assess.grade_published: une note publiée ne se modifie que par une révision approuvée (assess.apply_revision)' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF assess.period_locked(a.tenant_id, a.classroom_id, a.academic_period_id, a.session_no) THEN
      RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'assess.status_mirror: le statut d''une note suit celui de son évaluation' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at := now(); END IF;
  ELSIF NEW.status <> OLD.status THEN
    IF NEW.status <> a.status THEN
      RAISE EXCEPTION 'assess.status_mirror: le statut d''une note suit celui de son évaluation' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER grades_guard BEFORE INSERT OR UPDATE OR DELETE ON assess.grades
  FOR EACH ROW EXECUTE FUNCTION assess.grades_guard();

-- -----------------------------------------------------------------------------
-- Révisions : l'ancienne valeur est RELUE en base ; contenu immuable ; progression de statut contrôlée.
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.grade_revisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a assess.assessments%ROWTYPE;
  g assess.grades%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'assess.revision_transition: une révision naît à l''état REQUESTED' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO a FROM assess.assessments WHERE tenant_id = NEW.tenant_id AND id = NEW.assessment_id;
    IF NOT FOUND OR a.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'assess.revision_not_applicable: seule une feuille publiée se corrige par révision' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.new_score IS NOT NULL AND NEW.new_score > a.scale_max THEN
      RAISE EXCEPTION 'assess.score_out_of_scale: la nouvelle note dépasse le barème (%)', a.scale_max USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'ADDITION' THEN
      IF EXISTS (SELECT 1 FROM assess.grades x WHERE x.tenant_id = NEW.tenant_id AND x.assessment_id = NEW.assessment_id AND x.enrollment_id = NEW.enrollment_id) THEN
        RAISE EXCEPTION 'assess.grade_exists: cette inscription figure déjà sur la feuille (utilisez une correction)' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.grade_id := NULL; NEW.old_score := NULL; NEW.old_entry_status := NULL;
    ELSE
      SELECT * INTO g FROM assess.grades x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.grade_id;
      IF NOT FOUND OR g.assessment_id <> NEW.assessment_id THEN
        RAISE EXCEPTION 'assess.grade_not_found: note introuvable sur cette évaluation' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.enrollment_id := g.enrollment_id;
      NEW.student_id := g.student_id;
      NEW.old_score := g.score;
      NEW.old_entry_status := g.entry_status;
      IF NEW.kind = 'CORRECTION' AND NEW.new_score IS NOT DISTINCT FROM g.score AND NEW.new_entry_status = g.entry_status THEN
        RAISE EXCEPTION 'assess.revision_noop: la nouvelle valeur est identique à la valeur publiée' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : le contenu ne bouge jamais.
  IF ROW(NEW.id, NEW.tenant_id, NEW.assessment_id, NEW.enrollment_id, NEW.student_id, NEW.kind, NEW.old_score, NEW.old_entry_status,
         NEW.new_score, NEW.new_entry_status, NEW.reason, NEW.requested_by, NEW.requested_by_name, NEW.requested_at, NEW.batch_id)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.assessment_id, OLD.enrollment_id, OLD.student_id, OLD.kind, OLD.old_score, OLD.old_entry_status,
         OLD.new_score, OLD.new_entry_status, OLD.reason, OLD.requested_by, OLD.requested_by_name, OLD.requested_at, OLD.batch_id) THEN
    RAISE EXCEPTION 'assess.revision_immutable: le contenu d''une révision ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.grade_id IS DISTINCT FROM OLD.grade_id AND NOT (OLD.grade_id IS NULL AND OLD.kind = 'ADDITION' AND NEW.status = 'APPLIED') THEN
    RAISE EXCEPTION 'assess.revision_immutable: la note visée ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    IF ROW(NEW.decided_by, NEW.decided_by_name, NEW.decided_at, NEW.decision_comment, NEW.four_eyes_waived, NEW.applied_at)
       IS DISTINCT FROM ROW(OLD.decided_by, OLD.decided_by_name, OLD.decided_at, OLD.decision_comment, OLD.four_eyes_waived, OLD.applied_at) THEN
      RAISE EXCEPTION 'assess.revision_immutable: la décision d''une révision ne change pas' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED')) OR (OLD.status = 'APPROVED' AND NEW.status = 'APPLIED')) THEN
    RAISE EXCEPTION 'assess.revision_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'APPLIED' THEN
    IF assess.current_revision_id() IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'assess.revision_apply_only: une révision ne s''applique que par assess.apply_revision' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO g FROM assess.grades x WHERE x.tenant_id = NEW.tenant_id AND x.assessment_id = NEW.assessment_id AND x.enrollment_id = NEW.enrollment_id;
    IF NOT FOUND OR g.score IS DISTINCT FROM NEW.new_score OR g.entry_status <> NEW.new_entry_status THEN
      RAISE EXCEPTION 'assess.revision_not_applied: la note ne porte pas la valeur de la révision' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.kind = 'ADDITION' THEN NEW.grade_id := g.id; END IF;
  ELSE
    SELECT * INTO a FROM assess.assessments WHERE tenant_id = NEW.tenant_id AND id = NEW.assessment_id;
    IF NOT FOUND OR a.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'assess.revision_not_applicable: la feuille n''est plus publiée' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER grade_revisions_guard BEFORE INSERT OR UPDATE ON assess.grade_revisions
  FOR EACH ROW EXECUTE FUNCTION assess.grade_revisions_guard();

-- -----------------------------------------------------------------------------
-- Verrous de période : relâchés une seule fois ; `locked_sessions` ne peut que DIMINUER tant que le verrou est actif
-- (jamais s'élargir sans nouveau verrou).
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.period_locks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.tenant_id, NEW.classroom_id, NEW.academic_period_id, NEW.locked_at, NEW.locked_by, NEW.lock_reason)
     IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.classroom_id, OLD.academic_period_id, OLD.locked_at, OLD.locked_by, OLD.lock_reason) THEN
    RAISE EXCEPTION 'assess.lock_immutable: l''identité d''un verrou ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'assess.lock_released: un verrou relâché est définitif' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.released_at IS NULL THEN
    IF NOT (NEW.locked_sessions <@ OLD.locked_sessions) THEN
      RAISE EXCEPTION 'assess.lock_cannot_widen: un verrou actif ne peut qu''être réduit' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NEW.locked_sessions IS DISTINCT FROM OLD.locked_sessions THEN
      RAISE EXCEPTION 'assess.lock_immutable: les sessions d''un verrou relâché ne changent pas' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER period_locks_guard BEFORE UPDATE ON assess.period_locks
  FOR EACH ROW EXECUTE FUNCTION assess.period_locks_guard();

-- -----------------------------------------------------------------------------
-- assess.apply_revision : SEULE voie de modification d'une note publiée.
-- SECURITY INVOKER : les droits et la RLS de l'appelant s'appliquent ; le déclencheur `grades_guard` revérifie tout.
-- -----------------------------------------------------------------------------
CREATE FUNCTION assess.apply_revision(p_revision uuid, p_at timestamptz DEFAULT now()) RETURNS assess.grade_revisions
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  r assess.grade_revisions%ROWTYPE;
  a assess.assessments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM assess.grade_revisions WHERE id = p_revision FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assess.revision_not_found: révision introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'assess.revision_not_approved: seule une révision approuvée s''applique (état %)', r.status USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO a FROM assess.assessments WHERE tenant_id = r.tenant_id AND id = r.assessment_id FOR SHARE;
  IF a.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'assess.revision_not_applicable: la feuille n''est plus publiée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF assess.period_locked(a.tenant_id, a.classroom_id, a.academic_period_id, a.session_no) THEN
    RAISE EXCEPTION 'assess.period_locked: la période de cette classe est verrouillée pour cette session' USING ERRCODE = 'restrict_violation';
  END IF;

  PERFORM set_config('app.grade_revision_id', p_revision::text, true);
  IF r.kind = 'ADDITION' THEN
    INSERT INTO assess.grades (id, tenant_id, assessment_id, enrollment_id, student_id, score, entry_status, status, entered_by, entered_at)
    VALUES (gen_random_uuid(), r.tenant_id, r.assessment_id, r.enrollment_id, r.student_id, r.new_score, r.new_entry_status, a.status, r.decided_by, p_at);
  ELSE
    UPDATE assess.grades SET score = r.new_score, entry_status = r.new_entry_status, updated_at = p_at
     WHERE tenant_id = r.tenant_id AND id = r.grade_id;
  END IF;
  UPDATE assess.grade_revisions SET status = 'APPLIED', applied_at = p_at WHERE id = p_revision RETURNING * INTO r;
  PERFORM set_config('app.grade_revision_id', '', true);
  RETURN r;
END
$$;
REVOKE ALL ON FUNCTION assess.apply_revision(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assess.apply_revision(uuid, timestamptz) TO app_user;
