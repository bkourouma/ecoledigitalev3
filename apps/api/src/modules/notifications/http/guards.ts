/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 * `anyOf(a, b…)` (au moins une permission) et `has` (capacité transmise aux cas d'usage). Aucun rôle codé en dur.
 *
 * Les routes « moi » (préférences, appareils push) n'agissent que sur l'appelant : elles exigent l'UNE des trois permissions
 * de portée personnelle (`own` personnel, `child` parent, `self` élève), jamais une permission d'administration.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";

export const PERMISSIONS = {
  read: "notifications.read",
  templatesManage: "notifications.templates.manage",
  rulesManage: "notifications.rules.manage",
  settingsManage: "notifications.settings.manage",
  send: "notifications.send",
  sendUrgent: "notifications.send.urgent",
  consentManage: "notifications.consent.manage",
  ownManage: "notifications.own.manage",
  childManage: "notifications.child.manage",
  selfManage: "notifications.self.manage",
} as const;

/** Gérer SES propres préférences : personnel, parent ou élève. */
export const SELF_SERVICE = [PERMISSIONS.ownManage, PERMISSIONS.childManage, PERMISSIONS.selfManage] as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
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
