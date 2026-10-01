/**
 * Verrous de période (API publique pour `results` et `higher`). Un verrou porte sur une CLASSE × PÉRIODE et distingue
 * les SESSIONS : `{1,2}` verrouille tout ; `{1}` est la fenêtre de rattrapage ouverte (la session 2 redevient
 * saisissable, les notes de session 1 restent verrouillées — AC6.4b). Un verrou actif ne peut qu'être RÉDUIT (jamais
 * élargi : on le relâche et on en pose un nouveau). L'écriture d'une note, d'une évaluation ou d'une publication sur une
 * session verrouillée est refusée par l'application ET par les déclencheurs de la base.
 *
 * Ces fonctions acceptent la transaction `tx` de l'appelant (clôture de période dans `results` : une seule transaction).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AssessCode, conflict, forbidden, validation } from "../domain/errors";
import { AssessEvents } from "../domain/events";
import type { PeriodLock, SessionNo } from "../domain/types";
import { listAssessmentsAwaiting } from "../infrastructure/grades-repository";
import { guarded } from "../infrastructure/db-errors";
import { getActiveLock, insertLock, listApprovedUnapplied, listLocks, releaseLock, shrinkLock } from "../infrastructure/revisions-repository";
import { EventBuffer, inTx, type AssessDeps } from "./deps";
import { applyApprovedInTx } from "./revisions";

export interface PendingAssessment {
  id: string;
  title: string;
  status: string;
  sessionNo: number;
  curriculumNodeId: string;
}

export interface LockPeriodInput {
  classroomId: string;
  academicPeriodId: string;
  /** Sessions à verrouiller (défaut `[1, 2]`). */
  sessions?: readonly SessionNo[] | undefined;
  reason?: string | null | undefined;
  /** Verrouiller malgré des évaluations non publiées (décision de la direction, motif porté par l'appelant). */
  force?: boolean | undefined;
  tx?: Tx | undefined;
}

export interface LockPeriodResult {
  lock: PeriodLock;
  /** Évaluations non publiées au moment du verrouillage (bloquantes sauf `force`). */
  pending: PendingAssessment[];
  alreadyLocked: boolean;
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export async function listPendingAssessments(deps: AssessDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; sessions?: readonly SessionNo[] | undefined; tx?: Tx | undefined }): Promise<Result<PendingAssessment[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const all = await listAssessmentsAwaiting(tx, input.classroomId, input.academicPeriodId);
      return ok(input.sessions ? all.filter((p) => input.sessions?.includes(p.sessionNo as SessionNo)) : all);
    },
    { readOnly: true, tx: input.tx },
  );
}

export async function lockPeriodGrades(deps: AssessDeps, ctx: RequestContext, input: LockPeriodInput): Promise<Result<LockPeriodResult, AppError>> {
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis pour verrouiller une période."));
  const wanted: SessionNo[] = [...(input.sessions ?? [1, 2])].sort() as SessionNo[];
  if (wanted.length === 0) return err(validation(AssessCode.INVALID_ENTRY, "Indiquez au moins une session à verrouiller.", "sessions"));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const pending = (await listAssessmentsAwaiting(tx, input.classroomId, input.academicPeriodId)).filter((p) => wanted.includes(p.sessionNo as SessionNo));
      if (pending.length > 0 && !input.force) {
        return err(
          conflict(AssessCode.PERIOD_LOCKED, "Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif.", {
            pending: pending.map((p) => ({ id: p.id, title: p.title, status: p.status, sessionNo: p.sessionNo })),
          }),
        );
      }
      const current = await getActiveLock(tx, input.classroomId, input.academicPeriodId, true);
      const events = new EventBuffer(deps, ctx);
      const now = deps.clock.now();
      let lock: PeriodLock;
      let already = false;
      if (current && wanted.every((s) => current.lockedSessions.includes(s))) {
        lock = current;
        already = true;
      } else {
        if (current) await guarded(() => releaseLock(tx, current.id, ctx.userId as string, "Verrou remplacé par un verrou plus étendu.", now));
        const sessions = current ? ([...new Set([...current.lockedSessions, ...wanted])].sort() as SessionNo[]) : wanted;
        lock = await guarded(() =>
          insertLock(tx, { id: deps.newId(), tenantId: ctx.tenantId, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, lockedBy: ctx.userId as string, reason: input.reason ?? null, sessions, at: now }),
        );
        events.add(AssessEvents.PERIOD_LOCKED, { v: 1, classroomId: lock.classroomId, academicPeriodId: lock.academicPeriodId, lockedSessions: lock.lockedSessions }, { type: "period_lock", id: lock.id });
        events.audit({
          action: "assess.period.locked",
          entity: "period_lock",
          entityId: lock.id,
          after: { classroomId: lock.classroomId, academicPeriodId: lock.academicPeriodId, lockedSessions: lock.lockedSessions, forced: pending.length > 0, pendingCount: pending.length },
          reason: input.reason ?? null,
          severity: pending.length > 0 ? "warning" : "notice",
        });
      }
      await events.flush(tx);
      return ok({ lock, pending, alreadyLocked: already });
    },
    { tx: input.tx },
  );
}

