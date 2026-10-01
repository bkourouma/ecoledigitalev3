/**
 * Contrôle d'intégrité de la chaîne (lecture seule).
 *
 * Détecte : contenu modifié (hash), lien rompu (prev_hash), ligne supprimée au milieu
 * (trou de seq), doublon de seq, début de chaîne falsifié (genesis), troncature de la
 * QUEUE (tête ≠ dernière ligne), clé HMAC absente, ligne « rétrogradée » en SHA-256.
 *
 * Ne détecte PAS (voir README) : la suppression/réécriture cohérente de toute la chaîne
 * par quelqu'un qui détient aussi la clé HMAC ; avec SHA-256 simple, par quelqu'un qui
 * peut écrire la base (il recalcule tout) — d'où l'ancrage externe recommandé de la tête.
 */
import type { Tx } from "@ecoledigitale/database";
import { GENESIS_HASH, PLATFORM_SCOPE, recomputeEntryHash, type HashableEntry } from "../domain/hash";
import type { StoredAuditEntry } from "../domain/types";
import { readChainBatch, readHead, seqRangeForPeriod, type ChainTarget } from "../infrastructure/chain-repository";

export type ChainIssueKind =
  | "hash_mismatch"
  | "prev_hash_mismatch"
  | "seq_gap"
  | "duplicate_seq"
  | "genesis_mismatch"
  | "head_mismatch"
  | "key_unavailable"
  | "weak_hash"
  | "unsupported_hash_alg";

export interface ChainIssue {
  kind: ChainIssueKind;
  seq: number | null;
  id: string | null;
  detail: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstSeq: number | null;
  lastSeq: number | null;
  headSeq: number | null;
  anchor: "genesis" | "trusted-anchor" | "empty";
  issues: ChainIssue[];
  issuesTruncated: boolean;
}

export interface ChainRange {
  fromSeq?: number;
  toSeq?: number;
  /** Période (occurred_at) : convertie en plage de seq. */
  from?: Date | string;
  to?: Date | string;
  batchSize?: number;
  maxIssues?: number;
  /** Signale toute ligne en SHA-256 simple (à activer une fois les HMAC en service). */
  requireHmac?: boolean;
}

export function toHashable(row: StoredAuditEntry): HashableEntry {
  return {
    scope: row.tenantId ?? PLATFORM_SCOPE,
    seq: row.seq,
    id: row.id,
    occurredAt: row.occurredAt,
    actorType: row.actorType,
    actorId: row.actorId,
    impersonatedBy: row.impersonatedBy,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    diff: row.diff,
    metadata: row.metadata,
    ip: row.ip,
    userAgent: row.userAgent,
    device: row.device,
    requestId: row.requestId,
    reason: row.reason,
    severity: row.severity,
    prevHash: row.prevHash,
  };
}

