-- Fixtures du module examinations (superutilisateur : la RLS n'est pas l'objet).
CREATE EXTENSION IF NOT EXISTS dblink;   -- essais de concurrence (plusieurs sessions réelles)

-- Type CEPE FICTIF (valeurs de démonstration, source_kind = placeholder) avec trois épreuves fictives
-- (plus une épreuve inactive qui ne doit jamais être copiée) et une pièce exigée.
CREATE OR REPLACE FUNCTION ddltest.cepe_type(p_tenant uuid, p_type uuid, p_with_requirement boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code, grade_level_code, source_kind)
  VALUES (p_type, p_tenant, 'CEPE', 'CEPE (donnée fictive)', 'PRIMARY', 'CM2', 'placeholder');
  INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, code, label, coefficient, scale_max, ordinal, source_kind, active)
  VALUES (gen_random_uuid(), p_tenant, p_type, 'EP1', 'Épreuve 1 (fictive)', 1, 20, 1, 'placeholder', true),
         (gen_random_uuid(), p_tenant, p_type, 'EP2', 'Épreuve 2 (fictive)', 2, 20, 2, 'placeholder', true),
         (gen_random_uuid(), p_tenant, p_type, 'EP3', 'Épreuve 3 (fictive)', 1, 10, 3, 'placeholder', true),
         (gen_random_uuid(), p_tenant, p_type, 'EPX', 'Épreuve inactive', 1, 20, 4, 'placeholder', false);
  IF p_with_requirement THEN
    INSERT INTO examinations.document_requirements (id, tenant_id, exam_type_id, code, label, source_kind)
    VALUES (gen_random_uuid(), p_tenant, p_type, 'ACTE_NAISSANCE', 'Acte de naissance', 'placeholder');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ddltest.new_session(p_id uuid, p_tenant uuid, p_type uuid, p_inst uuid, p_code text,
                                               p_kind text DEFAULT 'OFFICIAL', p_mock_of uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO examinations.sessions (id, tenant_id, exam_type_id, institution_id, code, label, session_kind, session_year, mock_of_session_id, source_kind)
  VALUES (p_id, p_tenant, p_type, p_inst, p_code, 'Session ' || p_code, p_kind, 2027, p_mock_of, 'placeholder');
END $$;

-- Session ouverte aux inscriptions (définition figée)
CREATE OR REPLACE FUNCTION ddltest.open_session(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM examinations.sessions WHERE id = p_id;
  PERFORM ddltest.as_tenant(t);
  PERFORM examinations.instantiate_session_definition(p_id);
  UPDATE examinations.sessions SET status = 'REGISTRATION_OPEN' WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION ddltest.new_candidate(p_id uuid, p_tenant uuid, p_session uuid, p_inst uuid, p_student uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, grade_level_code)
  VALUES (p_id, p_tenant, p_session, p_inst, p_student, 'CM2');
END $$;

-- Éligibilité établie (journal) puis inscription du candidat, avec identité figée.
CREATE OR REPLACE FUNCTION ddltest.register(p_candidate uuid, p_last text DEFAULT 'NOM', p_sex text DEFAULT 'F') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO c FROM examinations.candidates WHERE id = p_candidate;
  PERFORM ddltest.as_tenant(c.tenant_id);
  IF c.eligibility_status <> 'ELIGIBLE' THEN
    INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result)
    VALUES (gen_random_uuid(), c.tenant_id, c.id, gen_random_uuid(), 'ELIGIBLE');
  END IF;
  UPDATE examinations.candidates
     SET registration_status = 'REGISTERED', last_name = p_last, first_name = 'Prénom', birth_date = DATE '2016-05-05', sex = p_sex
   WHERE id = p_candidate;
END $$;
