/**
 * Absences en JOURNÉES et jours ouverts d'une inscription sur une période (appel journalier du primaire, spec 005 §14.2).
 *
 * Fournit à la règle `cas_absences` (RuleSet, contrat `rule-contract.md`) ses deux entrées `absences_journees` et
 * `jours_ouverts` sans que `primary_school` ni `results` ne lisent les pointages. Lecture seule (aucun `GET` n'écrit),
 * aucun seuil, aucune conversion en minutes.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, notFound, validation } from "../domain/errors";
import { buildAttendanceDays, EMPTY_DAY_COUNTS, type AttendanceDays, type DaysOptions } from "../domain/days";
import type { IsoDate, Uuid } from "../domain/types";
import { countDailyDays } from "../infrastructure/summaries-repository";
import { inTx, type AttendanceDeps } from "./deps";

/** Plafond d'inscriptions par appel (une classe entière tient largement dessous). */
export const ATTENDANCE_DAYS_MAX_ENROLLMENTS = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AttendanceDaysQuery extends DaysOptions {
  /** Fenêtre explicite ... */
  readonly from?: IsoDate | undefined;
  readonly to?: IsoDate | undefined;
  /** ... ou période de `academic` (ses dates bornent la fenêtre). */
  readonly periodId?: Uuid | undefined;
}

async function resolveWindow(deps: AttendanceDeps, ctx: RequestContext, q: AttendanceDaysQuery): Promise<Result<{ from: IsoDate; to: IsoDate }, AppError>> {
  if (q.periodId) {
    const period = await deps.ports.periods.getPeriod(ctx, q.periodId);
    if (!period) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", q.periodId));
    return ok({ from: period.startsOn, to: period.endsOn });
  }
  if (!q.from || !q.to || !ISO_DATE.test(q.from) || !ISO_DATE.test(q.to)) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Une période (periodId) ou une fenêtre (from, to) est requise.", "from"));
  }
  if (q.to < q.from) return err(validation(AttendanceCode.INVALID_INPUT, "La fin de la fenêtre précède son début.", "to"));
  return ok({ from: q.from, to: q.to });
}

/**
 * Absences en journées et jours ouverts de PLUSIEURS inscriptions (une requête). Une inscription sans appel renvoie des
 * zéros. `openDays` (calendrier de l'établissement, fourni par l'appelant) remplace les jours d'appel tenus.
 */
export async function getAttendanceDaysForEnrollments(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: AttendanceDaysQuery & { enrollmentIds: readonly Uuid[] },
): Promise<Result<AttendanceDays[], AppError>> {
  const ids = [...new Set(input.enrollmentIds)];
  if (ids.length > ATTENDANCE_DAYS_MAX_ENROLLMENTS) {
    return err(validation(AttendanceCode.INVALID_INPUT, `Au plus ${ATTENDANCE_DAYS_MAX_ENROLLMENTS} inscriptions par appel.`, "enrollmentIds"));
  }
  if (input.openDays !== undefined && (!Number.isInteger(input.openDays) || input.openDays < 0)) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Le nombre de jours ouverts est un entier positif ou nul.", "openDays"));
  }
  const window = await resolveWindow(deps, ctx, input);
  if (!window.ok) return window;
  if (ids.length === 0) return ok([]);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const counts = await countDailyDays(tx, ids, window.value.from, window.value.to);
      return ok(ids.map((id) => buildAttendanceDays(id, window.value, counts.get(id) ?? EMPTY_DAY_COUNTS, input)));
    },
    { readOnly: true },
  );
}

/** Absences en journées et jours ouverts d'UNE inscription : `ruleInputs` = `{ absences_journees, jours_ouverts }` de `cas_absences`. */
export async function getAttendanceDays(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: AttendanceDaysQuery & { enrollmentId: Uuid },
): Promise<Result<AttendanceDays, AppError>> {
  const r = await getAttendanceDaysForEnrollments(deps, ctx, { ...input, enrollmentIds: [input.enrollmentId] });
  if (!r.ok) return r;
  const first = r.value[0];
  return first ? ok(first) : err(notFound(AttendanceCode.INVALID_INPUT, "Inscription", input.enrollmentId));
}
