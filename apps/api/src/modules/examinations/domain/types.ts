/**
 * Types du domaine `examinations` : formes des lignes lues par les dépôts et renvoyées par les cas d'usage.
 * Les nombres exacts (coefficients, barèmes, notes, moyennes) sont des CHAÎNES décimales (jamais de flottant).
 */

export const SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SESSION_KINDS = ["OFFICIAL", "MOCK"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const REGISTRATION_STATUSES = ["DRAFT", "PRE_REGISTERED", "REGISTERED", "WITHDRAWN"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const ELIGIBILITY_STATUSES = ["NOT_EVALUATED", "ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];
export type EligibilityResult = "ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW";

export const OUTCOMES = ["PENDING", "ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const RESULT_CODES = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
export type ResultCode = (typeof RESULT_CODES)[number];
/** Codes de résultat sans moyenne, ni rang, ni mention (contrainte de la base). */
export const RESULT_CODES_WITHOUT_AVERAGE: readonly ResultCode[] = ["ABSENT", "EXCLUDED", "DEFERRED"];

export const SCORE_STATUSES = ["ENTERED", "ABSENT", "EXCUSED", "MALPRACTICE"] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

export type ResultSource = "IMPORTED" | "ENTERED" | "COMPUTED";
export type ResultStatus = "DRAFT" | "PUBLISHED";
export type PieceStatus = "MISSING" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
export type DocumentKind = "CONVOCATION" | "ATTESTATION_REUSSITE" | "RELEVE_NOTES";
export type IssuedStatus = "REQUESTED" | "ISSUED" | "REVOKED";
export type BatchKind = "OFFICIAL_NUMBERS" | "SCORES" | "RESULTS";
export type BatchStatus = "UPLOADED" | "VALIDATED" | "APPLIED" | "REJECTED";
export type FormatStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type ExportKind = "CANDIDATE_LIST" | "CENTER_ASSIGNMENTS" | "RESULTS" | "STATISTICS";
export type ExportFileFormat = "CSV" | "XLSX" | "FIXED_WIDTH" | "JSON";
export type FileEncoding = "UTF-8" | "ISO-8859-1" | "WINDOWS-1252";

export interface ExamTypeRow {
  id: string;
  code: string;
  label: string;
  educationLevelCode: string;
  gradeLevelCode: string | null;
  resultContractId: string;
  candidateNumberPattern: string;
  /** Q-E18 : le résultat et la MOYENNE des candidats-élèves partent vers les admissions (désactivé par défaut). */
  transmitsToAdmission: boolean;
  sourceKind: SourceKind;
  sourceReference: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamTrackRow {
  id: string;
  examTypeId: string;
  code: string;
  label: string;
  sourceKind: SourceKind;
  active: boolean;
}

export interface ExamPaperRow {
  id: string;
  examTypeId: string;
  trackCode: string | null;
  code: string;
  label: string;
  coefficient: string;
  scaleMax: string;
  isOptional: boolean;
  ordinal: number;
  sourceKind: SourceKind;
  active: boolean;
}

export interface DocumentRequirementRow {
  id: string;
  examTypeId: string;
  code: string;
  label: string;
  required: boolean;
  sortOrder: number;
  sourceKind: SourceKind;
  active: boolean;
}

export interface CenterRow {
  id: string;
  code: string;
  name: string;
  kind: "OWN" | "HOST";
  authorityCode: string | null;
  locality: string | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface RoomRow {
  id: string;
  centerId: string;
  code: string;
  label: string | null;
  capacity: number;
  active: boolean;
}

export interface SessionRow {
  id: string;
  examTypeId: string;
  institutionId: string;
  academicYearId: string | null;
  code: string;
  label: string;
  sessionKind: SessionKind;
  attemptKind: "NORMAL" | "MAKEUP";
  sessionYear: number;
  mockOfSessionId: string | null;
  registrationOpensOn: string | null;
  registrationClosesOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: SessionStatus;
  definitionLockedAt: Date | null;
  ruleVersionRef: string | null;
  sourceKind: SourceKind;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionTrackRow {
  id: string;
  sessionId: string;
  code: string;
  label: string;
}

export interface SessionPaperRow {
  id: string;
  sessionId: string;
  trackCode: string | null;
  code: string;
  label: string;
  coefficient: string;
  scaleMax: string;
  isOptional: boolean;
  ordinal: number;
  sourceKind: SourceKind;
}

export type CandidateKind = "STUDENT" | "EXTERNAL";

export interface CandidateRow {
  id: string;
  sessionId: string;
  institutionId: string;
  /** `null` pour un candidat LIBRE (sans dossier élève, Q-E15). */
  studentId: string | null;
  candidateKind: CandidateKind;
  /** Renseigné quand l'identité du candidat libre a été anonymisée. */
  anonymizedAt: Date | null;
  enrollmentId: string | null;
  gradeLevelCode: string | null;
  trackCode: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  sex: "F" | "M" | null;
  snapshotTakenAt: Date | null;
  registrationStatus: RegistrationStatus;
  eligibilityStatus: EligibilityStatus;
  outcome: Outcome;
  candidateSeq: string | null;
  candidateNumber: string | null;
  registeredAt: Date | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  createdBy: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentifierRow {
  id: string;
  sessionId: string;
  candidateId: string;
  kind: string;
  value: string;
  source: "MANUAL" | "IMPORT" | "MIGRATION";
  createdAt: Date;
}

export interface EligibilityCheckRow {
  id: string;
  candidateId: string;
  ruleVersionRef: string | null;
  result: EligibilityResult;
  reasons: string[];
  inputsHash: string | null;
  evaluatedBy: string | null;
  evaluatedAt: Date;
  overriddenBy: string | null;
  overrideReason: string | null;
}

export interface CandidatePieceRow {
  id: string;
  candidateId: string;
  requirementId: string;
  requirementCode: string;
  requirementLabel: string;
  required: boolean;
  status: PieceStatus;
  documentRef: string | null;
  /** `SIGHTED` : pièce vue sur place (candidat libre, sans document de la GED). */
  presentationKind: "DOCUMENT" | "SIGHTED";
  sightedNote: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  updatedAt: Date | null;
}

export interface AssignmentRow {
  id: string;
  sessionId: string;
  candidateId: string;
  centerId: string;
  roomId: string;
  seatNumber: number;
  tableNumber: string | null;
  assignedBy: string | null;
  assignedAt: Date;
}

export interface HistoryRow {
  id: string;
  candidateId: string;
  kind: "CREATED" | "STATUS" | "ELIGIBILITY" | "OUTCOME" | "ASSIGNMENT" | "NOTE";
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  actorId: string | null;
  occurredAt: Date;
}

export interface ScoreRow {
  id: string;
  sessionId: string;
  candidateId: string;
  paperId: string;
  status: ScoreStatus;
  score: string | null;
  source: "MANUAL" | "IMPORT" | "ASSESS";
  sourceRef: string | null;
  enteredBy: string | null;
  rowVersion: number;
  updatedAt: Date;
}

export interface ResultRow {
  id: string;
  sessionId: string;
  candidateId: string;
  resultCode: ResultCode;
  average: string | null;
  totalPoints: string | null;
  rank: number | null;
  mentionCode: string | null;
  source: ResultSource;
  ruleVersionRef: string | null;
  inputsHash: string | null;
  importBatchId: string | null;
  status: ResultStatus;
  publishedAt: Date | null;
  publishedBy: string | null;
  enteredBy: string | null;
  rowVersion: number;
  updatedAt: Date;
}

export interface BatchRow {
  id: string;
  sessionId: string;
  kind: BatchKind;
  fileName: string;
  sha256: string;
  formatCode: string | null;
  rowCount: number;
  okCount: number;
  errorCount: number;
  status: BatchStatus;
  uploadedBy: string;
  appliedBy: string | null;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface ImportRowRecord {
  id: string;
  batchId: string;
  lineNo: number;
  status: "OK" | "ERROR" | "SKIPPED";
  errorCode: string | null;
  candidateId: string | null;
  payload: Record<string, unknown>;
}

export type RevisionTarget = "SCORE" | "RESULT";
export type RevisionRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RevisionRequestRow {
  id: string;
  sessionId: string;
  targetKind: RevisionTarget;
  scoreId: string | null;
  resultId: string | null;
  proposed: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: RevisionRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  revisionId: string | null;
}

export interface ExportColumn {
  header: string;
  source: string;
  transform?: string;
  paper?: string;
  /** Largeur d'une colonne en format à largeur fixe. */
  width?: number;
  /** Valeur d'une colonne `constant`. */
  value?: string;
}

export interface ExportFormatRow {
  id: string;
  code: string;
  version: number;
  label: string;
  examTypeId: string | null;
  kind: ExportKind;
  fileFormat: ExportFileFormat;
  encoding: FileEncoding;
  delimiter: string | null;
  columns: ExportColumn[];
  status: FormatStatus;
  sourceKind: SourceKind;
  sourceReference: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ImportColumn {
  header: string;
  target: string;
  paper?: string;
}

export interface ImportFormatRow {
  id: string;
  code: string;
  version: number;
  label: string;
  examTypeId: string | null;
  kind: BatchKind;
  encoding: FileEncoding;
  delimiter: string;
  decimalSeparator: "." | ",";
  hasHeader: boolean;
  columns: ImportColumn[];
  valueMap: Record<string, Record<string, string>>;
  status: FormatStatus;
  sourceKind: SourceKind;
  sourceReference: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ExportRunRow {
  id: string;
  sessionId: string;
  formatId: string;
  formatVersion: number;
  filters: Record<string, unknown>;
  status: "RUNNING" | "DONE" | "FAILED";
  rowCount: number | null;
  fileSha256: string | null;
  storageKey: string | null;
  errorCode: string | null;
  requestedBy: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface IssuedDocumentRow {
  id: string;
  sessionId: string;
  candidateId: string;
  kind: DocumentKind;
  version: number;
  officialDocumentId: string | null;
  status: IssuedStatus;
  requestedBy: string;
  issuedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

export interface PaperLinkRow {
  id: string;
  sessionId: string;
  paperId: string;
  classroomId: string;
  assessmentId: string;
  linkedBy: string | null;
  linkedAt: Date;
}

export interface CountsRow {
  groupKey: string;
  registered: number;
  present: number;
  admitted: number;
  failed: number;
  absent: number;
  excluded: number;
  deferred: number;
}

export const COUNT_GROUPS = ["ALL", "INSTITUTION", "TRACK", "SEX", "GRADE"] as const;
export type CountGroup = (typeof COUNT_GROUPS)[number];

/** Données personnelles RESTREINTES d'un candidat libre (coordonnées, pièce d'identité, tuteur) + faits d'éligibilité saisis. */
export interface ExternalProfileRow {
  id: string;
  candidateId: string;
  sessionId: string;
  contactPhone: string | null;
  contactEmail: string | null;
  addressLine: string | null;
  idPieceKind: string | null;
  idPieceNumber: string | null;
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  declaredInExamGrade: boolean;
  declaredPriorAttempts: number;
  dataSource: "ENTERED" | "IMPORTED";
  enteredBy: string | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
