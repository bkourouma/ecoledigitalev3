/**
 * Catalogue RÉEL de permissions : agrégé depuis les manifestes de TOUS les modules découverts sous
 * `apps/api/src/modules` (même mécanisme que le registre au démarrage, `discoverModules`). Les tests de
 * rôles système s'en servent pour résoudre les modèles contre les vraies permissions, et non contre des
 * modules fictifs : un nouveau module, une permission renommée ou supprimée est vu aussitôt.
 */
import type { ModuleManifest } from "@ecoledigitale/kernel";
import { discoverModules } from "../../registry-discovery";
import { buildPermissionCatalog, type PermissionCatalog } from "../domain/permission-catalog";
import { resolveSystemRoles } from "../domain/system-roles";
import type { SystemRoleTemplate } from "../templates/system-roles";

export interface RealCatalog {
  readonly manifests: readonly ModuleManifest[];
  readonly catalog: PermissionCatalog;
  /** Clés des permissions `sensitive`. */
  readonly sensitive: ReadonlySet<string>;
}

let cached: Promise<RealCatalog> | undefined;

export function loadRealCatalog(): Promise<RealCatalog> {
  cached ??= discoverModules().then((found) => {
    const manifests = found.map((m) => m.manifest as ModuleManifest);
    const catalog = buildPermissionCatalog(manifests);
    return { manifests, catalog, sensitive: new Set(catalog.entries.filter((e) => e.sensitive).map((e) => e.key)) };
  });
  return cached;
}

/** Permissions concrètes de chaque modèle, résolues contre le catalogue réel. */
export function resolveAgainst(
  real: RealCatalog,
  templates: readonly SystemRoleTemplate[],
): ReadonlyMap<string, { readonly permissions: ReadonlySet<string>; readonly pending: readonly string[] }> {
  return new Map(
    resolveSystemRoles(real.catalog, templates).map((r) => [r.template.key, { permissions: new Set(r.permissions), pending: r.pending }]),
  );
}
