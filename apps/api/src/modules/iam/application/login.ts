/**
 * Login : e-mail + mot de passe → session, ou étape MFA.
 *
 * Propriétés de sécurité (chacune a un test dédié) :
 *  - messages et codes d'échec IDENTIQUES pour « e-mail inconnu », « mot de passe
 *    faux », « compte désactivé », « hash illisible » ;
 *  - travail de hachage équivalent dans tous les cas (calcul factice si le compte
 *    n'existe pas) + plancher de durée sur tout échec (`failureMinDurationMs`) ;
 *  - compteurs d'échecs indexés par l'EMPREINTE de l'e-mail saisi, qu'il existe ou
 *    non : le verrouillage ne révèle donc rien sur l'existence du compte ;
 *  - verrouillage progressif par (identité, IP), plus un plafond par identité et un
 *    plafond de débit par IP ;
 *  - le tenant n'est jamais lu d'un champ non authentifié : il est choisi PARMI
 *    les accès de l'identité (annuaire), puis l'accès est vérifié sous RLS ;
 *  - mot de passe correct mais accès au tenant inactif : réponse distincte
 *    (`iam.no_active_access`), acceptable car l'appelant a prouvé son identité.
 */
import {
  ForbiddenError,
  err,
  newId,
  ok,
  type Result,
  type AppError,
} from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { issueStepToken } from "../domain/access-token";
import { isPlausibleEmail, normalizeEmail } from "../domain/email";
import { limiterKey } from "../domain/tokens";
import * as identities from "../infrastructure/identity-repo";
import type { IdentityRow, TenantRow } from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import {
  IAM_EVENT,
  TooManyAttemptsError,
  cleanText,
  invalidCredentials,
  padToMinimum,
  publish,
  startTimer,
  systemContext,
  userContext,
  type IamDeps,
  type RequestMeta,
} from "./deps";
import {
  chooseActiveRole,
  publishLoggedIn,
  startSession,
  toTenantSummaries,
  toUserSummary,
  type Amr,
  type LoginOutcome,
} from "./session-issue";

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string | undefined;
  activeRole?: string | undefined;
  deviceName?: string | undefined;
  meta: RequestMeta;
}

export type FailureReason = "unknown_identity" | "bad_password" | "identity_disabled" | "no_password" | "locked" | "no_active_access" | "rate_limited";

export async function login(deps: IamDeps, input: LoginInput): Promise<Result<LoginOutcome, AppError>> {
  const startedAt = startTimer();
  const result = await loginInner(deps, input);
  // Plancher de durée sur TOUT échec : la durée ne dépend plus du travail réellement fait.
  if (!result.ok) await padToMinimum(deps, startedAt, deps.config.failureMinDurationMs);
  return result;
}

