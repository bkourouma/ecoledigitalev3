/** Fabriques de réponses d'API conformes aux contrats `schoollife` (le client valide chaque réponse par son schéma Zod). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  institution: uuid(1),
  year: uuid(100),
  classroom: uuid(300),
  student: uuid(11),
  student2: uuid(12),
  enrollment: uuid(611),
  enrollment2: uuid(612),
  typeInc: uuid(901),
  typeSanc: uuid(902),
  typeExcl: uuid(903),
  typeEnc: uuid(904),
  typeObs: uuid(905),
  typeWarn: uuid(906),
};

const T = "2026-11-02T09:30:00.000Z";

export function incidentDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(5001),
    masked: false,
    typeId: IDS.typeInc,
    typeLabel: "Type incident (test)",
    severityCode: null,
    occurredAt: T,
    status: "DECLARED",
    confidentiality: "STANDARD",
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    reportedBy: uuid(9),
    reportedByName: "Mme Éducatrice",
    assignedTo: null,
    location: "Cour",
    description: "Altercation dans la cour",
    contextNote: null,
    resolutionNote: null,
    involvements: [{ id: uuid(5101), enrollmentId: IDS.enrollment, studentId: IDS.student, studentName: "KOUASSI Awa", role: "AUTHOR", statement: null }],
    createdAt: T,
    closedAt: null,
    ...over,
  };
}

export function appealDto(over: Record<string, unknown> = {}) {
  return { id: uuid(7001), measureId: uuid(6001), filedByName: "Parent Un", filedAt: T, reason: "Je conteste cette décision", status: "FILED", decidedByName: null, decidedAt: null, decisionNote: null, ...over };
}

export function measureDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(6001),
    masked: false,
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    classroomId: IDS.classroom,
    typeId: IDS.typeSanc,
    typeLabel: "Type sanction (test)",
    kind: "SANCTION",
    incidentId: null,
    severityCode: null,
    reason: "Comportement répété en classe",
    startsOn: null,
    endsOn: null,
    status: "PROPOSED",
    confidentiality: "STANDARD",
    visibleToGuardians: true,
    requiresValidation: true,
    requiresFourEyes: true,
    appealable: true,
    proposedBy: uuid(9),
    proposedByName: "Mme Éducatrice",
    proposedAt: T,
    validatedByName: null,
    validatedAt: null,
    validationNote: null,
    notifiedAt: null,
    executedAt: null,
    revokedAt: null,
    revokedReason: null,
    cancelReason: null,
    appeals: [],
    ...over,
  };
}

export function noteDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(8001),
    masked: false,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    typeId: IDS.typeEnc,
    typeLabel: "Type encouragement (test)",
    kind: "ENCOURAGEMENT",
    body: "Excellente participation",
    occurredOn: "2026-11-02",
    visibility: "STUDENT_AND_GUARDIANS",
    confidentiality: "STANDARD",
    authorId: uuid(9),
    authorName: "M. Enseignant",
    status: "ACTIVE",
    withdrawnReason: null,
    createdAt: T,
    ...over,
  };
}

export function convocationDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(8501),
    masked: false,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    guardianIds: [uuid(21)],
    reasonKind: "DISCIPLINE",
    reason: "Entretien suite à un incident",
    relatedMeasureId: null,
    relatedIncidentId: null,
    scheduledAt: "2026-12-01T08:00:00.000Z",
    location: "Bureau de la direction",
    status: "DRAFT",
    convenedByName: "Mme Éducatrice",
    sentAt: null,
    acknowledgedAt: null,
    heldAt: null,
    outcomeNote: null,
    cancelReason: null,
    rescheduledFromId: null,
    confidentiality: "STANDARD",
    ...over,
  };
}

export function effectDto(over: Record<string, unknown> = {}) {
  return { id: uuid(9501), measureId: uuid(6002), studentId: IDS.student, effectKind: "STUDENT_STATUS_REQUEST", status: "AWAITING_HUMAN", appliedStatus: null, lastError: null, appliedAt: null, skippedReason: null, revertReason: null, createdAt: T, ...over };
}

export function lifeDto(over: Record<string, unknown> = {}) {
  return {
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    enrollmentId: IDS.enrollment,
    clearance: "STANDARD",
    incidents: [],
    measures: [],
    notes: [],
    convocations: [],
    conduct: { studentId: IDS.student, enabled: false, balance: null, movements: [] },
    attendance: { available: true, absences: [], summary: null },
    history: [],
    ...over,
  };
}

export function referenceDto(over: Record<string, unknown> = {}) {
  const type = (id: string, code: string, kind: string, extra: Record<string, unknown> = {}) => ({
    id, code, label: `Type ${code}`, kind, defaultSeverityCode: null, requiresValidation: false, requiresFourEyes: false, approverPermission: null, notifyGuardians: false,
    visibleToGuardians: true, confidentialityDefault: "STANDARD", requiresDates: false, appealable: false, isPlaceholder: true, sortOrder: 0, active: true, ...extra,
  });
  return {
    settings: [{ institutionId: IDS.institution, conductPointsEnabled: false, confidentialReadRequiresPurpose: true, retentionDays: null }],
    severityLevels: [{ id: uuid(801), code: "LOW", label: "Faible", rank: 1, active: true }],
    eventTypes: [
      type(IDS.typeInc, "INC", "INCIDENT"),
      type(IDS.typeSanc, "SANC", "SANCTION", { requiresValidation: true, requiresFourEyes: true, appealable: true, notifyGuardians: true }),
      type(IDS.typeExcl, "EXCL", "TEMP_EXCLUSION", { requiresValidation: true, requiresFourEyes: true, requiresDates: true, appealable: true }),
      type(IDS.typeEnc, "ENC", "ENCOURAGEMENT"),
      type(IDS.typeObs, "OBS", "OBSERVATION", { visibleToGuardians: false, confidentialityDefault: "RESTRICTED" }),
      type(IDS.typeWarn, "WARN", "WARNING"),
    ],
    ...over,
  };
}

export const familyItem = (over: Record<string, unknown> = {}) => ({
  id: uuid(6001),
  entityKind: "MEASURE",
  title: "Type sanction (test)",
  kind: "SANCTION",
  status: "NOTIFIED",
  occurredOn: "2026-11-03",
  startsOn: null,
  endsOn: null,
  scheduledAt: null,
  location: null,
  text: "Comportement répété en classe",
  appealable: true,
  appealStatus: null,
  canAcknowledge: false,
  ...over,
});

export const dashboardDto = (over: Record<string, unknown> = {}) => ({
  openIncidents: 2,
  measuresToValidate: 3,
  activeExclusions: 1,
  convocationsToHold: 4,
  effectsAwaitingHuman: 1,
  recentIncidents: [incidentDto()],
  pendingMeasures: [measureDto()],
  upcomingConvocations: [convocationDto({ status: "SENT" })],
  ...over,
});
