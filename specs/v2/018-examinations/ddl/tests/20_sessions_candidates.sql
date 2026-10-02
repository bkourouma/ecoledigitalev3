-- Sessions (définition figée, cycle de vie), candidats (éligibilité, pièces, numéro sans trou, historique),
-- répartition (centres, salles, places).
\set P '''a5000000-0000-4000-8000-0000000000a1'''
\set Q '''a5000000-0000-4000-8000-0000000000b1'''
SELECT ddltest.make_tenant(:P::uuid, 'ex-p');
SELECT ddltest.make_tenant(:Q::uuid, 'ex-q');

-- ---------------------------------------------------------------- jeu de départ et définition figée
DO $do$
DECLARE
  P constant uuid := 'a5000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a5100000-0000-4000-8000-000000000001';
  I constant uuid := 'a5200000-0000-4000-8000-000000000001';
  S1 constant uuid := 'a5300000-0000-4000-8000-000000000001';
  M1 constant uuid := 'a5300000-0000-4000-8000-000000000002';
  n integer;
BEGIN
  PERFORM ddltest.as_tenant(P);
  PERFORM ddltest.cepe_type(P, T, true);

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.sessions (id, tenant_id, exam_type_id, institution_id, code, label, session_year, status, definition_locked_at)
     VALUES (gen_random_uuid(), %L, %L, %L, 'X', 'x', 2027, 'IN_PROGRESS', now())$q$, P, T, I), 'session_initial_state', 'une session naît PLANNED');
  PERFORM ddltest.new_session(S1, P, T, I, 'CEPE-2027');
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_session(gen_random_uuid(), %L, %L, %L, 'CEPE-2027')$q$, P, T, I), '23505', 'code de session unique par établissement');
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_session(gen_random_uuid(), %L, %L, %L, 'BAD-MOCK', 'OFFICIAL', %L)$q$, P, T, I, S1), 'check', 'seul un examen blanc vise une session officielle');
  PERFORM ddltest.new_session(M1, P, T, I, 'CEPE-BLANC-1', 'MOCK', S1);
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_session(gen_random_uuid(), %L, %L, %L, 'BLANC-DE-BLANC', 'MOCK', %L)$q$, P, T, I, M1), 'mock_target_invalid', 'un examen blanc ne prépare pas un autre examen blanc');

  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET status = 'REGISTRATION_OPEN' WHERE id = %L$q$, S1), 'definition_not_locked', 'ouvrir sans définition figée est refusé');
  n := examinations.instantiate_session_definition(S1);
  PERFORM ddltest.ok(n = 3, 'la définition copie les 3 épreuves ACTIVES (l''épreuve inactive est ignorée)');
  PERFORM ddltest.throws(format($q$SELECT examinations.instantiate_session_definition(%L)$q$, S1), 'definition_locked', 'la définition ne se fige qu''une fois');
  UPDATE examinations.exam_papers SET coefficient = 9 WHERE code = 'EP1';
  PERFORM ddltest.ok((SELECT coefficient FROM examinations.session_papers WHERE session_id = S1 AND code = 'EP1') = 1, 'modifier le modèle ne change pas la session (copie figée)');
  PERFORM ddltest.throws(format($q$UPDATE examinations.session_papers SET coefficient = 5 WHERE session_id = %L$q$, S1), 'definition_locked', 'épreuves de session figées');
  PERFORM ddltest.throws(format($q$DELETE FROM examinations.session_papers WHERE session_id = %L$q$, S1), 'definition_locked', 'épreuves de session non supprimables');
  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET definition_locked_at = NULL WHERE id = %L$q$, S1), 'definition_locked', 'le gel est inaltérable');

  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = %L$q$, S1), 'session_transition', 'PLANNED -> IN_PROGRESS interdit');
  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET code = 'AUTRE' WHERE id = %L$q$, S1), 'session_identity_immutable', 'code de session figé');
  UPDATE examinations.sessions SET status = 'REGISTRATION_OPEN' WHERE id = S1;
  PERFORM ddltest.ok((SELECT status FROM examinations.sessions WHERE id = S1) = 'REGISTRATION_OPEN', 'inscriptions ouvertes');
  PERFORM ddltest.open_session(M1);
END $do$;

