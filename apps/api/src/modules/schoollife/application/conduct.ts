/**
 * Points de conduite : barèmes = PARAMÈTRES (brouillon -> actif -> figé -> retiré), registre en ajout seul, solde DÉRIVÉ.
 *
 *  - Aucune valeur de barème dans le code ; aucun barème livré ; `conduct_points_enabled` est faux par défaut.
 *  - Un mouvement issu d'une mesure validée ou d'une note égale la valeur du barème pour le TYPE de l'événement (la base le
 *    vérifie) ; il est écrit par l'utilisateur qui valide / rédige, dans la même transaction. Une mesure révoquée ou une note
 *    retirée produit un mouvement INVERSE exact. Un ajustement manuel est motivé, audité, sensible.
 *  - La note de conduite du bulletin n'est JAMAIS calculée ici : le solde est une AIDE (saisie humaine dans `assess`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  SchoolLifeConductDto,
  SchoolLifeManualAdjustment,
  SchoolLifeScaleCreate,
  SchoolLifeScaleDto,
} from "@ecoledigitale/contracts/src/v2/schoollife";
import { narrowestPeriod, pickScale, type ScaleFacts } from "../domain/conduct";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import * as conduct from "../infrastructure/conduct-repository";
import * as reference from "../infrastructure/reference-repository";
import type { EventTypeRow, ScaleRow } from "../infrastructure/rows";
import { safely, EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { assertStudentScope, loadTypes, resolveEnrollment } from "./support";
import { scaleDto } from "./views";
import type { EnrollmentInfo } from "./ports";

const asFacts = (s: ScaleRow): ScaleFacts => ({ ...s });

// ---------------------------------------------------------------------------
// Barèmes
// ---------------------------------------------------------------------------

export async function createScale(deps: SchoolLifeDeps, ctx: RequestContext, input: SchoolLifeScaleCreate): Promise<Result<SchoolLifeScaleDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    await conduct.insertScale(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: input.institutionId,
      code: input.code,
      label: input.label,
      gradeLevelId: input.gradeLevelId ?? null,
      initialPoints: input.initialPoints,
      minPoints: input.minPoints ?? null,
      maxPoints: input.maxPoints ?? null,
      resetScope: input.resetScope,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      sourceKind: input.sourceKind,
      createdBy: human.value,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.scale.created", resourceType: "conduct_scale", resourceId: id, sensitive: true, after: { code: input.code, institutionId: input.institutionId, sourceKind: input.sourceKind } });
    await events.flush(tx);
    const row = (await conduct.getScale(tx, id)) as ScaleRow;
    return ok(scaleDto(row, [], new Map()));
  });
}

export async function setScaleItems(deps: SchoolLifeDeps, ctx: RequestContext, scaleId: string, items: ReadonlyArray<{ eventTypeId: string; pointsDelta: number }>): Promise<Result<SchoolLifeScaleDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const scale = await conduct.getScale(tx, scaleId, { lock: true });
    if (!scale) return err(notFound(SchoolLifeCode.SCALE_NOT_FOUND, "Barème", scaleId));
    const unique = new Set(items.map((i) => i.eventTypeId));
    if (unique.size !== items.length) return err(invalid(SchoolLifeCode.INVALID_INPUT, "Un type d'événement ne figure qu'une fois dans un barème.", "items"));
    const types = await loadTypes(tx, items.map((i) => i.eventTypeId));
    for (const it of items) {
      if (!types.has(it.eventTypeId)) return err(invalid(SchoolLifeCode.TYPE_NOT_FOUND, "Type d'événement inconnu.", "items"));
    }
    await conduct.replaceScaleItems(tx, ctx.tenantId, scaleId, items.map((i) => ({ id: deps.newId(), ...i })));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.scale.items_set", resourceType: "conduct_scale", resourceId: scaleId, sensitive: true, after: { items: items.length } });
    await events.flush(tx);
    return ok(scaleDto(scale, await conduct.listScaleItems(tx, [scaleId]), types));
  });
}

export async function activateScale(deps: SchoolLifeDeps, ctx: RequestContext, scaleId: string): Promise<Result<SchoolLifeScaleDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const scale = await conduct.getScale(tx, scaleId, { lock: true });
    if (!scale) return err(notFound(SchoolLifeCode.SCALE_NOT_FOUND, "Barème", scaleId));
    await conduct.setScaleStatus(tx, scaleId, "ACTIVE");
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.scale.activated", resourceType: "conduct_scale", resourceId: scaleId, sensitive: true, after: { code: scale.code, sourceKind: scale.sourceKind } });
    await events.flush(tx);
    return ok(await scaleView(tx, scaleId));
  });
}

export async function retireScale(deps: SchoolLifeDeps, ctx: RequestContext, scaleId: string, input: { effectiveTo?: string | undefined }): Promise<Result<SchoolLifeScaleDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const scale = await conduct.getScale(tx, scaleId, { lock: true });
    if (!scale) return err(notFound(SchoolLifeCode.SCALE_NOT_FOUND, "Barème", scaleId));
    // Un barème actif ne change plus, sauf la clôture de sa période d'effet (déclencheur 2202) : on la renseigne à son retrait.
    if (scale.status === "ACTIVE" && scale.effectiveTo === null) {
      const until = input.effectiveTo ?? todayOf(deps);
      await conduct.setScaleStatus(tx, scaleId, "ACTIVE", until < scale.effectiveFrom ? scale.effectiveFrom : until);
    }
    await conduct.setScaleStatus(tx, scaleId, "RETIRED");
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.scale.retired", resourceType: "conduct_scale", resourceId: scaleId, sensitive: true, after: { code: scale.code } });
    await events.flush(tx);
    return ok(await scaleView(tx, scaleId));
  });
}

async function scaleView(tx: Tx, scaleId: string): Promise<SchoolLifeScaleDto> {
  const scale = (await conduct.getScale(tx, scaleId)) as ScaleRow;
  const items = await conduct.listScaleItems(tx, [scaleId]);
  return scaleDto(scale, items, await loadTypes(tx, items.map((i) => i.eventTypeId)));
}

export async function listScalesView(deps: SchoolLifeDeps, ctx: RequestContext, f: { institutionId?: string | undefined; status?: string | undefined }): Promise<Result<SchoolLifeScaleDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const scales = await conduct.listScales(tx, f);
      const items = await conduct.listScaleItems(tx, scales.map((s) => s.id));
      const types = await loadTypes(tx, items.map((i) => i.eventTypeId));
      return ok(scales.map((s) => scaleDto(s, items, types)));
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Mouvements automatiques (mesure validée, encouragement) et inverses
// ---------------------------------------------------------------------------

/** Période la plus étroite de l'année contenant la date, sinon `null` (période inconnue : le registre accepte `NULL`). */
async function periodOf(deps: SchoolLifeDeps, ctx: RequestContext, enrollment: EnrollmentInfo, date: string): Promise<string | null> {
  const periods = await deps.ports.periods.listPeriodsCovering(ctx, { academicYearId: enrollment.academicYearId, date });
  return narrowestPeriod(periods, date)?.periodId ?? null;
}

