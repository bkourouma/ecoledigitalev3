/**
 * Échelles d'appréciation et référentiels de compétences.
 *
 * Un référentiel est VERSIONNÉ : il se publie seulement s'il compte ≥ 1 compétence, ≥ 1 niveau d'application et une échelle d'au
 * moins deux niveaux ; publié, sa structure est figée (déclencheurs SQL) ; corriger = `newFrameworkVersion` (copie en brouillon).
 * Une seule version est publiée par code : publier la suivante RETIRE la précédente (les lignes déjà saisies gardent leur version).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryCreateFrameworkBody, PrimaryCreateScaleBody, PrimaryStructureBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import type { Tx } from "@ecoledigitale/database";
import { PrimaryCode, conflict, notFound, validation } from "../domain/errors";
import { validateLevels } from "../domain/competency";
import { PrimaryEvents } from "../domain/events";
import type { Framework, FrameworkDetail, FrameworkStatus, RatingScale, Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import {
  countCompetencies,
  countLevelsOfScale,
  deleteDraftFramework,
  getFrameworkRow,
  getScaleRow,
  insertFrameworkRow,
  insertScaleRow,
  listFrameworkRows,
  listScalesRows,
  loadStructure,
  maxFrameworkVersion,
  replaceGradeLevels,
  replaceLevels,
  replaceStructure,
  retirePublishedOfCode,
  setFrameworkStatus,
  updateFrameworkLabel,
  updateScaleRow,
} from "../infrastructure/reference-repository";
import { actorOf, EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";

// ---------------------------------------------------------------------------
// Échelles
// ---------------------------------------------------------------------------

export async function listScales(deps: PrimarySchoolDeps, ctx: RequestContext): Promise<Result<RatingScale[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listScalesRows(tx)), { readOnly: true });
}

export async function createScale(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryCreateScaleBody): Promise<Result<RatingScale, AppError>> {
  const defect = validateLevels(input.levels);
  if (defect) return err(validation(PrimaryCode.INVALID_INPUT, defect, "levels"));
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    await guarded(
      async () => {
        await insertScaleRow(tx, { id, tenantId: ctx.tenantId, code: input.code, label: input.label, sourceKind: input.sourceKind, sourceReference: input.sourceReference ?? null });
        await replaceLevels(tx, ctx.tenantId, id, input.levels.map((l) => ({ id: deps.newId(), ...l })));
      },
      () => conflict(PrimaryCode.SCALE_DUPLICATE_CODE, `Une échelle de code « ${input.code} » existe déjà.`, { code: input.code }),
    );
    const scale = (await getScaleRow(tx, id)) as RatingScale;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.scale.created", resourceType: "rating_scale", resourceId: id, after: { code: scale.code, levels: scale.levels.length, sourceKind: scale.sourceKind } });
    await events.flush(tx);
    return ok(scale);
  });
}

export async function updateScale(deps: PrimarySchoolDeps, ctx: RequestContext, scaleId: Uuid, patch: { label?: string | undefined; status?: "ACTIVE" | "ARCHIVED" | undefined }): Promise<Result<RatingScale, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getScaleRow(tx, scaleId);
    if (!current) return err(notFound(PrimaryCode.SCALE_NOT_FOUND, "Échelle d'appréciation", scaleId));
    await updateScaleRow(tx, scaleId, patch);
    const scale = (await getScaleRow(tx, scaleId)) as RatingScale;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.scale.updated", resourceType: "rating_scale", resourceId: scaleId, before: { status: current.status }, after: { status: scale.status } });
    await events.flush(tx);
    return ok(scale);
  });
}

/** Remplace les niveaux d'une échelle, tant qu'aucun référentiel PUBLIÉ ne l'emploie. */
export async function putLevels(deps: PrimarySchoolDeps, ctx: RequestContext, scaleId: Uuid, levels: PrimaryCreateScaleBody["levels"]): Promise<Result<RatingScale, AppError>> {
  const defect = validateLevels(levels);
  if (defect) return err(validation(PrimaryCode.INVALID_INPUT, defect, "levels"));
  return inTx(deps, ctx, async (tx) => {
    const current = await getScaleRow(tx, scaleId);
    if (!current) return err(notFound(PrimaryCode.SCALE_NOT_FOUND, "Échelle d'appréciation", scaleId));
    if (current.locked) return err(conflict(PrimaryCode.SCALE_IN_USE, "L'échelle est employée par un référentiel publié : créer une nouvelle échelle.", { scaleId }));
    await guarded(() => replaceLevels(tx, ctx.tenantId, scaleId, levels.map((l) => ({ id: deps.newId(), ...l }))));
    const scale = (await getScaleRow(tx, scaleId)) as RatingScale;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.scale.levels_replaced", resourceType: "rating_scale", resourceId: scaleId, after: { levels: scale.levels.length } });
    await events.flush(tx);
    return ok(scale);
  });
}

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export async function listFrameworks(deps: PrimarySchoolDeps, ctx: RequestContext, filter: { status?: FrameworkStatus | undefined; gradeLevelCode?: string | undefined } = {}): Promise<Result<Framework[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listFrameworkRows(tx, filter)), { readOnly: true });
}

