/**
 * Mesures disciplinaires : sanction, avertissement, exclusion temporaire. LE TYPE (donnée) PORTE LE CIRCUIT :
 * validation, séparation des tâches (quatre yeux), permission d'approbation, notification des tuteurs, recours, dates.
 *
 *  - L'HUMAIN décide : proposant, validateur, notifieur, auteur de la révocation = utilisateur de la session ; la base refuse
 *    un job ou le système (`schoollife.human_actor_required`) ET le validateur identique au proposant quand le type l'exige.
 *  - Une exclusion temporaire est TOUJOURS validée (contrainte), sans chevauchement avec une autre exclusion vivante du même
 *    élève (contrainte d'exclusion) ; ses effets sur le statut de l'élève naissent `AWAITING_HUMAN` (jamais appliqués seuls).
 *  - Les points de conduite suivent le barème ACTIF paramétré (mouvement écrit à la validation, inverse à la révocation).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { SchoolLifeAppealDto, SchoolLifeMeasureDto, SchoolLifeMeasureProposeInput } from "@ecoledigitale/contracts/src/v2/schoollife";
import { confidentialityRank } from "../domain/confidentiality";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import { isMeasureKind } from "../domain/event-type";
import { APPEALABLE_MEASURE_STATUSES, canTransition, MEASURE_TRANSITIONS } from "../domain/machines";
import * as repo from "../infrastructure/measures-repository";
import * as incidents from "../infrastructure/incidents-repository";
import * as visibility from "../infrastructure/visibility-repository";
import * as reference from "../infrastructure/reference-repository";
import type { AppealRow, EventTypeRow, MeasureRow } from "../infrastructure/rows";
import { recordPointsForSource, reversePointsOfSource } from "./conduct";
import { safely, EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import type { EnrollmentInfo } from "./ports";
import { actorNameOf, assertStudentScope, clampPage, loadTypes, resolveEnrollment, staffMaySee, studentNames, viewerOf, type Viewer } from "./support";
import { appealDto, measureDto } from "./views";

async function measureViews(deps: SchoolLifeDeps, ctx: RequestContext, tx: Tx, rows: readonly MeasureRow[], options: { unmask?: boolean } = {}): Promise<SchoolLifeMeasureDto[]> {
  const types = await loadTypes(tx, rows.map((r) => r.typeId));
  const names = await studentNames(deps, ctx, rows.map((r) => r.studentId));
  const appeals = await repo.listAppealsOf(tx, rows.map((r) => r.id));
  return rows.map((r) => measureDto(r, appeals, { types, names }, options));
}

const measureEventPayload = (m: MeasureRow): { v: 1 } & Record<string, unknown> => ({
  v: 1,
  measureId: m.id,
  enrollmentId: m.enrollmentId,
  studentId: m.studentId,
  kind: m.kind,
  typeId: m.typeId,
  severityCode: m.severityCode,
  startsOn: m.startsOn,
  endsOn: m.endsOn,
  confidentiality: m.confidentiality,
  visibleToGuardians: m.visibleToGuardians,
});

const MEASURE_EVENT_BY_STATUS: Readonly<Record<string, string>> = {
  PROPOSED: SchoolLifeEvents.MEASURE_PROPOSED,
  VALIDATED: SchoolLifeEvents.MEASURE_VALIDATED,
  NOTIFIED: SchoolLifeEvents.MEASURE_NOTIFIED,
  EXECUTED: SchoolLifeEvents.MEASURE_EXECUTED,
  REVOKED: SchoolLifeEvents.MEASURE_REVOKED,
  REJECTED: SchoolLifeEvents.MEASURE_REJECTED,
  CANCELLED: SchoolLifeEvents.MEASURE_CANCELLED,
};

/** L'élément n'existe, pour l'appelant, que s'il en a l'habilitation ET le périmètre. */
async function loadVisibleMeasure(deps: SchoolLifeDeps, ctx: RequestContext, tx: Tx, caps: CallerCaps, id: string, options: { lock?: boolean } = {}): Promise<Result<MeasureRow, AppError>> {
  const row = await repo.getMeasure(tx, id, options);
  if (!row || !staffMaySee(viewerOf(caps), "MEASURE", row.confidentiality, row.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Mesure", id));
  const scope = await assertStudentScope(deps, ctx, caps, row.studentId);
  if (!scope.ok) return err(notFound(SchoolLifeCode.NOT_FOUND, "Mesure", id));
  return ok(row);
}

/** Droit de valider / rejeter / notifier cette FAMILLE de mesure : permission dédiée + permission d'approbation du TYPE. */
async function assertMayDecide(caps: CallerCaps, type: EventTypeRow): Promise<Result<void, AppError>> {
  const mayByKind = type.kind === "TEMP_EXCLUSION" ? caps.exclusionValidate === true : caps.measureValidate === true;
  if (!mayByKind) {
    return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, type.kind === "TEMP_EXCLUSION" ? "Valider une exclusion temporaire exige une autorisation spécifique." : "Valider une mesure exige une autorisation spécifique."));
  }
  if (type.approverPermission && !(await caps.can?.(type.approverPermission))) {
    return err(forbidden(SchoolLifeCode.APPROVER_PERMISSION_REQUIRED, "Ce type de mesure exige une habilitation d'approbation que vous ne détenez pas."));
  }
  return ok(undefined);
}

