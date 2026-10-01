-- =============================================================================
-- 0953 — Module scheduling : conflits imposés par la base, verrous de paie, journal, heures payables
-- =============================================================================
--
-- Défense en profondeur : le domaine (TypeScript) détecte et explique les conflits AVANT l'écriture
-- (aperçu), la base les IMPOSE. La contrainte d'exclusion de `resource_claims` est DEFERRABLE
-- INITIALLY DEFERRED (vérifiée au COMMIT, ce qui permet d'échanger deux enseignants dans une même
-- transaction) ; les cas d'usage exécutent
--     SET CONSTRAINTS scheduling.resource_claims_no_overlap IMMEDIATE
-- en début de transaction pour localiser l'erreur à l'instruction fautive et la traduire en
-- `scheduling.conflict_detected`.
--
-- Codes d'erreur : le message de chaque exception commence par un code stable `scheduling.<code>:`
-- (lu par infrastructure/db-errors.ts) ; `restrict_violation` pour une écriture interdite,
-- `check_violation` pour une valeur invalide, `exclusion_violation` pour un conflit de ressource.
-- =============================================================================

CREATE FUNCTION scheduling.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scheduling.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER occurrence_changes_immutable BEFORE UPDATE OR DELETE ON scheduling.occurrence_changes
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();
CREATE TRIGGER generation_runs_immutable BEFORE UPDATE OR DELETE ON scheduling.generation_runs
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();
CREATE TRIGGER occurrences_no_delete BEFORE DELETE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Maintenance des réservations de ressources (SECURITY DEFINER : l'application n'a qu'un SELECT
-- sur resource_claims). Le tenant vient du contexte de transaction, jamais d'un paramètre.
-- Les entrées « comptables » (heures sans plage réelle) ne réservent rien.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.sync_occurrence_claims(p_occurrence uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
DECLARE
  o        scheduling.session_occurrences%ROWTYPE;
  v_mode   text;
BEGIN
  SELECT * INTO o FROM scheduling.session_occurrences
   WHERE tenant_id = kernel.current_tenant_id() AND id = p_occurrence;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM scheduling.resource_claims WHERE tenant_id = o.tenant_id AND occurrence_id = o.id;
  IF o.status = 'CANCELLED' OR o.origin = 'ACCOUNTING' THEN RETURN; END IF;

  -- Groupe d'apprenants : la classe quand elle est réunie ; sinon (offre à la carte) l'OFFRE elle-même,
  -- pour qu'une même offre ne tienne pas deux séances simultanées. Même famille « CLASSROOM » et
  -- même politique ; les identifiants (classe / offre) sont des UUID distincts.
  IF o.kind IN ('LESSON', 'EXAM')
     AND ((o.claims_classroom AND o.classroom_id IS NOT NULL) OR (NOT o.claims_classroom AND o.offering_id IS NOT NULL)) THEN
    SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                      WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'CLASSROOM'), 'BLOCK')
      INTO v_mode;
    INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
    VALUES (gen_random_uuid(), o.tenant_id, o.id, 'CLASSROOM',
            CASE WHEN o.claims_classroom THEN o.classroom_id ELSE o.offering_id END,
            o.during, v_mode = 'BLOCK' AND NOT o.conflict_override);
  END IF;

  IF o.room_id IS NOT NULL THEN
    SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                      WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'ROOM'), 'BLOCK')
      INTO v_mode;
    INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
    VALUES (gen_random_uuid(), o.tenant_id, o.id, 'ROOM', o.room_id, o.during, v_mode = 'BLOCK' AND NOT o.conflict_override);
  END IF;

  SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                    WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'STAFF'), 'BLOCK')
    INTO v_mode;
  INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
  SELECT gen_random_uuid(), o.tenant_id, o.id, 'STAFF', s.staff_id, o.during, v_mode = 'BLOCK' AND NOT o.conflict_override
    FROM scheduling.occurrence_staff s
   WHERE s.tenant_id = o.tenant_id AND s.occurrence_id = o.id;
