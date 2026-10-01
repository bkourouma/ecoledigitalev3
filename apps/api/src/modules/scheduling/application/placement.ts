/**
 * Contrôle d'un placement (spec 017 US1) : résolution du contexte académique, évaluation des conflits
 * (bloquants et avertissements) AVANT l'écriture. Partagé par l'aperçu, la création, le report, le
 * changement de salle et d'intervenants, la restauration et le contrôle des patrons.
 */
import { NotFoundError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import {
  classifyClaimHits,
  equipmentShortage,
  hasBlocking,
  roomCapacityWarning,
  staffAvailabilityWarning,
  staffWarning,
  compareViews,
  type AvailabilityRule,
  type ConflictLabels,
  type ConflictView,
} from "../domain/conflicts";
import { SchedulingCodes, academicUnavailable } from "../domain/errors";
import { blockingEventFor } from "../domain/recurrence";
import { localDateOf, localMinuteOf, parseTimeOfDay } from "../domain/time";
import type { ConflictPolicies, EntryEquipment, OccurrenceKind, OccurrenceOrigin, SchedulingSettings, StaffRole } from "../domain/types";
import { equipmentInUse, findClaimHits } from "../infrastructure/occurrence-repo";
import { getEquipmentByIds, getPolicies, getRoom, listCalendarEvents } from "../infrastructure/reference-repo";
import type { SchedulingDeps } from "./deps";
import { SCHEDULABLE_OFFERING_STATUSES, type ClassroomInfo, type CurriculumNodeInfo, type OfferingInfo } from "./ports/academic";
import type { StaffInfo } from "./ports/people";
import { buildLabels, loadSettings } from "./support";

// ---------------------------------------------------------------------------
// Contexte académique
// ---------------------------------------------------------------------------

export interface AcademicContext {
  institutionId: string;
  campusId: string | null;
  academicYearId: string | null;
  classroom: ClassroomInfo | null;
  offering: OfferingInfo | null;
  node: CurriculumNodeInfo | null;
  classroomId: string | null;
  offeringId: string | null;
  curriculumNodeId: string | null;
  claimsClassroom: boolean;
}

export interface AcademicInput {
  classroomId?: string | null | undefined;
  offeringId?: string | null | undefined;
  curriculumNodeId?: string | null | undefined;
  claimsClassroom?: boolean | undefined;
  institutionId?: string | null | undefined;
  campusId?: string | null | undefined;
  academicYearId?: string | null | undefined;
  /** Patron : ne contrôle ni le statut ni la fenêtre de l'offre (vérifiés à la génération, date par date). */
  lenient?: boolean | undefined;
  /** Date civile de la séance (fenêtre de l'offre, résolution de l'année). */
  date: string;
}

const invalid = (path: string, message: string, code: string): AppError => ValidationError.field(path, message, code);

/**
 * Valide les références académiques d'une séance et en tire l'établissement, le campus, l'année.
 * Échec fermé sans `AcademicQuery` dès qu'une classe ou une offre est en jeu (spec 017 §7).
 */
export async function resolveAcademic(deps: SchedulingDeps, ctx: RequestContext, input: AcademicInput): Promise<Result<AcademicContext, AppError>> {
  const academic = deps.ports.academic;
  const wantsAcademic = Boolean(input.classroomId || input.offeringId || input.curriculumNodeId);
  if (wantsAcademic && !academic) return err(academicUnavailable());

  let offering: OfferingInfo | null = null;
  let classroom: ClassroomInfo | null = null;
  let node: CurriculumNodeInfo | null = null;

  if (academic && input.offeringId) {
    offering = await academic.getOffering(ctx, input.offeringId);
    if (!offering) return err(NotFoundError.of("Offre", input.offeringId, { code: SchedulingCodes.notFound }));
    if (input.classroomId && input.classroomId !== offering.classroomId) return err(invalid("classroomId", "La classe ne correspond pas à l'offre.", "offering_classroom_mismatch"));
    if (input.curriculumNodeId && input.curriculumNodeId !== offering.curriculumNodeId) return err(invalid("curriculumNodeId", "Le nœud ne correspond pas à l'offre.", "offering_node_mismatch"));
    if (!input.lenient && !SCHEDULABLE_OFFERING_STATUSES.includes(offering.status)) {
      return err(
        new ValidationError(`L'offre « ${offering.label} » n'est pas planifiable (statut ${offering.status}).`, [{ path: ["offeringId"], message: "Offre non planifiable.", code: "offering_not_schedulable" }], {
          code: SchedulingCodes.offeringNotSchedulable,
          details: { status: offering.status },
        }),
      );
    }
    if (!input.lenient && ((offering.startsOn && input.date < offering.startsOn) || (offering.endsOn && input.date > offering.endsOn))) {
      return err(
        new ValidationError(`La date ${input.date} est hors de la fenêtre de l'offre « ${offering.label} ».`, [{ path: ["date"], message: "Date hors fenêtre de l'offre.", code: "offering_window" }], {
          code: SchedulingCodes.offeringNotSchedulable,
          details: { startsOn: offering.startsOn, endsOn: offering.endsOn },
        }),
      );
    }
  }

  const classroomId = offering?.classroomId ?? input.classroomId ?? null;
  if (academic && classroomId) {
    classroom = await academic.getClassroom(ctx, classroomId);
    if (!classroom) return err(NotFoundError.of("Classe", classroomId, { code: SchedulingCodes.notFound }));
  }
  const nodeId = offering?.curriculumNodeId ?? input.curriculumNodeId ?? null;
  if (academic && nodeId) {
    node = await academic.getCurriculumNode(ctx, nodeId);
    if (!node) return err(NotFoundError.of("Nœud de curriculum", nodeId, { code: SchedulingCodes.notFound }));
  }

  const institutionId = classroom?.institutionId ?? input.institutionId ?? ctx.institutionId ?? null;
  if (!institutionId) return err(invalid("institutionId", "L'établissement est requis (institutionId).", "institution_required"));
  if (classroom && input.institutionId && input.institutionId !== classroom.institutionId) {
    return err(invalid("institutionId", "L'établissement ne correspond pas à celui de la classe.", "institution_mismatch"));
  }

  let academicYearId = classroom?.academicYearId ?? input.academicYearId ?? null;
  if (!academicYearId && academic) {
    academicYearId = (await academic.resolvePeriodForDate(ctx, institutionId, input.date))?.academicYearId ?? null;
  }
  if (!academicYearId && !input.lenient) return err(invalid("academicYearId", "L'année scolaire est requise et n'a pu être déduite de la date.", "academic_year_required"));

  // Une offre à la carte ne réunit pas la classe (claims_classroom = false) : la classe n'est pas réservée,
  // c'est l'OFFRE qui l'est ; on refuse l'incohérence plutôt que de réserver la classe entière à tort.
  if (offering?.aLaCarte && input.claimsClassroom === true) {
    return err(invalid("claimsClassroom", "Une offre à la carte ne réunit pas la classe entière (claimsClassroom doit être faux).", "a_la_carte_claims_classroom"));
  }
  const claimsClassroom = offering?.aLaCarte ? false : (input.claimsClassroom ?? true);
  if (!claimsClassroom && !offering && !input.offeringId) {
    return err(invalid("offeringId", "Une séance qui ne réunit pas la classe doit préciser l'offre à la carte.", "offering_required"));
  }

  return ok({
    institutionId,
    campusId: input.campusId ?? classroom?.campusId ?? null,
    academicYearId,
    classroom,
    offering,
    node,
    classroomId,
    offeringId: offering?.id ?? input.offeringId ?? null,
    curriculumNodeId: nodeId,
    claimsClassroom,
  });
}

// ---------------------------------------------------------------------------
// Évaluation d'un placement
// ---------------------------------------------------------------------------

export interface Placement {
  institutionId: string;
  kind: OccurrenceKind;
  origin: OccurrenceOrigin;
  startsAt: Date;
  endsAt: Date;
  staff: ReadonlyArray<{ staffId: string; role: StaffRole }>;
  classroomId: string | null;
  offeringId: string | null;
  curriculumNodeId: string | null;
  claimsClassroom: boolean;
  roomId: string | null;
  equipment: readonly EntryEquipment[];
  excludeOccurrenceId: string | null;
  /** Dépassement motivé demandé : les réservations deviennent non exclusives. */
  override: boolean;
  /** Effectif de la classe/offre (avertissement de capacité), si connu. */
  headcount?: number | null;
  /** Classe pour les libellés. */
  classroom?: ClassroomInfo | null;
  offering?: OfferingInfo | null;
  node?: CurriculumNodeInfo | null;
}

export interface PlacementEvaluation {
  conflicts: ConflictView[];
  blocking: boolean;
  settings: SchedulingSettings;
  policies: ConflictPolicies;
  labels: ConflictLabels;
  staffInfo: ReadonlyMap<string, StaffInfo>;
}

const groupsLearners = (kind: OccurrenceKind): boolean => kind === "LESSON" || kind === "EXAM";

/** Clé de la famille « CLASSROOM » (classe réunie, sinon offre à la carte), ou null si la séance ne réunit pas de groupe. */
export function classroomKeyOf(p: Pick<Placement, "kind" | "claimsClassroom" | "classroomId" | "offeringId">): string | null {
  if (!groupsLearners(p.kind)) return null;
  return p.claimsClassroom ? p.classroomId : p.offeringId;
}

export async function evaluatePlacement(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, p: Placement): Promise<PlacementEvaluation> {
  const settings = await loadSettings(tx, p.institutionId);
  const policies = await getPolicies(tx, p.institutionId);
  const tz = settings.timezone;
  const staffIds = p.staff.map((s) => s.staffId);
  const staffInfo = new Map<string, StaffInfo>();
  if (deps.ports.people && staffIds.length > 0) for (const s of await deps.ports.people.getStaffByIds(ctx, staffIds)) staffInfo.set(s.id, s);
  const labels = await buildLabels(tx, {
    staff: staffInfo,
    roomIds: p.roomId ? [p.roomId] : [],
    equipmentIds: p.equipment.map((e) => e.equipmentId),
    classroom: p.classroom ? { id: p.classroom.id, name: p.classroom.name } : null,
    offering: p.offering ? { id: p.offering.id, label: p.offering.label } : null,
  });

  const conflicts: ConflictView[] = [];

  // 1. Réservations exclusives (enseignant, classe/offre, salle) — jamais pour une séance comptable.
  if (p.origin !== "ACCOUNTING") {
    const key = classroomKeyOf(p);
    const hits = await findClaimHits(tx, {
      during: { start: p.startsAt, end: p.endsAt },
      staffIds,
      classroomKey: key,
      roomId: p.roomId,
      excludeOccurrenceId: p.excludeOccurrenceId,
    });
    conflicts.push(
      ...classifyClaimHits({ hits, policies, override: p.override, classroomIsOffering: key !== null && !p.claimsClassroom, labels, timeZone: tz }),
    );

    // 2. Salle : existence et disponibilité.
    if (p.roomId) {
      const room = await getRoom(tx, p.roomId);
      if (!room) {
        conflicts.push({ code: "ROOM_UNAVAILABLE", severity: "BLOCKING", resourceKind: "ROOM", resourceId: p.roomId, message: "Cette salle est inconnue." });
      } else if (room.status !== "AVAILABLE") {
        conflicts.push({
          code: "ROOM_UNAVAILABLE",
          severity: "BLOCKING",
          resourceKind: "ROOM",
          resourceId: room.id,
          message: `La salle ${room.name} est ${room.status === "OUT_OF_SERVICE" ? "hors service" : "archivée"} : elle ne peut plus être réservée.`,
        });
      } else {
        const w = roomCapacityWarning({ roomId: room.id, capacity: room.capacity, headcount: p.headcount ?? p.classroom?.headcount ?? p.offering?.headcount ?? null, labels });
        if (w) conflicts.push(w);
      }
    }

    // 3. Équipements : stock (somme des quantités sur plages chevauchantes).
    if (p.equipment.length > 0) {
      const items = new Map((await getEquipmentByIds(tx, p.equipment.map((e) => e.equipmentId))).map((i) => [i.id, i]));
      for (const e of p.equipment) {
        const item = items.get(e.equipmentId);
        if (!item || item.status !== "AVAILABLE") {
          conflicts.push({
            code: "EQUIPMENT_SHORTAGE",
            severity: "BLOCKING",
            resourceKind: "EQUIPMENT",
            resourceId: e.equipmentId,
            message: item ? `${labels.equipment(item.id)} n'est pas disponible (${item.status}).` : "Cet équipement est inconnu.",
          });
          continue;
        }
        const inUse = await equipmentInUse(tx, item.id, { start: p.startsAt, end: p.endsAt }, p.excludeOccurrenceId);
        const shortage = equipmentShortage({ equipmentId: item.id, total: item.quantity, inUse, requested: e.quantity, mode: policies.EQUIPMENT, override: p.override, labels });
        if (shortage) conflicts.push(shortage);
      }
    }
  }

  // 4. Avertissements : disponibilité, compétence, affectation, statut, calendrier.
  const date = localDateOf(p.startsAt, tz);
  const startMinute = localMinuteOf(p.startsAt, tz);
  const endMinute = Math.min(1440, startMinute + Math.round((p.endsAt.getTime() - p.startsAt.getTime()) / 60_000));
  const people = deps.ports.people;
  if (people && staffIds.length > 0 && p.origin !== "ACCOUNTING") {
    const availability = await people.listAvailabilities(ctx, staffIds, { from: date, to: date });
    const rulesByStaff = new Map<string, AvailabilityRule[]>();
    for (const a of availability) {
      const list = rulesByStaff.get(a.staffId) ?? [];
      list.push({ weekday: a.weekday, date: a.date, startMinute: parseTimeOfDay(a.startTime), endMinute: parseTimeOfDay(a.endTime), kind: a.kind });
      rulesByStaff.set(a.staffId, list);
    }
    for (const id of staffIds) {
      const info = staffInfo.get(id);
      if (info && info.status !== "ACTIVE" && info.status !== "ON_LEAVE") conflicts.push(staffWarning("STAFF_INACTIVE", id, labels, info.status));
      const w = staffAvailabilityWarning({ staffId: id, rules: rulesByStaff.get(id) ?? [], mode: settings.staffAvailabilityMode, date, startMinute, endMinute, labels });
      if (w) conflicts.push(w);
    }
    if (p.kind === "LESSON") {
      if (p.curriculumNodeId) {
        const comps = await people.listCompetencies(ctx, staffIds);
        const subjectId = p.node?.subjectId ?? null;
        for (const s of p.staff.filter((x) => x.role === "LEAD" || x.role === "CO_TEACHER" || x.role === "SUBSTITUTE")) {
          const mine = comps.filter((c) => c.staffId === s.staffId);
          const ok = mine.some((c) => c.curriculumNodeId === p.curriculumNodeId || (subjectId !== null && c.subjectId === subjectId));
          // Aucune compétence déclarée du tout : on ne dit rien (donnée absente, pas manquante).
          if (mine.length > 0 && !ok) conflicts.push(staffWarning("COMPETENCY_MISSING", s.staffId, labels));
        }
      }
      if (p.classroomId) {
        for (const s of p.staff.filter((x) => x.role === "LEAD" || x.role === "CO_TEACHER")) {
          if (!(await people.isStaffAssignedToClassroom(ctx, s.staffId, p.classroomId, date))) conflicts.push(staffWarning("STAFF_NOT_ASSIGNED", s.staffId, labels));
        }
      }
    }
  }
  if (p.kind === "LESSON" && p.origin !== "ACCOUNTING") {
    const events = await listCalendarEvents(tx, { institutionId: p.institutionId, from: date, to: date, blocksTeachingOnly: true });
    const block = blockingEventFor(date, startMinute, endMinute, events, null);
    if (block) {
      conflicts.push({
        code: "CALENDAR_BLOCKED",
        severity: "WARNING",
        resourceKind: "ROOM",
        resourceId: null,
        message: `Ce jour est bloqué par le calendrier de l'établissement (« ${block.title} »).`,
      });
    }
  }

  conflicts.sort(compareViews);
  return { conflicts, blocking: hasBlocking(conflicts), settings, policies, labels, staffInfo };
}
