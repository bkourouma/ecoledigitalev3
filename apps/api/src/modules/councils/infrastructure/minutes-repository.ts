/** Procès-verbaux (snapshot immuable, hash calculé par la base), signatures, demandes de déverrouillage, journal de séance. */
import type { Tx } from "@ecoledigitale/database";
import type { EventRow, MinutesRow, SignatureRow, UnlockRow } from "./rows";

// ---------------------------------------------------------------------------------------------------------------------
// Procès-verbaux
// ---------------------------------------------------------------------------------------------------------------------

const MIN_COLS = `m.id, m.council_id AS "councilId", m.version, m.status, m.schema_name AS "schemaName", m.snapshot_hash AS "snapshotHash", m.generated_at AS "generatedAt",
  m.generated_by AS "generatedBy", m.render_status AS "renderStatus", m.render_object_key AS "renderObjectKey", m.render_hash AS "renderHash",
  m.signed_at AS "signedAt", m.supersedes_id AS "supersedesId", m.revoked_reason AS "revokedReason"`;

export const getMinutes = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<MinutesRow | null> =>
  tx.queryOne<MinutesRow>(`SELECT ${MIN_COLS} FROM councils.minutes m WHERE m.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const listMinutesOfCouncil = (tx: Tx, councilId: string): Promise<MinutesRow[]> => tx.many<MinutesRow>(`SELECT ${MIN_COLS} FROM councils.minutes m WHERE m.council_id = $1 ORDER BY m.version DESC`, [councilId]);
export const getLiveMinutes = (tx: Tx, councilId: string): Promise<MinutesRow | null> =>
  tx.queryOne<MinutesRow>(`SELECT ${MIN_COLS} FROM councils.minutes m WHERE m.council_id = $1 AND m.status IN ('GENERATED','SIGNED')`, [councilId]);

export const getSnapshot = async (tx: Tx, id: string): Promise<unknown> => (await tx.queryOne<{ snapshot: unknown }>("SELECT snapshot FROM councils.minutes WHERE id = $1", [id]))?.snapshot ?? null;

/** Le hash, la version et `supersedes_id` sont posés par la base (le client n'en fournit aucun) ; le hash de remplissage est ignoré. */
export async function insertMinutes(tx: Tx, m: { id: string; tenantId: string; councilId: string; snapshot: unknown; generatedBy: string }): Promise<void> {
  await tx.query(
    `INSERT INTO councils.minutes (id, tenant_id, council_id, version, snapshot, snapshot_hash, generated_by)
     VALUES ($1,$2,$3,1,$4::jsonb,$5,$6)`,
    [m.id, m.tenantId, m.councilId, JSON.stringify(m.snapshot), "0".repeat(64), m.generatedBy],
  );
}

export const markMinutesRevoked = (tx: Tx, id: string, reason: string): Promise<unknown> => tx.query("UPDATE councils.minutes SET status = 'REVOKED', revoked_reason = $2 WHERE id = $1", [id, reason]);

export const setMinutesRendered = (tx: Tx, id: string, o: { objectKey: string; hash: string }): Promise<unknown> =>
  tx.query("UPDATE councils.minutes SET render_status = 'RENDERED', render_object_key = $2, render_hash = $3 WHERE id = $1", [id, o.objectKey, o.hash]);
export const setMinutesRenderFailed = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.minutes SET render_status = 'FAILED' WHERE id = $1 AND render_status <> 'RENDERED'", [id]);

// ---------------------------------------------------------------------------------------------------------------------
// Signatures (ajout seul)
// ---------------------------------------------------------------------------------------------------------------------

const SIG_COLS = `g.id, g.minutes_id AS "minutesId", g.participant_id AS "participantId", g.role_code AS "roleCode", g.signer_name AS "signerName", g.method,
  g.signed_hash AS "signedHash", g.signed_at AS "signedAt", g.signed_by_user AS "signedByUser"`;

export const listSignatures = (tx: Tx, minutesId: string): Promise<SignatureRow[]> => tx.many<SignatureRow>(`SELECT ${SIG_COLS} FROM councils.minute_signatures g WHERE g.minutes_id = $1 ORDER BY g.signed_at, g.id`, [minutesId]);

export async function insertSignature(tx: Tx, s: { id: string; tenantId: string; minutesId: string; participantId: string; method: "ELECTRONIC" | "SCANNED_PAPER"; signedHash: string; signedByUser: string; evidenceObjectKey: string | null }): Promise<void> {
  // `role_code` et `signer_name` sont posés par la base depuis le participant ; valeurs de remplissage ignorées.
  await tx.query(
    `INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user, evidence_object_key)
     VALUES ($1,$2,$3,$4,'-','-',$5,$6,$7,$8)`,
    [s.id, s.tenantId, s.minutesId, s.participantId, s.method, s.signedHash, s.signedByUser, s.evidenceObjectKey],
  );
}

/** Signataires exigés qui n'ont pas encore signé (fonction SQL de la base : source unique). */
export const missingSigners = (tx: Tx, minutesId: string): Promise<Array<{ participantId: string; displayName: string; roleCode: string }>> =>
  tx.many(`SELECT p.id AS "participantId", p.display_name AS "displayName", p.role_code AS "roleCode" FROM councils.missing_signers($1) s JOIN councils.participants p ON p.id = s ORDER BY p.display_name`, [minutesId]);

// ---------------------------------------------------------------------------------------------------------------------
// Demandes de déverrouillage
// ---------------------------------------------------------------------------------------------------------------------

const UNLOCK_COLS = `u.id, u.council_id AS "councilId", u.requested_by AS "requestedBy", u.requested_by_name AS "requestedByName", u.requested_at AS "requestedAt", u.reason,
  u.status, u.decided_by AS "decidedBy", u.decided_by_name AS "decidedByName", u.decided_at AS "decidedAt", u.decision_note AS "decisionNote",
  u.four_eyes_waived AS "fourEyesWaived", u.consumed_at AS "consumedAt"`;

export const getUnlock = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<UnlockRow | null> =>
  tx.queryOne<UnlockRow>(`SELECT ${UNLOCK_COLS} FROM councils.unlock_requests u WHERE u.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const listUnlocks = (tx: Tx, councilId: string): Promise<UnlockRow[]> => tx.many<UnlockRow>(`SELECT ${UNLOCK_COLS} FROM councils.unlock_requests u WHERE u.council_id = $1 ORDER BY u.requested_at DESC, u.id`, [councilId]);

