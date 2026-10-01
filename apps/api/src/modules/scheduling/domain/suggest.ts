/**
 * Aide au placement (spec 017 US9) : suggestion de créneaux libres et de remplaçants. Domaine PUR et
 * DÉTERMINISTE (mêmes entrées ⇒ mêmes sorties, dans le même ordre). Ce n'est PAS un solveur : aucun
 * emploi du temps complet n'est construit (question O-05).
 *
 * Aucune constante d'établissement n'est codée : jours ouvrables, amplitude d'ouverture et grille
 * viennent des paramètres (`settings.opening_*`, `time_slots`) ou de l'appel.
 */
import type { CalendarEvent } from "./types";
import { eachDate, isoWeekday, localToInstant } from "./time";
import { blockingEventFor } from "./recurrence";
import { ResourceBook, availabilityStatus, staffAvailabilityWarning, roomCapacityWarning, defaultLabels, type AvailabilityRule, type AvailabilityStatus, type ConflictLabels, type ConflictView } from "./conflicts";

export interface SlotRoom {
  readonly id: string;
  readonly code: string;
  readonly capacity: number | null;
  readonly roomTypeCode: string;
  readonly features: readonly string[];
}

export interface SlotQuery {
  readonly window: { readonly from: string; readonly to: string };
  readonly durationMinutes: number;
  readonly count: number;
  readonly timeZone: string;
  /** Jours ouvrables (ISO 1..7). */
  readonly weekdays: readonly number[];
  readonly dayStartMinute: number;
  readonly dayEndMinute: number;
  /** Heures de début candidates (cloches de la grille) ; à défaut, un pas régulier. */
  readonly startMinutes: readonly number[] | null;
  readonly stepMinutes: number;
  readonly campusId: string | null;
  readonly events: readonly Pick<CalendarEvent, "id" | "title" | "campusId" | "startsOn" | "endsOn" | "startsTime" | "endsTime" | "blocksTeaching">[];
  /** Plages exclusives déjà prises, par ressource (carnet construit par l'appelant). */
  readonly book: ResourceBook;
  readonly staffIds: readonly string[];
  readonly classroomKey: string | null;
  readonly rooms: readonly SlotRoom[];
  /** `true` si une salle est requise (type, équipements fixes demandés ou salle explicite). */
  readonly roomRequired: boolean;
  readonly headcount: number | null;
  readonly availability: ReadonlyMap<string, readonly AvailabilityRule[]>;
  readonly availabilityMode: "OPEN" | "CLOSED";
  readonly labels?: ConflictLabels;
  readonly now: Date;
}

export interface Slot {
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string | null;
  readonly roomCode: string | null;
  /** Tous les intervenants ont déclaré une disponibilité couvrant le créneau. */
  readonly preferred: boolean;
  readonly warnings: readonly ConflictView[];
}

/**
 * Premiers créneaux libres. Ordre : date, puis (au sein d'un jour) créneaux « préférés » (disponibilité
 * déclarée) d'abord, puis heure de début, puis code de la salle. Une salle est choisie parmi celles qui
 * sont libres, assez grandes pour l'effectif et conformes, la plus petite suffisante d'abord.
 */
