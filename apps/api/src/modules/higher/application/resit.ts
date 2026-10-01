/**
 * Rattrapage (session 2, US3).
 *
 *  - candidats = lignes d'ECUE `resit_eligible` des résultats FINAL (règle `eligible_rattrapage`), fournies par `results` :
 *    JAMAIS recalculées ici (AC3.1) ;
 *  - ouvrir une fenêtre : une inscription par candidat, déverrouillage de la SEULE session 2 de la période (port results /
 *    assess), événements pour 014 (frais) et assess ;
 *  - les notes de session 2 suivent le circuit ordinaire (assess -> results) ; la note retenue — la session 2 REMPLACE la
 *    session 1 — est choisie par la règle `note_examen_retenue` : aucune logique de note dans ce module ;
 *  - une seule inscription par (inscription, ECUE, période) (AC3.6).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { HigherCode, conflict, notFound, validation } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import type { IsoDate, ResitRegistration, ResitWindow, Uuid } from "../domain/types";
import * as repo from "../infrastructure/resit-repository";
import { EventBuffer, inTx, insertOrConflict, todayOf, type HigherDeps } from "./deps";
import type { ResitCandidateLine } from "./ports";

export interface OpenResitWindowInput {
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly opensOn: IsoDate;
  readonly closesOn: IsoDate;
  /** ECUE concernées ; absent = toutes les ECUE éligibles. */
  readonly nodeIds?: readonly Uuid[] | undefined;
}

export interface OpenResitWindowResult {
  readonly window: ResitWindow;
  readonly registrations: readonly ResitRegistration[];
  /** Candidats ignorés parce qu'ils étaient déjà inscrits (AC3.6). */
  readonly alreadyRegistered: number;
}

export async function listResitCandidates(
  deps: HigherDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; academicPeriodId: Uuid; nodeIds?: readonly Uuid[] | undefined },
): Promise<Result<{ stateId: Uuid; candidates: readonly ResitCandidateLine[] }, AppError>> {
  const found = await deps.ports.credits.listResitCandidates(ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
  const nodes = input.nodeIds ? new Set(input.nodeIds) : null;
  return ok({ stateId: found.stateId, candidates: found.candidates.filter((c) => !nodes || nodes.has(c.ecueNodeId)) });
}

export async function openResitWindow(deps: HigherDeps, ctx: RequestContext, input: OpenResitWindowInput): Promise<Result<OpenResitWindowResult, AppError>> {
  if (input.closesOn < input.opensOn) return err(validation(HigherCode.RESIT_WINDOW_DATES, "La fin de la fenêtre précède son début.", "closesOn"));
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour ouvrir une fenêtre.", "userId"));
  const opener = ctx.userId;

  const listed = await listResitCandidates(deps, ctx, input);
  if (!listed.ok) return listed;
  const { stateId, candidates } = listed.value;
  if (candidates.length === 0) return err(validation(HigherCode.RESIT_NO_CANDIDATES, "Aucune ECUE à repasser pour cette classe et cette période.", "classroomId"));
  const nodeIds = [...new Set(candidates.map((c) => c.ecueNodeId))];

  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const existing = await repo.findOpenWindow(tx, input.classroomId, input.academicPeriodId);
    if (existing) return err(conflict(HigherCode.RESIT_WINDOW_OPEN_EXISTS, "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période.", { windowId: existing.id }));

    const inserted = await insertOrConflict(
      tx,
      (t) =>
        repo.insertWindow(t, {
          id: deps.newId(), tenantId: ctx.tenantId, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, resultsStateId: stateId,
          opensOn: input.opensOn, closesOn: input.closesOn, nodeIds: input.nodeIds ? [...new Set(input.nodeIds)] : null, openedBy: opener, openedAt: now,
        }),
      () => conflict(HigherCode.RESIT_WINDOW_OPEN_EXISTS, "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période."),
    );
    if (!inserted.ok) return inserted;
    const window = inserted.value;

    const events = new EventBuffer(deps, ctx);
    const registrations: ResitRegistration[] = [];
    let already = 0;
    for (const c of candidates) {
      const reg = await repo.insertRegistration(tx, {
        id: deps.newId(), tenantId: ctx.tenantId, windowId: window.id, enrollmentId: c.enrollmentId, studentId: c.studentId,
        academicPeriodId: input.academicPeriodId, ecueNodeId: c.ecueNodeId, ueNodeId: c.ueNodeId, session1Average: c.session1Average, at: now,
      });
      if (!reg) {
        already += 1;
        continue;
      }
      registrations.push(reg);
      events.add(
        HigherEvents.RESIT_REGISTERED,
        { v: 1, registrationId: reg.id, enrollmentId: reg.enrollmentId, nodeId: reg.ecueNodeId, periodId: reg.academicPeriodId },
        { type: "resit_registration", id: reg.id },
      );
    }

    // Déverrouille UNIQUEMENT la session 2 de la période (les notes de session 1 restent verrouillées).
    await deps.ports.resitSession.openResitSession(ctx, { stateId, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, nodeIds });

    events.add(
      HigherEvents.RESIT_WINDOW_OPENED,
      { v: 1, windowId: window.id, classroomId: window.classroomId, periodId: window.academicPeriodId, nodeIds },
      { type: "resit_window", id: window.id },
    );
    events.audit({
      action: "higher.resit_window.opened",
      resourceType: "resit_window",
      resourceId: window.id,
      after: { classroomId: window.classroomId, academicPeriodId: window.academicPeriodId, opensOn: window.opensOn, closesOn: window.closesOn, registrations: registrations.length },
    });
    await events.flush(tx);
    return ok({ window, registrations, alreadyRegistered: already });
  });
}

