/**
 * Création d'une session et de ses jetons (dans une transaction de tenant) +
 * mise en forme commune de la réponse d'authentification.
 */
import { newId, type RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { issueBearerToken, type BearerClaims } from "../domain/access-token";
import { formatRefreshToken, hashOpaqueToken, randomSecret } from "../domain/tokens";
import * as sessions from "../infrastructure/session-repo";
import type { IdentityRow, TenantRow } from "../infrastructure/identity-repo";
import type { MembershipRow } from "../infrastructure/membership-repo";
import { IAM_EVENT, publish, type IamDeps, type RequestMeta } from "./deps";

/** Facteurs : mot de passe, TOTP, code de secours, impersonation, identité fédérée (Google, vérifiée par le serveur web). */
export type Amr = "pwd" | "otp" | "rcv" | "imp" | "fed";

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: Date;
  claims: BearerClaims;
  /** Absent pour une session d'impersonation (non renouvelable). */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

export interface UserSummary {
  id: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  activeRole: string;
  roles: string[];
  availableRoles: string[];
  requiresRoleSelection: boolean;
  mfaEnabled: boolean;
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
}

export interface AuthenticatedOutcome {
  status: "authenticated";
  session: IssuedSession;
  user: UserSummary;
  tenants: TenantSummary[];
}

export interface MfaRequiredOutcome {
  status: "mfa_required";
  challengeToken: string;
  expiresInSec: number;
  methods: Array<"totp" | "recovery_code">;
}

export interface MfaEnrollmentRequiredOutcome {
  status: "mfa_enrollment_required";
  enrollmentToken: string;
  expiresInSec: number;
}

export type LoginOutcome = AuthenticatedOutcome | MfaRequiredOutcome | MfaEnrollmentRequiredOutcome;

/** Rôle actif : demandé (s'il appartient à l'utilisateur) > mémorisé > rôle de base. */
export function chooseActiveRole(roles: readonly string[], requested: string | undefined | null, stored: string | null, base: string): string {
  if (requested && roles.includes(requested)) return requested;
  if (stored && roles.includes(stored)) return stored;
  return roles.includes(base) ? base : (roles[0] as string);
}

export interface StartSessionInput {
  identity: IdentityRow;
  membership: MembershipRow;
  tenant: TenantRow;
  activeRole: string;
  mfaVerified: boolean;
  amr: readonly Amr[];
  meta: RequestMeta;
  deviceName: string | null;
  /** Époque d'authentification lue au même moment que le contrôle des identifiants. */
  authEpoch: number;
}

/** Insère la session + son premier refresh token, émet les jetons. Doit être appelée DANS `tenantDb.run`. */
export async function startSession(deps: IamDeps, tx: Tx, input: StartSessionInput): Promise<IssuedSession> {
  const { config, clock } = deps;
  const now = clock.now();
  const sessionId = newId();
  const sessionExpires = new Date(now.getTime() + config.sessionMaxAgeSec * 1000);

  await sessions.insertSession(tx, {
    id: sessionId,
    tenantId: input.tenant.id,
    identityId: input.identity.id,
    membershipId: input.membership.id,
    kind: "user",
    activeRole: input.activeRole,
    authEpoch: input.authEpoch,
    mfaVerified: input.mfaVerified,
    amr: input.amr,
    ip: input.meta.ip,
    userAgent: input.meta.userAgent,
    deviceName: input.deviceName,
    actorId: null,
    reason: null,
    now,
    expiresAt: sessionExpires,
  });

  const refresh = await issueRefreshToken(deps, tx, input.tenant.id, sessionId, sessionExpires);

  const access = issueBearerToken(config, clock, {
    userId: input.identity.id,
    tenantId: input.tenant.id,
    tenantSlug: input.tenant.slug,
    roles: input.membership.roles,
    activeRole: input.activeRole,
    sessionId,
    membershipId: input.membership.id,
    mfa: input.mfaVerified,
    amr: input.amr,
  });

  return {
    sessionId,
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    claims: access.claims,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export async function issueRefreshToken(
  deps: Pick<IamDeps, "clock" | "config">,
  tx: Tx,
  tenantId: string,
  sessionId: string,
  sessionExpiresAt: Date,
  replacesId?: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = deps.clock.now();
  const idleExpiry = new Date(now.getTime() + deps.config.refreshIdleTtlSec * 1000);
  const expiresAt = idleExpiry < sessionExpiresAt ? idleExpiry : sessionExpiresAt;
  const token = formatRefreshToken(tenantId, randomSecret(32));
  const id = replacesId ?? newId();
  await sessions.insertRefreshToken(tx, {
    id,
    tenantId,
    sessionId,
    tokenHash: hashOpaqueToken(deps.config.keys.tokenHash, token),
    now,
    expiresAt,
  });
  return { id, token, expiresAt };
}

export function toUserSummary(identity: Pick<IdentityRow, "id" | "email" | "mfa_enabled">, tenant: Pick<TenantRow, "id" | "slug">, roles: readonly string[], activeRole: string): UserSummary {
  return {
    id: identity.id,
    email: identity.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    activeRole,
    roles: [activeRole],
    availableRoles: [...roles],
    requiresRoleSelection: roles.length > 1,
    mfaEnabled: identity.mfa_enabled,
  };
}

export function toTenantSummaries(rows: readonly TenantRow[]): TenantSummary[] {
  return rows.filter((t) => t.status === "active").map((t) => ({ id: t.id, slug: t.slug, name: t.name }));
}

/** Événement `iam.user.logged_in` (même charge utile pour login, MFA, switch-tenant). */
export async function publishLoggedIn(
  deps: IamDeps,
  tx: Tx,
  ctx: RequestContext,
  p: { identityId: string; membershipId: string; sessionId: string; mfa: boolean; amr: readonly Amr[]; method: string; meta: RequestMeta },
): Promise<void> {
  await publish(deps, tx, ctx, IAM_EVENT.userLoggedIn, {
    identityId: p.identityId,
    membershipId: p.membershipId,
    sessionId: p.sessionId,
    mfa: p.mfa,
    amr: p.amr,
    method: p.method,
    ip: p.meta.ip,
    userAgent: p.meta.userAgent,
  }, { type: "session", id: p.sessionId });
}
