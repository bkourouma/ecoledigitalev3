/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `requireAll(…)` : TOUTES les permissions (un importeur exige celles d'`imports` ET celles du module cible) ;
 *  - `has(…)` : décision booléenne (descripteurs, visibilité des imports d'autrui).
 *
 * Une permission refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle
 * quelle : échec fermé. Une permission SENSIBLE (soldes financiers) exige la MFA : le garde du module rbac la vérifie.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";

export const PERMISSIONS = {
  read: "imports.read",
  create: "imports.create",
  cancel: "imports.cancel",
  templateManage: "imports.template.manage",
  manage: "imports.manage",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
  /** Toutes les permissions, dans l'ordre ; la première refusée lève son `ForbiddenError` (détail : `details.permission`). */
  requireAll(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permissions: readonly string[]): Promise<void>;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
}

export function createPermissionKit(guard: Guard): PermissionKit {
  const kit: PermissionKit = {
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
    async requireAll(app, request, reply, permissions) {
      // Séquentiel : les gardes partagent l'autorisation mémorisée de la requête.
      for (const p of [...new Set(permissions)]) await guard(p).call(app, request, reply);
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
  return kit;
}
