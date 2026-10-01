/**
 * Aides communes aux use cases : autorisation de l'acteur, événements, audit.
 */
import {
  ForbiddenError,
  ValidationError,
  createDomainEvent,
  err,
  ok,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { decide, type AuthorizationContext } from "../domain/permission-set";
import type { ScopeTarget } from "../domain/scope";
import type { AuditEntry, UseCaseDeps } from "./ports";

export { ok, err };
export type { Result, AppError };

/**
 * L'acteur peut-il exercer `permission` sur `scope` ? Un acteur `system` (provisioning,
 * jobs) est de confiance : il n'a pas d'utilisateur, donc pas de droits à comparer.
 * Un acteur humain SANS droits fournis est refusé (échec fermé).
 */
export function authorizeActor(
  deps: UseCaseDeps,
  ctx: RequestContext,
  permission: string,
  scope: ScopeTarget,
): ForbiddenError | null {
  if (ctx.actor === "system") return null;
  const actor = deps.actor;
  if (!actor || !actorMatches(actor, ctx)) {
    return new ForbiddenError("Droits de l'acteur indisponibles.", { code: "rbac.authorization_missing" });
  }
  const decision = decide(actor, permission, scope);
  if (decision.allowed) return null;
  if (decision.reason === "mfa_required") {
    return new ForbiddenError("Authentification forte (MFA) requise pour cette action.", {
      code: "rbac.mfa_required",
      details: { permission },
    });
  }
  return new ForbiddenError("Action non autorisée.", { details: { permission, reason: decision.reason } });
}

export function actorMatches(actor: AuthorizationContext, ctx: RequestContext): boolean {
  return (
    ctx.userId !== null &&
    actor.userId === ctx.userId.toLowerCase() &&
    actor.tenantId === ctx.tenantId.toLowerCase()
  );
}

export async function publish<T extends object>(
  deps: UseCaseDeps,
  ctx: RequestContext,
  type: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
): Promise<void> {
  await deps.outbox.append([
    createDomainEvent({ type, payload, ctx, clock: deps.clock, aggregateType, aggregateId }),
  ]);
}

export async function audit(
  deps: UseCaseDeps,
  ctx: RequestContext,
  entry: Omit<AuditEntry, "tenantId" | "actorId" | "requestId">,
): Promise<void> {
  await deps.audit.record(deps.tx, {
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    requestId: ctx.requestId,
    ...entry,
  });
}

/** Erreur de validation à code stable (rbac.*) : le code sert aux clients, le message à l'humain. */
export function invalid(path: string, message: string, code: string): ValidationError {
  return new ValidationError(message, [{ path: [path], message, code }], { code });
}