async function loginInner(deps: IamDeps, input: LoginInput): Promise<Result<LoginOutcome, AppError>> {
  const { config, limiter, clock } = deps;
  const email = normalizeEmail(input.email);
  const plausible = isPlausibleEmail(email);
  const ip = input.meta.ip ?? "unknown";
  const pairKey = limiterKey(config.keys.tokenHash, "login:pair", `${email}|${ip}`);
  const idKey = limiterKey(config.keys.tokenHash, "login:id", email);
  const ipKey = limiterKey(config.keys.tokenHash, "login:ip", ip);

  // 1. Débit par IP puis verrous (identité+IP, identité). Aucun accès base tant qu'on est limité.
  const window = await limiter.hit(ipKey, config.loginIpLimit);
  if (!window.allowed) {
    deps.logger.warn({ event: "iam_login_blocked", reason: "rate_limited", ip: input.meta.ip }, "Login limité par IP");
    return err(new TooManyAttemptsError(window.retryAfterMs));
  }
  const [pairLock, idLock] = await Promise.all([limiter.lockStatus(pairKey), limiter.lockStatus(idKey)]);
  if (pairLock.blocked || idLock.blocked) {
    deps.logger.warn({ event: "iam_login_blocked", reason: "locked", ip: input.meta.ip }, "Login verrouillé");
    return err(new TooManyAttemptsError(Math.max(pairLock.retryAfterMs, idLock.retryAfterMs)));
  }

  // 2. Lecture globale (identité + annuaire de ses tenants + éventuel tenant demandé).
  const lookup = !plausible
    ? { identity: null, tenants: [], hinted: null }
    : await deps.systemDb.run(
    "iam.login.lookup",
    async (tx) => {
      const identity = await identities.findIdentityByEmail(tx, email);
      const tenants = identity ? await identities.listTenantsOfIdentity(tx, identity.id) : [];
      const hinted = input.tenantSlug ? await identities.findTenantBySlug(tx, input.tenantSlug) : null;
      return { identity, tenants, hinted };
    },
    { readOnly: true },
  );
  const { identity, tenants, hinted } = lookup;

  // 3. Vérification du mot de passe (calcul factice si le compte n'existe pas / n'a pas de mot de passe).
  const verification = await deps.hasher.verify(identity?.password_hash ?? null, input.password);
  const credentialsOk = verification.ok && identity !== null && identity.status === "active";

  // Tenant choisi PARMI les accès de l'identité (jamais d'après un champ non authentifié).
  const activeTenants = tenants.filter((t) => t.status === "active");
  const chosen = input.tenantSlug
    ? activeTenants.find((t) => t.slug === input.tenantSlug)
    : (activeTenants.find((t) => t.id === identity?.last_tenant_id) ?? activeTenants[0]);

  if (!credentialsOk || !identity) {
    const reason: FailureReason = !identity ? "unknown_identity" : identity.status !== "active" ? "identity_disabled" : !identity.password_hash ? "no_password" : "bad_password"; // secret-scan:allow (code de raison, pas un secret)
    const [pairState, idState] = await Promise.all([limiter.recordFailure(pairKey, config.loginPairLockout), limiter.recordFailure(idKey, config.loginIdentityLockout)]);
    recordFailureInBackground(deps, {
      locked: pairState.blocked || idState.blocked,
      tenantId: hinted?.status === "active" ? hinted.id : (chosen?.id ?? null),
      reason,
      email,
      identityId: identity?.id ?? null,
      meta: input.meta,
    });
    return err(invalidCredentials());
  }

  // Les identifiants sont corrects : on remet à zéro les compteurs d'échecs de mot de passe.
  await Promise.all([limiter.clear(pairKey), limiter.clear(idKey)]);

  if (!chosen) {
    deps.logger.info({ event: "iam_login_no_access", identityId: identity.id, requestedSlug: input.tenantSlug ?? null }, "Aucun accès actif");
    return err(new ForbiddenError("Aucun accès actif pour cet établissement.", { code: AuthErrorCodes.noActiveAccess }));
  }
  const tenant = chosen;

  // Re-hachage transparent (bcrypt legacy ou paramètres scrypt plus faibles) : calculé HORS transaction.
  const upgradedHash = verification.needsRehash ? await deps.hasher.hash(input.password) : null;

  return finishLogin(deps, {
    identity,
    tenant,
    tenants,
    activeRole: input.activeRole,
    deviceName: input.deviceName,
    meta: input.meta,
    upgradedHash,
    method: "password",
    amr: ["pwd"],
  });
}

export interface FinishLoginArgs {
  identity: IdentityRow;
  tenant: TenantRow;
  /** Tous les accès de l'identité (annuaire), pour la réponse. */
  tenants: readonly TenantRow[];
  activeRole?: string | undefined;
  deviceName?: string | undefined;
  meta: RequestMeta;
  /** Nouveau hash à poser (re-hachage transparent) ; `null` sinon. */
  upgradedHash: string | null;
  /** Méthode d'authentification journalisée (`password`, `federated:google`). */
  method: string;
  /** Facteurs satisfaits PAR CETTE ÉTAPE (le second facteur éventuel s'ajoute au défi MFA). */
  amr: Amr[];
}

/**
 * Suite commune d'une authentification primaire réussie (mot de passe OU fédération) : accès sous RLS, politique MFA
 * (défi ou enrôlement exigé AVANT toute session), ouverture de la session, événement `iam.user.logged_in`.
 */
