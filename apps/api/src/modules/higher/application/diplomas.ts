/**
 * Définitions de diplômes et exigences (US4). Une définition est rattachée à un NŒUD DE CYCLE du curriculum (plus aucune
 * reconstitution par expression régulière sur le nom d'une filière) ; `grade_code` est une donnée.
 *
 * Synchronisation depuis le curriculum : NON destructive (le legacy faisait `DELETE` + `INSERT` et écrasait les choix de la
 * direction) — les surcharges `mandatory` sont conservées, les UE ajoutées / retirées sont SIGNALÉES.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { isCurrentlyValid, sumCredits } from "../domain/credits";
import { foldCurriculumUes } from "./annual-ue";
import { computeProgress, resolveRequirementStates, toEligibilityContext, type DiplomaProgress, type RequirementState } from "../domain/diploma";
import { HigherCode, conflict, notFound, validation } from "../domain/errors";
import type { DiplomaAward, DiplomaDefinition, DiplomaRequirement, DiplomaStatus, Uuid } from "../domain/types";
import * as repo from "../infrastructure/diplomas-repository";
import * as ledger from "../infrastructure/ledger-repository";
import { EventBuffer, inTx, todayOf, type HigherDeps } from "./deps";
import type { EligibilityEvaluation, UeInfo } from "./ports";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;
const GRADE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

export interface CreateDiplomaInput {
  readonly code: string;
  readonly label: string;
  readonly gradeCode: string;
  readonly curriculumNodeId: Uuid;
  readonly uvRequired: number;
  readonly autoAward?: boolean | undefined;
  readonly description?: string | null | undefined;
  readonly institutionId?: Uuid | null | undefined;
  /** Exigences initiales (UE du cycle) ; absent = aucune (à remplir ensuite). */
  readonly requirements?: ReadonlyArray<{ ueNodeId: Uuid; mandatory?: boolean | undefined }> | undefined;
}

export interface CreateFromCurriculumInput {
  readonly curriculumNodeId: Uuid;
  readonly gradeCode: string;
  readonly code?: string | undefined;
  readonly label?: string | undefined;
  /** Absent = Σ des crédits des UE du cycle. */
  readonly uvRequired?: number | undefined;
  readonly autoAward?: boolean | undefined;
  readonly description?: string | null | undefined;
  readonly institutionId?: Uuid | null | undefined;
}

export interface DiplomaDetail {
  readonly definition: DiplomaDefinition;
  readonly requirements: readonly DiplomaRequirement[];
  /** Σ des crédits des exigences (total d'UV « en direct » pour l'éditeur). */
  readonly requirementsCredits: number;
  readonly awardCounts: { total: number; obtained: number };
}

export interface SyncReport {
  readonly added: ReadonlyArray<{ ueNodeId: Uuid; code: string; label: string; credits: number }>;
  readonly removed: ReadonlyArray<{ ueNodeId: Uuid; code: string | null; label: string | null }>;
  readonly updated: number;
  readonly unchanged: number;
  /** Σ des crédits des UE du cycle : suggestion d'`uv_required` (jamais appliquée d'office). */
  readonly suggestedUvRequired: number;
}

export function sanitizeCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return s;
}

async function loadCycleUe(deps: HigherDeps, ctx: RequestContext, nodeId: Uuid): Promise<Result<{ node: { code: string; label: string }; ues: readonly UeInfo[] }, AppError>> {
  const node = await deps.ports.curriculum.getNode(ctx, nodeId);
  if (!node) return err(notFound(HigherCode.CURRICULUM_NODE_NOT_FOUND, "Nœud du curriculum", nodeId));
  if (!node.isCycle && !node.isProgram) return err(validation(HigherCode.NOT_A_CYCLE_NODE, "Le diplôme doit être rattaché à un cycle ou à un programme du curriculum.", "curriculumNodeId"));
  const all = node.isCycle ? await deps.ports.curriculum.listCycleUe(ctx, nodeId) : await deps.ports.curriculum.listProgramUe(ctx, nodeId);
  // O-11 : une UE annuelle est UNE exigence (sous son ancre, crédits = somme des parties) ; sans déclaration, liste inchangée.
  const ues = await foldCurriculumUes(deps, ctx, all);
  return ok({ node, ues });
}

