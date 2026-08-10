-- 0090_fix_prisma_migrations_tenant.sql
-- Retire la tenantisation appliquée par erreur à `_prisma_migrations`.
--
-- Contexte : `0055_unified_multitenancy.sql` parcourt TOUTES les BASE TABLE du
-- schéma `public` pour y ajouter `tenant_id UUID NOT NULL` + FK + RLS forcée.
-- Sa liste d'exclusion (tenants, roles, token_blacklist, super_admin_*) ne
-- mentionne pas `_prisma_migrations`, la table de journal interne de Prisma.
--
-- Conséquence : `prisma migrate deploy` échoue à la première migration qu'il
-- tente d'enregistrer après 0055, car son INSERT ne renseigne pas `tenant_id`
-- (colonne qu'il ignore) et la policy RLS forcée refuse l'écriture hors
-- contexte tenant :
--     Error: Failing row contains (…, 20260423133000_move_student_admin_fields_
--     to_enrollments, null, null, …, 0, null).
--
-- `_prisma_migrations` est une table d'infrastructure du moteur de migration :
-- elle n'a pas de portée tenant et son schéma est imposé par Prisma. On la
-- restaure donc dans son état d'origine.
--
-- Idempotent (patron 0086/0087/0088/0089).

-- Le bloc est gardé par to_regclass : sur une base neuve `_prisma_migrations`
-- n'existe pas encore (Prisma la crée au premier `migrate deploy`), et le
-- `IF EXISTS` de DROP POLICY ne porte que sur la policy — pas sur la table.
DO $$
BEGIN
    IF to_regclass('public._prisma_migrations') IS NULL THEN
        RETURN;
    END IF;

    -- 1. Désactiver la Row-Level Security posée par 0055.
    EXECUTE 'ALTER TABLE "_prisma_migrations" NO FORCE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON "_prisma_migrations"';

    -- 2. Retirer la clé étrangère, l'index et la colonne.
    --    L'ordre importe : la FK et l'index dépendent de la colonne.
    EXECUTE 'ALTER TABLE "_prisma_migrations" DROP CONSTRAINT IF EXISTS fk__prisma_migrations_tenant_id';
    EXECUTE 'DROP INDEX IF EXISTS idx__prisma_migrations_tenant_id';
    EXECUTE 'ALTER TABLE "_prisma_migrations" DROP COLUMN IF EXISTS tenant_id';
END $$;

-- Fin de la migration 0090_fix_prisma_migrations_tenant.sql
