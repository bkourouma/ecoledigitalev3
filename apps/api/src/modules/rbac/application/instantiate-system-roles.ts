/**
 * Instanciation des rôles système d'un tenant (provisioning) et re-résolution
 * des modèles après une synchronisation du catalogue.
 *
 * `instantiateSystemRoles(tx, tenantId)` est IDEMPOTENT : la rejouer ne crée rien
 * de plus, et ne modifie que ce qui diffère (nouvelles permissions du catalogue qui
 * correspondent aux motifs, motifs devenus résolvables, libellés de modèle).
 *
 * Motifs sans correspondance dans le catalogue (module pas encore déployé) :
 * stockés dans `rbac.role_pending_permissions`, signalés dans les logs, et
 * re-résolus à la prochaine exécution — jamais perdus. Deux niveaux de signalement :
 *   - clé figurant dans la liste blanche `RESERVED_FOR_UPCOMING_MODULES` (module à venir, attendu) :
 *     `info`, aucun échec ;
 *   - tout autre motif (faute de frappe, permission renommée) : `warn` (et les tests échouent).
 */
import { PgOutboxWriter, type SystemDb, type Tx } from "@ecoledigitale/database";
import {
  consoleLogger,
  createDomainEvent,
  createSystemContext,
  newId,
  systemClock,
  type Clock,
  type Logger,
  type ModuleManifest,
} from "@ecoledigitale/kernel";
import { RBAC_ROLE_CHANGED, type RoleChangedPayload } from "../domain/events";
import type { PermissionCatalog } from "../domain/permission-catalog";
import { uniqueRoleKey } from "../domain/role-rules";
import { resolveSystemRoles } from "../domain/system-roles";
import {
  findCustomRoleWithKey,
  findRoleByTemplate,
  insertRole,
  listRoleKeys,
  relocateCustomRoleKey,
  replacePending,
  replaceRolePermissions,
  updateRoleFields,
} from "../infrastructure/repository";
import { isReservedPermission } from "../templates/reserved-permissions";
import { SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "../templates/system-roles";
import { loadPermissionCatalog, syncPermissionCatalog, type SyncCatalogReport } from "./catalog";
import type { PermissionSetCache } from "./permission-cache";

export interface InstantiateOptions {
  logger?: Logger;
  clock?: Clock;
  /** Catalogue à utiliser ; défaut : celui de la table `rbac.permissions`. */
  catalog?: PermissionCatalog;
  /** Modèles ; défaut : `SYSTEM_ROLE_TEMPLATES`. */
  templates?: readonly SystemRoleTemplate[];
  /** Publier `rbac.role.changed` pour les rôles EXISTANTS dont le contenu change (défaut : oui). */
  publishEvents?: boolean;
}

export interface InstantiateReport {
  /** Clés des rôles créés lors de cet appel. */
  readonly created: readonly string[];
  /** Clés des rôles déjà présents. */
  readonly existing: readonly string[];
  /** Rôles existants dont les permissions ont changé. */
  readonly changed: readonly string[];
  readonly permissionsAdded: number;
  readonly permissionsRemoved: number;
  /** Motifs en attente, par clé de rôle (seulement les rôles concernés). */
  readonly pendingByRole: Readonly<Record<string, readonly string[]>>;
  /** Rôles personnalisés dont la clé a été libérée pour un modèle système (ancienne → nouvelle). */
  readonly relocated: ReadonlyArray<{ from: string; to: string }>;
}

export async function instantiateSystemRoles(
  tx: Tx,
  tenantId: string,
  options: InstantiateOptions = {},
): Promise<InstantiateReport> {
  const logger = options.logger ?? consoleLogger;
  const clock = options.clock ?? systemClock;
  const templates = options.templates ?? SYSTEM_ROLE_TEMPLATES;
  const tid = tenantId.toLowerCase();
  const now = clock.now();

  // Sérialise les instanciations concurrentes d'un même tenant (provisioning vs synchro de démarrage).
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rbac.instantiate:${tid}`]);

  const catalog = options.catalog ?? (await loadPermissionCatalog(tx));
  const resolved = resolveSystemRoles(catalog, templates);

  const created: string[] = [];
  const existing: string[] = [];
  const changed: string[] = [];
  const relocated: Array<{ from: string; to: string }> = [];
  const pendingByRole: Record<string, readonly string[]> = {};
  const events: RoleChangedPayload[] = [];
  const eventRoleIds: string[] = [];
  let permissionsAdded = 0;
  let permissionsRemoved = 0;

  for (const r of resolved) {
    const { template } = r;
    let role = await findRoleByTemplate(tx, tid, template.key);
    const isNew = role === null;

    if (!role) {
      // Un rôle personnalisé occupe-t-il déjà la clé réservée ? On le déplace, on ne l'écrase pas.
      const clash = await findCustomRoleWithKey(tx, tid, template.key);
      if (clash) {
        const taken = new Set(await listRoleKeys(tx, tid));
        const to = uniqueRoleKey(`${template.key}_custom`, taken);
        await relocateCustomRoleKey(tx, tid, clash.id, to, now);
        relocated.push({ from: template.key, to });
        logger.warn(
          { tenantId: tid, roleId: clash.id, from: template.key, to },
          "rbac : clé réservée par un modèle système, rôle personnalisé renommé",
        );
      }
      role = await insertRole(tx, {
        id: newId(now.getTime()),
        tenantId: tid,
        key: template.key,
        label: template.label,
        description: template.description,
        isSystem: true,
        templateKey: template.key,
        clonedFromRoleId: null,
        createdBy: null,
        now,
      });
      created.push(template.key);
    } else {
      existing.push(template.key);
      if (role.label !== template.label || (role.description ?? null) !== template.description) {
        await updateRoleFields(tx, tid, role.id, { label: template.label, description: template.description }, now);
      }
    }

    const diff = await replaceRolePermissions(tx, tid, role.id, r.permissions);
    permissionsAdded += diff.added.length;
    permissionsRemoved += diff.removed.length;
    await replacePending(tx, tid, role.id, r.pending);
    if (r.pending.length > 0) pendingByRole[template.key] = r.pending;

    if (!isNew && (diff.added.length > 0 || diff.removed.length > 0)) {
      changed.push(template.key);
      events.push({
        v: 1,
        change: "resynced",
        roleId: role.id,
        roleKey: role.key,
        isSystem: true,
        label: template.label,
        addedPermissions: diff.added,
        removedPermissions: diff.removed,
      });
      eventRoleIds.push(role.id);
    }
  }

  if (Object.keys(pendingByRole).length > 0) {
    const unexpectedByRole: Record<string, readonly string[]> = {};
    const reservedByRole: Record<string, readonly string[]> = {};
    for (const [roleKey, patterns] of Object.entries(pendingByRole)) {
      const unexpected = patterns.filter((p) => !isReservedPermission(p));
      const reserved = patterns.filter((p) => isReservedPermission(p));
      if (unexpected.length > 0) unexpectedByRole[roleKey] = unexpected;
      if (reserved.length > 0) reservedByRole[roleKey] = reserved;
    }
    if (Object.keys(unexpectedByRole).length > 0) {
      logger.warn(
        {
          tenantId: tid,
          pendingByRole: unexpectedByRole,
          pendingCount: Object.values(unexpectedByRole).reduce((n, p) => n + p.length, 0),
        },
        "rbac : permissions de modèles système en attente (aucune permission du catalogue ne correspond encore) ; re-résolues à la prochaine synchro",
      );
    }
    if (Object.keys(reservedByRole).length > 0) {
      logger.info(
        {
          tenantId: tid,
          reservedByRole,
          reservedCount: Object.values(reservedByRole).reduce((n, p) => n + p.length, 0),
        },
        "rbac : permissions réservées à des modules pas encore livrés (liste blanche RESERVED_FOR_UPCOMING_MODULES) ; résolues à la livraison du module",
      );
    }
  }

  if (events.length > 0 && options.publishEvents !== false) {
    const ctx = createSystemContext(tid);
    await new PgOutboxWriter(tx).append(
      events.map((payload, i) =>
        createDomainEvent({
          type: RBAC_ROLE_CHANGED,
          payload,
          ctx,
          clock,
          aggregateType: "role",
          aggregateId: eventRoleIds[i] as string,
        }),
      ),
    );
  }

  return Object.freeze({
    created: Object.freeze(created),
    existing: Object.freeze(existing),
    changed: Object.freeze(changed),
    permissionsAdded,
    permissionsRemoved,
    pendingByRole: Object.freeze(pendingByRole),
    relocated: Object.freeze(relocated),
  });
}

export interface SyncRbacOptions {
  logger?: Logger;
  clock?: Clock;
  /** Re-résout les rôles système de tous les tenants même si le catalogue n'a pas changé. */
  force?: boolean;
  /** Cache à vider après la re-résolution (instance locale). */
  cache?: PermissionSetCache;
}

export interface SyncRbacReport {
  readonly catalog: SyncCatalogReport;
  /** Vrai si les rôles système ont été re-résolus pour tous les tenants. */
  readonly reconciled: boolean;
  readonly tenants: { readonly succeeded: number; readonly failed: ReadonlyArray<{ tenantId: string; error: unknown }> };
}

/**
 * À appeler au démarrage de l'API : synchronise le catalogue puis, s'il a changé
 * (ou si `force`), re-résout les rôles système de chaque tenant actif (une
 * transaction par tenant : l'échec de l'un n'affecte pas les autres).
 */
export async function syncRbac(
  systemDb: SystemDb,
  manifests: readonly ModuleManifest[],
  options: SyncRbacOptions = {},
): Promise<SyncRbacReport> {
  const logger = options.logger ?? consoleLogger;
  const catalog = await systemDb.run("rbac-sync-catalog", (tx) => syncPermissionCatalog(tx, manifests));
  if (catalog.changed) {
    logger.info(
      { inserted: catalog.inserted.length, updated: catalog.updated.length, retired: catalog.retired.length },
      "rbac : catalogue de permissions synchronisé",
    );
  }
  if (!catalog.changed && !options.force) {
    return { catalog, reconciled: false, tenants: { succeeded: 0, failed: [] } };
  }
  const report = await systemDb.forEachTenant("rbac-reconcile-roles", (tx, tenant) =>
    instantiateSystemRoles(tx, tenant.id, {
      logger,
      ...(options.clock ? { clock: options.clock } : {}),
    }),
  );
  for (const f of report.failed) {
    logger.error({ tenantId: f.tenantId, err: f.error }, "rbac : échec de la re-résolution des rôles système");
  }
  options.cache?.clear();
  return {
    catalog,
    reconciled: true,
    tenants: {
      succeeded: report.succeeded.length,
      failed: report.failed.map((f) => ({ tenantId: f.tenantId, error: f.error })),
    },
  };
}
