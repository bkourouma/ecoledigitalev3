-- =============================================================================
-- 0300 — Module `audit` : journal d'audit append-only, partitionné, chaîné
-- =============================================================================
--
-- Numérotation : les versions de migration sont GLOBALES à tous les dossiers
-- (voir loader.ts). Le module `audit` réserve la plage 0300-0399.
--
-- CONTENU
--   audit.audit_log            journal par tenant, PARTITIONNÉ par mois (RANGE occurred_at)
--   audit.chain_heads          tête de chaîne (dernier seq/hash) par tenant
--   audit.platform_audit_log   journal des événements SANS tenant (plateforme), non partitionné
--   audit.platform_chain_head  tête de chaîne de ce journal (ligne unique)
--   audit_archive (schéma)     destination des partitions détachées (0301), AUCUN droit applicatif
--
-- GARANTIES POSÉES ICI
--   1. Append-only : pas de GRANT UPDATE/DELETE/TRUNCATE pour app_user, ET un trigger
--      BEFORE UPDATE/DELETE (et TRUNCATE) qui lève même pour le propriétaire de la table
--      (migrator) : le simple fait d'avoir les droits ne suffit pas à réécrire le passé.
--   2. Chaînage : chaque ligne porte seq (gapless par tenant), prev_hash et hash. Un trigger
--      BEFORE INSERT impose seq = dernier+1 et prev_hash = dernier hash sous un verrou
--      advisory transactionnel par tenant ; un trigger AFTER INSERT (SECURITY DEFINER)
--      avance la tête. app_user n'a AUCUN droit d'écriture sur la tête.
--      Le HASH lui-même (canonicalisation JSON + HMAC éventuel) est calculé et vérifié
--      côté application (domain/hash.ts) : la base ne peut pas le recalculer.
--   3. RLS : kernel.enable_tenant_rls sur le parent ET sur chaque partition (voir README :
--      la RLS du parent ne protège que l'accès VIA le parent ; l'accès direct à une
--      partition est refusé par absence de GRANT, et la RLS est en plus posée dessus).
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS audit_archive;

REVOKE ALL ON SCHEMA audit FROM PUBLIC;
REVOKE ALL ON SCHEMA audit_archive FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO app_user;
-- audit_archive : aucun droit pour app_user (stockage froid, consulté par un opérateur).

-- -----------------------------------------------------------------------------
-- Fonctions utilitaires et triggers génériques
-- -----------------------------------------------------------------------------

