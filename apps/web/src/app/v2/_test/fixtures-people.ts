/** Jeux de données `people` / inscriptions conformes aux contrats v2. */
import { uuid } from "./fixtures";

export function enrollment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(1000),
    institutionId: uuid(1),
    campusId: null,
    academicYearId: uuid(100),
    studentId: uuid(2000),
    classroomId: uuid(500),
    mode: "CLASS",
    status: "ACTIVE",
    registrationNumber: "2026-0001",
    enrolledOn: "2026-09-05",
    endedOn: null,
    endReason: null,
    isRepeating: false,
    isTransferIn: false,
    originSchool: null,
    previousEnrollmentId: null,
    fundingType: "PRIVATE",
    assignmentReference: null,
    assignmentIssuedOn: null,
    funderLabel: null,
    fundingNotes: null,
    outcomeCode: null,
    outcomeDecidedAt: null,
    outcomeSourceRef: null,
    sourceKind: null,
    sourceRef: null,
    confirmedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    ...over,
  };
}

export function studentSummary(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(2000),
    personId: uuid(2100),
    studentNumber: "EL-0001",
    sequenceNumber: 1,
    lastName: "TRAORE",
    firstName: "Awa",
    displayName: "TRAORE Awa",
    sex: "F",
    status: "ACTIVE",
    hasPhoto: false,
    currentEnrollment: null,
    ...over,
  };
}

export function studentDetail(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...studentSummary(),
    access: "FULL",
    otherNames: null,
    birthDate: "2012-03-14",
    birthPlace: "Abidjan",
    nationality: "CI",
    email: null,
    phone: null,
    phoneAlt: null,
    addressLine: "Cocody",
    city: "Abidjan",
    residence: null,
    firstEnrolledOn: "2026-09-05",
    leftOn: null,
    primaryGuardian: null,
    portalAccount: "NONE",
    externalRef: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

export function guardian(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(3000),
    personId: uuid(3100),
    lastName: "KONE",
    firstName: "Mariam",
    displayName: "KONE Mariam",
    otherNames: null,
    sex: "F",
    email: "mariam@example.org",
    phone: "+2250700000000",
    phoneAlt: null,
    addressLine: null,
    city: "Abidjan",
    occupation: null,
    employer: null,
    status: "ACTIVE",
    portalAccount: "NONE",
    childrenCount: 1,
    ...over,
  };
}

export function link(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(3200),
    studentId: uuid(2000),
    guardianId: uuid(3000),
    relationshipCode: "MOTHER",
    relationshipKind: "GUARDIAN",
    isPrimaryContact: true,
    isEmergencyContact: true,
    isFinancialResponsible: true,
    hasLegalCustody: true,
    canPickup: true,
    portalAccess: true,
    priority: 0,
    validFrom: "2026-09-01",
    validTo: null,
    notes: null,
    ...over,
  };
}

export function staffSummary(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(4000),
    personId: uuid(4100),
    staffNumber: "PE-0001",
    lastName: "DIALLO",
    firstName: "Issa",
    displayName: "DIALLO Issa",
    categoryCode: "TEACHER",
    jobTitle: "Professeur de mathématiques",
    status: "ACTIVE",
    primaryInstitutionId: uuid(1),
    plannedHours: null,
    ...over,
  };
}

export function assignment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(5000),
    staffId: uuid(4000),
    staffDisplayName: "DIALLO Issa",
    academicYearId: uuid(100),
    classroomId: uuid(500),
    curriculumNodeId: uuid(802),
    periodId: null,
    roleCode: "LEAD",
    replacesAssignmentId: null,
    coversAllSubjects: false,
    plannedHours: 48,
    startsOn: "2026-09-05",
    endsOn: null,
    status: "ACTIVE",
    source: "MANUAL",
    note: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    ...over,
  };
}

export const fundingTypes = [
  { id: uuid(960), code: "PRIVATE", label: "Privé", requiresReference: false, requiresFunder: false, sortOrder: 1, active: true },
  { id: uuid(961), code: "STATE_ASSIGNED", label: "Affecté par l'État", requiresReference: true, requiresFunder: false, sortOrder: 2, active: true },
  { id: uuid(962), code: "SCHOLARSHIP", label: "Bourse", requiresReference: false, requiresFunder: true, sortOrder: 3, active: true },
];
