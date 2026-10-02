/**
 * Lignes SQL typées. Les requêtes les produisent en camelCase (alias) avec les dates civiles en texte (`::text`) :
 * aucun mapper, aucune dérive de nom entre le SQL et le code.
 */
export interface SettingsRow {
  institutionId: string;
  conductPointsEnabled: boolean;
  confidentialReadRequiresPurpose: boolean;
  retentionDays: number | null;
}

export interface SeverityRow {
  id: string;
  code: string;
  label: string;
  rank: number;
  active: boolean;
}

export interface EventTypeRow {
  id: string;
  code: string;
  label: string;
  kind: "INCIDENT" | "SANCTION" | "WARNING" | "ENCOURAGEMENT" | "TEMP_EXCLUSION" | "OBSERVATION";
  defaultSeverityCode: string | null;
  requiresValidation: boolean;
  requiresFourEyes: boolean;
  approverPermission: string | null;
  notifyGuardians: boolean;
  visibleToGuardians: boolean;
  confidentialityDefault: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL";
  requiresDates: boolean;
  appealable: boolean;
  isPlaceholder: boolean;
  sortOrder: number;
  active: boolean;
}

export interface IncidentRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  typeId: string;
  severityCode: string | null;
  occurredAt: Date;
  location: string | null;
  description: string;
  contextNote: string | null;
  status: "DECLARED" | "UNDER_REVIEW" | "CONFIRMED" | "DISMISSED" | "CLOSED";
  confidentiality: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL";
  reportedBy: string;
  reportedByName: string;
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface InvolvementRow {
  id: string;
  incidentId: string;
  enrollmentId: string;
  studentId: string;
  role: "AUTHOR" | "VICTIM" | "WITNESS" | "OTHER";
  statement: string | null;
}

export interface MeasureRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  classroomId: string | null;
  typeId: string;
  kind: "SANCTION" | "WARNING" | "TEMP_EXCLUSION";
  incidentId: string | null;
  severityCode: string | null;
  reason: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "PROPOSED" | "VALIDATED" | "NOTIFIED" | "EXECUTED" | "APPEALED" | "REVOKED" | "REJECTED" | "CANCELLED";
  proposedBy: string;
  proposedByName: string;
  proposedAt: Date;
  validatedBy: string | null;
  validatedByName: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
  notifiedAt: Date | null;
  notificationRef: string | null;
  executedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  cancelReason: string | null;
  visibleToGuardians: boolean;
  confidentiality: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL";
}

export interface AppealRow {
  id: string;
  measureId: string;
  filedBy: string;
  filedByName: string;
  filedAt: Date;
  reason: string;
  status: "FILED" | "UPHELD" | "OVERTURNED" | "WITHDRAWN";
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface EffectRow {
  id: string;
  measureId: string;
  studentId: string;
  effectKind: "STUDENT_STATUS_REQUEST";
  status: "AWAITING_HUMAN" | "APPLIED" | "FAILED" | "SKIPPED" | "REVERTED";
  appliedStatus: "SUSPENDED" | "EXCLUDED" | null;
  lastError: string | null;
  appliedAt: Date | null;
  skippedReason: string | null;
  revertReason: string | null;
  createdAt: Date;
}

export interface NoteRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  typeId: string;
  kind: "ENCOURAGEMENT" | "OBSERVATION";
  body: string;
  occurredOn: string;
  visibility: "STAFF_ONLY" | "GUARDIANS" | "STUDENT_AND_GUARDIANS";
  confidentiality: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL";
  authorId: string;
  authorName: string;
  status: "ACTIVE" | "WITHDRAWN";
  withdrawnReason: string | null;
  createdAt: Date;
}

export interface ConvocationRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  guardianIds: string[];
  reasonKind: "DISCIPLINE" | "ABSENCES" | "ACADEMIC" | "HEALTH" | "OTHER";
  reason: string;
  relatedMeasureId: string | null;
  relatedIncidentId: string | null;
  scheduledAt: Date;
  location: string | null;
  status: "DRAFT" | "SENT" | "ACKNOWLEDGED" | "HELD" | "NO_SHOW" | "CANCELLED" | "RESCHEDULED";
  convenedBy: string;
  convenedByName: string;
  sentAt: Date | null;
  notificationRef: string | null;
  acknowledgedAt: Date | null;
  acknowledgedByGuardianId: string | null;
  heldAt: Date | null;
  outcomeNote: string | null;
  cancelReason: string | null;
  rescheduledFromId: string | null;
  confidentiality: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL";
}

export interface ScaleRow {
  id: string;
  institutionId: string;
  code: string;
  label: string;
  gradeLevelId: string | null;
  initialPoints: number;
  minPoints: number | null;
  maxPoints: number | null;
  resetScope: "PERIOD" | "YEAR" | "NEVER";
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  sourceKind: "regulation" | "institution" | "placeholder";
}

export interface ScaleItemRow {
  scaleId: string;
  eventTypeId: string;
  pointsDelta: number;
}

export interface MovementRow {
  id: string;
  scaleId: string;
  enrollmentId: string;
  studentId: string;
  academicYearId: string;
  academicPeriodId: string | null;
  delta: number;
  reason: string;
  sourceKind: "MEASURE" | "NOTE" | "MANUAL_ADJUSTMENT";
  sourceId: string | null;
  reversesId: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface LifeEventRow {
  id: string;
  entityKind: "INCIDENT" | "MEASURE" | "NOTE" | "CONVOCATION" | "APPEAL" | "SCALE";
  entityId: string;
  studentId: string | null;
  action: "CREATED" | "STATUS_CHANGED";
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  actorKind: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface ConfidentialReadRow {
  id: string;
  entityKind: "INCIDENT" | "MEASURE" | "NOTE" | "CONVOCATION";
  entityId: string;
  readerUserId: string;
  purpose: string;
  occurredAt: Date;
}
