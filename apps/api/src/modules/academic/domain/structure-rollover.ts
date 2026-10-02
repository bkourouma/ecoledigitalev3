/**
 * Reconduction annuelle : planificateurs PURS de la STRUCTURE (calendrier, jours fériés, classes, offres) vers l'année
 * suivante. Aucune lecture ni écriture : ils reçoivent des enregistrements et renvoient ce qui serait créé (aperçu) ; la
 * couche application les exécute (idempotente : ce qui existe déjà n'est jamais recréé).
 *
 * Les réinscriptions (issue de fin d'année -> niveau suivant) sont dans `rollover.ts` ; le curriculum se clone par
 * `cloneCurriculumVersion` (lignées conservées). Aucune constante réglementaire : les dates se déduisent des années.
 */
import { addDays, type IsoDate } from "./dates";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: IsoDate): { y: number; m: number; d: number } {
  const m = ISO.exec(date);
  if (!m) throw new RangeError(`Date invalide : ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Reporte une date de `years` années civiles ; le 29 février d'une année non bissextile devient le 28. */
export function shiftYears(date: IsoDate, years: number): IsoDate {
  const { y, m, d } = parts(date);
  const ny = y + years;
  return `${pad(ny, 4)}-${pad(m)}-${pad(Math.min(d, lastDayOfMonth(ny, m)))}`;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * Reporte une date de l'année source vers l'année cible. Quand les deux années commencent le même jour civil (cas
 * courant : 1er septembre -> 1er septembre) la date est décalée d'un nombre ENTIER d'années civiles (la date reste le même
 * jour du calendrier) ; sinon, du nombre de jours qui sépare les deux débuts.
 */
export function shiftDate(date: IsoDate, fromStart: IsoDate, toStart: IsoDate): IsoDate {
  const f = parts(fromStart);
  const t = parts(toStart);
  if (f.m === t.m && f.d === t.d) return shiftYears(date, t.y - f.y);
  return addDays(date, daysBetween(fromStart, toStart));
}

/** Décale un instant ISO (`...Z`) comme `shiftDate` le fait pour la date, en conservant l'heure. */
export function shiftInstant(instant: string, fromStart: IsoDate, toStart: IsoDate): string {
  const day = instant.slice(0, 10);
  return `${shiftDate(day, fromStart, toStart)}${instant.slice(10)}`;
}

const clamp = (date: IsoDate, min: IsoDate, max: IsoDate): IsoDate => (date < min ? min : date > max ? max : date);

interface YearRange {
  startsOn: IsoDate;
  endsOn: IsoDate;
}

// ---------------------------------------------------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------------------------------------------------

export interface SourcePeriod {
  id: string;
  parentPeriodId: string | null;
  periodTypeCode: string;
  ordinal: number;
  code: string;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
}

export interface PlannedPeriod {
  code: string;
  parentCode: string | null;
  periodTypeCode: string;
  ordinal: number;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** Les dates ont dû être ramenées dans l'année (ou dans la période parente). */
  clamped: boolean;
}

export interface PeriodsPlan {
  toCreate: PlannedPeriod[];
  /** Périodes déjà présentes dans l'année cible (même code, ou même type / numéro / parent). */
  existing: number;
  /** Périodes dont la durée tombe hors de l'année cible : ignorées. */
  dropped: PlannedPeriod[];
}

/**
 * Périodes de l'année cible : mêmes types, numéros, codes et libellés ; dates reportées (voir `shiftDate`) puis bornées à
 * l'année cible (et à la période parente). Les parents sont créés avant leurs enfants. Une période déjà présente (même code,
 * ou même type / numéro sous le même parent) est comptée, jamais recréée : la reconduction est rejouable.
 */
export function planPeriods(
  source: readonly SourcePeriod[],
  from: YearRange,
  to: YearRange,
  existing: ReadonlyArray<{ code: string; periodTypeCode: string; ordinal: number; parentCode: string | null }>,
): PeriodsPlan {
  const byId = new Map(source.map((p) => [p.id, p]));
  const depthOf = (p: SourcePeriod): number => {
    let depth = 0;
    let cursor: SourcePeriod | undefined = p;
    while (cursor?.parentPeriodId && depth < 5) {
      depth += 1;
      cursor = byId.get(cursor.parentPeriodId);
    }
    return depth;
  };
  const ordered = [...source].sort((a, b) => depthOf(a) - depthOf(b) || a.startsOn.localeCompare(b.startsOn) || a.ordinal - b.ordinal || a.code.localeCompare(b.code));
  const existingCodes = new Set(existing.map((e) => e.code));
  const existingSlots = new Set(existing.map((e) => `${e.parentCode ?? ""}|${e.periodTypeCode}|${e.ordinal}`));
  const planned = new Map<string, PlannedPeriod>();
  const plan: PeriodsPlan = { toCreate: [], existing: 0, dropped: [] };
  for (const p of ordered) {
    const parent = p.parentPeriodId ? byId.get(p.parentPeriodId) : undefined;
    const parentCode = parent?.code ?? null;
    if (existingCodes.has(p.code) || existingSlots.has(`${parentCode ?? ""}|${p.periodTypeCode}|${p.ordinal}`)) {
      plan.existing += 1;
      continue;
    }
    let min = to.startsOn;
    let max = to.endsOn;
    const parentPlanned = parentCode ? planned.get(parentCode) : undefined;
    if (parentPlanned) {
      min = parentPlanned.startsOn;
      max = parentPlanned.endsOn;
    }
    const startsOn = clamp(shiftDate(p.startsOn, from.startsOn, to.startsOn), min, max);
    const endsOn = clamp(shiftDate(p.endsOn, from.startsOn, to.startsOn), min, max);
    const item: PlannedPeriod = {
      code: p.code,
      parentCode,
      periodTypeCode: p.periodTypeCode,
      ordinal: p.ordinal,
      label: p.label,
      startsOn,
      endsOn,
      clamped: startsOn !== shiftDate(p.startsOn, from.startsOn, to.startsOn) || endsOn !== shiftDate(p.endsOn, from.startsOn, to.startsOn),
    };
    if (endsOn < startsOn || (item.clamped && startsOn === endsOn && p.startsOn !== p.endsOn)) {
      plan.dropped.push(item);
      continue;
    }
    planned.set(p.code, item);
    plan.toCreate.push(item);
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Jours fériés et fermetures
// ---------------------------------------------------------------------------------------------------------------------

export interface HolidayFacts {
  label: string;
  kind: "HOLIDAY" | "BREAK" | "CLOSURE";
  startsOn: IsoDate;
  endsOn: IsoDate;
  recursYearly: boolean;
  blocksTeaching: boolean;
}

export interface HolidaysPlan {
  toCreate: HolidayFacts[];
  existing: number;
  /** Jours de l'année source qui ne se répètent pas à date fixe : à ressaisir pour l'année cible. */
  notRecurring: number;
  /** Jours annuels dont la date reportée sort de l'année cible : ignorés. */
  outsideYear: number;
}

/**
 * Seuls les jours marqués `recursYearly` (fêtes à date fixe) sont reportés, à la même date civile. Les fêtes mobiles ne se
 * devinent pas : elles sont comptées (`notRecurring`) pour que l'établissement les saisisse. Les jours qui tombent dans
 * l'année SOURCE sont seuls candidats.
 */
export function planHolidays(source: readonly HolidayFacts[], from: YearRange, to: YearRange, existing: readonly HolidayFacts[]): HolidaysPlan {
  const key = (h: Pick<HolidayFacts, "label" | "startsOn" | "endsOn">): string => `${h.startsOn}|${h.endsOn}|${h.label}`;
  const present = new Set(existing.map(key));
  const yearsDelta = parts(to.startsOn).y - parts(from.startsOn).y;
  const plan: HolidaysPlan = { toCreate: [], existing: 0, notRecurring: 0, outsideYear: 0 };
  for (const h of source) {
    if (h.endsOn < from.startsOn || h.startsOn > from.endsOn) continue;
    if (!h.recursYearly) {
      plan.notRecurring += 1;
      continue;
    }
    const sameDayStart = parts(from.startsOn).m === parts(to.startsOn).m && parts(from.startsOn).d === parts(to.startsOn).d;
    const startsOn = sameDayStart ? shiftYears(h.startsOn, yearsDelta) : shiftDate(h.startsOn, from.startsOn, to.startsOn);
    const endsOn = sameDayStart ? shiftYears(h.endsOn, yearsDelta) : shiftDate(h.endsOn, from.startsOn, to.startsOn);
    if (startsOn < to.startsOn || endsOn > to.endsOn) {
      plan.outsideYear += 1;
      continue;
    }
    // Uniquement les FAITS (jamais l'identifiant ni l'établissement d'un enregistrement source recopié par mégarde).
    const next: HolidayFacts = { label: h.label, kind: h.kind, startsOn, endsOn, recursYearly: h.recursYearly, blocksTeaching: h.blocksTeaching };
    if (present.has(key(next))) plan.existing += 1;
    else plan.toCreate.push(next);
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------------------------------

export interface SourceClassroom {
  id: string;
  programId: string;
  gradeLevelId: string;
  kind: "CLASS" | "COHORT";
  code: string;
  name: string;
  capacity: number | null;
  capacityIsHard: boolean;
  campusId: string | null;
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  status: string;
}

export interface PlannedClassroom {
  sourceClassroomId: string;
  programId: string;
  gradeLevelId: string;
  kind: "CLASS" | "COHORT";
  code: string;
  name: string;
  capacity: number | null;
  capacityIsHard: boolean;
  campusId: string | null;
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
}

export interface ClassroomsPlan {
  toCreate: PlannedClassroom[];
  /** Classes de l'année cible portant déjà le code (ou le nom) : jamais dupliquées. */
  existing: number;
}

/** Statuts de classe source reconduits : une classe annulée ou archivée n'a pas de suite. */
export const ROLLOVER_CLASSROOM_STATUSES: readonly string[] = Object.freeze(["DRAFT", "ACTIVE", "COMPLETED"]);

/** Clé d'unicité d'une classe dans une année : (programme, niveau, code) et (programme, niveau, nom). */
export const classroomCodeKey = (c: { programId: string; gradeLevelId: string; code: string }): string => `${c.programId}|${c.gradeLevelId}|code|${c.code}`;
export const classroomNameKey = (c: { programId: string; gradeLevelId: string; name: string }): string => `${c.programId}|${c.gradeLevelId}|name|${c.name}`;

export function planClassrooms(
  source: readonly SourceClassroom[],
  from: YearRange,
  to: YearRange,
  existing: ReadonlyArray<{ programId: string; gradeLevelId: string; code: string; name: string }>,
  only: ReadonlySet<string> | null,
): ClassroomsPlan {
  const codes = new Set(existing.map(classroomCodeKey));
  const names = new Set(existing.map(classroomNameKey));
  const plan: ClassroomsPlan = { toCreate: [], existing: 0 };
  for (const c of [...source].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!ROLLOVER_CLASSROOM_STATUSES.includes(c.status)) continue;
    if (only && !only.has(c.id)) continue;
    if (codes.has(classroomCodeKey(c)) || names.has(classroomNameKey(c))) {
      plan.existing += 1;
      continue;
    }
    const startsOn = c.startsOn ? clamp(shiftDate(c.startsOn, from.startsOn, to.startsOn), to.startsOn, to.endsOn) : null;
    const endsOn = c.endsOn ? clamp(shiftDate(c.endsOn, from.startsOn, to.startsOn), to.startsOn, to.endsOn) : null;
    plan.toCreate.push({
      sourceClassroomId: c.id,
      programId: c.programId,
      gradeLevelId: c.gradeLevelId,
      kind: c.kind,
      code: c.code,
      name: c.name,
      capacity: c.capacity,
      capacityIsHard: c.capacityIsHard,
      campusId: c.campusId,
      startsOn: startsOn && endsOn && endsOn < startsOn ? null : startsOn,
      endsOn: startsOn && endsOn && endsOn < startsOn ? null : endsOn,
    });
    codes.add(classroomCodeKey(c));
    names.add(classroomNameKey(c));
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------------------------------------------------------

export interface SourceOffering {
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number | null;
}

export interface ShiftedOffering extends SourceOffering {
  /** Dates ramenées dans l'année cible. */
  clamped: boolean;
}

/**
 * Offre de l'année cible : même libellé et capacité, dates reportées et bornées à l'année cible, fenêtre d'inscription
 * décalée de la même durée. Toujours `DRAFT` (l'ouverture est une décision, sous la garde « responsable d'enseignement »).
 */
export function shiftOffering(source: SourceOffering, from: YearRange, to: YearRange): ShiftedOffering | null {
  const rawStart = shiftDate(source.startsOn, from.startsOn, to.startsOn);
  const rawEnd = shiftDate(source.endsOn, from.startsOn, to.startsOn);
  if (rawStart > to.endsOn || rawEnd < to.startsOn) return null; // entièrement hors de l'année cible
  const startsOn = clamp(rawStart, to.startsOn, to.endsOn);
  const endsOn = clamp(rawEnd, to.startsOn, to.endsOn);
  if (endsOn < startsOn) return null;
  const opens = source.registrationOpensAt ? shiftInstant(source.registrationOpensAt, from.startsOn, to.startsOn) : null;
  const closes = source.registrationClosesAt ? shiftInstant(source.registrationClosesAt, from.startsOn, to.startsOn) : null;
  return {
    label: source.label,
    startsOn,
    endsOn,
    registrationOpensAt: opens && closes && closes >= opens ? opens : null,
    registrationClosesAt: opens && closes && closes >= opens ? closes : null,
    capacity: source.capacity,
    clamped: startsOn !== rawStart || endsOn !== rawEnd,
  };
}
