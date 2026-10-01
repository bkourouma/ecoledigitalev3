/**
 * Types du domaine `results`. Aucune valeur numérique n'est calculée ici : moyennes, crédits, rangs, mentions viennent
 * des règles (module `rules`) sous forme de CHAÎNES décimales exactes ou de CODES. Aucune identité d'élève dans les
 * contextes de règles.
 */

export type Uuid = string;
export type PeriodStatus = "OPEN" | "GRADING_LOCKED" | "DELIBERATED" | "CLOSED";
export type StateScope = "PERIOD" | "YEAR";
export type ResultStatus = "DRAFT" | "FINAL" | "SUPERSEDED" | "ERROR";
export type Level = "ECUE" | "SUBJECT" | "UE" | "SECTION" | "PERIOD" | "YEAR";
export type DecisionOutcome = "PROMOTED" | "REPEAT" | "PENDING" | "EXAM_REFERRAL" | "ADMITTED" | "RESIT" | "ADJOURNED" | "OTHER";
export type ReopenKind = "CORRECTION" | "RESIT_SESSION";
export type GradingMode = "COMPOSED" | "DIRECT";

/** Contrats de règles pris en charge par les pipelines de `results` (chaînage = structure, écrit en code). */
export const SUPPORTED_CONTRACTS = ["credit-semester@1", "coef-semester@1"] as const;
export type SupportedContract = (typeof SUPPORTED_CONTRACTS)[number];

/** Nœud de la structure du curriculum d'une classe (fourni par le port `CurriculumPort`, jamais deviné par un libellé). */
export interface StructureNode {
  readonly id: Uuid;
  readonly parentId: Uuid | null;
  /** `UE` / `ECUE` (contrat à crédits) ; `SUBJECT` (matière à coefficient). */
  readonly kind: "UE" | "ECUE" | "SUBJECT";
  readonly code: string;
  readonly label: string;
  readonly ordinal: number;
  /** Crédits décimaux exacts (chaîne) ; `null` = non renseigné. */
  readonly credits: string | null;
  /** Coefficient décimal exact (chaîne) ; `null` = non renseigné. */
  readonly coefficient: string | null;
  readonly gradingMode: GradingMode;
  readonly resitAllowed: boolean;
  readonly countsInAverage: boolean;
  /** Section du bulletin (type de bilan) ; `null` = aucune. */
  readonly sectionKey: string | null;
  readonly category: string | null;
}

export interface PeriodFacts {
  readonly id: Uuid;
  readonly rankInYear: number;
  readonly countInYear: number;
  /** Type/rang de la période (donnée de calendrier, jamais le nom) : « second semestre » = dernier de l'année. */
  readonly isSecondSemester: boolean;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Structure d'une classe × période. */
export interface ClassStructure {
  readonly classroomId: Uuid;
  readonly academicYearId: Uuid;
  readonly institutionId?: string | undefined;
  readonly levelCode?: string | undefined;
  /** Contrat de calcul de la classe (donnée du curriculum / du pack). */
  readonly contractId: string;
  readonly period: PeriodFacts;
  /** Période précédente de l'année utilisée pour la moyenne annuelle (1er semestre), si elle existe. */
  readonly firstPeriodId: Uuid | null;
  /** Examen terminal requis (attribut de programme / niveau, plus un nom de classe). */
  readonly terminalExamRequired: boolean;
  readonly nodes: readonly StructureNode[];
  /** Périodes de l'année dans l'ordre (calcul annuel du contrat à crédits). */
  readonly yearPeriods: readonly PeriodFacts[];
}

export interface EnrollmentRef {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
}

/** Note publiée telle que lue par `results` (aucun nom d'élève). */
export interface GradeFact {
  readonly gradeId: Uuid;
  readonly assessmentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly curriculumNodeId: Uuid;
  readonly sessionNo: 1 | 2;
  readonly assessedOn: string;
  readonly aggregationGroup: string;
  readonly scaleMax: string;
  readonly weight: string;
  readonly score: string | null;
  readonly entryStatus: "ENTERED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED" | "EXEMPT" | "NOT_GRADED";
}

export type OverrideKind = "VALUE" | "VALIDATION";

/** Surcharge APPROUVÉE à injecter dans le contexte de l'étape ciblée. */
export interface ApprovedOverride {
  readonly id: Uuid;
  readonly enrollmentId: Uuid;
  readonly level: Level;
  readonly curriculumNodeId: Uuid | null;
  readonly ruleKey: string;
  readonly kind: OverrideKind;
  /** Décimal exact (kind VALUE). */
  readonly value: string | null;
  /** Drapeau (kind VALIDATION). */
  readonly flag: boolean | null;
  readonly originalValue: string | null;
}

/** Sortie typée d'une évaluation de règle (valeur décimale en chaîne, booléen ou code). */
export type RuleValue = string | boolean | null;

export interface TraceRecord {
  readonly ruleKey: string;
  readonly value: RuleValue;
  readonly inputsHash: string;
  readonly outputsHash: string;
  readonly nodesEvaluated: number;
  readonly trace?: unknown;
  /** Contexte exact de l'appel (résultats FINAL seulement, sauf `rang`) : base du rejeu de reproductibilité. */
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly overridden?: { overrideId: string; original: RuleValue } | undefined;
}

export interface ComputedLine {
  readonly level: Level;
  readonly curriculumNodeId: Uuid | null;
  readonly parentNodeId: Uuid | null;
  readonly value: string | null;
  readonly displayValue: string | null;
  readonly credits: string | null;
  readonly coefficient: string | null;
  readonly validated: boolean | null;
  readonly statusCode: string | null;
  readonly sessionObtained: 1 | 2 | null;
  readonly resitEligible: boolean | null;
  readonly rank: number | null;
  readonly cohortSize: number | null;
  readonly overridden: boolean;
  readonly overrideId: Uuid | null;
  readonly outputs: Record<string, unknown>;
  readonly trace: readonly TraceRecord[] | null;
  readonly position: number;
}

export interface ComputedHeader {
  readonly average: string | null;
  readonly averageDisplay: string | null;
  readonly rank: number | null;
  readonly cohortSize: number | null;
  readonly mentionCode: string | null;
  readonly decisionCode: string | null;
  readonly decisionOutcome: DecisionOutcome | null;
  readonly creditsAcquired: string | null;
  readonly creditsRequired: string | null;
  readonly validated: boolean | null;
  readonly summary: Record<string, unknown>;
}

export interface ComputedFailure {
  readonly ruleKey: string;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string | undefined;
}

/** Résultat du calcul d'UNE inscription. */
export interface EnrollmentComputation {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly error: ComputedFailure | null;
  readonly inputsHash: string;
  /** Contexte canonique des entrées (sans identité d'élève) : conservé pour les résultats FINAL. */
  readonly inputs: unknown;
  readonly header: ComputedHeader | null;
  readonly lines: readonly ComputedLine[];
  readonly outputsHash: string | null;
}

export interface ClassComputation {
  readonly contractId: string;
  readonly enrollments: readonly EnrollmentComputation[];
}

/** Décision proposée par une règle (matérialisée dans `results.decisions`). */
export interface ProposedDecision {
  readonly enrollmentId: Uuid;
  readonly scope: StateScope;
  readonly kind: string;
  readonly code: string;
  readonly outcome: DecisionOutcome;
}
