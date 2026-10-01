/**
 * Vues restituées par les cas d'usage : même forme que les DTO de `contracts/v2/people.ts` (les schémas Zod valident
 * les sorties dans les tests de contrat). Le masquage selon le niveau d'accès (`FULL`, `CLASS`, `SELF`, `GUARDIAN`) se fait
 * ICI, à la construction — jamais dans la couche HTTP — pour que tout appelant (autre module compris) reçoive la même
 * donnée filtrée.
 */
import type {
  PeopleAvailabilityDto,
  PeopleContractDto,
  PeopleCurrentEnrollmentDto,
  PeopleEmergencyContactDto,
  PeopleGuardianDto,
  PeopleGuardianLinkDto,
  PeoplePriorEducationDto,
  PeopleQualificationDto,
  PeopleStaffDetailDto,
  PeopleStaffSummaryDto,
  PeopleStatusHistoryDto,
  PeopleStudentDetailDto,
  PeopleStudentSummaryDto,
  PeopleAssignmentDto,
} from "@ecoledigitale/contracts/src/v2/people";
import { displayName } from "../domain/normalize";
import type { AffiliationRow, AvailabilityRow, ContractRow, QualificationRow, StaffRow, StaffStatusHistoryRow } from "../infrastructure/staff-repo";
import type { EmergencyContactRow, PriorEducationRow, StatusHistoryRow, StudentRow } from "../infrastructure/students-repo";
import type { GuardianRow, LinkRow } from "../infrastructure/guardians-repo";
import type { AssignmentRow } from "../infrastructure/teaching-repo";
import { iso, num, numOrNull } from "../infrastructure/sql";

export type AccessLevel = PeopleStudentDetailDto["access"];

export function currentEnrollmentView(r: StudentRow): PeopleCurrentEnrollmentDto | null {
  if (!r.ceEnrollmentId || !r.ceAcademicYearId || !r.ceInstitutionId || !r.ceClassroomId || !r.ceStatus) return null;
  return {
    enrollmentId: r.ceEnrollmentId,
    academicYearId: r.ceAcademicYearId,
    institutionId: r.ceInstitutionId,
    classroomId: r.ceClassroomId,
    classroomName: r.ceClassroomName,
    status: r.ceStatus,
    registrationNumber: r.ceRegistrationNumber,
  };
}

/** Résumé : AUCUN champ sensible, aucune coordonnée. */
export function studentSummaryView(r: StudentRow): PeopleStudentSummaryDto {
  return {
    id: r.studentId,
    personId: r.personId,
    studentNumber: r.studentNumber,
    sequenceNumber: r.sequenceNumber,
    lastName: r.lastName,
    firstName: r.firstName,
    displayName: displayName(r.lastName, r.firstName),
    sex: r.sex,
    status: r.status,
    hasPhoto: r.photoObjectKey !== null,
    currentEnrollment: currentEnrollmentView(r),
  };
}

export interface PrimaryGuardianFacts {
  guardianId: string;
  displayName: string;
  relationshipCode: string;
  phone: string | null;
}

/**
 * Fiche d'un élève sans champs sensibles. Niveaux :
 *  - `FULL` / `SELF` : tout (hors sensibles) ;
 *  - `CLASS` (enseignant de la classe) : masque adresse, lieu de naissance, e-mail et téléphone de l'élève ;
 *  - `GUARDIAN` : tout sauf le téléphone du tuteur principal (un tuteur voit ses propres coordonnées par `/me/guardian`).
 */
