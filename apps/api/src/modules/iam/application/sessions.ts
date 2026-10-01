/**
 * Cycle de vie des sessions : authentification d'une requête, refresh à rotation
 * (avec détection de réutilisation), logout, logout-all, switch-tenant, liste et
 * révocation.
 *
 * Invariants :
 *  - une session est valide SSI : non révoquée, non expirée, `auth_epoch` de la
 *    session = `auth_epoch` de l'identité, identité active, accès (membership)
 *    actif, tenant actif. Cette décision est prise en UNE requête, sur TOUTES les
 *    méthodes HTTP ;
 *  - le jeton est vérifié (signature, en-tête, dates) AVANT que son tenant ne soit
 *    utilisé pour ouvrir une transaction RLS ; l'appartenance de la session à ce
 *    tenant est ensuite revérifiée en base ;
 *  - refresh : le jeton présenté est marqué utilisé et remplacé dans la même
 *    transaction ; un jeton déjà utilisé qui revient révoque TOUTE la session ;
 *  - une impersonation n'est jamais renouvelable.
 */
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  createRequestContext,
  err,
  newId,
  ok,
  type AppError,
  type Result,
} from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { issueBearerToken, issueStepToken, verifyAccessToken, type BearerClaims } from "../domain/access-token";
import { hashOpaqueToken, limiterKey, parseRefreshToken } from "../domain/tokens";
import * as identities from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import {
  IAM_EVENT,
  TooManyAttemptsError,
  cleanText,
  publish,
  sessionInvalid,
  systemContext,
  userContext,
  type IamDeps,
  type RequestMeta,
} from "./deps";
import { revokeSourceSession } from "./mfa";
import type { AuthenticatedPrincipal } from "./ports";
import {
  chooseActiveRole,
  issueRefreshToken,
  publishLoggedIn,
  startSession,
  toTenantSummaries,
  toUserSummary,
  type Amr,
  type IssuedSession,
  type LoginOutcome,
} from "./session-issue";

// -----------------------------------------------------------------------------
// Authentification d'une requête
// -----------------------------------------------------------------------------

export interface AuthenticatedRequest {
  principal: AuthenticatedPrincipal;
  claims: BearerClaims;
}

export interface AuthenticateOptions {
  /** Tenant attendu d'après la requête (sous-domaine, en-tête) : s'il diffère de celui du jeton, refus. */
  expectedTenantSlug?: string | undefined;
  allowImpersonation?: boolean;
  requestId?: string | undefined;
}

type AuthDeps = Pick<IamDeps, "config" | "clock" | "tenantDb" | "mfaPolicy" | "logger">;

/**
 * Vérifie un jeton porteur ET l'état de sa session en base. C'est l'unique point
 * par lequel une requête devient un `RequestContext`.
 */
