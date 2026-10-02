-- Formulaire public (jetons à usage unique, délai minimal, tentatives) et essais de CONCURRENCE réels
-- (plusieurs sessions Postgres via dblink) : jeton, dernière place, numérotation sans trou.
\set L '''a3000000-0000-4000-8000-0000000000a1'''
\set M '''a3000000-0000-4000-8000-0000000000b1'''
SELECT ddltest.make_tenant(:L::uuid, 'adm-l');
SELECT ddltest.make_tenant(:M::uuid, 'adm-m');

-- ------------------------------------------------------------ jetons de formulaire
DO $do$
DECLARE
  L constant uuid := 'a3000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a3100000-0000-4000-8000-000000000001';
  h1 constant text := repeat('1', 64);
  h2 constant text := repeat('2', 64);
  h3 constant text := repeat('3', 64);
BEGIN
  PERFORM ddltest.as_tenant(L);
  -- jeton trop récent (délai minimal non écoulé)
  INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, issued_at, min_ready_at, expires_at)
    VALUES (gen_random_uuid(), L, I, h1, now(), now() + interval '1 hour', now() + interval '2 hours');
  PERFORM ddltest.ok(admissions.consume_form_session(h1) IS FALSE, 'jeton refusé avant son délai minimal (robot trop rapide)');
  -- jeton valide
  INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, issued_at, min_ready_at, expires_at)
    VALUES (gen_random_uuid(), L, I, h2, now() - interval '1 minute', now() - interval '50 seconds', now() + interval '1 hour');
  PERFORM ddltest.ok(admissions.consume_form_session(h2) IS TRUE, 'jeton valide consommé');
  PERFORM ddltest.ok(admissions.consume_form_session(h2) IS FALSE, 'un jeton ne sert qu''une fois');
  PERFORM ddltest.throws($q$UPDATE admissions.public_form_sessions SET consumed_at = NULL WHERE token_hash = repeat('2', 64)$q$, 'form_session_consumed', 'un jeton consommé est figé');
  -- jeton expiré
  INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, issued_at, min_ready_at, expires_at)
    VALUES (gen_random_uuid(), L, I, h3, now() - interval '2 hours', now() - interval '119 minutes', now() - interval '1 hour');
  PERFORM ddltest.ok(admissions.consume_form_session(h3) IS FALSE, 'jeton expiré refusé');
  PERFORM ddltest.ok(admissions.consume_form_session(repeat('9', 64)) IS FALSE, 'jeton inconnu refusé');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, min_ready_at, expires_at)
     VALUES (gen_random_uuid(), %L, %L, 'pas-une-empreinte', now(), now() + interval '1 hour')$q$, L, I), 'check', 'seule l''empreinte SHA-256 est stockée (pas le jeton)');
  PERFORM ddltest.throws($q$UPDATE admissions.public_form_sessions SET expires_at = now() + interval '30 days' WHERE token_hash = repeat('1', 64)$q$, 'form_session_immutable', 'l''échéance d''un jeton ne se prolonge pas');

  -- tentatives
  INSERT INTO admissions.submission_attempts (id, tenant_id, institution_id, ip_hash, outcome)
    SELECT gen_random_uuid(), L, I, repeat('a', 64), 'REJECTED_RATE' FROM generate_series(1, 4);
  INSERT INTO admissions.submission_attempts (id, tenant_id, institution_id, ip_hash, outcome, attempted_at)
    VALUES (gen_random_uuid(), L, I, repeat('a', 64), 'ACCEPTED', now() - interval '2 hours');
  PERFORM ddltest.ok(admissions.recent_attempts(repeat('a', 64), interval '10 minutes') = 4, 'tentatives récentes d''une empreinte d''IP');
  PERFORM ddltest.ok(admissions.recent_attempts(repeat('b', 64), interval '10 minutes') = 0, 'autre IP : aucune tentative');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.submission_attempts (id, tenant_id, institution_id, ip_hash, outcome)
     VALUES (gen_random_uuid(), %L, %L, '203.0.113.7', 'ACCEPTED')$q$, L, I), 'check', 'l''IP n''est jamais stockée en clair');
