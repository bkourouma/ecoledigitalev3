/**
 * Types du domaine primary_school. Aucun import d'infrastructure : ces types servent aux cas d'usage, aux dépôts SQL
 * (qui les construisent) et aux ports. Références à d'autres modules : UUID nus, vérifiés par des ports.
 */
export type Uuid = string;
export type IsoDate = string;
export type SourceKind = "regulation" | "institution" | "platform" | "placeholder";

export interface RatingLevel {
  id: Uuid;
  scaleId: Uuid;
  code: string;
  label: string;
  ordinal: number;
  meetsExpectation: boolean;
}

export interface RatingScale {
  id: Uuid;
  code: string;
  label: string;
  sourceKind: SourceKind;
  sourceReference: string | null;
  status: "ACTIVE" | "ARCHIVED";
  levels: RatingLevel[];
  locked: boolean;
}

export interface Competency {
  id: Uuid;
  domainId: Uuid;
  code: string;
  label: string;
  description: string | null;
  ordinal: number;
}

export interface CompetencyDomain {
  id: Uuid;
  code: string;
  label: string;
  ordinal: number;
  competencies: Competency[];
}

export type FrameworkStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface Framework {
  id: Uuid;
  code: string;
  version: number;
  label: string;
  scaleId: Uuid;
  status: FrameworkStatus;
  sourceKind: SourceKind;
  sourceReference: string | null;
  publishedAt: Date | null;
  gradeLevelCodes: string[];
  competencyCount: number;
}

export interface FrameworkDetail extends Framework {
  domains: CompetencyDomain[];
  scale: RatingScale;
  publishBlockers: Array<{ code: string; message: string }>;
}

export type AssessmentStatus = "DRAFT" | "VALIDATED";

export interface CompetencyAssessment {
  id: Uuid;
  classroomId: Uuid;
  academicPeriodId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  frameworkId: Uuid;
  competencyId: Uuid;
  scaleId: Uuid;
  ratingLevelId: Uuid;
  observedOn: IsoDate;
  recordedByStaffId: Uuid;
  note: string | null;
  status: AssessmentStatus;
  validatedBy: Uuid | null;
  validatedAt: Date | null;
  rowVersion: number;
}

export interface CompetencyRevision {
  id: Uuid;
  assessmentId: Uuid;
  fromLevelId: Uuid;
  toLevelId: Uuid;
  reason: string;
  requestedBy: Uuid;
  createdAt: Date;
}

export interface Settings {
  institutionId: Uuid;
  requireHomeroomForActivation: boolean;
  councilRequiredForBilan: boolean;
  phraseBankEnabled: boolean;
  defaultRatingScaleId: Uuid | null;
  archiveRetentionYears: number | null;
}

/** Valeurs de départ d'un établissement sans ligne de paramètres (identiques aux défauts SQL de la migration 1900). */
export const DEFAULT_SETTINGS: Omit<Settings, "institutionId"> = Object.freeze({
  requireHomeroomForActivation: true,
  councilRequiredForBilan: true,
  phraseBankEnabled: true,
  defaultRatingScaleId: null,
  archiveRetentionYears: null,
});

export interface Phrase {
  id: Uuid;
  code: string;
  scope: "PERIOD" | "YEAR" | "COMPETENCY";
  body: string;
  ratingLevelCode: string | null;
  gradeLevelCode: string | null;
  sourceKind: SourceKind;
  active: boolean;
}

export type CaseStatus = "OPEN" | "DECIDED" | "DEFERRED";

export interface CouncilCase {
  id: Uuid;
  deliberationId: Uuid;
  classroomId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  reasonCodes: string[];
  proposalCode: string | null;
  proposalNote: string | null;
  discussionNote: string | null;
  proposedByStaffId: Uuid | null;
  status: CaseStatus;
  decisionRef: Uuid | null;
}

export type CouncilRole = "CHAIR" | "HOMEROOM" | "TEACHER" | "SPECIALIST" | "DIRECTOR" | "SECRETARY" | "OTHER";

export interface CouncilAttendanceRow {
  deliberationId: Uuid;
  staffId: Uuid;
  roleCode: CouncilRole;
  convened: boolean;
  present: boolean | null;
  signedAt: Date | null;
  note: string | null;
}

export type ReviewStatus = "DRAFT" | "READY" | "SEALED" | "SUPERSEDED";

export interface AnnualReview {
  id: Uuid;
  institutionId: Uuid;
  academicYearId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  classroomId: Uuid;
  gradeLevelCode: string;
  version: number;
  status: ReviewStatus;
  yearResultRef: Uuid | null;
  decisionRef: Uuid | null;
  outcomeCode: string | null;
  competencySummary: Record<string, Record<string, number>>;
  attendanceSummary: Record<string, unknown>;
  ruleVersionRef: string | null;
  contentHash: string | null;
  sealedAt: Date | null;
  sealedBy: Uuid | null;
  reportcardId: Uuid | null;
  supersedesId: Uuid | null;
  supersedeReason: string | null;
  createdAt: Date;
}

export type ArchiveStatus = "PREPARING" | "READY" | "FROZEN";

export interface YearArchive {
  id: Uuid;
  institutionId: Uuid;
  academicYearId: Uuid;
  status: ArchiveStatus;
  reviewsTotal: number;
  reviewsSealed: number;
  manifest: Record<string, unknown> | null;
  manifestHash: string | null;
  preparedAt: Date | null;
  frozenAt: Date | null;
}

/**
 * Capacités RBAC de l'appelant, transmises aux cas d'usage pour des décisions CONTEXTUELLES. Elles viennent de
 * `requirePermission` (jamais d'un nom de rôle). Sans capacité fournie, le droit le plus restreint s'applique.
 */
export interface CallerCaps {
  /** `primary.class.read_all` : direction et secrétariat voient toutes les classes ; sinon seulement celles de l'instituteur. */
  readonly allClasses?: boolean;
  /** `primary.council.manage` : présidence, décisions, procès-verbal (sinon préparer SES dossiers seulement). */
  readonly councilManage?: boolean;
  /** `primary.competency.validate` : valider une grille. */
  readonly validate?: boolean;
}

/** Ligne de la feuille de compétences d'un élève (affichage). */
export interface RosterEntry {
  enrollmentId: Uuid;
  studentId: Uuid;
  displayName: string | null;
  isRepeating: boolean;
}
