/** Jeux de données de test conformes aux contrats `packages/contracts/src/v2/assess.ts` (réponses validées par Zod). */
import { uuid } from "../../_test/fixtures";

export { uuid };

export const NOW = "2026-10-01T08:00:00.000Z";

export function assessmentType(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(700),
    code: "DEVOIR",
    label: "Devoir",
    aggregationGroup: "CONTINUOUS",
    defaultScaleMax: "20",
    defaultWeight: "1",
    publicationMode: "MANUAL",
    visibleToStudents: true,
    allowsSession2: false,
    isSystem: false,
    templateKey: null,
    position: 0,
    active: true,
    ...over,
  };
}

export function assessment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(800),
    typeId: uuid(700),
    typeCode: "DEVOIR",
    aggregationGroup: "CONTINUOUS",
    classroomId: uuid(500),
    curriculumNodeId: uuid(510),
    academicPeriodId: uuid(200),
    academicYearId: uuid(100),
    teacherId: uuid(900),
    title: "Devoir 1 de mathématiques",
    assessedOn: "2026-10-01",
    scaleMax: "20",
    weight: "1",
    sessionNo: 1,
    status: "DRAFT",
    submittedAt: null,
    submittedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    approvedAt: null,
    approvedBy: null,
    publishedAt: null,
    publishedBy: null,
    cancelledAt: null,
    cancelReason: null,
    fourEyesWaived: false,
    returnComment: null,
    rowVersion: 3,
    createdAt: NOW,
    ...over,
  };
}

export function grade(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(1000 + n),
    assessmentId: uuid(800),
    enrollmentId: uuid(2000 + n),
    studentId: uuid(3000 + n),
    score: null,
    entryStatus: "NOT_GRADED",
    comment: null,
    status: "DRAFT",
    rowVersion: 1,
    enteredAt: null,
    correctedAt: null,
    ...over,
  };
}

export function revision(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(1500),
    assessmentId: uuid(800),
    gradeId: uuid(1001),
    enrollmentId: uuid(2001),
    kind: "CORRECTION",
    oldScore: "12",
    oldEntryStatus: "ENTERED",
    newScore: "14",
    newEntryStatus: "ENTERED",
    reason: "Erreur de report de la note sur la copie.",
    requestedBy: uuid(901),
    requestedByName: "M. Koné",
    requestedAt: NOW,
    status: "REQUESTED",
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decisionComment: null,
    fourEyesWaived: false,
    appliedAt: null,
    batchId: null,
    ...over,
  };
}

/** Élèves de la classe de test (liste `people`), alignés sur les inscriptions 2001..2003. */
export function studentSummary(n: number, name: string, number: string) {
  return {
    id: uuid(3000 + n),
    personId: uuid(4000 + n),
    studentNumber: number,
    sequenceNumber: n,
    lastName: name.split(" ")[0],
    firstName: name.split(" ").slice(1).join(" "),
    displayName: name,
    sex: null,
    status: "ACTIVE",
    hasPhoto: false,
    currentEnrollment: { enrollmentId: uuid(2000 + n), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "Licence 1 A", status: "CONFIRMED", registrationNumber: number },
  };
}

export const STUDENTS = {
  items: [studentSummary(1, "Aka Marie", "ELV-001"), studentSummary(2, "Bamba Yao", "ELV-002"), studentSummary(3, "Coulibaly Awa", "ELV-003")],
  total: 3,
  limit: 200,
  offset: 0,
};

export const SETTINGS = { requireSeparateReviewer: true, requireSeparateApprover: true, maxScoreDecimals: 2, lateGradePolicy: "REVISION", updatedAt: null };
