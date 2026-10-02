/**
 * Ports du module `examinations` : ce qu'il attend de ses voisins, décrit STRUCTURELLEMENT (aucun import d'un autre module).
 * La plateforme les branche par des adaptateurs (`apps/api/src/platform/adapters/examinations-*.ts`) ; un port non branché
 * fait échouer le module FERMÉ (`examinations.port_unavailable`) : pas d'éligibilité sans faits, pas de document sans
 * scellement, pas de dépôt sans stockage.
 *
 * Interfaces attendues des modules fournisseurs (à livrer par leur propriétaire, voir README §Interfaces attendues) :
 *   - rules       : contrat `exam-national@1` (résolution + évaluation par lot) ;
 *   - academic    : `getEligibilityFacts(enrollmentId, …)` ;
 *   - assess      : lecture des notes publiées d'une évaluation ;
 *   - reportcards : natures `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATION`… de `requestOfficialDocument` ;
 *   - documents   : vérification d'une pièce (propriétaire = élève).
 */
import type { AppError, Clock, Logger, RequestContext, Result } from "@ecoledigitale/kernel";
import type { TenantDb, Tx } from "@ecoledigitale/database";

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `examinations.<entité>.<action>`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (publication, révision, application d'un import, dérogation d'éligibilité…). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  /** Identifiants, codes, effectifs : JAMAIS de note, de moyenne ni de nom d'élève. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit est branché par l'adaptateur de http/plugin.ts */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}

// ---------------------------------------------------------------------------
// Élèves, inscriptions, classes (academic + people)
// ---------------------------------------------------------------------------

export interface EnrollmentFacts {
  enrollmentId: string;
  studentId: string;
  institutionId: string;
  classroomId: string | null;
  /** Code du niveau (`grade level`) de la classe, ex. le niveau d'examen d'un type. */
  gradeLevelCode: string | null;
  academicYearId: string | null;
  /** Inscription en cours (ni retirée, ni annulée). */
  active: boolean;
}

export interface RosterEntry {
  enrollmentId: string;
  studentId: string;
}

export interface ClassroomRoster {
  classroomId: string;
  institutionId: string;
  gradeLevelCode: string | null;
  items: RosterEntry[];
}

export interface StudentIdentity {
  studentId: string;
  lastName: string;
  firstName: string;
  /** `AAAA-MM-JJ`. */
  birthDate: string | null;
  birthPlace: string | null;
  sex: "F" | "M" | null;
}

export interface StudentDirectory {
  getEnrollment(ctx: RequestContext, enrollmentId: string): Promise<EnrollmentFacts | null>;
  /** Élèves d'une classe (inscriptions en cours) ; `null` si la classe est inconnue. */
  getClassroomRoster(ctx: RequestContext, classroomId: string): Promise<ClassroomRoster | null>;
  /** Identité d'état civil d'un élève (copiée et figée à l'inscription à l'examen). */
  getIdentity(ctx: RequestContext, studentId: string): Promise<StudentIdentity | null>;
}

export interface EligibilityFactsInput {
  enrollmentId: string;
  studentId: string;
  /** Niveau de la classe d'examen du type (ex. `CM2`), ou `null` si le type n'en déclare pas. */
  examGradeLevelCode: string | null;
  /** Date de référence de l'âge (donnée de la session), ou `null` : l'âge n'est alors pas fourni. */
  referenceDate: string | null;
}

export interface EligibilityFacts {
  /** L'élève est inscrit dans la classe (le niveau) d'examen. */
  inExamGrade: boolean;
  /** Âge en années entières à la date de référence, ou `null` (jamais 0 par défaut). */
  ageYears: number | null;
}

export interface EligibilityFactsPort {
  /** Échec fermé : une erreur ou un port absent interdit l'évaluation (jamais « éligible » par défaut). */
  getEligibilityFacts(ctx: RequestContext, input: EligibilityFactsInput): Promise<Result<EligibilityFacts, AppError>>;
}

export interface InstitutionDirectory {
  exists(ctx: RequestContext, institutionId: string): Promise<boolean>;
  /** Libellé (nom) de l'établissement pour les exports et les documents ; `null` si inconnu. */
  nameOf(ctx: RequestContext, institutionId: string): Promise<string | null>;
}