END
$$;
REVOKE ALL ON FUNCTION scheduling.sync_occurrence_claims(uuid) FROM PUBLIC;

CREATE FUNCTION scheduling.occurrences_claims_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
BEGIN
  PERFORM scheduling.sync_occurrence_claims(NEW.id);
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION scheduling.occurrences_claims_trigger() FROM PUBLIC;
CREATE TRIGGER occurrences_claims AFTER INSERT OR UPDATE OF starts_at, ends_at, status, room_id, classroom_id, offering_id, claims_classroom, conflict_override, kind, origin
  ON scheduling.session_occurrences FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_claims_trigger();

CREATE FUNCTION scheduling.occurrence_staff_claims_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
BEGIN
  PERFORM scheduling.sync_occurrence_claims(coalesce(NEW.occurrence_id, OLD.occurrence_id));
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION scheduling.occurrence_staff_claims_trigger() FROM PUBLIC;
CREATE TRIGGER occurrence_staff_claims AFTER INSERT OR UPDATE OF staff_id OR DELETE
  ON scheduling.occurrence_staff FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_claims_trigger();

-- -----------------------------------------------------------------------------
-- Occurrence : identité figée, transitions légales, validation = verrou sur l'horaire,
-- salle disponible.
--   PLANNED -> HELD | CANCELLED ; HELD -> CANCELLED | PLANNED (si non validée) ; CANCELLED -> PLANNED
--   Une séance VALIDÉE ne change ni d'horaire ni de statut : on la dévalide d'abord (le legacy
--   modifiait silencieusement les heures d'une séance validée).
--   Une séance dont un intervenant a ses heures verrouillées par la paie ne bouge plus du tout.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrences_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_room_status text;
BEGIN
  IF NEW.room_id IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW.room_id IS DISTINCT FROM OLD.room_id
       OR (OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED')) THEN
    SELECT status INTO v_room_status FROM scheduling.rooms WHERE tenant_id = NEW.tenant_id AND id = NEW.room_id;
    IF v_room_status IS DISTINCT FROM 'AVAILABLE' AND NEW.status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'scheduling.room_unavailable: la salle est %', coalesce(v_room_status, 'inconnue') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  IF NEW.tenant_id <> OLD.tenant_id OR NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
     OR NEW.timetable_entry_id IS DISTINCT FROM OLD.timetable_entry_id OR NEW.generated_for IS DISTINCT FROM OLD.generated_for
     OR NEW.kind <> OLD.kind OR NEW.origin <> OLD.origin THEN
    RAISE EXCEPTION 'scheduling.occurrence_identity_immutable: l''identité de la séance ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PLANNED'   AND NEW.status IN ('HELD', 'CANCELLED')) OR
       (OLD.status = 'HELD'      AND NEW.status IN ('CANCELLED', 'PLANNED')) OR
       (OLD.status = 'CANCELLED' AND NEW.status = 'PLANNED')) THEN
    RAISE EXCEPTION 'scheduling.occurrence_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.validated_at IS NOT NULL AND NEW.validated_at IS NOT NULL
     AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.status <> OLD.status OR NEW.room_id IS DISTINCT FROM OLD.room_id
          OR NEW.classroom_id IS DISTINCT FROM OLD.classroom_id OR NEW.offering_id IS DISTINCT FROM OLD.offering_id) THEN
    RAISE EXCEPTION 'scheduling.occurrence_validated: dévalider la séance avant de la modifier' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.status <> OLD.status
      OR NEW.validated_at IS DISTINCT FROM OLD.validated_at OR NEW.room_id IS DISTINCT FROM OLD.room_id) AND EXISTS (
       SELECT 1 FROM scheduling.occurrence_staff s
        WHERE s.tenant_id = OLD.tenant_id AND s.occurrence_id = OLD.id AND s.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'scheduling.occurrence_locked: des heures de cette séance sont verrouillées par la paie' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrences_guard BEFORE INSERT OR UPDATE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_guard();

-- -----------------------------------------------------------------------------
-- Intervenants : pas d'écriture sur une séance validée ; une ligne verrouillée par la paie est
-- gelée (déverrouillage seulement via `scheduling.payroll_unlock = on`, posé par l'API publique
-- `releaseHoursLock`). Un verrou ne se pose que sur une ligne rémunérée d'une séance validée.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrence_staff_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_validated timestamptz;
  v_status    text;
  v_unlock    boolean := coalesce(current_setting('scheduling.payroll_unlock', true), '') = 'on';
  v_row       scheduling.occurrence_staff%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  SELECT validated_at, status INTO v_validated, v_status FROM scheduling.session_occurrences
   WHERE tenant_id = v_row.tenant_id AND id = v_row.occurrence_id;

  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL THEN
    IF v_unlock AND NEW.locked_at IS NULL AND NEW.lock_ref IS NULL
       AND NEW.staff_id = OLD.staff_id AND NEW.role = OLD.role AND NEW.is_paid_role = OLD.is_paid_role
       AND NEW.paid_minutes IS NOT DISTINCT FROM OLD.paid_minutes THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduling.hours_locked: heures verrouillées par la paie (%)', OLD.lock_ref USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'scheduling.hours_locked: heures verrouillées par la paie (%)', OLD.lock_ref USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.locked_at IS NOT NULL AND OLD.locked_at IS NULL THEN
    IF v_validated IS NULL OR v_status <> 'HELD' OR NOT NEW.is_paid_role THEN
      RAISE EXCEPTION 'scheduling.hours_not_payable: seules les heures rémunérées d''une séance réalisée et validée se verrouillent' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.staff_id <> OLD.staff_id OR NEW.role <> OLD.role OR NEW.is_paid_role <> OLD.is_paid_role
       OR NEW.paid_minutes IS DISTINCT FROM OLD.paid_minutes OR NEW.occurrence_id <> OLD.occurrence_id THEN
      RAISE EXCEPTION 'scheduling.hours_locked: le verrouillage ne modifie aucune autre colonne' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF v_validated IS NOT NULL THEN
    RAISE EXCEPTION 'scheduling.occurrence_validated: dévalider la séance avant de changer ses intervenants' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrence_staff_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling.occurrence_staff
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_guard();

-- -----------------------------------------------------------------------------
-- Équipement : la somme des quantités réservées sur des plages qui se chevauchent ne dépasse
-- pas le stock (verrou de ligne sur l'article : les réservations concurrentes se sérialisent).
-- Contrôle appelé à l'ajout d'une ligne ET quand la séance change de plage ou redevient active.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.equipment_in_use(p_equipment uuid, p_during tstzrange, p_exclude_occurrence uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(e.quantity), 0)::integer
    FROM scheduling.occurrence_equipment e
    JOIN scheduling.session_occurrences o ON o.tenant_id = e.tenant_id AND o.id = e.occurrence_id
   WHERE e.tenant_id = kernel.current_tenant_id() AND e.equipment_id = p_equipment
     AND (p_exclude_occurrence IS NULL OR e.occurrence_id <> p_exclude_occurrence)
     AND o.status <> 'CANCELLED' AND NOT o.conflict_override AND o.during && p_during
$$;
GRANT EXECUTE ON FUNCTION scheduling.equipment_in_use(uuid, tstzrange, uuid) TO app_user;

CREATE FUNCTION scheduling.check_equipment_stock(p_tenant uuid, p_occurrence uuid, p_equipment uuid, p_quantity integer, p_new_row boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_item  scheduling.equipment_items%ROWTYPE;
  v_occ   scheduling.session_occurrences%ROWTYPE;
  v_mode  text;
  v_used  integer;
BEGIN
  SELECT * INTO v_item FROM scheduling.equipment_items WHERE tenant_id = p_tenant AND id = p_equipment FOR UPDATE;
  SELECT * INTO v_occ FROM scheduling.session_occurrences WHERE tenant_id = p_tenant AND id = p_occurrence;
  IF v_occ.status = 'CANCELLED' THEN RETURN; END IF;
  IF p_new_row AND v_item.status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'scheduling.equipment_unavailable: l''équipement est %', v_item.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                    WHERE tenant_id = v_occ.tenant_id AND institution_id = v_occ.institution_id AND resource_kind = 'EQUIPMENT'), 'BLOCK')
    INTO v_mode;
  IF v_mode = 'BLOCK' AND NOT v_occ.conflict_override THEN
    v_used := scheduling.equipment_in_use(p_equipment, v_occ.during, p_occurrence);
    IF v_used + p_quantity > v_item.quantity THEN
      RAISE EXCEPTION 'scheduling.equipment_conflict: stock % dépassé (% déjà réservés, % demandés)', v_item.quantity, v_used, p_quantity
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
END
$$;

CREATE FUNCTION scheduling.occurrence_equipment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM scheduling.check_equipment_stock(NEW.tenant_id, NEW.occurrence_id, NEW.equipment_id, NEW.quantity, true);
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrence_equipment_guard BEFORE INSERT OR UPDATE ON scheduling.occurrence_equipment
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_equipment_guard();

CREATE FUNCTION scheduling.occurrence_equipment_recheck() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT equipment_id, quantity FROM scheduling.occurrence_equipment
            WHERE tenant_id = NEW.tenant_id AND occurrence_id = NEW.id ORDER BY equipment_id LOOP
    PERFORM scheduling.check_equipment_stock(NEW.tenant_id, NEW.id, r.equipment_id, r.quantity, false);
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrences_equipment_recheck AFTER UPDATE OF starts_at, ends_at, status, conflict_override
  ON scheduling.session_occurrences FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_equipment_recheck();

-- -----------------------------------------------------------------------------
-- Journal automatique des changements (qui, quoi, pourquoi). Motif lu dans le réglage de
-- transaction `scheduling.change_reason`, posé par les cas d'usage.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrences_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED',
            jsonb_build_object('startsAt', NEW.starts_at, 'endsAt', NEW.ends_at, 'roomId', NEW.room_id, 'origin', NEW.origin), v_reason, v_actor);
    RETURN NULL;
  END IF;
  IF NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RESCHEDULED',
            jsonb_build_object('startsAt', OLD.starts_at, 'endsAt', OLD.ends_at), jsonb_build_object('startsAt', NEW.starts_at, 'endsAt', NEW.ends_at), v_reason, v_actor);
  END IF;
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'ROOM_CHANGED', to_jsonb(OLD.room_id), to_jsonb(NEW.room_id), v_reason, v_actor);
  END IF;
  IF NEW.status <> OLD.status THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE NEW.status WHEN 'HELD' THEN 'HELD' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'UNHELD' END,
            to_jsonb(OLD.status), to_jsonb(NEW.status), coalesce(NEW.cancel_reason, v_reason), v_actor);
  END IF;
  IF NEW.validated_at IS DISTINCT FROM OLD.validated_at THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE WHEN NEW.validated_at IS NULL THEN 'UNVALIDATED' ELSE 'VALIDATED' END,
            to_jsonb(OLD.validated_at), to_jsonb(NEW.validated_at), v_reason, v_actor);
  END IF;
  IF NEW.conflict_override AND NOT OLD.conflict_override THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'OVERRIDE', jsonb_build_object('reason', NEW.conflict_override_reason), NEW.conflict_override_reason, NEW.conflict_override_by);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrences_journal AFTER INSERT OR UPDATE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_journal();

