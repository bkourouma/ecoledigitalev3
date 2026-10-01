-- =============================================================================
-- 0804 — Module people (spec 008) : invariants des personnes, élèves et tuteurs
-- =============================================================================
-- (les invariants du personnel et des affectations sont en 0805, spec 009)

CREATE FUNCTION people.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'people.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER student_status_history_immutable BEFORE UPDATE OR DELETE ON people.student_status_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Jamais de suppression physique d'un dossier : on change le statut (le legacy supprimait en
-- cascade notes, présences, paiements et échéances avec la fiche élève).
CREATE TRIGGER persons_no_delete BEFORE DELETE ON people.persons
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER students_no_delete BEFORE DELETE ON people.students
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER guardians_no_delete BEFORE DELETE ON people.guardians
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER student_guardians_no_delete BEFORE DELETE ON people.student_guardians
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Élève : le matricule interne et le numéro d'ordre sont IMMUABLES (le legacy les réécrivait à
-- chaque lecture de la liste) ; transitions de statut légales.
--   ACTIVE <-> INACTIVE ; ACTIVE <-> SUSPENDED ; SUSPENDED -> INACTIVE ;
--   ACTIVE|INACTIVE|SUSPENDED -> GRADUATED | WITHDRAWN | TRANSFERRED_OUT | EXCLUDED ;
--   tout statut final -> ARCHIVED ; GRADUATED | WITHDRAWN | TRANSFERRED_OUT | EXCLUDED -> ACTIVE
--   (retour : réinscription ; motif exigé côté domaine) ; ARCHIVED -> ACTIVE.
-- -----------------------------------------------------------------------------
CREATE FUNCTION people.students_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_number <> OLD.student_number OR NEW.sequence_number <> OLD.sequence_number
     OR NEW.person_id <> OLD.person_id THEN
    RAISE EXCEPTION 'people.student_identity_immutable: matricule, numéro d''ordre et personne d''un élève sont figés'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'ACTIVE'    AND NEW.status IN ('INACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status = 'INACTIVE'  AND NEW.status IN ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'INACTIVE', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status IN ('GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED') AND NEW.status IN ('ARCHIVED', 'ACTIVE')) OR
       (OLD.status = 'ARCHIVED' AND NEW.status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'people.student_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER students_guard BEFORE UPDATE ON people.students
  FOR EACH ROW EXECUTE FUNCTION people.students_guard();
