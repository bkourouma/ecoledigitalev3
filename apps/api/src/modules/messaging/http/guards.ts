/**
 * Gardes de permission de la couche HTTP, construites sur le SEUL contrat `runtime.requirePermission` du module rbac :
 *  - `anyOf(a, b…)` : au moins une permission (lecture par le personnel, un parent ou un élève) ;
 *  - `capsFor(request, clés)` : les capacités RBAC de l'appelant, transmises aux cas d'usage pour leurs décisions
 *    CONTEXTUELLES (vis-à-vis de qui). Aucun rôle codé en dur.
 *
 * Une capacité refusée pour toute autre raison qu'un `ForbiddenError` (401, 500 `rbac.not_configured`) remonte telle
 * quelle : échec fermé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ForbiddenError } from "@ecoledigitale/kernel";
import type { CallerCaps } from "../domain/types";

export const PERMISSIONS = {
  read: "messaging.read",
  send: "messaging.send",
  sendAny: "messaging.send.any",
  childRead: "messaging.child.read",
  childSend: "messaging.child.send",
  selfRead: "messaging.self.read",
  selfSend: "messaging.self.send",
  announcementPublish: "messaging.announcement.publish",
  announcementPublishClass: "messaging.announcement.publish_class",
  announcementManage: "messaging.announcement.manage",
  moderationRead: "messaging.moderation.read",
  moderationManage: "messaging.moderation.manage",
  moderationSupervise: "messaging.moderation.supervise",
  settingsManage: "messaging.settings.manage",
} as const;

/** Lire sa boîte : personnel, parent ou élève. */
export const READERS = [PERMISSIONS.read, PERMISSIONS.childRead, PERMISSIONS.selfRead] as const;
/** Écrire : toute permission d'envoi (la règle « vis-à-vis de qui » est dans le cas d'usage). */
export const SENDERS = [PERMISSIONS.send, PERMISSIONS.sendAny, PERMISSIONS.childSend, PERMISSIONS.selfSend] as const;

type Guard = (permission: string) => preHandlerAsyncHookHandler;

const CAP_PERMISSIONS: Readonly<Record<keyof CallerCaps, string>> = Object.freeze({
  sendAny: PERMISSIONS.sendAny,
  send: PERMISSIONS.send,
  childSend: PERMISSIONS.childSend,
  selfSend: PERMISSIONS.selfSend,
  announcementPublish: PERMISSIONS.announcementPublish,
  announcementPublishClass: PERMISSIONS.announcementPublishClass,
  announcementManage: PERMISSIONS.announcementManage,
  moderationRead: PERMISSIONS.moderationRead,
  moderationManage: PERMISSIONS.moderationManage,
  moderationSupervise: PERMISSIONS.moderationSupervise,
  settingsManage: PERMISSIONS.settingsManage,
});

export interface PermissionKit {
  require(permission: string): preHandlerAsyncHookHandler;
  anyOf(...permissions: readonly string[]): preHandlerAsyncHookHandler;
  has(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean>;
  capsFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof CallerCaps>): Promise<CallerCaps>;
}

export const ALL_CAPS = Object.keys(CAP_PERMISSIONS) as Array<keyof CallerCaps>;

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
      // Séquentiel : les gardes partagent l'autorisation mémorisée de la requête.
      const out: Record<string, boolean> = {};
      for (const k of keys) if (await kit.has(app, request, reply, CAP_PERMISSIONS[k])) out[k] = true;
      return out as CallerCaps;
    },
  };
  return kit;
}
