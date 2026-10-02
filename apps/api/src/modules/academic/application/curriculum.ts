/**
 * Curriculum polymorphe versionné par (programme, année) : création, clonage annuel (lignées conservées), édition
 * de l'arbre en brouillon, prérequis, rapport de validation, publication, amendements motivés, verrouillage.
 *
 * Le comportement ne lit que la GRAMMAIRE en données (`curriculum_node_types`) : le primaire (`LEVEL > SUBJECT`)
 * et le supérieur (`LEVEL > PERIOD > UE > ECUE`) passent par le même code et les mêmes tables.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AcademicAmendBody,
  AcademicCreateNodeBody,
  AcademicCurriculumTreeDto,
  AcademicUpdateNodeBody,
} from "@ecoledigitale/contracts/src/v2/academic";
import {
  buildTree,
  checkNodeGrammar,
  descendantsOf,
  planClone,
  validateCurriculum as validateCurriculumRules,
  type NodeTypeRules,
  type TreeNode,
  type ValidationReportRecord,
} from "../domain/curriculum";
import { fitsNumeric, toDecimalString } from "../domain/decimal";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import type { CurriculumAmendment, CurriculumNode, CurriculumVersion, NodeType, Program } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, actorId, inReadTx, inScope, inTx, type AcademicDeps } from "./deps";

type Ctx = RequestContext;

// ---------------------------------------------------------------------------
// Chargement dans le périmètre
// ---------------------------------------------------------------------------

export async function loadVersionInScope(
  tx: Tx,
  ctx: Ctx,
  id: string,
  forUpdate = false,
): Promise<Result<{ version: CurriculumVersion; program: Program }, AppError>> {
  const version = await cur.getVersion(tx, id, { forUpdate });
  if (!version) return err(notFound(AcademicCode.CURRICULUM_NOT_FOUND, "Curriculum", id));
  const program = await cur.getProgram(tx, version.programId);
  if (!program || !inScope(ctx, program)) return err(notFound(AcademicCode.CURRICULUM_NOT_FOUND, "Curriculum", id));
  return ok({ version, program });
}

function assertDraft(version: CurriculumVersion): Result<void, AppError> {
  if (version.status === "DRAFT") return ok(undefined);
  if (version.status === "PUBLISHED") {
    return err(conflict(AcademicCode.CURRICULUM_PUBLISHED, "La structure d'un curriculum publié ne change que par amendement motivé.", { status: version.status }));
  }
  return err(conflict(AcademicCode.CURRICULUM_LOCKED, `Le curriculum est ${version.status} : aucune modification.`, { status: version.status }));
}

const toRules = (t: NodeType): NodeTypeRules => t;

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function listCurriculumVersions(
  deps: AcademicDeps,
  ctx: RequestContext,
  filter: { programId?: string | null; yearId?: string | null; status?: string | null } = {},
): Promise<Result<CurriculumVersion[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await cur.listVersions(tx, { ...filter, institutionId: ctx.institutionId ?? null })));
}

export async function getCurriculumVersion(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<CurriculumVersion, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, id);
    return l.ok ? ok(l.value.version) : l;
  });
}

export async function listCurriculumNodes(deps: AcademicDeps, ctx: RequestContext, versionId: string): Promise<Result<CurriculumNode[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId);
    if (!l.ok) return l;
    return ok(await cur.listNodes(tx, versionId));
  });
}

export async function getCurriculumNode(deps: AcademicDeps, ctx: RequestContext, nodeId: string): Promise<Result<CurriculumNode, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const node = await cur.getNode(tx, nodeId);
    if (!node) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
    const l = await loadVersionInScope(tx, ctx, node.versionId);
    if (!l.ok) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
    return ok(node);
  });
}

type TreeEntry = TreeNode<CurriculumNode>;

function toTreeDto(entries: ReadonlyArray<TreeEntry>): AcademicCurriculumTreeDto["roots"] {
  return entries.map((e) => ({ ...e.node, children: toTreeDto(e.children) }));
}

/** Arbre d'une version, désignée par `versionId`, `classroomId` (version de la classe) ou `enrollmentId`. */
export async function getCurriculumTree(
  deps: AcademicDeps,
  ctx: RequestContext,
  ref_: { versionId?: string; classroomId?: string; enrollmentId?: string },
): Promise<Result<AcademicCurriculumTreeDto, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    let versionId = ref_.versionId ?? null;
    if (!versionId && ref_.classroomId) {
      const c = await classroomsRepo.getClassroom(tx, ref_.classroomId);
      if (!c || !inScope(ctx, c)) return err(notFound(AcademicCode.CLASSROOM_NOT_FOUND, "Classe", ref_.classroomId));
      versionId = c.curriculumVersionId;
    }
    if (!versionId && ref_.enrollmentId) {
      const e = await enr.getEnrollment(tx, ref_.enrollmentId);
      if (!e || !inScope(ctx, e)) return err(notFound(AcademicCode.ENROLLMENT_NOT_FOUND, "Inscription", ref_.enrollmentId));
      versionId = (await classroomsRepo.getClassroom(tx, e.classroomId))?.curriculumVersionId ?? null;
    }
    if (!versionId) return err(notFound(AcademicCode.CURRICULUM_NOT_FOUND, "Curriculum"));
    const l = await loadVersionInScope(tx, ctx, versionId);
    if (!l.ok) return l;
    const nodes = await cur.listNodes(tx, versionId);
    return ok({ version: l.value.version, roots: toTreeDto(buildTree(nodes)) });
  });
}

