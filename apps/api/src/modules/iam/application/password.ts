/**
 * Mots de passe : changement (ré-authentifié), demande de réinitialisation
 * (réponse constante, sans énumération) et réinitialisation par jeton à usage unique.
 *
 * Tout changement de mot de passe incrémente `auth_epoch` : TOUTES les sessions de
 * TOUS les tenants meurent d'un seul UPDATE, atomique avec le nouveau hash.
 */
import {
  ForbiddenError,
  ValidationError,
  err,
  newId,
  ok,
  type AppError,
  type Result,
} from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/v2/iam";
import { isPlausibleEmail, normalizeEmail } from "../domain/email";
import { hashOpaqueToken, limiterKey, randomSecret } from "../domain/tokens";
import type { PasswordIssue } from "../domain/password-policy";
import * as credentials from "../infrastructure/credential-repo";
import * as identities from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import {
  IAM_EVENT,
  TooManyAttemptsError,
  cleanText,
  padToMinimum,
  publish,
  sessionInvalid,
  startTimer,
  systemContext,
  userContext,
  type IamDeps,
  type RequestMeta,
} from "./deps";
import { reauthenticate } from "./mfa";
import type { AuthenticatedPrincipal } from "./ports";
import { chooseActiveRole, startSession, toTenantSummaries, toUserSummary, type Amr, type AuthenticatedOutcome } from "./session-issue";

export function passwordPolicyError(issues: readonly PasswordIssue[]): ValidationError {
  return new ValidationError(
    "Le mot de passe ne respecte pas la politique de sécurité.",
    issues.map((i) => ({ path: ["newPassword"], message: i.message, code: i.code })),
    { code: AuthErrorCodes.passwordPolicy },
  );
}

// -----------------------------------------------------------------------------
// Changement (utilisateur connecté)
// -----------------------------------------------------------------------------

export async function changePassword(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  input: { currentPassword: string; newPassword: string; deviceName?: string | undefined; meta: RequestMeta },
): Promise<Result<AuthenticatedOutcome, AppError>> {
  if (principal.impersonatedBy) {
    return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  }
  const tenantId = principal.ctx.tenantId;
  const { identityId } = principal;

  // Ré-authentification (mot de passe actuel) avec verrouillage progressif.
  const reauth = await reauthenticate(deps, identityId, tenantId, input.currentPassword, input.meta);
  if (!reauth.ok) return reauth;

  const readCtx = userContext(tenantId, identityId, [], input.meta.requestId);
  const current = await deps.tenantDb.run(readCtx, async (tx) => ({
    identity: await identities.findIdentityById(tx, identityId),
    tenant: await identities.findTenantById(tx, tenantId),
  }), { readOnly: true });
  if (!current.identity || !current.tenant) return err(sessionInvalid());

  const issues = deps.policy.evaluate(input.newPassword, { email: current.identity.email, forbiddenTerms: [current.tenant.name, current.tenant.slug] });
  if (input.newPassword === input.currentPassword) {
    issues.push({ code: "common", message: "Le nouveau mot de passe doit être différent de l'ancien." });
  }
  if (issues.length > 0) return err(passwordPolicyError(issues));

  const newHash = await deps.hasher.hash(input.newPassword);
  const oldHash = current.identity.password_hash;

  const outcome = await deps.tenantDb.run(readCtx, async (tx): Promise<AuthenticatedOutcome | null> => {
    const now = deps.clock.now();
    const identity = await identities.findIdentityById(tx, identityId, true);
    if (!identity || identity.status !== "active" || identity.password_hash !== oldHash) return null;
    const membership = await memberships.findMembershipById(tx, tenantId, principal.membershipId);
    const tenant = await identities.findTenantById(tx, tenantId);
    if (!membership || membership.status !== "active" || !tenant) return null;

    const epoch = await identities.setPasswordAndBumpEpoch(tx, identityId, newHash, now);
    const revoked = await sessions.revokeSessionsOfIdentity(tx, tenantId, identityId, "password_changed", identityId, now);
    const ctx = userContext(tenantId, identityId, membership.roles, input.meta.requestId);
    await publish(deps, tx, ctx, IAM_EVENT.passwordChanged, { identityId, via: "change", ip: input.meta.ip }, { type: "identity", id: identityId });
    if (revoked.length > 0) {
      await publish(deps, tx, ctx, IAM_EVENT.sessionRevoked, { identityId, reason: "password_changed", scope: "all", sessionIds: revoked.map((r) => r.id) }, { type: "identity", id: identityId });
    }

    // L'appelant reste connecté : nouvelle session (même niveau d'authentification), nouveaux jetons.
    const activeRole = chooseActiveRole(membership.roles, principal.activeRole, membership.active_role, membership.base_role);
    const amr: Amr[] = principal.mfa ? ["pwd", "otp"] : ["pwd"];
    const issued = await startSession(deps, tx, {
      identity,
      membership,
      tenant,
      activeRole,
      mfaVerified: principal.mfa && identity.mfa_enabled,
      amr,
      meta: input.meta,
      deviceName: cleanText(input.deviceName, 80),
      authEpoch: epoch,
    });
    const tenantList = await identities.listTenantsOfIdentity(tx, identityId);
    return { status: "authenticated", session: issued, user: toUserSummary(identity, tenant, membership.roles, activeRole), tenants: toTenantSummaries(tenantList) };
  });
  if (!outcome) return err(sessionInvalid());

  fanOutPasswordChanged(deps, identityId, tenantId, "change", input.meta);
  return ok(outcome);
}

