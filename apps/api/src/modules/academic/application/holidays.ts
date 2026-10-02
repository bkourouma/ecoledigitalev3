/**
 * Calendrier de l'établissement : jours fériés, vacances, fermetures (données du tenant, jamais livrées par le module).
 *
 * Écriture réservée à `academic.settings.manage`, lecture à `academic.read` (voir `http/plugin.ts`). Une fête à date fixe
 * porte `recursYearly` : la reconduction annuelle la reporte à la même date civile ; une fête mobile se ressaisit chaque
 * année (la reconduction la compte et le dit).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AcademicCreateHolidayBody, AcademicListHolidaysQuery, AcademicUpdateHolidayBody } from "@ecoledigitale/contracts/src/v2/academic";
import { AcademicCode, notFound, validation } from "../domain/errors";
import * as repo from "../infrastructure/rollover-repository";
import { EventBuffer, assertInstitutionScope, inReadTx, inTx, type AcademicDeps } from "./deps";

export type { Holiday } from "../infrastructure/rollover-repository";

export async function listHolidays(deps: AcademicDeps, ctx: RequestContext, filter: AcademicListHolidaysQuery = {}): Promise<Result<repo.Holiday[], AppError>> {
  if (filter.institutionId) {
    const scope = assertInstitutionScope(ctx, filter.institutionId);
    if (!scope.ok) return scope;
  }
  return inReadTx(deps, ctx, async (tx) => {
    const items = await repo.listHolidays(tx, { institutionId: filter.institutionId ?? ctx.institutionId ?? null, from: filter.from ?? null, to: filter.to ?? null });
    return ok(items);
  });
}

export async function createHoliday(deps: AcademicDeps, ctx: RequestContext, input: AcademicCreateHolidayBody): Promise<Result<repo.Holiday, AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  const endsOn = input.endsOn ?? input.startsOn;
  if (endsOn < input.startsOn) return err(validation(AcademicCode.HOLIDAY_DATES_INVALID, "La fin précède le début.", "endsOn"));
  const info = await deps.ports.institutions.getInstitution(ctx, input.institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", input.institutionId));
  return inTx(deps, ctx, async (tx) => {
    const created = await repo.insertHoliday(tx, {
      id: deps.newId(),
      institutionId: input.institutionId,
      label: input.label,
      kind: input.kind ?? "HOLIDAY",
      startsOn: input.startsOn,
      endsOn,
      recursYearly: input.recursYearly ?? false,
      blocksTeaching: input.blocksTeaching ?? true,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "academic.holiday.created", resourceType: "institution_holiday", resourceId: created.id, after: { label: created.label, startsOn: created.startsOn, endsOn: created.endsOn, kind: created.kind } });
    await events.flush(tx);
    return ok(created);
  });
}

export async function updateHoliday(deps: AcademicDeps, ctx: RequestContext, id: string, patch: AcademicUpdateHolidayBody): Promise<Result<repo.Holiday, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getHoliday(tx, id);
    if (!current) return err(notFound(AcademicCode.HOLIDAY_NOT_FOUND, "Jour férié", id));
    const scope = assertInstitutionScope(ctx, current.institutionId);
    if (!scope.ok) return err(notFound(AcademicCode.HOLIDAY_NOT_FOUND, "Jour férié", id));
    const startsOn = patch.startsOn ?? current.startsOn;
    const endsOn = patch.endsOn ?? current.endsOn;
    if (endsOn < startsOn) return err(validation(AcademicCode.HOLIDAY_DATES_INVALID, "La fin précède le début.", "endsOn"));
    const updated = await repo.updateHoliday(tx, id, patch);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "academic.holiday.updated", resourceType: "institution_holiday", resourceId: id, before: current, after: updated });
    await events.flush(tx);
    return ok(updated);
  });
}

export async function deleteHoliday(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<void, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getHoliday(tx, id);
    if (!current) return err(notFound(AcademicCode.HOLIDAY_NOT_FOUND, "Jour férié", id));
    const scope = assertInstitutionScope(ctx, current.institutionId);
    if (!scope.ok) return err(notFound(AcademicCode.HOLIDAY_NOT_FOUND, "Jour férié", id));
    await repo.deleteHoliday(tx, id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "academic.holiday.deleted", resourceType: "institution_holiday", resourceId: id, before: current });
    await events.flush(tx);
    return ok(undefined);
  });
}

/** Garde pour les consommateurs : un jour donné est-il férié / fermé dans l'établissement ? (lecture publiée, sans effet de bord) */
export async function holidaysOn(deps: AcademicDeps, ctx: RequestContext, institutionId: string, date: string): Promise<Result<repo.Holiday[], AppError>> {
  return listHolidays(deps, ctx, { institutionId, from: date, to: date });
}
