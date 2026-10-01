/**
 * MFA TOTP : enrôlement, challenge de login, désactivation, réinitialisation par l'admin.
 *
 * Décisions de sécurité :
 *  - le secret TOTP est chiffré au repos (AES-256-GCM, AAD = id de l'identité) et
 *    n'apparaît en clair qu'à l'enrôlement (réponse unique) ;
 *  - ENRÔLER exige une ré-authentification (mot de passe) lorsqu'on part d'un
 *    jeton d'accès : sinon un jeton volé suffirait à greffer le TOTP de l'attaquant ;
 *  - anti-rejeu : le dernier pas TOTP accepté est persisté (UPDATE conditionnel
 *    atomique) ; un code déjà utilisé, même dans sa fenêtre de validité, est refusé ;
 *  - codes de secours : 60 bits, empreinte HMAC (clé serveur), usage unique atomique ;
 *  - challenge : ligne en base (usage unique, expiration, plafond d'essais) +
 *    verrouillage progressif par identité ;
 *  - DÉSACTIVER exige mot de passe ET second facteur, refuse si un rôle de
 *    l'identité (dans n'importe quel tenant) impose la MFA, et invalide les
 *    autres sessions ;
 *  - la réinitialisation par un administrateur n'est autorisée que pour une
 *    personne dont l'unique accès est ce tenant (la MFA est globale à l'identité).
 */
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  err,
  newId,
  ok,
  type AppError,
  type Result,
} from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AuthErrorCodes } from "@ecoledigitale/contracts/v2/iam";
import { verifyStepToken } from "../domain/access-token";
import { decryptSecret, encryptSecret, needsReencrypt, SecretBoxError } from "../domain/secret-box";
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from "../domain/totp";
import { generateRecoveryCode, hashRecoveryCode, limiterKey, normalizeRecoveryCode } from "../domain/tokens";
import * as credentials from "../infrastructure/credential-repo";
import * as identities from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import {
  IAM_EVENT,
  TooManyAttemptsError,
  cleanText,
  invalidCredentials,
  publish,
  sessionInvalid,
  systemContext,
  userContext,
  type IamDeps,
  type RequestMeta,
} from "./deps";
import type { AuthenticatedPrincipal } from "./ports";
import {
  chooseActiveRole,
  publishLoggedIn,
  startSession,
  toTenantSummaries,
  toUserSummary,
  type Amr,
  type AuthenticatedOutcome,
} from "./session-issue";

const mfaLockKey = (deps: IamDeps, identityId: string): string => limiterKey(deps.config.keys.tokenHash, "mfa:id", identityId);
const pwdLockKey = (deps: IamDeps, identityId: string): string => limiterKey(deps.config.keys.tokenHash, "pwd:id", identityId);

const badCode = (): UnauthorizedError => new UnauthorizedError("Code de vérification invalide.", { code: AuthErrorCodes.mfaInvalidCode });
const challengeInvalid = (): UnauthorizedError => new UnauthorizedError("Étape de vérification expirée ou invalide. Reconnectez-vous.", { code: AuthErrorCodes.mfaChallengeInvalid });

// -----------------------------------------------------------------------------
// Secret et second facteur
// -----------------------------------------------------------------------------

async function readTotpSecret(deps: IamDeps, tx: Tx, identity: identities.IdentityRow): Promise<Buffer | null> {
  if (!identity.mfa_secret_enc) return null;
  try {
    const secret = decryptSecret(deps.config.mfaKeys, identity.mfa_secret_enc, identity.id);
    if (needsReencrypt(deps.config.mfaKeys, identity.mfa_secret_enc)) {
      // Rotation de clé : rechiffrement transparent avec la clé courante.
      await identities.replaceMfaSecret(tx, identity.id, identity.mfa_secret_enc, encryptSecret(deps.config.mfaKeys, secret, identity.id));
    }
    return secret;
  } catch (e) {
    if (e instanceof SecretBoxError) {
      deps.logger.error({ event: "iam_mfa_secret_unreadable", identityId: identity.id }, "Secret TOTP illisible");
      return null;
    }
    throw e;
  }
}

