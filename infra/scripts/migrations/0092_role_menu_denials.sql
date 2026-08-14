-- 0092_role_menu_denials.sql
-- Personnalisation des menus par défaut des rôles socle (admin, teacher,
-- student, parent, formateur), par établissement.
--
-- Modèle par EXCLUSION : par défaut un rôle voit tous les menus de son espace
-- (comportement historique). Décocher un menu depuis « Accès → Menus par rôle »
-- insère une ligne ici ; le recocher la supprime. Une table vide = aucun
-- changement par rapport aux menus livrés, ce qui rend la migration sans effet
-- de bord sur les tenants existants.
--
-- Les clés (`menu_key`) proviennent des catalogues définis dans
-- `packages/contracts/src/admin-roles.schema.ts` ; la base ne les contraint pas
-- pour qu'un ajout de menu ne demande pas de migration.
--
-- À distinguer de `admin_role_menus` (0091), qui porte les permissions des rôles
-- administratifs personnalisés : ici on modifie le socle, là on crée un profil.
--
-- Additif et idempotent (patron RLS 0061/0069/0087/0091).

CREATE TABLE IF NOT EXISTS role_menu_denials (
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role_key   VARCHAR(50) NOT NULL,
    menu_key   VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, role_key, menu_key)
);
CREATE INDEX IF NOT EXISTS idx_role_menu_denials_tenant_role
    ON role_menu_denials (tenant_id, role_key);

ALTER TABLE role_menu_denials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY role_menu_denials_tenant_isolation
        ON role_menu_denials
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fin de la migration 0092_role_menu_denials.sql
