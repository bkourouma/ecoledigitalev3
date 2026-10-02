/** Jeux de données des portails famille (parent, élève) conformes aux contrats v2 (réponses validées par Zod). */
import { uuid } from "./fixtures";
import { fid, installment, invoiceSummary, payment, xof } from "./fixtures-finance";
import { studentSummary } from "./fixtures-people";

export { uuid, fid, xof };

type Over = Partial<Record<string, unknown>>;

/** Enfants de test : Mariam (6e A) et Yao (CM2), plus un élève NON lié au compte. */
export const MARIAM = uuid(2001);
export const YAO = uuid(2002);
export const STRANGER = uuid(2999);
export const PERIOD_1 = uuid(200);
export const PERIOD_2 = uuid(201);
export const NODE_MATHS = uuid(310);
export const NODE_FRENCH = uuid(311);
export const CLASSROOM = uuid(500);

export const mariam = studentSummary({
  id: MARIAM,
  displayName: "KONE Mariam",
  currentEnrollment: { enrollmentId: uuid(1), academicYearId: uuid(100), institutionId: uuid(9), classroomId: CLASSROOM, classroomName: "6e A", status: "ACTIVE", registrationNumber: "R-1" },
});
export const yao = studentSummary({ id: YAO, displayName: "KONE Yao", currentEnrollment: { enrollmentId: uuid(2), academicYearId: uuid(100), institutionId: uuid(9), classroomId: uuid(501), classroomName: "CM2", status: "ACTIVE", registrationNumber: "R-2" } });

export function familyLabels(over: Over = {}) {
  return {
    classrooms: [{ id: CLASSROOM, name: "6e A", code: "6A", academicYearId: uuid(100) }],
    periods: [
      { id: PERIOD_1, academicYearId: uuid(100), parentPeriodId: null, periodTypeCode: "SEMESTER", ordinal: 1, code: "S1", label: "Semestre 1", startsOn: "2026-09-01", endsOn: "2027-01-31" },
      { id: PERIOD_2, academicYearId: uuid(100), parentPeriodId: null, periodTypeCode: "SEMESTER", ordinal: 2, code: "S2", label: "Semestre 2", startsOn: "2027-02-01", endsOn: "2027-06-30" },
    ],
    nodes: [
      { id: NODE_MATHS, parentId: null, nodeTypeCode: "SUBJECT", code: "MATH", label: "Mathématiques", ordinal: 1, coefficient: "3", credits: null, isTransversal: false },
      { id: NODE_FRENCH, parentId: null, nodeTypeCode: "SUBJECT", code: "FR", label: "Français", ordinal: 2, coefficient: "2", credits: null, isTransversal: false },
    ],
    ...over,
  };
}

export function familyResult(over: Over = {}) {
  return {
    academicPeriodId: PERIOD_1,
    scope: "PERIOD",
    version: 1,
    average: "13.5000",
    averageDisplay: "13,50",
    rank: 3,
    cohortSize: 30,
    mentionCode: "AB",
    decisionCode: "ADMIS",
    decisionOutcome: "ADMITTED",
    creditsAcquired: "30",
    creditsRequired: "30",
    validated: true,
    finalizedAt: "2027-02-05T08:00:00.000Z",
    lines: [
      { level: "SUBJECT", curriculumNodeId: NODE_MATHS, value: "15.0000", displayValue: "15,00", credits: null, coefficient: "3", validated: true, statusCode: null, rank: 2 },
      { level: "SUBJECT", curriculumNodeId: NODE_FRENCH, value: "9.5000", displayValue: "9,50", credits: null, coefficient: "2", validated: false, statusCode: null, rank: 20 },
    ],
    ...over,
  };
}

export function publishedGrade(n: number, over: Over = {}) {
  return {
    gradeId: uuid(6000 + n),
    assessmentId: uuid(6100 + n),
    title: `Composition ${n}`,
    typeLabel: "Composition",
    curriculumNodeId: NODE_MATHS,
    academicPeriodId: PERIOD_1,
    assessedOn: "2026-10-10",
    sessionNo: 1,
    score: "14.5",
    entryStatus: "ENTERED",
    scaleMax: "20",
    weight: "1",
    publishedAt: "2026-10-15T08:00:00.000Z",
    correctedAt: null,
    ...over,
  };
}

export const gradesPage = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

export function familyInstallment(over: Over = {}) {
  return { ...installment(), invoiceId: fid(50), invoiceNumber: "FAC-2026-000001", invoiceStatus: "ISSUED", academicYear: "2026-2027", ...over };
}

export function familyStatement(learnerId: string, over: Over = {}) {
  return {
    learnerId,
    currency: "XOF",
    invoices: [invoiceSummary({ learnerId })],
    payments: [payment({ learnerId })],
    totals: { billed: xof(500000), credited: xof(0), collected: xof(150000), outstanding: xof(350000), unallocatedPayments: xof(0) },
    ...over,
  };
}

export const NOT_FOUND = { code: "finance.not_found", message: "Ressource introuvable." };
