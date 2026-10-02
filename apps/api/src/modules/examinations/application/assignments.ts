/**
 * CENTRES DE LA SESSION et RÉPARTITION des candidats (centre, salle, place) : manuelle ou automatique selon les capacités.
 *
 *  - Une place = (centre de la session, salle DU centre, numéro ≤ capacité). Un candidat inscrit a UNE place par session ; une place
 *    n'a QU'UN candidat (contraintes de la base). La répartition est figée dès que la session est en cours.
 *  - La répartition automatique est déterministe (ordre des numéros de candidat, salles par code) et TOUT OU RIEN : si la capacité
 *    manque, rien n'est écrit et le manque est annoncé. Aucune règle de séparation n'est imposée (Q-E04).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamAssignmentDto, ExamCenterDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { ASSIGNMENT_OPEN } from "../domain/lifecycle";
import type { SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toAssignmentDto, toCenterDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export interface RoomUsageDto {
  roomId: string;
  centerId: string;
  centerCode: string;
  centerName: string;
  code: string;
  capacity: number;
  active: boolean;
  used: number;
}

export interface AssignmentsOverview {
  centerIds: string[];
  centers: ExamCenterDto[];
  rooms: RoomUsageDto[];
  assignments: ExamAssignmentDto[];
  registered: number;
  unassigned: number;
  capacity: number;
  frozen: boolean;
}

async function sessionOf(tx: Parameters<typeof sess.getSession>[0], id: string): Promise<Result<SessionRow, AppError>> {
  const s = await sess.getSession(tx, id);
  return s ? ok(s) : err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
}

export async function getAssignmentsOverview(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<AssignmentsOverview, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await sessionOf(tx, sessionId);
      if (!s.ok) return s;
      const centerIds = await sess.listSessionCenterIds(tx, sessionId);
      const [centers, allRooms, usage, views, counts] = [await ref.listCenters(tx), await ref.listRooms(tx), await sess.roomUsage(tx, sessionId), await sess.listAssignmentViews(tx, sessionId), await sess.sessionCounts(tx, sessionId)];
      const chosen = centers.filter((c) => centerIds.includes(c.id));
      return ok({
        centerIds,
        centers: chosen.map((c) => toCenterDto(c, allRooms.filter((r) => r.centerId === c.id))),
        rooms: usage.map((u) => ({ roomId: u.roomId, centerId: u.centerId, centerCode: u.centerCode, centerName: u.centerName, code: u.code, capacity: u.capacity, active: u.active, used: u.used })),
        assignments: views.map(toAssignmentDto),
        registered: counts.registered,
        unassigned: Math.max(0, counts.registered - counts.assigned),
        capacity: usage.filter((u) => u.active).reduce((n, u) => n + u.capacity, 0),
        frozen: !ASSIGNMENT_OPEN.includes(s.value.status),
      });
    },
    { readOnly: true },
  );
}

/** Remplace l'ensemble des centres de la session. Un centre qui porte des places ne se retire pas. */
export async function setSessionCenters(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, centerIds: readonly string[]): Promise<Result<{ centerIds: string[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sessionOf(tx, sessionId);
    if (!s.ok) return s;
    if (!ASSIGNMENT_OPEN.includes(s.value.status)) return err(conflict(ExamCode.ASSIGNMENT_FROZEN, `La répartition est figée (session ${s.value.status}).`));
    const wanted = [...new Set(centerIds)];
    const known = new Set((await ref.listCenters(tx)).filter((c) => c.status === "ACTIVE").map((c) => c.id));
    for (const id of wanted) if (!known.has(id)) return err(notFound(ExamCode.CENTER_NOT_FOUND, "Centre actif", id));
    const current = await sess.listSessionCenterIds(tx, sessionId);
    const used = new Set((await sess.listAssignmentViews(tx, sessionId)).map((a) => a.centerId));
    for (const id of current) {
      if (wanted.includes(id)) continue;
      if (used.has(id)) return err(conflict(ExamCode.CENTER_IN_USE, "Ce centre porte des places attribuées : retirer d'abord la répartition de ses candidats.", { centerId: id }));
      await sess.removeSessionCenter(tx, sessionId, id);
    }
    for (const id of wanted) if (!current.includes(id)) await sess.addSessionCenter(tx, ctx.tenantId, sessionId, id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.session.centers", resourceType: "session", resourceId: sessionId, after: { count: wanted.length } });
    await events.flush(tx);
    return ok({ centerIds: wanted });
  });
}

export interface AutoAssignReport {
  assigned: number;
  alreadyAssigned: number;
  capacity: number;
}