export async function proposeMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: SchoolLifeMeasureProposeInput): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const proposerName = await actorNameOf(deps, ctx);
    const type = (await loadTypes(tx, [input.typeId])).get(input.typeId);
    if (!type) return err(notFound(SchoolLifeCode.TYPE_NOT_FOUND, "Type d'événement", input.typeId));
    if (!isMeasureKind(type.kind) || !type.active) return err(invalid(SchoolLifeCode.TYPE_INACTIVE, "Le type choisi n'est pas un type de mesure actif.", "typeId"));
    const enrollment = await resolveEnrollment(deps, ctx, caps, input.enrollmentId);
    if (!enrollment.ok) return enrollment;
    if (type.requiresDates && (!input.startsOn || !input.endsOn)) return err(invalid(SchoolLifeCode.INVALID_INPUT, "Ce type de mesure exige des dates de début et de fin.", "startsOn"));
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) return err(invalid(SchoolLifeCode.INVALID_INPUT, "La date de fin précède la date de début.", "endsOn"));
    const confidentiality = input.confidentiality ?? type.confidentialityDefault;
    if (confidentialityRank(confidentiality) < confidentialityRank(type.confidentialityDefault)) {
      return err(invalid(SchoolLifeCode.INVALID_INPUT, `La confidentialité ne peut pas être inférieure à celle du type (${type.confidentialityDefault}).`, "confidentiality"));
    }
    if (input.incidentId) {
      const incident = await incidents.getIncident(tx, input.incidentId);
      if (!incident || !staffMaySee(viewerOf(caps), "INCIDENT", incident.confidentiality, incident.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", input.incidentId));
    }
    const severityCode = input.severityCode ?? type.defaultSeverityCode ?? null;
    if (severityCode && !(await reference.getSeverityByCode(tx, severityCode))) return err(invalid(SchoolLifeCode.INVALID_REFERENCE, "Ce niveau de gravité n'existe pas.", "severityCode"));

    // Un type sans validation (avertissement) est directement en vigueur ; sinon la mesure se PROPOSE.
    const direct = !type.requiresValidation;
    const id = deps.newId();
    await repo.insertMeasure(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: enrollment.value.institutionId,
      academicYearId: enrollment.value.academicYearId,
      enrollmentId: enrollment.value.enrollmentId,
      studentId: enrollment.value.studentId,
      classroomId: enrollment.value.classroomId,
      typeId: type.id,
      kind: type.kind,
      incidentId: input.incidentId ?? null,
      severityCode,
      reason: input.reason,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      status: direct ? "VALIDATED" : "PROPOSED",
      proposedBy: human.value,
      proposedByName: proposerName,
      validatedByName: direct ? proposerName : null,
      visibleToGuardians: input.visibleToGuardians ?? true,
      confidentiality,
    });
    const row = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.MEASURE_PROPOSED, measureEventPayload(row), { type: "schoollife.measure", id });
    events.audit({ action: "schoollife.measure.proposed", resourceType: "measure", resourceId: id, sensitive: type.kind === "TEMP_EXCLUSION", after: { kind: type.kind, typeId: type.id, studentId: row.studentId, status: row.status } });
    if (direct) await afterValidated(deps, ctx, tx, events, row, type, async () => enrollment.value);
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [row], { unmask: true }))[0] as SchoolLifeMeasureDto);
  });
}

