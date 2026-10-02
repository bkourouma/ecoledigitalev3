/**
 * Workflows : éditer un BROUILLON (étapes, transitions), le publier (validation à la publication, puis figé), créer la version
 * suivante. Un workflow publié ne se modifie jamais ; les dossiers restent épinglés à la version qui les a créés. Le déclencheur
 * SQL `workflows_guard` reste l'autorité ; le miroir `validateWorkflow` (domaine) liste TOUS les défauts pour l'éditeur.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AdmissionsCreateWorkflowBody,
  AdmissionsReplaceStagesBody,
  AdmissionsReplaceTransitionsBody,
  AdmissionsWorkflowDto,
  AdmissionsWorkflowSummaryDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import { DEFAULT_STAGES, DEFAULT_TRANSITIONS, type TemplateStage, type TemplateTransition } from "../domain/default-workflow";
import { checkWorkflowInput, validateWorkflow, type StageFacts, type WorkflowDefect } from "../domain/workflow";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { resolveInstitution } from "./support";
import type { Tx } from "@ecoledigitale/database";

const toStageInsert = (deps: AdmissionsDeps, s: TemplateStage): wf.StageInsert => ({
  id: deps.newId(),
  code: s.code,
  label: s.label,
  canonicalStatus: s.canonicalStatus,
  ordinal: s.ordinal,
  isInitial: s.isInitial ?? false,
  isTerminal: s.isTerminal ?? false,
  holdsSeat: s.holdsSeat ?? false,
  requiresConsent: s.requiresConsent ?? false,
  requiresDocumentsComplete: s.requiresDocumentsComplete ?? false,
  requiresInterviewDone: s.requiresInterviewDone ?? false,
  requiresDecision: s.requiresDecision ?? false,
  createsEnrollment: s.createsEnrollment ?? false,
  closureKind: s.closureKind ?? null,
  slaHours: s.slaHours ?? null,
  notifyTemplateCode: s.notifyTemplateCode ?? null,
});

/** Écrit étapes puis transitions (résolues par code) d'un brouillon. */
export async function writeStructure(deps: AdmissionsDeps, tx: Tx, tenantId: string, workflowId: string, stages: readonly TemplateStage[], transitions: readonly TemplateTransition[]): Promise<void> {
  const ids = new Map<string, string>();
  for (const s of stages) {
    const insert = toStageInsert(deps, s);
    ids.set(s.code, insert.id);
    await wf.insertStage(tx, tenantId, workflowId, insert);
  }
  for (const t of transitions) {
    const from = ids.get(t.fromStage);
    const to = ids.get(t.toStage);
    if (!from || !to) continue;
    await wf.insertTransition(tx, { id: deps.newId(), tenantId, workflowId, fromStageId: from, toStageId: to, permissionKey: t.permissionKey, requiresReason: t.requiresReason ?? false, isAutomatic: t.isAutomatic ?? false });
  }
}

const factsOf = (stages: AdmissionsWorkflowDto["stages"]): StageFacts[] =>
  stages.map((s) => ({ code: s.code, canonicalStatus: s.canonicalStatus, isInitial: s.isInitial, isTerminal: s.isTerminal, holdsSeat: s.holdsSeat, requiresDecision: s.requiresDecision, createsEnrollment: s.createsEnrollment, closureKind: s.closureKind }));

/** Défauts d'un workflow dans son état courant (liste vide = publiable). */
export function defectsOf(workflow: Pick<AdmissionsWorkflowDto, "stages" | "transitions">): WorkflowDefect[] {
  const codeOf = new Map(workflow.stages.map((s) => [s.id, s.code]));
  return validateWorkflow(
    factsOf(workflow.stages),
    workflow.transitions.map((t) => ({ fromStage: codeOf.get(t.fromStageId) ?? "?", toStage: codeOf.get(t.toStageId) ?? "?" })),
  );
}

/** Crée le workflow modèle PUBLIÉ de l'établissement s'il n'existe aucun workflow publié (idempotent). Renvoie son identifiant. */
export async function ensureDefaultWorkflow(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, institutionId: string, code: string, label: string): Promise<string> {
  const existing = await wf.getPublishedWorkflowId(tx, institutionId, null);
  if (existing) return existing;
  const id = deps.newId();
  const version = (await wf.maxVersion(tx, institutionId, code)) + 1;
  await wf.insertWorkflow(tx, { id, tenantId: ctx.tenantId, institutionId, code, version, label, educationLevelCode: null });
  await writeStructure(deps, tx, ctx.tenantId, id, DEFAULT_STAGES, DEFAULT_TRANSITIONS);
  await wf.publishWorkflowRow(tx, id, ctx.userId);
  return id;
}

export async function listWorkflows(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsWorkflowSummaryDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await wf.listWorkflows(tx, inst.value)), { readOnly: true });
}

export interface WorkflowView extends AdmissionsWorkflowDto {
  readonly defects: WorkflowDefect[];
}