export async function finishLogin(deps: IamDeps, a: FinishLoginArgs): Promise<Result<LoginOutcome, AppError>> {
  const { config, clock } = deps;
  const { identity, tenant, tenants } = a;
  const input = { activeRole: a.activeRole, meta: a.meta };
  const requestId = a.meta.requestId;
  const tenantCtx = userContext(tenant.id, identity.id, [], requestId);
  const deviceName = cleanText(a.deviceName, 80);
  const upgradedHash = a.upgradedHash;

  type Inner =
    | { kind: "no_access" }
    | { kind: "stale" }
    | { kind: "outcome"; outcome: LoginOutcome };

  const inner = await deps.tenantDb.run(tenantCtx, async (tx): Promise<Inner> => {
    const now = clock.now();
    const fresh = await identities.findIdentityById(tx, identity.id);
    if (!fresh || fresh.status !== "active" || fresh.password_hash !== identity.password_hash) return { kind: "stale" };

    const membership = await memberships.findMembershipByIdentity(tx, tenant.id, identity.id);
    if (!membership || membership.status !== "active") return { kind: "no_access" };

    if (upgradedHash && identity.password_hash) {
      await identities.replacePasswordHash(tx, identity.id, identity.password_hash, upgradedHash, now);
    }

    const roles = membership.roles;
    const activeRole = chooseActiveRole(roles, input.activeRole, membership.active_role, membership.base_role);
    const ctx = userContext(tenant.id, identity.id, roles, requestId);
    const mfaRequiredByPolicy = deps.mfaPolicy.requiredFor(roles);

    if (fresh.mfa_enabled || mfaRequiredByPolicy) {
      const purpose = fresh.mfa_enabled ? "login" : "enroll";
      const challengeId = newId();
      const ttl = purpose === "login" ? config.challengeTtlSec : config.enrollTtlSec;
      await sessions.insertChallenge(tx, {
        id: challengeId,
        tenantId: tenant.id,
        identityId: identity.id,
        membershipId: membership.id,
        purpose,
        activeRole,
        sourceSessionId: null,
        sourceTenantId: null,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
        deviceName,
        maxAttempts: config.mfa.maxChallengeAttempts,
        now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
      });
      const step = issueStepToken(config, clock, {
        purpose: purpose === "login" ? "mfa_challenge" : "mfa_enroll",
        identityId: identity.id,
        tenantId: tenant.id,
        challengeId,
        ttlSec: ttl,
      });
      return {
        kind: "outcome",
        outcome:
          purpose === "login"
            ? { status: "mfa_required", challengeToken: step.token, expiresInSec: ttl, methods: ["totp", "recovery_code"] }
            : { status: "mfa_enrollment_required", enrollmentToken: step.token, expiresInSec: ttl },
      };
    }

    const issued = await startSession(deps, tx, {
      identity: fresh,
      membership,
      tenant,
      activeRole,
      mfaVerified: false,
      amr: a.amr,
      meta: input.meta,
      deviceName,
      authEpoch: fresh.auth_epoch,
    });
    await identities.recordLogin(tx, identity.id, tenant.id, now);
    await publishLoggedIn(deps, tx, ctx, {
      identityId: identity.id,
      membershipId: membership.id,
      sessionId: issued.sessionId,
      mfa: false,
      amr: a.amr,
      method: a.method,
      meta: input.meta,
    });
    return {
      kind: "outcome",
      outcome: {
        status: "authenticated",
        session: issued,
        user: toUserSummary(fresh, tenant, roles, activeRole),
        tenants: toTenantSummaries([...tenants]),
      },
    };
  });

  if (inner.kind === "stale") return err(invalidCredentials());
  if (inner.kind === "no_access") {
    return err(new ForbiddenError("Aucun accès actif pour cet établissement.", { code: AuthErrorCodes.noActiveAccess }));
  }
  return ok(inner.outcome);
}

/**
 * Télémétrie d'échec : `iam.login.failed` dans l'outbox du tenant concerné, HORS du
 * chemin de réponse (aucun écart de durée observable entre compte connu et inconnu).
 * Sans tenant attribuable (e-mail inconnu, pas de tenant demandé), seul le journal applicatif est alimenté.
 */
export function recordFailureInBackground(
  deps: IamDeps,
  f: { tenantId: string | null; reason: FailureReason; email: string; identityId: string | null; meta: RequestMeta; locked?: boolean },
): void {
  const emailHash = limiterKey(deps.config.keys.tokenHash, "email", f.email).split(":")[1];
  deps.logger.warn(
    { event: "iam_login_failed", reason: f.reason, tenantId: f.tenantId, emailHash, ip: f.meta.ip, requestId: f.meta.requestId },
    "Échec de connexion",
  );
  const tenantId = f.tenantId;
  if (!tenantId) return;
  deps.background.run("iam.login.failed", async () => {
    const ctx = systemContext(tenantId, f.meta.requestId);
    await deps.tenantDb.run(ctx, async (tx) => {
      await publish(deps, tx, ctx, IAM_EVENT.loginFailed, {
        reason: f.reason,
        // Empreinte (pas l'adresse brute : saisie non fiable, donnée personnelle). Lu par le module audit comme `identifier`.
        identifier: emailHash,
        emailHash,
        identityId: f.identityId,
        locked: f.locked === true,
        ip: f.meta.ip,
        userAgent: f.meta.userAgent,
      });
    });
  });
}
