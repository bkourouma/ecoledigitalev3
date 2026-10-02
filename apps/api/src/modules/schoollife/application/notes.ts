/**
 * Encouragements et observations : immuables, retirées avec un motif (jamais supprimées). L'auteur est l'utilisateur de la
 * session ; la visibilité choisie par l'auteur ne dépasse pas ce que le TYPE autorise ; une note confidentielle est réservée au
 * personnel. Un encouragement dont le type a une valeur dans le barème actif produit un mouvement de points.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { SchoolLifeNoteCreate, SchoolLifeNoteDto } from "@ecoledigitale/contracts/src/v2/schoollife";
import { confidentialityRank } from "../domain/confidentiality";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import { isNoteKind } from "../domain/event-type";
import * as repo from "../infrastructure/notes-repository";
import type { NoteRow } from "../infrastructure/rows";
import { recordPointsForSource, reversePointsOfSource } from "./conduct";
import { EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { actorNameOf, assertStudentScope, clampPage, loadTypes, resolveEnrollment, staffMaySee, studentNames, viewerOf } from "./support";
import { noteDto } from "./views";

async function views(deps: SchoolLifeDeps, ctx: RequestContext, tx: import("@ecoledigitale/database").Tx, rows: readonly NoteRow[], options: { unmask?: boolean } = {}): Promise<SchoolLifeNoteDto[]> {
  const types = await loadTypes(tx, rows.map((r) => r.typeId));
  const names = await studentNames(deps, ctx, rows.map((r) => r.studentId));
  return rows.map((r) => noteDto(r, { types, names }, options));
}

export async function createNote(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: SchoolLifeNoteCreate): Promise<Result<SchoolLifeNoteDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const authorName = await actorNameOf(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const type = (await loadTypes(tx, [input.typeId])).get(input.typeId);
    if (!type) return err(notFound(SchoolLifeCode.TYPE_NOT_FOUND, "Type d'événement", input.typeId));
    if (!isNoteKind(type.kind) || !type.active) return err(invalid(SchoolLifeCode.TYPE_INACTIVE, "Le type choisi n'est pas un type d'encouragement ou d'observation actif.", "typeId"));
    const enrollment = await resolveEnrollment(deps, ctx, caps, input.enrollmentId);
    if (!enrollment.ok) return enrollment;
    if (input.visibility !== "STAFF_ONLY" && !type.visibleToGuardians) return err(invalid(SchoolLifeCode.INVALID_INPUT, "Ce type d'événement n'est pas partageable avec les familles.", "visibility"));
    const confidentiality = input.confidentiality ?? type.confidentialityDefault;
    if (confidentialityRank(confidentiality) < confidentialityRank(type.confidentialityDefault)) {
      return err(invalid(SchoolLifeCode.INVALID_INPUT, `La confidentialité ne peut pas être inférieure à celle du type (${type.confidentialityDefault}).`, "confidentiality"));
    }
    if (confidentiality === "CONFIDENTIAL" && input.visibility !== "STAFF_ONLY") return err(invalid(SchoolLifeCode.INVALID_INPUT, "Une note confidentielle est réservée au personnel.", "visibility"));
    const id = deps.newId();
    await repo.insertNote(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: enrollment.value.institutionId,
      academicYearId: enrollment.value.academicYearId,
      enrollmentId: enrollment.value.enrollmentId,
      studentId: enrollment.value.studentId,
      typeId: type.id,
      kind: type.kind,
      body: input.body,
      occurredOn: input.occurredOn,
      visibility: input.visibility,
      confidentiality,
      authorId: human.value,
      authorName,
    });
    const row = (await repo.getNote(tx, id)) as NoteRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.NOTE_CREATED, { v: 1, noteId: id, enrollmentId: row.enrollmentId, studentId: row.studentId, kind: row.kind, typeId: row.typeId, visibility: row.visibility, confidentiality: row.confidentiality }, { type: "schoollife.note", id });
    events.audit({ action: "schoollife.note.created", resourceType: "note", resourceId: id, sensitive: confidentiality !== "STANDARD", after: { kind: row.kind, typeId: row.typeId, visibility: row.visibility, studentId: row.studentId } });
    if (row.kind === "ENCOURAGEMENT") await recordPointsForSource(deps, ctx, tx, events, { kind: "NOTE", id, type, enrollment: enrollment.value, on: input.occurredOn <= todayOf(deps) ? input.occurredOn : todayOf(deps) });
    await events.flush(tx);
    return ok((await views(deps, ctx, tx, [row], { unmask: true }))[0] as SchoolLifeNoteDto);
  });
}

export async function withdrawNote(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason: string }): Promise<Result<SchoolLifeNoteDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getNote(tx, id, { lock: true });
    if (!row || !staffMaySee(viewerOf(caps), "NOTE", row.confidentiality, row.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Note", id));
    const scope = await assertStudentScope(deps, ctx, caps, row.studentId);
    if (!scope.ok) return err(notFound(SchoolLifeCode.NOT_FOUND, "Note", id));
    // L'auteur retire sa note ; un responsable (instruction, validation) peut retirer celle d'un autre.
    if (row.authorId !== human.value && !caps.incidentReview && !caps.measureValidate && !caps.exclusionValidate) {
      return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Seul l'auteur ou un responsable de vie scolaire peut retirer cette note."));
    }
    if (row.status === "WITHDRAWN") return err(invalid(SchoolLifeCode.INVALID_STATE, "La note est déjà retirée."));
    await repo.withdrawNote(tx, id, input.reason);
    const updated = (await repo.getNote(tx, id)) as NoteRow;
    const events = new EventBuffer(deps, ctx);
    await reversePointsOfSource(deps, ctx, tx, events, { kind: "NOTE", id }, "Note retirée");
    events.add(SchoolLifeEvents.NOTE_WITHDRAWN, { v: 1, noteId: id, studentId: row.studentId, kind: row.kind }, { type: "schoollife.note", id });
    events.audit({ action: "schoollife.note.withdrawn", resourceType: "note", resourceId: id, sensitive: true, reason: input.reason });
    await events.flush(tx);
    return ok((await views(deps, ctx, tx, [updated]))[0] as SchoolLifeNoteDto);
  });
}

export interface ListNotesInput {
  studentId?: string | undefined;
  classroomId?: string | undefined;
  kind?: string | undefined;
  page: number;
  pageSize: number;
}

export async function listNotesView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: ListNotesInput): Promise<Result<SchoolLifeNoteDto[], AppError>> {
  const viewer = viewerOf(caps);
  const { limit, offset } = clampPage(input.page, input.pageSize);
  let enrollmentIds: string[] | undefined;
  let authorId: string | undefined;
  if (input.studentId) {
    const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
    if (!scope.ok) return scope;
  } else if (input.classroomId) {
    if (!viewer.readAll && !(ctx.userId && (await deps.ports.people.isStaffAssignedToClassroom(ctx, ctx.userId, input.classroomId)))) return ok([]);
    enrollmentIds = (await deps.ports.enrollments.getRoster(ctx, input.classroomId, todayOf(deps))).map((r) => r.enrollmentId);
  } else if (!viewer.readAll) {
    authorId = ctx.userId ?? undefined;
  }
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await views(deps, ctx, tx, await repo.listNotes(tx, { audience: viewer.audience, studentId: input.studentId, enrollmentIds, kind: input.kind, authorId, limit, offset }))),
    { readOnly: true },
  );
}