CREATE FUNCTION scheduling.occurrence_staff_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.occurrence_id, 'STAFF_CHANGED', jsonb_build_object('added', NEW.staff_id, 'role', NEW.role, 'replaces', NEW.replaces_staff_id), v_reason, v_actor);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, reason, actor_id)
    VALUES (gen_random_uuid(), OLD.tenant_id, OLD.occurrence_id, 'STAFF_CHANGED', jsonb_build_object('removed', OLD.staff_id, 'role', OLD.role), v_reason, v_actor);
  ELSE
    IF NEW.paid_minutes IS DISTINCT FROM OLD.paid_minutes THEN
      INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.occurrence_id, 'PAID_MINUTES',
              jsonb_build_object('staffId', NEW.staff_id, 'minutes', OLD.paid_minutes), jsonb_build_object('staffId', NEW.staff_id, 'minutes', NEW.paid_minutes), v_reason, v_actor);
    END IF;
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.occurrence_id, CASE WHEN NEW.locked_at IS NULL THEN 'UNLOCKED' ELSE 'LOCKED' END,
              jsonb_build_object('staffId', NEW.staff_id, 'lockRef', OLD.lock_ref), jsonb_build_object('staffId', NEW.staff_id, 'lockRef', NEW.lock_ref), v_reason, v_actor);
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrence_staff_journal AFTER INSERT OR UPDATE OR DELETE ON scheduling.occurrence_staff
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_journal();

