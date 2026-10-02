/**
 * Jeux de données de test conformes aux contrats `packages/contracts/src/v2/primary_school.ts` (les réponses sont validées par Zod).
 * Tous les noms, niveaux et phrases sont FICTIFS (aucune règle ni référentiel officiel).
 */
import { uuid } from "../../_test/fixtures";

export { uuid };
export const NOW = "2026-10-01T08:00:00.000Z";
export const P = "/api/v1/primary_school";

export const ID = {
  institution: uuid(1),
  year: uuid(100),
  classroom: uuid(500),
  classroom2: uuid(501),
  p1: uuid(9001),
  p2: uuid(9002),
  scale: uuid(9100),
  framework: uuid(9200),
  domainA: uuid(9301),
  domainB: uuid(9302),
  deliberation: uuid(9700),
  staffChair: uuid(9801),
  staffSecretary: uuid(9802),
  staffTeacher: uuid(9803),
} as const;

export const level = (n: number) => uuid(9100 + n);
export const competency = (n: number) => uuid(9400 + n);
export const enrollment = (n: number) => uuid(9500 + n);
export const student = (n: number) => uuid(3000 + n);
export const caseId = (n: number) => uuid(9600 + n);
export const reviewId = (n: number) => uuid(9900 + n);

export const STUDENT_NAMES = ["", "Aka Marie", "Bamba Yao", "Coulibaly Awa"] as const;

export function myClassroom(over: Partial<Record<string, unknown>> = {}) {
  return {
    classroomId: ID.classroom,
    name: "CE1 A",
    gradeLevelCode: "CE1",
    academicYearId: ID.year,
    studentCount: 3,
    periods: [
      { id: ID.p1, label: "Trimestre 1", locked: false },
      { id: ID.p2, label: "Trimestre 2", locked: true },
    ],
    isHomeroom: true,
    ...over,
  };
}

export function ratingLevel(n: number, over: Partial<Record<string, unknown>> = {}) {
  const defs = [
    ["", "", false],
    ["N1", "Non atteint", false],
    ["N2", "En cours d'acquisition", false],
    ["N3", "Attendu atteint", true],
    ["N4", "Dépassé", true],
  ] as const;
  const d = defs[n]!;
  return { id: level(n), code: d[0], label: d[1], ordinal: n, meetsExpectation: d[2], ...over };
}

export function ratingScale(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: ID.scale,
    code: "ECHELLE_DEMO",
    label: "Échelle de démonstration (fictive)",
    sourceKind: "placeholder",
    sourceReference: null,
    status: "ACTIVE",
    levels: [1, 2, 3, 4].map((n) => ratingLevel(n)),
    locked: true,
    ...over,
  };
}

export function framework(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: ID.framework,
    code: "REF_DEMO",
    version: 1,
    label: "Référentiel de démonstration (fictif)",
    scaleId: ID.scale,
    status: "PUBLISHED",
    sourceKind: "placeholder",
    sourceReference: null,
    publishedAt: NOW,
    gradeLevelCodes: ["CE1"],
    competencyCount: 4,
    ...over,
  };
}

export function frameworkDetail(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...framework(),
    domains: [
      {
        id: ID.domainA,
        code: "D1",
        label: "Domaine 1 (fictif)",
        ordinal: 1,
        competencies: [
          { id: competency(1), code: "D1.1", label: "Compétence 1.1 (fictive)", description: null, ordinal: 1 },
          { id: competency(2), code: "D1.2", label: "Compétence 1.2 (fictive)", description: "Description fictive", ordinal: 2 },
        ],
      },
      {
        id: ID.domainB,
        code: "D2",
        label: "Domaine 2 (fictif)",
        ordinal: 2,
        competencies: [
          { id: competency(3), code: "D2.1", label: "Compétence 2.1 (fictive)", description: null, ordinal: 1 },
          { id: competency(4), code: "D2.2", label: "Compétence 2.2 (fictive)", description: null, ordinal: 2 },
        ],
      },
    ],
    scale: ratingScale(),
    publishBlockers: [],
    ...over,
  };
}

export function assessment(student_: number, competency_: number, level_: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(9800 + student_ * 10 + competency_),
    enrollmentId: enrollment(student_),
    studentId: student(student_),
    competencyId: competency(competency_),
    ratingLevelId: level(level_),
    observedOn: "2026-10-01",
    note: null,
    status: "DRAFT",
    rowVersion: 1,
    validatedAt: null,
    ...over,
  };
}

export function sheet(over: Partial<Record<string, unknown>> = {}) {
  return {
    classroomId: ID.classroom,
    periodId: ID.p1,
    gradeLevelCode: "CE1",
    locked: false,
    frameworks: [framework()],
    framework: frameworkDetail(),
    students: [1, 2, 3].map((n) => ({ enrollmentId: enrollment(n), studentId: student(n), displayName: STUDENT_NAMES[n]!, isRepeating: n === 3 })),
    assessments: [],
    completeness: { expected: 12, recorded: 0, validated: 0, byEnrollment: [1, 2, 3].map((n) => ({ enrollmentId: enrollment(n), recorded: 0, validated: 0 })) },
    ...over,
  };
}

export function bulkResult(assessments: unknown[], over: Partial<Record<string, unknown>> = {}) {
  return { created: assessments.length, updated: 0, unchanged: 0, assessments, ...over };
}

