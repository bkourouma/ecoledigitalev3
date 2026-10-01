/** Définition des contrats d'événements consommés par `results` (abonnés : `modules/results/subscribers.ts`). */
import { readEnrollmentEvent, readGradeEvent } from "../../src/modules/results/application/consumers";
import type { EventContract } from "./support";

const grade = (event: string, listsEnrollments: boolean, enrollmentRead: EventContract["reads"]): EventContract => ({
  consumer: "results",
  event,
  reads: [{ field: "classroomId", kind: "uuid" }, { field: "academicPeriodId", kind: "uuid" }, ...enrollmentRead],
  reader: (p) => readGradeEvent(p, listsEnrollments),
  readerOk: (r, payload) => {
    const ref = r as { classroomId: string; academicPeriodId: string; enrollmentIds: string[] | undefined } | null;
    if (!ref) return false;
    const p = payload as { enrollmentIds?: string[]; enrollmentId?: string };
    const expected = listsEnrollments ? p.enrollmentIds : p.enrollmentId ? [p.enrollmentId] : undefined;
    return JSON.stringify(ref.enrollmentIds) === JSON.stringify(expected);
  },
});

const enrollment = (verb: string, reads: EventContract["reads"] = []): EventContract => ({
  consumer: "results",
  event: `academic.enrollment.${verb}`,
  reads: [{ field: "classroomId", kind: "uuid" }, { field: "enrollmentId", kind: "uuid" }, ...reads],
  reader: readEnrollmentEvent,
  readerOk: (r, payload) => {
    const ref = r as { classroomIds: string[]; enrollmentId: string | undefined } | null;
    const p = payload as { classroomId: string; fromClassroomId?: string; enrollmentId: string };
    return !!ref && ref.classroomIds.includes(p.classroomId) && ref.enrollmentId === p.enrollmentId && (p.fromClassroomId === undefined || ref.classroomIds.includes(p.fromClassroomId));
  },
});

export const contracts: EventContract[] = [
  grade("assess.grade.published", true, [{ field: "enrollmentIds", kind: "array", required: false }]),
  grade("assess.grade.revised", false, [{ field: "enrollmentId", kind: "uuid", required: false }]),
  grade("assess.assessment.cancelled", true, [{ field: "enrollmentIds", kind: "array", required: false }]),
  enrollment("created"),
  // Transfert : les deux classes (origine et destination) sont recalculées.
  enrollment("transferred", [{ field: "fromClassroomId", kind: "uuid", required: false }]),
  enrollment("withdrawn"),
  // Aucun recalcul : la liaison de règles est seulement notée (les périodes gardent leur version épinglée).
  { consumer: "results", event: "rules.binding.changed", reads: [] },
];
