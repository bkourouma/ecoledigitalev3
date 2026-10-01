/**
 * Calendrier académique : années, périodes typées, plans de périodes, cycle des périodes, clôture en deux temps
 * (notes puis résultats) et clôture PAR CLASSE.
 *
 * Aucune périodicité n'est codée : les types et les plans de périodes sont des lignes de données (modèle de pack).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AcademicClassroomPeriodStatus,
  AcademicCreatePeriodBody,
  AcademicCreateYearBody,
  AcademicPeriodStatus,
  AcademicYearStatus,
} from "@ecoledigitale/contracts/src/v2/academic";
import {
  alignClassroomStates,
  allocatePeriodPlan,
  canTransitionYear,
  checkPeriodPlacement,
  checkYearPlacement,
  effectivePeriodState,
  periodCodeFor,
  periodDatesEditable,
  periodStateRank,
  periodStep,
  resolvePeriodForDate as resolvePeriod,
  yearCloseBlockers,
} from "../domain/calendar";
import { defaultYearEnd } from "../domain/dates";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import type { AcademicPeriod, AcademicYear, Classroom } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as classrooms from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, actorId, assertInstitutionScope, inReadTx, inScope, inTx, type AcademicDeps } from "./deps";

// ---------------------------------------------------------------------------
// Chargement dans le périmètre (404 hors périmètre : on ne révèle pas l'existence)
// ---------------------------------------------------------------------------

export async function loadYear(tx: Tx, ctx: RequestContext, id: string, forUpdate = false): Promise<Result<AcademicYear, AppError>> {
  const year = await cal.getYear(tx, id, { forUpdate });
  if (!year || !inScope(ctx, year)) return err(notFound(AcademicCode.YEAR_NOT_FOUND, "Année académique", id));
  return ok(year);
}

async function loadPeriodInScope(tx: Tx, ctx: RequestContext, id: string, forUpdate = false): Promise<Result<{ period: AcademicPeriod; year: AcademicYear }, AppError>> {
  const period = await cal.getPeriod(tx, id, { forUpdate });
  if (!period) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", id));
  const year = await cal.getYear(tx, period.academicYearId);
  if (!year || !inScope(ctx, year)) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", id));
  return ok({ period, year });
}

export async function loadClassroomInScope(tx: Tx, ctx: RequestContext, id: string): Promise<Result<Classroom, AppError>> {
  const c = await classrooms.getClassroom(tx, id);
  if (!c || !inScope(ctx, c)) return err(notFound(AcademicCode.CLASSROOM_NOT_FOUND, "Classe", id));
  return ok(c);
}

function yearPayload(y: AcademicYear): { v: 1; institutionId: string; academicYearId: string; yearId: string; code: string; status: AcademicYearStatus } {
  return { v: 1, institutionId: y.institutionId, academicYearId: y.id, yearId: y.id, code: y.code, status: y.status };
}

function periodPayload(y: AcademicYear, p: AcademicPeriod, previous: AcademicPeriodStatus | null, reason: string | null): Record<string, unknown> & { v: 1 } {
  return {
    v: 1,
    institutionId: y.institutionId,
    academicYearId: y.id,
    periodId: p.id,
    periodTypeCode: p.periodTypeCode,
    ordinal: p.ordinal,
    status: p.status,
    previousStatus: previous,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Années
// ---------------------------------------------------------------------------

export async function listAcademicYears(deps: AcademicDeps, ctx: RequestContext, filter: { institutionId?: string | null; status?: AcademicYearStatus | null } = {}): Promise<Result<AcademicYear[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await cal.listYears(tx, { institutionId: filter.institutionId ?? ctx.institutionId ?? null, status: filter.status ?? null })));
}

export async function getAcademicYear(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<AcademicYear, AppError>> {
  return inReadTx(deps, ctx, (tx) => loadYear(tx, ctx, id));
}

export async function getCurrentAcademicYear(deps: AcademicDeps, ctx: RequestContext, institutionId?: string | null): Promise<Result<AcademicYear, AppError>> {
  const inst = institutionId ?? ctx.institutionId ?? null;
  if (!inst) return err(validation(AcademicCode.INVALID_INPUT, "L'établissement est requis.", "institutionId"));
  const scope = assertInstitutionScope(ctx, inst);
  if (!scope.ok) return scope;
  return inReadTx(deps, ctx, async (tx) => {
    const y = await cal.getCurrentYear(tx, inst);
    return y ? ok(y) : err(notFound(AcademicCode.YEAR_NOT_FOUND, "Année courante", inst));
  });
}

export async function findYearGaps(deps: AcademicDeps, ctx: RequestContext) {
  return inReadTx(deps, ctx, async (tx) => ok((await cal.findYearGaps(tx)).filter((g) => !ctx.institutionId || g.institutionId === ctx.institutionId)));
}

export async function createAcademicYear(deps: AcademicDeps, ctx: RequestContext, input: AcademicCreateYearBody): Promise<Result<AcademicYear, AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  const info = await deps.ports.institutions.getInstitution(ctx, input.institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", input.institutionId));
  const endsOn = input.endsOn ?? defaultYearEnd(input.startsOn);
  if (endsOn <= input.startsOn) return err(validation(AcademicCode.YEAR_DATES_INVALID, "La fin de l'année doit suivre son début.", "endsOn"));

  return inTx(deps, ctx, async (tx) => {
    const placement = checkYearPlacement({ startsOn: input.startsOn, endsOn }, await cal.listYearRanges(tx, input.institutionId));
    if (!placement.ok) {
      return err(
        placement.code === "overlap"
          ? conflict(AcademicCode.YEAR_OVERLAP, "L'année chevauche une autre année de l'établissement.", { withYearId: placement.withId })
          : conflict(AcademicCode.YEAR_GAP, `L'année laisse un trou de ${placement.gapDays} jour(s) avec l'année ${placement.side === "previous" ? "précédente" : "suivante"}.`, {
              withYearId: placement.withId,
              gapDays: placement.gapDays,
            }),
      );
    }
    const year = await cal.insertYear(tx, { id: deps.newId(), institutionId: input.institutionId, code: input.code, label: input.label, startsOn: input.startsOn, endsOn });
    return ok(year);
  });
}

export async function updateAcademicYear(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string | undefined; startsOn?: string | undefined; endsOn?: string | undefined },
): Promise<Result<AcademicYear, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadYear(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const year = loaded.value;
    if (year.status !== "DRAFT" && year.status !== "OPEN") return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "Seule une année brouillon ou ouverte est modifiable."));
    const startsOn = patch.startsOn ?? year.startsOn;
    const endsOn = patch.endsOn ?? year.endsOn;
    if (endsOn <= startsOn) return err(validation(AcademicCode.YEAR_DATES_INVALID, "La fin de l'année doit suivre son début.", "endsOn"));
    if (startsOn !== year.startsOn || endsOn !== year.endsOn) {
      const periods = await cal.listPeriods(tx, id);
      if (periods.some((p) => p.status === "GRADING_CLOSED" || p.status === "CLOSED")) {
        return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "Les dates d'une année ne changent plus dès qu'une période est close."));
      }
      if (periods.some((p) => p.startsOn < startsOn || p.endsOn > endsOn)) {
        return err(validation(AcademicCode.PERIOD_OUTSIDE_YEAR, "Une période de l'année sortirait des nouvelles dates.", "startsOn"));
      }
      const placement = checkYearPlacement({ startsOn, endsOn }, await cal.listYearRanges(tx, year.institutionId), year.id);
      if (!placement.ok) {
        return err(
          placement.code === "overlap"
            ? conflict(AcademicCode.YEAR_OVERLAP, "L'année chevaucherait une autre année.", { withYearId: placement.withId })
            : conflict(AcademicCode.YEAR_GAP, `L'année laisserait un trou de ${placement.gapDays} jour(s).`, { withYearId: placement.withId, gapDays: placement.gapDays }),
        );
      }
    }
    const fields: { label?: string; startsOn?: string; endsOn?: string } = {};
    if (patch.label !== undefined) fields.label = patch.label;
    if (patch.startsOn !== undefined) fields.startsOn = patch.startsOn;
    if (patch.endsOn !== undefined) fields.endsOn = patch.endsOn;
    return ok(await cal.updateYearFields(tx, id, fields));
  });
}

async function transitionYear(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  to: AcademicYearStatus,
  event: string,
  before?: (tx: Tx, year: AcademicYear, events: EventBuffer) => Promise<Result<void, AppError>>,
  sensitive = false,
  reason: string | null = null,
): Promise<Result<AcademicYear, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadYear(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const year = loaded.value;
    if (!canTransitionYear(year.status, to)) {
      return err(conflict(AcademicCode.YEAR_TRANSITION, `Transition interdite pour l'année : ${year.status} -> ${to}.`, { from: year.status, to }));
    }
    const events = new EventBuffer(deps, ctx);
    if (before) {
      const r = await before(tx, year, events);
      if (!r.ok) return r;
    }
    const updated = await cal.setYearStatus(tx, id, to);
    events.add(event, yearPayload(updated), { type: "academic_year", id });
    if (sensitive) events.audit({ action: `academic.year.${to.toLowerCase()}`, resourceType: "academic_year", resourceId: id, sensitive: true, before: { status: year.status }, after: { status: to }, reason });
    await events.flush(tx);
    return ok(updated);
  });
}

export const openAcademicYear = (deps: AcademicDeps, ctx: RequestContext, id: string) => transitionYear(deps, ctx, id, "OPEN", AcademicEvents.YEAR_OPENED);
export const archiveAcademicYear = (deps: AcademicDeps, ctx: RequestContext, id: string) => transitionYear(deps, ctx, id, "ARCHIVED", AcademicEvents.YEAR_ARCHIVED);

/**
 * Clôture d'une année (US7 / AC7.4, R5) : toutes ses périodes `CLOSED`, aucune offre ouverte ; les curriculums
 * `PUBLISHED` sont verrouillés (`LOCKED`). Opération sensible : auditée.
 */
