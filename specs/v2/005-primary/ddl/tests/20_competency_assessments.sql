-- Appréciations par compétences : verrou de période, validation, révisions, synthèse, RLS.
\set C '''c0000000-0000-4000-8000-000000000001'''
\set D '''d0000000-0000-4000-8000-000000000001'''
SELECT ddltest.make_tenant(:C::uuid, 'ps-c');
SELECT ddltest.make_tenant(:D::uuid, 'ps-d');

INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind) VALUES
  ('c1000000-0000-4000-8000-000000000001', :C, 'S1', 'Échelle 1', 'placeholder'),
  ('c1000000-0000-4000-8000-000000000002', :C, 'S2', 'Échelle 2', 'placeholder');
INSERT INTO primary_school.rating_levels (id, tenant_id, scale_id, code, label, ordinal, meets_expectation) VALUES
  ('c1100000-0000-4000-8000-000000000001', :C, 'c1000000-0000-4000-8000-000000000001', 'L1', 'Niveau 1', 1, false),
  ('c1100000-0000-4000-8000-000000000002', :C, 'c1000000-0000-4000-8000-000000000001', 'L2', 'Niveau 2', 2, true),
  ('c1100000-0000-4000-8000-000000000003', :C, 'c1000000-0000-4000-8000-000000000001', 'L3', 'Niveau 3', 3, true),
  ('c1100000-0000-4000-8000-000000000011', :C, 'c1000000-0000-4000-8000-000000000002', 'M1', 'Autre 1', 1, false),
  ('c1100000-0000-4000-8000-000000000012', :C, 'c1000000-0000-4000-8000-000000000002', 'M2', 'Autre 2', 2, true);
INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, label, scale_id, source_kind) VALUES
  ('c2000000-0000-4000-8000-000000000001', :C, 'FWC', 'Référentiel publié', 'c1000000-0000-4000-8000-000000000001', 'placeholder'),
  ('c2000000-0000-4000-8000-000000000002', :C, 'FWDRAFT', 'Référentiel brouillon', 'c1000000-0000-4000-8000-000000000001', 'placeholder');
INSERT INTO primary_school.competency_domains (id, tenant_id, framework_id, code, label, ordinal) VALUES
  ('c2100000-0000-4000-8000-000000000001', :C, 'c2000000-0000-4000-8000-000000000001', 'LANG', 'Langage', 1),
  ('c2100000-0000-4000-8000-000000000002', :C, 'c2000000-0000-4000-8000-000000000001', 'MATH', 'Mathématiques', 2),
  ('c2100000-0000-4000-8000-000000000003', :C, 'c2000000-0000-4000-8000-000000000002', 'X', 'X', 1);
INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal) VALUES
  ('c2200000-0000-4000-8000-000000000001', :C, 'c2000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 'LANG.1', 'c1', 1),
  ('c2200000-0000-4000-8000-000000000002', :C, 'c2000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 'LANG.2', 'c2', 2),
  ('c2200000-0000-4000-8000-000000000003', :C, 'c2000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000002', 'MATH.1', 'c3', 1),
  ('c2200000-0000-4000-8000-000000000004', :C, 'c2000000-0000-4000-8000-000000000002', 'c2100000-0000-4000-8000-000000000003', 'X.1', 'cx', 1);
INSERT INTO primary_school.framework_grade_levels (tenant_id, framework_id, grade_level_code) VALUES
  (:C, 'c2000000-0000-4000-8000-000000000001', 'GS');
UPDATE primary_school.competency_frameworks SET status = 'PUBLISHED', published_at = now()
 WHERE id = 'c2000000-0000-4000-8000-000000000001';

-- Constantes de test : classe, périodes, inscriptions, enseignant
-- classe K ; périodes P1, P2 ; inscriptions E1, E2
DO $$
DECLARE
  C constant uuid := 'c0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'c2000000-0000-4000-8000-000000000001';
  K  constant uuid := 'c3000000-0000-4000-8000-000000000001';
  P1 constant uuid := 'c4000000-0000-4000-8000-000000000001';
  P2 constant uuid := 'c4000000-0000-4000-8000-000000000002';
  E1 constant uuid := 'c5000000-0000-4000-8000-000000000001';
  S1 constant uuid := 'c6000000-0000-4000-8000-000000000001';
  T  constant uuid := 'c7000000-0000-4000-8000-000000000001';
  SC constant uuid := 'c1000000-0000-4000-8000-000000000001';
  base text;
BEGIN
  -- saisie en brouillon
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES ('c8000000-0000-4000-8000-000000000001', %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000001', %L, 'c1100000-0000-4000-8000-000000000002', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), 'saisie d''une appréciation en brouillon');

  -- unicité (inscription, période, compétence)
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000001', %L, 'c1100000-0000-4000-8000-000000000003', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), '23505', 'une seule appréciation par inscription, période et compétence');

  -- niveau d'une autre échelle
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000011', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, T), 'scale_mismatch', 'le niveau doit appartenir à l''échelle du référentiel');

  -- niveau d'une autre échelle déclaré avec l'échelle du référentiel : la FK composite le refuse
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000002', %L, 'c1100000-0000-4000-8000-000000000011', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), '23503', 'FK composite (échelle, niveau)');

  -- référentiel non publié
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 'c2000000-0000-4000-8000-000000000002', 'c2200000-0000-4000-8000-000000000004', %L, 'c1100000-0000-4000-8000-000000000001', current_date, %L)$q$,
    C, K, P1, E1, S1, SC, T), 'framework_not_published', 'on n''évalue pas un référentiel non publié');

  -- compétence d'un autre référentiel que celui déclaré
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000004', %L, 'c1100000-0000-4000-8000-000000000001', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), '23503', 'FK composite (référentiel, compétence)');

  -- validation : horodatage et auteur exigés
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET status='VALIDATED' WHERE id='c8000000-0000-4000-8000-000000000001'$q$, 'check', 'VALIDATED sans validated_at/by refusé');
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_assessments SET status='VALIDATED', validated_at=now(), validated_by=gen_random_uuid()
     WHERE id='c8000000-0000-4000-8000-000000000001'$q$, 'validation d''une appréciation');
  PERFORM ddltest.ok((SELECT row_version FROM primary_school.competency_assessments WHERE id='c8000000-0000-4000-8000-000000000001') = 2, 'row_version incrémenté par le déclencheur');

  -- appréciation validée : figée
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET rating_level_id='c1100000-0000-4000-8000-000000000003' WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'validated_frozen', 'modifier le niveau d''une appréciation validée sans révision est refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET enrollment_id=gen_random_uuid() WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'assessment_identity_immutable', 'identité figée');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET status='DRAFT', validated_at=NULL, validated_by=NULL WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'assessment_transition', 'VALIDATED -> DRAFT interdit');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.competency_assessments WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'assessment_delete_forbidden', 'suppression d''une appréciation validée refusée');

  -- révision : motif trop court, puis révision correcte dans la même transaction
  PERFORM ddltest.throws($q$INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
     VALUES (gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001',
             'c1100000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000003', 'court', gen_random_uuid())$q$, 'check', 'motif de révision ≥ 10 caractères');

  INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
    VALUES ('c9000000-0000-4000-8000-000000000001', C, 'c8000000-0000-4000-8000-000000000001',
            'c1100000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000003', 'Erreur de saisie constatée en classe', gen_random_uuid());
  -- la révision porte sur 2 -> 3 : un changement vers 1 reste refusé
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET rating_level_id='c1100000-0000-4000-8000-000000000001' WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'validated_frozen', 'la révision ne couvre que le changement qu''elle annonce');
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_assessments SET rating_level_id='c1100000-0000-4000-8000-000000000003' WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
    'correction appliquée avec sa révision dans la même transaction');

  PERFORM ddltest.throws($q$UPDATE primary_school.competency_revisions SET reason='réécrite en douce' WHERE id='c9000000-0000-4000-8000-000000000001'$q$, 'append_only', 'révisions en ajout seul (UPDATE)');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.competency_revisions$q$, 'append_only', 'révisions en ajout seul (DELETE)');
END $$;

-- Une révision validée dans une transaction PRÉCÉDENTE ne couvre pas une nouvelle correction
INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
  VALUES ('c9000000-0000-4000-8000-000000000002', :C, 'c8000000-0000-4000-8000-000000000001',
          'c1100000-0000-4000-8000-000000000003', 'c1100000-0000-4000-8000-000000000001', 'Révision déposée mais non appliquée', gen_random_uuid());
SELECT ddltest.throws($q$UPDATE primary_school.competency_assessments SET rating_level_id='c1100000-0000-4000-8000-000000000001' WHERE id='c8000000-0000-4000-8000-000000000001'$q$,
  'validated_frozen', 'une révision d''une transaction antérieure ne suffit pas');

-- Verrou de période
DO $$
DECLARE
  C constant uuid := 'c0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'c2000000-0000-4000-8000-000000000001';
  K  constant uuid := 'c3000000-0000-4000-8000-000000000001';
  P1 constant uuid := 'c4000000-0000-4000-8000-000000000001';
  P2 constant uuid := 'c4000000-0000-4000-8000-000000000002';
  E1 constant uuid := 'c5000000-0000-4000-8000-000000000001';
  S1 constant uuid := 'c6000000-0000-4000-8000-000000000001';
  T  constant uuid := 'c7000000-0000-4000-8000-000000000001';
  SC constant uuid := 'c1000000-0000-4000-8000-000000000001';
