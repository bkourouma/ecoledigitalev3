-- Migration 1904 : résultat d'examen et moyenne reçus d'examinations (Q-E18) — une ligne par résultat, version croissante, isolation.
\set R '''b1000000-0000-4000-8000-0000000000a1'''
\set R2 '''b1000000-0000-4000-8000-0000000000a2'''
SELECT ddltest.make_tenant(:R::uuid, 'adm-res-a');
SELECT ddltest.make_tenant(:R2::uuid, 'adm-res-b');

DO $do$
DECLARE
  R  constant uuid := 'b1000000-0000-4000-8000-0000000000a1';
  S1 constant uuid := 'b1100000-0000-4000-8000-000000000001';
  RES constant uuid := 'b1200000-0000-4000-8000-000000000001';
  v_n integer;
BEGIN
  PERFORM ddltest.as_tenant(R);
  INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
    VALUES (gen_random_uuid(), R, gen_random_uuid(), S1, gen_random_uuid(), RES, 'CEPE', 2027, 'FAILED', false, 9.4, 1, gen_random_uuid());
  PERFORM ddltest.pass('un résultat d''examen reçu se range avec sa moyenne (numeric exact)');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), %L, gen_random_uuid(), %L, 'CEPE', 2027, 'FAILED', false, 9.4, 1, gen_random_uuid())$q$, R, S1, RES),
     'exam_results_tenant_id_source_result_id_key', 'une seule ligne par résultat source');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid(), 'CEPE', 2027, 'FAILED', true, 9.4, 1, gen_random_uuid())$q$, R, S1),
     'exam_results_check', '« admis » suit exactement l''issue ADMITTED');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid(), 'CEPE', 2027, 'ABSENT', false, 5, 1, gen_random_uuid())$q$, R, S1),
     'exam_results_check', 'un absent n''a pas de moyenne');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid(), 'cepe', 2027, 'FAILED', false, 5, 1, gen_random_uuid())$q$, R, S1),
     'exam_results_exam_type_code_check', 'code d''examen en majuscules');
  PERFORM ddltest.throws(format($q$UPDATE admissions.exam_results SET revision = 1, outcome = 'ADMITTED', admitted = true WHERE source_result_id = %L$q$, RES), 'exam_result_stale', 'une version égale ou plus ancienne ne remplace jamais le résultat reçu');
  PERFORM ddltest.throws(format($q$UPDATE admissions.exam_results SET student_id = gen_random_uuid(), revision = 5 WHERE source_result_id = %L$q$, RES), 'exam_result_identity_immutable', 'l''élève d''un résultat reçu est figé');
  UPDATE admissions.exam_results SET revision = 2, outcome = 'ADMITTED', admitted = true, average = 10.2 WHERE source_result_id = RES;
  SELECT count(*) INTO v_n FROM admissions.exam_results WHERE source_result_id = RES AND outcome = 'ADMITTED' AND average = 10.2 AND revision = 2;
  PERFORM ddltest.ok(v_n = 1, 'une correction approuvée (version plus grande) remplace le résultat reçu');
END
$do$;

SET ROLE app_user;
SELECT ddltest.as_tenant('b1000000-0000-4000-8000-0000000000a2');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.exam_results) = 0, 'RLS : un autre tenant ne voit aucun résultat d''examen ni aucune moyenne');
  PERFORM ddltest.throws($q$DELETE FROM admissions.exam_results$q$, '42501', 'GRANT : un résultat reçu ne se supprime pas par l''application');
  PERFORM ddltest.throws($q$INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES (gen_random_uuid(), 'b1000000-0000-4000-8000-0000000000a1', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'CEPE', 2027, 'ADMITTED', true, 11, 1, gen_random_uuid())$q$, '42501', 'RLS : résultat écrit pour un autre tenant refusé');
END $do$;
RESET ROLE;