export async function closeAcademicYear(deps: AcademicDeps, ctx: RequestContext, id: string, reason?: string | null): Promise<Result<AcademicYear, AppError>> {
  return transitionYear(
    deps,
    ctx,
    id,
    "CLOSED",
    AcademicEvents.YEAR_CLOSED,
    async (tx, year, events) => {
      const blockers = yearCloseBlockers({ periods: await cal.listPeriods(tx, year.id), liveOfferings: await cal.countLiveOfferingsOfYear(tx, year.id) });
      if (blockers.length > 0) return err(conflict(AcademicCode.YEAR_CLOSE_BLOCKED, `L'année ne peut pas être clôturée : ${blockers.join(" ")}`, { blockers }));
      for (const v of await cur.listPublishedVersionsOfYear(tx, year.id)) {
        await cur.setVersionStatus(tx, v.id, "LOCKED", actorId(ctx));
        events.add(
          AcademicEvents.CURRICULUM_LOCKED,
          { v: 1, institutionId: year.institutionId, academicYearId: year.id, versionId: v.id, programId: v.programId, status: "LOCKED" },
          { type: "curriculum_version", id: v.id },
        );
      }
      return ok(undefined);
    },
    true,
    reason ?? null,
  );
}

/** Bascule atomique de l'année courante (une seule par établissement). */
export async function setCurrentAcademicYear(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<AcademicYear, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadYear(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    if (loaded.value.status !== "OPEN") return err(conflict(AcademicCode.YEAR_NOT_OPEN, "Seule une année ouverte peut être l'année courante."));
    return ok(await cal.switchCurrentYear(tx, loaded.value.institutionId, id));
  });
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export async function listAcademicPeriods(deps: AcademicDeps, ctx: RequestContext, yearId: string): Promise<Result<AcademicPeriod[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const year = await loadYear(tx, ctx, yearId);
    if (!year.ok) return year;
    return ok(await cal.listPeriods(tx, yearId));
  });
}