/** Vérifie le second facteur (TOTP ou code de secours). Consomme le pas / le code en cas de succès. */
async function verifySecondFactor(
  deps: IamDeps,
  tx: Tx,
  identity: identities.IdentityRow,
  input: { code?: string | undefined; recoveryCode?: string | undefined },
): Promise<{ ok: true; amr: Amr } | { ok: false }> {
  const now = deps.clock.now();
  if (input.code !== undefined) {
    const secret = await readTotpSecret(deps, tx, identity);
    if (!secret) return { ok: false };
    const step = verifyTotp(secret, input.code, now.getTime(), { window: 1, minStepExclusive: identity.mfa_last_step });
    if (step === null) return { ok: false };
    // UPDATE conditionnel : deux requêtes simultanées avec le même code, une seule passe.
    return (await identities.advanceMfaStep(tx, identity.id, step)) ? { ok: true, amr: "otp" } : { ok: false };
  }
  if (input.recoveryCode !== undefined) {
    const hash = hashRecoveryCode(deps.config.keys.tokenHash, normalizeRecoveryCode(input.recoveryCode));
    return (await credentials.consumeRecoveryCode(tx, identity.id, hash, now)) ? { ok: true, amr: "rcv" } : { ok: false };
  }
  return { ok: false };
}

// -----------------------------------------------------------------------------
// Challenge de login
// -----------------------------------------------------------------------------

export interface ChallengeInput {
  challengeToken: string;
  code?: string | undefined;
  recoveryCode?: string | undefined;
  meta: RequestMeta;
}

export async function completeChallenge(deps: IamDeps, input: ChallengeInput): Promise<Result<AuthenticatedOutcome, AppError>> {
  const { config, clock, limiter } = deps;
  const verified = verifyStepToken(input.challengeToken, "mfa_challenge", { config, clock });
  if (!verified.ok) return err(challengeInvalid());
  const claims = verified.value;
  const identityId = claims.sub;
  const tenantId = claims.tid;

  const lockKey = mfaLockKey(deps, identityId);
  const lock = await limiter.lockStatus(lockKey);
  if (lock.blocked) return err(new TooManyAttemptsError(lock.retryAfterMs));

  const ctx = userContext(tenantId, identityId, [], input.meta.requestId);
  type Inner =
    | { kind: "invalid" }
    | { kind: "bad_code" }
    | { kind: "ok"; outcome: AuthenticatedOutcome; sourceSession: { id: string; tenantId: string } | null };

  const inner = await deps.tenantDb.run(ctx, async (tx): Promise<Inner> => {
    const now = clock.now();
    const challenge = await sessions.lockChallenge(tx, tenantId, claims.cid);
    if (
      !challenge ||
      challenge.purpose !== "login" ||
      challenge.identity_id !== identityId ||
      challenge.consumed_at !== null ||
      challenge.expires_at <= now ||
      challenge.attempts >= challenge.max_attempts
    ) {
      return { kind: "invalid" };
    }
    const identity = await identities.findIdentityById(tx, identityId, true);
    if (!identity || identity.status !== "active" || !identity.mfa_enabled) return { kind: "invalid" };
    const membership = await memberships.findMembershipById(tx, tenantId, challenge.membership_id);
    const tenant = await identities.findTenantById(tx, tenantId);
    if (!membership || membership.status !== "active" || membership.identity_id !== identityId || !tenant || tenant.status !== "active") {
      return { kind: "invalid" };
    }

    const factor = await verifySecondFactor(deps, tx, identity, { code: input.code, recoveryCode: input.recoveryCode });
    if (!factor.ok) {
      await sessions.bumpChallengeAttempts(tx, tenantId, challenge.id);
      await publish(deps, tx, systemContext(tenantId, input.meta.requestId), IAM_EVENT.loginFailed, {
        reason: "bad_mfa",
        identityId,
        locked: false,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
      });
      return { kind: "bad_code" };
    }

    await sessions.consumeChallenge(tx, tenantId, challenge.id, now);
    const roles = membership.roles;
    const activeRole = chooseActiveRole(roles, challenge.active_role, membership.active_role, membership.base_role);
    const amr: Amr[] = ["pwd", factor.amr];
    const issued = await startSession(deps, tx, {
      identity,
      membership,
      tenant,
      activeRole,
      mfaVerified: true,
      amr,
      meta: { ...input.meta, ip: challenge.ip ?? input.meta.ip },
      deviceName: challenge.device_name,
      authEpoch: identity.auth_epoch,
    });
    await identities.recordLogin(tx, identityId, tenantId, now);
    await publishLoggedIn(deps, tx, userContext(tenantId, identityId, roles, input.meta.requestId), {
      identityId,
      membershipId: membership.id,
      sessionId: issued.sessionId,
      mfa: true,
      amr,
      method: factor.amr === "rcv" ? "mfa_recovery_code" : "mfa_totp",
      meta: input.meta,
    });
    const tenantList = await identities.listTenantsOfIdentity(tx, identityId);
    return {
      kind: "ok",
      outcome: { status: "authenticated", session: issued, user: toUserSummary(identity, tenant, roles, activeRole), tenants: toTenantSummaries(tenantList) },
      sourceSession: challenge.source_session_id && challenge.source_tenant_id ? { id: challenge.source_session_id, tenantId: challenge.source_tenant_id } : null,
    };
  });

  if (inner.kind === "invalid") return err(challengeInvalid());
  if (inner.kind === "bad_code") {
    const after = await limiter.recordFailure(lockKey, config.mfaIdentityLockout);
    if (after.blocked) return err(new TooManyAttemptsError(after.retryAfterMs));
    return err(badCode());
  }
  await limiter.clear(lockKey);
  if (inner.sourceSession) {
    await revokeSourceSession(deps, identityId, inner.sourceSession, input.meta.requestId);
  }
  return ok(inner.outcome);
}

