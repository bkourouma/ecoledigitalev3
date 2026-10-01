/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (gestion, élève ou tuteur pour un téléchargement) ;
 *  - `has(…)` : l'appelant détient-il la permission ? (décisions CONTEXTUELLES : gestion ou famille).
 * Aucun rôle codé en dur. Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`)
 * remonte telle quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";

export const PERMISSIONS = {
  read: "reportcard.read",
  explain: "reportcard.explain",
  generate: "reportcard.generate",
  publish: "reportcard.publish",
  revoke: "reportcard.revoke",
  templateManage: "reportcard.template.manage",
  brandingManage: "reportcard.branding.manage",
  signatoryManage: "reportcard.signatory.manage",
  selfRead: "reportcard.self.read",
  childRead: "reportcard.child.read",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
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