BEGIN
  -- brouillon à supprimer (autorisé)
  INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
  VALUES ('c8000000-0000-4000-8000-000000000009', C, K, P1, E1, S1, FW, 'c2200000-0000-4000-8000-000000000003', SC, 'c1100000-0000-4000-8000-000000000001', current_date, T);
  PERFORM ddltest.runs($q$DELETE FROM primary_school.competency_assessments WHERE id='c8000000-0000-4000-8000-000000000009'$q$, 'un brouillon se supprime');

  INSERT INTO primary_school.period_locks (tenant_id, classroom_id, academic_period_id, status) VALUES (C, K, P1, 'LOCKED');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000003', %L, 'c1100000-0000-4000-8000-000000000001', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), 'period_locked', 'saisie refusée dans une classe × période verrouillée');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET note='tardif' WHERE id='c8000000-0000-4000-8000-000000000001'$q$, 'period_locked', 'modification refusée dans une période verrouillée');
  -- une autre période de la même classe reste ouverte
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES ('c8000000-0000-4000-8000-000000000002', %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000001', %L, 'c1100000-0000-4000-8000-000000000001', current_date, %L)$q$,
    C, K, P2, E1, S1, FW, SC, T), 'la période P2 de la même classe reste ouverte');
  UPDATE primary_school.period_locks SET status = 'OPEN' WHERE tenant_id = C AND classroom_id = K AND academic_period_id = P1;
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, %L, 'c2200000-0000-4000-8000-000000000003', %L, 'c1100000-0000-4000-8000-000000000001', current_date, %L)$q$,
    C, K, P1, E1, S1, FW, SC, T), 'réouverture de la période : la saisie reprend');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_assessments SET note='tardif' WHERE id='c8000000-0000-4000-8000-000000000001'$q$, 'validated_frozen', 'même rouverte, une appréciation validée ne change pas sans révision');
END $$;

-- Synthèse par compteurs (appréciations validées seulement)
DO $$
DECLARE
  C constant uuid := 'c0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'c2000000-0000-4000-8000-000000000001';
  K  constant uuid := 'c3000000-0000-4000-8000-000000000001';
  P1 constant uuid := 'c4000000-0000-4000-8000-000000000001';
  P2 constant uuid := 'c4000000-0000-4000-8000-000000000002';
  E1 constant uuid := 'c5000000-0000-4000-8000-000000000002';   -- inscription dédiée à ce test
  S1 constant uuid := 'c6000000-0000-4000-8000-000000000001';
  T  constant uuid := 'c7000000-0000-4000-8000-000000000001';
  SC constant uuid := 'c1000000-0000-4000-8000-000000000001';
  v jsonb;
BEGIN
  PERFORM ddltest.as_tenant(C);
  -- état : (P1, LANG.1) = L3 validée ; (P2, LANG.1) = L1 brouillon.
  INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id, status, validated_at, validated_by)
  VALUES
    ('c8000000-0000-4000-8000-000000000003', C, K, P1, E1, S1, FW, 'c2200000-0000-4000-8000-000000000002', SC, 'c1100000-0000-4000-8000-000000000002', current_date, T, 'VALIDATED', now(), T),
    ('c8000000-0000-4000-8000-000000000004', C, K, P1, E1, S1, FW, 'c2200000-0000-4000-8000-000000000003', SC, 'c1100000-0000-4000-8000-000000000002', current_date, T, 'VALIDATED', now(), T),
    ('c8000000-0000-4000-8000-000000000005', C, K, P2, E1, S1, FW, 'c2200000-0000-4000-8000-000000000003', SC, 'c1100000-0000-4000-8000-000000000001', current_date, T, 'VALIDATED', now(), T);
  INSERT INTO primary_school.competency_assessments
    (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id)
  VALUES ('c8000000-0000-4000-8000-000000000006', C, K, P2, E1, S1, FW, 'c2200000-0000-4000-8000-000000000001', SC, 'c1100000-0000-4000-8000-000000000003', current_date, T);   -- brouillon : exclu
  v := primary_school.summarize_competencies(E1);
  PERFORM ddltest.ok(v = '{"LANG": {"L2": 1}, "MATH": {"L1": 1, "L2": 1}}'::jsonb, 'synthèse : compteurs par domaine et niveau (brouillon exclu) = ' || v::text);
  v := primary_school.summarize_competencies(E1, ARRAY[P1]);
  PERFORM ddltest.ok(v = '{"LANG": {"L2": 1}, "MATH": {"L2": 1}}'::jsonb, 'synthèse restreinte à une période = ' || v::text);
  PERFORM ddltest.ok(primary_school.summarize_competencies(gen_random_uuid()) = '{}'::jsonb, 'synthèse d''une inscription inconnue = {}');
END $$;

-- Isolation
SET ROLE app_user;
SELECT ddltest.as_tenant('d0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.competency_assessments) = 0, 'RLS : le tenant D ne voit aucune appréciation de C');
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.competency_revisions) = 0, 'RLS : le tenant D ne voit aucune révision de C');
  PERFORM ddltest.ok(primary_school.summarize_competencies('c5000000-0000-4000-8000-000000000001') = '{}'::jsonb, 'RLS : la synthèse du tenant D ignore les données de C');
  PERFORM ddltest.throws($q$INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
    VALUES (gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001',
            'c1100000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000003', 'tentative depuis un autre tenant', gen_random_uuid())$q$, '42501', 'RLS : révision écrite pour un autre tenant refusée');
END $$;
SELECT ddltest.as_tenant('c0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_revisions SET reason = 'x'$q$, '42501', 'app_user ne réécrit pas les révisions (aucun GRANT UPDATE)');
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.competency_assessments) >= 4, 'le tenant C voit ses appréciations');
END $$;
RESET ROLE;
