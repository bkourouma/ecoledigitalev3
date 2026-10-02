/**
 * Contrôles périodiques d'un dossier : planifiés (par un humain, ou par le job selon les réglages de l'établissement),
 * RÉALISÉS par un humain (`OK`, `ANOMALY` avec constat, `WAIVED` avec motif), anomalie résolue avec motif.
 *
 * Les faits constatés viennent des modules propriétaires, par ports, et sont consignés tels quels dans `evidence` :
 * jamais calculés ici (présence : `attendance` ; rapprochement : l'instantané déjà calculé du dossier). Aucun contrôle n'est exigé
 * par défaut : `required_control_kinds` est vide tant que l'établissement n'a rien choisi.
 */
import { createSystemContext, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb, Tx } from "@ecoledigitale/database";
import type { AttendanceFactsDto, ControlDto, ControlKind } from "@ecoledigitale/contracts/src/v2/stateassign";
import { isOperationalAssignment } from "../domain/assignment";
import { planControls } from "../domain/controls";
import { StateassignCode, conflict, notFound, validation } from "../domain/errors";
import { StateassignEvents } from "../domain/events";
import type { AssignmentRecord, ControlRecord, Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import * as rep from "../infrastructure/reports-repository";
import { EventBuffer, inTx, requireHuman, todayOf, type StateassignDeps } from "./deps";
import { controlDto } from "./presenters";
import { inScope, loadAssignmentInScope, namesOf, reasonOf, reasonRequired } from "./support";

function controlPayload(c: ControlRecord, a: AssignmentRecord): { v: 1 } & Record<string, unknown> {
  return { v: 1, controlId: c.id, assignmentId: a.id, enrollmentId: a.enrollmentId, studentId: a.studentId, institutionId: a.institutionId, kind: c.kind, status: c.status, dueOn: c.dueOn };
}

async function loadControl(tx: Tx, ctx: RequestContext, id: Uuid, forUpdate: boolean): Promise<Result<{ control: ControlRecord; assignment: AssignmentRecord }, AppError>> {
  const control = await repo.getControl(tx, id, { forUpdate });
  if (!control) return err(notFound(StateassignCode.CONTROL_NOT_FOUND, "Contrôle", id));
  const assignment = await repo.getAssignment(tx, control.assignmentId);
  if (!assignment || !inScope(ctx, assignment.institutionId)) return err(notFound(StateassignCode.CONTROL_NOT_FOUND, "Contrôle", id));
  return ok({ control, assignment });
}

export async function planControl(
  deps: StateassignDeps,
  ctx: RequestContext,
  assignmentId: Uuid,
  body: { kind: ControlKind; academicPeriodId?: Uuid | null | undefined; dueOn: string },
): Promise<Result<ControlDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const today = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, assignmentId, true);
    if (!loaded.ok) return loaded;
    if (!isOperationalAssignment(loaded.value.status)) {
      return err(conflict(StateassignCode.CONTROL_STATE, `Un contrôle se planifie sur un dossier vérifié, actif ou suspendu (dossier ${loaded.value.status}).`));
    }
    const c = await repo.insertControl(tx, ctx.tenantId, { id: deps.newId(), assignmentId, kind: body.kind, academicPeriodId: body.academicPeriodId ?? null, dueOn: body.dueOn, createdBy: h.value });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.control.planned", resourceType: "control", resourceId: c.id, after: { kind: c.kind, dueOn: c.dueOn }, metadata: { assignmentId } });
    await events.flush(tx);
    return ok(controlDto(c, today));
  });
}

/** Faits de présence d'une inscription (aperçu avant de réaliser le contrôle) : fournis par `attendance`, jamais calculés ici. */
export async function getAttendanceFacts(deps: StateassignDeps, ctx: RequestContext, assignmentId: Uuid, periodId: Uuid | null): Promise<Result<AttendanceFactsDto | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadAssignmentInScope(tx, ctx, assignmentId);
      if (!loaded.ok) return loaded;
      return ok(await deps.ports.attendance.getFacts(ctx, { enrollmentId: loaded.value.enrollmentId, periodId }));
    },
    { readOnly: true },
  );
}

