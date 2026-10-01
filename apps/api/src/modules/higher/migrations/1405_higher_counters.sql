-- =============================================================================
-- 1405 — Module higher : compteurs de numérotation SANS TROU
-- =============================================================================
-- Références `DIP-AAAA-NNNNNN`, `AUTH/AAAA/NNN`, `ATT-AAAA-NNNNNN` attribuées par un compteur TRANSACTIONNEL
-- (R-HIG-07) : jamais `count(*)`. L'UPDATE verrouille la ligne jusqu'au COMMIT (pas de doublon) ; le compteur vit
-- dans la transaction de l'octroi : une annulation ne consomme AUCUN numéro (pas de trou).

CREATE TABLE higher.number_counters (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  counter_key  text NOT NULL CHECK (counter_key IN ('DIPLOMA', 'AUTHENTICITY', 'ATTESTATION')),
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  last_value   bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, counter_key, year)
);
SELECT kernel.enable_tenant_rls('higher.number_counters');
GRANT SELECT, INSERT, UPDATE ON higher.number_counters TO app_user;

-- Seule voie d'accès : higher.next_number(clé, année). SECURITY INVOKER : la RLS du compteur s'applique.
CREATE FUNCTION higher.next_number(p_counter_key text, p_year integer) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_value bigint;
BEGIN
  INSERT INTO higher.number_counters AS c (tenant_id, counter_key, year, last_value)
  VALUES (kernel.current_tenant_id(), p_counter_key, p_year, 1)
  ON CONFLICT (tenant_id, counter_key, year) DO UPDATE SET last_value = c.last_value + 1, updated_at = now()
  RETURNING c.last_value INTO v_value;
  RETURN v_value;
END
$$;
GRANT EXECUTE ON FUNCTION higher.next_number(text, integer) TO app_user;

-- Un compteur ne diminue jamais et n'avance que de 1 ; jamais supprimé.
CREATE FUNCTION higher.number_counters_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: number_counters ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.last_value <> OLD.last_value + 1 OR NEW.tenant_id <> OLD.tenant_id OR NEW.counter_key <> OLD.counter_key OR NEW.year <> OLD.year THEN
    RAISE EXCEPTION 'higher.counter_monotonic: un compteur n''avance que de 1 (% -> %)', OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER number_counters_guard BEFORE UPDATE OR DELETE ON higher.number_counters
  FOR EACH ROW EXECUTE FUNCTION higher.number_counters_guard();
