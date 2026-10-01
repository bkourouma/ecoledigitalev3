-- =============================================================================
-- 0002 — Schéma `kernel` : isolation multi-tenant par RLS
-- =============================================================================
--
-- CE QUE CETTE MIGRATION CORRIGE
--
-- Dans la base historique, la RLS « existait » mais n'isolait rien : l'API se
-- connectait avec un super-utilisateur (qui contourne TOUTES les policies, même
-- avec FORCE) ou avec le propriétaire des tables (qui les contourne sans FORCE).
--
-- Ici, trois verrous indépendants :
--   1. l'application se connecte avec `app_user` : ni propriétaire, ni superuser,
--      ni BYPASSRLS ;
--   2. toute table de tenant passe par `kernel.enable_tenant_rls()` qui pose
--      ENABLE **et FORCE** ROW LEVEL SECURITY : même le propriétaire est soumis ;
--   3. UNE seule policy `tenant_isolation` par table, sans échappatoire
--      « super-admin » : pas de `OR current_setting('app.super_admin') = 'true'`.
--      Les opérations inter-tenants se font en itérant les tenants un par un
--      (voir `SystemDb.forEachTenant`), jamais en levant l'isolation.
--
-- Échec fermé : sans `app.tenant_id` valide, `kernel.current_tenant_id()`
-- renvoie NULL, `tenant_id = NULL` n'est jamais vrai, aucune ligne n'est
-- visible ni insérable.
--
-- Exécutée sous `SET ROLE migrator` par le runner (migrator = propriétaire).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS kernel;

REVOKE ALL ON SCHEMA kernel FROM PUBLIC;
GRANT USAGE ON SCHEMA kernel TO app_user;

-- Droits par défaut pour les tables/séquences FUTURES du schéma kernel
-- (créées par le rôle qui exécute cette migration, normalement migrator).
ALTER DEFAULT PRIVILEGES IN SCHEMA kernel
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA kernel
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- -----------------------------------------------------------------------------
-- Lecture du contexte posé par l'application (SET LOCAL via set_config).
-- Conversion SÛRE : une valeur absente, vide ou mal formée donne NULL (donc
-- aucun accès), jamais une erreur de cast qui pourrait révéler la configuration.
-- Écrites en SQL pur pour rester inlinables par le planificateur.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kernel.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.tenant_id', true), '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN NULLIF(current_setting('app.tenant_id', true), '')::uuid
  END
$$;

CREATE OR REPLACE FUNCTION kernel.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.user_id', true), '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN NULLIF(current_setting('app.user_id', true), '')::uuid
  END
$$;

-- 'user' | 'system' | 'superAdmin' | NULL. Informatif (audit, triggers) :
-- AUCUNE policy ne s'appuie dessus.
CREATE OR REPLACE FUNCTION kernel.current_actor()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.actor', true), '')
$$;

-- -----------------------------------------------------------------------------
-- kernel.enable_tenant_rls(table)
--
-- À appeler dans la migration qui crée chaque table de tenant. Idempotente.
-- Exige : colonne `tenant_id uuid NOT NULL`. Pose :
--   - ENABLE + FORCE ROW LEVEL SECURITY ;
--   - l'UNIQUE policy `tenant_isolation` (USING et WITH CHECK identiques) ;
--   - un index dont la première colonne est `tenant_id` (s'il n'en existe pas).
-- Refuse (au lieu de les supprimer en silence) toute autre policy : une policy
-- permissive supplémentaire s'ajouterait en OU et ouvrirait l'accès.
-- Ne dépend d'aucun contournement super-admin.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kernel.enable_tenant_rls(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_relname   name;
  v_relkind   "char";
  v_attnum    smallint;
  v_type      oid;
  v_notnull   boolean;
  v_others    text;
  v_has_index boolean;
BEGIN
  SELECT c.relname, c.relkind INTO v_relname, v_relkind
    FROM pg_class c WHERE c.oid = p_table;

  IF v_relkind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'enable_tenant_rls(%): ce n''est pas une table (relkind=%)', p_table, v_relkind;
  END IF;

  SELECT a.attnum, a.atttypid, a.attnotnull INTO v_attnum, v_type, v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = p_table AND a.attname = 'tenant_id' AND NOT a.attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'enable_tenant_rls(%): colonne tenant_id absente', p_table;
  END IF;
  IF v_type <> 'uuid'::regtype THEN
    RAISE EXCEPTION 'enable_tenant_rls(%): tenant_id doit être de type uuid', p_table;
  END IF;
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'enable_tenant_rls(%): tenant_id doit être NOT NULL', p_table;
  END IF;

  SELECT string_agg(polname, ', ') INTO v_others
    FROM pg_policy
   WHERE polrelid = p_table AND polname <> 'tenant_isolation';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION 'enable_tenant_rls(%): policies étrangères présentes (%). tenant_isolation doit être la seule policy ; supprimez-les explicitement.',
      p_table, v_others;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL TO PUBLIC '
    'USING (tenant_id = kernel.current_tenant_id()) '
    'WITH CHECK (tenant_id = kernel.current_tenant_id())',
    p_table);

  SELECT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = p_table
       AND i.indisvalid
       AND i.indpred IS NULL
       AND i.indkey[0] = v_attnum
  ) INTO v_has_index;

  IF NOT v_has_index THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (tenant_id)',
                   left(v_relname::text, 45) || '_tenant_id_idx', p_table);
  END IF;
END
$$;

-- Fonction de DDL : réservée au propriétaire (migrator) et aux superusers.
REVOKE ALL ON FUNCTION kernel.enable_tenant_rls(regclass) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- kernel.tenants — table GLOBALE minimale (volontairement hors RLS).
--
-- Elle doit être lisible avant qu'un contexte de tenant n'existe (résolution du
-- sous-domaine / slug) et pour itérer les tenants dans les jobs. Elle ne porte
-- donc pas de colonne tenant_id et figure dans la liste blanche du test
-- d'isolation. Colonnes non sensibles uniquement : n'y ajoutez ni secret ni
-- donnée personnelle.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kernel.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE
             CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$'),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  status     text NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pas de suppression physique d'un tenant par l'application (archivage = status).
REVOKE DELETE ON kernel.tenants FROM app_user;
