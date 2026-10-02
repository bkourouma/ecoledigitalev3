/**
 * Types du domaine `analytics` : genres de rafraîchissement et FAITS SOURCES (la forme que les ports d'`application/ports.ts`
 * renvoient). Aucun import d'infrastructure. Les identifiants des autres modules sont des UUID sans clé étrangère.
 *
 * Décimaux exacts des résultats : CHAÎNES (jamais de flottant entre `results` et la base) ; montants : entiers en unités
 * mineures (`number` sûr jusqu'à 2^53 — l'unité mineure du XOF est le franc).
 */

/** Genre de rafraîchissement : une famille de read-models alimentée par une passe de lecture des sources. */
export const REFRESH_KINDS = [
  "REBUILD",
  "CALENDAR",
  "ENROLLMENT",
  "RESULTS",
  "ATTENDANCE",
  "STAFF_PRESENCE",
  "FINANCE",
  "COLLECTIONS",
  "CASH",
  "PAYROLL",
  "TEACHING_LOAD",
] as const;
export type RefreshKind = (typeof REFRESH_KINDS)[number];

export const isRefreshKind = (value: unknown): value is RefreshKind => typeof value === "string" && (REFRESH_KINDS as readonly string[]).includes(value);

/** Genres qui ne dépendent d'aucun autre : ils s'exécutent d'abord (les dimensions éclairent les filtres des autres). */
export const KIND_ORDER: Readonly<Record<RefreshKind, number>> = {
  REBUILD: -1,
  CALENDAR: 0,
  ENROLLMENT: 1,
  RESULTS: 2,
  ATTENDANCE: 3,
  STAFF_PRESENCE: 4,
  FINANCE: 5,
  COLLECTIONS: 6,
  CASH: 7,
  PAYROLL: 8,
  TEACHING_LOAD: 9,
};

export type Uuid = string;
export type IsoDate = string;
export type IsoInstant = string;

/** Périmètre d'une demande : `*` (tout), un identifiant, une date ou un intervalle `YYYY-MM-DD..YYYY-MM-DD`. */
export type ScopeKey = string;
export const ALL_SCOPE: ScopeKey = "*";

// ------------------------------------------------------------------------------------------------------------------
// Faits sources
// ------------------------------------------------------------------------------------------------------------------

export interface ScopeFact {
  kind: "INSTITUTION" | "CAMPUS";
  id: Uuid;
  parentId: Uuid | null;
  label: string;
  status: string | null;
}

export interface YearFact {
  id: Uuid;
  institutionId: Uuid;
  code: string;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: string;
  isCurrent: boolean;
}

export interface PeriodFact {
  id: Uuid;
  yearId: Uuid;
  code: string;
  label: string;
  ordinal: number;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: string;
}

export interface ClassroomFact {
  id: Uuid;
  institutionId: Uuid;
  campusId: Uuid | null;
  yearId: Uuid;
  name: string;
  gradeLevelCode: string;
  gradeLevelLabel: string;
  educationLevelCode: string;
  programLabel: string;
  kind: string;
  status: string;
  headcount: number;
}

export interface EnrollmentFact {
  enrollmentId: Uuid;
  studentId: Uuid;
  institutionId: Uuid;
  campusId: Uuid | null;
  yearId: Uuid;
  classroomId: Uuid;
  status: string;
  fundingType: string;
  sex: "M" | "F" | null;
  isRepeating: boolean;
  /** L'inscription ouvre la scolarité (classification d'`academic` : `opensSchooling`) : elle compte dans l'effectif. */
  inSchooling: boolean;
  sourceKind: string | null;
  enrolledOn: IsoDate | null;
  endedOn: IsoDate | null;
  createdAt: IsoInstant | null;
  confirmedAt: IsoInstant | null;
  cancelledAt: IsoInstant | null;
}

/** Résultat d'une inscription pour une période (en-tête FINAL de `results`). */
export interface ResultFact {
  enrollmentId: Uuid;
  studentId: Uuid;
  resultsVersion: number;
  average: string | null;
  rank: number | null;
  cohortSize: number | null;
  mentionCode: string | null;
  decisionCode: string | null;
  decisionOutcome: string | null;
  /** Décision de fin d'année confirmée (portée YEAR : passage / redoublement), ou `null`. */
  yearDecisionCode: string | null;
  yearDecisionOutcome: string | null;
  validated: boolean | null;
  creditsAcquired: string | null;
  creditsRequired: string | null;
  finalizedAt: IsoInstant | null;
}