// ---------------------------------------------------------------------------
// Création et clonage
// ---------------------------------------------------------------------------

export async function createCurriculumVersion(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { programId: string; academicYearId: string; cloneFromVersionId?: string | undefined; note?: string | undefined },
): Promise<Result<CurriculumVersion, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const program = await cur.getProgram(tx, input.programId);
    if (!program || !inScope(ctx, program)) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", input.programId));
    const year = await cal.getYear(tx, input.academicYearId);
    if (!year || !inScope(ctx, year)) return err(notFound(AcademicCode.YEAR_NOT_FOUND, "Année académique", input.academicYearId));
    if (year.institutionId !== program.institutionId) return err(validation(AcademicCode.CLASSROOM_YEAR_INSTITUTION, "L'année et le programme sont d'établissements différents.", "academicYearId"));
    if (year.status === "CLOSED" || year.status === "ARCHIVED") return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "L'année est close."));

    let source: { version: CurriculumVersion; nodes: CurriculumNode[] } | null = null;
    if (input.cloneFromVersionId) {
      const l = await loadVersionInScope(tx, ctx, input.cloneFromVersionId);
      if (!l.ok) return l;
      if (l.value.version.programId !== input.programId) return err(validation(AcademicCode.CLASSROOM_CURRICULUM_MISMATCH, "On ne clone que dans le même programme.", "cloneFromVersionId"));
      if (l.value.version.academicYearId === input.academicYearId) return err(validation(AcademicCode.CURRICULUM_EXISTS, "La version source est déjà celle de cette année.", "academicYearId"));
      source = { version: l.value.version, nodes: await cur.listNodes(tx, input.cloneFromVersionId) };
    }

    const id = deps.newId();
    await cur.insertVersion(tx, { id, programId: input.programId, academicYearId: input.academicYearId, clonedFromVersionId: source?.version.id ?? null, note: input.note ?? null });
    if (source && source.nodes.length > 0) await copyNodes(deps, tx, source.nodes, id);
    return ok((await cur.getVersion(tx, id)) as CurriculumVersion);
  });
}

/** Clone une version vers l'année cible (même programme) : `DRAFT`, mêmes `lineage_id`, nouveaux `id`. */
export async function cloneCurriculumVersion(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { sourceVersionId: string; targetAcademicYearId: string; note?: string | undefined },
): Promise<Result<CurriculumVersion, AppError>> {
  const source = await getCurriculumVersion(deps, ctx, input.sourceVersionId);
  if (!source.ok) return source;
  return createCurriculumVersion(deps, ctx, {
    programId: source.value.programId,
    academicYearId: input.targetAcademicYearId,
    cloneFromVersionId: input.sourceVersionId,
    ...(input.note ? { note: input.note } : {}),
  });
}