function checkCodes(code: string, gradeCode: string): Result<true, AppError> {
  if (!CODE_RE.test(code)) return err(validation(HigherCode.INVALID_INPUT, "Code de diplôme invalide (majuscules, chiffres, - et _).", "code"));
  if (!GRADE_RE.test(gradeCode)) return err(validation(HigherCode.INVALID_INPUT, "Code de grade invalide (majuscules, chiffres, _).", "gradeCode"));
  return ok(true);
}

async function insertWithRequirements(
  deps: HigherDeps,
  ctx: RequestContext,
  input: CreateDiplomaInput,
  reqs: ReadonlyArray<{ ue: UeInfo; mandatory: boolean }>,
  synced: boolean,
): Promise<Result<DiplomaDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    let definition: DiplomaDefinition;
    try {
      definition = await tx.transaction((t) =>
        repo.insertDefinition(t, {
          id: deps.newId(), tenantId: ctx.tenantId, institutionId: input.institutionId ?? null, code: input.code, label: input.label, gradeCode: input.gradeCode,
          curriculumNodeId: input.curriculumNodeId, uvRequired: input.uvRequired, autoAward: input.autoAward ?? true, description: input.description ?? null,
          createdBy: ctx.userId, at: now,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(HigherCode.DIPLOMA_DUPLICATE_CODE, `Le code « ${input.code} » est déjà utilisé.`));
      throw e;
    }
    let position = 0;
    for (const r of reqs) {
      await repo.insertRequirement(tx, ctx.tenantId, definition.id, {
        id: deps.newId(), ueNodeId: r.ue.nodeId, ueCode: r.ue.code, ueLabel: r.ue.label, credits: r.ue.credits, mandatory: r.mandatory, position: position++, removedFromCurriculum: false,
      }, now);
    }
    if (synced) await repo.touchSynced(tx, definition.id, now);
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.diploma.created",
      resourceType: "diploma_definition",
      resourceId: definition.id,
      after: { code: definition.code, label: definition.label, gradeCode: definition.gradeCode, curriculumNodeId: definition.curriculumNodeId, uvRequired: definition.uvRequired, requirements: reqs.length },
    });
    await events.flush(tx);
    const requirements = await repo.listRequirements(tx, definition.id);
    return ok({ definition: (await repo.getDefinition(tx, definition.id)) ?? definition, requirements, requirementsCredits: sumCredits(requirements.map((q) => q.credits)), awardCounts: { total: 0, obtained: 0 } });
  });
}

/** Création libre (parité `create`), rattachée à un nœud de cycle ou de programme. */
export async function createDiploma(deps: HigherDeps, ctx: RequestContext, input: CreateDiplomaInput): Promise<Result<DiplomaDetail, AppError>> {
  const codes = checkCodes(input.code, input.gradeCode);
  if (!codes.ok) return codes;
  if (!(input.uvRequired > 0)) return err(validation(HigherCode.INVALID_INPUT, "Le nombre d'UV requis doit être strictement positif.", "uvRequired"));
  const loaded = await loadCycleUe(deps, ctx, input.curriculumNodeId);
  if (!loaded.ok) return loaded;
  const byNode = new Map(loaded.value.ues.map((u) => [u.nodeId, u]));
  const reqs: Array<{ ue: UeInfo; mandatory: boolean }> = [];
  const seen = new Set<Uuid>();
  for (const r of input.requirements ?? []) {
    const ue = byNode.get(r.ueNodeId);
    if (!ue) return err(validation(HigherCode.REQUIREMENT_CROSS_CYCLE, "Cette UE n'appartient pas au cycle du diplôme.", "requirements", { ueNodeId: r.ueNodeId }));
    if (seen.has(r.ueNodeId)) return err(validation(HigherCode.REQUIREMENT_DUPLICATE, "Une UE ne peut être exigée qu'une fois.", "requirements", { ueNodeId: r.ueNodeId }));
    seen.add(r.ueNodeId);
    reqs.push({ ue, mandatory: r.mandatory ?? true });
  }
  return insertWithRequirements(deps, ctx, input, reqs, false);
}