/** Révoque la session d'origine d'un `switch-tenant` (dans SON tenant). Échec journalisé, jamais bloquant. */
export async function revokeSourceSession(
  deps: IamDeps,
  identityId: string,
  source: { id: string; tenantId: string },
  requestId: string,
): Promise<void> {
  try {
    const ctx = userContext(source.tenantId, identityId, [], requestId);
    await deps.tenantDb.run(ctx, async (tx) => {
      const revoked = await sessions.revokeSession(tx, source.tenantId, source.id, "switched_tenant", identityId, deps.clock.now(), { identityId });
      if (revoked) {
        await publish(deps, tx, ctx, IAM_EVENT.sessionRevoked, { sessionId: revoked.id, identityId, reason: "switched_tenant", scope: "one" }, { type: "session", id: revoked.id });
      }
    });
  } catch (e) {
    deps.logger.error({ event: "iam_source_session_revoke_failed", sessionId: source.id, error: e instanceof Error ? e.message : String(e) }, "Révocation de la session d'origine impossible");
  }
}

// -----------------------------------------------------------------------------
// Enrôlement
// -----------------------------------------------------------------------------

export type MfaSubject =
  | { via: "session"; principal: AuthenticatedPrincipal }
  | { via: "enrollment"; identityId: string; tenantId: string; challengeId: string };

/** Valide un jeton d'enrôlement (signature, challenge en base non consommé et non expiré). */
export async function resolveEnrollmentToken(deps: IamDeps, token: string, meta: RequestMeta): Promise<Result<MfaSubject, AppError>> {
  const verified = verifyStepToken(token, "mfa_enroll", { config: deps.config, clock: deps.clock });
  if (!verified.ok) return err(challengeInvalid());
  const c = verified.value;
  const ctx = userContext(c.tid, c.sub, [], meta.requestId);
  const valid = await deps.tenantDb.run(
    ctx,
    async (tx) => {
      const ch = await sessions.lockChallenge(tx, c.tid, c.cid);
      return Boolean(ch && ch.purpose === "enroll" && ch.identity_id === c.sub && ch.consumed_at === null && ch.expires_at > deps.clock.now());
    }
  );
  return valid ? ok({ via: "enrollment", identityId: c.sub, tenantId: c.tid, challengeId: c.cid }) : err(challengeInvalid());
}