export async function getAcademicPeriod(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<AcademicPeriod, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadPeriodInScope(tx, ctx, id);
    return l.ok ? ok(l.value.period) : l;
  });
}

const PLACEMENT_MESSAGES: Record<string, [string, string]> = {
  dates_invalid: [AcademicCode.YEAR_DATES_INVALID, "La fin de la période précède son début."],
  outside_year: [AcademicCode.PERIOD_OUTSIDE_YEAR, "La période dépasse son année."],
  outside_parent: [AcademicCode.PERIOD_OUTSIDE_PARENT, "La période dépasse sa période parente."],
  parent_other_year: [AcademicCode.PERIOD_PARENT_OTHER_YEAR, "Le parent appartient à une autre année."],
  too_deep: [AcademicCode.PERIOD_TOO_DEEP, "Les périodes forment au plus trois niveaux."],
  overlap: [AcademicCode.PERIOD_OVERLAP, "La période chevauche une période sœur de même type."],
  ordinal_taken: [AcademicCode.PERIOD_OVERLAP, "Ce numéro d'ordre est déjà pris parmi les périodes sœurs de même type."],
  code_taken: [AcademicCode.PERIOD_CODE_TAKEN, "Ce code de période existe déjà dans l'année."],
};

function placementError(problem: string): AppError {
  const [code, message] = PLACEMENT_MESSAGES[problem] as [string, string];
  return problem === "overlap" || problem === "ordinal_taken" || problem === "code_taken" ? conflict(code, message) : validation(code, message);
}

