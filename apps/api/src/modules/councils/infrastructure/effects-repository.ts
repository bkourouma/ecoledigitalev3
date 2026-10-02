/** File d'effets (propagation idempotente vers results, academic, orientation, people). Le statut initial et les transitions sont imposés par la base. */
import type { Tx } from "@ecoledigitale/database";
import type { EffectRow } from "./rows";

const COLS = `e.id, e.council_id AS "councilId", e.decision_id AS "decisionId", e.proposal_id AS "proposalId", e.effect_kind AS "effectKind", e.status,
  e.attempts, e.last_error AS "lastError", e.external_ref AS "externalRef", e.irreversible, e.applied_at AS "appliedAt", e.applied_by AS "appliedBy",
  e.reverted_at AS "revertedAt", e.revert_reason AS "revertReason", e.created_at AS "createdAt"`;

export const getEffect = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<EffectRow | null> =>
  tx.queryOne<EffectRow>(`SELECT ${COLS} FROM councils.effects e WHERE e.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export const listEffectsOfCouncil = (tx: Tx, councilId: string): Promise<EffectRow[]> => tx.many<EffectRow>(`SELECT ${COLS} FROM councils.effects e WHERE e.council_id = $1 ORDER BY e.created_at, e.id`, [councilId]);

export interface EffectFilter {
  status?: string | undefined;
  councilId?: string | undefined;
  kind?: string | undefined;
}

export async function listEffects(tx: Tx, f: EffectFilter, page: { limit: number; offset: number }): Promise<{ rows: EffectRow[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("e.status = ?", f.status);
  if (f.councilId) add("e.council_id = ?", f.councilId);
  if (f.kind) add("e.effect_kind = ?", f.kind);
  const w = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await tx.many<EffectRow>(`SELECT ${COLS} FROM councils.effects e ${w} ORDER BY e.created_at DESC, e.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, page.limit, page.offset]);
  const total = (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM councils.effects e ${w}`, params))?.n ?? 0;
  return { rows, total };
}

/** Effets à rejouer par le job : en attente ou en échec, tentatives bornées ; jamais ceux d'un humain. */
export const listRunnableEffects = (tx: Tx, maxAttempts: number, limit: number): Promise<EffectRow[]> =>
  tx.many<EffectRow>(`SELECT ${COLS} FROM councils.effects e WHERE e.status IN ('PENDING','FAILED') AND e.attempts < $1 ORDER BY e.updated_at, e.id LIMIT $2`, [maxAttempts, limit]);

export async function insertEffect(tx: Tx, e: { id: string; tenantId: string; councilId: string; decisionId: string | null; proposalId: string | null; kind: string; status: "PENDING" | "AWAITING_HUMAN" }): Promise<boolean> {
  // Unique par (décision ou proposition, nature) tant qu'il est vivant : un rejeu ne crée jamais de doublon.
  const r = await tx.query(
    `INSERT INTO councils.effects (id, tenant_id, council_id, decision_id, proposal_id, effect_kind, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, coalesce(decision_id, proposal_id), effect_kind) WHERE status NOT IN ('REVERTED', 'SKIPPED') DO NOTHING`,
    [e.id, e.tenantId, e.councilId, e.decisionId, e.proposalId, e.kind, e.status],
  );
  return (r.rowCount ?? 0) > 0;
}

export const markEffectApplied = (tx: Tx, id: string, o: { externalRef: string | null; irreversible: boolean; at: Date }): Promise<unknown> =>
  tx.query("UPDATE councils.effects SET status = 'APPLIED', applied_at = $2, external_ref = $3, irreversible = $4, last_error = NULL, attempts = attempts + 1 WHERE id = $1", [id, o.at, o.externalRef, o.irreversible]);

export const markEffectFailed = (tx: Tx, id: string, error: string): Promise<unknown> =>
  tx.query("UPDATE councils.effects SET status = 'FAILED', last_error = $2, attempts = attempts + 1 WHERE id = $1", [id, error.slice(0, 1000)]);

export const markEffectReverted = (tx: Tx, id: string, reason: string, at: Date): Promise<unknown> => tx.query("UPDATE councils.effects SET status = 'REVERTED', reverted_at = $3, revert_reason = $2 WHERE id = $1", [id, reason, at]);
export const requeueEffect = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.effects SET status = 'PENDING' WHERE id = $1", [id]);
export const skipEffect = (tx: Tx, id: string, reason: string): Promise<unknown> => tx.query("UPDATE councils.effects SET status = 'SKIPPED', last_error = $2 WHERE id = $1", [id, reason.slice(0, 1000)]);

export interface EffectCounts {
  pending: number;
  failed: number;
  awaitingHuman: number;
}

export async function effectCountsOfClassroom(tx: Tx, classroomId: string): Promise<EffectCounts> {
  const row = await tx.queryOne<EffectCounts>(
    `SELECT count(*) FILTER (WHERE e.status = 'PENDING')::int AS pending, count(*) FILTER (WHERE e.status = 'FAILED')::int AS failed,
            count(*) FILTER (WHERE e.status = 'AWAITING_HUMAN')::int AS "awaitingHuman"
       FROM councils.effects e JOIN councils.councils c ON c.tenant_id = e.tenant_id AND c.id = e.council_id WHERE c.classroom_id = $1`,
    [classroomId],
  );
  return row ?? { pending: 0, failed: 0, awaitingHuman: 0 };
}

/** Effets APPLIED d'un type donné pour des séances (annulation par la réouverture de la période de résultats). */
export const listAppliedEffectsOfCouncils = (tx: Tx, councilIds: readonly string[], kinds: readonly string[]): Promise<EffectRow[]> =>
  councilIds.length === 0 ? Promise.resolve([]) : tx.many<EffectRow>(`SELECT ${COLS} FROM councils.effects e WHERE e.council_id = ANY($1::uuid[]) AND e.status = 'APPLIED' AND e.effect_kind = ANY($2::text[]) FOR UPDATE`, [councilIds, kinds]);

/** L'effet de notification des tuteurs d'un élève a-t-il été APPLIQUÉ (règle de visibilité `AFTER_NOTIFICATION`) ? */
export async function notifiedDecisionIds(tx: Tx, decisionIds: readonly string[]): Promise<Set<string>> {
  if (decisionIds.length === 0) return new Set();
  const rows = await tx.many<{ id: string }>(`SELECT e.decision_id AS id FROM councils.effects e WHERE e.decision_id = ANY($1::uuid[]) AND e.effect_kind = 'NOTIFY_GUARDIANS' AND e.status = 'APPLIED'`, [decisionIds]);
  return new Set(rows.map((r) => r.id));
}

export const setEffectLastError = (tx: Tx, id: string, message: string): Promise<unknown> => tx.query("UPDATE councils.effects SET last_error = $2 WHERE id = $1", [id, message.slice(0, 1000)]);
export const markEffectIrreversible = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.effects SET irreversible = true WHERE id = $1", [id]);
/** Un transfert de série appliqué à l'inscription ne se défait plus : l'effet qui l'a planifié devient irréversible. */
export const markTransferEffectsIrreversible = (tx: Tx, transferId: string): Promise<unknown> =>
  tx.query("UPDATE councils.effects SET irreversible = true WHERE effect_kind = 'SERIES_TRANSFER' AND external_ref = $1 AND status = 'APPLIED'", [transferId]);
