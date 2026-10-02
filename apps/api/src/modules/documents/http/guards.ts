/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (lecture par le personnel, un parent, un élève…) ;
 *  - `capsFor(request, clés)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions
 *    CONTEXTUELLES (sur quel document). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle quelle :
 * échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { ActorCaps } from "../domain/types";

export const PERMISSIONS = {
  read: "documents.read",
  readRestricted: "documents.read.restricted",
  readConfidential: "documents.read.confidential",
  upload: "documents.upload",
  share: "documents.share",
  archive: "documents.archive",
  manage: "documents.manage",
  historyRead: "documents.history.read",
  categoryManage: "documents.category.manage",
  settingsManage: "documents.settings.manage",
  quarantineManage: "documents.quarantine.manage",
  childRead: "documents.child.read",
  childUpload: "documents.child.upload",
  selfRead: "documents.self.read",
  selfUpload: "documents.self.upload",
  ownRead: "documents.own.read",
  ownUpload: "documents.own.upload",
} as const;

/** Lire des documents : personnel (tous niveaux), parent, élève, personnel pour son propre dossier, gestion. */
export const VIEWERS = [
  PERMISSIONS.read,
  PERMISSIONS.readRestricted,
  PERMISSIONS.readConfidential,
  PERMISSIONS.manage,
  PERMISSIONS.childRead,
  PERMISSIONS.selfRead,
  PERMISSIONS.ownRead,
] as const;

/** Déposer : personnel, gestion, parent (enfants liés), élève (soi), personnel (son dossier). */
export const UPLOADERS = [PERMISSIONS.upload, PERMISSIONS.manage, PERMISSIONS.childUpload, PERMISSIONS.selfUpload, PERMISSIONS.ownUpload] as const;

/** Toute permission du module : accès aux écrans communs (contexte, catégories). */
export const ANY_DOCUMENTS_PERMISSION = Object.values(PERMISSIONS);

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof ActorCaps, string>> = Object.freeze({
  read: PERMISSIONS.read,
  readRestricted: PERMISSIONS.readRestricted,
  readConfidential: PERMISSIONS.readConfidential,
  upload: PERMISSIONS.upload,
  share: PERMISSIONS.share,
  archive: PERMISSIONS.archive,
  manage: PERMISSIONS.manage,
  historyRead: PERMISSIONS.historyRead,
  categoryManage: PERMISSIONS.categoryManage,
  settingsManage: PERMISSIONS.settingsManage,
  quarantineManage: PERMISSIONS.quarantineManage,
  childRead: PERMISSIONS.childRead,
  childUpload: PERMISSIONS.childUpload,
  selfRead: PERMISSIONS.selfRead,
  selfUpload: PERMISSIONS.selfUpload,
  ownRead: PERMISSIONS.ownRead,
  ownUpload: PERMISSIONS.ownUpload,
});

export const ALL_CAPS = Object.keys(CAP_PERMISSIONS) as Array<keyof ActorCaps>;

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys?: ReadonlyArray<keyof ActorCaps>): Promise<ActorCaps>;
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
      return out as ActorCaps;
    },
  };
  return kit;
}
