/**
 * Types du domaine `scheduling` : valeurs d'énumération (anglais, comme la base) et enregistrements
 * manipulés par les règles pures. Aucun import de pg / fastify (règle `domain-is-pure`).
 *
 * Les dates calendaires sont des chaînes `YYYY-MM-DD` ; les heures d'un jour des entiers
 * « minutes depuis minuit » (0..1439) dans le fuseau de l'établissement ; les instants des `Date` UTC.
 */

export const OCCURRENCE_KINDS = ["LESSON", "EXAM", "MEETING", "EVENT", "RESERVATION", "COUNCIL", "OTHER"] as const;
export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];

export const ENTRY_KINDS = ["LESSON", "EXAM", "MEETING", "EVENT", "OTHER"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const OCCURRENCE_STATUSES = ["PLANNED", "HELD", "CANCELLED"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const OCCURRENCE_ORIGINS = ["GENERATED", "AD_HOC", "ACCOUNTING", "IMPORT"] as const;
export type OccurrenceOrigin = (typeof OCCURRENCE_ORIGINS)[number];

export const HELD_SOURCES = ["ATTENDANCE", "ADMIN", "AUTO"] as const;
export type HeldSource = (typeof HELD_SOURCES)[number];

export const STAFF_ROLES = ["LEAD", "CO_TEACHER", "SUBSTITUTE", "SUPERVISOR"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type EntryStaffRole = Exclude<StaffRole, "SUBSTITUTE">;

export const WEEK_PATTERNS = ["EVERY", "WEEK_A", "WEEK_B"] as const;
export type WeekPattern = (typeof WEEK_PATTERNS)[number];

export const DELIVERY_MODES = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const RESOURCE_KINDS = ["STAFF", "CLASSROOM", "ROOM", "EQUIPMENT"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ClaimResourceKind = Exclude<ResourceKind, "EQUIPMENT">;

export type ConflictMode = "BLOCK" | "WARN";
export type ConflictPolicies = Readonly<Record<ResourceKind, ConflictMode>>;
export const DEFAULT_CONFLICT_POLICIES: ConflictPolicies = Object.freeze({ STAFF: "BLOCK", CLASSROOM: "BLOCK", ROOM: "BLOCK", EQUIPMENT: "BLOCK" });

export const REPLACEMENT_REASONS = ["STAFF_LEAVE", "STAFF_LEFT", "STAFF_SUSPENDED", "ASSIGNMENT_ENDED", "ROOM_UNAVAILABLE", "OTHER"] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

export const RESOURCE_STATUSES = ["AVAILABLE", "OUT_OF_SERVICE", "ARCHIVED"] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const TIMETABLE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type TimetableStatus = (typeof TIMETABLE_STATUSES)[number];

export const AUDIENCES = ["STAFF", "STUDENTS", "GUARDIANS"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type AvailabilityMode = "OPEN" | "CLOSED";

/** Plage semi-ouverte `[start, end)` en millisecondes depuis l'époque. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Enregistrements
// ---------------------------------------------------------------------------

export interface SchedulingSettings {
  readonly institutionId: string;
  readonly timezone: string;
  readonly staffAvailabilityMode: AvailabilityMode;
  readonly maxGenerationWeeks: number;
  readonly generationHorizonWeeks: number;
  readonly allowSelfValidation: boolean;
  readonly supervisorsPaid: boolean;
  readonly openingStart: string | null;
  readonly openingEnd: string | null;
  readonly openingWeekdays: readonly number[] | null;
}

export interface Room {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string;
  readonly code: string;
  readonly name: string;
  readonly roomTypeCode: string;
  readonly capacity: number | null;
  readonly building: string | null;
  readonly floorLabel: string | null;
  readonly features: readonly string[];
  readonly status: ResourceStatus;
  readonly notes: string | null;
}

export interface EquipmentItem {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string;
  readonly code: string;
  readonly label: string;
  readonly quantity: number;
  readonly status: ResourceStatus;
}

export interface TimeSlot {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string | null;
  readonly code: string;
  readonly label: string;
  readonly startsTime: string;
  readonly endsTime: string;
  readonly isBreak: boolean;
  readonly ordinal: number;
  readonly active: boolean;
}

export interface CalendarEvent {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string | null;
  readonly academicYearId: string | null;
  readonly kindCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly startsTime: string | null;
  readonly endsTime: string | null;
  readonly blocksTeaching: boolean;
  readonly audience: readonly Audience[];
}

export interface Timetable {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string | null;
  readonly academicYearId: string;
  readonly periodId: string | null;
  readonly name: string;
  readonly status: TimetableStatus;
  readonly validFrom: string;
  readonly validTo: string;
  readonly weekAAnchor: string | null;
  readonly clonedFromId: string | null;
  readonly publishedAt: Date | null;
}

export interface EntryStaff {
  readonly staffId: string;
  readonly role: EntryStaffRole;
}

export interface EntryEquipment {
  readonly equipmentId: string;
  readonly quantity: number;
}

export interface TimetableEntry {
  readonly id: string;
  readonly timetableId: string;
  readonly kind: EntryKind;
  readonly classroomId: string | null;
  readonly curriculumNodeId: string | null;
  readonly offeringId: string | null;
  readonly claimsClassroom: boolean;
  readonly weekday: number;
  /** Minutes depuis minuit, heure locale de l'établissement. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeSlotId: string | null;
  readonly roomId: string | null;
  readonly weekPattern: WeekPattern;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly deliveryMode: DeliveryMode;
  readonly title: string | null;
  readonly notes: string | null;
  readonly endedAt: Date | null;
  readonly staff: readonly EntryStaff[];
  readonly equipment: readonly EntryEquipment[];
}

export interface OccurrenceStaff {
  readonly id: string;
  readonly occurrenceId: string;
  readonly staffId: string;
  readonly role: StaffRole;
  readonly replacesStaffId: string | null;
  readonly isPaidRole: boolean;
  readonly paidMinutes: number | null;
  readonly paidMinutesBy: string | null;
  readonly paidMinutesAt: Date | null;
  readonly lockedAt: Date | null;
  readonly lockRef: string | null;
}

export interface Occurrence {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string | null;
  readonly academicYearId: string;
  readonly timetableEntryId: string | null;
  readonly generatedFor: string | null;
  readonly kind: OccurrenceKind;
  readonly title: string | null;
  readonly classroomId: string | null;
  readonly curriculumNodeId: string | null;
  readonly offeringId: string | null;
  readonly claimsClassroom: boolean;
  readonly roomId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly occursOn: string;
  readonly deliveryMode: DeliveryMode;
  readonly virtualSessionRef: string | null;
  readonly status: OccurrenceStatus;
  readonly heldAt: Date | null;
  readonly heldSource: HeldSource | null;
  readonly heldBy: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly validatedAt: Date | null;
  readonly validatedBy: string | null;
  readonly origin: OccurrenceOrigin;
  readonly conflictOverride: boolean;
  readonly conflictOverrideReason: string | null;
  readonly needsReplacement: boolean;
  readonly replacementReason: ReplacementReason | null;
  readonly notes: string | null;
  readonly locationLabel: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

export interface OccurrenceDetail extends Occurrence {
  readonly staff: readonly OccurrenceStaff[];
  readonly equipment: readonly EntryEquipment[];
}

/** Ligne d'heures payables remise à la paie. */
export interface PayableHourLine {
  readonly occurrenceId: string;
  readonly staffId: string;
  readonly occursOn: string;
  readonly minutes: number;
  readonly kind: OccurrenceKind;
  readonly classroomId: string | null;
  readonly nodeId: string | null;
  readonly offeringId: string | null;
  readonly title: string | null;
  readonly locked: boolean;
  readonly lockRef: string | null;
}
