/**
 * Sessions, jetons de rafraîchissement et challenges MFA — tables de TENANT (RLS).
 * À appeler dans `TenantDb.run(ctx, ...)`.
 */
import type { Tx } from "@ecoledigitale/database";
import { invalidateSessionVerdict } from "@ecoledigitale/kernel";

export interface SessionInsert {
  id: string;
  tenantId: string;
  identityId: string;
  membershipId: string;
  kind: "user" | "impersonation";
  activeRole: string;
  authEpoch: number;
  mfaVerified: boolean;
  amr: readonly string[];
  ip: string | null;
  userAgent: string | null;
  deviceName: string | null;
  actorId: string | null;
  reason: string | null;
  now: Date;
  expiresAt: Date;
}

export async function insertSession(tx: Tx, s: SessionInsert): Promise<void> {
  await tx.query(
    `INSERT INTO iam.sessions
       (id, tenant_id, identity_id, membership_id, kind, active_role, auth_epoch, mfa_verified, amr,
        ip, last_ip, user_agent, device_name, actor_id, reason, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::inet, $10::inet, $11, $12, $13, $14, $15, $15, $16)`,
    [s.id, s.tenantId, s.identityId, s.membershipId, s.kind, s.activeRole, s.authEpoch, s.mfaVerified, [...s.amr], s.ip, s.userAgent, s.deviceName, s.actorId, s.reason, s.now, s.expiresAt],
  );
}

export interface SessionCheckRow {
  id: string;
  identity_id: string;
  membership_id: string;
  kind: "user" | "impersonation";
  active_role: string;
  mfa_verified: boolean;
  /** Fin de l'élévation MFA (step-up) ; `null` = jamais élevée. */
  mfa_elevated_until: Date | null;
  actor_id: string | null;
  session_epoch: number;
  expires_at: Date;
  revoked_at: Date | null;
  identity_email: string;
  identity_status: "active" | "disabled";
  identity_epoch: number;
  identity_mfa_enabled: boolean;
  membership_status: "invited" | "active" | "suspended" | "revoked";
  membership_roles: string[];
  tenant_status: "active" | "suspended" | "archived";
  tenant_slug: string;
}

/** Tout ce qu'il faut pour décider, en UNE requête, si une session est encore valide. */
export function findSessionForRequest(tx: Tx, tenantId: string, sessionId: string): Promise<SessionCheckRow | null> {
  return tx.queryOne<SessionCheckRow>(
    `SELECT s.id, s.identity_id, s.membership_id, s.kind, s.active_role, s.mfa_verified, s.mfa_elevated_until, s.actor_id,
            s.auth_epoch AS session_epoch, s.expires_at, s.revoked_at,
            i.email AS identity_email, i.status AS identity_status, i.auth_epoch AS identity_epoch, i.mfa_enabled AS identity_mfa_enabled,
            m.status AS membership_status, m.roles AS membership_roles,
            t.status AS tenant_status, t.slug AS tenant_slug
       FROM iam.sessions s
       JOIN iam.identities i ON i.id = s.identity_id
       JOIN iam.memberships m ON m.id = s.membership_id
       JOIN kernel.tenants t ON t.id = s.tenant_id
      WHERE s.id = $2 AND s.tenant_id = $1`,
    [tenantId, sessionId],
  );
}