-- ---------------------------------------------------------------- candidats : éligibilité, pièces, numéro
DO $do$
DECLARE
  P constant uuid := 'a5000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a5200000-0000-4000-8000-000000000001';
  S1 constant uuid := 'a5300000-0000-4000-8000-000000000001';
  M1 constant uuid := 'a5300000-0000-4000-8000-000000000002';
  K1 constant uuid := 'a5400000-0000-4000-8000-000000000001';
  K2 constant uuid := 'a5400000-0000-4000-8000-000000000002';
  K3 constant uuid := 'a5400000-0000-4000-8000-000000000003';
  ST1 constant uuid := 'a5500000-0000-4000-8000-000000000001';
  REQ uuid;
  e uuid := gen_random_uuid();
BEGIN
  PERFORM ddltest.as_tenant(P);
  SELECT id INTO REQ FROM examinations.document_requirements WHERE code = 'ACTE_NAISSANCE';

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, registration_status)
     VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), 'REGISTERED')$q$, P, S1, I), 'candidate_initial_state', 'un candidat naît DRAFT');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), gen_random_uuid())$q$, P, S1), 'candidate_institution', 'le candidat est de l''établissement de la session');
  PERFORM ddltest.new_candidate(K1, P, S1, I, ST1);
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_candidate(gen_random_uuid(), %L, %L, %L, %L)$q$, P, S1, I, ST1), '23505', 'un élève n''a qu''un candidat vivant par session');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, track_code)
     VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), 'Z')$q$, P, S1, I), '23503', 'la série du candidat appartient à la session');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_history WHERE candidate_id = K1 AND kind = 'CREATED') = 1, 'création journalisée dans l''historique');

  -- éligibilité : établie par le journal, jamais posée à la main
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET eligibility_status = 'ELIGIBLE' WHERE id = %L$q$, K1), 'eligibility_derived', 'éligibilité dérivée du journal');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = 'N', first_name = 'P', birth_date = DATE '2016-01-01', sex = 'F' WHERE id = %L$q$, K1),
     'not_eligible', 'inscription sans éligibilité établie refusée');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, result) VALUES (gen_random_uuid(), %L, %L, 'INELIGIBLE')$q$, P, K1), 'check', 'une évaluation d''éligibilité cite la règle ou son auteur');
  INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result, reasons)
    VALUES (gen_random_uuid(), P, K1, gen_random_uuid(), 'INELIGIBLE', '["AGE_NOT_MET"]'::jsonb);
  PERFORM ddltest.ok((SELECT eligibility_status FROM examinations.candidates WHERE id = K1) = 'INELIGIBLE', 'le statut reflète la dernière évaluation');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result, overridden_by, override_reason)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), 'INELIGIBLE', gen_random_uuid(), 'court')$q$, P, K1), 'check', 'une dérogation exige un motif d''au moins 10 caractères');
  INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result, overridden_by, override_reason)
    VALUES (gen_random_uuid(), P, K1, gen_random_uuid(), 'INELIGIBLE', gen_random_uuid(), 'Dérogation accordée par la direction');
  PERFORM ddltest.ok((SELECT eligibility_status FROM examinations.candidates WHERE id = K1) = 'ELIGIBLE', 'une dérogation motivée vaut éligible');
  PERFORM ddltest.throws($q$UPDATE examinations.eligibility_checks SET result = 'ELIGIBLE'$q$, 'append_only', 'journal d''éligibilité en ajout seul');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_history WHERE candidate_id = K1 AND kind = 'ELIGIBILITY') = 2, 'changements d''éligibilité journalisés');

  -- pièces
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = 'N', first_name = 'P', birth_date = DATE '2016-01-01', sex = 'F' WHERE id = %L$q$, K1),
     'ACTE_NAISSANCE', 'inscription refusée tant qu''une pièce exigée n''est pas acceptée (la liste est citée)');
  INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, storage_key, reviewed_by, reviewed_at)
    VALUES (gen_random_uuid(), P, K1, REQ, 'ACCEPTED', 'k/acte', gen_random_uuid(), now());
  PERFORM ddltest.ok(cardinality(examinations.missing_required_documents(K1)) = 0, 'pièces complètes');

  -- inscription et numéro
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'REGISTERED' WHERE id = %L$q$, K1), 'check', 'l''inscription fige l''identité (nom, prénom, naissance, sexe obligatoires)');
  UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = 'Koné', first_name = 'Awa', birth_date = DATE '2016-03-02', sex = 'F' WHERE id = K1;
  PERFORM ddltest.ok((SELECT candidate_number FROM examinations.candidates WHERE id = K1) = 'CEPE2027-00001', 'numéro de candidat attribué : CEPE2027-00001');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET candidate_number = 'CEPE2027-99999' WHERE id = %L$q$, K1), 'candidate_number_immutable', 'le numéro ne change jamais');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET last_name = 'Autre' WHERE id = %L$q$, K1), 'candidate_snapshot_frozen', 'identité figée après inscription');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET outcome = 'ADMITTED' WHERE id = %L$q$, K1), 'outcome_derived', 'l''issue est dérivée du résultat');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET student_id = gen_random_uuid() WHERE id = %L$q$, K1), 'candidate_identity_immutable', 'élève figé');

  -- numérotation sans trou : un numéro annulé est rendu, un retrait garde son numéro (jamais réutilisé)
  PERFORM ddltest.new_candidate(K2, P, S1, I);
  INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, storage_key, reviewed_by, reviewed_at)
    VALUES (gen_random_uuid(), P, K2, REQ, 'ACCEPTED', 'k/acte2', gen_random_uuid(), now());
  BEGIN
    PERFORM ddltest.register(K2, 'Annulée');
    RAISE EXCEPTION 'annulation volontaire';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM ddltest.register(K2, 'Yao', 'M');
  PERFORM ddltest.ok((SELECT candidate_number FROM examinations.candidates WHERE id = K2) = 'CEPE2027-00002', 'numérotation sans trou : l''inscription annulée n''a pas consommé de numéro');

  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'WITHDRAWN' WHERE id = %L$q$, K2), 'check', 'un retrait exige date et motif');
  UPDATE examinations.candidates SET registration_status = 'WITHDRAWN', withdrawn_reason = 'Déménagement de la famille' WHERE id = K2;
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET sex = 'F' WHERE id = %L$q$, K2), 'candidate_withdrawn', 'un candidat retiré ne change plus');
  PERFORM ddltest.ok((SELECT candidate_number FROM examinations.candidates WHERE id = K2) = 'CEPE2027-00002', 'le candidat retiré garde son numéro');
  PERFORM ddltest.new_candidate(K3, P, S1, I, (SELECT student_id FROM examinations.candidates WHERE id = K2));
  INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, storage_key, reviewed_by, reviewed_at)
    VALUES (gen_random_uuid(), P, K3, REQ, 'ACCEPTED', 'k/acte3', gen_random_uuid(), now());
  PERFORM ddltest.register(K3, 'Yao-bis');
  PERFORM ddltest.ok((SELECT candidate_number FROM examinations.candidates WHERE id = K3) = 'CEPE2027-00003', 'le numéro du retiré n''est jamais réattribué (3, pas 2)');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_history WHERE candidate_id = K2 AND kind = 'STATUS') = 2, 'historique : REGISTERED puis WITHDRAWN');

  -- identifiants (numéro officiel de l'autorité, code CEPE du legacy)
  INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value) VALUES (gen_random_uuid(), P, S1, K1, 'OFFICIAL_NUMBER', 'OFF-0001');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value) VALUES (gen_random_uuid(), %L, %L, %L, 'OFFICIAL_NUMBER', 'OFF-0001')$q$, P, S1, K3), '23505', 'un identifiant officiel désigne un seul candidat de la session');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value) VALUES (gen_random_uuid(), %L, %L, %L, 'OFFICIAL_NUMBER', 'OFF-0002')$q$, P, S1, K1), '23505', 'un candidat n''a qu''un identifiant par nature');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value) VALUES (gen_random_uuid(), %L, %L, %L, 'CEPE_CODE', 'X')$q$, P, M1, K1), '23503', 'l''identifiant vise un candidat de SA session');

  -- examen blanc : ni éligibilité ni pièces exigées ; compteur de numéros distinct
  PERFORM ddltest.new_candidate('a5400000-0000-4000-8000-0000000000a1', P, M1, I);
  UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = 'Blanc', first_name = 'Test', birth_date = DATE '2016-02-02', sex = 'M'
   WHERE id = 'a5400000-0000-4000-8000-0000000000a1';
  PERFORM ddltest.ok((SELECT candidate_number FROM examinations.candidates WHERE id = 'a5400000-0000-4000-8000-0000000000a1') = 'CEPE2027-00001', 'examen blanc : inscription sans éligibilité ni pièces, compteur propre à la session');
