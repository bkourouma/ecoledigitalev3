-- Référentiels : échelles, référentiels de compétences, gardes de publication, RLS, FK composites.
\set A '''a0000000-0000-4000-8000-000000000001'''
\set B '''b0000000-0000-4000-8000-000000000001'''

SELECT ddltest.make_tenant(:A::uuid, 'ps-a');
SELECT ddltest.make_tenant(:B::uuid, 'ps-b');

-- Jeu de départ (en superutilisateur : la RLS n'est pas l'objet de cette partie)
INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind) VALUES
  ('a1000000-0000-4000-8000-000000000001', :A, 'SCALE_X', 'Échelle de démonstration', 'placeholder'),
  ('a1000000-0000-4000-8000-000000000002', :A, 'SCALE_SMALL', 'Échelle à un seul niveau', 'placeholder'),
  ('b1000000-0000-4000-8000-000000000001', :B, 'SCALE_X', 'Échelle B', 'placeholder');
INSERT INTO primary_school.rating_levels (id, tenant_id, scale_id, code, label, ordinal, meets_expectation) VALUES
  ('a1100000-0000-4000-8000-000000000001', :A, 'a1000000-0000-4000-8000-000000000001', 'N1', 'Niveau 1', 1, false),
  ('a1100000-0000-4000-8000-000000000002', :A, 'a1000000-0000-4000-8000-000000000001', 'N2', 'Niveau 2', 2, true),
  ('a1100000-0000-4000-8000-000000000003', :A, 'a1000000-0000-4000-8000-000000000001', 'N3', 'Niveau 3', 3, true),
  ('a1100000-0000-4000-8000-000000000009', :A, 'a1000000-0000-4000-8000-000000000002', 'ONLY', 'Seul niveau', 1, true);

DO $$
DECLARE
  A constant uuid := 'a0000000-0000-4000-8000-000000000001';
  B constant uuid := 'b0000000-0000-4000-8000-000000000001';
BEGIN
  -- cohérence des libellés d'origine : « regulation » sans texte cité est refusé
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind)
     VALUES (gen_random_uuid(), %L, 'REG_NO_REF', 'x', 'regulation')$q$, A), 'check', 'source_kind=regulation exige une référence');
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind, source_reference)
     VALUES (gen_random_uuid(), %L, 'REG_OK', 'x', 'regulation', 'Arrêté n° (exemple de test)')$q$, A), 'source_kind=regulation avec référence accepté');

  -- clé étrangère composite : un référentiel du tenant B ne peut pas pointer l'échelle du tenant A
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, label, scale_id)
     VALUES (gen_random_uuid(), %L, 'FW_CROSS', 'x', 'a1000000-0000-4000-8000-000000000001')$q$, B), '23503', 'FK composite : échelle d''un autre tenant refusée');
END $$;

-- Référentiel A : brouillon -> structure -> publication
INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, label, scale_id, source_kind)
  VALUES ('a2000000-0000-4000-8000-000000000001', :A, 'FW_DEMO', 'Référentiel de démonstration', 'a1000000-0000-4000-8000-000000000001', 'placeholder'),
         ('a2000000-0000-4000-8000-000000000002', :A, 'FW_SMALL', 'Référentiel à échelle trop courte', 'a1000000-0000-4000-8000-000000000002', 'placeholder');

DO $$
DECLARE
  A constant uuid := 'a0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'a2000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_frameworks SET status='PUBLISHED', published_at=now()
     WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_empty', 'publier un référentiel sans compétence est refusé');

  INSERT INTO primary_school.competency_domains (id, tenant_id, framework_id, code, label, ordinal)
    VALUES ('a2100000-0000-4000-8000-000000000001', A, FW, 'LANG', 'Langage', 1),
           ('a2100000-0000-4000-8000-000000000002', A, FW, 'MATH', 'Mathématiques', 2);
  INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal)
    VALUES ('a2200000-0000-4000-8000-000000000001', A, FW, 'a2100000-0000-4000-8000-000000000001', 'LANG.1', 'Comprendre une consigne', 1),
           ('a2200000-0000-4000-8000-000000000002', A, FW, 'a2100000-0000-4000-8000-000000000001', 'LANG.2', 'S''exprimer à l''oral', 2),
           ('a2200000-0000-4000-8000-000000000003', A, FW, 'a2100000-0000-4000-8000-000000000002', 'MATH.1', 'Dénombrer', 1);

  PERFORM ddltest.throws($q$UPDATE primary_school.competency_frameworks SET status='PUBLISHED', published_at=now()
     WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_no_level', 'publier sans niveau d''application est refusé');
  INSERT INTO primary_school.framework_grade_levels (tenant_id, framework_id, grade_level_code) VALUES (A, FW, 'PS'), (A, FW, 'MS');

  -- domaine d'un AUTRE référentiel : la FK composite (framework, domaine) refuse l'incohérence
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, 'a2000000-0000-4000-8000-000000000002', 'a2100000-0000-4000-8000-000000000001', 'BAD', 'x', 7)$q$, A),
     '23503', 'une compétence ne peut pas viser le domaine d''un autre référentiel');

  -- ordinal unique dans un domaine
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'a2100000-0000-4000-8000-000000000001', 'LANG.3', 'x', 1)$q$, A, FW), '23505', 'ordinal de compétence unique par domaine');

