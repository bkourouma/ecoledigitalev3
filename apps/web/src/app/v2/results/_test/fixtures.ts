/** Jeux de données de test conformes aux contrats `results` et `rules` (réponses validées par Zod). */
import { uuid } from "../../_test/fixtures";

export { uuid };
export const NOW = "2026-10-01T08:00:00.000Z";
export const STATE_ID = uuid(6000);
export const VERSION_ID = uuid(6100);

export function state(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: STATE_ID,
    classroomId: uuid(500),
    academicPeriodId: uuid(200),
    academicYearId: uuid(100),
    scope: "PERIOD",
    status: "OPEN",
    contractId: "credit-semester@1",
    ruleSetCode: "CI-HIGHER-LMD",
    ruleVersionNo: 1,
    ruleVersionId: VERSION_ID,
    definitionHash: "a".repeat(64),
    pinnedAt: NOW,
    lockedAt: null,
    deliberatedAt: null,
    closedAt: null,
    reopenCount: 0,
    lastReopenKind: null,
    lastReopenReason: null,
    resultsVersion: 1,
    ...over,
  };
}

export function periodView(over: Partial<Record<string, unknown>> = {}, stateOver: Partial<Record<string, unknown>> = {}) {
  return {
    state: state(stateOver),
    ruleLag: { pinned: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, definitionHash: "a".repeat(64) }, active: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, definitionHash: "a".repeat(64) }, behind: false },
    counts: { total: 3, draft: 3, final: 0, error: 0 },
    pendingAssessments: [],
    closures: [],
    deliberations: [],
    recompute: [],
    ...over,
  };
}

export function header(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6200 + n),
    enrollmentId: uuid(2000 + n),
    studentId: uuid(3000 + n),
    academicPeriodId: uuid(200),
    scope: "PERIOD",
    version: 1,
    status: "DRAFT",
    contractId: "credit-semester@1",
    ruleSetCode: "CI-HIGHER-LMD",
    ruleVersionNo: 1,
    definitionHash: "a".repeat(64),
    engineVersion: "1.4.0",
    inputsHash: "b".repeat(64),
    outputsHash: "c".repeat(64),
    average: "13.4999",
    averageDisplay: "13.50",
    rank: n,
    cohortSize: 3,
    mentionCode: "ASSEZ_BIEN",
    decisionCode: "ADMITTED",
    decisionOutcome: "ADMITTED",
    creditsAcquired: "30",
    creditsRequired: "30",
    validated: true,
    summary: {},
    error: null,
    computedAt: NOW,
    finalizedAt: null,
    ...over,
  };
}

export function line(over: Partial<Record<string, unknown>> = {}) {
  return {
    level: "UE",
    curriculumNodeId: uuid(510),
    parentNodeId: null,
    value: "12.25",
    displayValue: "12.25",
    credits: "6",
    coefficient: null,
    validated: true,
    statusCode: "VALIDATED",
    sessionObtained: 1,
    resitEligible: false,
    rank: null,
    cohortSize: null,
    overridden: false,
    outputs: {},
    ...over,
  };
}

export function matrix(rows = [header(1), header(2, { average: "9.9950", averageDisplay: "10.00", rank: 2, decisionCode: "RESIT", decisionOutcome: "RESIT", validated: false }), header(3, { status: "ERROR", average: null, averageDisplay: null, rank: null, cohortSize: null, mentionCode: null, decisionCode: null, decisionOutcome: null, validated: null, error: { message: "Note manquante pour une UE obligatoire." } })], stateOver: Partial<Record<string, unknown>> = {}) {
  return { state: state(stateOver), rows: rows.map((h) => ({ header: h, lines: [] as unknown[] })), decisions: [] };
}

export function decision(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6300),
    stateId: STATE_ID,
    enrollmentId: uuid(2002),
    scope: "PERIOD",
    kind: "PERIOD_DECISION",
    proposedCode: "RESIT",
    proposedOutcome: "RESIT",
    finalCode: null,
    finalOutcome: null,
    status: "PROPOSED",
    deliberationId: null,
    justification: null,
    decidedBy: null,
    decidedAt: null,
    ...over,
  };
}

export function overrideDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6400),
    stateId: STATE_ID,
    enrollmentId: uuid(2002),
    level: "UE",
    curriculumNodeId: uuid(510),
    ruleKey: "moyenne_ue",
    kind: "VALUE",
    originalValue: "9.995",
    overrideValue: "10",
    overrideFlag: null,
    justification: "Erreur matérielle constatée sur la copie après double correction.",
    requestedBy: uuid(901),
    requestedByName: "Mme Traoré",
    requestedAt: NOW,
    status: "REQUESTED",
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decisionComment: null,
    revokedReason: null,
    fourEyesWaived: false,
    ...over,
  };
}

/** Version de règle avec libellés de codes (`label_map`) : code -> locale -> libellé. */
export function ruleVersionDetail() {
  const rule = (key: string, labelMap: Record<string, Record<string, string>>, position: number) => ({
    key,
    type: "mention",
    position,
    expression: "x",
    description: null,
    parameters: {},
    inputSchema: null,
    resultType: "string",
    labelMap,
    isOptional: false,
  });
  return {
    id: VERSION_ID,
    ruleSetId: uuid(6500),
    ruleSetCode: "CI-HIGHER-LMD",
    origin: "national",
    versionNo: 1,
    status: "published",
    contractId: "credit-semester@1",
    basedOnVersionId: null,
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    source: { kind: "regulation" },
    definitionHash: "a".repeat(64),
    lastSimulationId: null,
    createdBy: null,
    approvedBy: null,
    rowVersion: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    rules: [
      rule("mention_releve", { ASSEZ_BIEN: { fr: "Assez bien" }, BIEN: { fr: "Bien" } }, 0),
      rule("decision_semestre", { ADMITTED: { fr: "Admis" }, RESIT: { fr: "Rattrapage" }, ADJOURNED: { fr: "Ajourné" } }, 1),
    ],
    events: [],
  };
}
