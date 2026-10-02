-- =============================================================================
-- 2000 — Module zz_gate_13b6ce : schéma et table d'exemple
-- =============================================================================
-- Plage de numéros réservée au module : 2000-2099 (docs/architecture/module-conventions.md).
-- Un fichier hors de cette plage est refusé en revue ; les versions sont globales à tous les dossiers.
-- Exécutée par le runner de @ecoledigitale/database sous le rôle migrator.
-- Règles :
--   - un module = un schéma du même nom ;
--   - toute table métier : tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
--     puis kernel.enable_tenant_rls(...), puis GRANT ... TO app_user ;
--   - jamais de clé étrangère vers le schéma d'un autre module (seul kernel.tenants est admis) ;
--   - une table globale (sans tenant_id) se déclare dans modules/isolation-allowlist.zz_gate_13b6ce.ts avec sa justification.
-- Un fichier appliqué ne se modifie JAMAIS : corrigez par une nouvelle migration (2001_...).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS zz_gate_13b6ce;
REVOKE ALL ON SCHEMA zz_gate_13b6ce FROM PUBLIC;
GRANT USAGE ON SCHEMA zz_gate_13b6ce TO app_user;

-- Exemple de table de tenant : à remplacer par le vrai modèle du module.
CREATE TABLE zz_gate_13b6ce.items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants(id),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT kernel.enable_tenant_rls('zz_gate_13b6ce.items');

GRANT SELECT, INSERT, UPDATE, DELETE ON zz_gate_13b6ce.items TO app_user;