END $do$;

SET ROLE app_user;
SELECT ddltest.as_tenant('a3000000-0000-4000-8000-0000000000b1');
DO $do$
BEGIN
  PERFORM ddltest.ok(admissions.consume_form_session(repeat('1', 64)) IS FALSE, 'RLS : un autre tenant ne peut pas consommer le jeton de L');
  PERFORM ddltest.ok(admissions.recent_attempts(repeat('a', 64), interval '1 day') = 0, 'RLS : les tentatives de L sont invisibles à M');
  PERFORM ddltest.runs($q$DELETE FROM admissions.submission_attempts$q$, 'app_user purge les tentatives de son tenant (aucune de M)');
END $do$;
RESET ROLE;

-- ------------------------------------------------------------ concurrence : jeton unique, dernière place, numérotation
DO $do$
DECLARE
  L constant uuid := 'a3000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a3100000-0000-4000-8000-000000000001';
  W constant uuid := 'a3200000-0000-4000-8000-000000000001';
  C constant uuid := 'a3400000-0000-4000-8000-000000000001';
  P1 constant uuid := 'a3500000-0000-4000-8000-0000000000e1';
  P2 constant uuid := 'a3500000-0000-4000-8000-0000000000e2';
BEGIN
  PERFORM ddltest.as_tenant(L);
  PERFORM ddltest.standard_workflow(L, I, W, 'STD');
  UPDATE admissions.workflows SET status = 'PUBLISHED', published_at = now() WHERE id = W;
  INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at, status)
    VALUES (C, L, I, gen_random_uuid(), 'CONC', 'Concurrence', W, now() - interval '1 day', now() + interval '30 days', 'OPEN');
  INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, seats) VALUES (gen_random_uuid(), L, C, 'CE1', 1);
  PERFORM ddltest.new_application(P1, L, I, C, W, 'CONC-1', 'Premier', 'Candidat', DATE '2018-04-04', 'CE1');
  PERFORM ddltest.new_application(P2, L, I, C, W, 'CONC-2', 'Second', 'Candidate', DATE '2018-05-05', 'CE1');
  INSERT INTO admissions.document_requirements (id, tenant_id, institution_id, code, label) VALUES (gen_random_uuid(), L, I, 'ACTE_NAISSANCE', 'Acte');
  PERFORM ddltest.to_review(P1);
  PERFORM ddltest.to_review(P2);
  INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, issued_at, min_ready_at, expires_at)
    VALUES (gen_random_uuid(), L, I, repeat('c', 64), now() - interval '1 minute', now() - interval '50 seconds', now() + interval '1 hour');
END $do$;
-- la préparation ci-dessus doit être VALIDÉE avant que les autres sessions la voient
-- (chaque instruction psql est sa propre transaction : le DO précédent est déjà commité)

DO $do$
DECLARE
  L constant uuid := 'a3000000-0000-4000-8000-0000000000a1';
  C constant uuid := 'a3400000-0000-4000-8000-000000000001';
  P1 constant uuid := 'a3500000-0000-4000-8000-0000000000e1';
  P2 constant uuid := 'a3500000-0000-4000-8000-0000000000e2';
  conn text[] := ARRAY['c1', 'c2', 'c3', 'c4'];
  i int; r int;
  ok_count int := 0; err_count int := 0; last_err text := '';
  n bigint;
  got bigint[] := '{}';
  setup text := format($s$SELECT set_config('app.tenant_id', %L, false)$s$, L);
  res boolean;
