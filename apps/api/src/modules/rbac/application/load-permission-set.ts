/**
 * Chargement du `PermissionSet` d'un utilisateur.
 *
 *   loadPermissionSet(tx, tenantId, userId, { cache?, now? })
 *
 * lit les assignations non expirées de l'utilisateur et les permissions ACTIVES
 * de leurs rôles (une requête), et précalcule le `PermissionSet`. Avec `cache`, le
 * résultat est partagé (TTL court, invalidable par événement).
 *
 * `PermissionSetService` ouvre la transaction seulement en cas de défaut de cache.
 */
import type { TenantDb, Tx } from "@ecoledigitale/database";
import { systemClock, type Clock, type RequestContext } from "@ecoledigitale/kernel";
import {
  buildPermissionSet,
  emptyPermissionSet,
  type AssignmentRecord,
  type PermissionSet,
} from "../domain/permission-set";
import { scopeFromParts } from "../domain/scope";
import { selectGrants } from "../infrastructure/repository";
import type { PermissionSetCache } from "./permission-cache";

export interface LoadPermissionSetOptions {
  cache?: PermissionSetCache;
  now?: Date;
}

export async function loadPermissionSet(
  tx: Tx,
  tenantId: string,
  userId: string,
  options: LoadPermissionSetOptions = {},
): Promise<PermissionSet> {
  const load = async (): Promise<PermissionSet> => {
    const now = options.now ?? new Date();
    const rows = await selectGrants(tx, tenantId.toLowerCase(), userId.toLowerCase(), now);
    if (rows.length === 0) return emptyPermissionSet(tenantId, userId, now);

    const assignments = new Map<string, AssignmentRecord>();
    const rolePermissions = new Map<string, string[]>();
    const rolesSeen = new Set<string>();
    const sensitive = new Set<string>();
    for (const row of rows) {
      if (!assignments.has(row.assignmentId)) {
        assignments.set(row.assignmentId, {
          assignmentId: row.assignmentId,
          roleId: row.roleId,
          scope: scopeFromParts(row.scopeType, row.scopeId),
          validFrom: row.validFrom,
          validUntil: row.validUntil,
        });
      }
      // Une ligne par (assignation, permission) : on ne remplit les permissions d'un rôle qu'une fois par clé.
      let perms = rolePermissions.get(row.roleId);
      if (!perms) {
        perms = [];
        rolePermissions.set(row.roleId, perms);
      }
      const marker = `${row.roleId}|${row.permissionKey}`;
      if (!rolesSeen.has(marker)) {
        rolesSeen.add(marker);
        perms.push(row.permissionKey);
      }
      if (row.sensitive) sensitive.add(row.permissionKey);
    }
    return buildPermissionSet({
      tenantId,
      userId,
      assignments: [...assignments.values()],
      rolePermissions,
      sensitive,
      now,
    });
  };
  return options.cache ? options.cache.getOrLoad(tenantId, userId, load) : load();
}

export interface PermissionSetServiceOptions {
  tenantDb: TenantDb;
  cache: PermissionSetCache;
  clock?: Clock;
}

/** Fournit le `PermissionSet` d'une requête : cache d'abord, sinon transaction en lecture seule. */
export class PermissionSetService {
  private readonly tenantDb: TenantDb;
  readonly cache: PermissionSetCache;
  private readonly clock: Clock;

  constructor(options: PermissionSetServiceOptions) {
    this.tenantDb = options.tenantDb;
    this.cache = options.cache;
    this.clock = options.clock ?? systemClock;
  }

  async get(ctx: RequestContext): Promise<PermissionSet> {
    const now = this.clock.now();
    if (ctx.userId === null) {
      // Acteur système : aucun utilisateur, donc aucun droit via RBAC (refus par défaut).
      return emptyPermissionSet(ctx.tenantId, "00000000-0000-0000-0000-000000000000", now);
    }
    const userId = ctx.userId;
    return this.cache.getOrLoad(ctx.tenantId, userId, () =>
      this.tenantDb.run(ctx, (tx) => loadPermissionSet(tx, ctx.tenantId, userId, { now }), { readOnly: true }),
    );
  }
}
