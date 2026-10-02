/**
 * Convocations des tuteurs. L'envoi passe par le port `notifications` : la convocation ne devient `SENT` que si la
 * notification est RÉELLEMENT mise en file (le statut suit la réalité, `notification_ref` = clé d'idempotence). L'accusé de
 * réception vient d'un tuteur convoqué dont le lien est revérifié. Destinataires et motif sont figés après l'envoi (base).
 * Le texte envoyé ne contient jamais le motif disciplinaire : la famille le lit dans le portail (`audience_may_see`).
 */
import { abidjanDateTime, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { SchoolLifeConvocationCreate, SchoolLifeConvocationDto } from "@ecoledigitale/contracts/src/v2/schoollife";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import { canTransition, CONVOCATION_TRANSITIONS } from "../domain/machines";
import * as repo from "../infrastructure/convocations-repository";
import type { ConvocationRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { actorNameOf, assertStudentScope, clampPage, resolveEnrollment, staffMaySee, studentNames, viewerOf } from "./support";
import type { NotificationChannelName } from "./ports";
import { convocationDto } from "./views";

async function views(deps: SchoolLifeDeps, ctx: RequestContext, rows: readonly ConvocationRow[], options: { unmask?: boolean } = {}): Promise<SchoolLifeConvocationDto[]> {
  const names = await studentNames(deps, ctx, rows.map((r) => r.studentId));
  return rows.map((r) => convocationDto(r, { types: new Map(), names }, options));
}

const eventPayload = (c: ConvocationRow): { v: 1 } & Record<string, unknown> => ({ v: 1, convocationId: c.id, enrollmentId: c.enrollmentId, studentId: c.studentId, reasonKind: c.reasonKind, scheduledAt: c.scheduledAt.toISOString() });

function requireManage(caps: CallerCaps): Result<void, AppError> {
  return caps.convocationManage ? ok(undefined) : err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Gérer les convocations exige une autorisation spécifique."));
}

async function loadVisible(deps: SchoolLifeDeps, ctx: RequestContext, tx: Tx, caps: CallerCaps, id: string, options: { lock?: boolean } = {}): Promise<Result<ConvocationRow, AppError>> {
  const row = await repo.getConvocation(tx, id, options);
  if (!row || !staffMaySee(viewerOf(caps), "CONVOCATION", row.confidentiality, row.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Convocation", id));
  const scope = await assertStudentScope(deps, ctx, caps, row.studentId);
  if (!scope.ok) return err(notFound(SchoolLifeCode.NOT_FOUND, "Convocation", id));
  return ok(row);
}

export async function createConvocation(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: SchoolLifeConvocationCreate, options: { rescheduledFromId?: string } = {}): Promise<Result<SchoolLifeConvocationDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const manage = requireManage(caps);
  if (!manage.ok) return manage;
  const convenerName = await actorNameOf(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const enrollment = await resolveEnrollment(deps, ctx, caps, input.enrollmentId);
    if (!enrollment.ok) return enrollment;
    const guardians = await deps.ports.people.listGuardiansOfStudent(ctx, enrollment.value.studentId);
    if (guardians.length === 0) return err(invalid(SchoolLifeCode.NO_GUARDIANS, "Aucun tuteur n'est lié à cet élève : impossible de le convoquer.", "enrollmentId"));
    const known = new Set(guardians.map((g) => g.guardianId));
    const guardianIds = input.guardianIds ?? guardians.map((g) => g.guardianId);
    if (guardianIds.some((g) => !known.has(g))) return err(invalid(SchoolLifeCode.NOT_A_GUARDIAN, "Un destinataire n'est pas un tuteur lié à cet élève.", "guardianIds"));
    const id = deps.newId();
    await repo.insertConvocation(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: enrollment.value.institutionId,
      academicYearId: enrollment.value.academicYearId,
      enrollmentId: enrollment.value.enrollmentId,
      studentId: enrollment.value.studentId,
      guardianIds,
      reasonKind: input.reasonKind,
      reason: input.reason,
      relatedMeasureId: input.relatedMeasureId ?? null,
      relatedIncidentId: input.relatedIncidentId ?? null,
      scheduledAt: new Date(input.scheduledAt),
      location: input.location ?? null,
      convenedBy: human.value,
      convenedByName: convenerName,
      rescheduledFromId: options.rescheduledFromId ?? null,
      confidentiality: input.confidentiality ?? "STANDARD",
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.convocation.created", resourceType: "convocation", resourceId: id, after: { studentId: enrollment.value.studentId, reasonKind: input.reasonKind, guardians: guardianIds.length } });
    await events.flush(tx);
    return ok((await views(deps, ctx, [(await repo.getConvocation(tx, id)) as ConvocationRow], { unmask: true }))[0] as SchoolLifeConvocationDto);
  });
}

export async function sendConvocation(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { channels: readonly NotificationChannelName[] }): Promise<Result<SchoolLifeConvocationDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const manage = requireManage(caps);
  if (!manage.ok) return manage;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (!canTransition(CONVOCATION_TRANSITIONS, row.status, "SENT")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une convocation ${row.status} ne peut pas être envoyée.`));
    const key = deps.newId();
    try {
      const names = await studentNames(deps, ctx, [row.studentId]);
      const when = abidjanDateTime(row.scheduledAt); // « AAAA-MM-JJ HH:mm » en heure de l'établissement
      await deps.ports.notifications.notifyGuardians(ctx, {
        kind: "CONVOCATION",
        studentId: row.studentId,
        guardianIds: row.guardianIds,
        channels: input.channels,
        variables: { subject: "Convocation à un entretien", date: when.slice(0, 10), time: when.slice(11, 16), place: row.location ?? "À préciser", studentName: names.get(row.studentId) ?? "votre enfant" },
        clientKey: key,
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && "kind" in e && "httpStatus" in e) throw e;
      return err(invalid(SchoolLifeCode.NOTIFICATION_FAILED, `La convocation n'a pas pu être envoyée : ${(e as Error).message}`));
    }
    await repo.updateConvocation(tx, id, { status: "SENT", notificationRef: key });
    const updated = (await repo.getConvocation(tx, id)) as ConvocationRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.CONVOCATION_SENT, eventPayload(updated), { type: "schoollife.convocation", id });
    events.audit({ action: "schoollife.convocation.sent", resourceType: "convocation", resourceId: id, after: { channels: input.channels } });
    await events.flush(tx);
    return ok((await views(deps, ctx, [updated]))[0] as SchoolLifeConvocationDto);
  });
}

