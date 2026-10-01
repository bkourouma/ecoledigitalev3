/**
 * Empreinte d'une entrée et chaînage.
 *
 * hash = SHA-256 (ou HMAC-SHA-256 si une clé est configurée) du JSON canonique du
 * tableau ordonné ci-dessous. Format versionné (`ed-audit/v1`) : toute évolution
 * des champs couverts crée une v2 sans casser la vérification des anciennes lignes.
 *
 * Couvert : tout le contenu métier ET la position dans la chaîne (scope, seq, prev_hash),
 * ET l'algorithme (empêche de « rétrograder » une ligne HMAC en SHA-256 simple sans
 * changer son hash). NON couvert : `recorded_at` (instant d'insertion, informatif).
 */
import { createHmac } from "node:crypto";
import { canonicalize, sha256Hex } from "./canonical";
import type { HashAlg, JsonValue } from "./types";

export const HASH_FORMAT = "ed-audit/v1";
export const GENESIS_HASH = "0".repeat(64);
/** Portée du journal de plateforme (pas de tenant). */
export const PLATFORM_SCOPE = "platform";

export interface HashableEntry {
  /** Tenant, ou `PLATFORM_SCOPE`. */
  scope: string;
  seq: number;
  id: string;
  /** ISO-8601 UTC, précision milliseconde (`Date.toISOString()`). */
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  impersonatedBy: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  diff: JsonValue | null;
  metadata: JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  requestId: string | null;
  reason: string | null;
  severity: string;
  prevHash: string;
}

export interface HmacKey {
  id: string;
  secret: Buffer | string;
}

export interface HashResult {
  hash: string;
  alg: HashAlg;
  keyId: string | null;
}

export function hashInput(entry: HashableEntry, alg: HashAlg): string {
  const fields: JsonValue[] = [
    HASH_FORMAT,
    alg,
    entry.scope,
    entry.seq,
    entry.id,
    entry.occurredAt,
    entry.actorType,
    entry.actorId,
    entry.impersonatedBy,
    entry.action,
    entry.entity,
    entry.entityId,
    entry.before,
    entry.after,
    entry.diff,
    entry.metadata,
    entry.ip,
    entry.userAgent,
    entry.device,
    entry.requestId,
    entry.reason,
    entry.severity,
    entry.prevHash,
  ];
  return canonicalize(fields);
}

export function computeEntryHash(entry: HashableEntry, key?: HmacKey | null): HashResult {
  if (key) {
    const hash = createHmac("sha256", key.secret).update(hashInput(entry, "hmac-sha256"), "utf8").digest("hex");
    return { hash, alg: "hmac-sha256", keyId: key.id };
  }
  return { hash: sha256Hex(hashInput(entry, "sha256")), alg: "sha256", keyId: null };
}

/** Recalcule avec l'algorithme et la clé déclarés par la ligne ; `null` si la clé est inconnue. */
export function recomputeEntryHash(
  entry: HashableEntry,
  alg: HashAlg,
  keyId: string | null,
  keys: ReadonlyMap<string, Buffer | string>,
): string | null {
  if (alg === "sha256") return sha256Hex(hashInput(entry, "sha256"));
  const secret = keyId === null ? undefined : keys.get(keyId);
  if (secret === undefined) return null;
  return createHmac("sha256", secret).update(hashInput(entry, "hmac-sha256"), "utf8").digest("hex");
}
