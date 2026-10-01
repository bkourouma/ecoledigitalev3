/**
 * Synchronisation hors-ligne de l'appel (PRD §59) : lot IDEMPOTENT, tolérant au rejeu, avec détection de conflit.
 *
 * Contrat :
 *  - chaque séance et chaque pointage porte un `clientId` (UUID généré par l'appareil) ; le registre `sync_ops`
 *    mémorise le résultat : rejouer un lot (réseau coupé avant la réponse, double envoi) ne crée AUCUN doublon et
 *    renvoie le résultat d'origine (`REPLAYED`). Le même `clientId` avec un autre contenu est refusé
 *    (`attendance.idempotency_key_reused`) ;
 *  - le SERVEUR fait foi : l'instant appareil (`clientMarkedAt`, corrigé de la dérive `clockOffsetMs`, plafonné à la
 *    réception) ne sert qu'à ordonner deux saisies concurrentes d'un même pointage ;
 *  - rien n'est écrit silencieusement ni perdu : une saisie sur une séance validée / annulée, hors fenêtre de
 *    correction, ou plus ANCIENNE que le pointage déjà présent d'un autre auteur va dans la FILE DE CONFLITS, à arbitrer ;
 *  - les séances sont traitées chacune dans un SAVEPOINT : un échec d'une séance n'annule pas le reste du lot.
 */
import { createHash } from "node:crypto";
import type { Tx } from "@ecoledigitale/database";
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { prepareMark, type MarkEntryInput, type PreparedMark } from "../domain/records";
import { checkEditable } from "../domain/session";
import { decideSyncRecord, effectiveClientTime, type ExistingMarkForSync } from "../domain/sync";
import type { IsoDate, SessionStatus, StudentRecord, Uuid } from "../domain/types";
import {
  getConflict,
  getOp,
  insertConflict,
  insertOp,
  listConflicts,
  lockOp,
  resolveConflictRow,
  type ConflictKind,
  type SyncConflict,
  type SyncOp,
} from "../infrastructure/sync-repository";
import { getRecordsByEnrollments, getSession } from "../infrastructure/sessions-repository";
import { EventBuffer, actorOf, inTx, type AttendanceDeps, type CallerCaps } from "./deps";
import { applyMarks, assertCanTakeCall, humanSourceOf, loadSessionContext, type ClientMeta } from "./session-support";
import { openSessionInTx, submitSessionInTx, type OpenSessionInput } from "./sessions";

// ---------------------------------------------------------------------------
// Entrées / sorties
// ---------------------------------------------------------------------------

export interface SyncRecordInput {
  readonly clientId: Uuid;
  readonly studentId: Uuid;
  readonly statusCode: string;
  readonly minutesLate?: number | undefined;
  readonly minutesMissed?: number | undefined;
  readonly arrivedAt?: Date | undefined;
  readonly leftAt?: Date | undefined;
  readonly note?: string | undefined;
  readonly clientMarkedAt: Date;
}

export type SyncTarget = { readonly occurrenceId: Uuid } | { readonly scope: "DAILY"; readonly classroomId: Uuid; readonly date: IsoDate };

export interface SyncSessionInput {
  readonly clientId: Uuid;
  readonly target: SyncTarget;
  readonly clientOpenedAt: Date;
  readonly records: readonly SyncRecordInput[];
  readonly submit?: { readonly defaultStatus?: string | undefined } | undefined;
}

export interface SyncBatchInput {
  readonly batchId?: Uuid | undefined;
  readonly deviceId: string;
  readonly clientSentAt: Date;
  readonly clockOffsetMs?: number | undefined;
  readonly sessions: readonly SyncSessionInput[];
  readonly caps?: CallerCaps;
}

export type SyncRecordOutcome = "APPLIED" | "UNCHANGED" | "REPLAYED" | "CONFLICT" | "REJECTED";

export interface SyncRecordResult {
  readonly clientId: Uuid;
  readonly outcome: SyncRecordOutcome;
  readonly recordId: Uuid | null;
  readonly conflictId: Uuid | null;
  readonly errorCode: string | null;
}

