-- 0095_retire_admin_menu_keys.sql
-- Réduction du menu administrateur aux deux sections « Structure Académique »
-- et « Module Professionnel ».
--
-- Trois entrées sortent du catalogue (`ADMIN_MENU_CATALOG`,
-- packages/contracts/src/admin-roles.schema.ts) :
--
--   academic.bilan_types   Types de Bilan        /annee-academique/types-de-bilan
--   academic.courses       Matières              /academic/courses
--   people.registrations   Inscriptions en ligne /academic/registrations
--
-- Les pages restent accessibles par URL : seule leur entrée de menu disparaît.
-- Les lignes qui les référencent deviennent orphelines dans les deux tables de
-- permissions et sont supprimées ici :
--
--   admin_role_menus    (0091) permissions des rôles administratifs personnalisés
--   role_menu_denials   (0092) menus retirés aux rôles socle
--
-- La clé `academic.overview` n'est PAS retirée : son href passe de /academic à
-- /tableau-de-bord côté contrats, mais l'identifiant persisté reste le même —
-- les rôles qui l'avaient cochée conservent leur permission.
--
-- Additif et idempotent : ré-exécutable sans effet de bord.

BEGIN;

-- Trace du volume nettoyé, pour relire l'exécution dans les logs de déploiement.
DO $$
DECLARE
    retired  TEXT[] := ARRAY['academic.bilan_types', 'academic.courses', 'people.registrations'];
    n_roles  BIGINT := 0;
    n_denials BIGINT := 0;
    n_empty  BIGINT := 0;
BEGIN
    IF to_regclass('public.admin_role_menus') IS NOT NULL THEN
        DELETE FROM admin_role_menus WHERE menu_key = ANY(retired);
        GET DIAGNOSTICS n_roles = ROW_COUNT;
    END IF;

    IF to_regclass('public.role_menu_denials') IS NOT NULL THEN
        DELETE FROM role_menu_denials WHERE menu_key = ANY(retired);
        GET DIAGNOSTICS n_denials = ROW_COUNT;
    END IF;

    -- Garde-fou : un rôle administratif sans aucun menu ne voit plus rien et son
    -- porteur se retrouve enfermé. On ne corrige pas automatiquement (le choix
    -- appartient à l'établissement), on le signale bruyamment.
    IF to_regclass('public.admin_roles') IS NOT NULL
       AND to_regclass('public.admin_role_menus') IS NOT NULL THEN
        SELECT count(*) INTO n_empty
        FROM admin_roles ar
        WHERE ar.is_active
          AND NOT EXISTS (SELECT 1 FROM admin_role_menus m WHERE m.admin_role_id = ar.id);

        IF n_empty > 0 THEN
            RAISE WARNING
                '[0095] % rôle(s) administratif(s) actif(s) n''ont plus aucun menu autorisé après le nettoyage : leurs utilisateurs verront un menu vide. À rouvrir depuis « Accès → Rôles administratifs ».',
                n_empty;
        END IF;
    END IF;

    RAISE NOTICE '[0095] admin_role_menus: % ligne(s) retirée(s), role_menu_denials: % ligne(s) retirée(s), rôles sans menu: %',
        n_roles, n_denials, n_empty;
END
$$;

COMMIT;
