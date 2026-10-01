/**
 * Impersonation par un super-admin de la plateforme.
 *
 * Garanties (menaces couvertes : abus silencieux, jeton réutilisable, escalade) :
 *  - l'acteur est authentifié par le module appelant (port `SuperAdminAuthenticator`)
 *    et son identifiant est porté par la claim `act` ET par `sessions.actor_id` ;
 *  - un MOTIF est obligatoire (10 caractères minimum) ;
 *  - l'événement d'audit `iam.impersonation.started` est écrit dans l'outbox DANS LA
 *    MÊME transaction que la session : pas d'audit, pas de session ;
 *  - jeton distinct (`typ imp+jwt`, `use: impersonation`), TTL court (10 min par défaut,
 *    30 max), NON renouvelable (pas de refresh token), révocable (c'est une session) ;
 *  - la session n'est jamais « mfa » : les actions sensibles (permissions marquées
 *    `sensitive`) restent donc refusées ; changement de mot de passe, MFA, switch-tenant
 *    et nouvelle impersonation sont interdits sous impersonation ;
 *  - le contexte construit a `actor: "superAdmin"` (traçable dans `app.actor`).
 *
 * Il n'existe AUCUN mot de passe technique : l'ancien compte « technique » à mot de
 * passe par défaut disparaît (plan §3.15).
 */
import { ForbiddenError, createRequestContext, err, newId, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { issueBearerToken } from "../domain/access-token";
import { limiterKey } from "../domain/tokens";
import * as identities from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import { IAM_EVENT, TooManyAttemptsError, publish, type IamDeps, type RequestMeta } from "./deps";
import type { SuperAdminActor } from "./ports";
import { chooseActiveRole, toUserSummary, type UserSummary } from "./session-issue";

export interface ImpersonationOutcome {
  sessionId: string;
  accessToken: string;
  expiresAt: Date;
  user: UserSummary;
}

const refused = (): AppError => new ForbiddenError("Impersonation impossible.", { code: AuthErrorCodes.impersonationForbidden });

export async function startImpersonation(
  deps: IamDeps,
  actor: SuperAdminActor,
  input: { tenantId: string; identityId: string; reason: string; meta: RequestMeta },
): Promise<Result<ImpersonationOutcome, AppError>> {
  const { config, clock } = deps;
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) return err(refused());

  const hit = await deps.limiter.hit(limiterKey(config.keys.tokenHash, "imp:actor", actor.id), config.impersonationLimit);
  if (!hit.allowed) return err(new TooManyAttemptsError(hit.retryAfterMs));

  // Contexte `superAdmin` : l'acteur réel (super-admin) est l'auteur de l'événement d'audit.
  const ctx = createRequestContext({ tenantId: input.tenantId, userId: actor.id, actor: "superAdmin", roles: [], requestId: input.meta.requestId });

  return deps.tenantDb.run(ctx, async (tx): Promise<Result<ImpersonationOutcome, AppError>> => {
    const now = clock.now();
    const tenant = await identities.findTenantById(tx, input.tenantId);
    if (!tenant || tenant.status !== "active") return err(refused());
    const identity = await identities.findIdentityById(tx, input.identityId);
    const membership = await memberships.findMembershipByIdentity(tx, input.tenantId, input.identityId);
    if (!identity || identity.status !== "active" || !membership || membership.status !== "active") return err(refused());

    const roles = membership.roles;
    const activeRole = chooseActiveRole(roles, null, membership.active_role, membership.base_role);
    const sessionId = newId();
    const expiresAt = new Date(now.getTime() + config.impersonationTtlSec * 1000);

    await sessions.insertSession(tx, {
      id: sessionId,
      tenantId: tenant.id,
      identityId: identity.id,
      membershipId: membership.id,
      kind: "impersonation",
      activeRole,
      authEpoch: identity.auth_epoch,
      mfaVerified: false,
      amr: ["imp"],
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
      deviceName: null,
      actorId: actor.id,
      reason,
      now,
      expiresAt,
    });

    // Audit OBLIGATOIRE : même transaction que la session. Si l'écriture échoue, tout est annulé.
    await publish(
      deps,
      tx,
      ctx,
      IAM_EVENT.impersonationStarted,
      {
        sessionId,
        // Clés lues par le module audit (superAdminId, targetUserId, reason, ip, userAgent) + détail.
        superAdminId: actor.id,
        actorType: "superAdmin",
        targetUserId: identity.id,
        actor: { id: actor.id, email: actor.email, type: "super_admin" },
        target: { identityId: identity.id, membershipId: membership.id, tenantId: tenant.id, activeRole },
        reason,
        expiresAt: expiresAt.toISOString(),
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
      },
      { type: "session", id: sessionId },
    );

    const issued = issueBearerToken(config, clock, {
      userId: identity.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      roles,
      activeRole,
      sessionId,
      membershipId: membership.id,
      mfa: false,
      amr: ["imp"],
      actor: { id: actor.id },
    });
    return ok({ sessionId, accessToken: issued.token, expiresAt: issued.expiresAt, user: toUserSummary(identity, tenant, roles, activeRole) });
  });
}