export async function authenticateBearer(
  deps: AuthDeps,
  token: string,
  options: AuthenticateOptions = {},
): Promise<Result<AuthenticatedRequest, AppError>> {
  const verified = verifyAccessToken(token, { config: deps.config, clock: deps.clock, allowImpersonation: options.allowImpersonation ?? true });
  if (!verified.ok) return verified;
  const claims = verified.value;

  if (options.expectedTenantSlug !== undefined && options.expectedTenantSlug !== claims.tenantSlug) {
    return err(new ForbiddenError("Jeton non valable pour cet établissement.", { code: AuthErrorCodes.tokenInvalid }));
  }

  const requestId = options.requestId ?? newId();
  const row = await deps.tenantDb.run(
    systemContext(claims.tenantId, requestId),
    (tx) => sessions.findSessionForRequest(tx, claims.tenantId, claims.sid),
    { readOnly: true },
  );

  // Toute incohérence = session invalide. Le tenant du jeton (signé) est confronté à la ligne lue sous RLS.
  if (!row) return err(sessionInvalid(AuthErrorCodes.sessionRevoked));
  const now = deps.clock.now();
  const isImpersonation = claims.use === "impersonation";
  if (
    row.identity_id !== claims.userId ||
    row.membership_id !== claims.mid ||
    row.revoked_at !== null ||
    row.expires_at <= now ||
    row.session_epoch !== row.identity_epoch ||
    row.identity_status !== "active" ||
    row.membership_status !== "active" ||
    row.tenant_status !== "active" ||
    row.tenant_slug !== claims.tenantSlug ||
    (row.kind === "impersonation") !== isImpersonation ||
    (isImpersonation && row.actor_id !== (claims as { act: { sub: string } }).act.sub) ||
    !row.membership_roles.includes(claims.activeRole)
  ) {
    return err(sessionInvalid(AuthErrorCodes.sessionRevoked));
  }

  // Politique MFA appliquée à chaque requête : un rôle devenu sensible exige une session MFA.
  if (!isImpersonation && !row.mfa_verified && deps.mfaPolicy.requiredFor(row.membership_roles)) {
    return err(new ForbiddenError("Vérification en deux étapes requise. Reconnectez-vous.", { code: AuthErrorCodes.mfaRequired }));
  }

  const ctx = createRequestContext({
    tenantId: claims.tenantId,
    userId: claims.userId,
    // Seul le rôle ACTIF évalue les permissions (principe du moindre privilège, comme le jeton historique).
    roles: [claims.activeRole],
    requestId,
    actor: isImpersonation ? "superAdmin" : "user",
    // Lu en base (jamais dans la revendication du jeton) ; lu par le RBAC pour les permissions sensibles.
    mfa: !isImpersonation && row.mfa_verified,
  });
  const principal: AuthenticatedPrincipal = {
    ctx,
    identityId: claims.userId,
    membershipId: claims.mid,
    sessionId: claims.sid,
    tenantSlug: claims.tenantSlug,
    activeRole: claims.activeRole,
    availableRoles: row.membership_roles,
    mfa: !isImpersonation && row.mfa_verified,
    ...(isImpersonation ? { impersonatedBy: (claims as { act: { sub: string } }).act.sub } : {}),
  };
  return ok({ principal, claims });
}

// -----------------------------------------------------------------------------
// Refresh à rotation
// -----------------------------------------------------------------------------

export interface RefreshInput {
  refreshToken: string;
  meta: RequestMeta;
}

export interface RefreshOutcome {
  session: IssuedSession;
}

const refreshInvalid = (): UnauthorizedError => new UnauthorizedError("Session expirée. Reconnectez-vous.", { code: AuthErrorCodes.refreshInvalid });

export async function refresh(deps: IamDeps, input: RefreshInput): Promise<Result<RefreshOutcome, AppError>> {
  const parsed = parseRefreshToken(input.refreshToken);
  if (!parsed) return err(refreshInvalid());

  const ipKey = limiterKey(deps.config.keys.tokenHash, "refresh:ip", input.meta.ip ?? "unknown");
  const hit = await deps.limiter.hit(ipKey, deps.config.refreshIpLimit);
  if (!hit.allowed) return err(new TooManyAttemptsError(hit.retryAfterMs));

  const tokenHash = hashOpaqueToken(deps.config.keys.tokenHash, input.refreshToken);
  const tenantId = parsed.tenantId;

  type Inner = { kind: "invalid" } | { kind: "reuse" } | { kind: "ok"; session: IssuedSession };
  const inner = await deps.tenantDb.run(systemContext(tenantId, input.meta.requestId), async (tx): Promise<Inner> => {
    const now = deps.clock.now();
    const row = await sessions.lockRefreshToken(tx, tenantId, tokenHash);
    if (!row) return { kind: "invalid" };

    if (row.used_at !== null) {
      // Jeton déjà échangé. Tolérance configurable pour une double soumission légitime
      // (réseau mobile) : on refuse sans sanction ; au-delà, c'est une RÉUTILISATION.
      if (deps.config.refreshReuseGraceMs > 0 && now.getTime() - row.used_at.getTime() <= deps.config.refreshReuseGraceMs) {
        return { kind: "invalid" };
      }
      if (row.session_revoked_at === null) {
        const ctx = userContext(tenantId, row.identity_id, [], input.meta.requestId);
        await sessions.revokeSession(tx, tenantId, row.session_id, "refresh_reuse", null, now);
        await publish(
          deps,
          tx,
          ctx,
          IAM_EVENT.sessionRevoked,
          { sessionId: row.session_id, identityId: row.identity_id, reason: "refresh_reuse", scope: "family", ip: input.meta.ip, userAgent: input.meta.userAgent },
          { type: "session", id: row.session_id },
        );
      }
      return { kind: "reuse" };
    }

    if (row.kind !== "user" || row.session_revoked_at !== null || row.expires_at <= now || row.session_expires_at <= now) {
      return { kind: "invalid" };
    }
    const check = await sessions.findSessionForRequest(tx, tenantId, row.session_id);
    if (
      !check ||
      check.revoked_at !== null ||
      check.session_epoch !== check.identity_epoch ||
      check.identity_status !== "active" ||
      check.membership_status !== "active" ||
      check.tenant_status !== "active"
    ) {
      return { kind: "invalid" };
    }
    // Politique MFA : un rôle devenu sensible interdit le renouvellement d'une session sans MFA.
    if (!check.mfa_verified && deps.mfaPolicy.requiredFor(check.membership_roles)) return { kind: "invalid" };

    const roles = check.membership_roles;
    const activeRole = roles.includes(row.active_role) ? row.active_role : (roles[0] as string);
    const newTokenId = newId();
    if (!(await sessions.markRefreshUsed(tx, tenantId, row.id, newTokenId, now))) return { kind: "reuse" };
    const next = await issueRefreshToken(deps, tx, tenantId, row.session_id, row.session_expires_at, newTokenId);
    await sessions.touchSession(tx, tenantId, row.session_id, now, input.meta.ip);

    const access = issueBearerToken(deps.config, deps.clock, {
      userId: row.identity_id,
      tenantId,
      tenantSlug: check.tenant_slug,
      roles,
      activeRole,
      sessionId: row.session_id,
      membershipId: row.membership_id,
      mfa: row.mfa_verified,
      amr: row.amr as Amr[],
    });
    return {
      kind: "ok",
      session: {
        sessionId: row.session_id,
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        claims: access.claims,
        refreshToken: next.token,
        refreshExpiresAt: next.expiresAt,
      },
    };
  });

  if (inner.kind !== "ok") {
    if (inner.kind === "reuse") {
      deps.logger.warn({ event: "iam_refresh_reuse", tenantId, ip: input.meta.ip }, "Réutilisation d'un refresh token : session révoquée");
    }
    return err(refreshInvalid());
  }
  return ok({ session: inner.session });
}

