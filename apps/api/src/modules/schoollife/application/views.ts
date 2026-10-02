/**
 * Présentation des enregistrements en DTO de contrat. LE MASQUAGE est ici : un élément `CONFIDENTIAL` est rendu SANS contenu
 * (`masked: true`, type, motif, description, déclarations à `null`) tant qu'il n'est pas lu par `readConfidential` (lecture
 * journalisée). Aucun texte libre n'est jamais publié en événement.
 */
import type {
  SchoolLifeAppealDto,
  SchoolLifeConvocationDto,
  SchoolLifeEffectDto,
  SchoolLifeFamilyItemDto,
  SchoolLifeIncidentDto,
  SchoolLifeMeasureDto,
  SchoolLifeNoteDto,
  SchoolLifeEventTypeDto,
  SchoolLifeScaleDto,
  SchoolLifeSeverityDto,
  SchoolLifeSettingsDto,
} from "@ecoledigitale/contracts/src/v2/schoollife";
import { isMaskedFor } from "../domain/confidentiality";
import type { AppealRow, ConvocationRow, EffectRow, EventTypeRow, IncidentRow, InvolvementRow, MeasureRow, NoteRow, ScaleItemRow, ScaleRow, SettingsRow, SeverityRow } from "../infrastructure/rows";
import { isoOf } from "./support";

export interface ViewContext {
  readonly types: ReadonlyMap<string, EventTypeRow>;
  readonly names: ReadonlyMap<string, string>;
}

const iso = (d: Date): string => d.toISOString();

export const settingsDto = (r: SettingsRow): SchoolLifeSettingsDto => ({ ...r });
export const severityDto = (r: SeverityRow): SchoolLifeSeverityDto => ({ ...r });
export const eventTypeDto = (r: EventTypeRow): SchoolLifeEventTypeDto => ({ ...r });

export function incidentDto(row: IncidentRow, involvements: readonly InvolvementRow[], vc: ViewContext, options: { unmask?: boolean; showStatements?: boolean } = {}): SchoolLifeIncidentDto {
  const masked = isMaskedFor(row.confidentiality) && options.unmask !== true;
  return {
    id: row.id,
    masked,
    typeId: row.typeId,
    typeLabel: masked ? null : (vc.types.get(row.typeId)?.label ?? null),
    severityCode: masked ? null : row.severityCode,
    occurredAt: iso(row.occurredAt),
    status: row.status,
    confidentiality: row.confidentiality,
    institutionId: row.institutionId,
    academicYearId: row.academicYearId,
    reportedBy: row.reportedBy,
    reportedByName: row.reportedByName,
    assignedTo: row.assignedTo,
    location: masked ? null : row.location,
    description: masked ? null : row.description,
    contextNote: masked ? null : row.contextNote,
    resolutionNote: masked ? null : row.resolutionNote,
    involvements: involvements
      .filter((v) => v.incidentId === row.id)
      .map((v) => ({
        id: v.id,
        enrollmentId: v.enrollmentId,
        studentId: v.studentId,
        studentName: vc.names.get(v.studentId) ?? null,
        role: v.role,
        statement: masked || options.showStatements !== true ? null : v.statement,
      })),
    createdAt: iso(row.createdAt),
    closedAt: isoOf(row.closedAt),
  };
}

export const appealDto = (a: AppealRow): SchoolLifeAppealDto => ({
  id: a.id,
  measureId: a.measureId,
  filedByName: a.filedByName,
  filedAt: iso(a.filedAt),
  reason: a.reason,
  status: a.status,
  decidedByName: a.decidedByName,
  decidedAt: isoOf(a.decidedAt),
  decisionNote: a.decisionNote,
});

export function measureDto(row: MeasureRow, appeals: readonly AppealRow[], vc: ViewContext, options: { unmask?: boolean } = {}): SchoolLifeMeasureDto {
  const masked = isMaskedFor(row.confidentiality) && options.unmask !== true;
  const type = vc.types.get(row.typeId);
  return {
    id: row.id,
    masked,
    institutionId: row.institutionId,
    academicYearId: row.academicYearId,
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    studentName: vc.names.get(row.studentId) ?? null,
    classroomId: row.classroomId,
    typeId: row.typeId,
    typeLabel: masked ? null : (type?.label ?? null),
    kind: row.kind,
    incidentId: row.incidentId,
    severityCode: masked ? null : row.severityCode,
    reason: masked ? null : row.reason,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    confidentiality: row.confidentiality,
    visibleToGuardians: row.visibleToGuardians,
    requiresValidation: type?.requiresValidation ?? false,
    requiresFourEyes: type?.requiresFourEyes ?? false,
    appealable: type?.appealable ?? false,
    proposedBy: row.proposedBy,
    proposedByName: row.proposedByName,
    proposedAt: iso(row.proposedAt),
    validatedByName: row.validatedByName,
    validatedAt: isoOf(row.validatedAt),
    validationNote: masked ? null : row.validationNote,
    notifiedAt: isoOf(row.notifiedAt),
    executedAt: isoOf(row.executedAt),
    revokedAt: isoOf(row.revokedAt),
    revokedReason: masked ? null : row.revokedReason,
    cancelReason: masked ? null : row.cancelReason,
    appeals: masked ? [] : appeals.filter((a) => a.measureId === row.id).map(appealDto),
  };
}

