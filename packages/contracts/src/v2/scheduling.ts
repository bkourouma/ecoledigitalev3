/**
 * Contrats du module `scheduling` (routes `/api/v1/scheduling/*`). Écrits avant les routes
 * (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Conventions :
 *  - DATES calendaires `AAAA-MM-JJ` (jour civil de l'établissement) ; HEURES MURALES `HH:MM` (fuseau de
 *    l'établissement) ; INSTANTS en ISO 8601 UTC (`...Z`) ou avec décalage.
 *  - DURÉES en minutes entières. Jours ISO : 1 (lundi) à 7 (dimanche).
 *  - IDENTIFIANTS : UUID. Les classes, offres, nœuds, enseignants et élèves sont des identifiants d'autres
 *    modules, vérifiés par les ports (aucune clé étrangère).
 *  - Valeurs d'énumération en anglais ; messages d'erreur en français (corps d'erreur du kernel).
 *  - Aucun montant ni taux : la rémunération relève de la paie (032).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const schedulingUuidSchema = z.string().uuid();
export const schedulingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
export const schedulingTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM.");
export const schedulingInstantSchema = z.string().datetime({ offset: true });
export const schedulingWeekdaySchema = z.number().int().min(1).max(7);

export const SCHEDULING_OCCURRENCE_KINDS = ["LESSON", "EXAM", "MEETING", "EVENT", "RESERVATION", "COUNCIL", "OTHER"] as const;
export const schedulingOccurrenceKindSchema = z.enum(SCHEDULING_OCCURRENCE_KINDS);
export const SCHEDULING_ENTRY_KINDS = ["LESSON", "EXAM", "MEETING", "EVENT", "OTHER"] as const;
export const schedulingEntryKindSchema = z.enum(SCHEDULING_ENTRY_KINDS);
export const SCHEDULING_OCCURRENCE_STATUSES = ["PLANNED", "HELD", "CANCELLED"] as const;
export const schedulingOccurrenceStatusSchema = z.enum(SCHEDULING_OCCURRENCE_STATUSES);
export const SCHEDULING_STAFF_ROLES = ["LEAD", "CO_TEACHER", "SUBSTITUTE", "SUPERVISOR"] as const;
export const schedulingStaffRoleSchema = z.enum(SCHEDULING_STAFF_ROLES);
export const schedulingEntryStaffRoleSchema = z.enum(["LEAD", "CO_TEACHER", "SUPERVISOR"]);
export const schedulingWeekPatternSchema = z.enum(["EVERY", "WEEK_A", "WEEK_B"]);
export const schedulingDeliveryModeSchema = z.enum(["IN_PERSON", "ONLINE", "HYBRID"]);
export const schedulingResourceStatusSchema = z.enum(["AVAILABLE", "OUT_OF_SERVICE", "ARCHIVED"]);
export const schedulingResourceKindSchema = z.enum(["STAFF", "CLASSROOM", "ROOM", "EQUIPMENT"]);
export const schedulingConflictModeSchema = z.enum(["BLOCK", "WARN"]);
export const schedulingAudienceSchema = z.enum(["STAFF", "STUDENTS", "GUARDIANS"]);
export const schedulingHeldSourceSchema = z.enum(["ATTENDANCE", "ADMIN", "AUTO"]);
export const schedulingIcsScopeSchema = z.enum(["CLASSROOM", "STAFF", "STUDENT", "ROOM"]);

const optionalNullable = <T extends z.ZodTypeAny>(s: T) => s.nullish();

export const schedulingIdParamsSchema = z.object({ id: schedulingUuidSchema });
export const schedulingEntryParamsSchema = z.object({ id: schedulingUuidSchema, entryId: schedulingUuidSchema });
export const schedulingStaffParamsSchema = z.object({ id: schedulingUuidSchema, staffId: schedulingUuidSchema });
export const schedulingStudentParamsSchema = z.object({ studentId: schedulingUuidSchema });

export const schedulingReasonSchema = z.string().trim().min(3, "Un motif d'au moins 3 caractères est requis.").max(500);
export const schedulingOverrideSchema = z.object({ reason: z.string().trim().min(5, "Le motif du dépassement doit faire au moins 5 caractères.").max(500) });

// ---------------------------------------------------------------------------
// Fenêtre horaire : saisie locale OU deux instants
// ---------------------------------------------------------------------------

const timeInputShape = {
  date: schedulingDateSchema.optional(),
  startTime: schedulingTimeSchema.optional(),
  endTime: schedulingTimeSchema.optional(),
  startsAt: schedulingInstantSchema.optional(),
  endsAt: schedulingInstantSchema.optional(),
};

const requiresWindow = (v: { date?: string; startTime?: string; endTime?: string; startsAt?: string; endsAt?: string }): boolean =>
  (v.date !== undefined && v.startTime !== undefined && v.endTime !== undefined) || (v.startsAt !== undefined && v.endsAt !== undefined);
const WINDOW_MESSAGE = "Précisez la plage : (date, startTime, endTime) ou (startsAt, endsAt).";

// ---------------------------------------------------------------------------
// Références : salles, équipements, grille, calendrier, paramètres
// ---------------------------------------------------------------------------

export const schedulingRoomBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  campusId: schedulingUuidSchema,
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  roomTypeCode: z.string().trim().min(1).max(40),
  capacity: optionalNullable(z.number().int().min(1).max(100_000)),
  building: optionalNullable(z.string().trim().max(200)),
  floorLabel: optionalNullable(z.string().trim().max(100)),
  features: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  notes: optionalNullable(z.string().trim().max(2000)),
});
export const schedulingRoomPatchSchema = schedulingRoomBodySchema.omit({ institutionId: true, campusId: true, code: true }).partial();
export const schedulingRoomStatusBodySchema = z.object({ status: schedulingResourceStatusSchema, reason: z.string().trim().max(500).optional() });
export const schedulingListRoomsQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  campusId: schedulingUuidSchema.optional(),
  roomType: z.string().trim().max(40).optional(),
  status: schedulingResourceStatusSchema.optional(),
  building: z.string().trim().max(200).optional(),
});

export const schedulingEquipmentBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  campusId: schedulingUuidSchema,
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100_000),
});
export const schedulingEquipmentPatchSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  status: schedulingResourceStatusSchema.optional(),
});
export const schedulingListEquipmentQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  campusId: schedulingUuidSchema.optional(),
  status: schedulingResourceStatusSchema.optional(),
});

export const schedulingTimeSlotBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  campusId: optionalNullable(schedulingUuidSchema),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  startsTime: schedulingTimeSchema,
  endsTime: schedulingTimeSchema,
  isBreak: z.boolean().optional(),
  ordinal: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export const schedulingListTimeSlotsQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  campusId: schedulingUuidSchema.optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const calendarEventShape = {
  campusId: optionalNullable(schedulingUuidSchema),
  academicYearId: optionalNullable(schedulingUuidSchema),
  kindCode: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(300),
  description: optionalNullable(z.string().trim().max(2000)),
  startsOn: schedulingDateSchema,
  endsOn: schedulingDateSchema,
  startsTime: optionalNullable(schedulingTimeSchema),
  endsTime: optionalNullable(schedulingTimeSchema),
  blocksTeaching: z.boolean().optional(),
  audience: z.array(schedulingAudienceSchema).max(3).optional(),
};
export const schedulingCalendarEventBodySchema = z.object({ institutionId: schedulingUuidSchema, ...calendarEventShape });
export const schedulingCalendarEventPatchSchema = z.object(calendarEventShape);
export const schedulingListCalendarEventsQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  campusId: schedulingUuidSchema.optional(),
  from: schedulingDateSchema.optional(),
  to: schedulingDateSchema.optional(),
  blocksTeachingOnly: z.coerce.boolean().optional(),
  audience: schedulingAudienceSchema.optional(),
});

export const schedulingRoomTypeBodySchema = z.object({ code: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(200), active: z.boolean().optional() });
export const schedulingEventKindBodySchema = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  blocksTeachingDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const schedulingInstitutionQuerySchema = z.object({ institutionId: schedulingUuidSchema });
export const schedulingConflictPolicyBodySchema = z.object({ institutionId: schedulingUuidSchema, resourceKind: schedulingResourceKindSchema, mode: schedulingConflictModeSchema });
export const schedulingSettingsBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  timezone: z.string().trim().min(1).max(64).optional(),
  staffAvailabilityMode: z.enum(["OPEN", "CLOSED"]).optional(),
  maxGenerationWeeks: z.number().int().min(1).max(120).optional(),
  generationHorizonWeeks: z.number().int().min(1).max(120).optional(),
  allowSelfValidation: z.boolean().optional(),
  supervisorsPaid: z.boolean().optional(),
  openingStart: optionalNullable(schedulingTimeSchema),
  openingEnd: optionalNullable(schedulingTimeSchema),
  openingWeekdays: optionalNullable(z.array(schedulingWeekdaySchema).max(7)),
});

// ---------------------------------------------------------------------------
// Emplois du temps et patrons
// ---------------------------------------------------------------------------

export const schedulingTimetableBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  campusId: optionalNullable(schedulingUuidSchema),
  academicYearId: schedulingUuidSchema,
  periodId: optionalNullable(schedulingUuidSchema),
  name: z.string().trim().min(1).max(200),
  validFrom: schedulingDateSchema,
  validTo: schedulingDateSchema,
  weekAAnchor: optionalNullable(schedulingDateSchema),
});
export const schedulingTimetablePatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  validFrom: schedulingDateSchema.optional(),
  validTo: schedulingDateSchema.optional(),
  weekAAnchor: optionalNullable(schedulingDateSchema),
});
export const schedulingListTimetablesQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  academicYearId: schedulingUuidSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  campusId: schedulingUuidSchema.optional(),
});
export const schedulingCloneTimetableBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  validFrom: schedulingDateSchema,
  validTo: schedulingDateSchema,
  weekAAnchor: optionalNullable(schedulingDateSchema),
  academicYearId: schedulingUuidSchema.optional(),
  periodId: optionalNullable(schedulingUuidSchema),
  nodeMap: z.record(schedulingUuidSchema, schedulingUuidSchema).optional(),
  classroomMap: z.record(schedulingUuidSchema, schedulingUuidSchema).optional(),
});
export const schedulingGenerateBodySchema = z.object({ from: schedulingDateSchema, to: schedulingDateSchema, capByNodeHours: z.boolean().optional() });

export const schedulingEntryStaffSchema = z.object({ staffId: schedulingUuidSchema, role: schedulingEntryStaffRoleSchema.default("LEAD") });
export const schedulingEquipmentUseSchema = z.object({ equipmentId: schedulingUuidSchema, quantity: z.number().int().min(1).max(10_000).default(1) });

export const schedulingEntryBodySchema = z.object({
  kind: schedulingEntryKindSchema.optional(),
  classroomId: optionalNullable(schedulingUuidSchema),
  curriculumNodeId: optionalNullable(schedulingUuidSchema),
  offeringId: optionalNullable(schedulingUuidSchema),
  claimsClassroom: z.boolean().optional(),
  weekday: schedulingWeekdaySchema,
  startTime: schedulingTimeSchema,
  endTime: schedulingTimeSchema,
  timeSlotId: optionalNullable(schedulingUuidSchema),
  roomId: optionalNullable(schedulingUuidSchema),
  weekPattern: schedulingWeekPatternSchema.optional(),
  validFrom: optionalNullable(schedulingDateSchema),
  validTo: optionalNullable(schedulingDateSchema),
  deliveryMode: schedulingDeliveryModeSchema.optional(),
  title: optionalNullable(z.string().trim().max(300)),
  notes: optionalNullable(z.string().trim().max(2000)),
  staff: z.array(schedulingEntryStaffSchema).max(20).optional(),
  equipment: z.array(schedulingEquipmentUseSchema).max(20).optional(),
  propagate: z.enum(["NONE", "FUTURE_PLANNED"]).optional(),
  overrideReason: z.string().trim().min(5).max(500).optional(),
});
export const schedulingEntryBatchBodySchema = z.object({ entries: z.array(schedulingEntryBodySchema).min(1).max(500), overrideReason: z.string().trim().min(5).max(500).optional() });

// ---------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------

export const schedulingStaffAssignmentSchema = z.object({
  staffId: schedulingUuidSchema,
  role: schedulingStaffRoleSchema.optional(),
  replacesStaffId: optionalNullable(schedulingUuidSchema),
  isPaidRole: z.boolean().optional(),
});

export const schedulingCreateOccurrenceBodySchema = z
  .object({
    kind: schedulingOccurrenceKindSchema,
    title: optionalNullable(z.string().trim().max(300)),
    institutionId: schedulingUuidSchema.optional(),
    campusId: optionalNullable(schedulingUuidSchema),
    academicYearId: schedulingUuidSchema.optional(),
    classroomId: optionalNullable(schedulingUuidSchema),
    curriculumNodeId: optionalNullable(schedulingUuidSchema),
    offeringId: optionalNullable(schedulingUuidSchema),
    claimsClassroom: z.boolean().optional(),
    roomId: optionalNullable(schedulingUuidSchema),
    deliveryMode: schedulingDeliveryModeSchema.optional(),
    virtualSessionRef: optionalNullable(schedulingUuidSchema),
    notes: optionalNullable(z.string().trim().max(2000)),
    locationLabel: optionalNullable(z.string().trim().max(300)),
    attributes: z.record(z.unknown()).optional(),
    staff: z.array(schedulingStaffAssignmentSchema).max(20).optional(),
    equipment: z.array(schedulingEquipmentUseSchema).max(20).optional(),
    status: z.enum(["PLANNED", "HELD"]).optional(),
    override: schedulingOverrideSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    ...timeInputShape,
  })
  .refine(requiresWindow, { message: WINDOW_MESSAGE, path: ["startsAt"] });

export const schedulingAccountingBodySchema = z
  .object({
    staffId: schedulingUuidSchema,
    minutes: z.number().int().min(1).max(1440).optional(),
    institutionId: schedulingUuidSchema.optional(),
    academicYearId: schedulingUuidSchema.optional(),
    classroomId: optionalNullable(schedulingUuidSchema),
    curriculumNodeId: optionalNullable(schedulingUuidSchema),
    title: optionalNullable(z.string().trim().max(300)),
    role: schedulingStaffRoleSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    ...timeInputShape,
  })
  .refine((v) => (v.minutes !== undefined && v.date !== undefined) || requiresWindow(v), { message: "Précisez (date, minutes) ou une plage horaire.", path: ["minutes"] });

export const schedulingRescheduleBodySchema = z
  .object({ reason: z.string().trim().max(500).optional(), override: schedulingOverrideSchema.optional(), ...timeInputShape })
  .refine(requiresWindow, { message: WINDOW_MESSAGE, path: ["startsAt"] });
export const schedulingChangeRoomBodySchema = z.object({ roomId: schedulingUuidSchema.nullable(), reason: z.string().trim().max(500).optional(), override: schedulingOverrideSchema.optional() });
export const schedulingSetStaffBodySchema = z.object({ staff: z.array(schedulingStaffAssignmentSchema).max(20), reason: z.string().trim().max(500).optional(), override: schedulingOverrideSchema.optional() });
export const schedulingSubstituteBodySchema = z.object({
  originalStaffId: schedulingUuidSchema,
  substituteStaffId: schedulingUuidSchema,
  reason: schedulingReasonSchema,
  override: schedulingOverrideSchema.optional(),
});
export const schedulingCancelBodySchema = z.object({ reason: schedulingReasonSchema });
export const schedulingRestoreBodySchema = z.object({ reason: z.string().trim().max(500).optional(), override: schedulingOverrideSchema.optional() });
export const schedulingHoldBodySchema = z.object({ reason: z.string().trim().max(500).optional() });
export const schedulingUnholdBodySchema = z.object({ reason: schedulingReasonSchema });
export const schedulingOverrideBodySchema = schedulingOverrideSchema;
export const schedulingUnvalidateBodySchema = z.object({ reason: schedulingReasonSchema });
export const schedulingValidateBatchBodySchema = z.object({ occurrenceIds: z.array(schedulingUuidSchema).min(1).max(500) });
export const schedulingPaidMinutesBodySchema = z.object({ minutes: z.number().int().min(1).max(1440).nullable(), reason: z.string().trim().max(500).optional() });
export const schedulingUpdateOccurrenceBodySchema = z.object({
  title: optionalNullable(z.string().trim().max(300)),
  notes: optionalNullable(z.string().trim().max(2000)),
  locationLabel: optionalNullable(z.string().trim().max(300)),
  deliveryMode: schedulingDeliveryModeSchema.optional(),
  virtualSessionRef: optionalNullable(schedulingUuidSchema),
});

const pageShape = {
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};
export const schedulingListOccurrencesQuerySchema = z.object({
  from: schedulingDateSchema.optional(),
  to: schedulingDateSchema.optional(),
  institutionId: schedulingUuidSchema.optional(),
  classroomId: schedulingUuidSchema.optional(),
  offeringId: schedulingUuidSchema.optional(),
  roomId: schedulingUuidSchema.optional(),
  staffId: schedulingUuidSchema.optional(),
  curriculumNodeId: schedulingUuidSchema.optional(),
  timetableId: schedulingUuidSchema.optional(),
  status: schedulingOccurrenceStatusSchema.optional(),
  kind: schedulingOccurrenceKindSchema.optional(),
  validated: z.enum(["true", "false"]).optional(),
  ...pageShape,
});
export const schedulingWindowQuerySchema = z.object({
  from: schedulingDateSchema,
  to: schedulingDateSchema,
  includeCancelled: z.enum(["true", "false"]).optional(),
  ...pageShape,
});
export const schedulingPendingQuerySchema = z.object({
  from: schedulingDateSchema.optional(),
  to: schedulingDateSchema.optional(),
  classroomId: schedulingUuidSchema.optional(),
  staffId: schedulingUuidSchema.optional(),
  ...pageShape,
});

// ---------------------------------------------------------------------------
// Aides, rapports, export
// ---------------------------------------------------------------------------

export const schedulingPreviewBodySchema = z
  .object({
    kind: schedulingOccurrenceKindSchema.optional(),
    institutionId: schedulingUuidSchema.optional(),
    classroomId: optionalNullable(schedulingUuidSchema),
    offeringId: optionalNullable(schedulingUuidSchema),
    curriculumNodeId: optionalNullable(schedulingUuidSchema),
    claimsClassroom: z.boolean().optional(),
    roomId: optionalNullable(schedulingUuidSchema),
    staffIds: z.array(schedulingUuidSchema).max(20).optional(),
    staff: z.array(z.object({ staffId: schedulingUuidSchema, role: schedulingStaffRoleSchema.optional() })).max(20).optional(),
    equipment: z.array(schedulingEquipmentUseSchema).max(20).optional(),
    excludeOccurrenceId: schedulingUuidSchema.optional(),
    ...timeInputShape,
  })
  .refine(requiresWindow, { message: WINDOW_MESSAGE, path: ["startsAt"] });

export const schedulingSuggestSlotsBodySchema = z.object({
  institutionId: schedulingUuidSchema,
  durationMinutes: z.number().int().min(5).max(1440),
  staffIds: z.array(schedulingUuidSchema).max(20).optional(),
  classroomId: optionalNullable(schedulingUuidSchema),
  offeringId: optionalNullable(schedulingUuidSchema),
  claimsClassroom: z.boolean().optional(),
  roomId: optionalNullable(schedulingUuidSchema),
  roomType: z.string().trim().max(40).optional(),
  features: z.array(z.string().trim().max(100)).max(20).optional(),
  campusId: optionalNullable(schedulingUuidSchema),
  window: z.object({ from: schedulingDateSchema, to: schedulingDateSchema }),
  count: z.number().int().min(1).max(100).default(10),
  weekdays: z.array(schedulingWeekdaySchema).min(1).max(7).optional(),
  dayStart: schedulingTimeSchema.optional(),
  dayEnd: schedulingTimeSchema.optional(),
  stepMinutes: z.number().int().min(5).max(240).optional(),
  useTimeSlots: z.boolean().optional(),
});
export const schedulingSuggestSubstitutesBodySchema = z.object({ count: z.number().int().min(1).max(50).optional() });

export const schedulingRangeQuerySchema = z.object({ from: schedulingDateSchema, to: schedulingDateSchema, staffId: schedulingUuidSchema.optional() });
export const schedulingRoomOccupancyQuerySchema = z.object({ campusId: schedulingUuidSchema, from: schedulingDateSchema, to: schedulingDateSchema });
export const schedulingStaffLoadQuerySchema = z.object({ staffId: schedulingUuidSchema, week: schedulingDateSchema });
export const schedulingMissingQuerySchema = z.object({ from: schedulingDateSchema, to: schedulingDateSchema });

export const schedulingIcsQuerySchema = z.object({ scope: schedulingIcsScopeSchema, token: z.string().min(40).max(200) });
export const schedulingIcsDownloadQuerySchema = z.object({ scope: schedulingIcsScopeSchema, subjectId: schedulingUuidSchema, from: schedulingDateSchema.optional(), to: schedulingDateSchema.optional() });
export const schedulingIcsTokenBodySchema = z.object({
  scope: schedulingIcsScopeSchema,
  subjectId: schedulingUuidSchema,
  label: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export const schedulingIcsTokensQuerySchema = z.object({ scope: schedulingIcsScopeSchema, subjectId: schedulingUuidSchema });

// ---------------------------------------------------------------------------
// Réponses (DTO)
// ---------------------------------------------------------------------------

export const schedulingConflictViewDtoSchema = z.object({
  code: z.string(),
  severity: z.enum(["BLOCKING", "WARNING"]),
  resourceKind: schedulingResourceKindSchema,
  resourceId: z.string().nullable(),
  message: z.string(),
  with: z
    .object({ occurrenceId: z.string(), startsAt: z.string(), endsAt: z.string(), title: z.string().nullable(), classroomId: z.string().nullable() })
    .optional(),
});
export type SchedulingConflictViewDto = z.infer<typeof schedulingConflictViewDtoSchema>;

export const schedulingOccurrenceStaffDtoSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  role: schedulingStaffRoleSchema,
  replacesStaffId: z.string().nullable(),
  isPaidRole: z.boolean(),
  paidMinutes: z.number().int().nullable(),
  locked: z.boolean(),
  lockRef: z.string().nullable(),
});

export const schedulingOccurrenceDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  academicYearId: z.string(),
  timetableEntryId: z.string().nullable(),
  generatedFor: z.string().nullable(),
  kind: schedulingOccurrenceKindSchema,
  title: z.string().nullable(),
  classroomId: z.string().nullable(),
  curriculumNodeId: z.string().nullable(),
  offeringId: z.string().nullable(),
  claimsClassroom: z.boolean(),
  roomId: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  occursOn: z.string(),
  durationMinutes: z.number().int(),
  deliveryMode: schedulingDeliveryModeSchema,
  virtualSessionRef: z.string().nullable(),
  status: schedulingOccurrenceStatusSchema,
  heldAt: z.string().nullable(),
  heldSource: schedulingHeldSourceSchema.nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  validatedAt: z.string().nullable(),
  validatedBy: z.string().nullable(),
  origin: z.enum(["GENERATED", "AD_HOC", "ACCOUNTING", "IMPORT"]),
  conflictOverride: z.boolean(),
  needsReplacement: z.boolean(),
  replacementReason: z.string().nullable(),
  notes: z.string().nullable(),
  locationLabel: z.string().nullable(),
  staff: z.array(schedulingOccurrenceStaffDtoSchema),
  equipment: z.array(z.object({ equipmentId: z.string(), quantity: z.number().int() })),
  attendanceSubmitted: z.boolean().nullable().optional(),
});
export type SchedulingOccurrenceDto = z.infer<typeof schedulingOccurrenceDtoSchema>;

export const schedulingOccurrenceResultDtoSchema = z.object({ occurrence: schedulingOccurrenceDtoSchema, warnings: z.array(schedulingConflictViewDtoSchema) });
export const schedulingOccurrencePageDtoSchema = z.object({ items: z.array(schedulingOccurrenceDtoSchema), hasMore: z.boolean(), total: z.number().int().optional() });

export const schedulingPreviewResultDtoSchema = z.object({
  conflicts: z.array(schedulingConflictViewDtoSchema),
  blocking: z.boolean(),
  timezone: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

export const schedulingPayableHourLineDtoSchema = z.object({
  occurrenceId: z.string(),
  staffId: z.string(),
  occursOn: z.string(),
  minutes: z.number().int(),
  kind: schedulingOccurrenceKindSchema,
  classroomId: z.string().nullable(),
  nodeId: z.string().nullable(),
  offeringId: z.string().nullable(),
  title: z.string().nullable(),
  locked: z.boolean(),
  lockRef: z.string().nullable(),
});

export const schedulingGenerationReportDtoSchema = z.object({
  runId: z.string(),
  timetableId: z.string(),
  from: z.string(),
  to: z.string(),
  created: z.number().int(),
  skippedExisting: z.number().int(),
  skippedBlocked: z.number().int(),
  skippedConflict: z.number().int(),
  skippedCapped: z.number().int(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()),
  conflicts: z.array(z.object({ entryId: z.string(), date: z.string(), resourceKind: z.string(), resourceId: z.string(), message: z.string() })),
  batches: z.number().int(),
});

export const schedulingRoomDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string(),
  code: z.string(),
  name: z.string(),
  roomTypeCode: z.string(),
  capacity: z.number().int().nullable(),
  building: z.string().nullable(),
  floorLabel: z.string().nullable(),
  features: z.array(z.string()),
  status: schedulingResourceStatusSchema,
  notes: z.string().nullable(),
});
export const schedulingEquipmentDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string(),
  code: z.string(),
  label: z.string(),
  quantity: z.number().int(),
  status: schedulingResourceStatusSchema,
});
export const schedulingTimeSlotDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  code: z.string(),
  label: z.string(),
  startsTime: z.string(),
  endsTime: z.string(),
  isBreak: z.boolean(),
  ordinal: z.number().int(),
  active: z.boolean(),
});
export const schedulingCalendarEventDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  academicYearId: z.string().nullable(),
  kindCode: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startsOn: z.string(),
  endsOn: z.string(),
  startsTime: z.string().nullable(),
  endsTime: z.string().nullable(),
  blocksTeaching: z.boolean(),
  audience: z.array(schedulingAudienceSchema),
});
export const schedulingTimetableDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  academicYearId: z.string(),
  periodId: z.string().nullable(),
  name: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  validFrom: z.string(),
  validTo: z.string(),
  weekAAnchor: z.string().nullable(),
  clonedFromId: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export const schedulingEntryDtoSchema = z.object({
  id: z.string(),
  timetableId: z.string(),
  kind: schedulingEntryKindSchema,
  classroomId: z.string().nullable(),
  curriculumNodeId: z.string().nullable(),
  offeringId: z.string().nullable(),
  claimsClassroom: z.boolean(),
  weekday: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  timeSlotId: z.string().nullable(),
  roomId: z.string().nullable(),
  weekPattern: schedulingWeekPatternSchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  deliveryMode: schedulingDeliveryModeSchema,
  title: z.string().nullable(),
  staff: z.array(z.object({ staffId: z.string(), role: schedulingEntryStaffRoleSchema })),
  equipment: z.array(z.object({ equipmentId: z.string(), quantity: z.number().int() })),
});
export const schedulingSettingsDtoSchema = z.object({
  institutionId: z.string(),
  timezone: z.string(),
  staffAvailabilityMode: z.enum(["OPEN", "CLOSED"]),
  maxGenerationWeeks: z.number().int(),
  generationHorizonWeeks: z.number().int(),
  allowSelfValidation: z.boolean(),
  supervisorsPaid: z.boolean(),
  openingStart: z.string().nullable(),
  openingEnd: z.string().nullable(),
  openingWeekdays: z.array(z.number().int()).nullable(),
});

/** Événements publiés (charge `{ v: 1, … }`) : schémas de contrat pour les consommateurs. */
export const schedulingOccurrenceEventSchema = z
  .object({
    v: z.literal(1),
    occurrenceId: schedulingUuidSchema,
    kind: schedulingOccurrenceKindSchema,
    classroomId: schedulingUuidSchema.nullable(),
    offeringId: schedulingUuidSchema.nullable(),
    curriculumNodeId: schedulingUuidSchema.nullable(),
    roomId: schedulingUuidSchema.nullable(),
    startsAt: z.string(),
    endsAt: z.string(),
    occursOn: z.string(),
    status: schedulingOccurrenceStatusSchema,
    staffIds: z.array(schedulingUuidSchema),
  })
  .passthrough();