export function suggestSlots(q: SlotQuery): Slot[] {
  if (!Number.isInteger(q.durationMinutes) || q.durationMinutes <= 0) throw new RangeError("La durée doit être un nombre entier de minutes.");
  if (q.count <= 0) return [];
  const labels = q.labels ?? defaultLabels;
  const starts =
    q.startMinutes !== null
      ? [...new Set(q.startMinutes)].sort((a, b) => a - b)
      : stepStarts(q.dayStartMinute, q.dayEndMinute, q.stepMinutes);
  const weekdays = new Set(q.weekdays);
  const result: Slot[] = [];

  for (const date of eachDate(q.window.from, q.window.to)) {
    if (!weekdays.has(isoWeekday(date))) continue;
    const day: Slot[] = [];
    for (const startMinute of starts) {
      const endMinute = startMinute + q.durationMinutes;
      if (startMinute < q.dayStartMinute || endMinute > q.dayEndMinute) continue;
      if (blockingEventFor(date, startMinute, endMinute, q.events, q.campusId)) continue;
      const startsAt = localToInstant(date, startMinute, q.timeZone);
      const endsAt = localToInstant(date, endMinute, q.timeZone);
      if (startsAt.getTime() < q.now.getTime()) continue;
      const span = { start: startsAt.getTime(), end: endsAt.getTime() };
      if (q.staffIds.some((id) => q.book.firstOverlap(ResourceBook.key("STAFF", id), span))) continue;
      if (q.classroomKey && q.book.firstOverlap(ResourceBook.key("CLASSROOM", q.classroomKey), span)) continue;

      let room: SlotRoom | null = null;
      if (q.roomRequired) {
        const free = q.rooms
          .filter((r) => !q.book.firstOverlap(ResourceBook.key("ROOM", r.id), span))
          .filter((r) => q.headcount === null || r.capacity === null || r.capacity >= q.headcount)
          .sort((a, b) => (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code));
        room = free[0] ?? null;
        if (!room) continue;
      }

      const warnings: ConflictView[] = [];
      let preferred = q.staffIds.length > 0;
      for (const id of q.staffIds) {
        const rules = q.availability.get(id) ?? [];
        const status: AvailabilityStatus = availabilityStatus(rules, q.availabilityMode, date, startMinute, endMinute);
        if (status !== "DECLARED_AVAILABLE") preferred = false;
        const w = staffAvailabilityWarning({ staffId: id, rules, mode: q.availabilityMode, date, startMinute, endMinute, labels });
        if (w) warnings.push(w);
      }
      if (room) {
        const cap = roomCapacityWarning({ roomId: room.id, capacity: room.capacity, headcount: q.headcount, labels });
        if (cap) warnings.push(cap);
      }
      day.push({ date, startMinute, endMinute, startsAt, endsAt, roomId: room?.id ?? null, roomCode: room?.code ?? null, preferred, warnings });
    }
    day.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.startMinute - b.startMinute);
    result.push(...day);
    if (result.length >= q.count) break;
  }
  return result.slice(0, q.count);
}

function stepStarts(from: number, to: number, step: number): number[] {
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("Le pas de recherche doit être un nombre entier de minutes.");
  const out: number[] = [];
  for (let m = from; m < to; m += step) out.push(m);
  return out;
}

// ---------------------------------------------------------------------------
// Remplaçants
// ---------------------------------------------------------------------------

export interface SubstituteCandidateInput {
  readonly staffId: string;
  /** Statut dans l'annuaire du personnel (`ACTIVE`, `ON_LEAVE`, `SUSPENDED`, `LEFT`) ; null si inconnu. */
  readonly status: string | null;
  /** Déjà occupé (réservation exclusive qui chevauche la séance) ? */
  readonly busy: boolean;
  readonly availability: AvailabilityStatus;
  /** Compétence déclarée pour la matière : oui / non / inconnu. */
  readonly competent: boolean | null;
  readonly assignedToClassroom: boolean | null;
  /** Charge planifiée de la semaine de la séance, en minutes. */
  readonly weeklyLoadMinutes: number;
}

export interface SubstituteSuggestion extends SubstituteCandidateInput {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

/**
 * Classe des remplaçants possibles : éligibles (libres, non indisponibles, en activité) d'abord ;
 * puis compétents, disponibilité déclarée, affectés à la classe, moindre charge hebdomadaire, identifiant.
 */
export function rankSubstitutes(candidates: readonly SubstituteCandidateInput[]): SubstituteSuggestion[] {
  const scored = candidates.map<SubstituteSuggestion>((c) => {
    const reasons: string[] = [];
    if (c.busy) reasons.push("occupé sur ce créneau");
    if (c.availability === "DECLARED_UNAVAILABLE") reasons.push("indisponibilité déclarée");
    if (c.availability === "UNDECLARED_UNAVAILABLE") reasons.push("aucune disponibilité déclarée");
    if (c.status !== null && c.status !== "ACTIVE") reasons.push(`statut ${c.status}`);
    if (c.competent === false) reasons.push("compétence non déclarée");
    const eligible = !c.busy && c.availability !== "DECLARED_UNAVAILABLE" && (c.status === null || c.status === "ACTIVE");
    return { ...c, eligible, reasons };
  });
  const rank = (b: boolean | null): number => (b === true ? 0 : b === null ? 1 : 2);
  return scored.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      rank(a.competent) - rank(b.competent) ||
      Number(b.availability === "DECLARED_AVAILABLE") - Number(a.availability === "DECLARED_AVAILABLE") ||
      rank(a.assignedToClassroom) - rank(b.assignedToClassroom) ||
      a.weeklyLoadMinutes - b.weeklyLoadMinutes ||
      a.staffId.localeCompare(b.staffId),
  );
}