-- -----------------------------------------------------------------------------
-- Heures payables : une heure est payable si la séance est RÉALISÉE (HELD), VALIDÉE, et que
-- l'intervenant est de rôle rémunéré. Durée payée = dérogation, sinon durée de la séance. C'est
-- le prédicat unique que la paie (032) lit ; l'exclusion « une heure ne se paie qu'une fois »
-- est garantie par le verrou `locked_at` / `lock_ref` (lockHours, exclusif et atomique).
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.payable_hours(p_from date, p_to date, p_staff uuid[] DEFAULT NULL)
RETURNS TABLE (
  occurrence_id uuid, staff_id uuid, occurs_on date, minutes integer, kind text,
  classroom_id uuid, curriculum_node_id uuid, offering_id uuid, title text,
  locked boolean, lock_ref uuid)
LANGUAGE sql STABLE AS $$
  SELECT o.id, s.staff_id, o.occurs_on,
         coalesce(s.paid_minutes, round(extract(epoch FROM (o.ends_at - o.starts_at)) / 60)::integer),
         o.kind, o.classroom_id, o.curriculum_node_id, o.offering_id, o.title,
         s.locked_at IS NOT NULL, s.lock_ref
    FROM scheduling.session_occurrences o
    JOIN scheduling.occurrence_staff s ON s.tenant_id = o.tenant_id AND s.occurrence_id = o.id
   WHERE o.tenant_id = kernel.current_tenant_id()
     AND o.status = 'HELD' AND o.validated_at IS NOT NULL AND s.is_paid_role
     AND o.occurs_on BETWEEN p_from AND p_to
     AND (p_staff IS NULL OR s.staff_id = ANY (p_staff))
