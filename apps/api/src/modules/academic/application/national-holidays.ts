/**
 * Calendrier national des jours fériés préchargé par la plateforme (décision O-10).
 *
 *  - la RÉFÉRENCE est globale (`academic.national_holidays`, lecture seule pour un établissement) : fêtes à date fixe dont
 *    la date calendaire est certaine, fêtes mobiles sans date ; tout est marqué « à confirmer » (`placeholder`) ;
 *  - chaque établissement peut ACTIVER / DÉSACTIVER une fête nationale (`setNationalHolidayEnabled`, permission
 *    `academic.settings.manage`) et AJOUTER ses propres jours (`createHoliday`, calendrier de l'établissement) — c'est là
 *    qu'il saisit aussi les dates des fêtes mobiles ;
 *  - `listEffectiveHolidays` fusionne les deux sur une plage de dates : c'est la lecture que doivent faire l'emploi du temps
 *    et l'appel. Les lectures existantes (`listHolidays`, `holidaysOn`) restent inchangées : elles ne portent QUE les jours
 *    de l'établissement.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AcademicCode, notFound, validation } from "../domain/errors";
import { expandNationalHolidays, mergeHolidays, type EffectiveHoliday, type NationalHoliday } from "../domain/national-holidays";
import * as nat from "../infrastructure/national-holiday-repository";
import * as repo from "../infrastructure/rollover-repository";
import { EventBuffer, assertInstitutionScope, inReadTx, inTx, actorId, type AcademicDeps } from "./deps";

/** Pays des données livrées lorsque l'établissement n'en déclare aucun (le calendrier préchargé est celui de la Côte d'Ivoire). */
export const DEFAULT_HOLIDAY_COUNTRY = "CI";

export interface NationalHolidayView extends NationalHoliday {
  /** Réglage de l'établissement (sans réglage : activé). */
  enabled: boolean;
}

async function countryOf(deps: AcademicDeps, ctx: RequestContext, institutionId: string): Promise<Result<string, AppError>> {
  const info = await deps.ports.institutions.getInstitution(ctx, institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", institutionId));
  return ok(info.countryCode ?? DEFAULT_HOLIDAY_COUNTRY);
}

export async function listNationalHolidays(deps: AcademicDeps, ctx: RequestContext, input: { institutionId: string }): Promise<Result<NationalHolidayView[], AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  const country = await countryOf(deps, ctx, input.institutionId);
  if (!country.ok) return country;
  return inReadTx(deps, ctx, async (tx) => {
    const [all, disabled] = await Promise.all([nat.listNationalHolidays(tx, country.value), nat.listDisabledCodes(tx, input.institutionId)]);
    return ok(all.map((h) => ({ ...h, enabled: !disabled.has(h.code) })));
  });
}

export async function setNationalHolidayEnabled(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { institutionId: string; code: string; enabled: boolean },
): Promise<Result<NationalHolidayView, AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  const country = await countryOf(deps, ctx, input.institutionId);
  if (!country.ok) return country;
  return inTx(deps, ctx, async (tx) => {
    const holiday = await nat.getNationalHoliday(tx, country.value, input.code);
    if (!holiday || !holiday.active) return err(notFound(AcademicCode.NATIONAL_HOLIDAY_NOT_FOUND, "Jour férié national", input.code));
    const before = !(await nat.listDisabledCodes(tx, input.institutionId)).has(input.code);
    await nat.upsertSetting(tx, { id: deps.newId(), institutionId: input.institutionId, code: input.code, enabled: input.enabled, updatedBy: actorId(ctx) });
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "academic.national_holiday.toggled",
      resourceType: "institution_national_holiday_setting",
      resourceId: `${input.institutionId}:${input.code}`,
      before: { enabled: before },
      after: { enabled: input.enabled },
      metadata: { institutionId: input.institutionId, code: input.code },
    });
    await events.flush(tx);
    return ok({ ...holiday, enabled: input.enabled });
  });
}

export interface EffectiveHolidaysQuery {
  institutionId: string;
  from: string;
  to: string;
}

/**
 * Jours fériés EFFECTIFS d'un établissement sur `[from, to]` : fêtes nationales à date fixe non désactivées + jours de
 * l'établissement (fêtes mobiles saisies, vacances, fermetures, jours ajoutés). Plage limitée à 5 ans.
 */
export async function listEffectiveHolidays(deps: AcademicDeps, ctx: RequestContext, q: EffectiveHolidaysQuery): Promise<Result<EffectiveHoliday[], AppError>> {
  const scope = assertInstitutionScope(ctx, q.institutionId);
  if (!scope.ok) return scope;
  if (q.to < q.from) return err(validation(AcademicCode.HOLIDAY_DATES_INVALID, "La fin précède le début.", "to"));
  if (Number(q.to.slice(0, 4)) - Number(q.from.slice(0, 4)) > 5) return err(validation(AcademicCode.HOLIDAY_DATES_INVALID, "Plage limitée à 5 ans.", "to"));
  const country = await countryOf(deps, ctx, q.institutionId);
  if (!country.ok) return country;
  return inReadTx(deps, ctx, async (tx) => {
    const [all, disabled, own] = await Promise.all([
      nat.listNationalHolidays(tx, country.value),
      nat.listDisabledCodes(tx, q.institutionId),
      repo.listHolidays(tx, { institutionId: q.institutionId, from: q.from, to: q.to }),
    ]);
    const national = expandNationalHolidays(all, disabled, { from: q.from, to: q.to });
    const institution: EffectiveHoliday[] = own.map((h) => ({
      origin: "INSTITUTION",
      ref: h.id,
      label: h.label,
      kind: h.kind,
      startsOn: h.startsOn,
      endsOn: h.endsOn,
      blocksTeaching: h.blocksTeaching,
      needsConfirmation: false,
    }));
    return ok(mergeHolidays(national, institution));
  });
}