/** `POST /diplomas/from-curriculum` : crée la définition et ses exigences depuis les UE du cycle (toutes obligatoires). */
export async function createDiplomaFromCurriculum(deps: HigherDeps, ctx: RequestContext, input: CreateFromCurriculumInput): Promise<Result<DiplomaDetail, AppError>> {
  const loaded = await loadCycleUe(deps, ctx, input.curriculumNodeId);
  if (!loaded.ok) return loaded;
  const { node, ues } = loaded.value;
  const total = sumCredits(ues.map((u) => u.credits));
  const uvRequired = input.uvRequired ?? total;
  if (!(uvRequired > 0)) return err(validation(HigherCode.UV_REQUIRED_UNKNOWN, "Le total d'UV du cycle est nul : précisez le nombre d'UV requis.", "uvRequired"));
  const code = input.code ?? sanitizeCode(`DIP-${node.code}`);
  const codes = checkCodes(code, input.gradeCode);
  if (!codes.ok) return codes;
  return insertWithRequirements(
    deps,
    ctx,
    {
      code, label: input.label ?? node.label, gradeCode: input.gradeCode, curriculumNodeId: input.curriculumNodeId, uvRequired, autoAward: input.autoAward,
      description: input.description, institutionId: input.institutionId,
    },
    ues.map((ue) => ({ ue, mandatory: true })),
    true,
  );
}

/** Resynchronise les exigences depuis le curriculum SANS écraser les surcharges ; signale ajouts et retraits. */
export async function syncDiplomaRequirements(deps: HigherDeps, ctx: RequestContext, definitionId: Uuid): Promise<Result<SyncReport, AppError>> {
  const def = await deps.db.run(ctx, (tx) => repo.getDefinition(tx, definitionId), { readOnly: true });
  if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", definitionId));
  const loaded = await loadCycleUe(deps, ctx, def.curriculumNodeId);
  if (!loaded.ok) return loaded;
  const ues = loaded.value.ues;

  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const current = await repo.listRequirements(tx, definitionId);
    const byUe = new Map(current.map((r) => [r.ueNodeId, r]));
    const inCurriculum = new Set(ues.map((u) => u.nodeId));
    const added: Array<SyncReport["added"][number]> = [];
    const removed: Array<SyncReport["removed"][number]> = [];
    let updated = 0;
    let unchanged = 0;
    let position = current.reduce((m, r) => Math.max(m, r.position), -1) + 1;
    for (const ue of ues) {
      const existing = byUe.get(ue.nodeId);
      if (!existing) {
        await repo.insertRequirement(tx, ctx.tenantId, definitionId, { id: deps.newId(), ueNodeId: ue.nodeId, ueCode: ue.code, ueLabel: ue.label, credits: ue.credits, mandatory: true, position: position++, removedFromCurriculum: false }, now);
        added.push({ ueNodeId: ue.nodeId, code: ue.code, label: ue.label, credits: ue.credits });
      } else if (existing.ueCode !== ue.code || existing.ueLabel !== ue.label || existing.credits !== ue.credits || existing.removedFromCurriculum) {
        await repo.updateRequirementFromCurriculum(tx, existing.id, { ueCode: ue.code, ueLabel: ue.label, credits: ue.credits, removedFromCurriculum: false });
        updated += 1;
      } else unchanged += 1;
    }
    for (const r of current) {
      if (!inCurriculum.has(r.ueNodeId)) {
        if (!r.removedFromCurriculum) {
          await repo.updateRequirementFromCurriculum(tx, r.id, { ueCode: r.ueCode, ueLabel: r.ueLabel, credits: r.credits, removedFromCurriculum: true });
          updated += 1;
        }
        removed.push({ ueNodeId: r.ueNodeId, code: r.ueCode, label: r.ueLabel });
      }
    }
    await repo.touchSynced(tx, definitionId, now);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.diploma.synced", resourceType: "diploma_definition", resourceId: definitionId, metadata: { added: added.length, removed: removed.length, updated } });
    await events.flush(tx);
    return ok({ added, removed, updated, unchanged, suggestedUvRequired: sumCredits(ues.map((u) => u.credits)) });
  });
}