export interface ResultLineFact {
  enrollmentId: Uuid;
  nodeId: Uuid;
  level: string;
  nodeCode: string;
  nodeLabel: string;
  value: string | null;
  validated: boolean | null;
  sessionObtained: 1 | 2 | null;
  resitEligible: boolean | null;
}

/** Contenu lu d'une (classe, période) : seuls les résultats FINAL comptent ; sinon `state = "NOT_FINAL"` et aucune ligne. */
export interface ClassPeriodResults {
  classroomId: Uuid;
  periodId: Uuid;
  yearId: Uuid | null;
  state: "FINAL" | "NOT_FINAL";
  results: ResultFact[];
  lines: ResultLineFact[];
}

export interface AttendanceDayFact {
  day: IsoDate;
  classroomId: Uuid;
  yearId: Uuid | null;
  institutionId: Uuid | null;
  campusId: Uuid | null;
  sessionsCount: number;
  recordsCount: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  absentMinutes: number;
}

export interface StaffPresenceFact {
  day: IsoDate;
  staffId: Uuid;
  statusCode: string;
  present: boolean;
  absent: boolean;
  onLeave: boolean;
}

export interface FinanceSummaryFact {
  currency: string;
  asOf: IsoDate;
  invoiceCount: number;
  billed: number;
  credited: number;
  netBilled: number;
  collected: number;
  outstanding: number;
  overdue: number;
  overdueInvoiceCount: number;
  unallocated: number;
  collectionRateBps: number | null;
}

export interface ReceivableGroupFact {
  groupKey: string;
  label: string | null;
  invoiceCount: number;
  learnerCount: number;
  billed: number;
  credited: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collectionRateBps: number | null;
}

export interface ReceivableLearnerFact {
  learnerId: Uuid;
  /** Nom d'affichage de l'apprenant (people), `null` si inconnu. */
  learnerName: string | null;
  groupKey: string | null;
  label: string | null;
  invoiceCount: number;
  billed: number;
  credited: number;
  collected: number;
  outstanding: number;
  overdue: number;
  oldestOverdueDate: IsoDate | null;
  collectionRateBps: number | null;
}

export const AGING_BUCKET_KEYS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"] as const;
export type AgingBucketKey = (typeof AGING_BUCKET_KEYS)[number];

export interface AgedBalanceFact {
  currency: string;
  asOf: IsoDate;
  buckets: Record<AgingBucketKey, { amount: number; invoiceCount: number }>;
  learners: Array<{ learnerId: Uuid; buckets: Record<AgingBucketKey, number>; total: number }>;
}

/** Tout ce que finance publie pour UN couple (année, campus) : les tables `finance_*` sont remplacées d'un bloc. */
export interface FinanceScopeFacts {
  yearKey: string;
  campusKey: string;
  summary: FinanceSummaryFact;
  byGroup: ReceivableGroupFact[];
  byLearner: ReceivableLearnerFact[];
  aged: AgedBalanceFact;
}

export interface CollectionPointFact {
  day: IsoDate;
  currency: string;
  collected: number;
  refunded: number;
  net: number;
  paymentCount: number;
}

export interface CashSessionFact {
  sessionId: Uuid;
  registerId: Uuid | null;
  cashierId: Uuid | null;
  currency: string;
  status: "OPEN" | "CLOSED";
  openedAt: IsoInstant | null;
  closedAt: IsoInstant | null;
  openingFloat: number;
  expected: number | null;
  counted: number | null;
  variance: number | null;
}

export interface PayrollStatusFact {
  periodId: Uuid;
  status: string;
  yearId: Uuid | null;
  periodName: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  currency: string;
  payslipCount: number;
  total: number;
}

export interface TeachingLoadFact {
  staffId: Uuid;
  yearId: Uuid;
  displayName: string;
  status: string | null;
  plannedHours: number;
  classroomCount: number;
  contractualHoursPerWeek: number | null;
}
