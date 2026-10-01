/**
 * FeeSchedule : barème d'un frais pour un périmètre donné, avec dates d'effet.
 *
 * Périmètre = (établissement, campus, niveau, filière, type d'apprenant) + année.
 * Une dimension `null` signifie « toutes valeurs ». Pour un apprenant donné, le
 * barème retenu est le plus SPÉCIFIQUE parmi ceux qui s'appliquent ; à
 * spécificité égale, celui dont la date d'effet est la plus récente ; si deux
 * barèmes restent indiscernables, l'ambiguïté est une ERREUR (on ne devine pas
 * un montant).
 *
 * Priorité des dimensions (puissances de 2 → deux ensembles de dimensions
 * différents n'ont jamais le même score) :
 *   filière 32 > niveau 16 > campus 8 > type d'apprenant 4 > établissement 2.
 */
import { err, ok, type AppError, type Money, type Result } from "@ecoledigitale/kernel";
import { compareDates, assertIsoDate } from "./dates";
import { FinanceCode, conflict, validation } from "./errors";
import type { IsoDate, Uuid } from "./types";

export interface FeeScope {
  institutionId: Uuid | null;
  campusId: Uuid | null;
  /** Clé libre du niveau (ex. `6EME`, `L1`) — propriété du futur cœur académique. */
  levelKey: string | null;
  /** Clé libre de la filière / série (ex. `BTS-GRH`). */
  trackKey: string | null;
  /** Type d'apprenant (ex. `INTERNAL`, `EXTERNAL`) — clé libre. */
  learnerType: string | null;
}

export interface FeeSchedule {
  readonly id: Uuid;
  readonly feeId: Uuid;
  readonly academicYear: string;
  readonly scope: FeeScope;
  readonly amount: Money;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  /** Plan d'échéancier proposé par défaut pour ce barème. */
  readonly planId: Uuid | null;
  readonly active: boolean;
}

export interface FeeQuery {
  feeId: Uuid;
  academicYear: string;
  onDate: IsoDate;
  institutionId?: Uuid | null;
  campusId?: Uuid | null;
  levelKey?: string | null;
  trackKey?: string | null;
  learnerType?: string | null;
}

export const EMPTY_SCOPE: FeeScope = Object.freeze({
  institutionId: null,
  campusId: null,
  levelKey: null,
  trackKey: null,
  learnerType: null,
});

const WEIGHTS = { trackKey: 32, levelKey: 16, campusId: 8, learnerType: 4, institutionId: 2 } as const;
type Dimension = keyof typeof WEIGHTS;
const DIMENSIONS = Object.keys(WEIGHTS) as Dimension[];

const norm = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

export function scopeSpecificity(scope: FeeScope): number {
  return DIMENSIONS.reduce((acc, d) => acc + (norm(scope[d]) !== null ? WEIGHTS[d] : 0), 0);
}

export function isEffectiveOn(schedule: Pick<FeeSchedule, "effectiveFrom" | "effectiveTo">, date: IsoDate): boolean {
  if (compareDates(date, schedule.effectiveFrom) < 0) return false;
  return schedule.effectiveTo === null || compareDates(date, schedule.effectiveTo) <= 0;
}

/** Le barème s'applique-t-il à la requête (année, date d'effet, chaque dimension renseignée) ? */
export function scheduleMatches(schedule: FeeSchedule, query: FeeQuery): boolean {
  if (!schedule.active) return false;
  if (schedule.feeId !== query.feeId) return false;
  if (schedule.academicYear !== query.academicYear) return false;
  if (!isEffectiveOn(schedule, query.onDate)) return false;
  for (const d of DIMENSIONS) {
    const wanted = norm(schedule.scope[d]);
    if (wanted === null) continue;
    if (wanted !== norm(query[d])) return false;
  }
  return true;
}