export async function closeResitWindow(deps: HigherDeps, ctx: RequestContext, input: { windowId: Uuid; cancel?: boolean | undefined }): Promise<Result<ResitWindow, AppError>> {
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour fermer une fenêtre.", "userId"));
  const closer = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const found = await repo.getWindow(tx, input.windowId, true);
    if (!found) return err(notFound(HigherCode.RESIT_WINDOW_NOT_FOUND, "Fenêtre de rattrapage", input.windowId));
    if (found.status !== "OPEN") return err(conflict(HigherCode.RESIT_WINDOW_NOT_OPEN, "Cette fenêtre de rattrapage n'est plus ouverte."));
    const closed = await repo.closeWindow(tx, found.id, input.cancel ? "CANCELLED" : "CLOSED", closer, deps.clock.now());
    if (!closed) return err(conflict(HigherCode.RESIT_WINDOW_NOT_OPEN, "Cette fenêtre de rattrapage n'est plus ouverte."));
    // Verrouille de nouveau la session 2 (la reclôture produira les résultats FINAL en version supérieure).
    await deps.ports.resitSession.closeResitSession(ctx, { stateId: found.resultsStateId, classroomId: found.classroomId, academicPeriodId: found.academicPeriodId });
    const events = new EventBuffer(deps, ctx);
    events.add(
      HigherEvents.RESIT_WINDOW_CLOSED,
      { v: 1, windowId: closed.id, classroomId: closed.classroomId, periodId: closed.academicPeriodId, nodeIds: [...(found.nodeIds ?? [])] },
      { type: "resit_window", id: closed.id },
    );
    events.audit({ action: input.cancel ? "higher.resit_window.cancelled" : "higher.resit_window.closed", resourceType: "resit_window", resourceId: closed.id });
    await events.flush(tx);
    return ok(closed);
  });
}

export async function listResitWindows(
  deps: HigherDeps,
  ctx: RequestContext,
  f: { classroomId?: Uuid | undefined; academicPeriodId?: Uuid | undefined; status?: ResitWindow["status"] | undefined; limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<Result<{ items: ResitWindow[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listWindows(tx, f)), { readOnly: true });
}

export async function getResitWindow(
  deps: HigherDeps,
  ctx: RequestContext,
  windowId: Uuid,
): Promise<Result<{ window: ResitWindow; registrations: ResitRegistration[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const window = await repo.getWindow(tx, windowId);
      if (!window) return err(notFound(HigherCode.RESIT_WINDOW_NOT_FOUND, "Fenêtre de rattrapage", windowId));
      return ok({ window, registrations: await repo.listRegistrationsOfWindow(tx, windowId) });
    },
    { readOnly: true },
  );
}

export interface StudentResitView extends ResitRegistration {
  readonly opensOn: IsoDate;
  readonly closesOn: IsoDate;
  readonly windowStatus: ResitWindow["status"];
  /** `a_repasser` | `non_validee` | `validee` (AC3.5). */
  readonly phase: "TO_RETAKE" | "NOT_VALIDATED" | "VALIDATED";
}

export async function listStudentResits(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<StudentResitView[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listRegistrationsOfStudent(tx, studentId);
      return ok(rows.map((r) => ({ ...r, phase: r.outcome === "VALIDATED" ? "VALIDATED" : r.outcome === "NOT_VALIDATED" ? "NOT_VALIDATED" : "TO_RETAKE" }) as StudentResitView));
    },
    { readOnly: true },
  );
}

/** La date du jour est-elle dans la fenêtre ? (information d'affichage ; la saisie des notes est gardée par assess). */
export const isWindowCurrent = (deps: HigherDeps, w: Pick<ResitWindow, "opensOn" | "closesOn" | "status">): boolean => {
  const today = todayOf(deps);
  return w.status === "OPEN" && w.opensOn <= today && today <= w.closesOn;
};
