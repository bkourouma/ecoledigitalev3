/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 * `anyOf(a, b…)` accepte au moins une permission (lecture par un rôle de gestion OU de consultation), `has` répond sans lever
 * (décision CONTEXTUELLE d'une route : la publication d'une session exige en plus `exam.result.publish`). Aucun rôle codé en dur.
 *
 * Une garde refusée pour une autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";

export const PERMISSIONS = {
  typeRead: "exam.type.read",
  typeManage: "exam.type.manage",
  centerManage: "exam.center.manage",
  sessionRead: "exam.session.read",
  sessionManage: "exam.session.manage",
  candidateRead: "exam.candidate.read",
  candidateManage: "exam.candidate.manage",
  eligibilityEvaluate: "exam.eligibility.evaluate",
  eligibilityOverride: "exam.eligibility.override",
  scoreEnter: "exam.score.enter",
  mockManage: "exam.mock.manage",
  importManage: "exam.import.manage",
  resultRead: "exam.result.read",
  resultEnter: "exam.result.enter",
  resultPublish: "exam.result.publish",
  resultRelease: "exam.result.release",
  resultRevise: "exam.result.revise",
  statisticsRead: "exam.statistics.read",
  exportManage: "exam.export.manage",
  exportRun: "exam.export.run",
  documentIssue: "exam.document.issue",
  documentChildRead: "exam.document.child.read",
  documentSelfRead: "exam.document.self.read",
} as const;

export type Guard = (permission: string) => preHandlerAsyncHookHandler;

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
