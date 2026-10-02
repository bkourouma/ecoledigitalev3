/**
 * Enregistrements du domaine -> DTO des contrats (`packages/contracts/src/v2/rules.ts`). Dates d'effet en
 * « AAAA-MM-JJ », horodatages en ISO UTC ; aucun champ interne (verrou, identifiants de table) n'est exposé hors contrat.
 */
import type {
  RulesBindingDto,
  RulesContractDto,
  RulesRuleDefinitionDto,
  RulesRuleSetDto,
  RulesSimulationDto,
  RulesValidateResponse,
  RulesVersionDetailDto,
  RulesVersionEventDto,
  RulesVersionSummaryDto,
} from "@ecoledigitale/contracts/src/v2/rules";
import type { ContractRule, RuleContract } from "../contracts";
import type { ConformityReport } from "../domain/conformity";
import type { BindingRecord, RuleDefinitionRecord, RuleSetRecord, RuleVersionRecord, SimulationRecord, VersionEventRecord } from "../domain/types";
import { originOf } from "../domain/types";
import type { VersionDetail } from "../application/catalog";
import type { DifferenceRow } from "../infrastructure/simulations-repository";

const iso = (d: Date): string => d.toISOString();

export function toVersionSummaryDto(v: RuleVersionRecord): RulesVersionSummaryDto {
  return {
    id: v.id,
    ruleSetId: v.ruleSetId,
    ruleSetCode: v.ruleSetCode,
    origin: originOf(v.kind),
    versionNo: v.versionNo,
    status: v.status,
    contractId: v.contractId,
    basedOnVersionId: v.basedOnVersionId,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    source: v.source,
    definitionHash: v.definitionHash,
    lastSimulationId: v.lastSimulationId,
    createdBy: v.createdBy,
    approvedBy: v.approvedBy,
    rowVersion: v.kind === "TENANT" ? v.rowVersion : null,
    notes: v.notes,
    createdAt: iso(v.createdAt),
    updatedAt: iso(v.updatedAt),
  };
}

export function toRuleDto(r: RuleDefinitionRecord): RulesRuleDefinitionDto {
  return {
    key: r.key,
    type: r.type,
    position: r.position,
    expression: r.expression,
    description: r.description,
    parameters: { ...r.parameters },
    inputSchema: r.inputSchema as unknown as Record<string, unknown> | null,
    resultType: r.resultType,
    labelMap: r.labelMap as Record<string, Record<string, string>>,
    isOptional: r.isOptional,
  };
}

export function toEventDto(e: VersionEventRecord): RulesVersionEventDto {
  return {
    id: e.id,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorId: e.actorId,
    actorName: e.actorName,
    actorKind: e.actorKind,
    comment: e.comment,
    occurredAt: iso(e.occurredAt),
  };
}

export function toVersionDetailDto(d: VersionDetail): RulesVersionDetailDto {
  return { ...toVersionSummaryDto(d.version), rules: d.rules.map(toRuleDto), events: d.events.map(toEventDto) };
}

export function toRuleSetDto(set: RuleSetRecord, versions: readonly RuleVersionRecord[]): RulesRuleSetDto {
  return {
    id: set.id,
    code: set.code,
    name: set.name,
    countryCode: set.countryCode,
    regulation: set.regulation,
    educationSystem: set.educationSystem,
    level: set.level,
    origin: originOf(set.kind),
    basedOnSetId: set.basedOnSetId,
    versions: versions.map(toVersionSummaryDto),
  };
}

export function toBindingDto(b: BindingRecord): RulesBindingDto {
  return {
    id: b.id,
    contractId: b.contractId,
    ruleSetCode: b.ruleSetCode,
    institutionId: b.institutionId,
    curriculumNodeId: b.curriculumNodeId,
    levelCode: b.levelCode,
    effectiveFrom: b.effectiveFrom,
    effectiveTo: b.effectiveTo,
    createdAt: iso(b.createdAt),
    placeholderAcknowledged: b.placeholderAck != null,
    placeholderAckReason: b.placeholderAck?.reason ?? null,
  };
}

function contractRuleDto(r: ContractRule): RulesContractDto["rules"][number] {
  return {
    key: r.key,
    type: r.type,
    optional: r.optional,
    inputs: r.inputs as unknown as Record<string, unknown>,
    result: r.result,
    outputCodes: [...r.outputCodes],
    parameters: Object.fromEntries(Object.entries(r.parameters).map(([k, p]) => [k, { type: p.type, ...(p.allowed ? { allowed: [...p.allowed] } : {}) }])),
    description: r.description,
  };
}

export function toContractDto(c: RuleContract): RulesContractDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    rules: c.rules.map(contractRuleDto),
    pipeline: c.pipeline.map((p) => ({ stage: p.stage, rules: [...p.rules], description: p.description })),
  };
}

export function toValidateResponse(report: ConformityReport): RulesValidateResponse {
  return {
    ok: report.ok,
    contractId: report.contractId,
    rules: report.rules.map((r) => ({
      key: r.key,
      ok: r.ok,
      diagnostics: r.diagnostics.map((d) => ({
        code: d.code,
        phase: d.phase,
        message: d.message,
        ...(d.hint ? { hint: d.hint } : {}),
        ...(d.position ? { position: d.position } : {}),
      })),
      resultType: r.resultType,
    })),
    violations: report.violations.map((v) => ({ ruleKey: v.ruleKey, code: v.code, message: v.message })),
  };
}

export function toSimulationDto(sim: SimulationRecord, differences: readonly DifferenceRow[]): RulesSimulationDto {
  return {
    id: sim.id,
    targetVersionId: sim.targetVersionId,
    baseVersionId: sim.baseVersionId,
    targetDefinitionHash: sim.targetDefinitionHash,
    contractId: sim.contractId,
    status: sim.status,
    progressPercent: sim.progressPercent,
    casesCount: sim.casesCount,
    summary: (sim.summary as RulesSimulationDto["summary"]) ?? null,
    rules: (sim.ruleStats as RulesSimulationDto["rules"] | null) ?? [],
    decisionChangedPercent: sim.decisionChangedPercent,
    differencesTruncated: sim.differencesTruncated,
    differences: differences.map((d) => ({
      caseRef: d.case_ref,
      ruleKey: d.rule_key,
      kind: d.kind,
      old: d.old_outcome as RulesSimulationDto["differences"][number]["old"],
      new: d.new_outcome as RulesSimulationDto["differences"][number]["new"],
      delta: d.delta,
    })),
    error: sim.error,
    requestedBy: sim.requestedBy,
    startedAt: sim.startedAt ? iso(sim.startedAt) : null,
    completedAt: sim.completedAt ? iso(sim.completedAt) : null,
    createdAt: iso(sim.createdAt),
  };
}
