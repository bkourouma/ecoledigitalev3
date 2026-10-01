/**
 * Port `ScheduleConflictChecker` (déclaré par le module `academic`, spec 004) : à l'inscription d'un
 * apprenant à une offre à la carte, signale les chevauchements d'horaire avec ses autres cours.
 * Toujours un AVERTISSEMENT, jamais un blocage (AC8.3). Câblé dans `createAcademicDeps`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { SchedulingCodes, academicUnavailable } from "../domain/errors";
import { studentOfferingOverlaps } from "../infrastructure/read-queries";
import { formatTimeOfDay, localDateOf, localMinuteOf } from "../domain/time";
import { inTx, type SchedulingDeps } from "./deps";
import { loadSettings } from "./support";
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

/**
 * Forme EXACTE du port `ScheduleConflictChecker` déclaré par academic (spec 004,
 * `academic/application/ports.ts`) : appelé avec l'INSCRIPTION, il renvoie des descriptions lisibles et n'a pas de
 * canal d'erreur (un avertissement ne doit jamais empêcher l'inscription).
 */
export interface AcademicScheduleConflictChecker {
  checkStudentOffering(ctx: RequestContext, input: { enrollmentId: string; offeringId: string }): Promise<{ conflicts: Array<{ description: string }> }>;
}

/**
 * Adaptateur conforme au port d'academic (spec 017 §7) : résout l'apprenant de l'inscription, délègue à
 * `createScheduleConflictChecker` et formule chaque chevauchement dans le fuseau de l'établissement.
 * Échec OUVERT : sans port academic, inscription ou offre inconnue, erreur de lecture — aucun avertissement
 * (l'inscription ne dépend jamais du planning), l'erreur est journalisée.
 */
export function createAcademicScheduleConflictChecker(deps: SchedulingDeps): AcademicScheduleConflictChecker {
  const checker = createScheduleConflictChecker(deps);
  return {
    async checkStudentOffering(ctx, input) {
      const academic = deps.ports.academic;
      if (!academic) return { conflicts: [] };
      try {
        const studentId = await academic.getEnrollmentStudentId(ctx, input.enrollmentId);
        if (!studentId) return { conflicts: [] };
        const result = await checker.checkStudentOffering(ctx, { studentId, offeringId: input.offeringId });
        if (!result.ok) {
          deps.logger.warn({ code: result.error.code, offeringId: input.offeringId }, "scheduling.conflict_checker.failed");
          return { conflicts: [] };
        }
        if (result.value.conflicts.length === 0) return { conflicts: [] };
        const offering = await academic.getOffering(ctx, input.offeringId);
        const institutionId = offering ? ((await academic.getClassroom(ctx, offering.classroomId))?.institutionId ?? null) : null;
        const timeZone = institutionId ? await deps.db.run(ctx, async (tx) => (await loadSettings(tx, institutionId)).timezone, { readOnly: true }) : null;
        const conflicts: Array<{ description: string }> = [];
        for (const c of result.value.conflicts) {
          const other = c.with.kind === "OFFERING" ? (await academic.getOffering(ctx, c.with.id))?.label : (await academic.getClassroom(ctx, c.with.id))?.name;
          const label = other ?? (c.with.kind === "OFFERING" ? "une autre offre" : "sa classe");
          conflicts.push({ description: `Chevauchement avec ${c.with.kind === "OFFERING" ? "l'offre" : "la classe"} « ${label} » ${when(c.startsAt, c.endsAt, timeZone)}` });
        }
        return { conflicts };
      } catch (error) {
        deps.logger.warn({ error: error instanceof Error ? error.message : String(error), offeringId: input.offeringId }, "scheduling.conflict_checker.failed");
        return { conflicts: [] };
      }
    },
  };
}

function when(start: Date, end: Date, timeZone: string | null): string {
  if (!timeZone) return `le ${start.toISOString().slice(0, 10)} (${start.toISOString().slice(11, 16)}-${end.toISOString().slice(11, 16)} UTC)`;
  return `le ${localDateOf(start, timeZone)} de ${formatTimeOfDay(localMinuteOf(start, timeZone))} à ${formatTimeOfDay(localMinuteOf(end, timeZone))}`;
}