async function parentDepth(tx: Tx, parent: AcademicPeriod | null): Promise<number> {
  let depth = 0;
  let cursor = parent;
  while (cursor?.parentPeriodId) {
    depth += 1;
    cursor = await cal.getPeriod(tx, cursor.parentPeriodId);
    if (depth > 4) break;
  }
  return depth;
}

async function checkPlacement(tx: Tx, year: AcademicYear, input: AcademicCreatePeriodBody & { parentPeriodId?: string | null }, ignoreId?: string): Promise<Result<AcademicPeriod | null, AppError>> {
  const parent = input.parentPeriodId ? await cal.getPeriod(tx, input.parentPeriodId) : null;
  if (input.parentPeriodId && !parent) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période parente", input.parentPeriodId));
  const siblings = await cal.listPeriods(tx, year.id);
  const problem = checkPeriodPlacement({
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    periodTypeCode: input.periodTypeCode,
    ordinal: input.ordinal,
    code: input.code,
    year,
    parent,
    parentDepth: await parentDepth(tx, parent),
    siblings,
    yearCodes: siblings.map((p) => ({ id: p.id, code: p.code })),
    ...(ignoreId ? { ignoreId } : {}),
  });
  return problem ? err(placementError(problem)) : ok(parent);
}

export async function createPeriod(deps: AcademicDeps, ctx: RequestContext, yearId: string, input: AcademicCreatePeriodBody): Promise<Result<AcademicPeriod, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadYear(tx, ctx, yearId, true);
    if (!loaded.ok) return loaded;
    const year = loaded.value;
    if (year.status === "CLOSED" || year.status === "ARCHIVED") return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "L'année est close : on n'y ajoute plus de période."));
    const types = await ref.listPeriodTypes(tx);
    const type = types.find((t) => t.code === input.periodTypeCode);
    if (!type || !type.active) return err(validation(AcademicCode.PERIOD_TYPE_UNKNOWN, `Type de période inconnu ou inactif : ${input.periodTypeCode}.`, "periodTypeCode"));
    const placed = await checkPlacement(tx, year, input);
    if (!placed.ok) return placed;
    const period = await cal.insertPeriod(tx, {
      id: deps.newId(),
      academicYearId: yearId,
      parentPeriodId: input.parentPeriodId ?? null,
      periodTypeCode: input.periodTypeCode,
      ordinal: input.ordinal,
      code: input.code,
      label: input.label,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    });
    return ok(period);
  });
}

/**
 * Applique un plan de périodes (ex. `THREE_TERMS`) : crée les périodes de premier niveau qui couvrent EXACTEMENT
 * l'année, sans trou ni chevauchement. Les dates restent modifiables tant que la période est `PLANNED` ou `OPEN`.
 */
