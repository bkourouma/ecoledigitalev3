/**
 * Périodes de paie (spec 032 US11, AC9.3) : collectives (aucune cible) ou ciblées (liste d'enseignants), qui peuvent
 * se chevaucher (décision 0112) — l'unicité du paiement d'une heure (hour_claims) et d'un jour de salaire
 * (salary_day_claims) est portée par les réclamations, pas par le calendrier. Une seule période « en attente de
 * calcul » à la fois (verrou consultatif + index d'unicité partiel).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isIsoDate } from "../domain/calendar";
import { PayrollCodes, conflict, invalid, notFound } from "../domain/errors";
import { PayrollEvents } from "../domain/events";
import type { PayPeriodRecord } from "../domain/records";
import type { IsoDate, PeriodStatus, Uuid } from "../domain/types";
import * as repo from "../infrastructure/setup-repo";
import { EventBuffer, inTx, lockPeriodCreation, type PayrollDeps } from "./deps";
import { PERIOD_AGGREGATE, requireUser, validateDateRange } from "./support";

export interface CreatePeriodInput {
  name: string;
  description?: string | null | undefined;
  startDate: IsoDate;
  endDate: IsoDate;
  academicYearId: Uuid;
  /** Aucune cible = période collective. */
  staffIds?: readonly Uuid[] | undefined;
}

function validateWindow(startDate: string, endDate: string): AppError | null {
  if (!isIsoDate(startDate)) return invalid("startDate", "La date de début est invalide (AAAA-MM-JJ).");
  if (!isIsoDate(endDate)) return invalid("endDate", "La date de fin est invalide (AAAA-MM-JJ).");
  return validateDateRange(startDate, endDate);
}

export async function createPeriod(deps: PayrollDeps, ctx: RequestContext, input: CreatePeriodInput): Promise<Result<PayPeriodRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) return err(invalid("name", "Le nom de la période compte de 1 à 100 caractères."));
  const bad = validateWindow(input.startDate, input.endDate);
  if (bad) return err(bad);
  const targets = [...new Set(input.staffIds ?? [])];
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    await lockPeriodCreation(tx, ctx.tenantId);
    await repo.ensureSettings(tx, ctx.tenantId);
    const awaiting = await repo.findAwaitingPeriod(tx);
    if (awaiting) {
      return err(conflict(PayrollCodes.periodPending, "Une période est déjà en attente de calcul : lancez son calcul ou clôturez-la avant d'en créer une autre.", { periodId: awaiting.id, name: awaiting.name }));
    }
    const id = deps.newId();
    const period = await repo.insertPeriod(
      tx,
      { id, tenantId: ctx.tenantId, name, description: input.description?.trim() || null, startDate: input.startDate, endDate: input.endDate, academicYearId: input.academicYearId, createdBy: user.value, now: deps.clock.now() },
      targets,
    );
    buf.add(PayrollEvents.periodCreated, { v: 1, periodId: id, startDate: input.startDate, endDate: input.endDate, academicYearId: input.academicYearId, targeted: targets.length }, { type: PERIOD_AGGREGATE, id });
    buf.audit({ action: "payroll.period.created", resourceType: "pay_period", resourceId: id, after: { name, startDate: input.startDate, endDate: input.endDate, targeted: targets.length } });
    await buf.flush(tx);
    return ok(period);
  });
}

export interface UpdatePeriodInput {
  periodId: Uuid;
  name?: string | undefined;
  description?: string | null | undefined;
  startDate?: IsoDate | undefined;
  endDate?: IsoDate | undefined;
  academicYearId?: Uuid | undefined;
  addStaffIds?: readonly Uuid[] | undefined;
  removeStaffIds?: readonly Uuid[] | undefined;
}

export async function updatePeriod(deps: PayrollDeps, ctx: RequestContext, input: UpdatePeriodInput): Promise<Result<PayPeriodRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const patch: repo.PeriodPatch = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) return err(invalid("name", "Le nom de la période compte de 1 à 100 caractères."));
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description === null ? null : input.description.trim() || null;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.academicYearId !== undefined) patch.academicYearId = input.academicYearId;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await repo.getPeriod(tx, input.periodId, { forUpdate: true });
    if (!before) return err(notFound("Période de paie", input.periodId));
    if (before.status === "ARCHIVED") return err(conflict(PayrollCodes.periodClosed, "Une période archivée ne se modifie plus."));
    const bad = validateWindow(patch.startDate ?? before.startDate, patch.endDate ?? before.endDate);
    if (bad) return err(bad);
    await repo.updatePeriod(tx, input.periodId, patch, deps.clock.now());
    await repo.addTargets(tx, ctx.tenantId, input.periodId, input.addStaffIds ?? []);
    await repo.removeTargets(tx, input.periodId, input.removeStaffIds ?? []);
    const after = (await repo.getPeriod(tx, input.periodId)) as PayPeriodRecord;
    buf.audit({
      action: "payroll.period.updated",
      resourceType: "pay_period",
      resourceId: input.periodId,
      before: { name: before.name, startDate: before.startDate, endDate: before.endDate, targets: before.targetStaffIds.length },
      after: { name: after.name, startDate: after.startDate, endDate: after.endDate, targets: after.targetStaffIds.length },
    });
    await buf.flush(tx);
    return ok(after);
  });
}

const STATUS_EVENT: Partial<Record<PeriodStatus, string>> = { CLOSED: PayrollEvents.periodClosed, ARCHIVED: PayrollEvents.periodArchived };

/** DRAFT → ACTIVE → CLOSED → ARCHIVED (la base impose les transitions légales). */
export async function setPeriodStatus(deps: PayrollDeps, ctx: RequestContext, input: { periodId: Uuid; status: PeriodStatus }): Promise<Result<PayPeriodRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await repo.getPeriod(tx, input.periodId, { forUpdate: true });
    if (!before) return err(notFound("Période de paie", input.periodId));
    if (before.status === input.status) return ok(before);
    await repo.updatePeriod(tx, input.periodId, { status: input.status }, deps.clock.now());
    const after = (await repo.getPeriod(tx, input.periodId)) as PayPeriodRecord;
    const type = STATUS_EVENT[input.status];
    if (type) buf.add(type, { v: 1, periodId: input.periodId }, { type: PERIOD_AGGREGATE, id: input.periodId });
    buf.audit({ action: `payroll.period.${input.status.toLowerCase()}`, resourceType: "pay_period", resourceId: input.periodId, before: { status: before.status }, after: { status: after.status } });
    await buf.flush(tx);
    return ok(after);
  });
}

export async function getPeriod(deps: PayrollDeps, ctx: RequestContext, periodId: Uuid): Promise<Result<PayPeriodRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const p = await repo.getPeriod(tx, periodId);
      return p ? ok(p) : err(notFound("Période de paie", periodId));
    },
    { readOnly: true },
  );
}

export async function listPeriods(
  deps: PayrollDeps,
  ctx: RequestContext,
  input: { status?: PeriodStatus | undefined; academicYearId?: Uuid | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<{ items: PayPeriodRecord[]; total: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listPeriods(tx, { status: input.status, academicYearId: input.academicYearId, limit: input.limit ?? 50, offset: input.offset ?? 0 })), { readOnly: true });
}

/** `GET /periods/pending` : la période en attente de calcul (AC9.3) — interrogée AVANT d'afficher le formulaire de création. */
export async function getPendingPeriod(deps: PayrollDeps, ctx: RequestContext): Promise<Result<PayPeriodRecord | null, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.findAwaitingPeriod(tx)), { readOnly: true });
}