export function summary(over: Partial<Record<string, unknown>> = {}) {
  return {
    enrollmentId: enrollment(1),
    periodIds: [ID.p1],
    summary: { D1: { N2: 1, N3: 1 }, D2: { N3: 2 } },
    domainLabels: { D1: "Domaine 1 (fictif)", D2: "Domaine 2 (fictif)" },
    levelLabels: { N1: "Non atteint", N2: "En cours d'acquisition", N3: "Attendu atteint", N4: "Dépassé" },
    levelOrder: ["N1", "N2", "N3", "N4"],
    ...over,
  };
}

export function phrase(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(9950 + n),
    code: `PHRASE_${n}`,
    scope: "PERIOD",
    body: `Phrase fictive numéro ${n}.`,
    ratingLevelCode: null,
    gradeLevelCode: null,
    sourceKind: "placeholder",
    active: true,
    ...over,
  };
}

export function councilCase(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: caseId(n),
    deliberationId: ID.deliberation,
    classroomId: ID.classroom,
    enrollmentId: enrollment(n),
    studentId: student(n),
    studentName: STUDENT_NAMES[n]!,
    reasonCodes: ["BORDERLINE"],
    ruleProposalCode: "PROMOTED",
    proposalCode: null,
    proposalNote: null,
    discussionNote: null,
    status: "OPEN",
    decisionRef: null,
    finalCode: null,
    justification: null,
    ...over,
  };
}

export function councilAttendance(staffId: string, name: string, roleCode: string, over: Partial<Record<string, unknown>> = {}) {
  return { staffId, staffName: name, roleCode, convened: true, present: null, signedAt: null, note: null, ...over };
}

export function councilOverview(over: Partial<Record<string, unknown>> = {}) {
  return {
    deliberationId: ID.deliberation,
    classroomId: ID.classroom,
    periodId: ID.p1,
    heldOn: null,
    ruleSourceKind: "placeholder",
    counts: { total: 2, open: 2, decided: 0, deferred: 0 },
    quorum: { convened: 2, present: 0, met: null, source: "none" },
    cases: [councilCase(1), councilCase(2, { reasonCodes: ["RULE_REVIEW"], ruleProposalCode: "COUNCIL_REVIEW" })],
    attendance: [councilAttendance(ID.staffChair, "Direction Kouassi", "CHAIR"), councilAttendance(ID.staffSecretary, "Secrétaire Traoré", "SECRETARY")],
    minutesDocumentId: null,
    ...over,
  };
}

export function councilSummary(over: Partial<Record<string, unknown>> = {}) {
  return { deliberationId: ID.deliberation, classroomId: ID.classroom, periodId: ID.p1, total: 2, open: 2, decided: 0, ...over };
}

export function review(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: reviewId(n),
    academicYearId: ID.year,
    enrollmentId: enrollment(n),
    studentId: student(n),
    studentName: STUDENT_NAMES[n]!,
    classroomId: ID.classroom,
    gradeLevelCode: "CE1",
    version: 1,
    status: "DRAFT",
    yearResultRef: null,
    decisionRef: null,
    outcomeCode: null,
    competencySummary: { D1: { N3: 2 } },
    attendanceSummary: { openDays: 120, absentDays: 3 },
    ruleVersionRef: null,
    ruleSourceKind: "placeholder",
    contentHash: null,
    sealedAt: null,
    reportcardId: null,
    supersedesId: null,
    supersedeReason: null,
    ...over,
  };
}

export const HASH = "a".repeat(64);

export function archive(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(9990),
    institutionId: ID.institution,
    academicYearId: ID.year,
    status: "PREPARING",
    reviewsTotal: 3,
    reviewsSealed: 2,
    manifestHash: null,
    preparedAt: NOW,
    frozenAt: null,
    blockers: [{ code: "primary_school.archive_not_ready", message: "1 bilan(s) non scellé(s)." }],
    ...over,
  };
}

export function progress(over: Partial<Record<string, unknown>> = {}) {
  return {
    classroomId: ID.classroom,
    name: "CE1 A",
    periodId: ID.p1,
    locked: false,
    studentCount: 3,
    competencies: { expected: 12, recorded: 6, validated: 0 },
    reviews: { total: 3, sealed: 0 },
    ...over,
  };
}

export function report(over: Partial<Record<string, unknown>> = {}) {
  return {
    key: "class-list",
    title: "Liste de classe",
    generatedAt: NOW,
    parameters: { classroomId: ID.classroom },
    columns: [
      { key: "name", label: "Nom" },
      { key: "count", label: "Effectif" },
    ],
    rows: [
      { name: "Aka Marie", count: 1 },
      { name: "Bamba Yao", count: 2 },
    ],
    ...over,
  };
}

export function settings(over: Partial<Record<string, unknown>> = {}) {
  return {
    institutionId: ID.institution,
    requireHomeroomForActivation: true,
    councilRequiredForBilan: true,
    phraseBankEnabled: true,
    defaultRatingScaleId: null,
    archiveRetentionYears: null,
    ...over,
  };
}

/** Corps d'erreur de l'API (`{ code, message, … }`), tel que normalisé par le client. */
export function apiErrorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { code, message, ...extra };
}