async function simpleTransition(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  id: string,
  to: "HELD" | "NO_SHOW" | "CANCELLED",
  patch: { outcomeNote?: string | null; cancelReason?: string | null },
  eventName: string,
): Promise<Result<SchoolLifeConvocationDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const manage = requireManage(caps);
  if (!manage.ok) return manage;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (!canTransition(CONVOCATION_TRANSITIONS, row.status, to)) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une convocation ${row.status} ne peut pas passer à ${to}.`));
    await repo.updateConvocation(tx, id, { status: to, ...patch });
    const updated = (await repo.getConvocation(tx, id)) as ConvocationRow;
    const events = new EventBuffer(deps, ctx);
    // Une convocation jamais envoyée (DRAFT) qu'on annule n'a rien changé pour la famille : pas d'événement.
    if (!(to === "CANCELLED" && row.status === "DRAFT")) events.add(eventName, eventPayload(updated), { type: "schoollife.convocation", id });
    events.audit({ action: `schoollife.convocation.${to.toLowerCase()}`, resourceType: "convocation", resourceId: id, reason: patch.cancelReason ?? patch.outcomeNote ?? null });
    await events.flush(tx);
    return ok((await views(deps, ctx, [updated]))[0] as SchoolLifeConvocationDto);
  });
}

export const holdConvocation = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { outcomeNote?: string | undefined }): Promise<Result<SchoolLifeConvocationDto, AppError>> =>
  simpleTransition(deps, ctx, caps, id, "HELD", { outcomeNote: input.outcomeNote ?? null }, SchoolLifeEvents.CONVOCATION_HELD);
export const markConvocationMissed = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { outcomeNote?: string | undefined }): Promise<Result<SchoolLifeConvocationDto, AppError>> =>
  simpleTransition(deps, ctx, caps, id, "NO_SHOW", { outcomeNote: input.outcomeNote ?? null }, SchoolLifeEvents.CONVOCATION_MISSED);
export const cancelConvocation = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason: string }): Promise<Result<SchoolLifeConvocationDto, AppError>> =>
  simpleTransition(deps, ctx, caps, id, "CANCELLED", { cancelReason: input.reason }, SchoolLifeEvents.CONVOCATION_CANCELLED);

/** Report : l'origine passe `RESCHEDULED`, une nouvelle convocation (brouillon) la référence ; mêmes tuteurs et mêmes motifs. */
export async function rescheduleConvocation(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { scheduledAt: string; location?: string | undefined }): Promise<Result<SchoolLifeConvocationDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const manage = requireManage(caps);
  if (!manage.ok) return manage;
  const convenerName = await actorNameOf(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, ctx, tx, caps, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (!canTransition(CONVOCATION_TRANSITIONS, row.status, "RESCHEDULED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une convocation ${row.status} ne peut pas être reportée.`));
    await repo.updateConvocation(tx, id, { status: "RESCHEDULED" });
    const nextId = deps.newId();
    await repo.insertConvocation(tx, {
      id: nextId,
      tenantId: ctx.tenantId,
      institutionId: row.institutionId,
      academicYearId: row.academicYearId,
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      guardianIds: row.guardianIds,
      reasonKind: row.reasonKind,
      reason: row.reason,
      relatedMeasureId: row.relatedMeasureId,
      relatedIncidentId: row.relatedIncidentId,
      scheduledAt: new Date(input.scheduledAt),
      location: input.location ?? row.location,
      convenedBy: human.value,
      convenedByName: convenerName,
      rescheduledFromId: id,
      confidentiality: row.confidentiality,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.convocation.rescheduled", resourceType: "convocation", resourceId: id, after: { nextId } });
    await events.flush(tx);
    return ok((await views(deps, ctx, [(await repo.getConvocation(tx, nextId)) as ConvocationRow], { unmask: true }))[0] as SchoolLifeConvocationDto);
  });
}

