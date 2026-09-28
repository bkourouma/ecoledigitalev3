-- 0126 — Quatre entrées du menu administrateur deviennent administrables.
--
-- LE DÉFAUT CORRIGÉ
--
-- `canSeeHref` (apps/web/src/lib/hooks/use-admin-roles.ts) rend TOUJOURS une
-- entrée dont le `href` n'est pas dans `ADMIN_MENU_CATALOG` :
--
--     const key = MENU_KEY_BY_HREF_BY_SCOPE[scope][href];
--     if (!key) return true;
--
-- Quatre entrées de la barre administrateur n'y figuraient pas — « Classes »
-- (/academic/classes, apparue avec l'extraction des filières en 0116) et les
-- trois écrans de la rémunération professionnelle (feature 031). Elles étaient
-- donc visibles par tout rôle administrateur, sans aucun moyen de les retirer :
-- la page « Accès → Menus par rôle » promettait un contrôle qu'elle n'exerçait
-- pas sur elles.
--
-- POURQUOI CETTE MIGRATION EXISTE
--
-- Déclarer ces clés dans le catalogue ne suffit pas : elle les fait basculer de
-- « toujours visible » à « visible si accordée ». Un rôle déjà configuré — il y
-- en a un sur cette base, « Admin », avec 30 entrées — PERDRAIT du jour au
-- lendemain quatre écrans qu'il voit aujourd'hui. La correction d'un défaut de
-- contrôle d'accès ne doit retirer l'accès de personne.
--
-- La règle appliquée est donc l'état actuel, écrit noir sur blanc : tout rôle
-- DÉJÀ configuré reçoit les quatre clés. Un rôle sans aucune ligne n'est pas
-- touché — il est en `allowAll`, il voit déjà tout, et lui insérer des lignes
-- le ferait basculer en liste blanche, ce qui lui retirerait tout le reste.

BEGIN;

INSERT INTO admin_role_menus (id, tenant_id, admin_role_id, menu_key, created_at)
SELECT gen_random_uuid(), ar.tenant_id, ar.id, k.menu_key, now()
  FROM admin_roles ar
  CROSS JOIN (VALUES
      ('academic.classes'),
      ('payroll.seances'),
      ('payroll.bulletins'),
      ('payroll.historique')
  ) AS k(menu_key)
 WHERE EXISTS (
         -- « Déjà configuré » : au moins une ligne. C'est exactement la
         -- condition qui distingue, côté web, `allowAll` d'une liste blanche.
         SELECT 1 FROM admin_role_menus m WHERE m.admin_role_id = ar.id
       )
ON CONFLICT (admin_role_id, menu_key) DO NOTHING;

COMMIT;

-- Contrôle attendu après application (base de développement) :
--   SELECT COUNT(*) FROM admin_role_menus;  -- 30 avant, 34 après
