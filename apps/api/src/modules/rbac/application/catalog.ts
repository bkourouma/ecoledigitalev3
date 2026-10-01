/**
 * Synchronisation du catalogue de permissions (table globale `rbac.permissions`)
 * avec les manifestes, et lecture du catalogue persistant.
 */
import type { Tx } from "@ecoledigitale/database";
import type { ModuleManifest } from "@ecoledigitale/kernel";
import { InternalError } from "@ecoledigitale/kernel";
import { buildPermissionCatalog, catalogFromEntries, type PermissionCatalog } from "../domain/permission-catalog";
import { selectCatalog, upsertCatalog } from "../infrastructure/repository";

export interface SyncCatalogReport {
  readonly inserted: readonly string[];
  readonly updated: readonly string[];
  /** Permissions absentes des manifestes (marquées retirées, jamais supprimées). */
  readonly retired: readonly string[];
  /** Vrai si le catalogue a changé (les rôles système doivent être re-résolus). */
  readonly changed: boolean;
  readonly total: number;
}

/**
 * Synchronise `rbac.permissions` avec les manifestes. Idempotente. À exécuter par
 * l'acteur `system` (`SystemDb.run`) : la RLS de cette table globale refuse
 * l'écriture à tout autre acteur.
 *
 * Refuse un ensemble vide de permissions : ce serait presque sûrement un défaut
 * d'assemblage (aucun manifeste chargé) qui retirerait tout le catalogue.
 */
export async function syncPermissionCatalog(tx: Tx, manifests: readonly ModuleManifest[]): Promise<SyncCatalogReport> {
  const catalog = buildPermissionCatalog(manifests);
  if (catalog.entries.length === 0) {
    throw new InternalError("syncPermissionCatalog : aucun manifeste ne déclare de permission (assemblage défectueux ?).", {
      code: "rbac.empty_catalog",
    });
  }
  const { inserted, updated, retired } = await upsertCatalog(tx, catalog.entries);
  return Object.freeze({
    inserted: Object.freeze(inserted),
    updated: Object.freeze(updated),
    retired: Object.freeze(retired),
    changed: inserted.length + updated.length + retired.length > 0,
    total: catalog.entries.length,
  });
}

/** Catalogue persistant (permissions non retirées). */
export async function loadPermissionCatalog(tx: Tx): Promise<PermissionCatalog> {
  const rows = await selectCatalog(tx);
  return catalogFromEntries(
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      description: r.description,
      sensitive: r.sensitive,
      moduleKey: r.moduleKey,
    })),
  );
}