-- Clé du verrou advisory de chaîne d'un tenant (espace de noms dédié : ne collisionne
-- pas avec le verrou du runner de migrations).
CREATE OR REPLACE FUNCTION audit.chain_lock_key(p_tenant uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT pg_catalog.hashtextextended('ed:audit:chain:' || p_tenant::text, 0)
$$;

-- Refuse toute modification / suppression / troncature (code SQLSTATE dédié AU001).
CREATE OR REPLACE FUNCTION audit.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Journal d''audit en ajout seul : % refusé sur %.%.', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'AU001';
END
$$;

-- -----------------------------------------------------------------------------
-- Tête de chaîne par tenant
-- -----------------------------------------------------------------------------
CREATE TABLE audit.chain_heads (
  tenant_id  uuid PRIMARY KEY REFERENCES kernel.tenants (id) ON DELETE RESTRICT,
  last_seq   bigint NOT NULL CHECK (last_seq >= 1),
  last_hash  text NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- La tête ne peut qu'AVANCER de 1 (même pour qui aurait le droit de l'écrire).
CREATE OR REPLACE FUNCTION audit.chain_head_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'Tête de chaîne d''audit : seule une avance de +1 est permise (% -> %).', OLD.last_seq, NEW.last_seq
      USING ERRCODE = 'AU003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER chain_heads_monotonic BEFORE UPDATE ON audit.chain_heads
  FOR EACH ROW EXECUTE FUNCTION audit.chain_head_guard();
CREATE TRIGGER chain_heads_no_delete BEFORE DELETE ON audit.chain_heads
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER chain_heads_no_truncate BEFORE TRUNCATE ON audit.chain_heads
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

SELECT kernel.enable_tenant_rls('audit.chain_heads');
GRANT SELECT ON audit.chain_heads TO app_user;

-- -----------------------------------------------------------------------------
-- Journal par tenant — PARTITIONNÉ par mois
-- -----------------------------------------------------------------------------
-- La clé primaire d'une table partitionnée doit contenir la clé de partition
-- (occurred_at). L'unicité de (tenant_id, seq) est garantie par le verrou de chaîne
-- + le trigger de garde, pas par un index unique (impossible sans occurred_at).
CREATE TABLE audit.audit_log (
  id              uuid        NOT NULL,
  tenant_id       uuid        NOT NULL REFERENCES kernel.tenants (id) ON DELETE RESTRICT,
  seq             bigint      NOT NULL CHECK (seq >= 1),
  occurred_at     timestamptz NOT NULL,
  -- Instant réel d'insertion (différent d'occurred_at pour les événements rejoués).
  -- Informatif : NON couvert par le hash.
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      text        NOT NULL
                  CHECK (actor_type IN ('user', 'system', 'superAdmin', 'impersonation')),
  actor_id        uuid,
  impersonated_by uuid,
  action          text        NOT NULL
                  CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length(action) <= 100),
  entity          text        NOT NULL
                  CHECK (entity ~ '^[a-z][a-z0-9_]*$' AND length(entity) <= 100),
  entity_id       text        CHECK (length(entity_id) <= 200),
  before          jsonb,
  after           jsonb,
  diff            jsonb,
  metadata        jsonb,
  ip              text        CHECK (length(ip) <= 64),
  user_agent      text        CHECK (length(user_agent) <= 512),
  device          text        CHECK (length(device) <= 200),
  request_id      text        CHECK (length(request_id) <= 200),
  reason          text        CHECK (length(reason) <= 1000),
  severity        text        NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'notice', 'warning', 'critical')),
  hash_alg        text        NOT NULL CHECK (hash_alg IN ('sha256', 'hmac-sha256')),
  key_id          text        CHECK (length(key_id) <= 64),
  prev_hash       text        NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash            text        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_log_pkey PRIMARY KEY (tenant_id, occurred_at, id),
  CONSTRAINT audit_log_actor_chk CHECK (actor_type = 'system' OR actor_id IS NOT NULL),
  CONSTRAINT audit_log_impersonation_chk CHECK (actor_type <> 'impersonation' OR impersonated_by IS NOT NULL),
  CONSTRAINT audit_log_key_chk CHECK ((hash_alg = 'hmac-sha256') = (key_id IS NOT NULL))
) PARTITION BY RANGE (occurred_at);

-- Index (hérités par chaque partition). Le premier sert aussi à kernel.enable_tenant_rls.
CREATE INDEX audit_log_tenant_seq_idx     ON audit.audit_log (tenant_id, seq);
CREATE INDEX audit_log_tenant_time_idx    ON audit.audit_log (tenant_id, occurred_at);
CREATE INDEX audit_log_tenant_id_idx2     ON audit.audit_log (tenant_id, id);
CREATE INDEX audit_log_tenant_entity_idx  ON audit.audit_log (tenant_id, entity, entity_id);
CREATE INDEX audit_log_tenant_actor_idx   ON audit.audit_log (tenant_id, actor_id);
CREATE INDEX audit_log_tenant_action_idx  ON audit.audit_log (tenant_id, action);

-- BEFORE INSERT : impose la structure de la chaîne sous le verrou du tenant.
CREATE OR REPLACE FUNCTION audit.chain_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq  bigint;
  v_hash text;
