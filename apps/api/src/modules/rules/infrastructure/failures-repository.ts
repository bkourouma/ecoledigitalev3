import type { Tx } from "@ecoledigitale/database";
import type { VersionKind } from "../domain/types";

export interface NewEvaluationFailure {
  readonly id: string;
  readonly versionKind: VersionKind;
  readonly versionId: string;
  readonly ruleKey: string;
  readonly errorCode: string;
  /** Message du moteur, en français, SANS donnée personnelle. */
  readonly message: string;
  readonly inputsHash?: string | null;
  readonly requestId?: string | null;
}

export async function insertEvaluationFailures(tx: Tx, tenantId: string, failures: readonly NewEvaluationFailure[]): Promise<void> {
  for (const f of failures) {
    await tx.query(
      `INSERT INTO rules.evaluation_failures (id, tenant_id, rule_version_kind, rule_version_id, rule_key, error_code, message, inputs_hash, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [f.id, tenantId, f.versionKind, f.versionId, f.ruleKey, f.errorCode.slice(0, 100), f.message.slice(0, 2000), f.inputsHash ?? null, f.requestId ?? null],
    );
  }
}

export interface EvaluationFailureRow {
  rule_version_id: string;
  rule_key: string;
  error_code: string;
  message: string;
  occurred_at: Date;
}

export async function listEvaluationFailures(tx: Tx, limit = 100): Promise<EvaluationFailureRow[]> {
  return tx.many<EvaluationFailureRow>(
    "SELECT rule_version_id, rule_key, error_code, message, occurred_at FROM rules.evaluation_failures ORDER BY occurred_at DESC LIMIT $1",
    [limit],
  );
}

/** Purge à 90 jours (rétention du journal). */
export async function purgeEvaluationFailures(tx: Tx, olderThan: Date): Promise<number> {
  const res = await tx.query("DELETE FROM rules.evaluation_failures WHERE occurred_at < $1", [olderThan]);
  return res.rowCount;
}