/** Marque la session comme élevée (MFA satisfaite) jusqu'à `until`. `false` = session absente, révoquée ou d'impersonation. */
export async function elevateSession(tx: Tx, tenantId: string, sessionId: string, until: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE iam.sessions SET mfa_elevated_until = $3 WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL AND kind = 'user'`,
    [tenantId, sessionId, until],
  );
  return res.rowCount === 1;
}

export interface SessionListRow {
  id: string;
  kind: "user" | "impersonation";
  active_role: string;
  mfa_verified: boolean;
  ip: string | null;
  user_agent: string | null;
  device_name: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

/** Sessions ACTIVES (non révoquées, non expirées, non invalidées par l'époque) d'une identité dans le tenant courant. */
export function listActiveSessions(tx: Tx, tenantId: string, identityId: string, now: Date): Promise<SessionListRow[]> {
  return tx.many<SessionListRow>(
    `SELECT s.id, s.kind, s.active_role, s.mfa_verified, host(s.last_ip) AS ip, s.user_agent, s.device_name,
            s.created_at, s.last_seen_at, s.expires_at
       FROM iam.sessions s
       JOIN iam.identities i ON i.id = s.identity_id
      WHERE s.tenant_id = $1 AND s.identity_id = $2
        AND s.revoked_at IS NULL AND s.expires_at > $3 AND s.auth_epoch = i.auth_epoch
      ORDER BY s.last_seen_at DESC, s.id`,
    [tenantId, identityId, now],
  );
}

export interface RevokedSession {
  id: string;
  identity_id: string;
  kind: "user" | "impersonation";
}

/**
 * Écrit `revoked_at` : donnée du verdict de session. Le cache de verdict est invalidé DANS la transaction, avant
 * l'écriture (échec fermé : si l'invalidation ne peut être enregistrée, l'appelant est annulé).
 */
export async function revokeSession(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  reason: string,
  revokedBy: string | null,
  now: Date,
  constraint?: { identityId: string },
): Promise<RevokedSession | null> {
  await invalidateSessionVerdict(tx, { kind: "session", tenantId, sessionId });
  const params: unknown[] = [tenantId, sessionId, now, reason, revokedBy];
  let extra = "";
  if (constraint) {
    params.push(constraint.identityId);
    extra = ` AND identity_id = $${params.length}`;
  }
  return tx.queryOne<RevokedSession>(
    `UPDATE iam.sessions SET revoked_at = $3, revoked_reason = $4, revoked_by = $5
      WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL${extra}
      RETURNING id, identity_id, kind`,
    params,
  );
}

/** Révoque les sessions de l'identité dans le tenant : toute la portée « identité » du cache de verdict est invalidée. */
export async function revokeSessionsOfIdentity(
  tx: Tx,
  tenantId: string,
  identityId: string,
  reason: string,
  revokedBy: string | null,
  now: Date,
  exceptSessionId?: string,
): Promise<RevokedSession[]> {
  await invalidateSessionVerdict(tx, { kind: "identity", identityId });
  const params: unknown[] = [tenantId, identityId, now, reason, revokedBy];
  let extra = "";
  if (exceptSessionId) {
    params.push(exceptSessionId);
    extra = ` AND id <> $${params.length}`;
  }
  return tx.many<RevokedSession>(
    `UPDATE iam.sessions SET revoked_at = $3, revoked_reason = $4, revoked_by = $5
      WHERE tenant_id = $1 AND identity_id = $2 AND revoked_at IS NULL${extra}
      RETURNING id, identity_id, kind`,
    params,
  );
}

export async function touchSession(tx: Tx, tenantId: string, sessionId: string, now: Date, ip: string | null): Promise<void> {
  await tx.query(
    `UPDATE iam.sessions SET last_seen_at = $3, last_ip = COALESCE($4::inet, last_ip) WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sessionId, now, ip],
  );
}

// -----------------------------------------------------------------------------
// Refresh tokens
// -----------------------------------------------------------------------------