/** Liens de tutelle (famille) : relus à chaque requête, jamais mis en cache. */
export interface FamilyLinks {
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  childrenOf(ctx: RequestContext, userId: string): Promise<string[]>;
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Règles (rules) : contrat `exam-national@1`
// ---------------------------------------------------------------------------

export interface RulePin {
  ruleVersionId: string;
  ruleSetCode: string;
  versionNo: number;
  /** Origine de la version (`regulation`, `placeholder`…), si le fournisseur la connaît : sert au bandeau « règles de démonstration ». */
  sourceKind: string | null;
}

export interface RuleCall {
  readonly ruleKey: string;
  /** Variables d'entrée : nombres en CHAÎNES décimales exactes, listes en tableaux, objets en objets. */
  readonly variables: Readonly<Record<string, unknown>>;
}

export type RuleCallResult =
  | { readonly ok: true; readonly value: string | boolean | null; readonly inputsHash: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface RuleSession {
  readonly pin: RulePin;
  readonly engineVersion: string;
  /** Évaluation SYNCHRONE d'un lot (la version est déjà chargée) : un résultat par appel, dans l'ordre. */
  evaluate(calls: readonly RuleCall[]): RuleCallResult[];
}

export interface RulesPort {
  /** Version applicable du contrat à la date (début de session), ou `null` (aucune liaison : calcul automatique impossible). */
  resolve(ctx: RequestContext, input: { contractId: string; institutionId: string; levelCode: string | null; date: string }): Promise<Result<RulePin | null, AppError>>;
  /** Charge la version ÉPINGLÉE (empreinte de définition vérifiée par le fournisseur) et rend un évaluateur. */
  open(ctx: RequestContext, ruleVersionId: string): Promise<Result<RuleSession, AppError>>;
}

// ---------------------------------------------------------------------------
// Évaluations (assess) — examens blancs
// ---------------------------------------------------------------------------

export interface AssessmentFacts {
  assessmentId: string;
  classroomId: string;
  /** Code du type d'évaluation (`EXAMEN_BLANC` pour une évaluation d'examen blanc : non visible des élèves). */
  typeCode: string | null;
  scaleMax: string;
  title: string;
  /** L'évaluation est publiée (ses notes sont lisibles). */
  published: boolean;
}

export interface PublishedGradeFact {
  studentId: string;
  enrollmentId: string;
  assessmentId: string;
  score: string | null;
  /** `ENTERED`, `ABSENT`, `EXCUSED`… (états de saisie d'`assess`). */
  entryStatus: string;
}

export interface AssessPort {
  getAssessment(ctx: RequestContext, assessmentId: string): Promise<AssessmentFacts | null>;
  /** Notes PUBLIÉES d'une évaluation d'une classe (les brouillons ne sont jamais lus). */
  listPublishedGrades(ctx: RequestContext, input: { classroomId: string; assessmentId: string }): Promise<PublishedGradeFact[]>;
}

// ---------------------------------------------------------------------------
// Documents (pièces du candidat) et documents officiels
// ---------------------------------------------------------------------------

/** Vérifie qu'une pièce déposée dans `documents` existe, est visible de l'appelant et appartient à l'élève. */
export interface PieceDocumentPort {
  verify(ctx: RequestContext, input: { documentId: string; studentId: string }): Promise<boolean>;
}

export type ExamOfficialKind = "EXAM_CONVOCATION" | "EXAM_SUCCESS_CERTIFICATE" | "EXAM_TRANSCRIPT";

export interface OfficialDocumentRequest {
  kind: ExamOfficialKind;
  /** `issued_documents.id` : demande idempotente (un seul document scellé par source). */
  sourceId: string;
  title: string;
  issuedAt: Date;
  institutionId: string;
  /** Contenu figé scellé (chaînes, entiers, booléens, null — jamais de flottant). */
  content: Record<string, unknown>;
  /** Contexte d'impression (chaînes déjà mises en forme). */
  context: Record<string, unknown>;
}

export interface OfficialDocumentState {
  documentId: string;
  status: "PENDING" | "RENDERED" | "FAILED";
  fileName: string | null;
  bytes: Uint8Array | null;
  verificationCode: string | null;
}

export interface OfficialDocumentPort {
  /** Scelle le document (QR, signature) et demande son rendu. Idempotent par `sourceId`. */
  request(ctx: RequestContext, input: OfficialDocumentRequest): Promise<Result<{ documentId: string }, AppError>>;
  /** État et fichier (si rendu) d'un document scellé. */
  read(ctx: RequestContext, documentId: string): Promise<Result<OfficialDocumentState | null, AppError>>;
}

// ---------------------------------------------------------------------------
// Stockage d'objets (fichiers d'import et d'export) — même forme que le port de `documents`
// ---------------------------------------------------------------------------

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface StoragePort {
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, options: { ttlSeconds: number; fileName: string; contentType: string }): Promise<{ url: string; expiresAt: Date }>;
}

// ---------------------------------------------------------------------------
// Ensemble
// ---------------------------------------------------------------------------

export interface ExaminationsPorts {
  readonly students: StudentDirectory;
  readonly eligibility: EligibilityFactsPort;
  readonly institutions: InstitutionDirectory;
  readonly family: FamilyLinks;
  readonly rules: RulesPort;
  readonly assess: AssessPort;
  readonly pieces: PieceDocumentPort;
  readonly officialDocuments: OfficialDocumentPort;
  readonly storage: StoragePort;
}

export interface ExaminationsConfig {
  readonly pageSizeDefault: number;
  readonly pageSizeMax: number;
  /** Durée de validité (secondes) d'une URL signée de téléchargement. */
  readonly signedUrlTtlSeconds: number;
  /** Plafond de lignes d'un export. */
  readonly exportMaxRows: number;
  /** Plafond de la cohorte transmise à la règle de rang (limite du moteur : `exam-national@1`). */
  readonly rankCohortMax: number;
  /** Plafond d'un lot de saisie de notes. */
  readonly bulkMaxItems: number;
}

export const DEFAULT_EXAMINATIONS_CONFIG: ExaminationsConfig = Object.freeze({
  pageSizeDefault: 50,
  pageSizeMax: 500,
  signedUrlTtlSeconds: 60,
  exportMaxRows: 50_000,
  rankCohortMax: 5_000,
  bulkMaxItems: 2_000,
});

export interface ExaminationsDepsShape {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: ExaminationsPorts;
  readonly config: ExaminationsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}
