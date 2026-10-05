-- =============================================================================
-- 0905 — Module attendance : appel du primaire par DEMI-JOURNÉE (décision Q-P17, 2026-10-05)
-- =============================================================================
--
-- Le primaire fait l'appel le MATIN et l'APRÈS-MIDI dès la V1. Évolution ADDITIVE de 0900-0904 (rien n'est supprimé, aucune
-- donnée n'est réécrite) :
--
--   * `sessions.day_part`                 FULL (appel journalier unique : secondaire, établissements qui le préfèrent),
--                                         MORNING ou AFTERNOON (appel d'une demi-journée). Les séances existantes sont FULL.
--   * `sessions_one_daily`                un appel DAILY par classe, par jour ET par demi-journée (même nom d'index qu'avant).
--   * `sessions_daily_parts_exclusive`    un appel FULL exclut les appels MORNING / AFTERNOON du même jour et inversement
--                                         (contrainte d'exclusion sur la plage de demi-journées occupée).
--   * `call_policies.daily_call_mode`     SINGLE (un appel par jour : valeur par défaut, comportement historique) ou HALF_DAYS
--                                         (deux appels par jour). Politique d'ÉTABLISSEMENT modifiable, pas une règle réglementaire.
--   * `sessions_guard`                    la demi-journée d'un appel est figée comme sa classe, sa date et sa portée.
--
-- Les récapitulatifs `summarize_enrollment` comptent déjà un pointage par appel : en demi-journées, chaque appel compte pour un.
-- =============================================================================

ALTER TABLE attendance.sessions ADD COLUMN day_part text NOT NULL DEFAULT 'FULL' CHECK (day_part IN ('FULL', 'MORNING', 'AFTERNOON'));
-- Une demi-journée n'a de sens que pour l'appel journalier : un appel par séance planifiée est toujours FULL.
ALTER TABLE attendance.sessions ADD CONSTRAINT sessions_day_part_scope_ck CHECK (scope = 'DAILY' OR day_part = 'FULL');

DROP INDEX attendance.sessions_one_daily;
CREATE UNIQUE INDEX sessions_one_daily ON attendance.sessions (tenant_id, classroom_id, session_date, day_part) WHERE scope = 'DAILY' AND status <> 'CANCELLED';

-- Plage de demi-journées occupée : FULL = [0,2), MORNING = [0,1), AFTERNOON = [1,2). Deux appels d'une même classe le même jour ne
-- peuvent pas se chevaucher (btree_gist est créée par 0900).
ALTER TABLE attendance.sessions ADD CONSTRAINT sessions_daily_parts_exclusive EXCLUDE USING gist (
  tenant_id WITH =,
  classroom_id WITH =,
  session_date WITH =,
  (CASE day_part WHEN 'FULL' THEN int4range(0, 2) WHEN 'MORNING' THEN int4range(0, 1) ELSE int4range(1, 2) END) WITH &&
) WHERE (scope = 'DAILY' AND status <> 'CANCELLED');

ALTER TABLE attendance.call_policies ADD COLUMN daily_call_mode text NOT NULL DEFAULT 'SINGLE' CHECK (daily_call_mode IN ('SINGLE', 'HALF_DAYS'));
-- Deux appels par jour n'ont de sens que pour l'appel journalier (ou mixte), jamais pour un cycle en appel par séance seulement.
ALTER TABLE attendance.call_policies ADD CONSTRAINT call_policies_half_days_scope_ck CHECK (daily_call_mode = 'SINGLE' OR call_scope IN ('DAILY', 'BOTH'));

CREATE OR REPLACE FUNCTION attendance.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classroom_id <> OLD.classroom_id OR NEW.session_date <> OLD.session_date OR NEW.scope <> OLD.scope
     OR NEW.day_part <> OLD.day_part OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id THEN
    RAISE EXCEPTION 'attendance.session_identity_immutable: classe, date, portée, demi-journée et occurrence d''un appel sont figées'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'OPEN'      AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
         (OLD.status = 'SUBMITTED' AND NEW.status IN ('VALIDATED', 'OPEN', 'CANCELLED')) OR
         (OLD.status = 'VALIDATED' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'attendance.session_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED' AND coalesce(current_setting('attendance.reopen', true), '') <> 'on' THEN
      RAISE EXCEPTION 'attendance.session_validated: réouverture réservée à reopenAttendanceSession' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
