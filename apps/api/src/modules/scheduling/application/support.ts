/**
 * Aides communes des cas d'usage : paramètres de l'établissement, fenêtre horaire, éligibilité des
 * intervenants, libellés lisibles pour les messages de conflit, charges d'événements.
 */
import { ABIDJAN_TZ, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { defaultLabels, type ConflictLabels } from "../domain/conflicts";
import { SchedulingCodes } from "../domain/errors";
import type { Occurrence } from "../domain/types";
import { assertIsoDate, assertTimeZone, localDateOf, localMinuteOf, localToInstant, parseTimeOfDay } from "../domain/time";
import { getEquipmentByIds, getRoomsByIds, getSettings } from "../infrastructure/reference-repo";
import type { SchedulingDeps } from "./deps";
import { PLANNABLE_STAFF_STATUSES, type StaffInfo } from "./ports/people";
import type { SchedulingSettings } from "../domain/types";

export const MIN_REASON_LENGTH = 3;
export const MIN_OVERRIDE_REASON_LENGTH = 5;

export const trimReason = (reason: string | null | undefined): string => (reason ?? "").trim();

export async function loadSettings(tx: Tx, institutionId: string): Promise<SchedulingSettings> {
  const settings = await getSettings(tx, institutionId, ABIDJAN_TZ);
  assertTimeZone(settings.timezone);
  return settings;
}

export function validation(path: string, message: string, code = "invalid"): AppError {
  return ValidationError.field(path, message, code);
}

// ---------------------------------------------------------------------------
// Fenêtre horaire
// ---------------------------------------------------------------------------

export interface TimeInput {
  /** Saisie locale : date civile + heures murales de l'établissement. */
  date?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  /** Ou deux instants (ISO 8601). */
  startsAt?: string | Date | undefined;
  endsAt?: string | Date | undefined;
}

export interface ResolvedWindow {
  startsAt: Date;
  endsAt: Date;
  occursOn: string;
  startMinute: number;
  endMinute: number;
}

/** Fenêtre d'une séance : jamais à cheval sur minuit (deux occurrences), toujours `début < fin`. */
export function resolveWindow(input: TimeInput, timeZone: string): Result<ResolvedWindow, AppError> {
  try {
    let startsAt: Date;
    let endsAt: Date;
    if (input.date !== undefined || input.startTime !== undefined || input.endTime !== undefined) {
      if (input.date === undefined || input.startTime === undefined || input.endTime === undefined) {
        return err(validation("date", "Saisie locale incomplète : date, heure de début et heure de fin sont requises ensemble."));
      }
      assertIsoDate(input.date);
      const s = parseTimeOfDay(input.startTime);
      const e = parseTimeOfDay(input.endTime);
      if (e <= s) return err(validation("endTime", "L'heure de fin doit être postérieure à l'heure de début (une séance ne passe pas minuit : créez-en deux)."));
      startsAt = localToInstant(input.date, s, timeZone);
      endsAt = localToInstant(input.date, e, timeZone);
    } else if (input.startsAt !== undefined && input.endsAt !== undefined) {
      startsAt = new Date(input.startsAt);
      endsAt = new Date(input.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return err(validation("startsAt", "Instant invalide."));
    } else {
      return err(validation("startsAt", "Précisez la plage : (date, startTime, endTime) ou (startsAt, endsAt)."));
    }
    if (endsAt.getTime() <= startsAt.getTime()) return err(validation("endsAt", "La fin doit être postérieure au début."));
    const occursOn = localDateOf(startsAt, timeZone);
    if (localDateOf(new Date(endsAt.getTime() - 1), timeZone) !== occursOn) {
      return err(validation("endsAt", "Une séance ne peut pas passer minuit (fuseau de l'établissement) : créez-en deux."));
    }
    const startMinute = localMinuteOf(startsAt, timeZone);
    const endMinute = Math.min(1440, startMinute + Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
    return ok({ startsAt, endsAt, occursOn, startMinute, endMinute });
  } catch (e) {
    if (e instanceof RangeError) return err(validation("startsAt", e.message));
    throw e;
  }
}


// ---------------------------------------------------------------------------
// Intervenants, libellés
// ---------------------------------------------------------------------------

export async function loadStaffInfo(deps: SchedulingDeps, ctx: RequestContext, ids: readonly string[]): Promise<Map<string, StaffInfo>> {
  const out = new Map<string, StaffInfo>();
  const people = deps.ports.people;
  if (!people || ids.length === 0) return out;
  for (const s of await people.getStaffByIds(ctx, [...new Set(ids)])) out.set(s.id, s);
  return out;
}

/**
 * R15 : un intervenant est un membre du personnel ACTIVE ou ON_LEAVE. Sans port `people`, aucun contrôle
 * (repli documenté) ; avec lui, un identifiant inconnu est refusé.
 */
export async function checkStaffEligible(deps: SchedulingDeps, ctx: RequestContext, ids: readonly string[]): Promise<Result<Map<string, StaffInfo>, AppError>> {
  const infos = await loadStaffInfo(deps, ctx, ids);
  if (!deps.ports.people) return ok(infos);
  const problems: Array<{ staffId: string; reason: string }> = [];
  for (const id of new Set(ids)) {
    const info = infos.get(id);
    if (!info) problems.push({ staffId: id, reason: "UNKNOWN" });
    else if (!PLANNABLE_STAFF_STATUSES.includes(info.status)) problems.push({ staffId: id, reason: info.status });
  }
  if (problems.length === 0) return ok(infos);
  const names = problems.map((p) => infos.get(p.staffId)?.displayName ?? p.staffId.slice(0, 8)).join(", ");
  return err(
    new ValidationError(`Intervenant(s) non planifiable(s) : ${names} (membre du personnel inconnu, suspendu ou parti).`, [{ path: ["staff"], message: "Intervenant non planifiable.", code: "staff_not_eligible" }], {
      code: SchedulingCodes.staffNotEligible,
      details: { problems },
    }),
  );
}

export interface LabelSources {
  staff: ReadonlyMap<string, StaffInfo>;
  roomIds?: readonly string[];
  equipmentIds?: readonly string[];
  classroom?: { id: string; name: string } | null;
  offering?: { id: string; label: string } | null;
}

export async function buildLabels(tx: Tx, src: LabelSources): Promise<ConflictLabels> {
  const rooms = new Map((await getRoomsByIds(tx, src.roomIds ?? [])).map((r) => [r.id, r.name]));
  const equipment = new Map((await getEquipmentByIds(tx, src.equipmentIds ?? [])).map((e) => [e.id, e.label]));
  return {
    staff: (id) => (src.staff.get(id) ? `${src.staff.get(id)?.displayName}` : defaultLabels.staff(id)),
    classroom: (id) => (src.classroom && src.classroom.id === id ? `la classe ${src.classroom.name}` : defaultLabels.classroom(id)),
    offering: (id) => (src.offering && src.offering.id === id ? `le cours à la carte ${src.offering.label}` : defaultLabels.offering(id)),
    room: (id) => (rooms.get(id) ? `la salle ${rooms.get(id)}` : defaultLabels.room(id)),
    equipment: (id) => (equipment.get(id) ? `l'équipement ${equipment.get(id)}` : defaultLabels.equipment(id)),
  };
}

// ---------------------------------------------------------------------------
// Charges d'événements
// ---------------------------------------------------------------------------

export function occurrenceEventPayload(occ: Occurrence, staffIds: readonly string[], extra: Record<string, unknown> = {}): { v: 1 } & Record<string, unknown> {
  return {
    v: 1,
    occurrenceId: occ.id,
    kind: occ.kind,
    classroomId: occ.classroomId,
    offeringId: occ.offeringId,
    curriculumNodeId: occ.curriculumNodeId,
    roomId: occ.roomId,
    startsAt: occ.startsAt.toISOString(),
    endsAt: occ.endsAt.toISOString(),
    occursOn: occ.occursOn,
    status: occ.status,
    staffIds: [...staffIds],
    ...extra,
  };
}

export const OCCURRENCE_AGGREGATE = "occurrence";