/** Barème retenu, ou erreur explicite (introuvable / ambigu). */
export function resolveFeeSchedule(
  schedules: ReadonlyArray<FeeSchedule>,
  query: FeeQuery,
): Result<FeeSchedule, AppError> {
  assertIsoDate(query.onDate, "onDate");
  const matching = schedules.filter((s) => scheduleMatches(s, query));
  if (matching.length === 0) {
    return err(
      conflict(FinanceCode.SCHEDULE_NOT_FOUND, "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date.", {
        feeId: query.feeId,
        academicYear: query.academicYear,
        onDate: query.onDate,
      }),
    );
  }
  const best = Math.max(...matching.map((s) => scopeSpecificity(s.scope)));
  const top = matching.filter((s) => scopeSpecificity(s.scope) === best);
  const latest = top.reduce((acc, s) => (compareDates(s.effectiveFrom, acc) > 0 ? s.effectiveFrom : acc), top[0]!.effectiveFrom);
  const winners = top.filter((s) => s.effectiveFrom === latest);
  if (winners.length > 1) {
    return err(
      conflict(FinanceCode.SCHEDULE_AMBIGUOUS, "Plusieurs barèmes équivalents s'appliquent : corrigez les dates d'effet.", {
        scheduleIds: winners.map((s) => s.id).sort(),
      }),
    );
  }
  return ok(winners[0]!);
}

const sameScope = (a: FeeScope, b: FeeScope): boolean => DIMENSIONS.every((d) => norm(a[d]) === norm(b[d]));

/** Deux barèmes se chevauchent s'ils visent le même frais, la même année, le même périmètre et des périodes qui s'intersectent. */
export function schedulesOverlap(
  a: Pick<FeeSchedule, "feeId" | "academicYear" | "scope" | "effectiveFrom" | "effectiveTo">,
  b: Pick<FeeSchedule, "feeId" | "academicYear" | "scope" | "effectiveFrom" | "effectiveTo">,
): boolean {
  if (a.feeId !== b.feeId || a.academicYear !== b.academicYear || !sameScope(a.scope, b.scope)) return false;
  const aEndsBeforeBStarts = a.effectiveTo !== null && compareDates(a.effectiveTo, b.effectiveFrom) < 0;
  const bEndsBeforeAStarts = b.effectiveTo !== null && compareDates(b.effectiveTo, a.effectiveFrom) < 0;
  return !aEndsBeforeBStarts && !bEndsBeforeAStarts;
}

export interface FeeScheduleDraft {
  feeId: Uuid;
  academicYear: string;
  scope?: Partial<FeeScope>;
  amount: Money;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null;
  planId?: Uuid | null;
}

/** Valide un nouveau barème contre les barèmes existants du même frais. */
export function validateFeeScheduleDraft(
  draft: FeeScheduleDraft,
  existing: ReadonlyArray<FeeSchedule>,
): Result<Omit<FeeSchedule, "id" | "active">, AppError> {
  const academicYear = draft.academicYear?.trim();
  if (!academicYear || academicYear.length > 20) {
    return err(validation(FinanceCode.INVALID_INPUT, "Année scolaire requise (ex. 2025-2026).", "academicYear"));
  }
  assertIsoDate(draft.effectiveFrom, "effectiveFrom");
  const effectiveTo = draft.effectiveTo ?? null;
  if (effectiveTo !== null) {
    assertIsoDate(effectiveTo, "effectiveTo");
    if (compareDates(effectiveTo, draft.effectiveFrom) < 0) {
      return err(validation(FinanceCode.INVALID_INPUT, "La date de fin d'effet précède la date de début.", "effectiveTo"));
    }
  }
  if (draft.amount.isNegative()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant d'un barème ne peut pas être négatif.", "amount"));
  }
  const scope: FeeScope = {
    institutionId: norm(draft.scope?.institutionId) ,
    campusId: norm(draft.scope?.campusId),
    levelKey: norm(draft.scope?.levelKey),
    trackKey: norm(draft.scope?.trackKey),
    learnerType: norm(draft.scope?.learnerType),
  };
  const candidate = {
    feeId: draft.feeId,
    academicYear,
    scope,
    amount: draft.amount,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo,
    planId: draft.planId ?? null,
  };
  const clash = existing.find((s) => s.active && schedulesOverlap(s, candidate));
  if (clash) {
    return err(
      conflict(FinanceCode.SCHEDULE_OVERLAP, "Un barème actif couvre déjà ce périmètre sur cette période.", {
        scheduleId: clash.id,
      }),
    );
  }
  return ok(candidate);
}
