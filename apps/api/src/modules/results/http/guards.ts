/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 * `anyOf` (au moins une permission) et `capsFor` (capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs
 * décisions contextuelles). Aucun rôle codé en dur ; échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { ResultsCaps } from "../application/deps";

export const PERMISSIONS = {
  read: "result.read",
  explain: "result.explain",
  recompute: "result.recompute",
  overrideRequest: "result.override.request",
  overrideApprove: "result.override.approve",
  settingsManage: "result.settings.manage",
  lock: "period.lock",
  close: "period.close",
  repin: "period.repin",
  reopen: "period.reopen",
  decisionRecord: "decision.record",
  decisionApprove: "decision.approve",
  appreciationWrite: "appreciation.write",
  selfRead: "result.self.read",
  childRead: "result.child.read",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof ResultsCaps, string>> = Object.freeze({
  recompute: PERMISSIONS.recompute,
  overrideRequest: PERMISSIONS.overrideRequest,
  overrideApprove: PERMISSIONS.overrideApprove,
  lock: PERMISSIONS.lock,
  close: PERMISSIONS.close,
  repin: PERMISSIONS.repin,
  reopen: PERMISSIONS.reopen,
  decisionRecord: PERMISSIONS.decisionRecord,
  decisionApprove: PERMISSIONS.decisionApprove,
  appreciationWrite: PERMISSIONS.appreciationWrite,
  explain: PERMISSIONS.explain,
  read: PERMISSIONS.read,
});

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof ResultsCaps>): Promise<ResultsCaps>;
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
    async capsFor(app, request, reply, keys) {
      const entries = await Promise.all(keys.map(async (k) => [k, await kit.has(app, request, reply, CAP_PERMISSIONS[k])] as const));
      return Object.fromEntries(entries.filter(([, v]) => v)) as ResultsCaps;
    },
  };
  return kit;
}