export async function insertRefreshToken(
  tx: Tx,
  t: { id: string; tenantId: string; sessionId: string; tokenHash: string; now: Date; expiresAt: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO iam.refresh_tokens (id, tenant_id, session_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [t.id, t.tenantId, t.sessionId, t.tokenHash, t.now, t.expiresAt],
  );
}

export interface RefreshLookupRow {
  id: string;
  session_id: string;
  expires_at: Date;
  used_at: Date | null;
  identity_id: string;
  membership_id: string;
  kind: "user" | "impersonation";
  active_role: string;
  mfa_verified: boolean;
  amr: string[];
  session_epoch: number;
  session_expires_at: Date;
  session_revoked_at: Date | null;
  ip: string | null;
  user_agent: string | null;
  device_name: string | null;
}

/** Verrouille (FOR UPDATE) la ligne du jeton : deux rafraîchissements concurrents se sérialisent. */
export function lockRefreshToken(tx: Tx, tenantId: string, tokenHash: string): Promise<RefreshLookupRow | null> {
  return tx.queryOne<RefreshLookupRow>(
    `SELECT rt.id, rt.session_id, rt.expires_at, rt.used_at,
            s.identity_id, s.membership_id, s.kind, s.active_role, s.mfa_verified, s.amr,
            s.auth_epoch AS session_epoch, s.expires_at AS session_expires_at, s.revoked_at AS session_revoked_at,
            host(s.ip) AS ip, s.user_agent, s.device_name
       FROM iam.refresh_tokens rt
       JOIN iam.sessions s ON s.id = rt.session_id
      WHERE rt.tenant_id = $1 AND rt.token_hash = $2
      FOR UPDATE OF rt`,
    [tenantId, tokenHash],
  );
}

/** Marque le jeton comme utilisé. `false` = déjà utilisé (course perdue) : traiter comme une réutilisation. */
export async function markRefreshUsed(tx: Tx, tenantId: string, id: string, replacedBy: string | null, now: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE iam.refresh_tokens SET used_at = $3, replaced_by = $4 WHERE tenant_id = $1 AND id = $2 AND used_at IS NULL`,
    [tenantId, id, now, replacedBy],
  );
  return res.rowCount === 1;
}

// -----------------------------------------------------------------------------
// Challenges MFA
// -----------------------------------------------------------------------------

export interface ChallengeRow {
  id: string;
  tenant_id: string;
  identity_id: string;
  membership_id: string;
  purpose: "login" | "enroll";
  active_role: string;
  source_session_id: string | null;
  source_tenant_id: string | null;
  ip: string | null;
  user_agent: string | null;
  device_name: string | null;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

export async function insertChallenge(
  tx: Tx,
  c: {
    id: string;
    tenantId: string;
    identityId: string;
    membershipId: string;
    purpose: "login" | "enroll";
    activeRole: string;
    sourceSessionId: string | null;
    sourceTenantId: string | null;
    ip: string | null;
    userAgent: string | null;
    deviceName: string | null;
    maxAttempts: number;
    now: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO iam.login_challenges
       (id, tenant_id, identity_id, membership_id, purpose, active_role, source_session_id, source_tenant_id, ip, user_agent, device_name, max_attempts, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11, $12, $13, $14)`,
    [c.id, c.tenantId, c.identityId, c.membershipId, c.purpose, c.activeRole, c.sourceSessionId, c.sourceTenantId, c.ip, c.userAgent, c.deviceName, c.maxAttempts, c.now, c.expiresAt],
  );
}

export function lockChallenge(tx: Tx, tenantId: string, id: string): Promise<ChallengeRow | null> {
  return tx.queryOne<ChallengeRow>(
    `SELECT id, tenant_id, identity_id, membership_id, purpose, active_role, source_session_id, source_tenant_id,
            host(ip) AS ip, user_agent, device_name, attempts, max_attempts, expires_at, consumed_at
       FROM iam.login_challenges WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, id],
  );
}

export async function bumpChallengeAttempts(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.query(`UPDATE iam.login_challenges SET attempts = attempts + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

export async function consumeChallenge(tx: Tx, tenantId: string, id: string, now: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE iam.login_challenges SET consumed_at = $3 WHERE tenant_id = $1 AND id = $2 AND consumed_at IS NULL`,
    [tenantId, id, now],
  );
  return res.rowCount === 1;
}

// -----------------------------------------------------------------------------
// Purge (tâche planifiée, par tenant)
// -----------------------------------------------------------------------------

export async function purgeExpired(tx: Tx, tenantId: string, olderThan: Date): Promise<{ sessions: number; challenges: number }> {
  const s = await tx.query(
    `DELETE FROM iam.sessions WHERE tenant_id = $1 AND (expires_at < $2 OR revoked_at < $2)`,
    [tenantId, olderThan],
  );
  const c = await tx.query(`DELETE FROM iam.login_challenges WHERE tenant_id = $1 AND expires_at < $2`, [tenantId, olderThan]);
  return { sessions: s.rowCount, challenges: c.rowCount };
}