/**
 * Écrit le mouvement de points d'une source (mesure validée, note) SI l'établissement a activé les points ET qu'un barème actif
 * contient une valeur pour ce type. Sinon : aucun mouvement (ce n'est pas une erreur).
 */
export async function recordPointsForSource(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  source: { kind: "MEASURE" | "NOTE"; id: string; type: EventTypeRow; enrollment: EnrollmentInfo; on: string },
): Promise<void> {
  const settings = await reference.getSettings(tx, source.enrollment.institutionId);
  if (!settings?.conductPointsEnabled) return;
  const scale = pickScale((await conduct.listActiveScales(tx, source.enrollment.institutionId)).map(asFacts), {
    institutionId: source.enrollment.institutionId,
    gradeLevelId: source.enrollment.gradeLevelId,
    on: source.on,
  });
  if (!scale) return;
  const item = await conduct.getScaleItem(tx, scale.id, source.type.id);
  if (!item) return;
  const id = deps.newId();
  await conduct.insertMovement(tx, {
    id,
    tenantId: ctx.tenantId,
    scaleId: scale.id,
    enrollmentId: source.enrollment.enrollmentId,
    studentId: source.enrollment.studentId,
    academicYearId: source.enrollment.academicYearId,
    academicPeriodId: await periodOf(deps, ctx, source.enrollment, source.on),
    delta: item.pointsDelta,
    reason: `${source.kind === "MEASURE" ? "Mesure validée" : "Note"} : ${source.type.label}`.slice(0, 200),
    sourceKind: source.kind,
    sourceId: source.id,
    reversesId: null,
    createdBy: ctx.userId as string,
  });
  events.add(SchoolLifeEvents.CONDUCT_MOVEMENT_RECORDED, { v: 1, movementId: id, scaleId: scale.id, enrollmentId: source.enrollment.enrollmentId, studentId: source.enrollment.studentId, delta: item.pointsDelta, sourceKind: source.kind, reversal: false }, { type: "schoollife.conduct_movement", id });
}