END $$;

-- Cas « échelle trop courte » : structure complète mais échelle d'un seul niveau
INSERT INTO primary_school.competency_domains (id, tenant_id, framework_id, code, label, ordinal)
  VALUES ('a2100000-0000-4000-8000-0000000000f1', :A, 'a2000000-0000-4000-8000-000000000002', 'D', 'D', 1);
INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal)
  VALUES ('a2200000-0000-4000-8000-0000000000f1', :A, 'a2000000-0000-4000-8000-000000000002', 'a2100000-0000-4000-8000-0000000000f1', 'X', 'x', 1);
INSERT INTO primary_school.framework_grade_levels (tenant_id, framework_id, grade_level_code)
  VALUES (:A, 'a2000000-0000-4000-8000-000000000002', 'PS');
SELECT ddltest.throws($q$UPDATE primary_school.competency_frameworks SET status='PUBLISHED', published_at=now()
   WHERE id='a2000000-0000-4000-8000-000000000002'$q$, 'scale_too_small', 'publier avec une échelle d''un seul niveau est refusé');

DO $$
DECLARE
  A constant uuid := 'a0000000-0000-4000-8000-000000000001';
  FW constant uuid := 'a2000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_frameworks SET status='PUBLISHED', published_at=now(), published_by=gen_random_uuid()
     WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'publication d''un référentiel complet');

  -- structure figée après publication
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'a2100000-0000-4000-8000-000000000001', 'LANG.9', 'x', 9)$q$, A, FW), 'framework_published_immutable', 'ajout d''une compétence à un référentiel publié refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.competencies SET label='autre' WHERE code='LANG.1'$q$, 'framework_published_immutable', 'modification d''une compétence publiée refusée');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.competency_domains WHERE code='MATH'$q$, 'framework_published_immutable', 'suppression d''un domaine publié refusée');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.framework_grade_levels WHERE grade_level_code='PS'$q$, 'framework_published_immutable', 'retrait d''un niveau d''application publié refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_frameworks SET label='Autre' WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_published_immutable', 'modification du référentiel publié refusée');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_frameworks SET version=2 WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_identity_immutable', 'version figée');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.competency_frameworks WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_delete_forbidden', 'suppression d''un référentiel publié refusée');
  PERFORM ddltest.throws($q$UPDATE primary_school.competency_frameworks SET status='DRAFT', published_at=NULL WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'framework_transition', 'retour au brouillon interdit');

  -- l'échelle d'un référentiel publié est figée
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.rating_levels (id, tenant_id, scale_id, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, 'a1000000-0000-4000-8000-000000000001', 'N4', 'Niveau 4', 4)$q$, A), 'scale_in_use', 'ajout d''un niveau à une échelle publiée refusé');
  PERFORM ddltest.throws($q$UPDATE primary_school.rating_levels SET label='x' WHERE code='N1' AND scale_id='a1000000-0000-4000-8000-000000000001'$q$, 'scale_in_use', 'modification d''un niveau publié refusée');

  -- une seule version publiée par code
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, version, label, scale_id, status, published_at)
     VALUES (gen_random_uuid(), %L, 'FW_DEMO', 2, 'v2', 'a1000000-0000-4000-8000-000000000001', 'PUBLISHED', now())$q$, A), '23505', 'une seule version publiée par code');
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, version, label, scale_id)
     VALUES (gen_random_uuid(), %L, 'FW_DEMO', 2, 'v2 brouillon', 'a1000000-0000-4000-8000-000000000001')$q$, A), 'une version suivante en brouillon cohabite avec la publiée');
  PERFORM ddltest.runs($q$UPDATE primary_school.competency_frameworks SET status='RETIRED' WHERE id='a2000000-0000-4000-8000-000000000001'$q$, 'PUBLISHED -> RETIRED');
END $$;

-- RLS et privilèges, sous le rôle applicatif
SET ROLE app_user;
SELECT ddltest.as_tenant('b0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.rating_scales) = 1, 'RLS : le tenant B ne voit que ses échelles');
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.competency_frameworks) = 0, 'RLS : le tenant B ne voit aucun référentiel de A');
  PERFORM ddltest.throws($q$INSERT INTO primary_school.rating_scales (id, tenant_id, code, label)
     VALUES (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001', 'INTRUS', 'x')$q$, '42501', 'RLS : écriture sous le tenant d''un autre refusée');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.rating_scales$q$, '42501', 'GRANT : pas de DELETE sur les échelles');
  PERFORM ddltest.runs($q$UPDATE primary_school.rating_scales SET label = 'modifié par B' WHERE code = 'SCALE_X'$q$, 'B met à jour son échelle');
  PERFORM ddltest.ok((SELECT label FROM primary_school.rating_scales) = 'modifié par B', 'B voit sa modification');
END $$;
SELECT ddltest.as_tenant('a0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT label FROM primary_school.rating_scales WHERE code='SCALE_X') = 'Échelle de démonstration', 'RLS : la mise à jour de B n''a pas touché A');
END $$;
RESET ROLE;
