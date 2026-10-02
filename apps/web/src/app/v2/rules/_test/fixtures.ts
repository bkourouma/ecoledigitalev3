/** Jeux de données de test conformes aux contrats `packages/contracts/src/v2/rules.ts` (réponses validées par Zod). */
import { uuid } from "../../_test/fixtures";

export { uuid };
const NOW = "2026-10-01T08:00:00.000Z";

export function versionSummary(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6100),
    ruleSetId: uuid(6500),
    ruleSetCode: "CI-HIGHER-LMD",
    origin: "national",
    versionNo: 1,
    status: "published",
    contractId: "credit-semester@1",
    basedOnVersionId: null,
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    source: { kind: "regulation", reference: "Arrêté LMD" },
    definitionHash: "a".repeat(64),
    lastSimulationId: null,
    createdBy: null,
    approvedBy: null,
    rowVersion: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function ruleSet(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6500),
    code: "CI-HIGHER-LMD",
    name: "LMD Côte d'Ivoire",
    countryCode: "CI",
    regulation: "Décret LMD",
    educationSystem: "HIGHER",
    level: "Licence",
    origin: "national",
    basedOnSetId: null,
    versions: [versionSummary()],
    ...over,
  };
}

export function ruleDef(over: Partial<Record<string, unknown>> = {}) {
  return {
    key: "moyenne_ue",
    type: "period_average",
    position: 0,
    expression: "sum(notes) / count(notes)",
    description: "Moyenne d'une unité d'enseignement.",
    parameters: { seuil_validation: { type: "number", default: 10, min: 0, max: 20, description: "Seuil de validation d'une UE." } },
    inputSchema: null,
    resultType: "number?",
    labelMap: {},
    isOptional: false,
    ...over,
  };
}

export function versionDetail(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...versionSummary(),
    rules: [ruleDef()],
    events: [],
    ...over,
  };
}

export function tenantDraft(over: Partial<Record<string, unknown>> = {}) {
  return versionDetail({ id: uuid(6101), origin: "tenant", status: "draft", versionNo: 1, basedOnVersionId: uuid(6100), rowVersion: 2, definitionHash: null, ...over });
}

export function simulationDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(6800),
    targetVersionId: uuid(6101),
    baseVersionId: uuid(6100),
    targetDefinitionHash: "c".repeat(64),
    contractId: "credit-semester@1",
    status: "COMPLETED",
    progressPercent: 100,
    casesCount: 3,
    summary: { cases: 3, rules: 1, evaluations: 3, changed: 1, unchanged: 2, newErrors: 0, resolvedErrors: 0, changedErrors: 0, changedPercent: "33.3" },
    rules: [{ key: "moyenne_ue", presence: "both", compileErrors: {}, evaluated: 3, changed: 1, unchanged: 2, newErrors: 0, resolvedErrors: 0, changedErrors: 0, maxAbsDelta: "0.5", meanDelta: "0.17", transitions: [{ from: "RESIT", to: "VALIDATED", count: 1 }] }],
    decisionChangedPercent: "12.5",
    differencesTruncated: false,
    differences: [{ caseRef: "case-1", ruleKey: "moyenne_ue", kind: "value_changed", old: { status: "ok", type: "number", value: "9.5" }, new: { status: "ok", type: "number", value: "10" }, delta: "0.5" }],
    error: null,
    requestedBy: uuid(901),
    startedAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
    ...over,
  };
}