export async function completeControl(
  deps: StateassignDeps,
  ctx: RequestContext,
  id: Uuid,
  body: { outcome: "OK" | "ANOMALY"; findings?: string | null | undefined },
): Promise<Result<ControlDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const findings = body.findings?.trim() || null;
  if (body.outcome === "ANOMALY" && (findings === null || findings.length < 5)) {
    return err(validation(StateassignCode.INVALID_INPUT, "Un constat de 5 caractères minimum est requis pour déclarer une anomalie.", "findings"));
  }
  const today = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadControl(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { control, assignment } = loaded.value;
    if (control.status !== "PENDING") return err(conflict(StateassignCode.CONTROL_TRANSITION, `Le contrôle est ${control.status} : il n'est plus à faire.`));

    // Faits constatés, fournis par leur module propriétaire (échec fermé si le port est absent).
    const evidence: Record<string, unknown> = {};
    if (control.kind === "ATTENDANCE") {
      const facts = await deps.ports.attendance.getFacts(ctx, { enrollmentId: assignment.enrollmentId, periodId: control.academicPeriodId });
      evidence.attendance = facts
        ? { available: true, source: "attendance", absentMinutes: facts.absentMinutes, excusedMinutes: facts.excusedMinutes, lateCount: facts.lateCount, periodId: facts.periodId }
        : { available: false, source: "attendance" };
    } else if (control.kind === "FINANCE_RECONCILIATION") {
      evidence.reconciliation = {
        status: assignment.reconciliationStatus,
        stateDelta: assignment.stateDelta?.amount ?? null,
        parentDelta: assignment.parentDelta?.amount ?? null,
        lastReconciledAt: assignment.lastReconciledAt ? assignment.lastReconciledAt.toISOString() : null,
        currency: assignment.currency,
      };
    }
    const updated = await repo.resolveControl(tx, id, { status: body.outcome, findings, evidence });
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.CONTROL_PERFORMED, controlPayload(updated, assignment), { type: "stateassign.control", id });
    if (updated.status === "ANOMALY") events.add(StateassignEvents.CONTROL_ANOMALY_DETECTED, controlPayload(updated, assignment), { type: "stateassign.control", id });
    events.audit({
      action: "stateassign.control.performed",
      resourceType: "control",
      resourceId: id,
      sensitive: updated.status === "ANOMALY",
      after: { status: updated.status, kind: updated.kind },
      metadata: { assignmentId: assignment.id, enrollmentId: assignment.enrollmentId },
    });
    await events.flush(tx);
    return ok(controlDto(updated, today));
  });
}

export async function waiveControl(deps: StateassignDeps, ctx: RequestContext, id: Uuid, body: { reason: string }): Promise<Result<ControlDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const reason = reasonOf(body.reason);
  if (!reason) return err(reasonRequired());
  const today = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadControl(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { control, assignment } = loaded.value;
    if (control.status !== "PENDING") return err(conflict(StateassignCode.CONTROL_TRANSITION, `Le contrôle est ${control.status} : il n'est plus à faire.`));
    const updated = await repo.resolveControl(tx, id, { status: "WAIVED", findings: reason });
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.CONTROL_PERFORMED, controlPayload(updated, assignment), { type: "stateassign.control", id });
    events.audit({ action: "stateassign.control.waived", resourceType: "control", resourceId: id, sensitive: true, reason, after: { status: "WAIVED", kind: updated.kind }, metadata: { assignmentId: assignment.id } });
    await events.flush(tx);
    return ok(controlDto(updated, today));
  });
}

export async function resolveControlAnomaly(deps: StateassignDeps, ctx: RequestContext, id: Uuid, body: { resolution: string }): Promise<Result<ControlDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const resolution = reasonOf(body.resolution);
  if (!resolution) return err(reasonRequired("resolution"));
  const today = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadControl(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { control, assignment } = loaded.value;
    if (control.status !== "ANOMALY") return err(conflict(StateassignCode.CONTROL_TRANSITION, "Seule une anomalie se résout."));
    const updated = await repo.resolveControl(tx, id, { status: "OK", resolution });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.control.anomaly_resolved", resourceType: "control", resourceId: id, sensitive: true, reason: resolution, after: { status: "OK", kind: updated.kind }, metadata: { assignmentId: assignment.id } });
    await events.flush(tx);
    return ok(controlDto(updated, today));
  });
}