export function publishBlockersOf(fw: Pick<Framework, "competencyCount" | "gradeLevelCodes">, levelCount: number): Array<{ code: string; message: string }> {
  const out: Array<{ code: string; message: string }> = [];
  if (fw.competencyCount === 0) out.push({ code: PrimaryCode.FRAMEWORK_EMPTY, message: "Ajoutez au moins une compétence." });
  if (fw.gradeLevelCodes.length === 0) out.push({ code: PrimaryCode.FRAMEWORK_NO_LEVEL, message: "Indiquez au moins un niveau d'application." });
  if (levelCount < 2) out.push({ code: PrimaryCode.SCALE_TOO_SMALL, message: "L'échelle doit compter au moins deux niveaux." });
  return out;
}

/** Construit la vue détaillée (structure, échelle, manques) dans la transaction courante. */
export async function frameworkDetailOf(tx: Tx, fw: Framework): Promise<FrameworkDetail> {
  const scale = (await getScaleRow(tx, fw.scaleId)) as RatingScale;
  const domains = await loadStructure(tx, fw.id);
  return { ...fw, domains, scale, publishBlockers: fw.status === "DRAFT" ? publishBlockersOf(fw, scale.levels.length) : [] };
}

export async function getFrameworkDetail(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid): Promise<Result<FrameworkDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const fw = await getFrameworkRow(tx, id);
      if (!fw) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", id));
      return ok(await frameworkDetailOf(tx, fw));
    },
    { readOnly: true },
  );
}

export async function createFramework(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryCreateFrameworkBody): Promise<Result<FrameworkDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const scale = await getScaleRow(tx, input.scaleId);
    if (!scale) return err(notFound(PrimaryCode.SCALE_NOT_FOUND, "Échelle d'appréciation", input.scaleId));
    const version = (await maxFrameworkVersion(tx, input.code)) + 1;
    const id = deps.newId();
    await guarded(
      async () => {
        await insertFrameworkRow(tx, { id, tenantId: ctx.tenantId, code: input.code, version, label: input.label, scaleId: input.scaleId, sourceKind: input.sourceKind, sourceReference: input.sourceReference ?? null });
        await replaceGradeLevels(tx, ctx.tenantId, id, input.gradeLevelCodes);
      },
      () => conflict(PrimaryCode.FRAMEWORK_DUPLICATE, `Le référentiel « ${input.code} » v${version} existe déjà.`, { code: input.code, version }),
    );
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.framework.created", resourceType: "competency_framework", resourceId: id, after: { code: input.code, version, sourceKind: input.sourceKind } });
    await events.flush(tx);
    return ok(await frameworkDetailOf(tx, (await getFrameworkRow(tx, id)) as Framework));
  });
}