/** Insère les copies par niveau de profondeur (les parents d'abord) puis recrée les prérequis. */
async function copyNodes(deps: AcademicDeps, tx: Tx, sourceNodes: readonly CurriculumNode[], targetVersionId: string): Promise<void> {
  const plan = planClone(sourceNodes, targetVersionId, deps.newId);
  const depthOf = new Map<string, number>();
  for (const n of plan.nodes) depthOf.set(n.id, n.parentId ? (depthOf.get(n.parentId) ?? 0) + 1 : 0);
  const byDepth = new Map<number, typeof plan.nodes>();
  for (const n of plan.nodes) byDepth.set(depthOf.get(n.id) as number, [...(byDepth.get(depthOf.get(n.id) as number) ?? []), n]);
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    await cur.insertNodesBatch(
      tx,
      (byDepth.get(depth) as typeof plan.nodes).map((n) => ({
        id: n.id,
        versionId: targetVersionId,
        parentId: n.parentId,
        nodeTypeCode: n.nodeTypeCode,
        lineageId: n.lineageId,
        subjectId: n.subjectId,
        gradeLevelId: n.gradeLevelId,
        periodTypeCode: n.periodTypeCode,
        periodOrdinal: n.periodOrdinal,
        code: n.code,
        label: n.label,
        ordinal: n.ordinal,
        coefficient: n.coefficient,
        credits: n.credits,
        isMandatory: n.isMandatory,
        isTransversal: n.isTransversal,
        categoryCode: n.categoryCode,
        gradingMode: n.gradingMode,
        resitAllowed: n.resitAllowed,
        countsInAverage: n.countsInAverage,
        sectionKey: n.sectionKey,
        hoursTotal: n.hoursTotal,
        hoursLecture: n.hoursLecture,
        hoursTutorial: n.hoursTutorial,
        hoursPractical: n.hoursPractical,
        attributes: n.attributes,
        status: n.status,
      })),
    );
  }
  if (plan.prerequisites.length > 0) {
    await cur.insertPrerequisitesBatch(tx, targetVersionId, plan.prerequisites.map((p) => ({ id: deps.newId(), nodeId: p.nodeId, requiredLineageId: p.requiredLineageId })));
  }
}

// ---------------------------------------------------------------------------
// Édition de l'arbre (version DRAFT)
// ---------------------------------------------------------------------------

interface DecimalFields {
  coefficient: string | null;
  credits: string | null;
  hoursTotal: string | null;
  hoursLecture: string | null;
  hoursTutorial: string | null;
  hoursPractical: string | null;
}

function decimalOrError(value: number | string | null | undefined, field: string, precision: number, scale: number, positive = false): Result<string | null, AppError> {
  if (value === null || value === undefined) return ok(null);
  const d = toDecimalString(value);
  if (d === null) return err(validation(AcademicCode.INVALID_INPUT, `${field} : décimal invalide.`, field));
  if (!fitsNumeric(d, precision, scale)) return err(validation(AcademicCode.INVALID_INPUT, `${field} : valeur hors limites (${precision - scale} chiffres entiers, ${scale} décimales au plus).`, field));
  if (positive && Number(d) <= 0) return err(validation(AcademicCode.INVALID_INPUT, `${field} doit être strictement positif.`, field));
  return ok(d);
}

function parseDecimals(body: Partial<Record<keyof DecimalFields, number | string | null | undefined>>): Result<Partial<DecimalFields>, AppError> {
  const out: Partial<DecimalFields> = {};
  const specs: Array<[keyof DecimalFields, number, number, boolean]> = [
    ["coefficient", 7, 3, true],
    ["credits", 6, 2, false],
    ["hoursTotal", 7, 2, false],
    ["hoursLecture", 7, 2, false],
    ["hoursTutorial", 7, 2, false],
    ["hoursPractical", 7, 2, false],
  ];
  for (const [field, precision, scale, positive] of specs) {
    if (body[field] === undefined) continue;
    const r = decimalOrError(body[field], field, precision, scale, positive);
    if (!r.ok) return r;
    out[field] = r.value;
  }
  return ok(out);
}

export async function addCurriculumNode(deps: AcademicDeps, ctx: RequestContext, versionId: string, body: AcademicCreateNodeBody): Promise<Result<CurriculumNode, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId, true);
    if (!l.ok) return l;
    const draft = assertDraft(l.value.version);
    if (!draft.ok) return draft;
    const built = await buildNode(deps, tx, l.value, body);
    if (!built.ok) return built;
    await cur.insertNode(tx, built.value);
    return ok((await cur.getNode(tx, built.value.id)) as CurriculumNode);
  });
}

