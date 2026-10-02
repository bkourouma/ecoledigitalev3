/** Jeux de données de test (reconduction, paramètres académiques) conformes aux contrats `packages/contracts/src/v2/academic.ts`. */
import { uuid } from "./fixtures";

const FROM = uuid(101);
const TO = uuid(102);

export const ROLLOVER_FROM = FROM;
export const ROLLOVER_TO = TO;

export function rolloverEnrollmentsPreview(over: Partial<Record<string, unknown>> = {}) {
  return {
    fromAcademicYearId: FROM,
    toAcademicYearId: TO,
    classroomsToCreate: [{ programId: uuid(300), gradeLevelId: uuid(601), name: "Licence 2 A", code: "L2-A" }],
    enrollmentsToCreate: [
      { previousEnrollmentId: uuid(1000), studentId: uuid(2000), outcomeKind: "ADVANCE", targetProgramId: uuid(300), targetGradeLevelId: uuid(601), isRepeating: false, fundingType: "PRIVATE", carriesFunding: true },
    ],
    alreadyRolledOver: 3,
    byOutcome: { ADMIS: 10, AJOURNE: 2 },
    anomalies: [{ code: "outcome_missing", enrollmentId: uuid(1001), classroomId: null, message: "Aucune décision de fin d'année pour Awa Traoré." }],
    ...over,
  };
}

export function rolloverPlan(over: Partial<Record<string, unknown>> = {}) {
  return {
    fromAcademicYearId: FROM,
    toAcademicYearId: TO,
    steps: ["PERIODS", "HOLIDAYS", "CURRICULUM", "CLASSROOMS", "ENROLLMENTS"],
    liveRunId: null,
    warnings: [
      { code: "holidays_not_recurring", step: "HOLIDAYS", message: "2 jours de l'année source ne se répètent pas." },
      { code: "promotion_decisions_missing", step: "ENROLLMENTS", message: "1 élève sans décision de passage." },
    ],
    periods: {
      toCreate: [{ code: "S1", parentCode: null, periodTypeCode: "SEMESTER", ordinal: 1, label: "Semestre 1", startsOn: "2026-09-01", endsOn: "2027-01-31" }],
      existing: 0,
    },
    holidays: {
      toCreate: [{ label: "Fête du travail", kind: "HOLIDAY", startsOn: "2027-05-01", endsOn: "2027-05-01" }],
      existing: 0,
      notRecurring: 2,
    },
    curriculum: {
      items: [
        { programId: uuid(300), programCode: "LIC_INFO", programLabel: "Licence Informatique", sourceVersionId: uuid(700), sourceStatus: "PUBLISHED", nodeCount: 40, targetVersionId: null, action: "CLONE" },
        { programId: uuid(301), programCode: "LIC_GEST", programLabel: "Licence Gestion", sourceVersionId: null, sourceStatus: null, nodeCount: 0, targetVersionId: null, action: "NO_SOURCE" },
      ],
    },
    classrooms: {
      toCreate: [{ sourceClassroomId: uuid(500), code: "L1-A", name: "Licence 1 A", programId: uuid(300), gradeLevelId: uuid(600), capacity: 40 }],
      existing: 1,
    },
    offerings: { toCreate: 0, existing: 0 },
    enrollments: rolloverEnrollmentsPreview(),
    ...over,
  };
}

export function rolloverRun(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(9000),
    institutionId: uuid(1),
    fromAcademicYearId: FROM,
    toAcademicYearId: TO,
    status: "RUNNING",
    steps: ["PERIODS", "CURRICULUM"],
    requestedBy: null,
    requestedAt: "2026-10-01T08:00:00.000Z",
    startedAt: "2026-10-01T08:00:05.000Z",
    finishedAt: null,
    attempts: 1,
    progress: {
      stage: "PERIODS",
      steps: [
        { key: "PERIODS", status: "RUNNING", done: 2, total: 4, message: null },
        { key: "CURRICULUM", status: "PENDING", done: 0, total: 0, message: null },
      ],
    },
    report: null,
    errorMessage: null,
    ...over,
  };
}

export function rolloverReport(over: Partial<Record<string, unknown>> = {}) {
  return {
    periodsCreated: 4,
    holidaysCreated: 6,
    curriculumVersionsCreated: 2,
    classroomsCreated: 5,
    offeringsCreated: 0,
    enrollmentsCreated: 120,
    alreadyRolledOver: 7,
    skipped: 3,
    warnings: [{ code: "conflict", step: "CLASSROOMS", message: "La classe L1-A existe déjà." }],
    anomalies: [{ code: "target_classroom_full", enrollmentId: uuid(1002), classroomId: uuid(501), message: "La classe Licence 2 A est complète." }],
    ...over,
  };
}