const subjectIds = (s: MfaSubject): { identityId: string; tenantId: string } =>
  s.via === "session" ? { identityId: s.principal.identityId, tenantId: s.principal.ctx.tenantId } : { identityId: s.identityId, tenantId: s.tenantId };

export interface EnrollmentStart {
  otpauthUri: string;
  secret: string;
  issuer: string;
  accountName: string;
}

export async function beginEnrollment(
  deps: IamDeps,
  subject: MfaSubject,
  input: { password?: string | undefined; meta: RequestMeta },
): Promise<Result<EnrollmentStart, AppError>> {
  if (subject.via === "session" && subject.principal.impersonatedBy) {
    return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  }
  const { identityId, tenantId } = subjectIds(subject);

  if (subject.via === "session") {
    // Ré-authentification : le mot de passe est exigé avec un jeton d'accès.
    if (!input.password) return err(invalidCredentials());
    const reauth = await reauthenticate(deps, identityId, tenantId, input.password, input.meta);
    if (!reauth.ok) return reauth;
  }

  const ctx = userContext(tenantId, identityId, [], input.meta.requestId);
  return deps.tenantDb.run(ctx, async (tx): Promise<Result<EnrollmentStart, AppError>> => {
    const identity = await identities.findIdentityById(tx, identityId, true);
    if (!identity || identity.status !== "active") return err(sessionInvalid());
    if (identity.mfa_enabled) return err(new ConflictError("La vérification en deux étapes est déjà activée.", { code: AuthErrorCodes.mfaAlreadyEnabled }));
    const secret = generateTotpSecret(20);
    await identities.setMfaPending(tx, identityId, encryptSecret(deps.config.mfaKeys, secret, identityId), deps.clock.now());
    return ok({
      otpauthUri: otpauthUri({ issuer: deps.config.mfa.totpIssuer, accountName: identity.email, secret }),
      secret: base32Encode(secret),
      issuer: deps.config.mfa.totpIssuer,
      accountName: identity.email,
    });
  });
}

export interface EnrollmentConfirmed {
  recoveryCodes: string[];
  session?: AuthenticatedOutcome;
}

