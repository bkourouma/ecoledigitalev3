-- =============================================================================
-- 1000 — Module rules : schéma, extension, réglages de plateforme
-- =============================================================================
--
-- Plage de numéros réservée au module rules : 1000–1099 (les numéros de migration
-- sont GLOBAUX à tous les modules : voir packages/database, loader.ts).
--
-- Règles (docs/architecture/module-conventions.md) :
--   - un module = un schéma (`rules`) ; seule FK externe : `kernel.tenants(id)` ;
--   - toute table de TENANT : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`
--     + `kernel.enable_tenant_rls()` + GRANT explicite à `app_user` ;
--   - le CATALOGUE NATIONAL (réglementaire, identique pour tous les tenants) vit dans des tables
--     GLOBALES sans `tenant_id`, lisibles par tous, écrites uniquement par l'acteur `system`
--     (même patron que `rbac.permissions`) ; elles sont déclarées dans
--     `isolation-allowlist.rules.ts` avec leur justification.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

-- Contraintes d'exclusion sur plages de dates (deux versions actives d'un même jeu ne se chevauchent jamais).
-- Extension « trusted » (PostgreSQL ≥ 13) : installable par un rôle qui a CREATE sur la base.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS rules;

REVOKE ALL ON SCHEMA rules FROM PUBLIC;
GRANT USAGE ON SCHEMA rules TO app_user;

-- -----------------------------------------------------------------------------
-- Réglages de plateforme (globaux). Clés :
--   decision_impact_confirm_percent  seuil (en %) de décisions modifiées au-delà duquel la proposition exige
--                                    une confirmation explicite de l'administrateur (AC2.5), défaut 5 ;
--   national_four_eyes               l'auteur d'une version nationale ne peut pas l'approuver (AC3.4), défaut true ;
--   replay_sample_percent            part des résultats FINAL rejoués chaque nuit, défaut 1.
-- -----------------------------------------------------------------------------
CREATE TABLE rules.platform_settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  value      jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rules.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.platform_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_settings_read ON rules.platform_settings
  FOR SELECT USING (true);
CREATE POLICY platform_settings_system_insert ON rules.platform_settings
  FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY platform_settings_system_update ON rules.platform_settings
  FOR UPDATE USING (kernel.current_actor() = 'system')
  WITH CHECK (kernel.current_actor() = 'system');

GRANT SELECT, INSERT, UPDATE ON rules.platform_settings TO app_user;

-- Valeurs par défaut : la RLS FORCE s'applique aussi au propriétaire, d'où l'acteur `system` posé pour la transaction.
SELECT set_config('app.actor', 'system', true);
INSERT INTO rules.platform_settings (key, value) VALUES
  ('decision_impact_confirm_percent', '5'::jsonb),
  ('national_four_eyes', 'true'::jsonb),
  ('replay_sample_percent', '1'::jsonb);
