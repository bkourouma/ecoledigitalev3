import { defineModule } from "@ecoledigitale/kernel";

/**
 * Module `rbac` — rôles par tenant, assignations avec périmètre, évaluation des
 * permissions, navigation dérivée. Socle CORE : toujours actif.
 *
 * `dependsOn` est volontairement vide : la tenancy est OPTIONNELLE. Les périmètres
 * (établissement, campus) sont référencés par UUID et la hiérarchie arrive par le
 * port `ScopeTree`.
 */
export default defineModule({
  key: "rbac",
  title: "Rôles et permissions",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    {
      key: "rbac.role.read",
      label: "Consulter les rôles, les assignations et le catalogue de permissions",
    },
    {
      key: "rbac.role.manage",
      label: "Créer, modifier et supprimer des rôles personnalisés",
      description: "Définit ce que peut faire un rôle. Ne permet d'accorder que des permissions que l'on détient soi-même.",
      sensitive: true,
    },
    {
      key: "rbac.assignment.manage",
      label: "Attribuer et retirer des rôles aux utilisateurs",
      description: "Ne permet d'attribuer qu'un rôle dont on détient soi-même toutes les permissions sur le périmètre.",
      sensitive: true,
    },
  ],
  features: [],
  menus: [
    {
      key: "rbac.roles",
      label: "Rôles et permissions",
      href: "/admin/roles",
      permission: "rbac.role.read",
      portal: "admin",
      icon: "shield",
      order: 900,
    },
    {
      key: "rbac.assignments",
      label: "Attributions de rôles",
      href: "/admin/roles/attributions",
      permission: "rbac.assignment.manage",
      portal: "admin",
      icon: "user-cog",
      order: 910,
    },
  ],
  events: {
    publishes: ["rbac.role.changed", "rbac.assignment.changed"],
    // rbac.* : cache de permissions (invalidation) de chaque instance de l'API.
    // tenancy.* : rôles système à l'activation d'un tenant, rattrapage à la réactivation, invalidation du cache (subscribers.ts).
    consumes: ["rbac.role.changed", "rbac.assignment.changed", "tenancy.tenant.provisioned", "tenancy.tenant.status_changed"],
  },
});
