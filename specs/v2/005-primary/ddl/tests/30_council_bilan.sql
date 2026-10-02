-- Conseil des maîtres, bilan annuel scellé, archivage d'une année.
\set E '''e0000000-0000-4000-8000-000000000001'''
\set F '''f0000000-0000-4000-8000-000000000001'''
SELECT ddltest.make_tenant(:E::uuid, 'ps-e');
SELECT ddltest.make_tenant(:F::uuid, 'ps-f');

DO $$
DECLARE
  E constant uuid := 'e0000000-0000-4000-8000-000000000001';
  INST constant uuid := 'e1000000-0000-4000-8000-000000000001';
  YR constant uuid := 'e2000000-0000-4000-8000-000000000001';
  DELIB constant uuid := 'e3000000-0000-4000-8000-000000000001';
BEGIN
  -- ------------------------------------------------------------ dossier de conseil
  INSERT INTO primary_school.council_cases (id, tenant_id, deliberation_id, classroom_id, enrollment_id, student_id, reason_codes, proposal_code)
  VALUES ('e4000000-0000-4000-8000-000000000001', E, DELIB, gen_random_uuid(), 'e5000000-0000-4000-8000-000000000001', gen_random_uuid(), ARRAY['BORDERLINE'], 'PROMOTED');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_cases (id, tenant_id, deliberation_id, classroom_id, enrollment_id, student_id)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), 'e5000000-0000-4000-8000-000000000001', gen_random_uuid())$q$, E, DELIB), '23505', 'un seul dossier par élève et par séance');
  PERFORM ddltest.throws($q$UPDATE primary_school.council_cases SET status='DECIDED' WHERE id='e4000000-0000-4000-8000-000000000001'$q$, 'check', 'DECIDED exige la référence de la décision');
  PERFORM ddltest.runs($q$UPDATE primary_school.council_cases SET status='DECIDED', decision_ref=gen_random_uuid() WHERE id='e4000000-0000-4000-8000-000000000001'$q$, 'dossier décidé avec sa décision');

  -- ------------------------------------------------------------ feuille de présence
  INSERT INTO primary_school.council_attendance (tenant_id, deliberation_id, staff_id, role_code, present)
  VALUES (E, DELIB, 'e6000000-0000-4000-8000-000000000001', 'CHAIR', true),
         (E, DELIB, 'e6000000-0000-4000-8000-000000000002', 'SECRETARY', true),
         (E, DELIB, 'e6000000-0000-4000-8000-000000000003', 'HOMEROOM', true),
         (E, DELIB, 'e6000000-0000-4000-8000-000000000004', 'TEACHER', false);
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_attendance (tenant_id, deliberation_id, staff_id, role_code)
     VALUES (%L, %L, gen_random_uuid(), 'CHAIR')$q$, E, DELIB), '23505', 'un seul président par conseil');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_attendance (tenant_id, deliberation_id, staff_id, role_code)
     VALUES (%L, %L, gen_random_uuid(), 'SECRETARY')$q$, E, DELIB), '23505', 'un seul secrétaire par conseil');
  PERFORM ddltest.throws($q$UPDATE primary_school.council_attendance SET signed_at = now() WHERE staff_id='e6000000-0000-4000-8000-000000000004'$q$, 'check', 'on ne signe pas absent');
  PERFORM ddltest.runs($q$UPDATE primary_school.council_attendance SET signed_at = now() WHERE staff_id='e6000000-0000-4000-8000-000000000003'$q$, 'signature d''un maître présent');
  PERFORM ddltest.throws($q$UPDATE primary_school.council_attendance SET present = false WHERE staff_id='e6000000-0000-4000-8000-000000000003'$q$, 'attendance_signed', 'présence signée figée');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.council_attendance WHERE staff_id='e6000000-0000-4000-8000-000000000003'$q$, 'attendance_signed', 'présence signée non supprimable');
  PERFORM ddltest.runs($q$DELETE FROM primary_school.council_attendance WHERE staff_id='e6000000-0000-4000-8000-000000000004'$q$, 'une présence non signée se retire');

  -- ------------------------------------------------------------ bilan annuel
  -- brouillon
  INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code)
  VALUES ('e7000000-0000-4000-8000-000000000001', E, INST, YR, 'e5000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'CE1');
  -- sceller sans décision : refusé (le paramètre par défaut exige le conseil des maîtres)
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET status='SEALED', year_result_ref=gen_random_uuid(),
       content_hash=repeat('a',64), sealed_at=now(), sealed_by=gen_random_uuid() WHERE id='e7000000-0000-4000-8000-000000000001'$q$,
     'review_needs_decision', 'sceller sans décision du conseil est refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET status='SEALED', decision_ref=gen_random_uuid(), outcome_code='PROMOTED',
       content_hash=repeat('a',64), sealed_at=now(), sealed_by=gen_random_uuid() WHERE id='e7000000-0000-4000-8000-000000000001'$q$,
     'review_needs_results', 'sceller sans résultat d''année FINAL est refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET status='SEALED', decision_ref=gen_random_uuid(), outcome_code='PROMOTED', year_result_ref=gen_random_uuid()
       WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'check', 'sceller sans empreinte ni signataire est refusé');
  PERFORM ddltest.runs($q$UPDATE primary_school.annual_reviews SET status='SEALED', decision_ref=gen_random_uuid(), outcome_code='PROMOTED', year_result_ref=gen_random_uuid(),
       content_hash=repeat('a',64), sealed_at=now(), sealed_by=gen_random_uuid(), competency_summary='{"LANG":{"L2":3}}'::jsonb WHERE id='e7000000-0000-4000-8000-000000000001'$q$,
     'scellement du bilan avec décision, résultat et empreinte');
  -- immuabilité
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET outcome_code='REPEATED' WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'review_sealed', 'bilan scellé : issue immuable');
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET competency_summary='{}'::jsonb WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'review_sealed', 'bilan scellé : synthèse immuable');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.annual_reviews WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'review_delete_forbidden', 'bilan scellé non supprimable');
  -- l'identifiant du PDF se renseigne UNE fois
  PERFORM ddltest.runs($q$UPDATE primary_school.annual_reviews SET reportcard_id = gen_random_uuid() WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'renseigner l''identifiant du PDF émis');
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET reportcard_id = gen_random_uuid() WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'review_sealed', 'l''identifiant du PDF ne se réécrit pas');

  -- réémission : l'ancien passe SUPERSEDED, puis la version 2 naît en brouillon
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version)
    VALUES (gen_random_uuid(), %L, %L, %L, 'e5000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'CE1', 2)$q$, E, INST, YR),
    '23505', 'une seule version vivante par inscription et année');
  PERFORM ddltest.runs($q$UPDATE primary_school.annual_reviews SET status='SUPERSEDED' WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'SEALED -> SUPERSEDED');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version, supersedes_id)
    VALUES (gen_random_uuid(), %L, %L, %L, 'e5000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'CE1', 2, 'e7000000-0000-4000-8000-000000000001')$q$, E, INST, YR),
    'check', 'la réémission exige un motif d''au moins 10 caractères');
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version, supersedes_id, supersede_reason)
    VALUES ('e7000000-0000-4000-8000-000000000002', %L, %L, %L, 'e5000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'CE1', 2, 'e7000000-0000-4000-8000-000000000001', 'Décision du conseil corrigée après recours')$q$, E, INST, YR),
    'version 2 en brouillon, remplaçant la version scellée');
  PERFORM ddltest.throws($q$UPDATE primary_school.annual_reviews SET status='DRAFT', year_result_ref=NULL WHERE id='e7000000-0000-4000-8000-000000000001'$q$, 'review_sealed', 'une version remplacée reste immuable');

  -- version n+2 ne peut pas remplacer n-1 manquante
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version, supersedes_id, supersede_reason)
    VALUES (gen_random_uuid(), %L, %L, %L, 'e5000000-0000-4000-8000-000000000009', gen_random_uuid(), gen_random_uuid(), 'CE1', 3, 'e7000000-0000-4000-8000-000000000001', 'Tentative incohérente de lien')$q$, E, INST, YR),
    'review_supersedes_mismatch', 'la version remplacée doit être n-1 de la MÊME inscription');

  -- paramètre : bilan sans conseil autorisé pour cet établissement
  INSERT INTO primary_school.settings (tenant_id, institution_id, council_required_for_bilan)
  VALUES (E, 'e1000000-0000-4000-8000-0000000000aa', false);
  INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code)
  VALUES ('e7000000-0000-4000-8000-000000000003', E, 'e1000000-0000-4000-8000-0000000000aa', YR, 'e5000000-0000-4000-8000-000000000003', gen_random_uuid(), gen_random_uuid(), 'CM2');
  PERFORM ddltest.runs($q$UPDATE primary_school.annual_reviews SET status='SEALED', year_result_ref=gen_random_uuid(),
       content_hash=repeat('b',64), sealed_at=now(), sealed_by=gen_random_uuid() WHERE id='e7000000-0000-4000-8000-000000000003'$q$,
     'établissement sans conseil obligatoire : scellement possible sans décision');
  PERFORM ddltest.runs($q$DELETE FROM primary_school.annual_reviews WHERE id='e7000000-0000-4000-8000-000000000002'$q$, 'un brouillon de bilan se supprime');

  -- ------------------------------------------------------------ archive d'année
  INSERT INTO primary_school.year_archives (id, tenant_id, institution_id, academic_year_id, reviews_total, reviews_sealed)
  VALUES ('e8000000-0000-4000-8000-000000000001', E, INST, YR, 3, 2);
  PERFORM ddltest.throws($q$UPDATE primary_school.year_archives SET status='READY', manifest='{"classes":1}'::jsonb, manifest_hash=repeat('c',64) WHERE id='e8000000-0000-4000-8000-000000000001'$q$,
     'check', 'READY exige tous les bilans scellés');
  PERFORM ddltest.throws($q$UPDATE primary_school.year_archives SET status='FROZEN', frozen_at=now() WHERE id='e8000000-0000-4000-8000-000000000001'$q$, 'archive_transition', 'PREPARING -> FROZEN interdit');
  PERFORM ddltest.runs($q$UPDATE primary_school.year_archives SET reviews_sealed = 3, status='READY', manifest='{"classes":1}'::jsonb, manifest_hash=repeat('c',64) WHERE id='e8000000-0000-4000-8000-000000000001'$q$, 'archive prête');
  PERFORM ddltest.runs($q$UPDATE primary_school.year_archives SET status='FROZEN', frozen_at=now(), frozen_by=gen_random_uuid() WHERE id='e8000000-0000-4000-8000-000000000001'$q$, 'archive gelée');
  PERFORM ddltest.throws($q$UPDATE primary_school.year_archives SET manifest='{}'::jsonb WHERE id='e8000000-0000-4000-8000-000000000001'$q$, 'archive_frozen', 'archive gelée immuable');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.year_archives$q$, 'append_only', 'une archive ne se supprime pas');
  -- année gelée : plus aucun bilan écrit pour cet établissement et cette année
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code)
    VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'CE2')$q$, E, INST, YR), 'year_frozen', 'année archivée : aucun bilan ne s''écrit');
  -- un autre établissement ou une autre année reste libre
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code)
    VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'CE2')$q$, E, INST), 'une autre année n''est pas gelée');
END $$;

-- Isolation et privilèges applicatifs
SET ROLE app_user;
SELECT ddltest.as_tenant('f0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.annual_reviews) = 0, 'RLS : le tenant F ne voit aucun bilan de E');
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.council_cases) = 0, 'RLS : le tenant F ne voit aucun dossier de conseil de E');
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.year_archives) = 0, 'RLS : le tenant F ne voit aucune archive de E');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.year_archives$q$, '42501', 'GRANT : app_user ne supprime pas d''archive');
  PERFORM ddltest.throws($q$INSERT INTO primary_school.year_archives (id, tenant_id, institution_id, academic_year_id)
     VALUES (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid())$q$, '42501', 'RLS : archive créée pour un autre tenant refusée');
  -- un bilan de F ne peut pas pointer la version d'un bilan de E (FK composite)
  PERFORM ddltest.throws($q$INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version, supersedes_id, supersede_reason)
     VALUES (gen_random_uuid(), 'f0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'CE1', 2,
             'e7000000-0000-4000-8000-000000000001', 'Tentative de lien inter-tenant')$q$, 'review_supersedes_mismatch', 'une version d''un autre tenant est invisible (lien refusé)');
END $$;
RESET ROLE;