export const schedulingReplacementNeededEventSchema = z
  .object({ v: z.literal(1), occurrenceId: schedulingUuidSchema, reason: z.string(), occursOn: z.string() })
  .passthrough();
export const schedulingHoursLockedEventSchema = z.object({ v: z.literal(1), lockRef: z.string(), lines: z.number().int() });
/** `scheduling.occurrence.paid_minutes_changed` : minutes payées d'un intervenant sur une séance (consommé par payroll). */
export const schedulingPaidMinutesChangedEventSchema = z.object({ v: z.literal(1), occurrenceId: z.string().uuid(), staffId: z.string().uuid(), minutes: z.number().int() }).passthrough();

/**
 * Schéma de charge utile des événements PUBLIÉS par scheduling consommés par d'autres modules (attendance, payroll),
 * plus les événements de séance qui partagent la même forme (`occurrenceEventPayload`). Additif.
 */
export const schedulingEventPayloadSchemas = {
  "scheduling.occurrence.created": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.rescheduled": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.held": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.cancelled": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.validated": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.unvalidated": schedulingOccurrenceEventSchema,
  "scheduling.occurrence.paid_minutes_changed": schedulingPaidMinutesChangedEventSchema,
  "scheduling.occurrence.replacement_needed": schedulingReplacementNeededEventSchema,
  "scheduling.hours.locked": schedulingHoursLockedEventSchema,
} as const;