// -----------------------------------------------------------------------------
// Logout
// -----------------------------------------------------------------------------

async function revokeAndPublish(
  deps: IamDeps,
  tx: Tx,
  tenantId: string,
  sessionId: string,
  reason: string,
  by: string | null,
  meta: RequestMeta,
  constraint?: { identityId: string },
): Promise<boolean> {
  const revoked = await sessions.revokeSession(tx, tenantId, sessionId, reason, by, deps.clock.now(), constraint);
  if (!revoked) return false;
  const ctx = by ? userContext(tenantId, by, [], meta.requestId) : systemContext(tenantId, meta.requestId);
  await publish(deps, tx, ctx, IAM_EVENT.sessionRevoked, { sessionId, identityId: revoked.identity_id, reason, scope: "one", revokedBy: by, ip: meta.ip, userAgent: meta.userAgent }, { type: "session", id: sessionId });
  return true;
}

/** Logout par jeton d'accès valide. Idempotent. */
export async function logout(deps: IamDeps, principal: AuthenticatedPrincipal, meta: RequestMeta): Promise<void> {
  await deps.tenantDb.run(principal.ctx, async (tx) => {
    await revokeAndPublish(deps, tx, principal.ctx.tenantId, principal.sessionId, "logout", principal.identityId, meta, { identityId: principal.identityId });
  });
}

/** Logout par refresh token (jeton d'accès expiré). Idempotent ; ne révèle rien sur la validité du jeton. */
export async function logoutByRefreshToken(deps: IamDeps, refreshToken: string, meta: RequestMeta): Promise<void> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return;
  const hash = hashOpaqueToken(deps.config.keys.tokenHash, refreshToken);
  await deps.tenantDb.run(systemContext(parsed.tenantId, meta.requestId), async (tx) => {
    const row = await sessions.lockRefreshToken(tx, parsed.tenantId, hash);
    if (row) await revokeAndPublish(deps, tx, parsed.tenantId, row.session_id, "logout", row.identity_id, meta);
  });
}

/**
 * Déconnexion de TOUS les appareils, dans TOUS les tenants : `auth_epoch + 1` invalide
 * d'un coup les sessions de chaque tenant ; les lignes du tenant courant sont en plus
 * marquées révoquées (liste et audit cohérents).
 */
