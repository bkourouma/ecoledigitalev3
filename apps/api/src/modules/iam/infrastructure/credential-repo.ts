/**
 * Codes de secours MFA et jetons de réinitialisation / invitation — tables
 * GLOBALES (identity-level, pré-tenant). Les valeurs en clair n'arrivent jamais
 * ici : uniquement des empreintes HMAC.
 */
import type { Tx } from "@ecoledigitale/database";

// -----------------------------------------------------------------------------
// Codes de secours
// -----------------------------------------------------------------------------

export async function replaceRecoveryCodes(tx: Tx, identityId: string, ids: readonly string[], hashes: readonly string[], now: Date): Promise<void> {
  await tx.query(`DELETE FROM iam.mfa_recovery_codes WHERE identity_id = $1`, [identityId]);
  for (let i = 0; i < hashes.length; i += 1) {
    await tx.query(
      `INSERT INTO iam.mfa_recovery_codes (id, identity_id, code_hash, created_at) VALUES ($1, $2, $3, $4)`,
      [ids[i], identityId, hashes[i], now],
    );
  }
}

export async function deleteRecoveryCodes(tx: Tx, identityId: string): Promise<void> {
  await tx.query(`DELETE FROM iam.mfa_recovery_codes WHERE identity_id = $1`, [identityId]);
}

/** Consomme un code de secours : `true` une seule fois par code (UPDATE conditionnel, atomique). */
export async function consumeRecoveryCode(tx: Tx, identityId: string, codeHash: string, now: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE iam.mfa_recovery_codes SET used_at = $3 WHERE identity_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [identityId, codeHash, now],
  );
  return res.rowCount === 1;
}

export async function countUnusedRecoveryCodes(tx: Tx, identityId: string): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM iam.mfa_recovery_codes WHERE identity_id = $1 AND used_at IS NULL`, [identityId]);
  return row?.n ?? 0;
}

// -----------------------------------------------------------------------------
// Jetons de réinitialisation / invitation
// -----------------------------------------------------------------------------

export async function insertResetToken(
  tx: Tx,
  t: { id: string; identityId: string; purpose: "reset" | "invitation"; tokenHash: string; now: Date; expiresAt: Date; ip: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO iam.password_reset_tokens (id, identity_id, purpose, token_hash, created_at, expires_at, requested_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`,
    [t.id, t.identityId, t.purpose, t.tokenHash, t.now, t.expiresAt, t.ip],
  );
}

/** Invalide les jetons encore ouverts d'une identité (un nouveau jeton remplace les précédents). */
export async function invalidateOpenResetTokens(tx: Tx, identityId: string, now: Date): Promise<void> {
  await tx.query(`UPDATE iam.password_reset_tokens SET used_at = $2 WHERE identity_id = $1 AND used_at IS NULL`, [identityId, now]);
}

export interface ResetTokenRow {
  id: string;
  identity_id: string;
  purpose: "reset" | "invitation";
}

/**
 * Consomme un jeton valide (non utilisé, non expiré) : usage unique garanti par
 * l'UPDATE conditionnel — deux requêtes concurrentes avec le même jeton, une seule réussit.
 */
export function consumeResetToken(tx: Tx, tokenHash: string, now: Date): Promise<ResetTokenRow | null> {
  return tx.queryOne<ResetTokenRow>(
    `UPDATE iam.password_reset_tokens SET used_at = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
      RETURNING id, identity_id, purpose`,
    [tokenHash, now],
  );
}
