-- =============================================================================
-- 1403 — Module higher : prérequis entre UE
-- =============================================================================
-- Graphe ACYCLIQUE (R-HIG-11). L'application détecte le cycle avant d'écrire ; ce déclencheur différé en est la
-- défense en profondeur côté base (vérifié à la FIN de la transaction : remplacer toute la liste est légal).
-- La condition « même programme » est vérifiée par l'application (le curriculum est externe) via un port.

CREATE TABLE higher.ue_prerequisites (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  ue_node_id            uuid NOT NULL,                      -- l'UE qui exige
  prerequisite_node_id  uuid NOT NULL,                      -- l'UE exigée
  mode                  text NOT NULL DEFAULT 'VALIDATED' CHECK (mode IN ('VALIDATED', 'ATTENDED', 'MIN_AVERAGE')),
  min_average           numeric(6,3) CHECK (min_average IS NULL OR min_average BETWEEN 0 AND 20),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ue_node_id, prerequisite_node_id),
  CHECK (ue_node_id <> prerequisite_node_id),
  CHECK ((mode = 'MIN_AVERAGE') = (min_average IS NOT NULL))
);
CREATE INDEX ue_prerequisites_target_idx ON higher.ue_prerequisites (tenant_id, prerequisite_node_id);
SELECT kernel.enable_tenant_rls('higher.ue_prerequisites');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.ue_prerequisites TO app_user;

CREATE FUNCTION higher.ue_prerequisites_acyclic() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cycle boolean;
BEGIN
  -- Y a-t-il un chemin prerequisite -> … -> ue ? (parcours borné à 200 niveaux)
  WITH RECURSIVE walk(node, depth) AS (
    SELECT NEW.prerequisite_node_id, 1
    UNION
    SELECT p.prerequisite_node_id, w.depth + 1
      FROM higher.ue_prerequisites p
      JOIN walk w ON p.ue_node_id = w.node AND p.tenant_id = NEW.tenant_id
     WHERE w.depth < 200
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE node = NEW.ue_node_id) INTO v_cycle;
  IF v_cycle THEN
    RAISE EXCEPTION 'higher.prerequisite_cycle: le prérequis crée un cycle entre UE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER ue_prerequisites_acyclic AFTER INSERT OR UPDATE ON higher.ue_prerequisites
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION higher.ue_prerequisites_acyclic();
