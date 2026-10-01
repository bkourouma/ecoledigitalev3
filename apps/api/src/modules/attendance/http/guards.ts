/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (ex. parent, élève ou personnel habilité pour déposer un justificatif) ;
 *  - `capsFor(request, clés)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions
 *    CONTEXTUELLES (corriger un appel passé le délai, lire la pièce d'un autre…). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle
 * quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../application/deps";

export const PERMISSIONS = {
  read: "attendance.read",
  take: "attendance.take",
  manage: "attendance.manage",
  validate: "attendance.validate",
  reopen: "attendance.session.reopen",
  justificationSubmit: "attendance.justification.submit",
  justificationRead: "attendance.justification.read",
  justificationDecide: "attendance.justification.decide",
  childJustify: "attendance.child.justify",
  selfJustify: "attendance.self.justify",
  summaryOverride: "attendance.summary.override",
  staffRead: "attendance.staff.read",
  staffRecord: "attendance.staff.record",
  leaveRequest: "attendance.leave.request",
  leaveDecide: "attendance.leave.decide",
  reportRead: "attendance.report.read",
  settingsManage: "attendance.settings.manage",
  selfRead: "attendance.self.read",
  childRead: "attendance.child.read",
  ownRead: "attendance.own.read",
  ownRecord: "attendance.own.record",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof CallerCaps, string>> = Object.freeze({
  manage: PERMISSIONS.manage,
  validate: PERMISSIONS.validate,
  reopen: PERMISSIONS.reopen,
  justificationSubmit: PERMISSIONS.justificationSubmit,
  childJustify: PERMISSIONS.childJustify,
  selfJustify: PERMISSIONS.selfJustify,
  justificationRead: PERMISSIONS.justificationRead,
  justificationDecide: PERMISSIONS.justificationDecide,
  staffRecord: PERMISSIONS.staffRecord,
  staffRead: PERMISSIONS.staffRead,
  ownRecord: PERMISSIONS.ownRecord,
  leaveRequest: PERMISSIONS.leaveRequest,
  leaveDecide: PERMISSIONS.leaveDecide,
  settingsManage: PERMISSIONS.settingsManage,
});

export interface PermissionKit {
  /** Garde Fastify : exige `permission`. */
  require(permission: string): preHandlerAsyncHookHandler;
  /** Garde Fastify : exige AU MOINS UNE des permissions. */
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  /** `true` si l'appelant détient la permission (jamais d'erreur 403 : sert aux décisions contextuelles). */
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  /** Capacités demandées de l'appelant (`{ manage: true, … }`). */
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
