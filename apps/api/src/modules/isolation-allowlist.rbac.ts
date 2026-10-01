/**
 * Tables GLOBALES du module `rbac` (hors RLS « tenant »), à joindre à la liste
 * blanche du test d'isolation (`assertTenantIsolation({ allowlist })`) avec la
 * justification de chaque entrée (ADR-002 §5).
 *
 * Toutes les autres tables du schéma `rbac` (`roles`, `role_permissions`,
 * `role_pending_permissions`, `user_role_assignments`) portent `tenant_id` et la
 * policy `tenant_isolation` : elles NE doivent PAS figurer ici.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

export const rbacIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([
  Object.freeze({
    table: "rbac.permissions",
    justification:
      "Catalogue de permissions GLOBAL : reflet des manifestes de modules, identique pour tous les tenants, sans donnée de tenant. " +
      "Lisible par tous ; écriture réservée à l'acteur `system` par des policies RLS dédiées (synchro au démarrage).",
  }),
]);

/** Noms qualifiés (`schema.table`), au format attendu par `assertTenantIsolation`. */
export const rbacIsolationAllowlistTables: readonly string[] = Object.freeze(
  rbacIsolationAllowlist.map((e) => e.table),
);

export default rbacIsolationAllowlist;