/** Effets d'une mesure devenue en vigueur : mouvement de points, événement, demande d'effet d'exclusion (créée par la base). */
async function afterValidated(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  row: MeasureRow,
  type: EventTypeRow,
  enrollment: () => Promise<EnrollmentInfo | null>,
): Promise<void> {
  events.add(SchoolLifeEvents.MEASURE_VALIDATED, measureEventPayload(row), { type: "schoollife.measure", id: row.id });
  events.audit({ action: "schoollife.measure.validated", resourceType: "measure", resourceId: row.id, sensitive: true, after: { kind: row.kind, typeId: row.typeId, studentId: row.studentId } });
  await recordPointsForSource(deps, ctx, tx, events, { kind: "MEASURE", id: row.id, type, institutionId: row.institutionId, enrollment, on: todayOf(deps) });
  if (row.kind === "TEMP_EXCLUSION") {
    for (const effect of await repo.listEffectsOfMeasure(tx, row.id)) {
      if (effect.status === "AWAITING_HUMAN") {
        events.add(SchoolLifeEvents.EXCLUSION_EFFECT_REQUESTED, { v: 1, effectId: effect.id, measureId: row.id, studentId: row.studentId, appliedStatus: null }, { type: "schoollife.measure_effect", id: effect.id });
      }
    }
  }
}

export async function validateMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { note?: string | undefined }): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const validatorName = await actorNameOf(deps, ctx);
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    const type = (await loadTypes(tx, [row.typeId])).get(row.typeId) as EventTypeRow;
    const may = await assertMayDecide(caps, type);
    if (!may.ok) return may;
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "VALIDATED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut plus être validée.`));
    if (type.requiresFourEyes && row.proposedBy === human.value) return err(forbidden(SchoolLifeCode.FOUR_EYES_REQUIRED, "La validation doit venir d'une autre personne que le proposant (séparation des tâches)."));
    await repo.updateMeasure(tx, id, { status: "VALIDATED", validatedByName: validatorName, validationNote: input.note ?? null });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    await afterValidated(deps, ctx, tx, events, updated, type, () => deps.ports.enrollments.getEnrollment(ctx, row.enrollmentId));
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

export async function rejectMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { note: string }): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    const type = (await loadTypes(tx, [row.typeId])).get(row.typeId) as EventTypeRow;
    const may = await assertMayDecide(caps, type);
    if (!may.ok) return may;
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "REJECTED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut plus être rejetée.`));
    await repo.updateMeasure(tx, id, { status: "REJECTED", validationNote: input.note });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.MEASURE_REJECTED, measureEventPayload(updated), { type: "schoollife.measure", id });
    events.audit({ action: "schoollife.measure.rejected", resourceType: "measure", resourceId: id, sensitive: true, reason: input.note });
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

export async function cancelMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason: string }): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    // Le proposant retire sa proposition ; la direction (droit de valider cette famille) annule une mesure validée.
    const type = (await loadTypes(tx, [row.typeId])).get(row.typeId) as EventTypeRow;
    const isProposer = row.proposedBy === human.value && row.status === "PROPOSED";
    if (!isProposer) {
      const may = await assertMayDecide(caps, type);
      if (!may.ok) return may;
    }
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "CANCELLED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut plus être annulée.`));
    const effectsBefore = row.kind === "TEMP_EXCLUSION" ? (await repo.listEffectsOfMeasure(tx, id)).filter((e) => e.status === "AWAITING_HUMAN") : [];
    await repo.updateMeasure(tx, id, { status: "CANCELLED", cancelReason: input.reason });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    await reversePointsOfSource(deps, ctx, tx, events, { kind: "MEASURE", id }, "Mesure annulée");
    events.add(SchoolLifeEvents.MEASURE_CANCELLED, measureEventPayload(updated), { type: "schoollife.measure", id });
    for (const e of effectsBefore) events.add(SchoolLifeEvents.EXCLUSION_EFFECT_SKIPPED, { v: 1, effectId: e.id, measureId: id, studentId: row.studentId, appliedStatus: null }, { type: "schoollife.measure_effect", id: e.id });
    events.audit({ action: "schoollife.measure.cancelled", resourceType: "measure", resourceId: id, sensitive: true, reason: input.reason });
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

/**
 * `VALIDATED -> NOTIFIED` : la famille est informée. Si le type le demande (`notify_guardians`) et que la mesure est partageable,
 * la notification est mise en file par le port `notifications` DANS la même transaction : sans destinataire joignable, la
 * mesure reste VALIDATED (le statut suit la réalité). Le texte envoyé ne contient jamais le motif (il se lit dans le portail).
 */