export async function applyPeriodPlan(deps: AcademicDeps, ctx: RequestContext, yearId: string, planCode: string): Promise<Result<AcademicPeriod[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadYear(tx, ctx, yearId, true);
    if (!loaded.ok) return loaded;
    const year = loaded.value;
    if (year.status === "CLOSED" || year.status === "ARCHIVED") return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "L'année est close."));
    const plan = (await ref.listPeriodPlans(tx)).find((p) => p.code === planCode && p.active);
    if (!plan) return err(notFound(AcademicCode.PERIOD_PLAN_UNKNOWN, "Plan de périodes", planCode));
    const types = new Set((await ref.listPeriodTypes(tx)).filter((t) => t.active).map((t) => t.code));
    for (const slot of plan.slots) {
      if (!types.has(slot.type)) return err(validation(AcademicCode.PERIOD_TYPE_UNKNOWN, `Le plan utilise un type de période inconnu ou inactif : ${slot.type}.`, "planCode"));
    }
    const existing = await cal.listPeriods(tx, yearId);
    if (existing.some((p) => p.parentPeriodId === null && plan.slots.some((s) => s.type === p.periodTypeCode))) {
      return err(conflict(AcademicCode.PERIOD_PLAN_CONFLICT, "L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan."));
    }
    const allocation = allocatePeriodPlan(year.startsOn, year.endsOn, plan.slots);
    if (!allocation.ok) return err(validation(AcademicCode.INVALID_INPUT, allocation.reason, "planCode"));
    const created: AcademicPeriod[] = [];
    for (const a of allocation.periods) {
      created.push(
        await cal.insertPeriod(tx, {
          id: deps.newId(),
          academicYearId: yearId,
          parentPeriodId: null,
          periodTypeCode: a.type,
          ordinal: a.ordinal,
          code: periodCodeFor(a.type, a.ordinal),
          label: a.label,
          startsOn: a.startsOn,
          endsOn: a.endsOn,
        }),
      );
    }
    return ok(created);
  });
}

export async function updatePeriod(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string | undefined; startsOn?: string | undefined; endsOn?: string | undefined },
): Promise<Result<AcademicPeriod, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadPeriodInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { period, year } = loaded.value;
    const datesChange = (patch.startsOn !== undefined && patch.startsOn !== period.startsOn) || (patch.endsOn !== undefined && patch.endsOn !== period.endsOn);
    if (datesChange && !periodDatesEditable(period.status)) return err(conflict(AcademicCode.PERIOD_CLOSED_DATES, "Les dates d'une période close sont figées."));
    if (datesChange) {
      const startsOn = patch.startsOn ?? period.startsOn;
      const endsOn = patch.endsOn ?? period.endsOn;
      const placed = await checkPlacement(
        tx,
        year,
        { periodTypeCode: period.periodTypeCode, ordinal: period.ordinal, code: period.code, label: period.label, startsOn, endsOn, parentPeriodId: period.parentPeriodId },
        period.id,
      );
      if (!placed.ok) return placed;
      const children = (await cal.listPeriods(tx, year.id)).filter((p) => p.parentPeriodId === period.id);
      if (children.some((c) => c.startsOn < startsOn || c.endsOn > endsOn)) {
        return err(validation(AcademicCode.PERIOD_OUTSIDE_PARENT, "Une sous-période sortirait des nouvelles dates.", "startsOn"));
      }
    }
    const fields: { label?: string; startsOn?: string; endsOn?: string } = {};
    if (patch.label !== undefined) fields.label = patch.label;
    if (patch.startsOn !== undefined) fields.startsOn = patch.startsOn;
    if (patch.endsOn !== undefined) fields.endsOn = patch.endsOn;
    return ok(await cal.updatePeriodFields(tx, id, fields));
  });
}

export async function deletePeriod(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<void, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadPeriodInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { period, year } = loaded.value;
    if (period.status !== "PLANNED") return err(conflict(AcademicCode.PERIOD_DELETE_FORBIDDEN, `La période est ${period.status} : elle ne peut plus être supprimée.`));
    if ((await cal.listPeriods(tx, year.id)).some((p) => p.parentPeriodId === period.id)) {
      return err(conflict(AcademicCode.PERIOD_DELETE_FORBIDDEN, "La période a des sous-périodes : supprimez-les d'abord."));
    }
    await cal.deletePeriod(tx, id);
    return ok(undefined);
  });
}