export function noteDto(row: NoteRow, vc: ViewContext, options: { unmask?: boolean } = {}): SchoolLifeNoteDto {
  const masked = isMaskedFor(row.confidentiality) && options.unmask !== true;
  return {
    id: row.id,
    masked,
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    studentName: vc.names.get(row.studentId) ?? null,
    typeId: row.typeId,
    typeLabel: masked ? null : (vc.types.get(row.typeId)?.label ?? null),
    kind: row.kind,
    body: masked ? null : row.body,
    occurredOn: row.occurredOn,
    visibility: row.visibility,
    confidentiality: row.confidentiality,
    authorId: row.authorId,
    authorName: row.authorName,
    status: row.status,
    withdrawnReason: masked ? null : row.withdrawnReason,
    createdAt: iso(row.createdAt),
  };
}

export function convocationDto(row: ConvocationRow, vc: ViewContext, options: { unmask?: boolean } = {}): SchoolLifeConvocationDto {
  const masked = isMaskedFor(row.confidentiality) && options.unmask !== true;
  return {
    id: row.id,
    masked,
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    studentName: vc.names.get(row.studentId) ?? null,
    guardianIds: row.guardianIds,
    reasonKind: row.reasonKind,
    reason: masked ? null : row.reason,
    relatedMeasureId: row.relatedMeasureId,
    relatedIncidentId: row.relatedIncidentId,
    scheduledAt: iso(row.scheduledAt),
    location: masked ? null : row.location,
    status: row.status,
    convenedByName: row.convenedByName,
    sentAt: isoOf(row.sentAt),
    acknowledgedAt: isoOf(row.acknowledgedAt),
    heldAt: isoOf(row.heldAt),
    outcomeNote: masked ? null : row.outcomeNote,
    cancelReason: masked ? null : row.cancelReason,
    rescheduledFromId: row.rescheduledFromId,
    confidentiality: row.confidentiality,
  };
}

export const effectDto = (e: EffectRow): SchoolLifeEffectDto => ({
  id: e.id,
  measureId: e.measureId,
  studentId: e.studentId,
  effectKind: e.effectKind,
  status: e.status,
  appliedStatus: e.appliedStatus,
  lastError: e.lastError,
  appliedAt: isoOf(e.appliedAt),
  skippedReason: e.skippedReason,
  revertReason: e.revertReason,
  createdAt: iso(e.createdAt),
});

export function scaleDto(row: ScaleRow, items: readonly ScaleItemRow[], types: ReadonlyMap<string, EventTypeRow>): SchoolLifeScaleDto {
  return {
    id: row.id,
    institutionId: row.institutionId,
    code: row.code,
    label: row.label,
    gradeLevelId: row.gradeLevelId,
    initialPoints: row.initialPoints,
    minPoints: row.minPoints,
    maxPoints: row.maxPoints,
    resetScope: row.resetScope,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    sourceKind: row.sourceKind,
    isPlaceholder: row.sourceKind === "placeholder",
    items: items.filter((i) => i.scaleId === row.id).map((i) => ({ eventTypeId: i.eventTypeId, eventTypeLabel: types.get(i.eventTypeId)?.label ?? null, pointsDelta: i.pointsDelta })),
  };
}

// ---------------------------------------------------------------------------
// Familles et élèves : uniquement ce que `audience_may_see` laisse passer (les lignes arrivent DÉJÀ filtrées par la base)
// ---------------------------------------------------------------------------

export function familyMeasureItem(row: MeasureRow, type: EventTypeRow | undefined, appeals: readonly AppealRow[]): SchoolLifeFamilyItemDto {
  const appeal = [...appeals].filter((a) => a.measureId === row.id).sort((a, b) => b.filedAt.getTime() - a.filedAt.getTime())[0];
  return {
    id: row.id,
    entityKind: "MEASURE",
    title: type?.label ?? "Mesure de vie scolaire",
    kind: row.kind,
    status: row.status,
    occurredOn: row.notifiedAt ? row.notifiedAt.toISOString().slice(0, 10) : null,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    scheduledAt: null,
    location: null,
    text: row.reason,
    appealable: (type?.appealable ?? false) && (row.status === "NOTIFIED" || row.status === "EXECUTED") && !appeal,
    appealStatus: appeal?.status ?? null,
    canAcknowledge: false,
  };
}

export function familyNoteItem(row: NoteRow, type: EventTypeRow | undefined): SchoolLifeFamilyItemDto {
  return {
    id: row.id,
    entityKind: "NOTE",
    title: type?.label ?? (row.kind === "ENCOURAGEMENT" ? "Encouragement" : "Observation"),
    kind: row.kind,
    status: row.status,
    occurredOn: row.occurredOn,
    startsOn: null,
    endsOn: null,
    scheduledAt: null,
    location: null,
    text: row.body,
    appealable: false,
    appealStatus: null,
    canAcknowledge: false,
  };
}

export function familyConvocationItem(row: ConvocationRow, options: { canAcknowledge: boolean }): SchoolLifeFamilyItemDto {
  return {
    id: row.id,
    entityKind: "CONVOCATION",
    title: "Convocation",
    kind: row.reasonKind,
    status: row.status,
    occurredOn: null,
    startsOn: null,
    endsOn: null,
    scheduledAt: iso(row.scheduledAt),
    location: row.location,
    text: row.reason,
    appealable: false,
    appealStatus: null,
    canAcknowledge: options.canAcknowledge && (row.status === "SENT"),
  };
}
