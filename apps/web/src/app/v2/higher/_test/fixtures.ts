/** Jeux de données de test conformes aux contrats `packages/contracts/src/v2/higher.ts` (réponses validées par Zod). */
import { uuid } from "../../_test/fixtures";

export { uuid };
export const NOW = "2026-10-01T08:00:00.000Z";

export function diploma(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(8000),
    institutionId: null,
    code: "LIC-INFO",
    label: "Licence Informatique",
    gradeCode: "LICENCE",
    curriculumNodeId: uuid(8100),
    uvRequired: 180,
    autoAward: false,
    status: "ACTIVE",
    description: null,
    lastSyncedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function requirement(n: number, over: Partial<Record<string, unknown>> = {}) {
  return { id: uuid(8200 + n), ueNodeId: uuid(8300 + n), ueCode: `UE${n}`, ueLabel: `Unité ${n}`, credits: 6, mandatory: true, position: n, removedFromCurriculum: false, ...over };
}

export function diplomaDetail(over: Partial<Record<string, unknown>> = {}) {
  return { diploma: diploma(), requirements: [requirement(1), requirement(2, { mandatory: false, removedFromCurriculum: true })], requirementsCredits: 12, awardCounts: { total: 2, obtained: 1 }, ...over };
}

export function candidate(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    studentId: uuid(3000 + n),
    fullName: ["", "Aka Marie", "Bamba Yao", "Coulibaly Awa"][n] ?? `Étudiant ${n}`,
    matricule: `ELV-00${n}`,
    classroomId: uuid(500),
    academicYearId: uuid(100),
    uvValidated: 180,
    percent: 100,
    missingMandatory: 0,
    eligible: true,
    awardStatus: null,
    awardReference: null,
    acquiredDate: null,
    revokeReason: null,
    ...over,
  };
}

const rule = { ruleSetCode: "CI-HIGHER-LMD", ruleVersionId: uuid(6100), versionNo: 1, definitionHash: "a".repeat(64) };

export function award(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(8400 + n),
    definitionId: uuid(8000),
    studentId: uuid(3000 + n),
    lastEnrollmentId: null,
    academicYearId: null,
    reference: `DIP-2026-00${n}`,
    status: "OBTAINED",
    awardedVia: "AUTO",
    forcedReason: null,
    creditsTotal: 180,
    requirements: [],
    cycleAverage: "13.4999",
    mentionCode: "ASSEZ_BIEN",
    rule,
    awardedAt: NOW,
    awardedBy: null,
    awardedByName: "Système",
    acquiredDate: "2026-09-15",
    revokedAt: null,
    revokedByName: null,
    revokeReason: null,
    predecessorAwardId: null,
    reawardDecision: null,
    ...over,
  };
}

export function document(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(8500 + n),
    documentKind: "DIPLOMA",
    awardId: uuid(8401),
    studentId: uuid(3001),
    programNodeId: null,
    reference: `DOC-2026-00${n}`,
    version: 1,
    supersedesId: null,
    status: "ISSUED",
    snapshotSchema: "diploma/1",
    snapshotHash: "b".repeat(64),
    verificationCode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    sealed: true,
    renderStatus: "RENDERED",
    issuedAt: NOW,
    issuedByName: "Mme Koffi",
    publishedAt: null,
    revokedAt: null,
    revokeReason: null,
    ...over,
  };
}

export function studentDetail(id: number, name: string) {
  return {
    id: uuid(3000 + id),
    personId: uuid(4000 + id),
    studentNumber: `ELV-00${id}`,
    sequenceNumber: id,
    lastName: name.split(" ")[0],
    firstName: name.split(" ")[1],
    displayName: name,
    sex: null,
    status: "ACTIVE",
    hasPhoto: false,
    currentEnrollment: null,
    access: "FULL",
    otherNames: null,
    birthDate: null,
    birthPlace: null,
    nationality: null,
    email: null,
    phone: null,
    phoneAlt: null,
    addressLine: null,
    city: null,
    residence: null,
    firstEnrolledOn: null,
    leftOn: null,
    primaryGuardian: null,
    portalAccount: "NONE",
    externalRef: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function ledgerEntry(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(8600 + n),
    studentId: uuid(3001),
    enrollmentId: uuid(2001),
    ueNodeId: uuid(8300 + n),
    academicYearId: uuid(100),
    academicPeriodId: uuid(200),
    credits: 6,
    averageExact: "12.5",
    acquiredVia: "DIRECT",
    sessionObtained: 1,
    status: "ACQUIRED",
    compensatedEcueCount: 0,
    overrideId: null,
    sourceResultId: uuid(6201),
    sourceResultsVersion: 1,
    validUntil: null,
    acquiredAt: NOW,
    revokedAt: null,
    revokeReason: null,
    expiredAt: null,
    ...over,
  };
}

export function resitWindow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(8700),
    classroomId: uuid(500),
    academicPeriodId: uuid(200),
    resultsStateId: uuid(6000),
    opensOn: "2026-11-01",
    closesOn: "2026-11-15",
    nodeIds: null,
    status: "OPEN",
    openedBy: uuid(901),
    openedAt: NOW,
    closedBy: null,
    closedAt: null,
    ...over,
  };
}

export function registration(n: number, over: Partial<Record<string, unknown>> = {}) {
  return { id: uuid(8800 + n), windowId: uuid(8700), enrollmentId: uuid(2000 + n), studentId: uuid(3000 + n), academicPeriodId: uuid(200), ecueNodeId: uuid(8900 + n), ueNodeId: uuid(8300 + n), session1Average: "8.75", status: "REGISTERED", outcome: null, ...over };
}