/** `iam.password.changed` dans l'outbox de chaque AUTRE tenant de l'identité (au mieux, hors chemin de réponse). */
function fanOutPasswordChanged(deps: IamDeps, identityId: string, exceptTenantId: string | null, via: string, meta: RequestMeta): void {
  deps.background.run("iam.password.changed.fanout", async () => {
    const tenants = await deps.systemDb.run("iam.password.fanout", (tx) => identities.listTenantsOfIdentity(tx, identityId), { readOnly: true });
    for (const t of tenants) {
      if (t.id === exceptTenantId || t.status !== "active") continue;
      const ctx = systemContext(t.id, meta.requestId);
      await deps.tenantDb.run(ctx, (tx) => publish(deps, tx, ctx, IAM_EVENT.passwordChanged, { identityId, via }, { type: "identity", id: identityId }));
    }
  });
}

// -----------------------------------------------------------------------------
// Mot de passe oublié
// -----------------------------------------------------------------------------

/**
 * Réponse CONSTANTE : succès apparent que l'e-mail existe ou non, durée alignée
 * sur le plancher, envoi d'e-mail hors du chemin de réponse. Les limites de débit
 * s'appliquent à la valeur saisie (existante ou non) et sont silencieuses.
 */
export async function forgotPassword(deps: IamDeps, input: { email: string; meta: RequestMeta }): Promise<void> {
  const startedAt = startTimer();
  try {
    const { config } = deps;
    const email = normalizeEmail(input.email);
    const ipHit = await deps.limiter.hit(limiterKey(config.keys.tokenHash, "forgot:ip", input.meta.ip ?? "unknown"), config.forgotIpLimit);
    const emailHit = await deps.limiter.hit(limiterKey(config.keys.tokenHash, "forgot:email", email), config.forgotEmailLimit);
    if (!ipHit.allowed || !emailHit.allowed || !isPlausibleEmail(email)) return;

    const issued = await deps.systemDb.run("iam.password.forgot", async (tx) => {
      const identity = await identities.findIdentityByEmail(tx, email);
      if (!identity || identity.status !== "active") return null;
      const tenants = (await identities.listTenantsOfIdentity(tx, identity.id)).filter((t) => t.status === "active");
      if (tenants.length === 0) return null;
      const now = deps.clock.now();
      const token = randomSecret(32);
      const expiresAt = new Date(now.getTime() + config.resetTtlSec * 1000);
      await credentials.invalidateOpenResetTokens(tx, identity.id, now);
      await credentials.insertResetToken(tx, {
        id: newId(),
        identityId: identity.id,
        purpose: "reset",
        tokenHash: hashOpaqueToken(config.keys.tokenHash, token),
        now,
        expiresAt,
        ip: input.meta.ip,
      });
      return { email: identity.email, token, expiresAt, tenantName: (tenants[0] as { name: string }).name };
    });

    if (issued) {
      deps.background.run("iam.password.reset-mail", () => deps.notifier.sendPasswordReset(issued));
    }
  } finally {
    await padToMinimum(deps, startedAt, deps.config.failureMinDurationMs);
  }
}

// -----------------------------------------------------------------------------
// Réinitialisation par jeton
// -----------------------------------------------------------------------------

const resetInvalid = (): AppError => new ValidationError("Lien invalide ou expiré.", [], { code: AuthErrorCodes.resetTokenInvalid });

export async function resetPassword(deps: IamDeps, input: { token: string; newPassword: string; meta: RequestMeta }): Promise<Result<void, AppError>> {
  const { config } = deps;
  const hit = await deps.limiter.hit(limiterKey(config.keys.tokenHash, "reset:ip", input.meta.ip ?? "unknown"), config.resetIpLimit);
  if (!hit.allowed) return err(new TooManyAttemptsError(hit.retryAfterMs));

  const tokenHash = hashOpaqueToken(config.keys.tokenHash, input.token);

  // 1. Lecture sans consommer : la politique doit pouvoir refuser SANS brûler le jeton.
  const peek = await deps.systemDb.run(
    "iam.password.reset.peek",
    async (tx) => {
      const row = await tx.queryOne<{ identity_id: string }>(
        `SELECT identity_id FROM iam.password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2`,
        [tokenHash, deps.clock.now()],
      );
      return row ? identities.findIdentityById(tx, row.identity_id) : null;
    },
    { readOnly: true },
  );
  if (!peek || peek.status !== "active") {
    await deps.hasher.verifyDummy(input.newPassword).catch(() => undefined);
    return err(resetInvalid());
  }

  const issues = deps.policy.evaluate(input.newPassword, { email: peek.email });
  if (issues.length > 0) return err(passwordPolicyError(issues));
  const newHash = await deps.hasher.hash(input.newPassword);

  // 2. Consommation atomique + changement de mot de passe + invalidation globale des sessions.
  const done = await deps.systemDb.run("iam.password.reset.apply", async (tx) => {
    const now = deps.clock.now();
    const consumed = await credentials.consumeResetToken(tx, tokenHash, now);
    if (!consumed || consumed.identity_id !== peek.id) return false;
    await identities.setPasswordAndBumpEpoch(tx, peek.id, newHash, now);
    await identities.markEmailVerified(tx, peek.id, now);
    await credentials.invalidateOpenResetTokens(tx, peek.id, now);
    return true;
  });
  if (!done) return err(resetInvalid());

  // Le verrouillage d'identité éventuel est levé : le propriétaire légitime reprend la main.
  await deps.limiter.clear(limiterKey(config.keys.tokenHash, "login:id", peek.email));
  fanOutPasswordChanged(deps, peek.id, null, "reset", input.meta);
  return ok(undefined);
}

