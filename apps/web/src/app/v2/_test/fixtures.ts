/** Jeux de données de test conformes aux contrats `packages/contracts/src/v2/*` (les réponses sont validées par Zod). */

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const INSTITUTION = uuid(1);

export function year(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(100),
    institutionId: INSTITUTION,
    code: "2026-2027",
    label: "Année 2026-2027",
    startsOn: "2026-09-01",
    endsOn: "2027-08-31",
    status: "OPEN",
    isCurrent: false,
    openedAt: null,
    closedAt: null,
    archivedAt: null,
    ...over,
  };
}

export function period(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(200),
    academicYearId: uuid(100),
    parentPeriodId: null,
    periodTypeCode: "SEMESTER",
    ordinal: 1,
    code: "S1",
    label: "Semestre 1",
    startsOn: "2026-09-01",
    endsOn: "2027-01-31",
    status: "PLANNED",
    openedAt: null,
    gradingClosedAt: null,
    closedAt: null,
    closedBy: null,
    reopenedCount: 0,
    ...over,
  };
}

export function program(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(300),
    institutionId: INSTITUTION,
    educationLevelId: uuid(400),
    parentProgramId: null,
    code: "LIC_INFO",
    label: "Licence Informatique",
    kindCode: "DEGREE",
    domainCode: null,
    description: null,
    durationMonths: 36,
    attributes: {},
    status: "ACTIVE",
    isCycle: false,
    calculationContract: null,
    gradeLevelIds: [],
    ...over,
  };
}

export function classroom(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(500),
    institutionId: INSTITUTION,
    campusId: null,
    academicYearId: uuid(100),
    programId: uuid(300),
    gradeLevelId: uuid(600),
    curriculumVersionId: null,
    kind: "CLASS",
    code: "L1-A",
    name: "Licence 1 A",
    capacity: 40,
    capacityIsHard: false,
    status: "ACTIVE",
    startsOn: null,
    endsOn: null,
    enrolledCount: 12,
    ...over,
  };
}

export function version(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(700),
    programId: uuid(300),
    academicYearId: uuid(100),
    status: "DRAFT",
    clonedFromVersionId: null,
    publishedAt: null,
    publishedBy: null,
    lockedAt: null,
    note: null,
    nodeCount: 3,
    ...over,
  };
}

export function node(over: Partial<Record<string, unknown>> = {}) {
  const id = (over.id as string | undefined) ?? uuid(800);
  return {
    id,
    versionId: uuid(700),
    parentId: null,
    nodeTypeCode: "UE",
    lineageId: (over.lineageId as string | undefined) ?? id,
    subjectId: null,
    gradeLevelId: null,
    periodTypeCode: null,
    periodOrdinal: null,
    code: "UE1",
    label: "Unité 1",
    ordinal: 0,
    coefficient: null,
    credits: "6",
    isMandatory: true,
    isTransversal: false,
    categoryCode: null,
    gradingMode: "COMPOSED",
    resitAllowed: true,
    countsInAverage: true,
    sectionKey: null,
    hoursTotal: null,
    hoursLecture: null,
    hoursTutorial: null,
    hoursPractical: null,
    attributes: {},
    status: "ACTIVE",
    prerequisiteLineageIds: [],
    children: [],
    ...over,
  };
}

export const nodeTypes = [
  { id: uuid(901), code: "UE", label: "Unité d'enseignement", allowedParentCodes: ["ROOT"], requiresGradeLevel: false, requiresPeriodSlot: false, requiresSubject: false, allowsCoefficient: false, allowsCredits: true, creditsMustEqualChildren: true, isEnrollable: false, isSystem: false, sortOrder: 1 },
  { id: uuid(902), code: "ECUE", label: "Élément constitutif", allowedParentCodes: ["UE"], requiresGradeLevel: false, requiresPeriodSlot: false, requiresSubject: false, allowsCoefficient: true, allowsCredits: true, creditsMustEqualChildren: false, isEnrollable: true, isSystem: false, sortOrder: 2 },
  { id: uuid(903), code: "SEMESTER", label: "Semestre", allowedParentCodes: ["ROOT"], requiresGradeLevel: false, requiresPeriodSlot: true, requiresSubject: false, allowsCoefficient: false, allowsCredits: false, creditsMustEqualChildren: false, isEnrollable: false, isSystem: false, sortOrder: 0 },
];

export const gradeLevels = [
  { id: uuid(600), educationLevelId: uuid(400), code: "L1", label: "Licence 1", shortLabel: "L1", ordinal: 1, nextGradeLevelId: null, isFinal: false, terminalExamRequired: false, active: true },
  { id: uuid(601), educationLevelId: uuid(400), code: "L2", label: "Licence 2", shortLabel: "L2", ordinal: 2, nextGradeLevelId: null, isFinal: false, terminalExamRequired: false, active: true },
];

export const educationLevels = [{ id: uuid(400), code: "HIGHER", label: "Enseignement supérieur", ordinal: 5, pack: "HIGHER", calculationContract: "credit-semester@1", active: true }];

export const institution = {
  id: INSTITUTION,
  tenantId: uuid(2),
  code: "main",
  name: "Établissement principal",
  pack: "HIGHER",
  educationSystem: "LMD",
  countryCode: "CI",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