async function buildNode(
  deps: AcademicDeps,
  tx: Tx,
  ctxVersion: { version: CurriculumVersion; program: Program },
  body: AcademicCreateNodeBody,
): Promise<Result<cur.NodeInsert, AppError>> {
  const types = await ref.listNodeTypes(tx);
  const type = types.find((t) => t.code === body.nodeTypeCode);
  if (!type) return err(validation(AcademicCode.NODE_TYPE_UNKNOWN, `Type de nœud inconnu : ${body.nodeTypeCode}.`, "nodeTypeCode"));
  const decimals = parseDecimals(body);
  if (!decimals.ok) return decimals;
  let parentType: string | null = null;
  if (body.parentId) {
    const parent = await cur.getNode(tx, body.parentId);
    if (!parent || parent.versionId !== ctxVersion.version.id) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud parent", body.parentId));
    parentType = parent.nodeTypeCode;
  }
  const draft = {
    parentId: body.parentId ?? null,
    subjectId: body.subjectId ?? null,
    gradeLevelId: body.gradeLevelId ?? null,
    periodTypeCode: body.periodTypeCode ?? null,
    periodOrdinal: body.periodOrdinal ?? null,
    coefficient: decimals.value.coefficient ?? null,
    credits: decimals.value.credits ?? null,
  };
  const violations = checkNodeGrammar(draft, toRules(type), parentType, new Set(ctxVersion.program.gradeLevelIds));
  if (violations[0]) return err(validation(violations[0].code, violations[0].message, "nodeTypeCode", { violations }));
  const ordinal = body.ordinal ?? (await cur.nextSiblingOrdinal(tx, ctxVersion.version.id, draft.parentId));
  return ok({
    id: deps.newId(),
    versionId: ctxVersion.version.id,
    parentId: draft.parentId,
    nodeTypeCode: body.nodeTypeCode,
    lineageId: deps.newId(),
    subjectId: draft.subjectId,
    gradeLevelId: draft.gradeLevelId,
    periodTypeCode: draft.periodTypeCode,
    periodOrdinal: draft.periodOrdinal,
    code: body.code,
    label: body.label,
    ordinal,
    coefficient: draft.coefficient,
    credits: draft.credits,
    isMandatory: body.isMandatory ?? true,
    isTransversal: body.isTransversal ?? false,
    categoryCode: body.categoryCode ?? null,
    gradingMode: body.gradingMode ?? "COMPOSED",
    resitAllowed: body.resitAllowed ?? false,
    countsInAverage: body.countsInAverage ?? true,
    sectionKey: body.sectionKey ?? null,
    hoursTotal: decimals.value.hoursTotal ?? null,
    hoursLecture: decimals.value.hoursLecture ?? null,
    hoursTutorial: decimals.value.hoursTutorial ?? null,
    hoursPractical: decimals.value.hoursPractical ?? null,
    attributes: body.attributes ?? {},
    status: body.status ?? "ACTIVE",
  });
}

async function loadNodeForEdit(tx: Tx, ctx: Ctx, nodeId: string, forUpdate: boolean): Promise<Result<{ node: CurriculumNode; version: CurriculumVersion; program: Program }, AppError>> {
  const node = await cur.getNode(tx, nodeId);
  if (!node) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
  const l = await loadVersionInScope(tx, ctx, node.versionId, forUpdate);
  if (!l.ok) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
  return ok({ node, ...l.value });
}

export async function updateCurriculumNode(deps: AcademicDeps, ctx: RequestContext, nodeId: string, patch: AcademicUpdateNodeBody): Promise<Result<CurriculumNode, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadNodeForEdit(tx, ctx, nodeId, true);
    if (!l.ok) return l;
    const draft = assertDraft(l.value.version);
    if (!draft.ok) return draft;
    const applied = await applyNodePatch(tx, l.value.node, l.value.program, patch);
    if (!applied.ok) return applied;
    return ok((await cur.getNode(tx, nodeId)) as CurriculumNode);
  });
}

/** Valide la grammaire du nœud APRÈS modification, puis écrit. Réutilisé par les amendements. */
async function applyNodePatch(
  tx: Tx,
  node: CurriculumNode,
  program: Program,
  patch: Partial<Record<string, any>>,
): Promise<Result<void, AppError>> {
  const decimals = parseDecimals(patch);
  if (!decimals.ok) return decimals;
  const types = await ref.listNodeTypes(tx);
  const type = types.find((t) => t.code === node.nodeTypeCode);
  if (!type) return err(validation(AcademicCode.NODE_TYPE_UNKNOWN, `Type de nœud inconnu : ${node.nodeTypeCode}.`, "nodeTypeCode"));
  const parent = node.parentId ? await cur.getNode(tx, node.parentId) : null;
  const after = {
    parentId: node.parentId,
    subjectId: patch.subjectId !== undefined ? patch.subjectId : node.subjectId,
    gradeLevelId: patch.gradeLevelId !== undefined ? patch.gradeLevelId : node.gradeLevelId,
    periodTypeCode: patch.periodTypeCode !== undefined ? patch.periodTypeCode : node.periodTypeCode,
    periodOrdinal: patch.periodOrdinal !== undefined ? patch.periodOrdinal : node.periodOrdinal,
    coefficient: decimals.value.coefficient !== undefined ? decimals.value.coefficient : node.coefficient,
    credits: decimals.value.credits !== undefined ? decimals.value.credits : node.credits,
  };
  const violations = checkNodeGrammar(after, toRules(type), parent?.nodeTypeCode ?? null, new Set(program.gradeLevelIds));
  if (violations[0]) return err(validation(violations[0].code, violations[0].message, "node", { violations }));
  const update: Parameters<typeof cur.updateNode>[2] = {};
  for (const key of ["code", "label", "subjectId", "gradeLevelId", "periodTypeCode", "periodOrdinal", "ordinal", "isMandatory", "isTransversal", "categoryCode", "gradingMode", "resitAllowed", "countsInAverage", "sectionKey", "attributes", "status"] as const) {
    if (patch[key] !== undefined) (update as Record<string, unknown>)[key] = patch[key];
  }
  for (const key of ["coefficient", "credits", "hoursTotal", "hoursLecture", "hoursTutorial", "hoursPractical"] as const) {
    if (decimals.value[key] !== undefined) (update as Record<string, unknown>)[key] = decimals.value[key];
  }
  await cur.updateNode(tx, node.id, update);
  return ok(undefined);
}