END $do$;

-- ---------------------------------------------------------------- répartition : centres, salles, places
DO $do$
DECLARE
  P constant uuid := 'a5000000-0000-4000-8000-0000000000a1';
  S1 constant uuid := 'a5300000-0000-4000-8000-000000000001';
  K1 constant uuid := 'a5400000-0000-4000-8000-000000000001';
  K3 constant uuid := 'a5400000-0000-4000-8000-000000000003';
  K2 constant uuid := 'a5400000-0000-4000-8000-000000000002';
  C1 constant uuid := 'a5600000-0000-4000-8000-000000000001';
  C2 constant uuid := 'a5600000-0000-4000-8000-000000000002';
  R1 constant uuid := 'a5700000-0000-4000-8000-000000000001';
  R2 constant uuid := 'a5700000-0000-4000-8000-000000000002';
BEGIN
  PERFORM ddltest.as_tenant(P);
  INSERT INTO examinations.centers (id, tenant_id, code, name, kind) VALUES (C1, P, 'C1', 'Centre 1', 'OWN'), (C2, P, 'C2', 'Centre 2', 'HOST');
  INSERT INTO examinations.rooms (id, tenant_id, center_id, code, capacity) VALUES (R1, P, C1, 'S1', 2), (R2, P, C2, 'S1', 5);
  INSERT INTO examinations.session_centers (tenant_id, session_id, center_id) VALUES (P, S1, C1);

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1)$q$, P, S1, K1, C2, R2),
     '23503', 'le centre doit être celui de la session');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1)$q$, P, S1, K1, C1, R2),
     '23503', 'la salle doit appartenir au centre');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 3)$q$, P, S1, K1, C1, R1),
     'seat_beyond_capacity', 'la place dépasse la capacité de la salle');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1)$q$, P, S1, K2, C1, R1),
     'candidate_not_registered', 'seul un candidat inscrit reçoit une place (retiré refusé)');
  INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number, table_number) VALUES (gen_random_uuid(), P, S1, K1, C1, R1, 1, 'T-001');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1)$q$, P, S1, K3, C1, R1),
     '23505', 'une place ne reçoit qu''un candidat');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 2)$q$, P, S1, K1, C1, R1),
     '23505', 'un candidat n''a qu''une place');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 2)$q$, P, S1, K3, C1, R1), 'seconde place de la salle');

  -- clôture des inscriptions
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = S1;
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_candidate(gen_random_uuid(), %L, %L, 'a5200000-0000-4000-8000-000000000001')$q$, P, S1), 'session_registration_closed', 'plus de nouveau candidat après la clôture des inscriptions');
  UPDATE examinations.sessions SET status = 'REGISTRATION_OPEN' WHERE id = S1;     -- retour autorisé
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = S1;
  UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = S1;
  PERFORM ddltest.throws(format($q$DELETE FROM examinations.seat_assignments WHERE candidate_id = %L$q$, K1), 'assignment_frozen', 'répartition figée session en cours');
