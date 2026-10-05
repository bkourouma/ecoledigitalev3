/**
 * État « prêt » d'une classe × période (décision Q-P18, 2026-10-05).
 *
 * Au primaire, les familles ne voient les rangs et les compétences d'une classe × période qu'APRÈS validation ou après que
 * l'enseignant a marqué la classe × période « prêtes » ; jamais une saisie brouillon.
 *
 *  - marquer « prêts » : action de l'enseignant (permission `primary.competency.validate`, accès à la classe), auditée, événementielle ;
 *    la saisie de la classe × période est alors GELÉE (garde applicative + déclencheur SQL) : la famille voit exactement ce que
 *    l'enseignant a déclaré prêt ;
 *  - retirer le marquage : RÉVERSIBLE tant que le bulletin n'est pas publié (au moins un bulletin publié de la période refuse),
 *    motif obligatoire (10 caractères), audité ;
 *  - `isPeriodReleasedToFamilies` : lecture sans contrôle de droit, pour le port de `results` (qui a fait les siens) — filtre les
 *    rangs provisoires côté lecture famille.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PrimaryCode, conflict, forbidden, validation } from "../domain/errors";
import { PrimaryEvents } from "../domain/events";
import type { CallerCaps, Uuid } from "../domain/types";
import { countByStatus } from "../infrastructure/assessments-repository";
import { getReadiness, listReadinessOfClass, upsertReady, withdrawReady, type PeriodReadiness } from "../infrastructure/readiness-repository";
import { requireClassAccess } from "./access";
import { lockClassPeriod, requirePeriod } from "./competencies";
import { EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";

export interface ReadinessView {
  readonly classroomId: Uuid;
  readonly periodId: Uuid;
  readonly status: "READY" | "NOT_READY";
  readonly markedAt: Date;
  readonly withdrawnAt: Date | null;
}

const view = (r: PeriodReadiness): ReadinessView => ({ classroomId: r.classroomId, periodId: r.periodId, status: r.status, markedAt: r.markedAt, withdrawnAt: r.withdrawnAt });

/** Marque la classe × période « prêtes » (idempotent : déjà prêtes = aucun nouvel événement). */
export async function markPeriodReady(deps: PrimarySchoolDeps, ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }, caps: CallerCaps): Promise<Result<ReadinessView, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const period = await requirePeriod(deps, ctx, access.value.classroom, input.periodId);
  if (!period.ok) return period;
  return inTx(deps, ctx, async (tx) => {
    await lockClassPeriod(tx, ctx, input.classroomId, input.periodId);
    const current = await getReadiness(tx, input.classroomId, input.periodId, true);
    if (current?.status === "READY") return ok(view(current));
    const counts = await countByStatus(tx, { classroomId: input.classroomId, periodId: input.periodId });
    const row = await upsertReady(tx, { tenantId: ctx.tenantId, classroomId: input.classroomId, periodId: input.periodId, by: userId, now: deps.clock.now() });
    const events = new EventBuffer(deps, ctx);
    const aggregate = { type: "primary_school.classroom_period", id: `${input.classroomId}:${input.periodId}` };
    events.add(PrimaryEvents.PERIOD_MARKED_READY, { v: 1, classroomId: input.classroomId, periodId: input.periodId }, aggregate);
    // Aucun contenu pédagogique dans l'audit : des identifiants et des comptages.
    events.audit({
      action: "primary_school.period.marked_ready",
      resourceType: "classroom_period",
      resourceId: aggregate.id,
      metadata: { classroomId: input.classroomId, periodId: input.periodId, draftCount: counts.draft, validatedCount: counts.validated },
    });
    await events.flush(tx);
    return ok(view(row));
  });
}

/** Retire le marquage « prêts » : refusé si un bulletin de la période est déjà publié aux familles. */
export async function withdrawPeriodReady(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; periodId: Uuid; reason: string },
  caps: CallerCaps,
): Promise<Result<ReadinessView, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;
  const reason = input.reason.trim();
  if (reason.length < 10) return err(validation(PrimaryCode.INVALID_INPUT, "Le motif du retrait compte au moins 10 caractères.", "reason"));
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const period = await requirePeriod(deps, ctx, access.value.classroom, input.periodId);
  if (!period.ok) return period;

  // « Non publié » : aucun bulletin publié de la période pour la classe (port `DocumentsPort`, échec fermé).
  const roster = await deps.ports.classrooms.listRoster(ctx, input.classroomId);
  for (const entry of roster) {
    const published = await deps.ports.documents.publishedPeriodIds(ctx, { studentId: entry.studentId, enrollmentId: entry.enrollmentId });
    if (published.includes(input.periodId)) {
      return err(conflict(PrimaryCode.PERIOD_PUBLISHED, "Un bulletin de cette période est déjà publié aux familles : le marquage « prêts » ne se retire plus.", { classroomId: input.classroomId, periodId: input.periodId }));
    }
  }

  return inTx(deps, ctx, async (tx) => {
    await lockClassPeriod(tx, ctx, input.classroomId, input.periodId);
    const current = await getReadiness(tx, input.classroomId, input.periodId, true);
    if (!current || current.status !== "READY") return err(conflict(PrimaryCode.PERIOD_NOT_READY, "Cette classe n'est pas marquée prête pour cette période.", { classroomId: input.classroomId, periodId: input.periodId }));
    const row = await withdrawReady(tx, { classroomId: input.classroomId, periodId: input.periodId, by: userId, reason, now: deps.clock.now() });
    const events = new EventBuffer(deps, ctx);
    const aggregate = { type: "primary_school.classroom_period", id: `${input.classroomId}:${input.periodId}` };
    events.add(PrimaryEvents.PERIOD_READY_WITHDRAWN, { v: 1, classroomId: input.classroomId, periodId: input.periodId }, aggregate);
    events.audit({ action: "primary_school.period.ready_withdrawn", resourceType: "classroom_period", resourceId: aggregate.id, reason, metadata: { classroomId: input.classroomId, periodId: input.periodId } });
    await events.flush(tx);
    return ok(view(row));
  });
}

/** États « prêts » des périodes d'une classe (personnel de la classe). */
export async function listPeriodReadiness(deps: PrimarySchoolDeps, ctx: RequestContext, classroomId: Uuid, caps: CallerCaps): Promise<Result<ReadinessView[], AppError>> {
  const access = await requireClassAccess(deps, ctx, classroomId, caps);
  if (!access.ok) return access;
  return inTx(deps, ctx, async (tx) => ok((await listReadinessOfClass(tx, classroomId)).map(view)), { readOnly: true });
}

/**
 * La classe × période est-elle marquée « prête » (visible des familles) ? Aucun contrôle de droit : le consommateur (`results`,
 * lecture famille) a fait les siens. Une classe inconnue n'est jamais « prête ».
 */
export async function isPeriodReleasedToFamilies(deps: PrimarySchoolDeps, ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }): Promise<Result<boolean, AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await getReadiness(tx, input.classroomId, input.periodId))?.status === "READY"), { readOnly: true });
}
