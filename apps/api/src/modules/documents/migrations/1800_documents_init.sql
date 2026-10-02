-- =============================================================================
-- 1800 — Module documents : schéma et table d'exemple
-- =============================================================================
-- Plage de numéros réservée au module : 1800-1899 (docs/architecture/module-conventions.md).
-- Un fichier hors de cette plage est refusé en revue ; les versions sont globales à tous les dossiers.
-- Exécutée par le runner de @ecoledigitale/database sous le rôle migrator.
-- Règles :
--   - un module = un schéma du même nom ;
--   - toute table métier : tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
--     puis kernel.enable_tenant_rls(...), puis GRANT ... TO app_user ;
--   - jamais de clé étrangère vers le schéma d'un autre module (seul kernel.tenants est admis) ;
--   - une table globale (sans tenant_id) se déclare dans modules/isolation-allowlist.documents.ts avec sa justification.
-- Un fichier appliqué ne se modifie JAMAIS : corrigez par une nouvelle migration (1801_...).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS documents;
REVOKE ALL ON SCHEMA documents FROM PUBLIC;
GRANT USAGE ON SCHEMA documents TO app_user;

-- Exemple de table de tenant : à remplacer par le vrai modèle du module.
CREATE TABLE documents.items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants(id),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT kernel.enable_tenant_rls('documents.items');

GRANT SELECT, INSERT, UPDATE, DELETE ON documents.items TO app_user;