const iso = (d: Date | string | undefined): string | undefined =>
  d === undefined ? undefined : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export async function verifyChainOn(
  tx: Tx,
  target: ChainTarget,
  range: ChainRange,
  keys: ReadonlyMap<string, Buffer | string>,
): Promise<ChainVerification> {
  const batchSize = Math.min(Math.max(range.batchSize ?? 1000, 1), 5000);
  const maxIssues = Math.max(range.maxIssues ?? 100, 1);
  const issues: ChainIssue[] = [];
  let truncated = false;
  const add = (issue: ChainIssue): void => {
    if (issues.length >= maxIssues) truncated = true;
    else issues.push(issue);
  };

  const head = await readHead(tx, target);

  let lo = range.fromSeq ?? 1;
  let hi = range.toSeq ?? Number.MAX_SAFE_INTEGER;
  if (range.from !== undefined || range.to !== undefined) {
    const period = await seqRangeForPeriod(tx, target, iso(range.from), iso(range.to));
    if (!period) {
      return { ok: head === null, checked: 0, firstSeq: null, lastSeq: null, headSeq: head?.seq ?? null, anchor: "empty", issues, issuesTruncated: false };
    }
    lo = Math.max(lo, period.min);
    hi = Math.min(hi, period.max);
  }

  let prev: { seq: number; hash: string } | null = null;
  let firstSeq: number | null = null;
  let lastSeq: number | null = null;
  let lastHash: string | null = null;
  let checked = 0;
  let anchor: ChainVerification["anchor"] = "empty";
  let after = lo - 1;

  for (;;) {
    const batch = await readChainBatch(tx, target, after, hi, batchSize);
    if (batch.length === 0) break;
    for (const row of batch) {
      checked++;
      if (prev === null) {
        firstSeq = row.seq;
        if (row.seq === 1) {
          anchor = "genesis";
          if (row.prevHash !== GENESIS_HASH) {
            add({ kind: "genesis_mismatch", seq: row.seq, id: row.id, detail: "Le premier maillon ne référence pas l'empreinte d'origine." });
          }
        } else {
          anchor = "trusted-anchor";
        }
      } else {
        if (row.seq === prev.seq) {
          add({ kind: "duplicate_seq", seq: row.seq, id: row.id, detail: `seq ${row.seq} présent plusieurs fois.` });
        } else if (row.seq !== prev.seq + 1) {
          add({ kind: "seq_gap", seq: row.seq, id: row.id, detail: `Trou dans la séquence : ${prev.seq + 1} à ${row.seq - 1} manquants.` });
        } else if (row.prevHash !== prev.hash) {
          add({ kind: "prev_hash_mismatch", seq: row.seq, id: row.id, detail: "prev_hash ne correspond pas à l'empreinte du maillon précédent." });
        }
      }

      if (row.hashAlg !== "sha256" && row.hashAlg !== "hmac-sha256") {
        add({ kind: "unsupported_hash_alg", seq: row.seq, id: row.id, detail: `Algorithme inconnu : ${String(row.hashAlg)}.` });
      } else {
        const expected = recomputeEntryHash(toHashable(row), row.hashAlg, row.keyId, keys);
        if (expected === null) {
          add({ kind: "key_unavailable", seq: row.seq, id: row.id, detail: `Clé HMAC « ${row.keyId} » indisponible : contenu non vérifiable.` });
        } else if (expected !== row.hash) {
          add({ kind: "hash_mismatch", seq: row.seq, id: row.id, detail: "L'empreinte stockée ne correspond pas au contenu de la ligne." });
        }
        if (range.requireHmac && row.hashAlg === "sha256") {
          add({ kind: "weak_hash", seq: row.seq, id: row.id, detail: "Ligne protégée par SHA-256 simple alors que HMAC est exigé." });
        }
      }

      prev = { seq: row.seq, hash: row.hash };
      lastSeq = row.seq;
      lastHash = row.hash;
      after = row.seq;
    }
    if (batch.length < batchSize) break;
  }

  // Queue : si la plage atteint la fin de la chaîne, la dernière ligne doit être la tête.
  const reachesEnd = hi === Number.MAX_SAFE_INTEGER || (head !== null && hi >= head.seq);
  if (reachesEnd) {
    if (head === null && checked > 0) {
      add({ kind: "head_mismatch", seq: lastSeq, id: null, detail: "Des lignes existent mais la tête de chaîne est absente." });
    } else if (head !== null && range.from === undefined && range.to === undefined) {
      if (lastSeq !== head.seq || lastHash !== head.hash) {
        add({
          kind: "head_mismatch",
          seq: lastSeq,
          id: null,
          detail: `La tête annonce seq=${head.seq} mais la dernière ligne lue est seq=${lastSeq ?? "aucune"} (troncature ou altération de la queue).`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0 && !truncated,
    checked,
    firstSeq,
    lastSeq,
    headSeq: head?.seq ?? null,
    anchor,
    issues,
    issuesTruncated: truncated,
  };
}