$$;
GRANT EXECUTE ON FUNCTION scheduling.payable_hours(date, date, uuid[]) TO app_user;

-- -----------------------------------------------------------------------------
-- Conflits d'une plage candidate (aperçu, avant écriture) : renvoie les réservations qui
-- chevauchent, y compris non exclusives (politique WARN) pour l'affichage des avertissements.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.find_conflicts(
  p_during tstzrange, p_staff uuid[], p_classroom uuid, p_room uuid, p_exclude_occurrence uuid DEFAULT NULL)
RETURNS TABLE (resource_kind text, resource_id uuid, occurrence_id uuid, during tstzrange, exclusive boolean)
LANGUAGE sql STABLE AS $$
  SELECT c.resource_kind, c.resource_id, c.occurrence_id, c.during, c.exclusive
    FROM scheduling.resource_claims c
   WHERE c.tenant_id = kernel.current_tenant_id()
     AND c.during && p_during
     AND (p_exclude_occurrence IS NULL OR c.occurrence_id <> p_exclude_occurrence)
     AND ((c.resource_kind = 'STAFF' AND c.resource_id = ANY (coalesce(p_staff, ARRAY[]::uuid[])))
       OR (c.resource_kind = 'CLASSROOM' AND c.resource_id = p_classroom)
       OR (c.resource_kind = 'ROOM' AND c.resource_id = p_room))
$$;
GRANT EXECUTE ON FUNCTION scheduling.find_conflicts(tstzrange, uuid[], uuid, uuid, uuid) TO app_user;