/** Mouvement inverse exact du mouvement non inversé d'une source (mesure révoquée, note retirée), s'il existe. */
export async function reversePointsOfSource(deps: SchoolLifeDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, source: { kind: "MEASURE" | "NOTE"; id: string }, reason: string): Promise<void> {
  const original = await conduct.findMovementOfSource(tx, source.kind, source.id);
  if (!original) return;
  // Barème retiré ou points désactivés depuis : le solde ne compte plus ce mouvement, rien à inverser (le registre refuserait l'écriture).
  const scale = await conduct.getScale(tx, original.scaleId);
  const settings = scale ? await reference.getSettings(tx, scale.institutionId) : null;
  if (!scale || scale.status !== "ACTIVE" || !settings?.conductPointsEnabled) return;
  const id = deps.newId();
  await conduct.insertMovement(tx, {
    id,
    tenantId: ctx.tenantId,
    scaleId: original.scaleId,
    enrollmentId: original.enrollmentId,
    studentId: original.studentId,
    academicYearId: original.academicYearId,
    academicPeriodId: original.academicPeriodId,
    delta: -original.delta,
    reason: reason.slice(0, 200),
    sourceKind: original.sourceKind,
    sourceId: null,
    reversesId: original.id,
    createdBy: ctx.userId as string,
  });
  events.add(SchoolLifeEvents.CONDUCT_MOVEMENT_RECORDED, { v: 1, movementId: id, scaleId: original.scaleId, enrollmentId: original.enrollmentId, studentId: original.studentId, delta: -original.delta, sourceKind: original.sourceKind, reversal: true }, { type: "schoollife.conduct_movement", id });
}

// ---------------------------------------------------------------------------
// Ajustement manuel et lecture du solde
// ---------------------------------------------------------------------------

