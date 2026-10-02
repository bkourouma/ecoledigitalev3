export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  institution: uuid(1),
  campus: uuid(10),
  classroom: uuid(500),
  staff: uuid(4000),
  staff2: uuid(4001),
  room: uuid(800),
  occurrence: uuid(9000),
  timetable: uuid(9500),
};

export function occurrence(over: Record<string, unknown> = {}) {
  return {
    id: IDS.occurrence,
    institutionId: IDS.institution,
    campusId: IDS.campus,
    academicYearId: uuid(100),
    timetableEntryId: null,
    generatedFor: null,
    kind: "LESSON",
    title: "Mathématiques",
    classroomId: IDS.classroom,
    curriculumNodeId: null,
    offeringId: null,
    claimsClassroom: true,
    roomId: IDS.room,
    startsAt: "2026-10-01T08:00:00.000Z",
    endsAt: "2026-10-01T09:00:00.000Z",
    occursOn: "2026-10-01",
    durationMinutes: 60,
    deliveryMode: "IN_PERSON",
    virtualSessionRef: null,
    status: "PLANNED",
    heldAt: null,
    heldSource: null,
    cancelledAt: null,
    cancelReason: null,
    validatedAt: null,
    validatedBy: null,
    origin: "GENERATED",
    conflictOverride: false,
    needsReplacement: false,
    replacementReason: null,
    notes: null,
    locationLabel: null,
    staff: [{ id: uuid(9100), staffId: IDS.staff, role: "LEAD", replacesStaffId: null, isPaidRole: true, paidMinutes: null, locked: false, lockRef: null }],
    equipment: [],
    attendanceSubmitted: null,
    ...over,
  };
}

export const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, hasMore: false, ...extra });

export function room(over: Record<string, unknown> = {}) {
  return {
    id: IDS.room,
    institutionId: IDS.institution,
    campusId: IDS.campus,
    code: "S101",
    name: "Salle 101",
    roomTypeCode: "CLASSROOM",
    capacity: 40,
    building: "Bloc A",
    floorLabel: null,
    features: [],
    status: "AVAILABLE",
    notes: null,
    ...over,
  };
}

export function timetable(over: Record<string, unknown> = {}) {
  return {
    id: IDS.timetable,
    institutionId: IDS.institution,
    campusId: null,
    academicYearId: uuid(100),
    periodId: null,
    name: "Emploi du temps 2026-2027",
    status: "DRAFT",
    validFrom: "2026-09-01",
    validTo: "2027-06-30",
    weekAAnchor: null,
    clonedFromId: null,
    publishedAt: null,
    ...over,
  };
}

export function entry(over: Record<string, unknown> = {}) {
  return {
    id: uuid(9600),
    timetableId: IDS.timetable,
    kind: "LESSON",
    classroomId: IDS.classroom,
    curriculumNodeId: null,
    offeringId: null,
    claimsClassroom: true,
    weekday: 1,
    startTime: "08:00",
    endTime: "09:00",
    timeSlotId: null,
    roomId: IDS.room,
    weekPattern: "EVERY",
    validFrom: null,
    validTo: null,
    deliveryMode: "IN_PERSON",
    title: "Mathématiques",
    staff: [{ staffId: IDS.staff, role: "LEAD" }],
    equipment: [],
    ...over,
  };
}

export const blockingConflict = {
  code: "scheduling.staff_busy",
  severity: "BLOCKING" as const,
  resourceKind: "STAFF" as const,
  resourceId: IDS.staff,
  message: "L'intervenant est déjà occupé de 08:00 à 09:00.",
  with: { occurrenceId: uuid(9001), startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z", title: "Physique", classroomId: null },
};

export function institution(over: Record<string, unknown> = {}) {
  return { id: IDS.institution, tenantId: uuid(2), code: "eco-test", name: "École test", pack: "SECONDARY", educationSystem: "CI", countryCode: "CI", status: "ACTIVE", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z", ...over };
}

export function campus(over: Record<string, unknown> = {}) {
  return { id: IDS.campus, tenantId: uuid(2), institutionId: IDS.institution, code: "principal", name: "Campus principal", address: null, city: null, phone: null, isDefault: true, status: "ACTIVE", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z", ...over };
}