/** Remplace les exigences d'un diplôme (éditeur de la direction). */
export async function replaceRequirements(
  deps: HigherDeps,
  ctx: RequestContext,
  input: { definitionId: Uuid; requirements: ReadonlyArray<{ ueNodeId: Uuid; mandatory?: boolean | undefined }> },
): Promise<Result<DiplomaDetail, AppError>> {
  const def = await deps.db.run(ctx, (tx) => repo.getDefinition(tx, input.definitionId), { readOnly: true });
  if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
  const loaded = await loadCycleUe(deps, ctx, def.curriculumNodeId);
  if (!loaded.ok) return loaded;
  const byNode = new Map(loaded.value.ues.map((u) => [u.nodeId, u]));
  const seen = new Set<Uuid>();
  const reqs: Array<{ ue: UeInfo; mandatory: boolean }> = [];
  for (const r of input.requirements) {
    const ue = byNode.get(r.ueNodeId);
    if (!ue) return err(validation(HigherCode.REQUIREMENT_CROSS_CYCLE, "Cette UE n'appartient pas au cycle du diplôme.", "requirements", { ueNodeId: r.ueNodeId }));
    if (seen.has(r.ueNodeId)) return err(validation(HigherCode.REQUIREMENT_DUPLICATE, "Une UE ne peut être exigée qu'une fois.", "requirements", { ueNodeId: r.ueNodeId }));
    seen.add(r.ueNodeId);
    reqs.push({ ue, mandatory: r.mandatory ?? true });
  }
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const before = await repo.listRequirements(tx, def.id);
    await repo.deleteRequirementsOf(tx, def.id);
    let position = 0;
    for (const r of reqs) {
      await repo.insertRequirement(tx, ctx.tenantId, def.id, { id: deps.newId(), ueNodeId: r.ue.nodeId, ueCode: r.ue.code, ueLabel: r.ue.label, credits: r.ue.credits, mandatory: r.mandatory, position: position++, removedFromCurriculum: false }, now);
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.diploma.requirements_replaced",
      resourceType: "diploma_definition",
      resourceId: def.id,
      before: before.map((q) => ({ ueNodeId: q.ueNodeId, mandatory: q.mandatory })),
      after: reqs.map((q) => ({ ueNodeId: q.ue.nodeId, mandatory: q.mandatory })),
    });
    await events.flush(tx);
    const requirements = await repo.listRequirements(tx, def.id);
    return ok({ definition: def, requirements, requirementsCredits: sumCredits(requirements.map((q) => q.credits)), awardCounts: await repo.countAwardsOfDefinition(tx, def.id) });
  });
}

export async function updateDiploma(
  deps: HigherDeps,
  ctx: RequestContext,
  input: { definitionId: Uuid; label?: string | undefined; description?: string | null | undefined; uvRequired?: number | undefined; status?: DiplomaStatus | undefined; autoAward?: boolean | undefined; gradeCode?: string | undefined },
): Promise<Result<DiplomaDefinition, AppError>> {
  if (input.uvRequired !== undefined && !(input.uvRequired > 0)) return err(validation(HigherCode.INVALID_INPUT, "Le nombre d'UV requis doit être strictement positif.", "uvRequired"));
  if (input.gradeCode !== undefined && !GRADE_RE.test(input.gradeCode)) return err(validation(HigherCode.INVALID_INPUT, "Code de grade invalide.", "gradeCode"));
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getDefinition(tx, input.definitionId, true);
    if (!before) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
    const { definitionId: _id, ...patch } = input;
    const after = await repo.updateDefinition(tx, input.definitionId, patch, deps.clock.now());
    if (!after) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.diploma.updated",
      resourceType: "diploma_definition",
      resourceId: after.id,
      before: { label: before.label, uvRequired: before.uvRequired, status: before.status, autoAward: before.autoAward, gradeCode: before.gradeCode },
      after: { label: after.label, uvRequired: after.uvRequired, status: after.status, autoAward: after.autoAward, gradeCode: after.gradeCode },
    });
    await events.flush(tx);
    return ok(after);
  });
}

