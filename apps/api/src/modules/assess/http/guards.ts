/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission ;
 *  - `capsFor(request, clés)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions
 *    CONTEXTUELLES (agir sur l'évaluation d'un autre enseignant…). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle
 * quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { AssessCaps } from "../application/deps";

export const PERMISSIONS = {
  typeRead: "assessment.type.read",
  typeManage: "assessment.type.manage",
  assessmentRead: "assessment.read",
  assessmentCreate: "assessment.create",
  assessmentUpdate: "assessment.update",
  assessmentManage: "assessment.manage",
  gradeRead: "grade.read",
  gradeEnter: "grade.enter",
  gradeReview: "grade.review",
  gradeValidate: "grade.validate",
  gradePublish: "grade.publish",
  reviseRequest: "grade.revise.request",
  reviseApprove: "grade.revise.approve",
  selfRead: "grade.self.read",
  childRead: "grade.child.read",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof AssessCaps, string>> = Object.freeze({
  manage: PERMISSIONS.assessmentManage,
  review: PERMISSIONS.gradeReview,
  validate: PERMISSIONS.gradeValidate,
  publish: PERMISSIONS.gradePublish,
  reviseRequest: PERMISSIONS.reviseRequest,
  reviseApprove: PERMISSIONS.reviseApprove,
  typeManage: PERMISSIONS.typeManage,
});

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof AssessCaps>): Promise<AssessCaps>;
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
      return Object.fromEntries(entries.filter(([, v]) => v)) as AssessCaps;
    },
  };
  return kit;
}