BEGIN
  FOR i IN 1..4 LOOP
    PERFORM dblink_connect(conn[i], 'dbname=postgres');
    PERFORM dblink_exec(conn[i], format($s$SET app.tenant_id = %L$s$, L));
  END LOOP;

  -- 1. jeton de formulaire : 4 sessions consomment le MÊME jeton ; exactement une réussit
  FOR i IN 1..4 LOOP
    PERFORM dblink_send_query(conn[i], $s$WITH r AS (SELECT admissions.consume_form_session(repeat('c', 64)) AS ok) SELECT ok, pg_sleep(0.3) FROM r$s$);
  END LOOP;
  FOR i IN 1..4 LOOP
    SELECT t.ok INTO res FROM dblink_get_result(conn[i]) AS t(ok boolean, s text);
    PERFORM 1 FROM dblink_get_result(conn[i]) AS t(ok boolean, s text);   -- vider la connexion
    IF res THEN ok_count := ok_count + 1; END IF;
  END LOOP;
  PERFORM ddltest.ok(ok_count = 1, 'concurrence : 4 sessions, un seul jeton consommé (' || ok_count || ')');

  -- 2. dernière place : deux dossiers veulent l'unique place ; la ligne de capacité sérialise
  ok_count := 0;
  PERFORM dblink_send_query(conn[1], format($s$DO $x$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); PERFORM pg_sleep(1); END $x$$s$, P1, P1));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query(conn[2], format($s$DO $x$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $x$$s$, P2, P2));
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM * FROM dblink_get_result(conn[i]) AS t(x text);
      PERFORM 1 FROM dblink_get_result(conn[i]) AS t(x text);   -- vider la connexion
      ok_count := ok_count + 1;
    EXCEPTION WHEN OTHERS THEN
      err_count := err_count + 1; last_err := SQLERRM;
    END;
  END LOOP;
  PERFORM ddltest.ok(ok_count = 1 AND err_count = 1, 'concurrence : une seule admission sur la dernière place (' || ok_count || ' succès, ' || err_count || ' refus)');
  PERFORM ddltest.ok(last_err LIKE '%capacity_full%', 'concurrence : le perdant reçoit capacity_full (' || last_err || ')');
  PERFORM ddltest.ok(admissions.seats_left(C, 'CE1') = 0, 'concurrence : aucune surréservation');

  -- 3. numérotation : 4 sessions × 25 numéros par tours concurrents -> 100 valeurs distinctes, de 1 à 100
  --    (connexions neuves : après une erreur distante, l'état de la connexion précédente n'est pas fiable)
  FOR i IN 1..4 LOOP
    PERFORM dblink_disconnect(conn[i]);
    PERFORM dblink_connect(conn[i], 'dbname=postgres');
    PERFORM dblink_exec(conn[i], format($s$SET app.tenant_id = %L$s$, L));
  END LOOP;
  FOR r IN 1..25 LOOP
    FOR i IN 1..4 LOOP
      PERFORM dblink_send_query(conn[i], $s$SELECT admissions.next_number('par')$s$);
    END LOOP;
    FOR i IN 1..4 LOOP
      SELECT t.v INTO n FROM dblink_get_result(conn[i]) AS t(v bigint);
      PERFORM 1 FROM dblink_get_result(conn[i]) AS t(v bigint);   -- vider la connexion
      got := got || n;
    END LOOP;
  END LOOP;
  PERFORM ddltest.ok(cardinality(got) = 100 AND (SELECT count(DISTINCT x) FROM unnest(got) x) = 100, 'numérotation concurrente : 100 numéros distincts');
  PERFORM ddltest.ok((SELECT min(x) FROM unnest(got) x) = 1 AND (SELECT max(x) FROM unnest(got) x) = 100, 'numérotation concurrente : sans trou (1..100)');

  FOR i IN 1..4 LOOP PERFORM dblink_disconnect(conn[i]); END LOOP;
EXCEPTION WHEN OTHERS THEN
  FOR i IN 1..4 LOOP
    BEGIN PERFORM dblink_disconnect(conn[i]); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  RAISE;
END $do$;