// ---------------------------------------------------------------------------
// Générateur d'emploi du temps (spec 017, question O-05)
// ---------------------------------------------------------------------------
//
// Le générateur construit une PROPOSITION (brouillon) d'emploi du temps hebdomadaire à partir des besoins
// (classe × matière × séances par semaine), des disponibilités et plafonds des enseignants, des salles et de la
// grille horaire. Il ne publie rien et n'écrase jamais un emploi du temps publié : un humain examine la
// proposition, puis l'applique dans un NOUVEAU brouillon (ou, après confirmation, dans un brouillon existant).

export const SCHEDULING_AUTOGEN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "APPLIED", "DISCARDED"] as const;
export const schedulingAutogenStatusSchema = z.enum(SCHEDULING_AUTOGEN_STATUSES);
export const SCHEDULING_AUTOGEN_REASONS = [
  "NO_CONTIGUOUS_PERIODS",
  "SLOT_CLOSED",
  "CLASS_BUSY",
  "REQUIREMENT_DAY_CAP",
  "TEACHER_UNAVAILABLE",
  "TEACHER_BUSY",
  "TEACHER_LIMIT",
  "NO_ROOM_CANDIDATE",
  "ROOM_BUSY",
  "CLASS_OVERLOADED",
] as const;

/** Plage horaire d'un jour de la semaine type (ex. « le mercredi après-midi »). */
export const schedulingAutogenRangeSchema = z
  .object({ weekday: schedulingWeekdaySchema, startTime: schedulingTimeSchema, endTime: schedulingTimeSchema })
  .refine((r) => r.endTime > r.startTime, { message: "L'heure de fin doit être postérieure à l'heure de début.", path: ["endTime"] });

