/**
 * Accès aux tables GLOBALES `iam.identities` / `iam.identity_tenants` et à
 * `kernel.tenants`. Utilisable dans n'importe quelle transaction (SystemDb ou
 * TenantDb) : ces tables ne sont pas sous RLS (voir isolation-allowlist.iam.ts).
 *
 * Toutes les requêtes sont paramétrées ; les colonnes sont énumérées (jamais `SELECT *`).
 */
import type { Tx } from "@ecoledigitale/database";

export interface IdentityRow {
  id: string;
  email: string;
  status: "active" | "disabled";
  password_hash: string | null;
  auth_epoch: number;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_pending_secret_enc: string | null;
  mfa_last_step: number;
  last_tenant_id: string | null;
}

const IDENTITY_COLUMNS = `id, email, status, password_hash, auth_epoch, mfa_enabled, mfa_secret_enc,
  mfa_pending_secret_enc, mfa_last_step::integer AS mfa_last_step, last_tenant_id`;

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
}

export function findIdentityByEmail(tx: Tx, email: string): Promise<IdentityRow | null> {
  return tx.queryOne<IdentityRow>(`SELECT ${IDENTITY_COLUMNS} FROM iam.identities WHERE email = $1`, [email]);
}

export function findIdentityById(tx: Tx, id: string, lock = false): Promise<IdentityRow | null> {
  return tx.queryOne<IdentityRow>(`SELECT ${IDENTITY_COLUMNS} FROM iam.identities WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
}

/** Insère une identité ; renvoie `false` si l'e-mail existe déjà (course entre deux créations). */
export async function insertIdentity(
  tx: Tx,
  input: { id: string; email: string; passwordHash: string | null; now: Date },
): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO iam.identities (id, email, password_hash, password_changed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (email) DO NOTHING`,
    [input.id, input.email, input.passwordHash, input.passwordHash ? input.now : null, input.now],
  );
  return res.rowCount === 1;
}

/** Re-hachage transparent : n'écrit que si le hash n'a pas changé entre-temps. */
export async function replacePasswordHash(tx: Tx, id: string, oldHash: string, newHash: string, now: Date): Promise<void> {
  await tx.query(
    `UPDATE iam.identities SET password_hash = $3, updated_at = $4 WHERE id = $1 AND password_hash = $2`,
    [id, oldHash, newHash, now],
  );
}

/** Nouveau mot de passe + invalidation de TOUTES les sessions (auth_epoch + 1). Renvoie la nouvelle époque. */
export async function setPasswordAndBumpEpoch(tx: Tx, id: string, hash: string, now: Date): Promise<number> {
  const row = await tx.queryOne<{ auth_epoch: number }>(
    `UPDATE iam.identities
        SET password_hash = $2, password_changed_at = $3, auth_epoch = auth_epoch + 1, updated_at = $3
      WHERE id = $1
      RETURNING auth_epoch`,
    [id, hash, now],
  );
  if (!row) throw new Error("identity introuvable");
  return row.auth_epoch;
}

export async function bumpAuthEpoch(tx: Tx, id: string, now: Date): Promise<number> {
  const row = await tx.queryOne<{ auth_epoch: number }>(
    `UPDATE iam.identities SET auth_epoch = auth_epoch + 1, updated_at = $2 WHERE id = $1 RETURNING auth_epoch`,
    [id, now],
  );
  if (!row) throw new Error("identity introuvable");
  return row.auth_epoch;
}

export async function recordLogin(tx: Tx, id: string, tenantId: string, now: Date): Promise<void> {
  await tx.query(`UPDATE iam.identities SET last_login_at = $3, last_tenant_id = $2, updated_at = $3 WHERE id = $1`, [id, tenantId, now]);
}

export async function setIdentityStatus(tx: Tx, id: string, status: "active" | "disabled", now: Date): Promise<void> {
  await tx.query(`UPDATE iam.identities SET status = $2, updated_at = $3 WHERE id = $1`, [id, status, now]);
}

export async function setMfaPending(tx: Tx, id: string, enc: string, now: Date): Promise<void> {
  await tx.query(`UPDATE iam.identities SET mfa_pending_secret_enc = $2, updated_at = $3 WHERE id = $1`, [id, enc, now]);
}

export async function enableMfa(tx: Tx, id: string, enc: string, step: number, now: Date): Promise<void> {
  await tx.query(
    `UPDATE iam.identities
        SET mfa_enabled = true, mfa_secret_enc = $2, mfa_pending_secret_enc = NULL,
            mfa_enrolled_at = $4, mfa_last_step = $3, updated_at = $4
      WHERE id = $1`,
    [id, enc, step, now],
  );
}

export async function disableMfa(tx: Tx, id: string, now: Date): Promise<void> {
  await tx.query(
    `UPDATE iam.identities
        SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL,
            mfa_enrolled_at = NULL, mfa_last_step = 0, updated_at = $2
      WHERE id = $1`,
    [id, now],
  );
}

/** Rechiffre le secret avec la clé courante (rotation) sans toucher au reste. */
export async function replaceMfaSecret(tx: Tx, id: string, oldEnc: string, newEnc: string): Promise<void> {
  await tx.query(`UPDATE iam.identities SET mfa_secret_enc = $3 WHERE id = $1 AND mfa_secret_enc = $2`, [id, oldEnc, newEnc]);
}

/**
 * Avance atomiquement le dernier pas TOTP accepté. Renvoie `false` si ce pas (ou un
 * pas plus récent) a déjà été consommé : le code est un REJEU.
 */
export async function advanceMfaStep(tx: Tx, id: string, step: number): Promise<boolean> {
  const res = await tx.query(`UPDATE iam.identities SET mfa_last_step = $2 WHERE id = $1 AND mfa_last_step < $2`, [id, step]);
  return res.rowCount === 1;
}

// -----------------------------------------------------------------------------
// Annuaire et tenants
// -----------------------------------------------------------------------------

/** Tenants dans lesquels l'identité a (eu) un accès, du plus ancien au plus récent. Statut du TENANT, pas de l'accès. */
export function listTenantsOfIdentity(tx: Tx, identityId: string): Promise<TenantRow[]> {
  return tx.many<TenantRow>(
    `SELECT t.id, t.slug, t.name, t.status
       FROM iam.identity_tenants it
       JOIN kernel.tenants t ON t.id = it.tenant_id
      WHERE it.identity_id = $1
      ORDER BY it.created_at, t.id`,
    [identityId],
  );
}

export function findTenantBySlug(tx: Tx, slug: string): Promise<TenantRow | null> {
  return tx.queryOne<TenantRow>(`SELECT id, slug, name, status FROM kernel.tenants WHERE slug = $1`, [slug]);
}

export function findTenantById(tx: Tx, id: string): Promise<TenantRow | null> {
  return tx.queryOne<TenantRow>(`SELECT id, slug, name, status FROM kernel.tenants WHERE id = $1`, [id]);
}

export async function markEmailVerified(tx: Tx, id: string, now: Date): Promise<void> {
  await tx.query(`UPDATE iam.identities SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2 WHERE id = $1`, [id, now]);
}