BEGIN
  -- Ré-entrant : l'application a normalement déjà pris ce verrou avant de lire la tête.
  PERFORM pg_catalog.pg_advisory_xact_lock(audit.chain_lock_key(NEW.tenant_id));

  SELECT h.last_seq, h.last_hash INTO v_seq, v_hash
    FROM audit.chain_heads h WHERE h.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    v_seq := 0;
    v_hash := pg_catalog.repeat('0', 64);
  END IF;

  IF NEW.seq <> v_seq + 1 OR NEW.prev_hash <> v_hash THEN
    RAISE EXCEPTION 'Chaîne d''audit rompue : attendu seq=% (reçu %) ou prev_hash différent de la tête.', v_seq + 1, NEW.seq
      USING ERRCODE = 'AU002';
  END IF;
  RETURN NEW;
END
$$;

-- AFTER INSERT : avance la tête (SECURITY DEFINER : app_user n'a aucun droit d'écriture dessus).
-- Non déclenché pour une ligne ignorée par ON CONFLICT DO NOTHING (rejeu d'événement).
CREATE OR REPLACE FUNCTION audit.chain_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO audit.chain_heads AS h (tenant_id, last_seq, last_hash, updated_at)
  VALUES (NEW.tenant_id, NEW.seq, NEW.hash, pg_catalog.now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_seq = EXCLUDED.last_seq, last_hash = EXCLUDED.last_hash, updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION audit.chain_advance() FROM PUBLIC;

-- Triggers de ligne : clonés automatiquement sur chaque partition (PostgreSQL >= 13).
CREATE TRIGGER a_chain_guard   BEFORE INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.chain_guard();
CREATE TRIGGER b_chain_advance AFTER INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.chain_advance();
CREATE TRIGGER no_mutation     BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
-- Les triggers de INSTRUCTION ne sont pas clonés : TRUNCATE du parent ici,
-- TRUNCATE de chaque partition dans audit.create_partition().
CREATE TRIGGER no_truncate     BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

SELECT kernel.enable_tenant_rls('audit.audit_log');

REVOKE ALL ON audit.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit.audit_log FROM app_user;
GRANT SELECT, INSERT ON audit.audit_log TO app_user;

-- -----------------------------------------------------------------------------
-- Création des partitions (idempotente, sans verrou exclusif sur le parent)
-- -----------------------------------------------------------------------------
-- CREATE TABLE ... PARTITION OF prend un ACCESS EXCLUSIVE sur le parent : il se mettrait
-- en file derrière la plus longue transaction d'audit et bloquerait toutes les suivantes.
-- On crée donc une table autonome (LIKE) puis on l'ATTACHE : verrou SHARE UPDATE EXCLUSIVE,
-- compatible avec les insertions en cours.
--
-- SECURITY DEFINER (propriétaire migrator) : app_user n'a aucun droit de DDL.
CREATE OR REPLACE FUNCTION audit.create_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_from  timestamp;
  v_start timestamptz;
  v_end   timestamptz;
  v_name  text;
BEGIN
  IF p_month IS NULL OR p_month < DATE '2000-01-01' OR p_month > DATE '2100-12-31' THEN
    RAISE EXCEPTION 'audit.create_partition : mois hors plage (%)', p_month;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ed:audit:partitions', 0));

  v_from  := pg_catalog.date_trunc('month', p_month::timestamp);
  v_start := v_from AT TIME ZONE 'UTC';
  v_end   := (v_from + INTERVAL '1 month') AT TIME ZONE 'UTC';
  v_name  := 'audit_log_y' || pg_catalog.to_char(v_from, 'YYYY') || 'm' || pg_catalog.to_char(v_from, 'MM');

  IF pg_catalog.to_regclass(pg_catalog.format('audit.%I', v_name)) IS NOT NULL THEN
    RETURN NULL; -- déjà là
  END IF;

  EXECUTE pg_catalog.format(
    'CREATE TABLE audit.%I (LIKE audit.audit_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)',
    v_name);
  EXECUTE pg_catalog.format(
    'ALTER TABLE audit.audit_log ATTACH PARTITION audit.%I FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start::text, v_end::text);

  -- Défense en profondeur : RLS aussi sur la partition (accès direct), TRUNCATE interdit.
  PERFORM kernel.enable_tenant_rls(pg_catalog.format('audit.%I', v_name)::regclass);
  EXECUTE pg_catalog.format(
    'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation()',
    v_name);
  EXECUTE pg_catalog.format('REVOKE ALL ON audit.%I FROM PUBLIC', v_name);

  RETURN v_name;
END
$$;
REVOKE ALL ON FUNCTION audit.create_partition(date) FROM PUBLIC;

-- Crée les partitions de (mois courant - p_months_back) à (mois courant + p_months_ahead), UTC.
-- Compatible job planifié : idempotente, renvoie les noms créés.
CREATE OR REPLACE FUNCTION audit.ensure_partitions(p_months_ahead integer DEFAULT 3, p_months_back integer DEFAULT 0)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_base date;
  v_i    integer;
  v_name text;
BEGIN
  IF p_months_ahead IS NULL OR p_months_ahead < 0 OR p_months_ahead > 60
     OR p_months_back IS NULL OR p_months_back < 0 OR p_months_back > 60 THEN
    RAISE EXCEPTION 'audit.ensure_partitions : bornes 0..60 mois (ahead=%, back=%)', p_months_ahead, p_months_back;
  END IF;
  v_base := pg_catalog.date_trunc('month', pg_catalog.timezone('UTC', pg_catalog.now()))::date;
  FOR v_i IN -p_months_back .. p_months_ahead LOOP
    v_name := audit.create_partition((v_base + pg_catalog.make_interval(months => v_i))::date);
    IF v_name IS NOT NULL THEN
      RETURN NEXT v_name;
    END IF;
  END LOOP;
END
$$;

-- Garantit la partition d'un instant donné (repli de audit.record pour un mois non anticipé).
-- Bornée : [maintenant - 10 ans, maintenant + 5 ans].
CREATE OR REPLACE FUNCTION audit.ensure_partition_for(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_ts IS NULL OR p_ts < pg_catalog.now() - INTERVAL '10 years' OR p_ts > pg_catalog.now() + INTERVAL '5 years' THEN
    RAISE EXCEPTION 'audit.ensure_partition_for : instant hors plage (%)', p_ts;
  END IF;
  -- Chemin rapide SANS verrou : l'immense majorité des appels trouvent la partition.
  IF pg_catalog.to_regclass(pg_catalog.format('audit.%I',
       'audit_log_y' || pg_catalog.to_char(pg_catalog.timezone('UTC', p_ts), 'YYYY')
       || 'm' || pg_catalog.to_char(pg_catalog.timezone('UTC', p_ts), 'MM'))) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  RETURN audit.create_partition(pg_catalog.timezone('UTC', p_ts)::date);
END
$$;

REVOKE ALL ON FUNCTION audit.ensure_partitions(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.ensure_partition_for(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer, integer) TO app_user;
GRANT EXECUTE ON FUNCTION audit.ensure_partition_for(timestamptz) TO app_user;

-- Partitions initiales : mois précédent + mois courant + 12 mois à venir.
SELECT audit.ensure_partitions(12, 1);

-- -----------------------------------------------------------------------------
-- Journal de PLATEFORME (événements sans tenant : échecs de connexion inconnus, etc.)
-- -----------------------------------------------------------------------------
-- Table GLOBALE, volontairement hors RLS (aucune colonne tenant_id) : à déclarer dans
-- l'allowlist d'isolation (apps/api/src/modules/isolation-allowlist.audit.ts). Elle n'est
-- écrite et lue que via SystemDb, jamais par une route de tenant.
CREATE TABLE audit.platform_audit_log (
  id              uuid        PRIMARY KEY,
  seq             bigint      NOT NULL UNIQUE CHECK (seq >= 1),
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      text        NOT NULL
                  CHECK (actor_type IN ('user', 'system', 'superAdmin', 'impersonation')),
  actor_id        uuid,
  impersonated_by uuid,
  action          text        NOT NULL
                  CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length(action) <= 100),
  entity          text        NOT NULL
                  CHECK (entity ~ '^[a-z][a-z0-9_]*$' AND length(entity) <= 100),
  entity_id       text        CHECK (length(entity_id) <= 200),
  before          jsonb,
  after           jsonb,
  diff            jsonb,
  metadata        jsonb,
  ip              text        CHECK (length(ip) <= 64),
  user_agent      text        CHECK (length(user_agent) <= 512),
  device          text        CHECK (length(device) <= 200),
  request_id      text        CHECK (length(request_id) <= 200),
  reason          text        CHECK (length(reason) <= 1000),
  severity        text        NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'notice', 'warning', 'critical')),
  hash_alg        text        NOT NULL CHECK (hash_alg IN ('sha256', 'hmac-sha256')),
  key_id          text        CHECK (length(key_id) <= 64),
  prev_hash       text        NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash            text        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT platform_audit_log_actor_chk CHECK (actor_type = 'system' OR actor_id IS NOT NULL),
  CONSTRAINT platform_audit_log_impersonation_chk CHECK (actor_type <> 'impersonation' OR impersonated_by IS NOT NULL),
  CONSTRAINT platform_audit_log_key_chk CHECK ((hash_alg = 'hmac-sha256') = (key_id IS NOT NULL))
);
CREATE INDEX platform_audit_log_time_idx ON audit.platform_audit_log (occurred_at);

CREATE TABLE audit.platform_chain_head (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_seq   bigint NOT NULL CHECK (last_seq >= 1),
  last_hash  text NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit.platform_head_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'Tête de chaîne d''audit plateforme : seule une avance de +1 est permise (% -> %).', OLD.last_seq, NEW.last_seq
      USING ERRCODE = 'AU003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER platform_head_monotonic BEFORE UPDATE ON audit.platform_chain_head
  FOR EACH ROW EXECUTE FUNCTION audit.platform_head_guard();
CREATE TRIGGER platform_head_no_delete BEFORE DELETE ON audit.platform_chain_head
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER platform_head_no_truncate BEFORE TRUNCATE ON audit.platform_chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

CREATE OR REPLACE FUNCTION audit.platform_chain_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq  bigint;
  v_hash text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ed:audit:chain:platform', 0));
  SELECT h.last_seq, h.last_hash INTO v_seq, v_hash FROM audit.platform_chain_head h;
  IF NOT FOUND THEN
    v_seq := 0;
    v_hash := pg_catalog.repeat('0', 64);
  END IF;
  IF NEW.seq <> v_seq + 1 OR NEW.prev_hash <> v_hash THEN
    RAISE EXCEPTION 'Chaîne d''audit plateforme rompue : attendu seq=% (reçu %).', v_seq + 1, NEW.seq
      USING ERRCODE = 'AU002';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION audit.platform_chain_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO audit.platform_chain_head AS h (singleton, last_seq, last_hash, updated_at)
  VALUES (true, NEW.seq, NEW.hash, pg_catalog.now())
  ON CONFLICT (singleton) DO UPDATE
    SET last_seq = EXCLUDED.last_seq, last_hash = EXCLUDED.last_hash, updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION audit.platform_chain_advance() FROM PUBLIC;

CREATE TRIGGER a_chain_guard   BEFORE INSERT ON audit.platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.platform_chain_guard();
CREATE TRIGGER b_chain_advance AFTER INSERT ON audit.platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.platform_chain_advance();
CREATE TRIGGER no_mutation     BEFORE UPDATE OR DELETE ON audit.platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER no_truncate     BEFORE TRUNCATE ON audit.platform_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

REVOKE ALL ON audit.platform_audit_log, audit.platform_chain_head FROM PUBLIC;
GRANT SELECT, INSERT ON audit.platform_audit_log TO app_user;
GRANT SELECT ON audit.platform_chain_head TO app_user;