export interface SyncSessionResult {
  readonly clientId: Uuid;
  readonly outcome: "OPENED" | "EXISTING" | "REPLAYED" | "REJECTED";
  readonly sessionId: Uuid | null;
  readonly sessionStatus: SessionStatus | null;
  readonly submitted: boolean;
  readonly errorCode: string | null;
  readonly records: SyncRecordResult[];
}

export interface SyncResult {
  readonly batchId: Uuid | null;
  readonly receivedAt: Date;
  readonly sessions: SyncSessionResult[];
  readonly totals: { applied: number; unchanged: number; replayed: number; conflicts: number; rejected: number };
}

const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Empreinte du CONTENU d'un pointage (identité d'opération : le même `clientId` doit porter le même contenu). */
const recordHash = (r: SyncRecordInput): string =>
  sha256([r.studentId, r.statusCode, r.minutesLate ?? null, r.minutesMissed ?? null, r.arrivedAt?.toISOString() ?? null, r.leftAt?.toISOString() ?? null, r.note ?? null, r.clientMarkedAt.toISOString()]);
const sessionHash = (t: SyncTarget): string => sha256(t);

/** Abandon d'une séance (rollback de son SAVEPOINT) en portant l'erreur métier. */
class SessionAbort extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
  }
}

const reject = (clientId: Uuid, error: AppError): SyncRecordResult => ({ clientId, outcome: "REJECTED", recordId: null, conflictId: null, errorCode: error.code });

const toMarkEntry = (r: SyncRecordInput): MarkEntryInput => ({
  studentId: r.studentId, statusCode: r.statusCode, minutesLate: r.minutesLate, minutesMissed: r.minutesMissed, arrivedAt: r.arrivedAt, leftAt: r.leftAt, note: r.note,
});

const snapshotIncoming = (r: SyncRecordInput, effectiveAt: Date): Record<string, unknown> => ({
  statusCode: r.statusCode, minutesLate: r.minutesLate ?? null, minutesMissed: r.minutesMissed ?? null, arrivedAt: r.arrivedAt?.toISOString() ?? null,
  leftAt: r.leftAt?.toISOString() ?? null, note: r.note ?? null, clientMarkedAt: r.clientMarkedAt.toISOString(), effectiveAt: effectiveAt.toISOString(),
});

const snapshotExisting = (r: StudentRecord): Record<string, unknown> => ({
  recordId: r.id, statusCode: r.statusCode, originalStatusCode: r.originalStatusCode, excused: r.excused, minutesLate: r.minutesLate, countedMinutes: r.countedMinutes,
  note: r.note, markedBy: r.markedBy, markedAt: r.markedAt.toISOString(), clientMarkedAt: r.clientMarkedAt?.toISOString() ?? null, sourceDetail: r.sourceDetail,
});

const existingForSync = (r: StudentRecord): ExistingMarkForSync => ({
  statusCode: r.statusCode, originalStatusCode: r.originalStatusCode, minutesLate: r.minutesLate, countedMinutes: r.countedMinutes, arrivedAt: r.arrivedAt, leftAt: r.leftAt,
  note: r.note, excused: r.excused, markedBy: r.markedBy, markedAt: r.markedAt, clientMarkedAt: r.clientMarkedAt, sourceDetail: r.sourceDetail,
});

// ---------------------------------------------------------------------------
// Lot
// ---------------------------------------------------------------------------

/**
 * `syncOfflineAttendance` : applique un lot de séances et pointages saisis hors-ligne. Voir l'en-tête du fichier.
 * Les séances sont verrouillées dans l'ordre de leur `clientId` (deux lots concurrents ne s'interbloquent pas) ; la
 * réponse conserve l'ordre du lot.
 */
