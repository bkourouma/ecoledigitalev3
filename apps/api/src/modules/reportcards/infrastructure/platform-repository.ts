/**
 * Requêtes SQL sur les tables GLOBALES écrites par l'acteur `system` (clés publiques de signature, gabarits plateforme).
 * À appeler dans une transaction `SystemDb.run(reason, …)` : la RLS réserve l'écriture à l'acteur `system`.
 */
import type { Tx } from "@ecoledigitale/database";
import type { PlatformTemplate } from "../domain/types";
import { TEMPLATE_COLUMNS, toPlatformTemplate } from "./rows";

export interface SigningKeyRow {
  keyId: string;
  algorithm: "Ed25519";
  publicKey: string;
  status: "ACTIVE" | "RETIRED";
  createdAt: Date;
  retiredAt: Date | null;
}

const toKey = (r: Record<string, any>): SigningKeyRow => ({
  keyId: r.key_id,
  algorithm: r.algorithm,
  publicKey: r.public_key,
  status: r.status,
  createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  retiredAt: r.retired_at ? (r.retired_at instanceof Date ? r.retired_at : new Date(r.retired_at)) : null,
});

export async function listSigningKeys(tx: Tx): Promise<SigningKeyRow[]> {
  return (await tx.many(`SELECT key_id, algorithm, public_key, status, created_at, retired_at FROM reportcards.signing_keys ORDER BY created_at, key_id`)).map(toKey);
}

export async function getSigningKey(tx: Tx, keyId: string): Promise<SigningKeyRow | null> {
  const row = await tx.queryOne(`SELECT key_id, algorithm, public_key, status, created_at, retired_at FROM reportcards.signing_keys WHERE key_id = $1`, [keyId]);
  return row ? toKey(row) : null;
}

export async function insertSigningKey(tx: Tx, input: { keyId: string; publicKey: string; now: Date }): Promise<void> {
  await tx.query(`INSERT INTO reportcards.signing_keys (key_id, public_key, created_at) VALUES ($1, $2, $3) ON CONFLICT (key_id) DO NOTHING`, [input.keyId, input.publicKey, input.now]);
}

export async function retireSigningKey(tx: Tx, keyId: string, now: Date): Promise<boolean> {
  const res = await tx.query(`UPDATE reportcards.signing_keys SET status = 'RETIRED', retired_at = $2 WHERE key_id = $1 AND status = 'ACTIVE'`, [keyId, now]);
  return res.rowCount > 0;
}

export async function getTemplateVersion(tx: Tx, key: string, version: number): Promise<PlatformTemplate | null> {
  const row = await tx.queryOne(`SELECT ${TEMPLATE_COLUMNS} FROM reportcards.platform_templates WHERE key = $1 AND version = $2`, [key, version]);
  return row ? toPlatformTemplate(row) : null;
}

export async function nextTemplateVersion(tx: Tx, key: string): Promise<number> {
  const row = await tx.queryOne<{ v: number }>(`SELECT coalesce(max(version), 0) + 1 AS v FROM reportcards.platform_templates WHERE key = $1`, [key]);
  return Number(row!.v);
}

export async function insertPublishedTemplate(
  tx: Tx,
  t: Omit<PlatformTemplate, "status" | "publishedAt" | "contentHash"> & { contentHash: string; publishedAt: Date },
): Promise<PlatformTemplate> {
  const rows = await tx.many(
    `INSERT INTO reportcards.platform_templates
       (key, version, document_kind, pack, snapshot_schema, title, body, css, options_schema, signature_slots, status, content_hash, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'PUBLISHED',$11,$12)
     RETURNING ${TEMPLATE_COLUMNS}`,
    [t.key, t.version, t.documentKind, t.pack, t.snapshotSchema, t.title, t.body, t.css, JSON.stringify(t.optionsSchema), JSON.stringify(t.signatureSlots), t.contentHash, t.publishedAt],
  );
  return toPlatformTemplate(rows[0]!);
}

export async function retireTemplate(tx: Tx, key: string, version: number): Promise<boolean> {
  const res = await tx.query(`UPDATE reportcards.platform_templates SET status = 'RETIRED' WHERE key = $1 AND version = $2 AND status = 'PUBLISHED'`, [key, version]);
  return res.rowCount > 0;
}