export async function confirmEnrollment(
  deps: IamDeps,
  subject: MfaSubject,
  input: { code: string; deviceName?: string | undefined; meta: RequestMeta },
): Promise<Result<EnrollmentConfirmed, AppError>> {
  if (subject.via === "session" && subject.principal.impersonatedBy) {
    return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  }
  const { identityId, tenantId } = subjectIds(subject);
  const lockKey = mfaLockKey(deps, identityId);
  const lock = await deps.limiter.lockStatus(lockKey);
  if (lock.blocked) return err(new TooManyAttemptsError(lock.retryAfterMs));

  const now = deps.clock.now();
  const recoveryPlain = Array.from({ length: deps.config.mfa.recoveryCodeCount }, () => generateRecoveryCode());
  const recoveryHashes = recoveryPlain.map((c) => hashRecoveryCode(deps.config.keys.tokenHash, normalizeRecoveryCode(c)));

  const ctx = userContext(tenantId, identityId, [], input.meta.requestId);
  type Inner = { kind: "bad_code" } | { kind: "invalid" } | { kind: "ok"; session?: AuthenticatedOutcome; sourceSession?: { id: string; tenantId: string } };

  const inner = await deps.tenantDb.run(ctx, async (tx): Promise<Inner> => {
    const identity = await identities.findIdentityById(tx, identityId, true);
    if (!identity || identity.status !== "active" || identity.mfa_enabled || !identity.mfa_pending_secret_enc) return { kind: "invalid" };
    let challenge: sessions.ChallengeRow | null = null;
    if (subject.via === "enrollment") {
      challenge = await sessions.lockChallenge(tx, tenantId, subject.challengeId);
      if (!challenge || challenge.purpose !== "enroll" || challenge.consumed_at !== null || challenge.expires_at <= now) return { kind: "invalid" };
    }

    let secret: Buffer;
    try {
      secret = decryptSecret(deps.config.mfaKeys, identity.mfa_pending_secret_enc, identityId);
    } catch {
      return { kind: "invalid" };
    }
    const step = verifyTotp(secret, input.code, now.getTime(), { window: 1, minStepExclusive: 0 });
    if (step === null) return { kind: "bad_code" };

    await identities.enableMfa(tx, identityId, identity.mfa_pending_secret_enc, step, now);
    await credentials.replaceRecoveryCodes(
      tx,
      identityId,
      recoveryHashes.map(() => newId()),
      recoveryHashes,
      now,
    );
    await publish(deps, tx, ctx, IAM_EVENT.mfaEnabled, { identityId, method: "totp", via: subject.via }, { type: "identity", id: identityId });

    if (subject.via === "enrollment" && challenge) {
      const membership = await memberships.findMembershipById(tx, tenantId, challenge.membership_id);
      const tenant = await identities.findTenantById(tx, tenantId);
      if (!membership || membership.status !== "active" || !tenant || tenant.status !== "active") return { kind: "invalid" };
      await sessions.consumeChallenge(tx, tenantId, challenge.id, now);
      const roles = membership.roles;
      const activeRole = chooseActiveRole(roles, challenge.active_role, membership.active_role, membership.base_role);
      const amr: Amr[] = ["pwd", "otp"];
      const fresh = { ...identity, mfa_enabled: true };
      const issued = await startSession(deps, tx, {
        identity: fresh,
        membership,
        tenant,
        activeRole,
        mfaVerified: true,
        amr,
        meta: { ...input.meta, ip: challenge.ip ?? input.meta.ip },
        deviceName: challenge.device_name ?? cleanText(input.deviceName, 80),
        authEpoch: identity.auth_epoch,
      });
      await identities.recordLogin(tx, identityId, tenantId, now);
      await publishLoggedIn(deps, tx, userContext(tenantId, identityId, roles, input.meta.requestId), {
        identityId,
        membershipId: membership.id,
        sessionId: issued.sessionId,
        mfa: true,
        amr,
        method: "mfa_enrollment",
        meta: input.meta,
      });
      const tenantList = await identities.listTenantsOfIdentity(tx, identityId);
      return {
        kind: "ok",
        session: { status: "authenticated", session: issued, user: toUserSummary(fresh, tenant, roles, activeRole), tenants: toTenantSummaries(tenantList) },
        ...(challenge.source_session_id && challenge.source_tenant_id ? { sourceSession: { id: challenge.source_session_id, tenantId: challenge.source_tenant_id } } : {}),
      };
    }
    return { kind: "ok" };
  });

  if (inner.kind === "invalid") return err(challengeInvalid());
  if (inner.kind === "bad_code") {
    const after = await deps.limiter.recordFailure(lockKey, deps.config.mfaIdentityLockout);
    return err(after.blocked ? new TooManyAttemptsError(after.retryAfterMs) : badCode());
  }
  await deps.limiter.clear(lockKey);
  if (inner.sourceSession) await revokeSourceSession(deps, identityId, inner.sourceSession, input.meta.requestId);
  return ok({ recoveryCodes: recoveryPlain, ...(inner.session ? { session: inner.session } : {}) });
}

// -----------------------------------------------------------------------------
// Désactivation (ré-authentification complète) et réinitialisation par l'admin
// -----------------------------------------------------------------------------