export async function moveCurriculumNode(deps: AcademicDeps, ctx: RequestContext, nodeId: string, input: { parentId: string | null; ordinal?: number | undefined }): Promise<Result<CurriculumNode, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadNodeForEdit(tx, ctx, nodeId, true);
    if (!l.ok) return l;
    const draft = assertDraft(l.value.version);
    if (!draft.ok) return draft;
    const moved = await moveNodeChecked(tx, l.value.node, l.value.version.id, input.parentId, input.ordinal);
    if (!moved.ok) return moved;
    return ok((await cur.getNode(tx, nodeId)) as CurriculumNode);
  });
}

async function moveNodeChecked(tx: Tx, node: CurriculumNode, versionId: string, parentId: string | null, ordinal?: number): Promise<Result<void, AppError>> {
  if (parentId === node.id) return err(validation(AcademicCode.NODE_CYCLE, "Un nœud ne peut pas être son propre parent.", "parentId"));
  const nodes = await cur.listNodes(tx, versionId);
  if (parentId !== null) {
    if (descendantsOf(node.id, nodes).includes(parentId)) return err(conflict(AcademicCode.NODE_CYCLE, "Ce déplacement créerait un cycle."));
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud parent", parentId));
    const type = (await ref.listNodeTypes(tx)).find((t) => t.code === node.nodeTypeCode) as NodeType;
    if (!type.allowedParentCodes.includes(parent.nodeTypeCode)) {
      return err(validation(AcademicCode.NODE_BAD_PARENT, `Un nœud ${node.nodeTypeCode} ne peut pas être sous un nœud ${parent.nodeTypeCode}.`, "parentId"));
    }
  } else {
    const type = (await ref.listNodeTypes(tx)).find((t) => t.code === node.nodeTypeCode) as NodeType;
    if (!type.allowedParentCodes.includes("ROOT")) return err(validation(AcademicCode.NODE_NEEDS_PARENT, `Un nœud ${node.nodeTypeCode} ne peut pas être à la racine.`, "parentId"));
  }
  await cur.moveNode(tx, node.id, parentId, ordinal ?? (await cur.nextSiblingOrdinal(tx, versionId, parentId)));
  return ok(undefined);
}

/** Supprime un nœud ET son sous-arbre (version DRAFT) ; refusé si un autre nœud le cite comme prérequis. */
export async function removeCurriculumNode(deps: AcademicDeps, ctx: RequestContext, nodeId: string): Promise<Result<{ removed: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadNodeForEdit(tx, ctx, nodeId, true);
    if (!l.ok) return l;
    const draft = assertDraft(l.value.version);
    if (!draft.ok) return draft;
    return removeSubtree(tx, l.value.node, l.value.version.id);
  });
}

async function removeSubtree(tx: Tx, node: CurriculumNode, versionId: string): Promise<Result<{ removed: number }, AppError>> {
  const nodes = await cur.listNodes(tx, versionId);
  const subtreeIds = [node.id, ...descendantsOf(node.id, nodes)];
  const subtree = new Set(subtreeIds);
  const lineages = nodes.filter((n) => subtree.has(n.id)).map((n) => n.lineageId);
  const requiring = (await cur.nodesRequiringLineages(tx, versionId, lineages)).filter((r) => !subtree.has(r.nodeId));
  if (requiring.length > 0) {
    return err(conflict(AcademicCode.NODE_IN_USE, "Un autre nœud exige ce nœud comme prérequis : retirez d'abord ce prérequis.", { requiredBy: requiring.map((r) => r.nodeId) }));
  }
  await cur.deleteNodes(tx, subtreeIds);
  return ok({ removed: subtreeIds.length });
}

export async function setNodePrerequisites(deps: AcademicDeps, ctx: RequestContext, nodeId: string, requiredLineageIds: readonly string[]): Promise<Result<CurriculumNode, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadNodeForEdit(tx, ctx, nodeId, true);
    if (!l.ok) return l;
    const draft = assertDraft(l.value.version);
    if (!draft.ok) return draft;
    const unique = [...new Set(requiredLineageIds)];
    await cur.replacePrerequisites(tx, l.value.version.id, nodeId, deps.newId, unique);
    return ok((await cur.getNode(tx, nodeId)) as CurriculumNode);
  });
}

