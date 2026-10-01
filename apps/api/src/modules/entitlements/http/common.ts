/**
 * Éléments HTTP communs du module : contexte de requête, garde de permission,
 * port `SuperAdminAuthorizer`, format d'erreur. Aucune logique métier ici.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ForbiddenError,
  UnauthorizedError,
  getRequestContext,
  toAppError,
  toErrorBody,
  type RequestContext,
} from "@ecoledigitale/kernel";

/** Garde `requirePermission('ressource.action')` fournie par le module `rbac`. */
export type PermissionGuardFactory = (
  permission: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;

export type ContextResolver = (request: FastifyRequest) => RequestContext;

/** Identité d'un opérateur plateforme, telle que reconnue par l'autorisateur. */
export interface SuperAdminIdentity {
  /** Identifiant (UUID) de l'opérateur : tracé comme acteur `superAdmin` dans le contexte et l'audit. */
  actorId: string;
}

/**
 * PORT : décide si la requête vient d'un super-administrateur de la plateforme.
 * Défini ici, implémenté ailleurs (module `iam` / console plateforme) : ce module
 * ne dépend d'aucun code d'authentification.
 *
 * Contrat : renvoie l'identité, ou LÈVE `UnauthorizedError` (non authentifié) /
 * `ForbiddenError` (authentifié mais pas super-admin). Toute autre issue est un refus.
 */
export interface SuperAdminAuthorizer {
  authorize(request: FastifyRequest): Promise<SuperAdminIdentity>;
}

/** Autorisateur par défaut : REFUSE tout (échec fermé) tant qu'aucune implémentation n'est branchée. */
export const denyAllSuperAdmin: SuperAdminAuthorizer = {
  async authorize() {
    throw new ForbiddenError("Administration réservée aux opérateurs de la plateforme (autorisateur non configuré).", {
      code: "entitlements.super_admin_authorizer_missing",
    });
  },
};

/**
 * Contexte par défaut : propriété `requestContext` posée sur la requête par
 * l'authentification, sinon le contexte AsyncLocalStorage du kernel.
 */
export const defaultContextResolver: ContextResolver = (request) => {
  const ctx = (request as FastifyRequest & { requestContext?: RequestContext }).requestContext ?? getRequestContext();
  if (!ctx) throw new UnauthorizedError("Authentification requise.");
  return ctx;
};

/** Garde par défaut sans module rbac câblé : REFUSE tout (échec fermé). */
export const denyAllGuard: PermissionGuardFactory = (permission) => () => {
  throw new ForbiddenError(`Permission « ${permission} » non vérifiable : garde de permissions non configurée.`, {
    code: "entitlements.permission_guard_missing",
  });
};

export function resolvePermissionGuard(app: FastifyInstance, explicit?: PermissionGuardFactory): PermissionGuardFactory {
  if (explicit) return explicit;
  const decorated = (app as unknown as { requirePermission?: PermissionGuardFactory }).requirePermission;
  return typeof decorated === "function" ? decorated.bind(app) : denyAllGuard;
}

/** Gestionnaire d'erreurs du plugin : `AppError` -> `{status, code, kind, message, ...}`, jamais de stack. */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const fastifyStatus = (error as FastifyError).statusCode;
    if (typeof fastifyStatus === "number" && fastifyStatus >= 400 && fastifyStatus < 500 && !("kind" in error)) {
      void reply.status(fastifyStatus).send({
        status: fastifyStatus,
        code: (error as FastifyError).code ?? "BAD_REQUEST",
        kind: "validation",
        message: "Requête invalide.",
        requestId: request.id,
      });
      return;
    }
    const appError = toAppError(error);
    if (appError.kind === "internal") request.log.error({ err: error }, "entitlements: erreur interne");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, request.id));
  });
}
