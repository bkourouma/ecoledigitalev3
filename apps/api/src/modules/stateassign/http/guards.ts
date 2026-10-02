/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 * `anyOf(a, b…)` (au moins une permission) et `has` (sonde sans refus, pour les droits de lecture de la GED).
 * Aucun rôle codé en dur. Une garde refusée pour une autre raison qu'un `ForbiddenError` (401, 500) remonte telle quelle.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";

export const PERMISSIONS = {
  read: "stateassign.read",
  record: "stateassign.record",
  verify: "stateassign.verify",
  manage: "stateassign.manage",
  amend: "stateassign.amend",
  reconcile: "stateassign.reconcile",
  receivableManage: "stateassign.receivable.manage",
  controlPerform: "stateassign.control.perform",
  documentManage: "stateassign.document.manage",
  export: "stateassign.export",
  settingsManage: "stateassign.settings.manage",
  childRead: "stateassign.child.read",
} as const;

export const FEATURES = { core: "stateassign.core", gateway: "stateassign.gateway" } as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
}

export function createPermissionKit(guard: Guard): PermissionKit {
  return {
    require: (permission) => guard(permission),
    anyOf(...permissions) {
      const guards = permissions.map((p) => guard(p));
      return async function anyOfGuard(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
        let last: unknown;
        for (const g of guards) {
          try {
            await g.call(this, request, reply);
            return;
          } catch (e) {
            if (!(e instanceof ForbiddenError)) throw e;
            last = e;
          }
        }
        throw last ?? new ForbiddenError("Action non autorisée.");
      };
    },
    async has(app, request, reply, permission) {
      try {
        await guard(permission).call(app, request, reply);
        return true;
      } catch (e) {
        if (e instanceof ForbiddenError) return false;
        throw e;
      }
    },
  };
}