// ---------------------------------------------------------------------------
// Validation, publication
// ---------------------------------------------------------------------------

async function computeReport(tx: Tx, version: CurriculumVersion, program: Program): Promise<ValidationReportRecord> {
  const [nodes, types, known, periods] = await Promise.all([
    cur.listNodes(tx, version.id),
    ref.listNodeTypes(tx),
    cur.knownLineagesOfInstitution(tx, program.institutionId),
    cal.listPeriods(tx, version.academicYearId),
  ]);
  return validateCurriculumRules({
    versionId: version.id,
    nodes,
    nodeTypes: types.map(toRules),
    programGradeLevelIds: program.gradeLevelIds,
    knownLineageIds: known,
    calendarSlots: periods.map((p) => ({ typeCode: p.periodTypeCode, ordinal: p.ordinal })),
  });
}

/** Rapport complet (erreurs et avertissements) en une passe. */
export async function validateCurriculumVersion(deps: AcademicDeps, ctx: RequestContext, versionId: string): Promise<Result<ValidationReportRecord, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId);
    if (!l.ok) return l;
    return ok(await computeReport(tx, l.value.version, l.value.program));
  });
}

/** Publie un brouillon : refusé tant que le rapport contient une `ERROR`. */
export async function publishCurriculumVersion(deps: AcademicDeps, ctx: RequestContext, versionId: string): Promise<Result<CurriculumVersion, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId, true);
    if (!l.ok) return l;
    const { version, program } = l.value;
    if (version.status !== "DRAFT") return err(conflict(AcademicCode.CURRICULUM_TRANSITION, `Le curriculum est ${version.status} : seul un brouillon se publie.`, { from: version.status }));
    const report = await computeReport(tx, version, program);
    if (!report.valid) return err(conflict(AcademicCode.CURRICULUM_INVALID, `Publication refusée : ${report.errors} erreur(s) dans le curriculum.`, { report }));
    await cur.setVersionStatus(tx, versionId, "PUBLISHED", actorId(ctx));
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.CURRICULUM_PUBLISHED,
      { v: 1, institutionId: program.institutionId, academicYearId: version.academicYearId, versionId, programId: version.programId, status: "PUBLISHED" },
      { type: "curriculum_version", id: versionId },
    );
    events.audit({ action: "academic.curriculum.published", resourceType: "curriculum_version", resourceId: versionId, before: { status: "DRAFT" }, after: { status: "PUBLISHED", warnings: report.warnings } });
    await events.flush(tx);
    return ok((await cur.getVersion(tx, versionId)) as CurriculumVersion);
  });
}

/** `PUBLISHED -> LOCKED` (clôture de l'année). */
export async function lockCurriculumVersion(deps: AcademicDeps, ctx: RequestContext, versionId: string): Promise<Result<CurriculumVersion, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId, true);
    if (!l.ok) return l;
    const { version, program } = l.value;
    if (version.status !== "PUBLISHED") return err(conflict(AcademicCode.CURRICULUM_TRANSITION, `Le curriculum est ${version.status} : seul un curriculum publié se verrouille.`, { from: version.status }));
    await cur.setVersionStatus(tx, versionId, "LOCKED", actorId(ctx));
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.CURRICULUM_LOCKED,
      { v: 1, institutionId: program.institutionId, academicYearId: version.academicYearId, versionId, programId: version.programId, status: "LOCKED" },
      { type: "curriculum_version", id: versionId },
    );
    await events.flush(tx);
    return ok((await cur.getVersion(tx, versionId)) as CurriculumVersion);
  });
}

// ---------------------------------------------------------------------------
// Amendements d'un curriculum publié (sensible : `curriculum.amend`)
// ---------------------------------------------------------------------------

export async function listCurriculumAmendments(deps: AcademicDeps, ctx: RequestContext, versionId: string): Promise<Result<CurriculumAmendment[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId);
    if (!l.ok) return l;
    return ok(await cur.listAmendments(tx, versionId));
  });
}

type Journal = { nodeId: string | null; kind: string; oldValue: unknown; newValue: unknown };

/**
 * Amende une version PUBLIÉE : coefficients, crédits, libellés et volumes par simple amendement journalisé ; ajout,
 * retrait, déplacement, caractère obligatoire et prérequis par amendement STRUCTUREL, que `CurriculumUsageGuard`
 * autorise seulement si aucune note ni inscription ne dépend du nœud. Tout est journalisé (`curriculum_amendments`,
 * append-only) avec le motif, publié (`academic.curriculum.amended`) et audité.
 */