export function studentDetailView(r: StudentRow, access: AccessLevel, primary: PrimaryGuardianFacts | null): PeopleStudentDetailDto {
  const restricted = access === "CLASS";
  return {
    ...studentSummaryView(r),
    access,
    otherNames: r.otherNames,
    birthDate: r.birthDate,
    birthPlace: restricted ? null : r.birthPlace,
    nationality: r.nationality as PeopleStudentDetailDto["nationality"],
    email: restricted ? null : r.email,
    phone: restricted ? null : r.phone,
    phoneAlt: restricted ? null : r.phoneAlt,
    addressLine: restricted ? null : r.addressLine,
    city: restricted ? null : r.city,
    residence: restricted ? null : r.residence,
    firstEnrolledOn: r.firstEnrolledOn,
    leftOn: r.leftOn,
    primaryGuardian: primary ? { ...primary, phone: access === "GUARDIAN" ? null : primary.phone } : null,
    portalAccount: r.portalStatus ?? "NONE",
    externalRef: access === "FULL" ? r.externalRef : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export const statusHistoryView = (h: StatusHistoryRow): PeopleStatusHistoryDto => ({
  id: h.id,
  fromStatus: h.fromStatus,
  toStatus: h.toStatus,
  reasonCode: h.reasonCode,
  reasonText: h.reasonText,
  effectiveOn: h.effectiveOn,
  changedBy: h.changedBy,
  changedAt: iso(h.changedAt),
});

export const emergencyContactView = (c: EmergencyContactRow): PeopleEmergencyContactDto => ({ ...c });

export const priorEducationView = (p: PriorEducationRow, withSensitive: boolean): PeoplePriorEducationDto => ({
  id: p.id,
  studentId: p.studentId,
  kind: p.kind,
  label: p.label,
  institutionName: p.institutionName,
  schoolYear: p.schoolYear,
  levelLabel: p.levelLabel,
  seriesLabel: p.seriesLabel,
  obtainedOn: p.obtainedOn,
  referenceNumber: withSensitive ? p.referenceNumber : null,
  hasAttachment: p.attachmentObjectKey !== null,
  note: p.note,
});

export const guardianView = (g: GuardianRow): PeopleGuardianDto => ({
  id: g.guardianId,
  personId: g.personId,
  lastName: g.lastName,
  firstName: g.firstName,
  displayName: displayName(g.lastName, g.firstName),
  otherNames: g.otherNames,
  sex: g.sex,
  email: g.email,
  phone: g.phone,
  phoneAlt: g.phoneAlt,
  addressLine: g.addressLine,
  city: g.city,
  occupation: g.occupation,
  employer: g.employer,
  status: g.guardianStatus,
  portalAccount: g.portalStatus ?? "NONE",
  childrenCount: g.childrenCount,
});

export const linkView = (l: LinkRow): PeopleGuardianLinkDto => ({
  id: l.id,
  studentId: l.studentId,
  guardianId: l.guardianId,
  relationshipCode: l.relationshipCode,
  relationshipKind: l.relationshipKind,
  isPrimaryContact: l.isPrimaryContact,
  isEmergencyContact: l.isEmergencyContact,
  isFinancialResponsible: l.isFinancialResponsible,
  hasLegalCustody: l.hasLegalCustody,
  canPickup: l.canPickup,
  portalAccess: l.portalAccess,
  priority: l.priority,
  validFrom: l.validFrom,
  validTo: l.validTo,
  notes: l.notes,
});

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export const staffSummaryView = (s: StaffRow): PeopleStaffSummaryDto => ({
  id: s.staffId,
  personId: s.personId,
  staffNumber: s.staffNumber,
  lastName: s.lastName,
  firstName: s.firstName,
  displayName: displayName(s.lastName, s.firstName),
  categoryCode: s.categoryCode,
  jobTitle: s.jobTitle,
  status: s.status,
  primaryInstitutionId: s.primaryInstitutionId,
  plannedHours: numOrNull(s.plannedHours),
});

export const staffDetailView = (s: StaffRow, affiliations: readonly AffiliationRow[]): PeopleStaffDetailDto => ({
  ...staffSummaryView(s),
  otherNames: s.otherNames,
  sex: s.sex,
  email: s.email,
  phone: s.phone,
  phoneAlt: s.phoneAlt,
  addressLine: s.addressLine,
  city: s.city,
  hiredOn: s.hiredOn,
  leftOn: s.leftOn,
  primaryCampusId: s.primaryCampusId,
  affiliations: affiliations.map((a) => ({ id: a.id, institutionId: a.institutionId, campusId: a.campusId, validFrom: a.validFrom, validTo: a.validTo })),
  portalAccount: s.portalStatus ?? "NONE",
  externalRef: s.externalRef,
  createdAt: iso(s.createdAt),
  updatedAt: iso(s.updatedAt),
});

export const staffStatusHistoryView = (h: StaffStatusHistoryRow) => ({
  id: h.id,
  fromStatus: h.fromStatus,
  toStatus: h.toStatus,
  reasonText: h.reasonText,
  effectiveOn: h.effectiveOn,
  changedBy: h.changedBy,
  changedAt: iso(h.changedAt),
});

export const contractView = (c: ContractRow): PeopleContractDto => ({
  id: c.id,
  staffId: c.staffId,
  contractTypeCode: c.contractTypeCode,
  startsOn: c.startsOn,
  endsOn: c.endsOn,
  committedHours: numOrNull(c.committedHours),
  committedHoursUnit: c.committedHoursUnit,
  status: c.status,
  note: c.note,
});

export const qualificationView = (q: QualificationRow): PeopleQualificationDto => ({ ...q });

export const availabilityView = (a: AvailabilityRow): PeopleAvailabilityDto => ({ ...a });

export const assignmentView = (a: AssignmentRow): PeopleAssignmentDto => ({
  id: a.id,
  staffId: a.staffId,
  staffDisplayName: a.staffDisplayName,
  academicYearId: a.academicYearId,
  classroomId: a.classroomId,
  curriculumNodeId: a.curriculumNodeId,
  periodId: a.periodId,
  roleCode: a.roleCode,
  replacesAssignmentId: a.replacesAssignmentId,
  coversAllSubjects: a.coversAllSubjects,
  plannedHours: a.plannedHours === null ? null : num(a.plannedHours),
  startsOn: a.startsOn,
  endsOn: a.endsOn,
  status: a.status,
  source: a.source,
  note: a.note,
  createdAt: iso(a.createdAt),
});