export async function notifyMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    const type = (await loadTypes(tx, [row.typeId])).get(row.typeId) as EventTypeRow;
    const may = await assertMayDecide(caps, type);
    if (!may.ok) return may;
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "NOTIFIED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut pas être notifiée.`));
    let notificationRef: string | null = null;
    if (type.notifyGuardians && row.visibleToGuardians && row.confidentiality !== "CONFIDENTIAL") {
      const guardians = await deps.ports.people.listGuardiansOfStudent(ctx, row.studentId);
      if (guardians.length === 0) return err(invalid(SchoolLifeCode.NO_GUARDIANS, "Aucun tuteur n'est lié à cet élève : la mesure ne peut pas être notifiée.", "studentId"));
      const key = deps.newId();
      try {
        const names = await studentNames(deps, ctx, [row.studentId]);
        await deps.ports.notifications.notifyGuardians(ctx, {
          kind: "MEASURE_NOTICE",
          studentId: row.studentId,
          guardianIds: guardians.map((g) => g.guardianId),
          channels: ["IN_APP", "EMAIL"],
          variables: { studentName: names.get(row.studentId) ?? "votre enfant" },
          clientKey: key,
        });
        notificationRef = key;
      } catch (e) {
        if (isAppErrorLike(e)) throw e;
        return err(invalid(SchoolLifeCode.NOTIFICATION_FAILED, `La notification des tuteurs a échoué : ${(e as Error).message}`));
      }
    }
    await repo.updateMeasure(tx, id, { status: "NOTIFIED", notificationRef });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.MEASURE_NOTIFIED, measureEventPayload(updated), { type: "schoollife.measure", id });
    events.audit({ action: "schoollife.measure.notified", resourceType: "measure", resourceId: id, sensitive: true, after: { notified: notificationRef !== null } });
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

const isAppErrorLike = (e: unknown): boolean => typeof e === "object" && e !== null && "kind" in e && "httpStatus" in e;

export async function executeMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (!caps.measurePropose && !caps.measureValidate && !caps.exclusionValidate) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Constater l'exécution d'une mesure exige une autorisation de vie scolaire."));
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "EXECUTED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut pas être exécutée.`));
    await repo.updateMeasure(tx, id, { status: "EXECUTED" });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.MEASURE_EXECUTED, measureEventPayload(updated), { type: "schoollife.measure", id });
    events.audit({ action: "schoollife.measure.executed", resourceType: "measure", resourceId: id });
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