export async function amendPublishedCurriculum(deps: AcademicDeps, ctx: RequestContext, versionId: string, body: AcademicAmendBody): Promise<Result<{ version: CurriculumVersion; amendments: number; report: ValidationReportRecord }, AppError>> {
  const reason = body.reason.trim();
  if (reason.length < 5) return err(validation(AcademicCode.AMENDMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  const actor = actorId(ctx);
  if (!actor) return err(validation(AcademicCode.AMENDMENT_NOT_ALLOWED, "Un amendement est toujours attribué à un utilisateur.", "actor"));

  return inTx(deps, ctx, async (tx) => {
    const l = await loadVersionInScope(tx, ctx, versionId, true);
    if (!l.ok) return l;
    const { version, program } = l.value;
    if (version.status !== "PUBLISHED") {
      return err(conflict(version.status === "DRAFT" ? AcademicCode.CURRICULUM_TRANSITION : AcademicCode.CURRICULUM_LOCKED, `Seul un curriculum publié s'amende (statut : ${version.status}).`, { status: version.status }));
    }
    await cur.setStructuralChange(tx, true);
    const journal: Journal[] = [];
    const inUse = async (nodeIds: readonly string[]): Promise<boolean> => {
      for (const id of nodeIds) if (await deps.ports.usageGuard.isNodeInUse(ctx, id)) return true;
      return false;
    };
    const structuralRefused = (nodeId: string): Result<never, AppError> =>
      err(conflict(AcademicCode.NODE_IN_USE, "Amendement structurel refusé : des notes, des évaluations ou des inscriptions dépendent de ce nœud.", { nodeId }));

    for (const op of body.operations) {
      if (op.op === "UPDATE_NODE") {
        const node = await cur.getNode(tx, op.nodeId);
        if (!node || node.versionId !== versionId) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", op.nodeId));
        const patch = op.patch;
        if (patch.isMandatory !== undefined && patch.isMandatory !== node.isMandatory && (await inUse([node.id]))) return structuralRefused(node.id);
        if (patch.status !== undefined && patch.status !== node.status && patch.status === "INACTIVE" && (await inUse([node.id]))) return structuralRefused(node.id);
        const before = node;
        const applied = await applyNodePatch(tx, node, program, patch);
        if (!applied.ok) return applied;
        const after = (await cur.getNode(tx, node.id)) as CurriculumNode;
        if (before.coefficient !== after.coefficient) journal.push({ nodeId: node.id, kind: "COEFFICIENT", oldValue: { coefficient: before.coefficient }, newValue: { coefficient: after.coefficient } });
        if (before.credits !== after.credits) journal.push({ nodeId: node.id, kind: "CREDITS", oldValue: { credits: before.credits }, newValue: { credits: after.credits } });
        if (before.isMandatory !== after.isMandatory) journal.push({ nodeId: node.id, kind: "MANDATORY", oldValue: { isMandatory: before.isMandatory }, newValue: { isMandatory: after.isMandatory } });
        const others: Record<string, [unknown, unknown]> = {};
        for (const k of ["label", "categoryCode", "gradingMode", "resitAllowed", "countsInAverage", "sectionKey", "hoursTotal", "hoursLecture", "hoursTutorial", "hoursPractical", "status"] as const) {
          if (before[k] !== after[k]) others[k] = [before[k], after[k]];
        }
        if (Object.keys(others).length > 0) {
          journal.push({ nodeId: node.id, kind: "OTHER", oldValue: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, v[0]])), newValue: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, v[1]])) });
        }
      } else if (op.op === "ADD_NODE") {
        const built = await buildNode(deps, tx, { version, program }, op.node);
        if (!built.ok) return built;
        await cur.insertNode(tx, built.value);
        journal.push({ nodeId: built.value.id, kind: "NODE_ADDED", oldValue: null, newValue: { code: built.value.code, nodeTypeCode: built.value.nodeTypeCode, parentId: built.value.parentId, lineageId: built.value.lineageId } });
      } else if (op.op === "REMOVE_NODE") {
        const node = await cur.getNode(tx, op.nodeId);
        if (!node || node.versionId !== versionId) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", op.nodeId));
        const nodes = await cur.listNodes(tx, versionId);
        const ids = [node.id, ...descendantsOf(node.id, nodes)];
        if (await inUse(ids)) return structuralRefused(node.id);
        const removed = await removeSubtree(tx, node, versionId);
        if (!removed.ok) return removed;
        journal.push({ nodeId: node.id, kind: "NODE_REMOVED", oldValue: { code: node.code, nodeTypeCode: node.nodeTypeCode, parentId: node.parentId, removedNodes: removed.value.removed }, newValue: null });
      } else if (op.op === "MOVE_NODE") {
        const node = await cur.getNode(tx, op.nodeId);
        if (!node || node.versionId !== versionId) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", op.nodeId));
        const nodes = await cur.listNodes(tx, versionId);
        if (await inUse([node.id, ...descendantsOf(node.id, nodes)])) return structuralRefused(node.id);
        const moved = await moveNodeChecked(tx, node, versionId, op.parentId, op.ordinal);
        if (!moved.ok) return moved;
        journal.push({ nodeId: node.id, kind: "NODE_MOVED", oldValue: { parentId: node.parentId, ordinal: node.ordinal }, newValue: { parentId: op.parentId, ordinal: op.ordinal ?? null } });
      } else {
        const node = await cur.getNode(tx, op.nodeId);
        if (!node || node.versionId !== versionId) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", op.nodeId));
        const unique = [...new Set(op.requiredLineageIds)];
        await cur.replacePrerequisites(tx, versionId, node.id, deps.newId, unique);
        journal.push({ nodeId: node.id, kind: "PREREQUISITE", oldValue: { requiredLineageIds: node.prerequisiteLineageIds }, newValue: { requiredLineageIds: unique } });
      }
    }
    await cur.setStructuralChange(tx, false);

    const report = await computeReport(tx, version, program);
    if (!report.valid) return err(conflict(AcademicCode.CURRICULUM_INVALID, `Amendement refusé : le curriculum deviendrait invalide (${report.errors} erreur(s)).`, { report }));

    for (const j of journal) {
      await cur.insertAmendment(tx, { id: deps.newId(), versionId, nodeId: j.nodeId, kind: j.kind, oldValue: j.oldValue, newValue: j.newValue, reason, amendedBy: actor });
    }
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.CURRICULUM_AMENDED,
      { v: 1, institutionId: program.institutionId, academicYearId: version.academicYearId, versionId, programId: version.programId, status: version.status, amendmentCount: journal.length, reason },
      { type: "curriculum_version", id: versionId },
    );
    events.audit({ action: "academic.curriculum.amended", resourceType: "curriculum_version", resourceId: versionId, sensitive: true, reason, after: { amendments: journal.map((j) => ({ kind: j.kind, nodeId: j.nodeId })) } });
    await events.flush(tx);
    return ok({ version: (await cur.getVersion(tx, versionId)) as CurriculumVersion, amendments: journal.length, report });
  });
}