export async function logoutAll(deps: IamDeps, principal: AuthenticatedPrincipal, meta: RequestMeta): Promise<{ revoked: number }> {
  const tenantId = principal.ctx.tenantId;
  return deps.tenantDb.run(principal.ctx, async (tx) => {
    const now = deps.clock.now();
    await identities.bumpAuthEpoch(tx, principal.identityId, now);
    const revoked = await sessions.revokeSessionsOfIdentity(tx, tenantId, principal.identityId, "logout_all", principal.identityId, now);
    await publish(
      deps,
      tx,
      principal.ctx,
      IAM_EVENT.sessionRevoked,
      { identityId: principal.identityId, reason: "logout_all", scope: "all", sessionIds: revoked.map((r) => r.id), ip: meta.ip },
      { type: "identity", id: principal.identityId },
    );
    return { revoked: revoked.length };
  });
}

// -----------------------------------------------------------------------------
// Liste et révocation
// -----------------------------------------------------------------------------

export interface SessionView extends sessions.SessionListRow {
  current: boolean;
}

export async function listMySessions(deps: IamDeps, principal: AuthenticatedPrincipal): Promise<SessionView[]> {
  const rows = await deps.tenantDb.run(
    principal.ctx,
    (tx) => sessions.listActiveSessions(tx, principal.ctx.tenantId, principal.identityId, deps.clock.now()),
    { readOnly: true },
  );
  return rows.map((r) => ({ ...r, current: r.id === principal.sessionId }));
}

/** Révoque UNE de ses propres sessions (appareil perdu). Une session d'une autre personne répond comme une session inexistante. */
export async function revokeMySession(deps: IamDeps, principal: AuthenticatedPrincipal, sessionId: string, meta: RequestMeta): Promise<Result<void, AppError>> {
  const done = await deps.tenantDb.run(principal.ctx, (tx) =>
    revokeAndPublish(deps, tx, principal.ctx.tenantId, sessionId, "revoked_by_user", principal.identityId, meta, { identityId: principal.identityId }),
  );
  return done ? ok(undefined) : err(new ForbiddenError("Session introuvable.", { code: AuthErrorCodes.forbidden }));
}

/** Révocation par un administrateur (permission `iam.session.revoke`, vérifiée par l'appelant) : toutes les sessions d'un membre DU TENANT. */
export async function adminRevokeMemberSessions(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  membershipId: string,
  meta: RequestMeta,
): Promise<Result<{ revoked: number }, AppError>> {
  return deps.tenantDb.run(principal.ctx, async (tx): Promise<Result<{ revoked: number }, AppError>> => {
    const tenantId = principal.ctx.tenantId;
    const m = await memberships.findMembershipById(tx, tenantId, membershipId);
    if (!m) return err(new ForbiddenError("Membre introuvable.", { code: AuthErrorCodes.forbidden }));
    const revoked = await sessions.revokeSessionsOfIdentity(tx, tenantId, m.identity_id, "revoked_by_admin", principal.identityId, deps.clock.now());
    if (revoked.length > 0) {
      await publish(
        deps,
        tx,
        principal.ctx,
        IAM_EVENT.sessionRevoked,
        { identityId: m.identity_id, reason: "revoked_by_admin", scope: "member", sessionIds: revoked.map((r) => r.id), revokedBy: principal.identityId, ip: meta.ip },
        { type: "membership", id: m.id },
      );
    }
    return ok({ revoked: revoked.length });
  });
}

// -----------------------------------------------------------------------------
// Changement de tenant actif
// -----------------------------------------------------------------------------

