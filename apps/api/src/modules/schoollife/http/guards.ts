/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (profils multiples : éducateur, direction, parent, élève) ;
 *  - `capsFor(request, …)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions CONTEXTUELLES
 *    (habilitation de confidentialité, périmètre général, permission d'approbation propre à un TYPE d'événement).
 * Aucun rôle codé en dur. Une capacité refusée pour une autre raison qu'un `ForbiddenError` (401, 500) remonte telle quelle.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../application/deps";

export const PERMISSIONS = {
  read: "schoollife.read",
  readAll: "schoollife.read.all",
  restrictedRead: "schoollife.restricted.read",
  confidentialRead: "schoollife.confidential.read",
  confidentialAudit: "schoollife.confidential.audit",
  incidentWrite: "schoollife.incident.write",
  incidentReview: "schoollife.incident.review",
  measurePropose: "schoollife.measure.propose",
  measureValidate: "schoollife.measure.validate",
  exclusionValidate: "schoollife.exclusion.validate",
  exclusionApply: "schoollife.exclusion.apply",
  measureRevoke: "schoollife.measure.revoke",
  appealFile: "schoollife.appeal.file",
  appealDecide: "schoollife.appeal.decide",
  noteWrite: "schoollife.note.write",
  convocationManage: "schoollife.convocation.manage",
  conductManage: "schoollife.conduct.manage",
  conductAdjust: "schoollife.conduct.adjust",
  settingsManage: "schoollife.settings.manage",
  selfRead: "schoollife.self.read",
  childRead: "schoollife.child.read",
  selfAppeal: "schoollife.self.appeal",
  childAppeal: "schoollife.child.appeal",
  childAcknowledge: "schoollife.child.acknowledge",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

/** Capacité -> permission (le contenu de `CallerCaps` est dérivé de cette table, jamais d'un rôle). */
const CAP_PERMISSIONS: Readonly<Record<Exclude<keyof CallerCaps, "can">, string>> = Object.freeze({
  read: PERMISSIONS.read,
  readAll: PERMISSIONS.readAll,
  restrictedRead: PERMISSIONS.restrictedRead,
  confidentialRead: PERMISSIONS.confidentialRead,
  incidentWrite: PERMISSIONS.incidentWrite,
  incidentReview: PERMISSIONS.incidentReview,
  measurePropose: PERMISSIONS.measurePropose,
  measureValidate: PERMISSIONS.measureValidate,
  exclusionValidate: PERMISSIONS.exclusionValidate,
  measureRevoke: PERMISSIONS.measureRevoke,
  appealFile: PERMISSIONS.appealFile,
  appealDecide: PERMISSIONS.appealDecide,
  noteWrite: PERMISSIONS.noteWrite,
  convocationManage: PERMISSIONS.convocationManage,
  conductManage: PERMISSIONS.conductManage,
  conductAdjust: PERMISSIONS.conductAdjust,
  settingsManage: PERMISSIONS.settingsManage,
  exclusionApply: PERMISSIONS.exclusionApply,
  selfRead: PERMISSIONS.selfRead,
  childRead: PERMISSIONS.childRead,
  selfAppeal: PERMISSIONS.selfAppeal,
  childAppeal: PERMISSIONS.childAppeal,
  childAcknowledge: PERMISSIONS.childAcknowledge,
});

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  /** Toutes les capacités de l'appelant (`{ readAll: true, … }`) + `can(permission)` pour les permissions propres à un type. */
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
      const entries = await Promise.all((Object.entries(CAP_PERMISSIONS) as Array<[keyof typeof CAP_PERMISSIONS, string]>).map(async ([cap, permission]) => [cap, await kit.has(app, request, reply, permission)] as const));
      const flags = Object.fromEntries(entries.filter(([, v]) => v)) as CallerCaps;
      return { ...flags, can: (permission: string) => kit.has(app, request, reply, permission) };
    },
  };
  return kit;
}