export interface ReleaseLockInput {
  classroomId: string;
  academicPeriodId: string;
  reason: string;
  tx?: Tx | undefined;
}

async function releaseSessions(deps: AssessDeps, ctx: RequestContext, tx: Tx, input: ReleaseLockInput, sessionsToRelease: readonly SessionNo[]): Promise<Result<{ lock: PeriodLock | null; applied: number }, AppError>> {
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis pour libérer un verrou."));
  if (input.reason.trim().length < 5) return err(validation(AssessCode.INVALID_ENTRY, "Le motif de libération du verrou est obligatoire (5 caractères au moins).", "reason"));
  const current = await getActiveLock(tx, input.classroomId, input.academicPeriodId, true);
  if (!current) return ok({ lock: null, applied: 0 });
  const remaining = current.lockedSessions.filter((s) => !sessionsToRelease.includes(s));
  if (remaining.length === current.lockedSessions.length) return ok({ lock: current, applied: 0 });
  const now = deps.clock.now();
  const events = new EventBuffer(deps, ctx);
  let lock: PeriodLock | null;
  if (remaining.length === 0) {
    lock = await guarded(() => releaseLock(tx, current.id, ctx.userId as string, input.reason, now));
  } else {
    lock = await guarded(() => shrinkLock(tx, current.id, remaining));
  }
  events.add(AssessEvents.PERIOD_UNLOCKED, { v: 1, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, lockedSessions: remaining }, { type: "period_lock", id: current.id });
  events.audit({
    action: "assess.period.unlocked",
    entity: "period_lock",
    entityId: current.id,
    before: { lockedSessions: current.lockedSessions },
    after: { lockedSessions: remaining },
    reason: input.reason,
    severity: "warning",
  });
  await events.flush(tx);
  // Les corrections approuvées pendant le verrou s'appliquent maintenant que leur session est libre.
  const applied = await applyApprovedInTx(deps, ctx, tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
  if (!applied.ok) return applied;
  return ok({ lock: remaining.length === 0 ? null : lock, applied: applied.value });
}

/** Libère la session 2 seulement (fenêtre de rattrapage) : le verrou passe de `{1,2}` à `{1}`. */
export async function releaseSessionLock(deps: AssessDeps, ctx: RequestContext, input: ReleaseLockInput & { session?: SessionNo | undefined }): Promise<Result<{ lock: PeriodLock | null; applied: number }, AppError>> {
  return inTx(deps, ctx, (tx) => releaseSessions(deps, ctx, tx, input, [input.session ?? 2]), { tx: input.tx });
}

/** Réouverture : libère toutes les sessions du verrou. */
export async function unlockPeriodGrades(deps: AssessDeps, ctx: RequestContext, input: ReleaseLockInput): Promise<Result<{ lock: PeriodLock | null; applied: number }, AppError>> {
  return inTx(deps, ctx, (tx) => releaseSessions(deps, ctx, tx, input, [1, 2]), { tx: input.tx });
}

export async function getPeriodLock(deps: AssessDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; tx?: Tx | undefined }): Promise<Result<PeriodLock | null, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await getActiveLock(tx, input.classroomId, input.academicPeriodId)), { readOnly: true, tx: input.tx });
}

export async function listPeriodLocks(deps: AssessDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; tx?: Tx | undefined }): Promise<Result<PeriodLock[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listLocks(tx, input.classroomId, input.academicPeriodId)), { readOnly: true, tx: input.tx });
}

export { listApprovedUnapplied };