export async function switchTenant(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  input: { tenantId: string; deviceName?: string | undefined; meta: RequestMeta },
): Promise<Result<LoginOutcome, AppError>> {
  if (principal.impersonatedBy) {
    return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  }
  if (input.tenantId === principal.ctx.tenantId) {
    return err(new ConflictError("Cet établissement est déjà actif.", { code: "iam.same_tenant" }));
  }
  const noAccess = (): AppError => new ForbiddenError("Aucun accès actif pour cet établissement.", { code: AuthErrorCodes.noActiveAccess });

  // L'annuaire dit OÙ l'identité a un accès ; l'autorité reste le membership lu sous RLS.
  const tenants = await deps.systemDb.run("iam.switch-tenant.lookup", (tx) => identities.listTenantsOfIdentity(tx, principal.identityId), { readOnly: true });
  const target = tenants.find((t) => t.id === input.tenantId && t.status === "active");
  if (!target) return err(noAccess());

  const { config, clock } = deps;
  const requestId = input.meta.requestId;
  const deviceName = cleanText(input.deviceName, 80);
  const ctx = userContext(target.id, principal.identityId, [], requestId);

  type Inner = { kind: "no_access" } | { kind: "outcome"; outcome: LoginOutcome; direct: boolean };
  const inner = await deps.tenantDb.run(ctx, async (tx): Promise<Inner> => {
    const now = clock.now();
    const fresh = await identities.findIdentityById(tx, principal.identityId);
    const membership = await memberships.findMembershipByIdentity(tx, target.id, principal.identityId);
    if (!fresh || fresh.status !== "active" || !membership || membership.status !== "active") return { kind: "no_access" };

    const roles = membership.roles;
    const activeRole = chooseActiveRole(roles, null, membership.active_role, membership.base_role);
    const policyRequires = deps.mfaPolicy.requiredFor(roles);

    const needsStep = (fresh.mfa_enabled && !principal.mfa) || (!fresh.mfa_enabled && policyRequires);
    if (needsStep) {
      const purpose = fresh.mfa_enabled ? "login" : "enroll";
      const ttl = purpose === "login" ? config.challengeTtlSec : config.enrollTtlSec;
      const challengeId = newId();
      await sessions.insertChallenge(tx, {
        id: challengeId,
        tenantId: target.id,
        identityId: principal.identityId,
        membershipId: membership.id,
        purpose,
        activeRole,
        sourceSessionId: principal.sessionId,
        sourceTenantId: principal.ctx.tenantId,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
        deviceName,
        maxAttempts: config.mfa.maxChallengeAttempts,
        now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
      });
      const step = issueStepToken(config, clock, {
        purpose: purpose === "login" ? "mfa_challenge" : "mfa_enroll",
        identityId: principal.identityId,
        tenantId: target.id,
        challengeId,
        ttlSec: ttl,
      });
      return {
        kind: "outcome",
        direct: false,
        outcome:
          purpose === "login"
            ? { status: "mfa_required", challengeToken: step.token, expiresInSec: ttl, methods: ["totp", "recovery_code"] }
            : { status: "mfa_enrollment_required", enrollmentToken: step.token, expiresInSec: ttl },
      };
    }

    const mfa = fresh.mfa_enabled && principal.mfa;
    const amr: Amr[] = mfa ? ["pwd", "otp"] : ["pwd"];
    const issued = await startSession(deps, tx, {
      identity: fresh,
      membership,
      tenant: target,
      activeRole,
      mfaVerified: mfa,
      amr,
      meta: input.meta,
      deviceName,
      authEpoch: fresh.auth_epoch,
    });
    await identities.recordLogin(tx, principal.identityId, target.id, now);
    await publishLoggedIn(deps, tx, userContext(target.id, principal.identityId, roles, requestId), {
      identityId: principal.identityId,
      membershipId: membership.id,
      sessionId: issued.sessionId,
      mfa,
      amr,
      method: "switch_tenant",
      meta: input.meta,
    });
    return {
      kind: "outcome",
      direct: true,
      outcome: { status: "authenticated", session: issued, user: toUserSummary(fresh, target, roles, activeRole), tenants: toTenantSummaries(tenants) },
    };
  });

  if (inner.kind === "no_access") return err(noAccess());
  if (inner.direct) {
    await revokeSourceSession(deps, principal.identityId, { id: principal.sessionId, tenantId: principal.ctx.tenantId }, requestId);
  }
  return ok(inner.outcome);
}

// -----------------------------------------------------------------------------
// Entretien
// -----------------------------------------------------------------------------

/** Purge les sessions expirées/révoquées et les challenges périmés depuis plus de `retentionDays` (tâche planifiée). */
export async function purgeExpiredData(deps: Pick<IamDeps, "clock" | "systemDb">, retentionDays = 30): Promise<{ tenants: number; sessions: number; challenges: number; failed: number }> {
  const cutoff = new Date(deps.clock.now().getTime() - retentionDays * 86_400_000);
  const report = await deps.systemDb.forEachTenant("iam.purge-expired", (tx, tenant) => sessions.purgeExpired(tx, tenant.id, cutoff));
  return {
    tenants: report.succeeded.length,
    sessions: report.succeeded.reduce((n, r) => n + r.result.sessions, 0),
    challenges: report.succeeded.reduce((n, r) => n + r.result.challenges, 0),
    failed: report.failed.length,
  };
}
