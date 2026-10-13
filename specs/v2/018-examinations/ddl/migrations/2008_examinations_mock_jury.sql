-- =============================================================================
-- 2008 — Module examinations : jury de délibération d'un EXAMEN BLANC
-- =============================================================================
--
-- Pourquoi seulement les examens blancs : pour une session OFFICIELLE, l'admission est celle que l'autorité prononce — l'école
-- l'enregistre ou l'importe, elle ne la délibère ni ne la calcule (déclencheur `official_not_computed`). Pour un examen BLANC, le
-- résultat est calculé par la règle `exam-national@1` ; le jury de l'école le relit et tranche pédagogiquement (admis, ajourné,
-- différé), en motivant tout écart avec la proposition de la règle.
--
-- La décision du jury ne modifie JAMAIS `candidate_results` (la proposition de la règle reste intacte, tracée par version de règle
-- et empreinte) et ne sert jamais de document officiel (R-EXA-11) : les deux sont des tables à part, une décision par candidat.
-- =============================================================================

CREATE TABLE examinations.mock_juries (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id  uuid NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  held_on     date,
  note        text CHECK (note IS NULL OR length(note) <= 2000),
  opened_by   uuid NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_by   uuid,
  closed_at   timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id),                          -- un seul jury par examen blanc
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.mock_juries');
GRANT SELECT, INSERT, UPDATE ON examinations.mock_juries TO app_user;

CREATE TABLE examinations.mock_jury_decisions (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id       uuid NOT NULL,
  jury_id          uuid NOT NULL,
  candidate_id     uuid NOT NULL,
  proposed_code    text NOT NULL CHECK (proposed_code IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),  -- proposition de la règle, figée
  proposed_average numeric(7, 3) CHECK (proposed_average IS NULL OR proposed_average >= 0),
  final_code       text NOT NULL CHECK (final_code IN ('ADMITTED', 'FAILED', 'DEFERRED')),
  justification    text,
  decided_by       uuid NOT NULL,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, jury_id, candidate_id),
  -- un écart avec la proposition de la règle exige une justification (comme R-RES-05 pour les décisions de période)
  CHECK (final_code = proposed_code OR length(btrim(coalesce(justification, ''))) >= 20),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.mock_juries (tenant_id, session_id),
  FOREIGN KEY (tenant_id, jury_id) REFERENCES examinations.mock_juries (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.mock_jury_decisions');
GRANT SELECT, INSERT, UPDATE ON examinations.mock_jury_decisions TO app_user;

-- Gardes : le jury ne concerne qu'un examen blanc ; un jury clos ne bouge plus (ni lui, ni ses décisions).
CREATE FUNCTION examinations.mock_juries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.session_kind INTO v_kind FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
    IF v_kind IS DISTINCT FROM 'MOCK' THEN
      RAISE EXCEPTION 'examinations.jury_mock_only: le jury ne concerne qu''un examen blanc' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'examinations.jury_closed: le jury est clos' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.opened_by <> OLD.opened_by OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION 'examinations.jury_immutable: le rattachement du jury ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mock_juries_guard BEFORE INSERT OR UPDATE ON examinations.mock_juries
  FOR EACH ROW EXECUTE FUNCTION examinations.mock_juries_guard();

CREATE FUNCTION examinations.mock_jury_decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT j.status INTO v_status FROM examinations.mock_juries j WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.jury_id;
  IF v_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'examinations.jury_closed: le jury est clos' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.jury_id <> OLD.jury_id OR NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id) THEN
    RAISE EXCEPTION 'examinations.jury_immutable: la décision reste attachée à son candidat' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mock_jury_decisions_guard BEFORE INSERT OR UPDATE ON examinations.mock_jury_decisions
  FOR EACH ROW EXECUTE FUNCTION examinations.mock_jury_decisions_guard();
