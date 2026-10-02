/**
 * Dépôt de `finance.provider_configs` (RLS : le tenant courant seulement).
 * `secrets` ne contient que des enveloppes scellées (contrainte SQL `secrets_are_sealed`).
 */
import type { Tx } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";

export type ProviderMode = "sandbox" | "production";

export interface ProviderConfigRecord {
  readonly id: Uuid;
  readonly provider: string;
  readonly enabled: boolean;
  readonly mode: ProviderMode;
  readonly settings: Readonly<Record<string, string>>;
  /** champ → enveloppe chiffrée */
  readonly secrets: Readonly<Record<string, string>>;
  readonly lastTestAt: Date | null;
  readonly lastTestOk: boolean | null;
  readonly lastTestCode: string | null;
  readonly updatedAt: Date;
}

const COLS = "id, provider, enabled, mode, settings, secrets, last_test_at, last_test_ok, last_test_code, updated_at";

const stringRecord = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
};

const recordOf = (r: any): ProviderConfigRecord => ({
  id: r.id,
  provider: r.provider,
  enabled: r.enabled,
  mode: r.mode,
  settings: stringRecord(r.settings),
  secrets: stringRecord(r.secrets),
  lastTestAt: r.last_test_at,
  lastTestOk: r.last_test_ok,
  lastTestCode: r.last_test_code,
  updatedAt: r.updated_at,
});

export async function getProviderConfig(tx: Tx, provider: string, forUpdate = false): Promise<ProviderConfigRecord | null> {
  const row = await tx.queryOne(`SELECT ${COLS} FROM finance.provider_configs WHERE provider = $1${forUpdate ? " FOR UPDATE" : ""}`, [provider]);
  return row ? recordOf(row) : null;
}

export async function listProviderConfigs(tx: Tx): Promise<ProviderConfigRecord[]> {
  return (await tx.many(`SELECT ${COLS} FROM finance.provider_configs ORDER BY provider`)).map(recordOf);
}

export interface ProviderConfigWrite {
  readonly id: Uuid;
  readonly provider: string;
  readonly enabled: boolean;
  readonly mode: ProviderMode;
  readonly settings: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
  readonly actorId: string | null;
  readonly at: Date;
}

/** Insère ou remplace la configuration (la ligne est verrouillée par l'appelant : `getProviderConfig(…, true)`). */
export async function upsertProviderConfig(tx: Tx, tenantId: string, w: ProviderConfigWrite): Promise<ProviderConfigRecord> {
  const row = await tx.queryOne(
    `INSERT INTO finance.provider_configs (id, tenant_id, provider, enabled, mode, settings, secrets, created_by, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$8,$9,$9)
     ON CONFLICT (tenant_id, provider) DO UPDATE
        SET enabled = EXCLUDED.enabled, mode = EXCLUDED.mode, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets,
            updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
     RETURNING ${COLS}`,
    [w.id, tenantId, w.provider, w.enabled, w.mode, JSON.stringify(w.settings), JSON.stringify(w.secrets), w.actorId, w.at],
  );
  return recordOf(row);
}

export async function recordProviderTest(tx: Tx, provider: string, result: { ok: boolean; code: string; at: Date }): Promise<void> {
  await tx.query("UPDATE finance.provider_configs SET last_test_at = $2, last_test_ok = $3, last_test_code = $4 WHERE provider = $1", [
    provider,
    result.at,
    result.ok,
    result.code,
  ]);
}
