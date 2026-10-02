-- Aides communes aux tests de comportement du DDL (aucune table de la plateforme n'est modifiée).
-- Chaque test s'exécute dans sa propre session `psql` ; la base est partagée, les identifiants de tenant
-- de test sont donc distincts d'un fichier à l'autre.
CREATE SCHEMA IF NOT EXISTS ddltest;
GRANT USAGE ON SCHEMA ddltest TO app_user;

CREATE OR REPLACE FUNCTION ddltest.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'PASS: %', p_label; END $$;

-- Condition vraie, sinon échec du test.
CREATE OR REPLACE FUNCTION ddltest.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- L'instruction DOIT échouer, et le message (ou le SQLSTATE) doit contenir `p_expect`.
CREATE OR REPLACE FUNCTION ddltest.throws(p_sql text, p_expect text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_failed boolean := false;
  v_msg    text;
  v_state  text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_msg := SQLERRM;
    v_state := SQLSTATE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: % (aucune erreur levée)', p_label;
  END IF;
  IF position(p_expect in v_msg) = 0 AND v_state <> p_expect THEN
    RAISE EXCEPTION 'FAIL: % (erreur inattendue [%] %)', p_label, v_state, v_msg;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- L'instruction DOIT réussir.
CREATE OR REPLACE FUNCTION ddltest.runs(p_sql text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_failed boolean := false;
  v_msg    text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_msg := SQLERRM;
  END;
  IF v_failed THEN RAISE EXCEPTION 'FAIL: % (erreur [%])', p_label, v_msg; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- Positionne le tenant courant (session) comme le ferait TenantDb (SET LOCAL en production).
CREATE OR REPLACE FUNCTION ddltest.as_tenant(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('app.tenant_id', p_tenant::text, false); END $$;

CREATE OR REPLACE FUNCTION ddltest.make_tenant(p_id uuid, p_slug text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kernel.tenants (id, slug, name) VALUES (p_id, p_slug, p_slug) ON CONFLICT DO NOTHING;
END $$;