/** Vérifie le mot de passe actuel d'une identité (verrouillage progressif sur échec). */
export async function reauthenticate(
  deps: IamDeps,
  identityId: string,
  tenantId: string,
  password: string,
  meta: RequestMeta,
): Promise<Result<true, AppError>> {
  const key = pwdLockKey(deps, identityId);
  const lock = await deps.limiter.lockStatus(key);
  if (lock.blocked) return err(new TooManyAttemptsError(lock.retryAfterMs));
  const ctx = userContext(tenantId, identityId, [], meta.requestId);
  const identity = await deps.tenantDb.run(ctx, (tx) => identities.findIdentityById(tx, identityId), { readOnly: true });
  const verification = await deps.hasher.verify(identity?.password_hash ?? null, password);
  if (!identity || identity.status !== "active" || !verification.ok) {
    const after = await deps.limiter.recordFailure(key, deps.config.passwordChangeLockout);
    return err(after.blocked ? new TooManyAttemptsError(after.retryAfterMs) : invalidCredentials());
  }
  await deps.limiter.clear(key);
  return ok(true);
}

export async function disableMfa(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  input: { password: string; code?: string | undefined; recoveryCode?: string | undefined; deviceName?: string | undefined; meta: RequestMeta },
): Promise<Result<AuthenticatedOutcome, AppError>> {
  if (principal.impersonatedBy) return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  const { identityId } = principal;
  const tenantId = principal.ctx.tenantId;

  const reauth = await reauthenticate(deps, identityId, tenantId, input.password, input.meta);
  if (!reauth.ok) return reauth;

  const lockKey = mfaLockKey(deps, identityId);
  const lock = await deps.limiter.lockStatus(lockKey);
  if (lock.blocked) return err(new TooManyAttemptsError(lock.retryAfterMs));

  // MFA imposée par un rôle quelque part (n'importe quel tenant) : désactivation refusée.
  const mandatory = await isMfaMandatoryAnywhere(deps, identityId, input.meta.requestId);
  if (mandatory) {
    return err(new ConflictError("La vérification en deux étapes est obligatoire pour l'un de vos rôles.", { code: AuthErrorCodes.mfaMandatory }));
  }

  type Inner = { kind: "bad_code" } | { kind: "not_enabled" } | { kind: "stale" } | { kind: "ok"; outcome: AuthenticatedOutcome };
  const ctx = userContext(tenantId, identityId, principal.ctx.roles, input.meta.requestId);
  const inner = await deps.tenantDb.run(ctx, async (tx): Promise<Inner> => {
    const now = deps.clock.now();
    const identity = await identities.findIdentityById(tx, identityId, true);
    if (!identity || identity.status !== "active") return { kind: "stale" };
    if (!identity.mfa_enabled) return { kind: "not_enabled" };
    const factor = await verifySecondFactor(deps, tx, identity, { code: input.code, recoveryCode: input.recoveryCode });
    if (!factor.ok) return { kind: "bad_code" };

    await identities.disableMfa(tx, identityId, now);
    await credentials.deleteRecoveryCodes(tx, identityId);
    // Baisse de niveau de sécurité : toutes les autres sessions sont invalidées.
    const epoch = await identities.bumpAuthEpoch(tx, identityId, now);
    await sessions.revokeSessionsOfIdentity(tx, tenantId, identityId, "mfa_disabled", identityId, now);
    await publish(deps, tx, ctx, IAM_EVENT.mfaDisabled, { identityId }, { type: "identity", id: identityId });

    const membership = await memberships.findMembershipById(tx, tenantId, principal.membershipId);
    const tenant = await identities.findTenantById(tx, tenantId);
    if (!membership || membership.status !== "active" || !tenant) return { kind: "stale" };
    const activeRole = chooseActiveRole(membership.roles, principal.activeRole, membership.active_role, membership.base_role);
    const amr: Amr[] = ["pwd"];
    const issued = await startSession(deps, tx, {
      identity: { ...identity, mfa_enabled: false },
      membership,
      tenant,
      activeRole,
      mfaVerified: false,
      amr,
      meta: input.meta,
      deviceName: cleanText(input.deviceName, 80),
      authEpoch: epoch,
    });
    const tenantList = await identities.listTenantsOfIdentity(tx, identityId);
    return {
      kind: "ok",
      outcome: { status: "authenticated", session: issued, user: toUserSummary({ ...identity, mfa_enabled: false }, tenant, membership.roles, activeRole), tenants: toTenantSummaries(tenantList) },
    };
  });

  if (inner.kind === "not_enabled") return err(new ConflictError("La vérification en deux étapes n'est pas activée.", { code: AuthErrorCodes.mfaNotEnabled }));
  if (inner.kind === "stale") return err(sessionInvalid());
  if (inner.kind === "bad_code") {
    const after = await deps.limiter.recordFailure(lockKey, deps.config.mfaIdentityLockout);
    return err(after.blocked ? new TooManyAttemptsError(after.retryAfterMs) : badCode());
  }
  await deps.limiter.clear(lockKey);
  return ok(inner.outcome);
}