export async function getWorkflowDetail(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string): Promise<Result<WorkflowView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const w = await wf.getWorkflow(tx, workflowId);
      if (!w) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", workflowId));
      return ok({ ...w, defects: w.status === "DRAFT" ? defectsOf(w) : [] });
    },
    { readOnly: true },
  );
}

export async function createWorkflow(deps: AdmissionsDeps, ctx: RequestContext, body: AdmissionsCreateWorkflowBody): Promise<Result<WorkflowView, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    const version = (await wf.maxVersion(tx, inst.value, body.code)) + 1;
    await wf.insertWorkflow(tx, { id, tenantId: ctx.tenantId, institutionId: inst.value, code: body.code, version, label: body.label, educationLevelCode: body.educationLevelCode ?? null });
    if (body.from === "TEMPLATE") {
      await writeStructure(deps, tx, ctx.tenantId, id, DEFAULT_STAGES, DEFAULT_TRANSITIONS);
    } else if (body.from === "COPY") {
      const source = await wf.getWorkflow(tx, body.fromWorkflowId as string);
      if (!source || source.institutionId !== inst.value) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", body.fromWorkflowId));
      await copyStructure(deps, tx, ctx.tenantId, source, id);
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.create", resourceType: "workflow", resourceId: id, metadata: { code: body.code, version, from: body.from } });
    await buffer.flush(tx);
    const w = (await wf.getWorkflow(tx, id)) as AdmissionsWorkflowDto;
    return ok({ ...w, defects: defectsOf(w) });
  });
}

async function copyStructure(deps: AdmissionsDeps, tx: Tx, tenantId: string, source: AdmissionsWorkflowDto, targetId: string): Promise<void> {
  const codeOf = new Map(source.stages.map((s) => [s.id, s.code]));
  await writeStructure(
    deps,
    tx,
    tenantId,
    targetId,
    source.stages.map((s) => ({ ...s, closureKind: s.closureKind ?? undefined, slaHours: s.slaHours ?? undefined, notifyTemplateCode: s.notifyTemplateCode ?? undefined })),
    source.transitions.map((t) => ({ fromStage: codeOf.get(t.fromStageId) as string, toStage: codeOf.get(t.toStageId) as string, permissionKey: t.permissionKey, requiresReason: t.requiresReason, isAutomatic: t.isAutomatic })),
  );
}

async function draftOrError(tx: Tx, workflowId: string): Promise<Result<NonNullable<Awaited<ReturnType<typeof wf.getWorkflowHeader>>>, AppError>> {
  const header = await wf.getWorkflowHeader(tx, workflowId, { forUpdate: true });
  if (!header) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", workflowId));
  if (header.status !== "DRAFT") return err(conflict(AdmissionsCode.WORKFLOW_NOT_DRAFT, "Un workflow publié est figé : créez la version suivante pour le modifier."));
  return ok(header);
}

export async function updateWorkflow(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string, patch: { label?: string | undefined; educationLevelCode?: string | null | undefined }): Promise<Result<WorkflowView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const header = await draftOrError(tx, workflowId);
    if (!header.ok) return header;
    await wf.updateWorkflowHeader(tx, workflowId, patch);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.update", resourceType: "workflow", resourceId: workflowId });
    await buffer.flush(tx);
    const w = (await wf.getWorkflow(tx, workflowId)) as AdmissionsWorkflowDto;
    return ok({ ...w, defects: defectsOf(w) });
  });
}

export async function replaceStages(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string, body: AdmissionsReplaceStagesBody): Promise<Result<WorkflowView, AppError>> {
  const problems = checkWorkflowInput(body.stages, []);
  if (problems.length > 0) return err(validation(AdmissionsCode.INVALID_INPUT, problems.join(" "), "stages"));
  return inTx(deps, ctx, async (tx) => {
    const header = await draftOrError(tx, workflowId);
    if (!header.ok) return header;
    const kept = await wf.listTransitionsByCode(tx, workflowId);
    await wf.clearTransitions(tx, workflowId);
    await wf.clearStages(tx, workflowId);
    const codes = new Set(body.stages.map((s) => s.code));
    await writeStructure(
      deps,
      tx,
      ctx.tenantId,
      workflowId,
      body.stages.map((s) => ({ ...s, closureKind: s.closureKind ?? undefined, slaHours: s.slaHours ?? undefined, notifyTemplateCode: s.notifyTemplateCode ?? undefined })),
      kept.filter((t) => codes.has(t.fromStage) && codes.has(t.toStage)),
    );
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.stages_replace", resourceType: "workflow", resourceId: workflowId, metadata: { stages: body.stages.length, transitionsKept: kept.filter((t) => codes.has(t.fromStage) && codes.has(t.toStage)).length, transitionsDropped: kept.length - kept.filter((t) => codes.has(t.fromStage) && codes.has(t.toStage)).length } });
    await buffer.flush(tx);
    const w = (await wf.getWorkflow(tx, workflowId)) as AdmissionsWorkflowDto;
    return ok({ ...w, defects: defectsOf(w) });
  });
}