export async function adjustConduct(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: SchoolLifeManualAdjustment): Promise<Result<{ movementId: string }, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.conductAdjust) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "L'ajustement manuel de points exige une autorisation spécifique."));
  return inTx(deps, ctx, async (tx) => {
    const enrollment = await resolveEnrollment(deps, ctx, caps, input.enrollmentId);
    if (!enrollment.ok) return enrollment;
    const scale = await conduct.getScale(tx, input.scaleId);
    if (!scale) return err(notFound(SchoolLifeCode.SCALE_NOT_FOUND, "Barème", input.scaleId));
    if (scale.institutionId !== enrollment.value.institutionId) return err(invalid(SchoolLifeCode.INVALID_REFERENCE, "Ce barème ne concerne pas l'établissement de l'inscription.", "scaleId"));
    const id = deps.newId();
    await conduct.insertMovement(tx, {
      id,
      tenantId: ctx.tenantId,
      scaleId: scale.id,
      enrollmentId: enrollment.value.enrollmentId,
      studentId: enrollment.value.studentId,
      academicYearId: enrollment.value.academicYearId,
      academicPeriodId: input.academicPeriodId ?? (await periodOf(deps, ctx, enrollment.value, todayOf(deps))),
      delta: input.delta,
      reason: input.reason,
      sourceKind: "MANUAL_ADJUSTMENT",
      sourceId: null,
      reversesId: null,
      createdBy: human.value,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.CONDUCT_MOVEMENT_RECORDED, { v: 1, movementId: id, scaleId: scale.id, enrollmentId: enrollment.value.enrollmentId, studentId: enrollment.value.studentId, delta: input.delta, sourceKind: "MANUAL_ADJUSTMENT", reversal: false }, { type: "schoollife.conduct_movement", id });
    events.audit({ action: "schoollife.conduct.adjusted", resourceType: "conduct_movement", resourceId: id, sensitive: true, reason: input.reason, after: { delta: input.delta, scaleId: scale.id, studentId: enrollment.value.studentId } });
    await events.flush(tx);
    return ok({ movementId: id });
  });
}

/** Solde dérivé + registre d'un élève pour son inscription la plus récente de l'année demandée. */
export function getStudentConduct(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  input: { studentId: string; academicYearId?: string | undefined; periodId?: string | undefined },
): Promise<Result<SchoolLifeConductDto, AppError>> {
  return safely(async () => {
  const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
  if (!scope.ok) return scope;
  const enrollments = await deps.ports.enrollments.listEnrollmentsOfStudent(ctx, input.studentId);
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await conductViewOf(deps, ctx, tx, input.studentId, enrollments, input)),
    { readOnly: true },
  );
  });
}

/** Construit la vue de conduite (réutilisée par le dossier de l'élève). */
export async function conductViewOf(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  tx: Tx,
  studentId: string,
  enrollments: readonly EnrollmentInfo[],
  input: { academicYearId?: string | undefined; periodId?: string | undefined },
): Promise<SchoolLifeConductDto> {
  const enrollment = input.academicYearId ? enrollments.find((e) => e.academicYearId === input.academicYearId) : enrollments[0];
  const movementsRows = await conduct.listMovements(tx, { studentId, academicYearId: input.academicYearId, limit: 200 });
  const movements = movementsRows.map((m) => ({
    id: m.id,
    scaleId: m.scaleId,
    delta: m.delta,
    reason: m.reason,
    sourceKind: m.sourceKind,
    sourceId: m.sourceId,
    reversesId: m.reversesId,
    academicPeriodId: m.academicPeriodId,
    createdAt: m.createdAt.toISOString(),
  }));
  if (!enrollment) return { studentId, enabled: false, balance: null, movements };
  const settings = await reference.getSettings(tx, enrollment.institutionId);
  const enabled = settings?.conductPointsEnabled === true;
  if (!enabled) return { studentId, enabled, balance: null, movements };
  const scale = pickScale((await conduct.listActiveScales(tx, enrollment.institutionId)).map(asFacts), {
    institutionId: enrollment.institutionId,
    gradeLevelId: enrollment.gradeLevelId,
    on: todayOf(deps),
  });
  if (!scale) return { studentId, enabled, balance: null, movements };
  const row = (await conduct.getScale(tx, scale.id)) as ScaleRow;
  const period = input.periodId ?? (await periodOf(deps, ctx, enrollment, todayOf(deps)));
  const points = await conduct.conductBalance(tx, studentId, scale.id, enrollment.academicYearId, period);
  return { studentId, enabled, balance: { scaleId: scale.id, scaleCode: row.code, scaleLabel: row.label, isPlaceholder: row.sourceKind === "placeholder", points, enrollmentId: enrollment.enrollmentId }, movements };
}
