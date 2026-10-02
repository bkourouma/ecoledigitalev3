-- Procès-verbal FIGÉ du conseil des maîtres et période du dossier (migration 1803).
\set G '''a0000000-0000-4000-8000-000000000001'''
\set H '''b0000000-0000-4000-8000-000000000001'''
SELECT ddltest.make_tenant(:G::uuid, 'ps-g');
SELECT ddltest.make_tenant(:H::uuid, 'ps-h');

DO $$
DECLARE
  G constant uuid := 'a0000000-0000-4000-8000-000000000001';
  H constant uuid := 'b0000000-0000-4000-8000-000000000001';
  DELIB constant uuid := 'a3000000-0000-4000-8000-000000000001';
  MIN1 constant uuid := 'a4000000-0000-4000-8000-000000000001';
BEGIN
  -- le dossier retient la période (colonne facultative)
  PERFORM ddltest.runs(format($q$INSERT INTO primary_school.council_cases (id, tenant_id, deliberation_id, classroom_id, academic_period_id, enrollment_id, student_id)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$, G, DELIB), 'un dossier porte la période du conseil');

  INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, academic_period_id, content, content_hash, rule_source_kind, requested_by)
  VALUES (MIN1, G, DELIB, gen_random_uuid(), gen_random_uuid(), '{"schema":1}'::jsonb, repeat('a', 64), 'placeholder', gen_random_uuid());
  PERFORM ddltest.pass('procès-verbal enregistré avec son contenu figé et son empreinte');

  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, content, content_hash, requested_by)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), '{}'::jsonb, repeat('b', 64), gen_random_uuid())$q$, G, DELIB), '23505', 'une seule version n° 1 par conseil');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, version, content, content_hash, requested_by)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), 2, '{}'::jsonb, repeat('a', 64), gen_random_uuid())$q$, G, DELIB), '23505', 'le même contenu ne se redemande pas (même empreinte)');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, content, content_hash, requested_by)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 'pas-un-hash', gen_random_uuid())$q$, G), 'check', 'empreinte hexadécimale de 64 caractères');
  PERFORM ddltest.throws(format($q$INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, content, content_hash, rule_source_kind, requested_by)
     VALUES (gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, repeat('c', 64), 'secret', gen_random_uuid())$q$, G), 'check', 'origine des règles connue');

  PERFORM ddltest.throws($q$UPDATE primary_school.council_minutes SET content = '{"schema":2}'::jsonb WHERE id = 'a4000000-0000-4000-8000-000000000001'$q$, 'append_only', 'le contenu figé ne se modifie pas');
  PERFORM ddltest.throws($q$UPDATE primary_school.council_minutes SET content_hash = repeat('f', 64) WHERE id = 'a4000000-0000-4000-8000-000000000001'$q$, 'append_only', 'l''empreinte ne se modifie pas');
  PERFORM ddltest.runs($q$UPDATE primary_school.council_minutes SET document_id = gen_random_uuid() WHERE id = 'a4000000-0000-4000-8000-000000000001'$q$, 'renseigner le document émis');
  PERFORM ddltest.throws($q$UPDATE primary_school.council_minutes SET document_id = gen_random_uuid() WHERE id = 'a4000000-0000-4000-8000-000000000001'$q$, 'append_only', 'le document émis ne se réécrit pas');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.council_minutes WHERE id = 'a4000000-0000-4000-8000-000000000001'$q$, 'append_only', 'un procès-verbal ne se supprime pas');

END
$$;

-- Isolation et privilèges applicatifs
SET ROLE app_user;
SELECT ddltest.as_tenant('b0000000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM primary_school.council_minutes) = 0, 'RLS : un autre tenant ne voit aucun procès-verbal');
  PERFORM ddltest.throws($q$INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, content, content_hash, requested_by)
     VALUES (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, repeat('d', 64), gen_random_uuid())$q$, '42501', 'RLS : écrire pour un autre tenant est refusé');
  PERFORM ddltest.throws($q$DELETE FROM primary_school.council_minutes$q$, '42501', 'GRANT : app_user ne supprime pas de procès-verbal');
END $$;
RESET ROLE;