export async function replaceTransitions(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string, body: AdmissionsReplaceTransitionsBody): Promise<Result<WorkflowView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const header = await draftOrError(tx, workflowId);
    if (!header.ok) return header;
    const stages = await wf.listStages(tx, workflowId);
    const problems = checkWorkflowInput(stages, body.transitions);
    if (problems.length > 0) return err(validation(AdmissionsCode.INVALID_INPUT, problems.join(" "), "transitions"));
    const byCode = new Map(stages.map((s) => [s.code, s.id]));
    await wf.clearTransitions(tx, workflowId);
    for (const t of body.transitions) {
      await wf.insertTransition(tx, { id: deps.newId(), tenantId: ctx.tenantId, workflowId, fromStageId: byCode.get(t.fromStage) as string, toStageId: byCode.get(t.toStage) as string, permissionKey: t.permissionKey, requiresReason: t.requiresReason, isAutomatic: t.isAutomatic });
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.transitions_replace", resourceType: "workflow", resourceId: workflowId, metadata: { transitions: body.transitions.length } });
    await buffer.flush(tx);
    const w = (await wf.getWorkflow(tx, workflowId)) as AdmissionsWorkflowDto;
    return ok({ ...w, defects: defectsOf(w) });
  });
}

/**
 * Publication : validation (liste des défauts), archivage du workflow publié du même cycle, publication. Deux publications
 * concurrentes visant le même (établissement, cycle) : l'une est refusée (`admissions.workflow_conflict`).
 */
export async function publishWorkflow(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string): Promise<Result<WorkflowView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const header = await draftOrError(tx, workflowId);
    if (!header.ok) return header;
    const w = (await wf.getWorkflow(tx, workflowId)) as AdmissionsWorkflowDto;
    const defects = defectsOf(w);
    if (defects.length > 0) {
      return err(validation(AdmissionsCode.WORKFLOW_PUBLISH_FAILED, `Le workflow ne peut pas être publié : ${defects.map((d) => d.message).join(" ")}`, "workflow", { defects }));
    }
    // Publications du même cycle SÉRIALISÉES ; une version plus ancienne ne remplace jamais une version plus récente déjà publiée.
    await wf.lockPublicationScope(tx, w.institutionId, w.educationLevelCode);
    const live = await wf.getPublishedHeader(tx, w.institutionId, w.educationLevelCode);
    if (live && live.code === w.code && live.version > w.version) {
      return err(conflict(AdmissionsCode.WORKFLOW_CONFLICT, `Une version plus récente de ce parcours (v${live.version}) est déjà publiée : créez une nouvelle version à partir d'elle.`, { liveVersion: live.version }));
    }
    const archived = await wf.archivePublishedOf(tx, w.institutionId, w.educationLevelCode, workflowId);
    await wf.publishWorkflowRow(tx, workflowId, ctx.userId);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.publish", resourceType: "workflow", resourceId: workflowId, sensitive: true, metadata: { code: w.code, version: w.version, archived } });
    await buffer.flush(tx);
    const published = (await wf.getWorkflow(tx, workflowId)) as AdmissionsWorkflowDto;
    return ok({ ...published, defects: [] });
  });
}

/** Version suivante : copie des étapes et transitions dans un nouveau brouillon (version + 1). Les dossiers en cours ne bougent pas. */
export async function newWorkflowVersion(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string): Promise<Result<WorkflowView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const source = await wf.getWorkflow(tx, workflowId);
    if (!source) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", workflowId));
    const id = deps.newId();
    const version = (await wf.maxVersion(tx, source.institutionId, source.code)) + 1;
    await wf.insertWorkflow(tx, { id, tenantId: ctx.tenantId, institutionId: source.institutionId, code: source.code, version, label: source.label, educationLevelCode: source.educationLevelCode });
    await copyStructure(deps, tx, ctx.tenantId, source, id);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.new_version", resourceType: "workflow", resourceId: id, metadata: { code: source.code, version, from: workflowId } });
    await buffer.flush(tx);
    const w = (await wf.getWorkflow(tx, id)) as AdmissionsWorkflowDto;
    return ok({ ...w, defects: defectsOf(w) });
  });
}

export async function deleteDraftWorkflow(deps: AdmissionsDeps, ctx: RequestContext, workflowId: string): Promise<Result<{ deleted: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const header = await draftOrError(tx, workflowId);
    if (!header.ok) return header;
    if ((await wf.countCampaignsUsingWorkflow(tx, workflowId)) > 0) return err(conflict(AdmissionsCode.WORKFLOW_CONFLICT, "Une campagne utilise ce brouillon."));
    await wf.deleteWorkflow(tx, workflowId);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.workflow.delete", resourceType: "workflow", resourceId: workflowId });
    await buffer.flush(tx);
    return ok({ deleted: true as const });
  });
}
