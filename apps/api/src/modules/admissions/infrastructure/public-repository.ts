/**
 * Formulaire public : jetons à usage unique (empreinte SHA-256 seule) et journal des tentatives (empreintes HMAC d'IP et
 * d'agent, jamais en clair). Les instants des jetons sont calculés par la BASE (`now()`) : une seule horloge pour l'émission, le
 * délai minimal et la consommation.
 */
import type { Tx } from "@ecoledigitale/database";

export async function insertFormSession(
  tx: Tx,
  input: { id: string; tenantId: string; institutionId: string; tokenHash: string; minReadySeconds: number; ttlMinutes: number; ipHash: string | null },
): Promise<{ expiresAt: string; minReadyAt: string }> {
  const r = await tx.queryOne<{ expiresAt: string; minReadyAt: string }>(
    `INSERT INTO admissions.public_form_sessions (id, tenant_id, institution_id, token_hash, issued_at, min_ready_at, expires_at, ip_hash)
     VALUES ($1, $2, $3, $4, now(), now() + make_interval(secs => $5), now() + make_interval(secs => $5) + make_interval(mins => $6), $7)
     RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt", to_char(min_ready_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "minReadyAt"`,
    [input.id, input.tenantId, input.institutionId, input.tokenHash, input.minReadySeconds, input.ttlMinutes, input.ipHash],
  );
  return r as { expiresAt: string; minReadyAt: string };
}

/** Consommation ATOMIQUE : vrai si et seulement si le jeton existe, n'est pas expiré, a dépassé son délai minimal et n'a jamais servi. */
export async function consumeFormSession(tx: Tx, tokenHash: string): Promise<boolean> {
  const r = await tx.queryOne<{ ok: boolean }>(`SELECT admissions.consume_form_session($1) AS ok`, [tokenHash]);
  return r?.ok === true;
}

export async function purgeFormSessions(tx: Tx, olderThanDays: number): Promise<number> {
  const r = await tx.query(`DELETE FROM admissions.public_form_sessions WHERE expires_at < now() - make_interval(days => $1)`, [olderThanDays]);
  return r.rowCount;
}

export async function insertAttempt(
  tx: Tx,
  input: { id: string; tenantId: string; institutionId: string; ipHash: string; uaHash: string | null; outcome: string; applicationId: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.submission_attempts (id, tenant_id, institution_id, ip_hash, ua_hash, outcome, application_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.tenantId, input.institutionId, input.ipHash, input.uaHash, input.outcome, input.applicationId],
  );
}

export async function recentAttempts(tx: Tx, ipHash: string, windowMinutes: number): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(`SELECT admissions.recent_attempts($1, make_interval(mins => $2)) AS n`, [ipHash, windowMinutes]);
  return r?.n ?? 0;
}

export async function purgeAttempts(tx: Tx, olderThanDays: number): Promise<number> {
  const r = await tx.query(`DELETE FROM admissions.submission_attempts WHERE attempted_at < now() - make_interval(days => $1)`, [olderThanDays]);
  return r.rowCount;
}
