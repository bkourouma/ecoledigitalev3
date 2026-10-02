/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (profils multiples : direction, secrétariat, enseignant, parent, élève) ;
 *  - `capsFor(request, …)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions CONTEXTUELLES.
 * Aucun rôle codé en dur. Une capacité refusée pour une autre raison qu'un `ForbiddenError` (401, 500) remonte telle quelle.
 * Les capacités sont lues SÉQUENTIELLEMENT (pas de `Promise.all` sur une même requête).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../application/deps";

export const PERMISSIONS = {
  read: "council.read",
  manage: "council.manage",
  prepare: "council.prepare",
  sessionRun: "council.session.run",
  proposalWrite: "council.proposal.write",
  decisionRecord: "council.decision.record",
  minutesGenerate: "council.minutes.generate",
  minutesRead: "council.minutes.read",
  minutesSign: "council.minutes.sign",
  minutesRevoke: "council.minutes.revoke",
  unlockRequest: "council.unlock.request",
  unlockApprove: "council.unlock.approve",
  effectManage: "council.effect.manage",
  exclusionApply: "council.exclusion.apply",
  settingsManage: "council.settings.manage",
  orientationRead: "council.orientation.read",
  orientationManage: "council.orientation.manage",
  orientationOverride: "council.orientation.override",
  selfRead: "council.self.read",
  childRead: "council.child.read",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

/** Capacité -> permission (le contenu de `CallerCaps` est dérivé de cette table, jamais d'un rôle). */
const CAP_PERMISSIONS: Readonly<Record<keyof CallerCaps, string>> = Object.freeze({
  read: PERMISSIONS.read,
  manage: PERMISSIONS.manage,
  prepare: PERMISSIONS.prepare,
  sessionRun: PERMISSIONS.sessionRun,
  proposalWrite: PERMISSIONS.proposalWrite,
  decisionRecord: PERMISSIONS.decisionRecord,
  minutesGenerate: PERMISSIONS.minutesGenerate,
  minutesRead: PERMISSIONS.minutesRead,
  minutesSign: PERMISSIONS.minutesSign,
  minutesRevoke: PERMISSIONS.minutesRevoke,
  unlockRequest: PERMISSIONS.unlockRequest,
  unlockApprove: PERMISSIONS.unlockApprove,
  effectManage: PERMISSIONS.effectManage,
  exclusionApply: PERMISSIONS.exclusionApply,
  settingsManage: PERMISSIONS.settingsManage,
  orientationRead: PERMISSIONS.orientationRead,
  orientationManage: PERMISSIONS.orientationManage,
  orientationOverride: PERMISSIONS.orientationOverride,
  selfRead: PERMISSIONS.selfRead,
  childRead: PERMISSIONS.childRead,
});

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<CallerCaps>;
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
    async capsFor(app, request, reply) {
      const flags: Record<string, boolean> = {};
      for (const [cap, permission] of Object.entries(CAP_PERMISSIONS)) if (await kit.has(app, request, reply, permission)) flags[cap] = true;
      return flags as CallerCaps;
    },
  };
  return kit;
}