/**
 * Période contenant une date (AC1.5) : avec un type, exactement 0 ou 1 ; sans type, la plus profonde ; ambiguë =>
 * erreur demandant de préciser le type.
 */
export async function resolvePeriodForDate(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { institutionId?: string | null; date: string; typeCode?: string | null },
): Promise<Result<AcademicPeriod | null, AppError>> {
  const inst = input.institutionId ?? ctx.institutionId ?? null;
  if (!inst) return err(validation(AcademicCode.INVALID_INPUT, "L'établissement est requis.", "institutionId"));
  const scope = assertInstitutionScope(ctx, inst);
  if (!scope.ok) return scope;
  return inReadTx(deps, ctx, async (tx) => {
    const years = (await cal.listYears(tx, { institutionId: inst })).filter((y) => y.startsOn <= input.date && input.date <= y.endsOn);
    const year = years[0];
    if (!year) return ok(null);
    const periods = await cal.listPeriods(tx, year.id);
    const r = resolvePeriod(periods, input.date, input.typeCode ?? undefined);
    if (r.kind === "none") return ok(null);
    if (r.kind === "ambiguous") return err(conflict(AcademicCode.PERIOD_AMBIGUOUS, "Plusieurs périodes de même profondeur contiennent cette date : précisez le type.", { candidates: r.candidates.map((p) => p.periodTypeCode) }));
    return ok(r.period);
  });
}

// ---------------------------------------------------------------------------
// Cycle des périodes : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED (retour d'un pas : motivé, sensible)
// ---------------------------------------------------------------------------

async function runPeriodGuard(deps: AcademicDeps, ctx: RequestContext, periodId: string, classroomId: string | null, to: "GRADING_CLOSED" | "CLOSED"): Promise<Result<void, AppError>> {
  const verdict = await deps.ports.periodGuard.canClose(ctx, { periodId, classroomId, to });
  return verdict.ok ? ok(undefined) : err(conflict(AcademicCode.PERIOD_CLOSE_REFUSED, verdict.error.reason, { guardCode: verdict.error.code }));
}

export async function openPeriod(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<AcademicPeriod, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadPeriodInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { period, year } = loaded.value;
    if (period.status !== "PLANNED") return err(conflict(AcademicCode.PERIOD_TRANSITION, `La période est ${period.status} : seule une période planifiée s'ouvre.`, { from: period.status, to: "OPEN" }));
    if (year.status !== "OPEN") return err(conflict(AcademicCode.YEAR_NOT_OPEN, "Ouvrez l'année avant d'ouvrir ses périodes."));
    const updated = await cal.setPeriodState(tx, id, { status: "OPEN", openedAt: "now" });
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.PERIOD_OPENED, periodPayload(year, updated, period.status, null), { type: "academic_period", id });
    await events.flush(tx);
    return ok(updated);
  });
}

async function closePeriodTo(deps: AcademicDeps, ctx: RequestContext, id: string, to: "GRADING_CLOSED" | "CLOSED"): Promise<Result<AcademicPeriod, AppError>> {
  const from: AcademicPeriodStatus = to === "GRADING_CLOSED" ? "OPEN" : "GRADING_CLOSED";
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadPeriodInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { period, year } = loaded.value;
    if (period.status !== from) {
      return err(conflict(AcademicCode.PERIOD_TRANSITION, `La période est ${period.status} : ${to === "GRADING_CLOSED" ? "seule une période ouverte" : "seule une période aux notes closes"} peut être clôturée.`, { from: period.status, to }));
    }
    const guard = await runPeriodGuard(deps, ctx, id, null, to);
    if (!guard.ok) return guard;
    const updated = await cal.setPeriodState(
      tx,
      id,
      to === "GRADING_CLOSED" ? { status: to, gradingClosedAt: "now" } : { status: to, closedAt: "now", closedBy: actorId(ctx) },
    );
    // Clore la période entière aligne en UNE opération les états explicites des classes (pas à pas, légalement).
    const explicit = await cal.listClassroomStates(tx, id);
    for (const a of alignClassroomStates(to, explicit, "close")) {
      for (const status of a.steps) {
        await cal.upsertClassroomState(tx, { classroomId: a.classroomId, periodId: id, status, changedBy: actorId(ctx), reason: "period_closed" });
      }
    }
    const events = new EventBuffer(deps, ctx);
    events.add(to === "GRADING_CLOSED" ? AcademicEvents.PERIOD_GRADING_CLOSED : AcademicEvents.PERIOD_CLOSED, periodPayload(year, updated, period.status, null), { type: "academic_period", id });
    await events.flush(tx);
    return ok(updated);
  });
}

