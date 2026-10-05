/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (staff habilité, étudiant, tuteur) ;
 *  - `has(request, permission)` : `true` si l'appelant détient la permission (jamais d'erreur 403) — sert aux décisions
 *    CONTEXTUELLES (octroi forcé, accès à un étudiant précis). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle quelle :
 * échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../application/deps";

export const PERMISSIONS = {
  diplomaRead: "higher.diploma.read",
  diplomaManage: "higher.diploma.manage",
  awardRead: "higher.award.read",
  awardCreate: "higher.award.create",
  awardForce: "higher.award.force",
  awardRevoke: "higher.award.revoke",
  documentIssue: "higher.document.issue",
  documentRead: "higher.document.read",
  creditsRead: "higher.credits.read",
  prerequisiteManage: "higher.prerequisite.manage",
  resitManage: "higher.resit.manage",
  slotManage: "higher.slot.manage",
  settingsManage: "higher.settings.manage",
  annualUeManage: "higher.annual_ue.manage",
  exemptionRead: "higher.exemption.read",
  exemptionGrant: "higher.exemption.grant",
  selfRead: "higher.self.read",
  childRead: "higher.child.read",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof CallerCaps, string>> = Object.freeze({
  forceAward: PERMISSIONS.awardForce,
  manage: PERMISSIONS.diplomaManage,
});

export interface PermissionKit {
  /** Garde Fastify : exige `permission`. */
  require(permission: string): preHandlerAsyncHookHandler;
  /** Garde Fastify : exige AU MOINS UNE des permissions. */
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  /** `true` si l'appelant détient la permission (jamais d'erreur 403). */
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  /** Capacités demandées de l'appelant (`{ forceAward: true, … }`). */
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof CallerCaps>): Promise<CallerCaps>;
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
      return Object.fromEntries(entries.filter(([, v]) => v)) as CallerCaps;
    },
  };
  return kit;
}
