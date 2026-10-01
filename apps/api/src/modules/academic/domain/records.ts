/**
 * Enregistrements du domaine (formes lues et exposées). Les dates civiles sont des chaînes `YYYY-MM-DD`, les
 * instants des chaînes ISO UTC, les décimaux des chaînes canoniques. Les présentateurs HTTP ne font que
 * recopier ces formes (elles coïncident avec les DTO de `packages/contracts/src/v2/academic.ts`).
 */
import type {
  AcademicClassroomPeriodStatus,
  AcademicClassroomStatus,
  AcademicConfirmationPolicy,
  AcademicCourseConfirmationPolicy,
  AcademicCourseSource,
  AcademicCourseStatus,
  AcademicEnrollmentMode,
  AcademicEnrollmentStatus,
  AcademicOfferingStatus,
  AcademicOutcomeKind,
  AcademicPack,
  AcademicPeriodStatus,
  AcademicVersionStatus,
  AcademicYearStatus,
} from "@ecoledigitale/contracts/src/v2/academic";
import type { IsoDate } from "./dates";

export type Uuid = string;
export type IsoInstant = string;

export interface AcademicYear {
  id: Uuid;
  institutionId: Uuid;
  code: string;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: AcademicYearStatus;
  isCurrent: boolean;
  openedAt: IsoInstant | null;
  closedAt: IsoInstant | null;
  archivedAt: IsoInstant | null;
}

export interface AcademicPeriod {
  id: Uuid;
  academicYearId: Uuid;
  parentPeriodId: Uuid | null;
  periodTypeCode: string;
  ordinal: number;
  code: string;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: AcademicPeriodStatus;
  openedAt: IsoInstant | null;
  gradingClosedAt: IsoInstant | null;
  closedAt: IsoInstant | null;
  closedBy: Uuid | null;
  reopenedCount: number;
}

export interface EducationLevel {
  id: Uuid;
  code: string;
  label: string;
  ordinal: number;
  pack: AcademicPack | null;
  active: boolean;
}

export interface GradeLevel {
  id: Uuid;
  educationLevelId: Uuid;
  code: string;
  label: string;
  shortLabel: string | null;
  ordinal: number;
  nextGradeLevelId: Uuid | null;
  isFinal: boolean;
  active: boolean;
}

export interface PeriodType {
  id: Uuid;
  code: string;
  label: string;
  kind: "TEACHING_PERIOD" | "EXAM_SESSION";
  active: boolean;
}

export interface PeriodPlanSlot {
  type: string;
  ordinal: number;
  label: string;
  weight?: number | undefined;
}

export interface PeriodPlan {
  id: Uuid;
  code: string;
  label: string;
  slots: PeriodPlanSlot[];
  active: boolean;
}

export interface FundingType {
  id: Uuid;
  code: string;
  label: string;
  requiresReference: boolean;
  requiresFunder: boolean;
  sortOrder: number;
  active: boolean;
}

export interface EnrollmentOutcome {
  id: Uuid;
  code: string;
  label: string;
  kind: AcademicOutcomeKind;
  active: boolean;
}

export interface NodeType {
  id: Uuid;
  code: string;
  label: string;
  allowedParentCodes: string[];
  requiresGradeLevel: boolean;
  requiresPeriodSlot: boolean;
  requiresSubject: boolean;
  allowsCoefficient: boolean;
  allowsCredits: boolean;
  creditsMustEqualChildren: boolean;
  isEnrollable: boolean;
  isSystem: boolean;
  sortOrder: number;
}

export interface InstitutionSettings {
  institutionId: Uuid;
  enrollmentConfirmationPolicy: AcademicConfirmationPolicy;
  courseConfirmationPolicy: AcademicCourseConfirmationPolicy;
  pendingHoldMinutes: number | null;
  registrationNumberPrefix: string | null;
  registrationNumberPattern: string | null;
}

export interface Program {
  id: Uuid;
  institutionId: Uuid;
  educationLevelId: Uuid;
  parentProgramId: Uuid | null;
  code: string;
  label: string;
  kindCode: string;
  domainCode: string | null;
  description: string | null;
  durationMonths: number | null;
  attributes: Record<string, unknown>;
  status: "ACTIVE" | "ARCHIVED";
  gradeLevelIds: Uuid[];
}

export interface Subject {
  id: Uuid;
  institutionId: Uuid | null;
  code: string;
  label: string;
  shortLabel: string | null;
  domainCode: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  status: "ACTIVE" | "INACTIVE";
}