export const schedulingAutogenWeightsSchema = z.object({
  gap: z.number().int().min(0).max(1000).optional(),
  teacherGap: z.number().int().min(0).max(1000).optional(),
  spread: z.number().int().min(0).max(1000).optional(),
  balance: z.number().int().min(0).max(1000).optional(),
  preference: z.number().int().min(0).max(1000).optional(),
  teacherChange: z.number().int().min(0).max(1000).optional(),
});

export const schedulingAutogenRequirementSchema = z.object({
  classroomId: schedulingUuidSchema,
  curriculumNodeId: schedulingUuidSchema,
  label: z.string().trim().max(200).optional(),
  /** Séances par semaine. */
  sessionsPerWeek: z.number().int().min(1).max(40),
  /** Durée d'une séance en périodes consécutives de la grille. */
  sessionPeriods: z.number().int().min(1).max(8).default(1),
  /** Enseignants candidats par ordre de préférence ; vide : voir `deriveTeachers`. */
  teacherIds: z.array(schedulingUuidSchema).max(10).default([]),
  needsRoom: z.boolean().default(true),
  roomType: z.string().trim().max(40).optional(),
  features: z.array(z.string().trim().max(100)).max(20).default([]),
  roomId: schedulingUuidSchema.optional(),
  /** Séances de ce besoin au plus par jour. */
  maxPerDay: z.number().int().min(1).max(10).optional(),
  /** Heures de début préférées (souple). */
  preferredStartTimes: z.array(schedulingTimeSchema).max(12).default([]),
});