/** Vrai si l'un des accès actifs de l'identité (tous tenants) a un rôle qui impose la MFA. */
async function isMfaMandatoryAnywhere(deps: IamDeps, identityId: string, requestId: string): Promise<boolean> {
  const tenants = await deps.systemDb.run("iam.mfa.mandatory-check", (tx) => identities.listTenantsOfIdentity(tx, identityId), { readOnly: true });
  for (const t of tenants.filter((x) => x.status === "active")) {
    const ctx = userContext(t.id, identityId, [], requestId);
    const required = await deps.tenantDb.run(
      ctx,
      async (tx) => {
        const m = await memberships.findMembershipByIdentity(tx, t.id, identityId);
        return Boolean(m && m.status === "active" && deps.mfaPolicy.requiredFor(m.roles));
      },
      { readOnly: true },
    );
    if (required) return true;
  }
  return false;
}

/**
 * Réinitialisation de la MFA d'un membre par un administrateur (permission sensible
 * `iam.mfa.reset`, vérifiée par l'appelant). Refusée (sans motif détaillé) si la
 * personne a des accès dans d'autres tenants : la MFA est globale à l'identité,
 * un administrateur d'établissement ne doit pas pouvoir affaiblir un compte au-delà de son périmètre.
 */
export async function adminResetMfa(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  membershipId: string,
  meta: RequestMeta,
): Promise<Result<void, AppError>> {
  if (principal.impersonatedBy || !principal.mfa) {
    return err(new ForbiddenError("Une session avec vérification en deux étapes est requise.", { code: AuthErrorCodes.mfaRequired }));
  }
  const tenantId = principal.ctx.tenantId;
  const ctx = userContext(tenantId, principal.identityId, principal.ctx.roles, meta.requestId);
  return deps.tenantDb.run(ctx, async (tx): Promise<Result<void, AppError>> => {
    const now = deps.clock.now();
    const m = await memberships.findMembershipById(tx, tenantId, membershipId);
    if (!m) return err(new ForbiddenError("Action non autorisée.", { code: AuthErrorCodes.forbidden }));
    if (m.identity_id === principal.identityId) return err(new ForbiddenError("Action non autorisée.", { code: AuthErrorCodes.forbidden }));
    const tenants = await identities.listTenantsOfIdentity(tx, m.identity_id);
    if (tenants.some((t) => t.id !== tenantId)) {
      return err(new ForbiddenError("Réinitialisation impossible depuis cet établissement.", { code: AuthErrorCodes.forbidden }));
    }
    const identity = await identities.findIdentityById(tx, m.identity_id, true);
    if (!identity || !identity.mfa_enabled) return err(new ConflictError("La vérification en deux étapes n'est pas activée.", { code: AuthErrorCodes.mfaNotEnabled }));
    await identities.disableMfa(tx, identity.id, now);
    await credentials.deleteRecoveryCodes(tx, identity.id);
    await identities.bumpAuthEpoch(tx, identity.id, now);
    await sessions.revokeSessionsOfIdentity(tx, tenantId, identity.id, "mfa_reset_by_admin", principal.identityId, now);
    await publish(deps, tx, ctx, IAM_EVENT.mfaReset, { identityId: identity.id, membershipId, resetBy: principal.identityId }, { type: "identity", id: identity.id });
    return ok(undefined);
  });
}