export async function syncOfflineAttendance(deps: AttendanceDeps, ctx: RequestContext, input: SyncBatchInput): Promise<Result<SyncResult, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "La synchronisation exige un utilisateur identifié."));
  const caps = input.caps ?? {};
  const receivedAt = deps.clock.now();
  const offset = input.clockOffsetMs ?? 0;

  return inTx(deps, ctx, async (tx) => {
    const results = new Map<Uuid, SyncSessionResult>();
    const ordered = [...input.sessions].sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));

    for (const s of ordered) {
      await lockOp(tx, ctx.tenantId, s.clientId);
      const events = new EventBuffer(deps, ctx);
      let result: SyncSessionResult;
      try {
        result = await tx.transaction(async (stx) => {
          const processed = await processSession(deps, ctx, stx, events, { s, caps, actor, receivedAt, offset, deviceId: input.deviceId });
          await events.flush(stx);
          return processed;
        });
      } catch (e) {
        if (e instanceof SessionAbort) {
          result = {
            clientId: s.clientId, outcome: "REJECTED", sessionId: null, sessionStatus: null, submitted: false, errorCode: e.error.code,
            records: s.records.map((r) => reject(r.clientId, e.error)),
          };
        } else if (isAppError(e)) {
          result = {
            clientId: s.clientId, outcome: "REJECTED", sessionId: null, sessionStatus: null, submitted: false, errorCode: e.code,
            records: s.records.map((r) => reject(r.clientId, e)),
          };
        } else {
          throw e;
        }
      }
      results.set(s.clientId, result);
    }

    const sessions = input.sessions.map((s) => results.get(s.clientId) as SyncSessionResult);
    const all = sessions.flatMap((s) => s.records);
    const count = (o: SyncRecordOutcome): number => all.filter((r) => r.outcome === o).length;
    return ok({
      batchId: input.batchId ?? null,
      receivedAt,
      sessions,
      totals: { applied: count("APPLIED"), unchanged: count("UNCHANGED"), replayed: count("REPLAYED"), conflicts: count("CONFLICT"), rejected: count("REJECTED") },
    });
  });
}

interface SessionRun {
  readonly s: SyncSessionInput;
  readonly caps: CallerCaps;
  readonly actor: Uuid;
  readonly receivedAt: Date;
  readonly offset: number;
  readonly deviceId: string;
}

