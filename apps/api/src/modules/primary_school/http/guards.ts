/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (lecture par le personnel, un parent ou un élève) ;
 *  - `capsFor(request, clés)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions CONTEXTUELLES
 *    (toutes les classes ou seulement les siennes). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../domain/types";

export const PERMISSIONS = {
  settingsManage: "primary.settings.manage",
  scaleManage: "primary.scale.manage",
  frameworkRead: "primary.framework.read",
  frameworkManage: "primary.framework.manage",
  frameworkPublish: "primary.framework.publish",
  competencyRead: "primary.competency.read",
  competencyRecord: "primary.competency.record",
  competencyValidate: "primary.competency.validate",
  competencyRevise: "primary.competency.revise",
  competencyChildRead: "primary.competency.child.read",
  competencySelfRead: "primary.competency.self.read",
  phraseRead: "primary.phrase.read",
  phraseManage: "primary.phrase.manage",
  councilRead: "primary.council.read",
  councilPrepare: "primary.council.prepare",
  councilManage: "primary.council.manage",
  bilanRead: "primary.bilan.read",
  bilanPrepare: "primary.bilan.prepare",
  bilanSeal: "primary.bilan.seal",
  bilanReissue: "primary.bilan.reissue",
  bilanChildRead: "primary.bilan.child.read",
  bilanSelfRead: "primary.bilan.self.read",
  archivePrepare: "primary.archive.prepare",
  archiveFreeze: "primary.archive.freeze",
  reportRead: "primary.report.read",
  templateApply: "primary.template.apply",
  classReadAll: "primary.class.read_all",
} as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof CallerCaps, string>> = Object.freeze({
  allClasses: PERMISSIONS.classReadAll,
  councilManage: PERMISSIONS.councilManage,
  validate: PERMISSIONS.competencyValidate,
});

export const ALL_CAPS = Object.keys(CAP_PERMISSIONS) as Array<keyof CallerCaps>;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys?: ReadonlyArray<keyof CallerCaps>): Promise<CallerCaps>;
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
    async capsFor(app, request, reply, keys = ALL_CAPS) {
      // Séquentiel : les gardes partagent l'autorisation mémorisée de la requête.
      const out: Record<string, boolean> = {};
      for (const k of keys) if (await kit.has(app, request, reply, CAP_PERMISSIONS[k])) out[k] = true;
      return out as CallerCaps;
    },
  };
  return kit;
}
