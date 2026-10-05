-- État « prêt » d'une classe × période (migration 1804, décision Q-P18) : gelure des brouillons, validation et révision permises, RLS A/B.
\set E '''e0000000-0000-4000-8000-000000000001'''
\set F '''f0000000-0000-4000-8000-000000000001'''
SELECT ddltest.make_tenant(:E::uuid, 'ps-e');
SELECT ddltest.make_tenant(:F::uuid, 'ps-f');

INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind) VALUES
  ('e1000000-0000-4000-8000-000000000001', :E, 'S1', 'Échelle 1', 'placeholder');
INSERT INTO primary_school.rating_levels (id, tenant_id, scale_id, code, label, ordinal, meets_expectation) VALUES
  ('e1100000-0000-4000-8000-000000000001', :E, 'e1000000-0000-4000-8000-000000000001', 'L1', 'Niveau 1', 1, false),
  ('e1100000-0000-4000-8000-000000000002', :E, 'e1000000-0000-4000-8000-000000000001', 'L2', 'Niveau 2', 2, true);
INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, label, scale_id, source_kind) VALUES
  ('e2000000-0000-4000-8000-000000000001', :E, 'FWE', 'Référentiel publié', 'e1000000-0000-4000-8000-000000000001', 'placeholder');
INSERT INTO primary_school.competency_domains (id, tenant_id, framework_id, code, label, ordinal) VALUES
  ('e2100000-0000-4000-8000-000000000001', :E, 'e2000000-0000-4000-8000-000000000001', 'LANG', 'Langage', 1);
INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal) VALUES
  ('e2200000-0000-4000-8000-000000000001', :E, 'e2000000-0000-4000-8000-000000000001', 'e2100000-0000-4000-8000-000000000001', 'LANG.1', 'c1', 1),
  ('e2200000-0000-4000-8000-000000000002', :E, 'e2000000-0000-4000-8000-000000000001', 'e2100000-0000-4000-8000-000000000001', 'LANG.2', 'c2', 2);
INSERT INTO primary_school.framework_grade_levels (tenant_id, framework_id, grade_level_code) VALUES
  (:E, 'e2000000-0000-4000-8000-000000000001', 'GS');
UPDATE primary_school.competency_frameworks SET status = 'PUBLISHED', published_at = now()
 WHERE id = 'e2000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  E constant uuid := 'e0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'e2000000-0000-4000-8000-000000000001';
  SC constant uuid := 'e1000000-0000-4000-8000-000000000001';
  K  constant uuid := 'e3000000-0000-4000-8000-000000000001';
  P1 constant uuid := 'e4000000-0000-4000-8000-000000000001';
  P2 constant uuid := 'e4000000-0000-4000-8000-000000000002';
  E1 constant uuid := 'e5000000-0000-4000-8000-000000000001';
  S1 constant uuid := 'e6000000-0000-4000-8000-000000000001';
  T  constant uuid := 'e7000000-0000-4000-8000-000000000001';
  U  constant uuid := 'e8000000-0000-4000-8000-000000000001';
  ins text := $q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (%L, %L, %L, %L, %L, %L, %L, %L, %L, 'e1100000-0000-4000-8000-000000000001', current_date, %L)$q$;
BEGIN
  -- avant « prêts » : la saisie est libre
  PERFORM ddltest.runs(format(ins, 'e9000000-0000-4000-8000-000000000001', E, K, P1, E1, S1, FW, 'e2200000-0000-4000-8000-000000000001', SC, T), 'saisie d''un brouillon avant « prêts »');

  -- marquer « prêts » (et les contraintes de la table)
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by) VALUES (%L, %L, %L, 'READY', %L)$q$, E, K, P1, U), 'marquer la classe × période « prêtes »');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by) VALUES (%L, %L, %L, 'READY', %L)$q$, E, K, P1, U), '23505', 'une seule ligne par classe × période');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by) VALUES (%L, %L, %L, 'MAYBE', %L)$q$, E, K, P2, U), 'check', 'statut connu');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by) VALUES (%L, %L, %L, 'NOT_READY', %L)$q$, E, K, P2, U), 'check', 'un retrait porte son auteur et sa date');

  -- gelure : ni création, ni modification, ni suppression d'un brouillon
  PERFORM ddltest.throws(format(ins, 'e9000000-0000-4000-8000-000000000002', E, K, P1, E1, S1, FW, 'e2200000-0000-4000-8000-000000000002', SC, T), 'period_ready', 'prêts : pas de nouvelle ligne');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET rating_level_id = 'e1100000-0000-4000-8000-000000000002' WHERE id = 'e9000000-0000-4000-8000-000000000001'$q$, 'period_ready', 'prêts : un brouillon ne change plus de niveau');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET note = 'tard' WHERE id = 'e9000000-0000-4000-8000-000000000001'$q$, 'period_ready', 'prêts : un brouillon ne change plus de note');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.competency_assessments WHERE id = 'e9000000-0000-4000-8000-000000000001'$q$, 'period_ready', 'prêts : un brouillon ne se supprime plus');
  -- une autre période de la même classe reste libre
  PERFORM ddltest.runs(format(ins, 'e9000000-0000-4000-8000-000000000003', E, K, P2, E1, S1, FW, 'e2200000-0000-4000-8000-000000000001', SC, T), 'une autre période n''est pas gelée');

  -- valider (contenu inchangé) reste permis ; la révision d'un validé n'est pas concernée par cette garde
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_assessments SET status = 'VALIDATED', validated_by = 'e8000000-0000-4000-8000-000000000001', validated_at = now() WHERE id = 'e9000000-0000-4000-8000-000000000001'$q$, 'prêts : valider sans changer le contenu');
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
     VALUES (gen_random_uuid(), %L, 'e9000000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000002', 'Erreur de saisie corrigée', %L)$q$, E, U), 'trace de révision');
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_assessments SET rating_level_id = 'e1100000-0000-4000-8000-000000000002' WHERE id = 'e9000000-0000-4000-8000-000000000001'$q$, 'prêts : une appréciation validée se corrige par révision tracée');

  -- retrait : la saisie redevient libre
  PERFORM ddltest.runs(format($q$UPDATE primary_school.period_readiness SET status = 'NOT_READY', withdrawn_by = %L, withdrawn_at = now(), withdrawn_reason = 'Erreur de marquage constatée' WHERE classroom_id = %L AND academic_period_id = %L$q$, U, K, P1), 'retrait du marquage');
  PERFORM ddltest.runs(format(ins, 'e9000000-0000-4000-8000-000000000004', E, K, P1, E1, S1, FW, 'e2200000-0000-4000-8000-000000000002', SC, T), 'après retrait : la saisie redevient libre');
END
$$;

-- Isolation et privilèges applicatifs
SET ROLE app_user;
SELECT ddltest.as_tenant('f0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.period_readiness) = 0, 'RLS : un autre tenant ne voit aucun état « prêt »');
  PERFORM ddltest.throws($q$INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by)
     VALUES ('e0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'READY', gen_random_uuid())$q$, '42501', 'RLS : marquer pour un autre tenant est refusé');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.period_readiness$q$, '42501', 'GRANT : app_user ne supprime pas un état « prêt »');
END $$;
RESET ROLE;