export const insertUnlock = (tx: Tx, u: { id: string; tenantId: string; councilId: string; requestedBy: string; requestedByName: string; reason: string }): Promise<unknown> =>
  tx.query(`INSERT INTO councils.unlock_requests (id, tenant_id, council_id, requested_by, requested_by_name, reason) VALUES ($1,$2,$3,$4,$5,$6)`, [u.id, u.tenantId, u.councilId, u.requestedBy, u.requestedByName, u.reason]);

/**
 * Approbation ou refus : `decided_by` = utilisateur de la session (contrôlé par la base) ; `four_eyes_waived` vrai si c'est le
 * demandeur lui-même qui approuve (la base REFUSE alors quand le réglage impose une autre personne).
 */
export const decideUnlock = (tx: Tx, id: string, o: { status: "APPROVED" | "REJECTED"; decidedBy: string; decidedByName: string; note: string | null; fourEyesWaived: boolean }): Promise<unknown> =>
  tx.query("UPDATE councils.unlock_requests SET status = $2, decided_by = $3, decided_by_name = $4, decision_note = $5, four_eyes_waived = $6 WHERE id = $1", [id, o.status, o.decidedBy, o.decidedByName, o.note, o.fourEyesWaived]);

export const expireUnlock = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.unlock_requests SET status = 'EXPIRED' WHERE id = $1", [id]);

export const listOpenUnlockRequestsBefore = (tx: Tx, before: Date): Promise<UnlockRow[]> =>
  tx.many<UnlockRow>(`SELECT ${UNLOCK_COLS} FROM councils.unlock_requests u WHERE u.status IN ('REQUESTED','APPROVED') AND u.requested_at < $1 ORDER BY u.requested_at LIMIT 200 FOR UPDATE SKIP LOCKED`, [before]);

// ---------------------------------------------------------------------------------------------------------------------
// Journal de séance (ajout seul)
// ---------------------------------------------------------------------------------------------------------------------

export const listEvents = (tx: Tx, councilId: string): Promise<EventRow[]> =>
  tx.many<EventRow>(`SELECT id, council_id AS "councilId", kind, actor_id AS "actorId", actor_kind AS "actorKind", reason, occurred_at AS "occurredAt", data FROM councils.events WHERE council_id = $1 ORDER BY occurred_at, id`, [councilId]);

export const appendEvent = (tx: Tx, e: { id: string; tenantId: string; councilId: string; kind: string; actorId: string | null; actorKind: string | null; reason: string | null; data: Record<string, unknown> }): Promise<unknown> =>
  tx.query(`INSERT INTO councils.events (id, tenant_id, council_id, kind, actor_id, actor_kind, reason, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [e.id, e.tenantId, e.councilId, e.kind, e.actorId, e.actorKind, e.reason, JSON.stringify(e.data)]);

/** Séances clôturées ou signées dont un signal « résultats rouverts » est postérieur à la clôture : « conseil à revoir ». */
export async function reviewNeededCouncilIds(tx: Tx, classroomId: string): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT c.id FROM councils.councils c
      WHERE c.classroom_id = $1 AND c.status IN ('CLOSED','SIGNED')
        AND EXISTS (SELECT 1 FROM councils.events ev WHERE ev.council_id = c.id AND ev.kind = 'RESULTS_REOPENED' AND ev.occurred_at > coalesce(c.closed_at, c.opened_at))`,
    [classroomId],
  );
  return rows.map((r) => r.id);
}