export interface CurriculumVersion {
  id: Uuid;
  programId: Uuid;
  academicYearId: Uuid;
  status: AcademicVersionStatus;
  clonedFromVersionId: Uuid | null;
  publishedAt: IsoInstant | null;
  publishedBy: Uuid | null;
  lockedAt: IsoInstant | null;
  note: string | null;
  nodeCount: number;
}

export interface CurriculumNode {
  id: Uuid;
  versionId: Uuid;
  parentId: Uuid | null;
  nodeTypeCode: string;
  lineageId: Uuid;
  subjectId: Uuid | null;
  gradeLevelId: Uuid | null;
  periodTypeCode: string | null;
  periodOrdinal: number | null;
  code: string;
  label: string;
  ordinal: number;
  coefficient: string | null;
  credits: string | null;
  isMandatory: boolean;
  isTransversal: boolean;
  categoryCode: string | null;
  hoursTotal: string | null;
  hoursLecture: string | null;
  hoursTutorial: string | null;
  hoursPractical: string | null;
  attributes: Record<string, unknown>;
  status: "ACTIVE" | "INACTIVE";
  prerequisiteLineageIds: Uuid[];
}

export interface CurriculumAmendment {
  id: Uuid;
  versionId: Uuid;
  nodeId: Uuid | null;
  kind: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  amendedBy: Uuid;
  amendedAt: IsoInstant;
}

export interface Classroom {
  id: Uuid;
  institutionId: Uuid;
  campusId: Uuid | null;
  academicYearId: Uuid;
  programId: Uuid;
  gradeLevelId: Uuid;
  curriculumVersionId: Uuid | null;
  kind: "CLASS" | "COHORT";
  code: string;
  name: string;
  capacity: number | null;
  capacityIsHard: boolean;
  status: AcademicClassroomStatus;
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  enrolledCount: number;
}

export interface ClassroomPeriodState {
  classroomId: Uuid;
  periodId: Uuid;
  status: AcademicClassroomPeriodStatus;
}

export interface Offering {
  id: Uuid;
  classroomId: Uuid;
  curriculumNodeId: Uuid;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  registrationOpensAt: IsoInstant | null;
  registrationClosesAt: IsoInstant | null;
  capacity: number | null;
  status: AcademicOfferingStatus;
  heldPlaces: number;
}

export interface Enrollment {
  id: Uuid;
  institutionId: Uuid;
  campusId: Uuid | null;
  academicYearId: Uuid;
  studentId: Uuid;
  classroomId: Uuid;
  mode: AcademicEnrollmentMode;
  status: AcademicEnrollmentStatus;
  registrationNumber: string | null;
  enrolledOn: IsoDate;
  endedOn: IsoDate | null;
  endReason: string | null;
  isRepeating: boolean;
  isTransferIn: boolean;
  originSchool: string | null;
  previousEnrollmentId: Uuid | null;
  fundingType: string;
  assignmentReference: string | null;
  assignmentIssuedOn: IsoDate | null;
  funderLabel: string | null;
  fundingNotes: string | null;
  outcomeCode: string | null;
  outcomeDecidedAt: IsoInstant | null;
  outcomeSourceRef: Uuid | null;
  sourceKind: "ADMISSION" | "IMPORT" | "MANUAL" | "ROLLOVER" | "ONLINE" | null;
  sourceRef: Uuid | null;
  confirmedAt: IsoInstant | null;
  cancelledAt: IsoInstant | null;
  createdAt: IsoInstant;
}

export interface EnrollmentCourse {
  id: Uuid;
  enrollmentId: Uuid;
  curriculumNodeId: Uuid;
  offeringId: Uuid | null;
  source: AcademicCourseSource;
  status: AcademicCourseStatus;
  holdExpiresAt: IsoInstant | null;
  requestedAt: IsoInstant;
  confirmedAt: IsoInstant | null;
  completedAt: IsoInstant | null;
  cancelledAt: IsoInstant | null;
  cancelReason: string | null;
  /** Solde de la ligne de facture mémorisé avant la confirmation de l'inscription (`ON_LINE_PAID`). */
  linePaidAt: IsoInstant | null;
}

export interface Placement {
  id: Uuid;
  enrollmentId: Uuid;
  classroomId: Uuid;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  reason: string | null;
}

export interface HistoryEntry {
  id: Uuid;
  enrollmentId: Uuid;
  kind: "CREATED" | "STATUS" | "FUNDING" | "PLACEMENT" | "COURSE" | "OUTCOME" | "NOTE";
  fromValue: unknown;
  toValue: unknown;
  reason: string | null;
  actorId: Uuid | null;
  occurredAt: IsoInstant;
}
