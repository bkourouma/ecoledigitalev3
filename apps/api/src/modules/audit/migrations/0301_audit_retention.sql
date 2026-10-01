-- =============================================================================
-- 0301 — Module `audit` : politiques de rétention et archivage par partition
-- =============================================================================
--
-- RÈGLES
--   - Rétention par tenant, 60 mois par défaut (absence de ligne = défaut), JAMAIS moins
--     de 12 mois (CHECK ci-dessous ET plancher codé dans audit.detach_expired_partitions).
--   - Aucune suppression ligne à ligne (le journal est append-only) : l'expiration se fait
--     en DÉTACHANT une partition mensuelle entière puis en la déplaçant dans le schéma
--     `audit_archive` (aucun droit applicatif). La suppression physique (DROP TABLE) est
--     une opération d'exploitation, à faire APRÈS export vérifié (pg_dump de la partition).
--   - Les partitions sont partagées par tous les tenants : une partition n'est détachable
--     que lorsque la rétention la plus LONGUE de tous les tenants est échue. Le job
--     applicatif (application/retention.ts) calcule ce maximum et le passe en paramètre.
-- =============================================================================

CREATE TABLE audit.retention_policies (
  tenant_id        uuid PRIMARY KEY REFERENCES kernel.tenants (id) ON DELETE RESTRICT,
  retention_months integer NOT NULL DEFAULT 60
                   CONSTRAINT retention_policies_floor CHECK (retention_months >= 12 AND retention_months <= 600),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

SELECT kernel.enable_tenant_rls('audit.retention_policies');
GRANT SELECT, INSERT, UPDATE ON audit.retention_policies TO app_user;

-- -----------------------------------------------------------------------------
-- Détachement des partitions échues
-- -----------------------------------------------------------------------------
-- p_retention_months : rétention la plus longue parmi les tenants (>= 12, sinon erreur).
-- p_dry_run          : true (défaut) = liste seulement.
-- Une partition est échue quand sa borne SUPÉRIEURE <= début du mois courant (UTC) - rétention.
--
-- DETACH PARTITION (non CONCURRENTLY : impossible dans une fonction) prend un ACCESS
-- EXCLUSIVE sur le parent : lock_timeout court, l'échec est rejouable par le job.
CREATE OR REPLACE FUNCTION audit.detach_expired_partitions(p_retention_months integer, p_dry_run boolean DEFAULT true)
RETURNS TABLE (partition_name text, range_end timestamptz, detached boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz;
  r        record;
BEGIN
  IF p_retention_months IS NULL OR p_retention_months < 12 THEN
    RAISE EXCEPTION 'audit.detach_expired_partitions : rétention minimale de 12 mois (reçu %)', p_retention_months;
  END IF;
  IF p_dry_run IS NULL THEN
    p_dry_run := true;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ed:audit:partitions', 0));
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  v_cutoff := (pg_catalog.date_trunc('month', pg_catalog.timezone('UTC', pg_catalog.now()))
               - pg_catalog.make_interval(months => p_retention_months)) AT TIME ZONE 'UTC';

  FOR r IN
    SELECT c.relname::text AS name,
           ((pg_catalog.to_date(pg_catalog.substr(c.relname::text, 12, 4) || pg_catalog.substr(c.relname::text, 17, 2), 'YYYYMM')
             + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC') AS part_end
      FROM pg_catalog.pg_inherits i
      JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
      JOIN pg_catalog.pg_class p ON p.oid = i.inhparent
      JOIN pg_catalog.pg_namespace n ON n.oid = p.relnamespace
     WHERE n.nspname = 'audit' AND p.relname = 'audit_log'
       AND c.relname ~ '^audit_log_y[0-9]{4}m[0-9]{2}$'
     ORDER BY c.relname
  LOOP
    IF r.part_end <= v_cutoff THEN
      partition_name := r.name;
      range_end := r.part_end;
      detached := false;
      IF NOT p_dry_run THEN
        EXECUTE pg_catalog.format('ALTER TABLE audit.audit_log DETACH PARTITION audit.%I', r.name);
        EXECUTE pg_catalog.format('ALTER TABLE audit.%I SET SCHEMA audit_archive', r.name);
        -- DETACH supprime les triggers de ligne HÉRITÉS du parent (vérifié par test) : la table
        -- archivée serait alors modifiable. On repose explicitement l'interdiction d'UPDATE/DELETE
        -- (le trigger TRUNCATE, posé par partition, est conservé).
        EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS no_mutation ON audit_archive.%I', r.name);
        EXECUTE pg_catalog.format(
          'CREATE TRIGGER no_mutation BEFORE UPDATE OR DELETE ON audit_archive.%I '
          'FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation()', r.name);
        detached := true;
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION audit.detach_expired_partitions(integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.detach_expired_partitions(integer, boolean) TO app_user;