/** Accusé de réception d'un TUTEUR convoqué (lien vivant revérifié ; la convocation doit lui être visible : règle SQL). */
export async function acknowledgeConvocation(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { guardianId: string }): Promise<Result<SchoolLifeConvocationDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.childAcknowledge) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Accuser réception d'une convocation exige un compte de tuteur."));
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getConvocation(tx, id, { lock: true });
    if (!row) return err(notFound(SchoolLifeCode.NOT_FOUND, "Convocation", id));
    const visible = await tx.queryOne<{ v: boolean }>(`SELECT schoollife.audience_may_see('GUARDIAN', 'CONVOCATION', $1, true, $2, NULL) AS v`, [row.confidentiality, row.status]);
    if (!visible?.v || !(await deps.ports.people.isGuardianOfStudent(ctx, human.value, row.studentId))) return err(notFound(SchoolLifeCode.NOT_FOUND, "Convocation", id));
    // Le tuteur qui accuse réception est CELUI du compte connecté (jamais un identifiant libre) et doit figurer parmi les convoqués.
    const mine = (await deps.ports.people.listGuardiansOfStudent(ctx, row.studentId)).find((g) => g.userId === human.value && row.guardianIds.includes(g.guardianId));
    if (!mine || mine.guardianId !== input.guardianId) return err(forbidden(SchoolLifeCode.NOT_A_GUARDIAN, "Seul un tuteur convoqué peut accuser réception."));
    if (!canTransition(CONVOCATION_TRANSITIONS, row.status, "ACKNOWLEDGED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Une convocation ${row.status} ne peut pas être acquittée.`));
    await repo.updateConvocation(tx, id, { status: "ACKNOWLEDGED", acknowledgedByGuardianId: mine.guardianId });
    const updated = (await repo.getConvocation(tx, id)) as ConvocationRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.CONVOCATION_ACKNOWLEDGED, eventPayload(updated), { type: "schoollife.convocation", id });
    events.audit({ action: "schoollife.convocation.acknowledged", resourceType: "convocation", resourceId: id });
    await events.flush(tx);
    return ok((await views(deps, ctx, [updated]))[0] as SchoolLifeConvocationDto);
  });
}

export interface ListConvocationsInput {
  status?: string | undefined;
  studentId?: string | undefined;
  upcomingOnly?: boolean | undefined;
  page: number;
  pageSize: number;
}

export async function listConvocationsView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: ListConvocationsInput): Promise<Result<SchoolLifeConvocationDto[], AppError>> {
  const viewer = viewerOf(caps);
  const { limit, offset } = clampPage(input.page, input.pageSize);
  let convenedBy: string | undefined;
  if (input.studentId) {
    const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
    if (!scope.ok) return scope;
  } else if (!viewer.readAll) {
    convenedBy = ctx.userId ?? undefined;
  }
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await views(deps, ctx, await repo.listConvocations(tx, { audience: viewer.audience, status: input.status, studentId: input.studentId, convenedBy, upcomingFrom: input.upcomingOnly ? deps.clock.now() : undefined, limit, offset }))),
    { readOnly: true },
  );
}