/** Suppression : refusée s'il existe un octroi (même révoqué) — désactivez la définition (P-HIG-07). */
export async function deleteDiploma(deps: HigherDeps, ctx: RequestContext, definitionId: Uuid): Promise<Result<{ deleted: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const def = await repo.getDefinition(tx, definitionId, true);
    if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", definitionId));
    const counts = await repo.countAwardsOfDefinition(tx, definitionId);
    if (counts.total > 0) return err(conflict(HigherCode.DIPLOMA_HAS_AWARDS, "Ce diplôme a des octrois : désactivez-le plutôt que de le supprimer.", { awards: counts.total }));
    await repo.deleteDefinition(tx, definitionId);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.diploma.deleted", resourceType: "diploma_definition", resourceId: definitionId, before: { code: def.code, label: def.label } });
    await events.flush(tx);
    return ok({ deleted: true as const });
  });
}

export async function getDiploma(deps: HigherDeps, ctx: RequestContext, definitionId: Uuid): Promise<Result<DiplomaDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const definition = await repo.getDefinition(tx, definitionId);
      if (!definition) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", definitionId));
      const requirements = await repo.listRequirements(tx, definitionId);
      return ok({ definition, requirements, requirementsCredits: sumCredits(requirements.map((q) => q.credits)), awardCounts: await repo.countAwardsOfDefinition(tx, definitionId) });
    },
    { readOnly: true },
  );
}

export async function listDiplomas(
  deps: HigherDeps,
  ctx: RequestContext,
  f: { status?: DiplomaStatus | undefined; curriculumNodeId?: Uuid | undefined; gradeCode?: string | undefined; q?: string | undefined } = {},
): Promise<Result<DiplomaDefinition[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listDefinitions(tx, f)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Progression et éligibilité (US4 : calculées à la demande depuis le registre)
// ---------------------------------------------------------------------------

export interface StudentDiplomaStanding {
  readonly definition: DiplomaDefinition;
  readonly states: readonly RequirementState[];
  readonly progress: DiplomaProgress;
  readonly ledgerEntries: ReadonlyArray<{ id: Uuid; ueNodeId: Uuid; credits: number; acquiredAt: Date }>;
}

/** Position d'un étudiant vers un diplôme, depuis le registre (lecture dans la transaction fournie). */
export async function loadStanding(
  deps: HigherDeps,
  tx: Tx,
  def: DiplomaDefinition,
  studentId: Uuid,
): Promise<StudentDiplomaStanding> {
  const requirements = await repo.listRequirements(tx, def.id);
  const entries = (await ledger.listAcquiredForUes(tx, studentId, requirements.map((r) => r.ueNodeId))).filter((e) => isCurrentlyValid(e, todayOf(deps)));
  const states = resolveRequirementStates(requirements, entries);
  const used = new Set(states.filter((s) => s.validated).map((s) => s.ueNodeId));
  return {
    definition: def,
    states,
    progress: computeProgress(states, def.uvRequired),
    ledgerEntries: entries.filter((e) => used.has(e.ueNodeId)).map((e) => ({ id: e.id, ueNodeId: e.ueNodeId, credits: e.credits, acquiredAt: e.acquiredAt })),
  };
}

export interface DiplomaProgressView {
  readonly definition: DiplomaDefinition;
  readonly progress: DiplomaProgress;
  readonly eligibility: EligibilityEvaluation | null;
  readonly award: DiplomaAward | null;
}

/** Progression d'un étudiant vers un diplôme, éligibilité (règle) et octroi éventuel. */
export async function getStudentDiplomaProgress(deps: HigherDeps, ctx: RequestContext, input: { definitionId: Uuid; studentId: Uuid }): Promise<Result<DiplomaProgressView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const def = await repo.getDefinition(tx, input.definitionId);
      if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
      const standing = await loadStanding(deps, tx, def, input.studentId);
      const evalRes = await deps.ports.rules.evaluateEligibility(ctx, {
        exigences: toEligibilityContext(standing.states),
        uvRequises: def.uvRequired,
        scope: { ...(def.institutionId ? { institutionId: def.institutionId } : {}), curriculumNodeId: def.curriculumNodeId, onDate: todayOf(deps) },
      });
      const award = (await repo.findActiveAward(tx, def.id, input.studentId)) ?? (await repo.findLastRevokedAward(tx, def.id, input.studentId));
      return ok({ definition: def, progress: standing.progress, eligibility: evalRes.ok ? evalRes.value : null, award });
    },
  );
}