/** Remplace la structure d'un BROUILLON (niveaux d'application, domaines, compétences). */
export async function putStructure(deps: PrimarySchoolDeps, ctx: RequestContext, frameworkId: Uuid, input: PrimaryStructureBody): Promise<Result<FrameworkDetail, AppError>> {
  const seenDomains = new Set<string>();
  const seenCompetencies = new Set<string>();
  for (const [i, d] of input.domains.entries()) {
    if (seenDomains.has(d.code)) return err(validation(PrimaryCode.INVALID_INPUT, `Code de domaine en double : ${d.code}.`, ["domains", i, "code"]));
    seenDomains.add(d.code);
    for (const [j, c] of d.competencies.entries()) {
      if (seenCompetencies.has(c.code)) return err(validation(PrimaryCode.INVALID_INPUT, `Code de compétence en double : ${c.code}.`, ["domains", i, "competencies", j, "code"]));
      seenCompetencies.add(c.code);
    }
  }
  return inTx(deps, ctx, async (tx) => {
    const fw = await getFrameworkRow(tx, frameworkId, true);
    if (!fw) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", frameworkId));
    if (fw.status !== "DRAFT") return err(conflict(PrimaryCode.FRAMEWORK_NOT_DRAFT, "La structure d'un référentiel publié est figée : créer une nouvelle version.", { status: fw.status }));
    await guarded(async () => {
      if (input.label) await updateFrameworkLabel(tx, frameworkId, input.label);
      if (input.gradeLevelCodes) await replaceGradeLevels(tx, ctx.tenantId, frameworkId, input.gradeLevelCodes);
      await replaceStructure(tx, ctx.tenantId, frameworkId, input, deps.newId);
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.framework.structure_replaced", resourceType: "competency_framework", resourceId: frameworkId, after: { domains: input.domains.length, competencies: seenCompetencies.size } });
    await events.flush(tx);
    return ok(await frameworkDetailOf(tx, (await getFrameworkRow(tx, frameworkId)) as Framework));
  });
}

export async function publishFramework(deps: PrimarySchoolDeps, ctx: RequestContext, frameworkId: Uuid): Promise<Result<FrameworkDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const fw = await getFrameworkRow(tx, frameworkId, true);
    if (!fw) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", frameworkId));
    if (fw.status !== "DRAFT") return err(conflict(PrimaryCode.FRAMEWORK_TRANSITION, "Seul un brouillon se publie.", { status: fw.status }));
    const blockers = publishBlockersOf(fw, await countLevelsOfScale(tx, fw.scaleId));
    if (blockers.length > 0) {
      return err(conflict((blockers[0] as { code: (typeof PrimaryCode)[keyof typeof PrimaryCode] }).code, "Le référentiel n'est pas publiable.", { blockers }));
    }
    const retired = await retirePublishedOfCode(tx, fw.code, fw.id);
    await guarded(() => setFrameworkStatus(tx, fw.id, "PUBLISHED", actorOf(ctx), deps.clock.now()));
    const events = new EventBuffer(deps, ctx);
    events.add(PrimaryEvents.FRAMEWORK_PUBLISHED, { v: 1, frameworkId: fw.id, code: fw.code, version: fw.version, retiredVersions: retired }, { type: "primary_school.framework", id: fw.id });
    events.audit({ action: "primary_school.framework.published", resourceType: "competency_framework", resourceId: fw.id, after: { code: fw.code, version: fw.version, competencies: fw.competencyCount }, sensitive: true });
    await events.flush(tx);
    return ok(await frameworkDetailOf(tx, (await getFrameworkRow(tx, fw.id)) as Framework));
  });
}

/** Copie un référentiel (publié ou non) en une nouvelle version BROUILLON ; la précédente reste publiée jusqu'à la publication. */
export async function newFrameworkVersion(deps: PrimarySchoolDeps, ctx: RequestContext, frameworkId: Uuid): Promise<Result<FrameworkDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const source = await getFrameworkRow(tx, frameworkId);
    if (!source) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", frameworkId));
    const drafts = (await listFrameworkRows(tx, { status: "DRAFT" })).filter((f) => f.code === source.code);
    if (drafts.length > 0) return err(conflict(PrimaryCode.FRAMEWORK_DUPLICATE, "Une version brouillon de ce référentiel existe déjà : la terminer ou la supprimer.", { frameworkId: (drafts[0] as Framework).id }));
    const version = (await maxFrameworkVersion(tx, source.code)) + 1;
    const id = deps.newId();
    await guarded(async () => {
      await insertFrameworkRow(tx, { id, tenantId: ctx.tenantId, code: source.code, version, label: source.label, scaleId: source.scaleId, sourceKind: source.sourceKind, sourceReference: source.sourceReference });
      await replaceGradeLevels(tx, ctx.tenantId, id, source.gradeLevelCodes);
      const domains = await loadStructure(tx, source.id);
      await replaceStructure(
        tx,
        ctx.tenantId,
        id,
        { domains: domains.map((d) => ({ code: d.code, label: d.label, competencies: d.competencies.map((c) => ({ code: c.code, label: c.label, description: c.description })) })) },
        deps.newId,
      );
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.framework.version_created", resourceType: "competency_framework", resourceId: id, after: { code: source.code, version, copiedFrom: source.id } });
    await events.flush(tx);
    return ok(await frameworkDetailOf(tx, (await getFrameworkRow(tx, id)) as Framework));
  });
}

/** Supprime un brouillon (jamais un référentiel publié : déclencheur SQL). */
export async function deleteDraftFrameworkUseCase(deps: PrimarySchoolDeps, ctx: RequestContext, frameworkId: Uuid): Promise<Result<void, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const fw = await getFrameworkRow(tx, frameworkId, true);
    if (!fw) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", frameworkId));
    if (fw.status !== "DRAFT") return err(conflict(PrimaryCode.FRAMEWORK_NOT_DRAFT, "Un référentiel publié ne se supprime pas.", { status: fw.status }));
    await guarded(() => deleteDraftFramework(tx, frameworkId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.framework.draft_deleted", resourceType: "competency_framework", resourceId: frameworkId, before: { code: fw.code, version: fw.version } });
    await events.flush(tx);
    return ok(undefined);
  });
}

export { countCompetencies };