END $do$;

-- ---------------------------------------------------------------- isolation
SET ROLE app_user;
SELECT ddltest.as_tenant('a5000000-0000-4000-8000-0000000000b1');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidates) = 0, 'RLS : le tenant Q ne voit aucun candidat de P');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.sessions) = 0, 'RLS : le tenant Q ne voit aucune session de P');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.seat_assignments) = 0, 'RLS : le tenant Q ne voit aucune place de P');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_history) = 0, 'RLS : le tenant Q ne voit aucun historique de P');
  PERFORM ddltest.ok(cardinality(examinations.missing_required_documents('a5400000-0000-4000-8000-000000000001')) = 0, 'RLS : pièces d''un candidat invisible = {}');
  PERFORM ddltest.throws($q$UPDATE examinations.candidate_history SET reason = 'x'$q$, '42501', 'GRANT : l''historique n''est jamais modifié');
  PERFORM ddltest.throws($q$INSERT INTO examinations.sessions (id, tenant_id, exam_type_id, institution_id, code, label, session_year)
     VALUES (gen_random_uuid(), 'a5000000-0000-4000-8000-0000000000a1', 'a5100000-0000-4000-8000-000000000001', gen_random_uuid(), 'INTRUS', 'x', 2027)$q$, '42501', 'RLS : session écrite pour un autre tenant refusée');
END $do$;
RESET ROLE;