// ---------------------------------------------------------------------------
// Prérequis (AC5.3) : logique ET sur des lignées, validées via `CompletionLookup`
// ---------------------------------------------------------------------------

/** Une lignée est-elle validée par l'apprenant ? Port `CompletionLookup`, repli : sélection `COMPLETED`. */
export async function hasValidated(deps: AcademicDeps, tx: Tx, ctx: Ctx, studentId: string, lineageId: string): Promise<boolean> {
  if (deps.ports.completion) return deps.ports.completion.hasValidated(ctx, { studentId, lineageId });
  return enr.hasCompletedLineage(tx, studentId, lineageId);
}

export interface PrerequisiteStatus {
  satisfied: boolean;
  missing: Array<{ lineageId: string; nodeId: string | null; code: string | null; label: string | null }>;
}

export async function prerequisiteStatusInTx(deps: AcademicDeps, tx: Tx, ctx: Ctx, studentId: string, node: Pick<CurriculumNode, "prerequisiteLineageIds">): Promise<PrerequisiteStatus> {
  const missingLineages: string[] = [];
  for (const lineageId of node.prerequisiteLineageIds) {
    if (!(await hasValidated(deps, tx, ctx, studentId, lineageId))) missingLineages.push(lineageId);
  }
  const described = await cur.describeLineages(tx, missingLineages);
  return {
    satisfied: missingLineages.length === 0,
    missing: missingLineages.map((lineageId) => {
      const d = described.get(lineageId);
      return { lineageId, nodeId: d?.nodeId ?? null, code: d?.code ?? null, label: d?.label ?? null };
    }),
  };
}

export async function getNodePrerequisiteStatus(deps: AcademicDeps, ctx: RequestContext, input: { studentId: string; nodeId: string }): Promise<Result<PrerequisiteStatus, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const node = await cur.getNode(tx, input.nodeId);
    if (!node) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", input.nodeId));
    const l = await loadVersionInScope(tx, ctx, node.versionId);
    if (!l.ok) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", input.nodeId));
    return ok(await prerequisiteStatusInTx(deps, tx, ctx, input.studentId, node));
  });
}