export const closePeriodGrading = (deps: AcademicDeps, ctx: RequestContext, id: string) => closePeriodTo(deps, ctx, id, "GRADING_CLOSED");
export const closePeriod = (deps: AcademicDeps, ctx: RequestContext, id: string) => closePeriodTo(deps, ctx, id, "CLOSED");

/** Réouverture d'un pas en arrière : motif obligatoire, opération SENSIBLE (audit) ; `reopened_count` s'incrémente. */
export async function reopenPeriod(deps: AcademicDeps, ctx: RequestContext, id: string, reason: string): Promise<Result<AcademicPeriod, AppError>> {
  const why = reason?.trim() ?? "";
  if (why.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadPeriodInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const { period, year } = loaded.value;
    if (period.status === "PLANNED") return err(conflict(AcademicCode.PERIOD_TRANSITION, "La période n'a pas été ouverte : rien à rouvrir.", { from: period.status }));
    if (year.status === "CLOSED" || year.status === "ARCHIVED") return err(conflict(AcademicCode.YEAR_NOT_OPEN, "L'année est close : ses périodes ne se rouvrent plus."));
    const target = ({ OPEN: "PLANNED", GRADING_CLOSED: "OPEN", CLOSED: "GRADING_CLOSED" } as const)[period.status];
    if (periodStep(period.status, target) !== "backward") return err(conflict(AcademicCode.PERIOD_TRANSITION, "Transition interdite.", { from: period.status, to: target }));
    const updated = await cal.setPeriodState(tx, id, {
      status: target,
      ...(period.status === "CLOSED" ? { closedAt: "clear" as const } : {}),
      ...(period.status === "GRADING_CLOSED" ? { gradingClosedAt: "clear" as const } : {}),
      incrementReopened: true,
    });
    // Les classes dont l'état explicite dépasse le nouvel état sont ramenées avec la période.
    const explicit = await cal.listClassroomStates(tx, id);
    for (const a of alignClassroomStates(target, explicit, "reopen")) {
      for (const status of a.steps) await cal.upsertClassroomState(tx, { classroomId: a.classroomId, periodId: id, status, changedBy: actorId(ctx), reason: why });
    }
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.PERIOD_REOPENED, periodPayload(year, updated, period.status, why), { type: "academic_period", id });
    events.audit({ action: "academic.period.reopened", resourceType: "academic_period", resourceId: id, sensitive: true, before: { status: period.status }, after: { status: target }, reason: why });
    await events.flush(tx);
    return ok(updated);
  });
}

// ---------------------------------------------------------------------------
// Clôture PAR CLASSE (R4) : l'état explicite de la classe surcharge celui de la période
// ---------------------------------------------------------------------------

export interface EffectiveState {
  classroomId: string;
  periodId: string;
  state: AcademicPeriodStatus;
  explicit: boolean;
}

export async function getEffectivePeriodState(deps: AcademicDeps, ctx: RequestContext, input: { classroomId: string; periodId: string }): Promise<Result<EffectiveState, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, input.classroomId);
    if (!c.ok) return c;
    const p = await loadPeriodInScope(tx, ctx, input.periodId);
    if (!p.ok) return p;
    const eff = await cal.effectiveState(tx, input.classroomId, input.periodId);
    if (!eff) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", input.periodId));
    return ok({ classroomId: input.classroomId, periodId: input.periodId, state: eff.state, explicit: eff.explicit });
  });
}

type ClassroomAction = "close-grading" | "close" | "reopen";