export const schedulingAutogenTeacherSchema = z.object({
  staffId: schedulingUuidSchema,
  maxPeriodsPerDay: z.number().int().min(0).max(20).nullable().optional(),
  maxPeriodsPerWeek: z.number().int().min(0).max(100).nullable().optional(),
  unavailable: z.array(schedulingAutogenRangeSchema).max(100).default([]),
  avoid: z.array(schedulingAutogenRangeSchema).max(100).default([]),
  prefer: z.array(schedulingAutogenRangeSchema).max(100).default([]),
});

export const schedulingAutogenGridSchema = z.object({
  /** `TIME_SLOTS` : la grille de l'établissement (hors pauses) ; `REGULAR` : périodes régulières. */
  mode: z.enum(["TIME_SLOTS", "REGULAR"]).optional(),
  dayStart: schedulingTimeSchema.optional(),
  dayEnd: schedulingTimeSchema.optional(),
  periodMinutes: z.number().int().min(20).max(240).optional(),
});

export const schedulingAutogenRunBodySchema = z
  .object({
    institutionId: schedulingUuidSchema,
    campusId: optionalNullable(schedulingUuidSchema),
    academicYearId: schedulingUuidSchema,
    periodId: optionalNullable(schedulingUuidSchema),
    name: z.string().trim().min(1, "Le nom est requis.").max(200),
    /** Validité du futur emploi du temps (modifiable à l'application). */
    validFrom: schedulingDateSchema,
    validTo: schedulingDateSchema,
    /** Graine : la même graine redonne le même résultat. Défaut : dérivée de la demande. */
    seed: z.string().trim().min(1).max(100).optional(),
    /** Limite de temps de calcul (secondes). */
    timeLimitSeconds: z.number().int().min(1).max(600).default(20),
    /** Budget d'amélioration locale (itérations) : borne déterministe. */
    maxIterations: z.number().int().min(0).max(2_000_000).default(100_000),
    weights: schedulingAutogenWeightsSchema.optional(),
    weekdays: z.array(schedulingWeekdaySchema).min(1).max(7).optional(),
    grid: schedulingAutogenGridSchema.optional(),
    closedRanges: z.array(schedulingAutogenRangeSchema).max(100).default([]),
    requirements: z.array(schedulingAutogenRequirementSchema).min(1).max(3000),
    teachers: z.array(schedulingAutogenTeacherSchema).max(1000).default([]),
    /** Respecter l'occupation (enseignants, salles, classes) d'un autre emploi du temps. */
    fixedTimetableId: optionalNullable(schedulingUuidSchema),
    /** Pour les besoins sans enseignant : proposer ceux dont la compétence est déclarée pour la matière. */
    deriveTeachers: z.boolean().default(false),
    /** `AUTO` : calcul immédiat si la demande est petite, sinon tâche asynchrone. */
    mode: z.enum(["AUTO", "SYNC", "ASYNC"]).default("AUTO"),
  })
  .refine((b) => b.validTo >= b.validFrom, { message: "La fin de validité précède son début.", path: ["validTo"] });

