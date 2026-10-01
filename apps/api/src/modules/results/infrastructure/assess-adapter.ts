/**
 * Implémentation RÉELLE du port `AssessPort` : API publique du module `assess` (`index.ts`), dans la transaction de
 * l'appelant. `results` ne lit jamais le schéma `assess` : il reçoit des notes PUBLIÉES et verrouille la période par la
 * fonction publique `lockPeriodGrades` (le déclencheur SQL d'assess impose le verrou, par session).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { listPendingAssessments, listPublishedGrades, lockPeriodGrades, releaseSessionLock, unlockPeriodGrades, type AssessDeps } from "../../assess";
import type { AssessPort, LockOutcome, PendingAssessmentInfo } from "../application/ports";
import type { GradeFact } from "../domain/types";

export function assessPortFrom(deps: AssessDeps): AssessPort {
  return {
    async listPublished(ctx: RequestContext, tx: Tx, input): Promise<readonly GradeFact[]> {
      const r = await listPublishedGrades(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, tx });
      if (!r.ok) throw r.error;
      return r.value.map((g) => ({
        gradeId: g.gradeId,
        assessmentId: g.assessmentId,
        enrollmentId: g.enrollmentId,
        curriculumNodeId: g.curriculumNodeId,
        sessionNo: g.sessionNo,
        assessedOn: g.assessedOn,
        aggregationGroup: g.aggregationGroup,
        scaleMax: g.scaleMax,
        weight: g.weight,
        score: g.score,
        entryStatus: g.entryStatus,
      }));
    },
    async lock(ctx: RequestContext, tx: Tx, input): Promise<Result<LockOutcome, AppError>> {
      const r = await lockPeriodGrades(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, sessions: input.sessions, force: input.force, reason: input.reason, tx });
      if (!r.ok) return r;
      return ok({ alreadyLocked: r.value.alreadyLocked, pending: r.value.pending });
    },
    async unlock(ctx: RequestContext, tx: Tx, input): Promise<Result<void, AppError>> {
      const r = await unlockPeriodGrades(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, reason: input.reason, tx });
      return r.ok ? ok(undefined) : r;
    },
    async releaseSession2(ctx: RequestContext, tx: Tx, input): Promise<Result<void, AppError>> {
      const r = await releaseSessionLock(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, reason: input.reason, session: 2, tx });
      return r.ok ? ok(undefined) : r;
    },
    async listPending(ctx: RequestContext, tx: Tx, input): Promise<readonly PendingAssessmentInfo[]> {
      const r = await listPendingAssessments(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, tx });
      if (!r.ok) throw r.error;
      return r.value;
    },
  };
}