async function classroomPeriodAction(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { classroomId: string; periodId: string; action: ClassroomAction; reason?: string | null },
): Promise<Result<EffectiveState, AppError>> {
  const why = input.reason?.trim() ?? "";
  if (input.action === "reopen" && why.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx<EffectiveState>(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, input.classroomId);
    if (!c.ok) return c;
    const classroom = c.value;
    const p = await loadPeriodInScope(tx, ctx, input.periodId, true);
    if (!p.ok) return p;
    const { period, year } = p.value;
    if (period.academicYearId !== classroom.academicYearId) {
      return err(validation(AcademicCode.CLASSROOM_PERIOD_OTHER_YEAR, "La période n'appartient pas à l'année de la classe.", "periodId"));
    }
    // Une classe annulée est ignorée (aucune clôture à poser).
    if (classroom.status === "CANCELLED") return ok({ classroomId: classroom.id, periodId: period.id, state: period.status, explicit: false });
    const eff = (await cal.effectiveState(tx, classroom.id, period.id)) ?? { state: period.status, explicit: false };
    const current = effectivePeriodState(period.status, eff.explicit ? (eff.state as AcademicClassroomPeriodStatus) : null);
    if (current === "PLANNED") return err(conflict(AcademicCode.PERIOD_NOT_OPEN, "La période n'est pas encore ouverte.", { state: current }));

    let target: AcademicClassroomPeriodStatus;
    if (input.action === "close-grading") {
      if (current !== "OPEN") return err(conflict(AcademicCode.CLASSROOM_PERIOD_TRANSITION, `La période est ${current} pour cette classe : seule une période ouverte voit ses notes closes.`, { from: current }));
      target = "GRADING_CLOSED";
    } else if (input.action === "close") {
      if (current !== "GRADING_CLOSED") return err(conflict(AcademicCode.CLASSROOM_PERIOD_TRANSITION, `La période est ${current} pour cette classe : clôturez d'abord les notes.`, { from: current }));
      target = "CLOSED";
    } else {
      if (periodStateRank(current) <= periodStateRank("OPEN")) return err(conflict(AcademicCode.CLASSROOM_PERIOD_TRANSITION, "La période est déjà ouverte pour cette classe.", { from: current }));
      target = current === "CLOSED" ? "GRADING_CLOSED" : "OPEN";
    }
    if (input.action !== "reopen") {
      const guard = await runPeriodGuard(deps, ctx, period.id, classroom.id, target as "GRADING_CLOSED" | "CLOSED");
      if (!guard.ok) return guard;
    }
    await cal.upsertClassroomState(tx, { classroomId: classroom.id, periodId: period.id, status: target, changedBy: actorId(ctx), reason: input.action === "reopen" ? why : null });

    const events = new EventBuffer(deps, ctx);
    const type = input.action === "close-grading" ? AcademicEvents.CLASSROOM_PERIOD_GRADING_CLOSED : input.action === "close" ? AcademicEvents.CLASSROOM_PERIOD_CLOSED : AcademicEvents.CLASSROOM_PERIOD_REOPENED;
    events.add(
      type,
      { ...periodPayload(year, { ...period, status: target }, current, input.action === "reopen" ? why : null), classroomId: classroom.id },
      { type: "classroom_period", id: `${classroom.id}:${period.id}` },
    );
    if (input.action === "reopen") {
      events.audit({ action: "academic.classroom_period.reopened", resourceType: "classroom_period", resourceId: `${classroom.id}:${period.id}`, sensitive: true, before: { state: current }, after: { state: target }, reason: why });
    }
    await events.flush(tx);
    return ok({ classroomId: classroom.id, periodId: period.id, state: target, explicit: true });
  });
}

export const closeClassroomPeriodGrading = (deps: AcademicDeps, ctx: RequestContext, classroomId: string, periodId: string) => classroomPeriodAction(deps, ctx, { classroomId, periodId, action: "close-grading" });
export const closeClassroomPeriod = (deps: AcademicDeps, ctx: RequestContext, classroomId: string, periodId: string) => classroomPeriodAction(deps, ctx, { classroomId, periodId, action: "close" });
export const reopenClassroomPeriod = (deps: AcademicDeps, ctx: RequestContext, classroomId: string, periodId: string, reason: string) => classroomPeriodAction(deps, ctx, { classroomId, periodId, action: "reopen", reason });
