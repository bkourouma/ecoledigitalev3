/**
 * Génération d'occurrences à partir d'un patron hebdomadaire (spec 017 US2). Algorithme PUR :
 * aucune lecture de base, aucune horloge — le fuseau, les bornes et les jours bloquants sont fournis.
 *
 * Pour un patron (jour ISO, `[début, fin)` à la minute, alternance EVERY/A/B) :
 *   dates = jours de la semaine ISO voulue dans l'INTERSECTION de
 *           fenêtre demandée ∩ validité de l'emploi du temps ∩ validité propre au patron ;
 *   moins les dates bloquées par le calendrier de l'établissement (`blocks_teaching`) ;
 *   chaque date retenue donne un instant de début/fin (heure murale du fuseau → UTC) et une clé
 *   d'idempotence `generatedFor` (la date du patron).
 */
import type { CalendarEvent, WeekPattern } from "./types";
import { addDays, compareDates, firstWeekdayOnOrAfter, localToInstant, maxDate, minDate, weekLabel } from "./time";

export interface PatternSource {
  readonly id: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly weekPattern: WeekPattern;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

export interface PatternTimetable {
  readonly validFrom: string;
  readonly validTo: string;
  readonly weekAAnchor: string | null;
  readonly campusId: string | null;
}

export interface Candidate {
  readonly entryId: string;
  /** Date du patron (clé d'idempotence). */
  readonly generatedFor: string;
  readonly occursOn: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly weekLabel: "A" | "B" | null;
}

export interface BlockedDate {
  readonly entryId: string;
  readonly date: string;
  readonly eventId: string;
  readonly eventTitle: string;
}

export interface ExpansionResult {
  readonly candidates: readonly Candidate[];
  readonly blocked: readonly BlockedDate[];
  /** Dates dont l'horaire n'a pas pu être converti (début ≥ fin après passage de fuseau). */
  readonly invalid: readonly string[];
  /** Plage effectivement parcourue (null si l'intersection est vide). */
  readonly effective: { readonly from: string; readonly to: string } | null;
}

/** Bornes effectives d'un patron dans une fenêtre. */
export function effectiveRange(
  entry: Pick<PatternSource, "validFrom" | "validTo">,
  timetable: Pick<PatternTimetable, "validFrom" | "validTo">,
  window: { from: string; to: string },
): { from: string; to: string } | null {
  const from = maxDate(maxDate(window.from, timetable.validFrom), entry.validFrom ?? timetable.validFrom);
  const to = minDate(minDate(window.to, timetable.validTo), entry.validTo ?? timetable.validTo);
  return compareDates(from, to) > 0 ? null : { from, to };
}

/**
 * L'événement bloque-t-il le créneau `[startMinute, endMinute)` de cette date ?
 * Un événement sans heures bloque la journée ; avec heures, seulement le recouvrement horaire.
 * Un événement de campus ne s'applique qu'à un emploi du temps du même campus.
 */
export function blockingEventFor(
  date: string,
  startMinute: number,
  endMinute: number,
  events: readonly Pick<CalendarEvent, "id" | "title" | "campusId" | "startsOn" | "endsOn" | "startsTime" | "endsTime" | "blocksTeaching">[],
  campusId: string | null,
): { id: string; title: string } | null {
  for (const e of events) {
    if (!e.blocksTeaching) continue;
    if (e.campusId !== null && e.campusId !== campusId) continue;
    if (date < e.startsOn || date > e.endsOn) continue;
    if (e.startsTime === null || e.endsTime === null) return { id: e.id, title: e.title };
    const eventStart = timeToMinutes(e.startsTime);
    const eventEnd = timeToMinutes(e.endsTime);
    if (startMinute < eventEnd && eventStart < endMinute) return { id: e.id, title: e.title };
  }
  return null;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

export function expandEntry(
  entry: PatternSource,
  timetable: PatternTimetable,
  window: { from: string; to: string },
  timeZone: string,
  events: readonly Pick<CalendarEvent, "id" | "title" | "campusId" | "startsOn" | "endsOn" | "startsTime" | "endsTime" | "blocksTeaching">[],
): ExpansionResult {
  const range = effectiveRange(entry, timetable, window);
  if (!range) return { candidates: [], blocked: [], invalid: [], effective: null };
  if (entry.weekPattern !== "EVERY" && timetable.weekAAnchor === null) {
    throw new RangeError("Une alternance A/B exige une date d'ancrage (lundi d'une semaine A) sur l'emploi du temps.");
  }

  const candidates: Candidate[] = [];
  const blocked: BlockedDate[] = [];
  const invalid: string[] = [];
  for (let date = firstWeekdayOnOrAfter(range.from, entry.weekday); date <= range.to; date = addDays(date, 7)) {
    let label: "A" | "B" | null = null;
    if (entry.weekPattern !== "EVERY") {
      label = weekLabel(timetable.weekAAnchor as string, date);
      if ((entry.weekPattern === "WEEK_A") !== (label === "A")) continue;
    }
    const block = blockingEventFor(date, entry.startMinute, entry.endMinute, events, timetable.campusId);
    if (block) {
      blocked.push({ entryId: entry.id, date, eventId: block.id, eventTitle: block.title });
      continue;
    }
    const startsAt = localToInstant(date, entry.startMinute, timeZone);
    const endsAt = localToInstant(date, entry.endMinute, timeZone);
    if (endsAt.getTime() <= startsAt.getTime()) {
      invalid.push(date);
      continue;
    }
    candidates.push({ entryId: entry.id, generatedFor: date, occursOn: date, startsAt, endsAt, weekLabel: label });
  }
  return { candidates, blocked, invalid, effective: range };
}

// ---------------------------------------------------------------------------
// Plafond d'heures par nœud (AC2.3)
// ---------------------------------------------------------------------------

/**
 * Registre du plafond d'heures par clé (classe × nœud) : `used` = minutes déjà planifiées (hors annulées),
 * `caps` = volume horaire du nœud en minutes. Les candidats sont présentés dans l'ordre chronologique ; un
 * candidat qui ferait dépasser le plafond est refusé (un candidat plus court de la même clé peut encore
 * tenir : chacun est testé). Une clé sans plafond (volume horaire inconnu) n'est jamais plafonnée.
 */
export class HourCapLedger {
  private readonly used: Map<string, number>;

  constructor(
    used: ReadonlyMap<string, number>,
    private readonly caps: ReadonlyMap<string, number | null>,
  ) {
    this.used = new Map(used);
  }

  /** Réserve `minutes` pour `key` si le plafond le permet ; renvoie `false` (sans rien réserver) sinon. */
  tryConsume(key: string, minutes: number): boolean {
    const cap = this.caps.get(key);
    if (cap === null || cap === undefined) return true;
    const used = this.used.get(key) ?? 0;
    if (used + minutes > cap) return false;
    this.used.set(key, used + minutes);
    return true;
  }

  usedMinutes(key: string): number {
    return this.used.get(key) ?? 0;
  }

  snapshot(): Map<string, number> {
    return new Map(this.used);
  }
}

