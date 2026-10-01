/**
 * Port `ScheduleConflictChecker` (déclaré par le module `academic`, spec 004) : à l'inscription d'un
 * apprenant à une offre à la carte, signale les chevauchements d'horaire avec ses autres cours.
 * Toujours un AVERTISSEMENT, jamais un blocage (AC8.3). Câblé dans `createAcademicDeps`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { SchedulingCodes, academicUnavailable } from "../domain/errors";
import { studentOfferingOverlaps } from "../infrastructure/read-queries";
import { inTx, type SchedulingDeps } from "./deps";
import { NotFoundError } from "@ecoledigitale/kernel";

export interface StudentScheduleConflict {
  /** Séance de l'offre visée. */
  occurrenceId: string;
  /** Séance de l'autre cours qui la chevauche. */
  conflictingOccurrenceId: string;
  startsAt: Date;
  endsAt: Date;
  /** L'autre cours : une offre à la carte ou une classe réunie. */
  with: { kind: "OFFERING"; id: string } | { kind: "CLASSROOM"; id: string };
}

export interface StudentOfferingCheck {
  studentId: string;
  offeringId: string;
}

export interface ScheduleConflictChecker {
  checkStudentOffering(ctx: RequestContext, input: StudentOfferingCheck): Promise<Result<{ conflicts: StudentScheduleConflict[] }, AppError>>;
}

export function createScheduleConflictChecker(deps: SchedulingDeps): ScheduleConflictChecker {
  return {
    async checkStudentOffering(ctx, input) {
      const academic = deps.ports.academic;
      if (!academic) return err(academicUnavailable());
      const offering = await academic.getOffering(ctx, input.offeringId);
      if (!offering) return err(NotFoundError.of("Offre", input.offeringId, { code: SchedulingCodes.notFound }));
      const placements = await academic.listStudentPlacements(ctx, input.studentId);
      const others = { classroomIds: placements.classroomIds, offeringIds: placements.offeringIds.filter((id) => id !== input.offeringId) };
      if (others.classroomIds.length === 0 && others.offeringIds.length === 0) return ok({ conflicts: [] });
      return inTx(
        deps,
        ctx,
        async (tx) => {
          const rows = await studentOfferingOverlaps(tx, input.offeringId, others, deps.clock.now());
          return ok({
            conflicts: rows.map<StudentScheduleConflict>((r) => ({
              occurrenceId: r.targetOccurrenceId,
              conflictingOccurrenceId: r.otherOccurrenceId,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              with: r.otherOfferingId ? { kind: "OFFERING", id: r.otherOfferingId } : { kind: "CLASSROOM", id: r.otherClassroomId as string },
            })),
          });
        },
        { readOnly: true },
      );
    },
  };
}