export const schedulingAutogenListQuerySchema = z.object({
  institutionId: schedulingUuidSchema.optional(),
  status: schedulingAutogenStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const schedulingAutogenDefaultsQuerySchema = z.object({ institutionId: schedulingUuidSchema, campusId: schedulingUuidSchema.optional() });

export const schedulingAutogenApplyBodySchema = z.object({
  /** `NEW_DRAFT` : crée un nouveau brouillon ; `REPLACE_DRAFT` : remplace le contenu d'un brouillon existant (confirmation obligatoire). */
  mode: z.enum(["NEW_DRAFT", "REPLACE_DRAFT"]).default("NEW_DRAFT"),
  name: z.string().trim().min(1).max(200).optional(),
  validFrom: schedulingDateSchema.optional(),
  validTo: schedulingDateSchema.optional(),
  targetTimetableId: schedulingUuidSchema.optional(),
  /** Confirmation explicite : le contenu du brouillon cible sera remplacé. */
  confirmReplace: z.boolean().default(false),
  /** Confirmation explicite : la proposition laisse des séances non placées. */
  acceptUnplaced: z.boolean().default(false),
});
export const schedulingAutogenDiscardBodySchema = z.object({ reason: z.string().trim().max(500).optional() });

// ----- Réponses ---------------------------------------------------------------------------------------------

const autogenPeriodDtoSchema = z.object({ index: z.number().int(), startTime: z.string(), endTime: z.string(), label: z.string().nullable() });
const autogenWeightsDtoSchema = z.object({ gap: z.number().int(), teacherGap: z.number().int(), spread: z.number().int(), balance: z.number().int(), preference: z.number().int(), teacherChange: z.number().int() });

export const schedulingAutogenPlacementDtoSchema = z.object({
  requirementId: z.string(),
  sessionIndex: z.number().int(),
  classroomId: z.string(),
  curriculumNodeId: z.string(),
  teacherId: z.string().nullable(),
  roomId: z.string().nullable(),
  timeSlotId: z.string().nullable().optional(),
  weekday: z.number().int(),
  startPeriod: z.number().int(),
  periods: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
});
export const schedulingAutogenUnplacedDtoSchema = z.object({
  requirementId: z.string(),
  classroomId: z.string(),
  curriculumNodeId: z.string(),
  label: z.string(),
  requested: z.number().int(),
  missing: z.number().int(),
  reasons: z.array(z.object({ code: z.enum(SCHEDULING_AUTOGEN_REASONS), count: z.number().int(), detail: z.string().optional() })),
});
export const schedulingAutogenResultDtoSchema = z.object({
  grid: z.object({ weekdays: z.array(z.number().int()), periods: z.array(autogenPeriodDtoSchema) }),
  placements: z.array(schedulingAutogenPlacementDtoSchema),
  unplaced: z.array(schedulingAutogenUnplacedDtoSchema),
  score: z.object({ softCost: z.number().int(), initialSoftCost: z.number().int(), unplacedSessions: z.number().int(), breakdown: autogenWeightsDtoSchema }),
  stats: z.object({
    sessions: z.number().int(),
    placed: z.number().int(),
    iterations: z.number().int(),
    accepted: z.number().int(),
    improvements: z.number().int(),
    stoppedBy: z.enum(["ITERATIONS", "TIME_LIMIT", "NOTHING_TO_IMPROVE"]),
    elapsedMs: z.number().int(),
    seed: z.string(),
  }),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), requirementId: z.string().optional() })),
  /** Libellés pour l'affichage (identifiant → libellé). */
  labels: z.object({ classrooms: z.record(z.string()), staff: z.record(z.string()), rooms: z.record(z.string()), nodes: z.record(z.string()) }),
  /** Un emploi du temps publié existe déjà pour cette année / période : la proposition ne le remplace jamais. */
  publishedTimetable: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export const schedulingAutogenRunDtoSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  academicYearId: z.string(),
  periodId: z.string().nullable(),
  name: z.string(),
  status: schedulingAutogenStatusSchema,
  seed: z.string(),
  summary: z
    .object({ sessions: z.number().int(), placed: z.number().int(), unplacedSessions: z.number().int(), softCost: z.number().int(), requirements: z.number().int() })
    .partial()
    .nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  fixedTimetableId: z.string().nullable(),
  appliedTimetableId: z.string().nullable(),
  requestedBy: z.string().nullable(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  discardedAt: z.string().nullable(),
  /** Paramètres tels qu'enregistrés (relecture / relance). */
  params: z.record(z.unknown()),
});
export const schedulingAutogenRunDetailDtoSchema = z.object({ run: schedulingAutogenRunDtoSchema, result: schedulingAutogenResultDtoSchema.nullable() });
export const schedulingAutogenStartedDtoSchema = z.object({ run: schedulingAutogenRunDtoSchema, executed: z.boolean() });
export const schedulingAutogenAppliedDtoSchema = z.object({
  run: schedulingAutogenRunDtoSchema,
  timetable: schedulingTimetableDtoSchema,
  entriesCreated: z.number().int(),
  entriesReplaced: z.number().int(),
  unplacedSessions: z.number().int(),
  /** Un emploi du temps publié existe déjà : archivez-le avant de publier ce brouillon. */
  publishedTimetable: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export const schedulingAutogenDefaultsDtoSchema = z.object({
  weekdays: z.array(z.number().int()),
  periods: z.array(autogenPeriodDtoSchema),
  gridSource: z.enum(["TIME_SLOTS", "REGULAR", "NONE"]),
  weights: autogenWeightsDtoSchema,
  timeLimitSeconds: z.object({ default: z.number().int(), max: z.number().int() }),
  maxIterations: z.object({ default: z.number().int(), max: z.number().int() }),
  syncSessionLimit: z.number().int(),
  rooms: z.number().int(),
  availabilityMode: z.enum(["OPEN", "CLOSED"]),
  ports: z.object({ academic: z.boolean(), people: z.boolean() }),
});