export async function autoAssign(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, input: { centerIds?: readonly string[] | undefined; reassign: boolean }): Promise<Result<AutoAssignReport, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, sessionId, { forUpdate: true });
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (!ASSIGNMENT_OPEN.includes(s.status)) return err(conflict(ExamCode.ASSIGNMENT_FROZEN, `La répartition est figée (session ${s.status}).`));
    const restrict = input.centerIds ? new Set(input.centerIds) : null;
    const [centers, registered] = [await ref.listCenters(tx), await cand.listRegistered(tx, sessionId)];
    const activeCenters = new Set(centers.filter((c) => c.status === "ACTIVE").map((c) => c.id));
    if (input.reassign) await sess.deleteAllAssignments(tx, sessionId);
    const existing = new Set((await sess.listAssignmentViews(tx, sessionId)).map((a) => a.candidateId));
    const todo = registered.filter((c) => !existing.has(c.id));
    const rooms = (await sess.roomUsage(tx, sessionId)).filter((r) => r.active && activeCenters.has(r.centerId) && (!restrict || restrict.has(r.centerId)));
    const slots: Array<{ centerId: string; roomId: string; seat: number }> = [];
    for (const r of rooms) for (const seat of await sess.freeSeats(tx, sessionId, r.roomId, r.capacity)) slots.push({ centerId: r.centerId, roomId: r.roomId, seat });
    if (slots.length < todo.length) {
      return err(conflict(ExamCode.NO_CAPACITY, `Capacité insuffisante : ${todo.length} candidat(s) à placer pour ${slots.length} place(s) libre(s) dans les salles actives des centres de la session.`, { needed: todo.length, available: slots.length }));
    }
    for (let i = 0; i < todo.length; i += 1) {
      const c = todo[i] as (typeof todo)[number];
      const slot = slots[i] as (typeof slots)[number];
      await sess.upsertAssignment(tx, ctx.tenantId, { id: deps.newId(), sessionId, candidateId: c.id, centerId: slot.centerId, roomId: slot.roomId, seatNumber: slot.seat, tableNumber: null, assignedBy: ctx.userId });
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.assignment.auto", resourceType: "session", resourceId: sessionId, metadata: { assigned: todo.length, reassign: input.reassign } });
    await events.flush(tx);
    return ok({ assigned: todo.length, alreadyAssigned: existing.size, capacity: slots.length + existing.size });
  });
}

export async function assignCandidate(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  candidateId: string,
  body: { centerId: string; roomId: string; seatNumber?: number | undefined; tableNumber?: string | null | undefined },
): Promise<Result<ExamAssignmentDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    const s = await sessionOf(tx, c.sessionId);
    if (!s.ok) return s;
    if (!ASSIGNMENT_OPEN.includes(s.value.status)) return err(conflict(ExamCode.ASSIGNMENT_FROZEN, `La répartition est figée (session ${s.value.status}).`));
    const room = await ref.getRoom(tx, body.roomId);
    if (!room || room.centerId !== body.centerId) return err(notFound(ExamCode.ROOM_NOT_FOUND, "Salle de ce centre", body.roomId));
    let seat = body.seatNumber;
    if (seat === undefined) {
      // Première place libre (hors celle du candidat s'il en a déjà une dans cette salle).
      const mine = await sess.getAssignmentOfCandidate(tx, candidateId);
      const free = await sess.freeSeats(tx, c.sessionId, room.id, room.capacity);
      seat = mine && mine.roomId === room.id ? mine.seatNumber : free[0];
      if (seat === undefined) return err(conflict(ExamCode.NO_CAPACITY, "Cette salle est complète.", { roomId: room.id }));
    }
    const a = await sess.upsertAssignment(tx, ctx.tenantId, { id: deps.newId(), sessionId: c.sessionId, candidateId, centerId: body.centerId, roomId: body.roomId, seatNumber: seat, tableNumber: body.tableNumber ?? null, assignedBy: ctx.userId });
    const view = (await sess.listAssignmentViews(tx, c.sessionId)).find((v) => v.candidateId === candidateId);
    await cand.insertHistoryNote(tx, ctx.tenantId, { id: deps.newId(), candidateId, kind: "ASSIGNMENT", fromValue: null, toValue: view ? `${view.centerCode}/${view.roomCode}/${view.seatNumber}` : null, reason: null, actorId: ctx.userId });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.assignment.assign", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId, roomId: a.roomId, seat: a.seatNumber } });
    await events.flush(tx);
    if (!view) return err(validation(ExamCode.INVALID_INPUT, "Place introuvable après attribution."));
    return ok(toAssignmentDto(view));
  });
}

export async function unassignCandidate(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<Result<{ removed: boolean }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    const removed = await sess.deleteAssignment(tx, candidateId);
    if (removed) {
      await cand.insertHistoryNote(tx, ctx.tenantId, { id: deps.newId(), candidateId, kind: "ASSIGNMENT", fromValue: "ASSIGNED", toValue: null, reason: null, actorId: ctx.userId });
      const events = new EventBuffer(deps, ctx);
      events.audit({ action: "examinations.assignment.remove", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId } });
      await events.flush(tx);
    }
    return ok({ removed });
  });
}