export interface DiplomaCandidate {
  readonly studentId: Uuid;
  readonly fullName: string | null;
  readonly matricule: string | null;
  readonly classroomId: Uuid;
  readonly academicYearId: Uuid;
  readonly uvValidated: number;
  readonly percent: number;
  readonly missingMandatory: number;
  readonly eligible: boolean | null;
  readonly awardStatus: DiplomaAward["status"] | null;
  readonly awardReference: string | null;
  readonly acquiredDate: string | null;
  readonly revokeReason: string | null;
}

/** `GET /diplomas/:id/candidates` : étudiants du cycle avec progression, éligibilité et octroi. */
export async function listDiplomaCandidates(deps: HigherDeps, ctx: RequestContext, definitionId: Uuid): Promise<Result<DiplomaCandidate[], AppError>> {
  const def = await deps.db.run(ctx, (tx) => repo.getDefinition(tx, definitionId), { readOnly: true });
  if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", definitionId));
  const enrollments = await deps.ports.enrollments.listCycleEnrollments(ctx, def.curriculumNodeId);
  // Une ligne par étudiant : sa dernière inscription du cycle (année la plus récente par ordre d'identifiant d'année).
  const latest = new Map<Uuid, (typeof enrollments)[number]>();
  for (const e of enrollments) {
    const cur = latest.get(e.studentId);
    if (!cur || e.academicYearId > cur.academicYearId) latest.set(e.studentId, e);
  }
  const identities = new Map<Uuid, Awaited<ReturnType<typeof deps.ports.students.getIdentity>>>();
  for (const id of latest.keys()) identities.set(id, await deps.ports.students.getIdentity(ctx, id));

  return inTx(
    deps,
    ctx,
    async (tx) => {
      const out: DiplomaCandidate[] = [];
      for (const e of latest.values()) {
        const standing = await loadStanding(deps, tx, def, e.studentId);
        const evalRes = await deps.ports.rules.evaluateEligibility(ctx, {
          exigences: toEligibilityContext(standing.states),
          uvRequises: def.uvRequired,
          scope: { ...(def.institutionId ? { institutionId: def.institutionId } : {}), curriculumNodeId: def.curriculumNodeId, onDate: todayOf(deps) },
        });
        const award = (await repo.findActiveAward(tx, def.id, e.studentId)) ?? (await repo.findLastRevokedAward(tx, def.id, e.studentId));
        const idn = identities.get(e.studentId);
        out.push({
          studentId: e.studentId, fullName: idn?.fullName ?? null, matricule: idn?.matricule ?? null, classroomId: e.classroomId, academicYearId: e.academicYearId,
          uvValidated: standing.progress.uvValidated, percent: standing.progress.percent, missingMandatory: standing.progress.missingMandatory.length,
          eligible: evalRes.ok ? evalRes.value.eligible : null, awardStatus: award?.status ?? null, awardReference: award?.reference ?? null,
          acquiredDate: award?.acquiredDate ?? null, revokeReason: award?.revokeReason ?? null,
        });
      }
      return ok(out.sort((a, b) => (a.fullName ?? a.studentId).localeCompare(b.fullName ?? b.studentId)));
    },
  );
}