export async function revokeMeasure(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason: string }): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.measureRevoke) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Révoquer une mesure exige une autorisation spécifique."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (!canTransition(MEASURE_TRANSITIONS, row.status, "REVOKED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une mesure ${row.status} ne peut pas être révoquée.`));
    const effectsBefore = row.kind === "TEMP_EXCLUSION" ? (await repo.listEffectsOfMeasure(tx, id)).filter((e) => e.status === "AWAITING_HUMAN") : [];
    await repo.updateMeasure(tx, id, { status: "REVOKED", revokedReason: input.reason });
    const updated = (await repo.getMeasure(tx, id)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    await reversePointsOfSource(deps, ctx, tx, events, { kind: "MEASURE", id }, "Mesure révoquée");
    events.add(SchoolLifeEvents.MEASURE_REVOKED, measureEventPayload(updated), { type: "schoollife.measure", id });
    for (const e of effectsBefore) events.add(SchoolLifeEvents.EXCLUSION_EFFECT_SKIPPED, { v: 1, effectId: e.id, measureId: id, studentId: row.studentId, appliedStatus: null }, { type: "schoollife.measure_effect", id: e.id });
    events.audit({ action: "schoollife.measure.revoked", resourceType: "measure", resourceId: id, sensitive: true, reason: input.reason });
    await events.flush(tx);
    return ok((await measureViews(deps, ctx, tx, [updated], { unmask: false }))[0] as SchoolLifeMeasureDto);
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface ListMeasuresInput {
  status?: string | undefined;
  kind?: string | undefined;
  studentId?: string | undefined;
  classroomId?: string | undefined;
  pendingOnly?: boolean | undefined;
  activeOn?: string | undefined;
  page: number;
  pageSize: number;
}

export function listMeasuresView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: ListMeasuresInput): Promise<Result<SchoolLifeMeasureDto[], AppError>> {
  return safely(async () => {
  const viewer: Viewer = viewerOf(caps);
  const { limit, offset } = clampPage(input.page, input.pageSize);
  let enrollmentIds: string[] | undefined;
  let proposedBy: string | undefined;
  if (input.studentId) {
    const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
    if (!scope.ok) return scope;
  } else if (input.classroomId) {
    if (!viewer.readAll && !(ctx.userId && (await deps.ports.people.isStaffAssignedToClassroom(ctx, ctx.userId, input.classroomId)))) return ok([]);
    enrollmentIds = (await deps.ports.enrollments.getRoster(ctx, input.classroomId, todayOf(deps))).map((r) => r.enrollmentId);
  } else if (!viewer.readAll) {
    proposedBy = ctx.userId ?? undefined;
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listMeasures(tx, { audience: viewer.audience, status: input.status, kind: input.kind, studentId: input.studentId, enrollmentIds, proposedBy, pendingOnly: input.pendingOnly, activeOn: input.activeOn, limit, offset });
      return ok(await measureViews(deps, ctx, tx, rows));
    },
    { readOnly: true },
  );
  });
}

export async function getMeasureView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<SchoolLifeMeasureDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadVisibleMeasure(deps, ctx, tx, caps, id);
      if (!loaded.ok) return loaded;
      return ok((await measureViews(deps, ctx, tx, [loaded.value]))[0] as SchoolLifeMeasureDto);
    },
    { readOnly: true },
  );
}

/** Exclusion en vigueur à une date (consommée par `attendance`, `councils`, 013). Aucun texte libre. */
export async function isStudentExcludedOn(deps: SchoolLifeDeps, ctx: RequestContext, input: { enrollmentId: string; date: string }): Promise<boolean> {
  return deps.db.run(ctx, (tx) => repo.isExcludedOn(tx, input.enrollmentId, input.date), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Recours
// ---------------------------------------------------------------------------

/**
 * Dépôt d'un recours : par un tuteur lié ou l'élève (leur droit se fonde sur la règle SQL `audience_may_see` : la mesure doit
 * leur être VISIBLE, donc notifiée et partageable) ou par la direction. Le type doit être susceptible de recours ; la base
 * passe la mesure en `APPEALED`.
 */
export async function fileAppeal(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  measureId: string,
  input: { reason: string },
): Promise<Result<SchoolLifeAppealDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const filerName = await actorNameOf(deps, ctx);
    const row = await repo.getMeasure(tx, measureId, { lock: true });
    if (!row) return err(notFound(SchoolLifeCode.NOT_FOUND, "Mesure", measureId));
    // Qui dépose ? Le personnel habilité (périmètre général) ou la famille (lien vérifié à chaque appel).
    let allowed = false;
    if (caps.appealFile && caps.readAll && staffMaySee(viewerOf(caps), "MEASURE", row.confidentiality, row.status)) allowed = true;
    if (!allowed && caps.childAppeal && (await deps.ports.people.isGuardianOfStudent(ctx, human.value, row.studentId))) {
      allowed = await mayFamilySee(tx, "GUARDIAN", row);
    }
    if (!allowed && caps.selfAppeal && (await deps.ports.people.getStudentIdForUser(ctx, human.value)) === row.studentId) {
      allowed = await mayFamilySee(tx, "STUDENT", row);
    }
    if (!allowed) return err(notFound(SchoolLifeCode.NOT_FOUND, "Mesure", measureId));
    const type = (await loadTypes(tx, [row.typeId])).get(row.typeId) as EventTypeRow;
    if (!type.appealable || !APPEALABLE_MEASURE_STATUSES.includes(row.status)) return err(invalid(SchoolLifeCode.INVALID_STATE, "Cette mesure n'est pas susceptible de recours dans son état actuel."));
    const id = deps.newId();
    await repo.insertAppeal(tx, { id, tenantId: ctx.tenantId, measureId, filedBy: human.value, filedByName: filerName, reason: input.reason });
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.APPEAL_FILED, { v: 1, appealId: id, measureId, studentId: row.studentId }, { type: "schoollife.appeal", id });
    events.audit({ action: "schoollife.appeal.filed", resourceType: "appeal", resourceId: id, sensitive: true, after: { measureId } });
    await events.flush(tx);
    return ok(appealDto((await repo.getAppeal(tx, id)) as AppealRow));
  });
}

/** Règle SQL unique, appliquée à une seule ligne (jamais recopiée dans le code). */
async function mayFamilySee(tx: Tx, audience: "GUARDIAN" | "STUDENT", m: MeasureRow): Promise<boolean> {
  return visibility.maySee(tx, { audience, kind: "MEASURE", confidentiality: m.confidentiality, shareable: m.visibleToGuardians, status: m.status });
}

export async function decideAppeal(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  appealId: string,
  input: { outcome: "UPHELD" | "OVERTURNED"; decisionNote: string },
): Promise<Result<SchoolLifeAppealDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.appealDecide) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Trancher un recours exige une autorisation spécifique."));
  return inTx(deps, ctx, async (tx) => {
    const name = await actorNameOf(deps, ctx);
    const appeal = await repo.getAppeal(tx, appealId, { lock: true });
    if (!appeal) return err(notFound(SchoolLifeCode.NOT_FOUND, "Recours", appealId));
    const measure = await repo.getMeasure(tx, appeal.measureId, { lock: true });
    if (!measure || !staffMaySee(viewerOf(caps), "MEASURE", measure.confidentiality, measure.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Recours", appealId));
    if (appeal.status !== "FILED") return err(invalid(SchoolLifeCode.INVALID_STATE, `Le recours est déjà ${appeal.status}.`));
    await repo.decideAppeal(tx, appealId, { status: input.outcome, decidedBy: human.value, decidedByName: name, decisionNote: input.decisionNote });
    const after = (await repo.getMeasure(tx, appeal.measureId)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.APPEAL_DECIDED, { v: 1, appealId, measureId: appeal.measureId, studentId: measure.studentId, outcome: input.outcome }, { type: "schoollife.appeal", id: appealId });
    if (input.outcome === "OVERTURNED") {
      await reversePointsOfSource(deps, ctx, tx, events, { kind: "MEASURE", id: measure.id }, "Recours accueilli : mesure révoquée");
      events.add(SchoolLifeEvents.MEASURE_REVOKED, measureEventPayload(after), { type: "schoollife.measure", id: measure.id });
      const effects = (await repo.listEffectsOfMeasure(tx, measure.id)).filter((e) => e.status === "SKIPPED" && e.skippedReason === "Mesure révoquée");
      for (const e of effects) events.add(SchoolLifeEvents.EXCLUSION_EFFECT_SKIPPED, { v: 1, effectId: e.id, measureId: measure.id, studentId: measure.studentId, appliedStatus: null }, { type: "schoollife.measure_effect", id: e.id });
    } else {
      events.add(SchoolLifeEvents.MEASURE_EXECUTED, measureEventPayload(after), { type: "schoollife.measure", id: measure.id });
    }
    events.audit({ action: "schoollife.appeal.decided", resourceType: "appeal", resourceId: appealId, sensitive: true, reason: input.decisionNote, after: { outcome: input.outcome, measureId: appeal.measureId } });
    await events.flush(tx);
    return ok(appealDto((await repo.getAppeal(tx, appealId)) as AppealRow));
  });
}

/** Retrait par son auteur : la mesure redevient exécutoire (la base remet `EXECUTED`). */
export async function withdrawAppeal(deps: SchoolLifeDeps, ctx: RequestContext, appealId: string): Promise<Result<SchoolLifeAppealDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const name = await actorNameOf(deps, ctx);
    const appeal = await repo.getAppeal(tx, appealId, { lock: true });
    if (!appeal || appeal.filedBy !== human.value) return err(notFound(SchoolLifeCode.NOT_FOUND, "Recours", appealId));
    if (appeal.status !== "FILED") return err(invalid(SchoolLifeCode.INVALID_STATE, `Le recours est déjà ${appeal.status}.`));
    await repo.decideAppeal(tx, appealId, { status: "WITHDRAWN", decidedBy: human.value, decidedByName: name, decisionNote: null });
    const measure = (await repo.getMeasure(tx, appeal.measureId)) as MeasureRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.APPEAL_DECIDED, { v: 1, appealId, measureId: appeal.measureId, studentId: measure.studentId, outcome: "WITHDRAWN" }, { type: "schoollife.appeal", id: appealId });
    events.audit({ action: "schoollife.appeal.withdrawn", resourceType: "appeal", resourceId: appealId, after: { measureId: appeal.measureId } });
    await events.flush(tx);
    return ok(appealDto((await repo.getAppeal(tx, appealId)) as AppealRow));
  });
}