export async function listControlsReport(
  deps: StateassignDeps,
  ctx: RequestContext,
  query: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined; status?: ControlRecord["status"] | undefined; kind?: ControlKind | undefined; overdueOnly?: "true" | "false" | undefined; page: number; pageSize: number },
) {
  const today = todayOf(deps);
  if (ctx.institutionId && query.institutionId && query.institutionId !== ctx.institutionId) return ok({ items: [], total: 0, page: query.page, pageSize: query.pageSize });
  const r = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await rep.controlsReport(tx, {
          institutionId: ctx.institutionId ?? query.institutionId,
          academicYearId: query.academicYearId,
          status: query.status,
          kind: query.kind,
          overdueOnly: query.overdueOnly === "true",
          today,
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        }),
      ),
    { readOnly: true },
  );
  if (!r.ok) return r;
  const names = await namesOf(deps, ctx, r.value.items.map((x) => x.studentId));
  return ok({
    items: r.value.items.map((x) => ({
      control: controlDto(x.control, today),
      assignmentReference: x.assignmentReference,
      assignmentStatus: x.assignmentStatus,
      studentId: x.studentId,
      studentName: names.get(x.studentId) ?? null,
      institutionId: x.institutionId,
      academicYearId: x.academicYearId,
    })),
    total: r.value.total,
    page: query.page,
    pageSize: query.pageSize,
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface PlanControlsReport {
  readonly examined: number;
  readonly planned: number;
  readonly failed: number;
}

/**
 * Planifie, selon les réglages de chaque établissement, les contrôles qui manquent (rien si `required_control_kinds` est vide ou
 * si le décalage n'est pas renseigné). Idempotent : l'unicité (dossier, nature, période) est imposée par la base.
 */
export async function planRequiredControls(deps: StateassignDeps, ctx: RequestContext): Promise<PlanControlsReport> {
  const today = todayOf(deps);
  let after: Uuid | null = null;
  let examined = 0;
  let planned = 0;
  let failed = 0;
  for (;;) {
    const batch = await deps.db.run(ctx, (tx) => repo.listAssignmentsForControlPlanning(tx, deps.config.jobBatchSize, after), { readOnly: true });
    if (batch.length === 0) break;
    for (const a of batch) {
      examined += 1;
      try {
        const settings = await deps.db.run(ctx, (tx) => repo.getSettings(tx, a.institutionId), { readOnly: true });
        if (settings.requiredControlKinds.length === 0 || settings.controlDueOffsetDays === null) continue;
        const needsPeriods = settings.requiredControlKinds.some((k) => k === "ATTENDANCE" || k === "FINANCE_RECONCILIATION");
        const periods = needsPeriods ? await deps.ports.enrollments.listPeriods(ctx, a.academicYearId) : [];
        const result = await inTx(deps, ctx, async (tx) => {
          const existing = await repo.listControlKeysOfAssignment(tx, a.id);
          const todo = planControls({
            settings,
            verifiedOn: (a.verifiedAt ?? a.receivedAt).toISOString().slice(0, 10),
            periods: periods.map((p) => ({ id: p.id, endsOn: p.endsOn })),
            existing,
            today,
          });
          const events = new EventBuffer(deps, ctx);
          for (const c of todo) {
            await repo.insertControl(tx, ctx.tenantId, { id: deps.newId(), assignmentId: a.id, kind: c.kind, academicPeriodId: c.academicPeriodId, dueOn: c.dueOn, createdBy: null });
          }
          if (todo.length > 0) {
            events.audit({ action: "stateassign.control.planned_by_rule", resourceType: "assignment", resourceId: a.id, metadata: { count: todo.length, kinds: [...new Set(todo.map((t) => t.kind))] } });
          }
          await events.flush(tx);
          return ok(todo.length);
        });
        if (result.ok) planned += result.value;
        else failed += 1;
      } catch (e) {
        failed += 1;
        deps.logger.warn({ assignmentId: a.id, err: e instanceof Error ? e.message : String(e) }, "stateassign : planification des contrôles en échec");
      }
    }
    after = batch[batch.length - 1]!.id;
    if (batch.length < deps.config.jobBatchSize) break;
  }
  return { examined, planned, failed };
}

export function planControlsAllTenants(deps: StateassignDeps, systemDb: SystemDb): Promise<ForEachTenantReport<PlanControlsReport>> {
  return systemDb.forEachTenant("stateassign-plan-controls", async (_tx, tenant) => planRequiredControls(deps, createSystemContext(tenant.id)));
}

/** Publie UNE fois `stateassign.control.due` pour chaque contrôle à faire dont l'échéance est atteinte. */
export async function notifyDueControls(deps: StateassignDeps, ctx: RequestContext): Promise<{ notified: number }> {
  const today = todayOf(deps);
  let notified = 0;
  for (;;) {
    const r = await inTx(deps, ctx, async (tx) => {
      const rows = await repo.listControlsDueUnnotified(tx, today, deps.config.jobBatchSize);
      const events = new EventBuffer(deps, ctx);
      let n = 0;
      for (const c of rows) {
        if (!(await repo.markControlDueNotified(tx, c.id, deps.clock.now()))) continue;
        n += 1;
        events.add(
          StateassignEvents.CONTROL_DUE,
          { v: 1, controlId: c.id, assignmentId: c.assignmentId, enrollmentId: c.enrollmentId, studentId: c.studentId, institutionId: c.institutionId, kind: c.kind, status: c.status, dueOn: c.dueOn },
          { type: "stateassign.control", id: c.id },
        );
      }
      await events.flush(tx);
      return ok({ n, size: rows.length });
    });
    if (!r.ok) throw r.error;
    notified += r.value.n;
    if (r.value.size < deps.config.jobBatchSize || r.value.n === 0) break;
  }
  return { notified };
}

export function notifyDueControlsAllTenants(deps: StateassignDeps, systemDb: SystemDb): Promise<ForEachTenantReport<{ notified: number }>> {
  return systemDb.forEachTenant("stateassign-control-due", async (_tx, tenant) => notifyDueControls(deps, createSystemContext(tenant.id)));
}