async function processSession(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, run: SessionRun): Promise<SyncSessionResult> {
  const { s, caps, actor, receivedAt, offset, deviceId } = run;
  const base = { clientId: s.clientId };
  const hash = sessionHash(s.target);

  // 1. La séance : déjà connue (rejeu) ou ouverte / retrouvée maintenant.
  const known = await getOp(tx, s.clientId);
  let sessionId: Uuid;
  let outcome: SyncSessionResult["outcome"];
  if (known) {
    if (known.kind !== "SESSION" || known.payloadHash !== hash || !known.sessionId) {
      throw new SessionAbort(conflict(AttendanceCode.IDEMPOTENCY_KEY_REUSED, "Cet identifiant d'appareil correspond déjà à une autre séance.", { clientId: s.clientId }));
    }
    sessionId = known.sessionId;
    outcome = "REPLAYED";
  } else {
    const openInput: OpenSessionInput =
      "occurrenceId" in s.target
        ? { kind: "occurrence", occurrenceId: s.target.occurrenceId, caps }
        : { kind: "daily", classroomId: s.target.classroomId, date: s.target.date, caps };
    const opened = await openSessionInTx(deps, ctx, tx, events, openInput, { source: "OFFLINE_SYNC", clientId: s.clientId });
    if (!opened.ok) throw new SessionAbort(opened.error);
    sessionId = opened.value.session.id;
    outcome = opened.value.created ? "OPENED" : "EXISTING";
    await insertOp(tx, {
      clientId: s.clientId, kind: "SESSION", payloadHash: hash, outcome: opened.value.created ? "OPENED" : "EXISTING", sessionId, recordId: null, conflictId: null,
      tenantId: ctx.tenantId, deviceId, userId: actor, clientAt: s.clientOpenedAt, receivedAt,
    });
  }

  // 2. Verrou partagé sur la séance + droits + contexte d'écriture.
  const session = await getSession(tx, sessionId, "SHARE");
  if (!session) throw new SessionAbort(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", sessionId));
  const auth = await assertCanTakeCall(deps, ctx, caps, {
    classroomId: session.classroomId,
    takenByStaffId: session.takenByStaffId,
    occurrence: session.occurrenceId ? await deps.ports.occurrences.getOccurrence(ctx, session.occurrenceId) : null,
  });
  if (!auth.ok) throw new SessionAbort(auth.error);
  const context = await loadSessionContext(deps, ctx, tx, session);
  const editable = checkEditable(session, context.policy, { now: deps.clock.now(), canManage: caps.manage === true });
  const lockedKind: ConflictKind | null = editable.ok ? null : session.status === "SUBMITTED" ? "WINDOW_CLOSED" : "SESSION_LOCKED";

  // 3. Les pointages, un par opération (rejeu, rejet, conflit ou application).
  const recordResults = new Map<Uuid, SyncRecordResult>();
  interface Pending { r: SyncRecordInput; effectiveAt: Date }
  const pending: Pending[] = [];
  for (const r of s.records) {
    const op = await getOp(tx, r.clientId);
    if (op) {
      recordResults.set(
        r.clientId,
        op.kind !== "RECORD" || op.payloadHash !== recordHash(r)
          ? reject(r.clientId, conflict(AttendanceCode.IDEMPOTENCY_KEY_REUSED, "Cet identifiant d'appareil correspond déjà à un autre pointage.", { clientId: r.clientId }))
          : { clientId: r.clientId, outcome: "REPLAYED", recordId: op.recordId, conflictId: op.conflictId, errorCode: null },
      );
    } else {
      pending.push({ r, effectiveAt: effectiveClientTime(r.clientMarkedAt, offset, receivedAt) });
    }
  }

  // Un seul gagnant par élève dans le lot : la saisie la plus récente (les antérieures sont « dépassées »).
  const latestByStudent = new Map<Uuid, Pending>();
  for (const p of pending) {
    const cur = latestByStudent.get(p.r.studentId);
    if (!cur || p.effectiveAt.getTime() >= cur.effectiveAt.getTime()) latestByStudent.set(p.r.studentId, p);
  }
  const byEnrollment = new Map(context.roster.map((x) => [x.studentId, x.enrollmentId]));
  const existingRecords = new Map(
    (await getRecordsByEnrollments(tx, sessionId, [...latestByStudent.values()].map((p) => byEnrollment.get(p.r.studentId)).filter((x): x is Uuid => x !== undefined))).map((rec) => [rec.studentId, rec]),
  );

  const toApply: Array<{ p: Pending; prepared: PreparedMark }> = [];
  for (const p of pending) {
    const { r } = p;
    const winner = latestByStudent.get(r.studentId);
    const enrollmentId = byEnrollment.get(r.studentId);
    const ledger = async (o: SyncOp["outcome"], recordId: Uuid | null, conflictId: Uuid | null): Promise<void> =>
      insertOp(tx, {
        clientId: r.clientId, kind: "RECORD", payloadHash: recordHash(r), outcome: o, sessionId, recordId, conflictId,
        tenantId: ctx.tenantId, deviceId, userId: actor, clientAt: r.clientMarkedAt, receivedAt,
      });

    if (winner && winner !== p) {
      await ledger("UNCHANGED", null, null); // dépassée par une saisie plus récente du même lot
      recordResults.set(r.clientId, { clientId: r.clientId, outcome: "UNCHANGED", recordId: null, conflictId: null, errorCode: null });
      continue;
    }
    if (!enrollmentId) {
      recordResults.set(r.clientId, reject(r.clientId, validation(AttendanceCode.STUDENT_NOT_IN_ROSTER, "Cet élève ne figure pas dans la liste d'appel de la séance.", "records", { studentId: r.studentId })));
      continue;
    }
    const prepared = prepareMark(toMarkEntry(r), context.defs, context.markCtx);
    if (!prepared.ok) {
      recordResults.set(r.clientId, reject(r.clientId, prepared.error));
      continue;
    }
    const existing = existingRecords.get(r.studentId) ?? null;

    if (lockedKind) {
      const c = await insertConflict(tx, {
        id: deps.newId(), tenantId: ctx.tenantId, kind: lockedKind, sessionId, enrollmentId, studentId: r.studentId, clientOpId: r.clientId,
        incoming: snapshotIncoming(r, p.effectiveAt), existing: existing ? snapshotExisting(existing) : null, deviceId, submittedBy: actor, clientMarkedAt: r.clientMarkedAt, receivedAt,
      });
      events.add(AttendanceEvents.SYNC_CONFLICT_RECORDED, { v: 1, conflictId: c.id, kind: lockedKind, sessionId, studentId: r.studentId }, { type: "sync_conflict", id: c.id });
      await ledger("CONFLICT", existing?.id ?? null, c.id);
      recordResults.set(r.clientId, { clientId: r.clientId, outcome: "CONFLICT", recordId: existing?.id ?? null, conflictId: c.id, errorCode: null });
      continue;
    }

    const decision = decideSyncRecord({ existing: existing ? existingForSync(existing) : null, incoming: prepared.value, incomingAt: p.effectiveAt, actorId: actor });
    if (decision.kind === "UNCHANGED") {
      await ledger("UNCHANGED", existing?.id ?? null, null);
      recordResults.set(r.clientId, { clientId: r.clientId, outcome: "UNCHANGED", recordId: existing?.id ?? null, conflictId: null, errorCode: null });
    } else if (decision.kind === "CONFLICT") {
      const c = await insertConflict(tx, {
        id: deps.newId(), tenantId: ctx.tenantId, kind: decision.conflictKind, sessionId, enrollmentId, studentId: r.studentId, clientOpId: r.clientId,
        incoming: snapshotIncoming(r, p.effectiveAt), existing: existing ? snapshotExisting(existing) : null, deviceId, submittedBy: actor, clientMarkedAt: r.clientMarkedAt, receivedAt,
      });
      events.add(AttendanceEvents.SYNC_CONFLICT_RECORDED, { v: 1, conflictId: c.id, kind: decision.conflictKind, sessionId, studentId: r.studentId }, { type: "sync_conflict", id: c.id });
      await ledger("CONFLICT", existing?.id ?? null, c.id);
      recordResults.set(r.clientId, { clientId: r.clientId, outcome: "CONFLICT", recordId: existing?.id ?? null, conflictId: c.id, errorCode: null });
    } else {
      toApply.push({ p, prepared: prepared.value });
    }
  }

  if (toApply.length > 0) {
    const clientMeta = new Map<Uuid, ClientMeta>(toApply.map(({ p }) => [p.r.studentId, { clientId: p.r.clientId, clientMarkedAt: p.effectiveAt }]));
    const applied = await applyMarks(deps, ctx, tx, events, { session, entries: toApply.map(({ p }) => toMarkEntry(p.r)), context, source: "OFFLINE_SYNC", clientMeta });
    if (!applied.ok) throw new SessionAbort(applied.error);
    const byStudentRecord = new Map(applied.value.records.map((rec) => [rec.studentId, rec]));
    for (const { p } of toApply) {
      const rec = byStudentRecord.get(p.r.studentId);
      await insertOp(tx, {
        clientId: p.r.clientId, kind: "RECORD", payloadHash: recordHash(p.r), outcome: "APPLIED", sessionId, recordId: rec?.id ?? null, conflictId: null,
        tenantId: ctx.tenantId, deviceId, userId: actor, clientAt: p.r.clientMarkedAt, receivedAt,
      });
      recordResults.set(p.r.clientId, { clientId: p.r.clientId, outcome: "APPLIED", recordId: rec?.id ?? null, conflictId: null, errorCode: null });
    }
  }

  // 4. Soumission demandée : jamais bloquante pour le lot.
  let submitted = session.status === "SUBMITTED" || session.status === "VALIDATED";
  let errorCode: string | null = null;
  let finalStatus: SessionStatus = session.status;
  if (s.submit && session.status === "OPEN") {
    try {
      const done = await tx.transaction(async (stx) => {
        const r = await submitSessionInTx(deps, ctx, stx, events, { sessionId, defaultStatus: s.submit?.defaultStatus, caps });
        if (!r.ok) throw new SessionAbort(r.error);
        return r.value;
      });
      submitted = true;
      finalStatus = done.session.status;
    } catch (e) {
      if (!(e instanceof SessionAbort)) throw e;
      errorCode = e.error.code; // ex. attendance.unmarked_students : l'appel reste ouvert, les pointages sont conservés
    }
  }

  return {
    ...base,
    outcome,
    sessionId,
    sessionStatus: finalStatus,
    submitted,
    errorCode,
    records: s.records.map((r) => recordResults.get(r.clientId) as SyncRecordResult),
  };
}

// ---------------------------------------------------------------------------
// File de conflits
// ---------------------------------------------------------------------------

export async function listSyncConflicts(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { status?: "OPEN" | "RESOLVED" | undefined; sessionId?: Uuid | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<Result<{ items: SyncConflict[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listConflicts(tx, input)), { readOnly: true });
}

export interface ResolveConflictInput {
  readonly conflictId: Uuid;
  readonly resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING";
  readonly note?: string | undefined;
  readonly caps?: CallerCaps;
}

/**
 * Arbitrage d'un conflit (`attendance.manage`) : `KEEP_EXISTING` clôt le conflit ; `ACCEPT_INCOMING` applique la saisie de
 * l'appareil — impossible tant que l'appel est validé ou annulé (rouvrez-le d'abord : acte sensible).
 */
export async function resolveSyncConflict(deps: AttendanceDeps, ctx: RequestContext, input: ResolveConflictInput): Promise<Result<SyncConflict, AppError>> {
  const caps = input.caps ?? {};
  if (!caps.manage) return err(forbidden(AttendanceCode.FORBIDDEN, "Arbitrer un conflit de synchronisation exige la permission de gestion des appels."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const c = await getConflict(tx, input.conflictId, true);
    if (!c) return err(notFound(AttendanceCode.SYNC_CONFLICT_NOT_FOUND, "Conflit de synchronisation", input.conflictId));
    if (c.status === "RESOLVED") return err(conflict(AttendanceCode.SYNC_CONFLICT_RESOLVED, "Ce conflit est déjà arbitré.", { resolution: c.resolution }));

    if (input.resolution === "ACCEPT_INCOMING") {
      const session = await getSession(tx, c.sessionId, "SHARE");
      if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", c.sessionId));
      const context = await loadSessionContext(deps, ctx, tx, session);
      const editable = checkEditable(session, context.policy, { now: deps.clock.now(), canManage: true });
      if (!editable.ok) return editable;
      const inc = c.incoming as {
        statusCode: string; minutesLate?: number | null; minutesMissed?: number | null; arrivedAt?: string | null; leftAt?: string | null; note?: string | null; clientMarkedAt?: string | null;
      };
      const applied = await applyMarks(deps, ctx, tx, events, {
        session, context, source: humanSourceOf(caps),
        entries: [{
          studentId: c.studentId, statusCode: inc.statusCode, minutesLate: inc.minutesLate ?? undefined, minutesMissed: inc.minutesMissed ?? undefined,
          arrivedAt: inc.arrivedAt ? new Date(inc.arrivedAt) : undefined, leftAt: inc.leftAt ? new Date(inc.leftAt) : undefined, note: inc.note ?? undefined,
        }],
      });
      if (!applied.ok) return applied;
    }
    const resolved = await resolveConflictRow(tx, c.id, { resolution: input.resolution, resolvedBy: actor, resolvedAt: deps.clock.now(), note: input.note?.trim() || null });
    events.audit({
      action: "attendance.sync_conflict.resolved",
      resourceType: "sync_conflict",
      resourceId: c.id,
      sensitive: true,
      reason: input.note ?? null,
      before: { kind: c.kind, incoming: c.incoming, existing: c.existing },
      after: { resolution: input.resolution },
    });
    await events.flush(tx);
    return ok(resolved);
  });
}

