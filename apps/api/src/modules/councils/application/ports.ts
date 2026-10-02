/**
 * Ports du module `councils`. Les références vers classes, périodes, inscriptions, élèves, personnel, programmes, niveaux, états
 * de résultats sont des UUID SANS clé étrangère : leur existence et leur appartenance sont vérifiées par ces ports, branchés par la
 * plateforme (`apps/api/src/platform/adapters/*-councils.ts`) à partir des API publiques d'`academic`, `people`, `results`,
 * `attendance`, `schoollife`, `notifications`, `reportcards`.
 *
 * Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ (`councils.port_unavailable`) pour toute écriture : pas de séance sans
 * l'état de résultats, pas d'ouverture sans la délibération de `results`, aucun effet appliqué à moitié. Les lectures facultatives
 * (assiduité, vie scolaire, noms) se dégradent avec un indicateur `available: false` (jamais une valeur inventée).
 * Implémentations en mémoire : `infrastructure/in-memory-ports.ts` (tests).
 *
 * Aucune fonction de port ne prend de `Tx` : un port appartient à un AUTRE module, qui ouvre sa propre lecture (dans la transaction
 * du contexte si c'est le même — SAVEPOINT). Les appels sont SÉQUENTIELS (une seule connexion par transaction).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AttendanceFacts, DisciplineFacts, ResultsFacts } from "../domain/facts";

export type Uuid = string;
export type IsoDate = string;
export type RuleSourceKind = "regulation" | "institution" | "platform" | "placeholder";

// ---------------------------------------------------------------------------
// academic : classes, périodes, effectif, inscriptions, issues
// ---------------------------------------------------------------------------

export interface ClassroomInfo {
  readonly classroomId: Uuid;
  readonly name: string | null;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly gradeLevelId: Uuid | null;
  readonly gradeLevelCode: string | null;
  readonly programId: Uuid | null;
  /** Une classe `ACTIVE` seulement accueille un conseil. */
  readonly active: boolean;
}

export interface PeriodInfo {
  readonly periodId: Uuid;
  readonly academicYearId: Uuid;
  readonly label: string | null;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
}

export interface RosterEntry {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  /** Nom d'affichage (people) ; `null` si indisponible. */
  readonly displayName: string | null;
  readonly isRepeating: boolean;
  /** Type de financement de l'inscription (donnée d'`academic`) ; `null` si inconnu. */
  readonly fundingType: string | null;
  readonly stateAssigned: boolean;
}

export interface EnrollmentInfo {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly programId: Uuid | null;
  readonly gradeLevelId: Uuid | null;
  readonly active: boolean;
}

export interface AcademicPort {
  getClassroom(ctx: RequestContext, classroomId: Uuid): Promise<ClassroomInfo | null>;
  getPeriod(ctx: RequestContext, periodId: Uuid): Promise<PeriodInfo | null>;
  /** Inscriptions ACTIVES de la classe à une date, avec nom, drapeau redoublant et financement. */
  getRoster(ctx: RequestContext, classroomId: Uuid, onDate: IsoDate): Promise<readonly RosterEntry[]>;
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Inscription vivante la plus récente d'un élève (portail). */
  getCurrentEnrollmentOfStudent(ctx: RequestContext, studentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Nom de l'établissement (impression du procès-verbal) ; `null` si inconnu. */
  getInstitutionName(ctx: RequestContext, institutionId: Uuid): Promise<string | null>;
}

export interface OutcomePort {
  /** Issue d'inscription de fin d'année (`academic.recordEnrollmentOutcome`), avec cible pour une issue de redirection. */
  recordOutcome(ctx: RequestContext, input: { enrollmentId: Uuid; outcomeCode: string; targetProgramId?: Uuid | undefined; targetGradeLevelId?: Uuid | undefined; decisionRef: Uuid }): Promise<void>;
  /** Issue de redirection vers une autre série pour l'année suivante (l'adaptateur choisit l'issue `REDIRECT` des données d'academic). */
  recordRedirect(ctx: RequestContext, input: { enrollmentId: Uuid; targetProgramId: Uuid; targetGradeLevelId: Uuid; decisionRef: Uuid }): Promise<void>;
  /** Changement de classe en cours d'année (même établissement, même année). Retourne l'identifiant de l'inscription. */
  transferEnrollment(ctx: RequestContext, input: { enrollmentId: Uuid; toClassroomId: Uuid; effectiveOn: IsoDate | undefined; reason: string }): Promise<{ enrollmentId: Uuid }>;
}

// ---------------------------------------------------------------------------
// results : lecture (état, faits) et écriture (délibération, décisions, appréciations, distinctions)
// ---------------------------------------------------------------------------

export interface ResultsStateView {
  readonly stateId: Uuid;
  /** `OPEN`, `GRADING_LOCKED`, `DELIBERATED` ou `CLOSED`. */
  readonly status: string;
  readonly ruleVersionRef: string | null;
  readonly ruleSourceKind: RuleSourceKind | null;
}

export interface ResultsReadPort {
  /** État de résultats de la classe sur la période (`null` : bilan de fin d'année = dernière période d'enseignement). `null` : aucun résultat. */
  getStateView(ctx: RequestContext, input: { classroomId: Uuid; academicYearId: Uuid; academicPeriodId: Uuid | null }): Promise<ResultsStateView | null>;
  /** Résultats de chaque inscription (valeurs de `results` recopiées SANS calcul). Une inscription sans résultat est absente de la table. */
  getEnrollmentFacts(ctx: RequestContext, input: { classroomId: Uuid; academicYearId: Uuid; academicPeriodId: Uuid | null; enrollmentIds: readonly Uuid[] }): Promise<ReadonlyMap<Uuid, ResultsFacts>>;
}

export interface CouncilWriteRef {
  /** Référence OPAQUE de l'acte source (séance, décision, proposition) : tracée et auditée par `results`. */
  readonly councilRef: string;
}

export interface ResultsWritePort {
  openDeliberation(ctx: RequestContext, input: CouncilWriteRef & { stateId: Uuid; heldOn: IsoDate; participants: ReadonlyArray<{ staffId: Uuid; role: string }> }): Promise<{ deliberationId: Uuid }>;
  markDeliberationHeld(ctx: RequestContext, input: CouncilWriteRef & { deliberationId: Uuid; heldOn: IsoDate; participants: ReadonlyArray<{ staffId: Uuid; role: string }> }): Promise<void>;
  markDeliberationSigned(ctx: RequestContext, input: CouncilWriteRef & { deliberationId: Uuid; heldOn: IsoDate }): Promise<void>;
  /** Séance annulée avant ou pendant l'ouverture : la délibération de `results` est annulée aussi. */
  cancelDeliberation(ctx: RequestContext, input: CouncilWriteRef & { deliberationId: Uuid }): Promise<void>;
  publishYearDecision(ctx: RequestContext, input: CouncilWriteRef & { stateId: Uuid; enrollmentId: Uuid; finalCode: string; deliberationId: Uuid | null; justification: string | null }): Promise<{ decisionId: Uuid }>;
  recordDistinction(ctx: RequestContext, input: CouncilWriteRef & { stateId: Uuid; enrollmentId: Uuid; distinctionCode: string; scope: "PERIOD" | "YEAR"; deliberationId: Uuid | null }): Promise<{ decisionId: Uuid }>;
  writeAppreciation(ctx: RequestContext, input: CouncilWriteRef & { stateId: Uuid; enrollmentId: Uuid; authorStaffId: Uuid; body: string }): Promise<{ appreciationId: Uuid }>;
}

/** Codes finaux de décision de fin d'année PERMIS par le contrat de règles (validation à la configuration d'un type de décision). */
export interface RuleCodesPort {
  allowedYearEndCodes(ctx: RequestContext): Promise<readonly string[] | null>;
}

// ---------------------------------------------------------------------------
// attendance, schoollife : lectures (comptages)
// ---------------------------------------------------------------------------

export interface AttendancePort {
  /** Valeurs EFFECTIVES de la période (ou de toute l'année quand `academicPeriodId` est `null`), recopiées sans calcul. `null` : indisponible. */
  summarize(ctx: RequestContext, input: { enrollmentId: Uuid; academicYearId: Uuid; academicPeriodId: Uuid | null }): Promise<AttendanceFacts | null>;
}

export interface SchoolLifePort {
  /** Comptages et codes de vie scolaire (jamais un texte libre ni un élément confidentiel). `null` : indisponible. */
  disciplineFacts(ctx: RequestContext, input: { enrollmentId: Uuid; studentId: Uuid; academicYearId: Uuid }): Promise<DisciplineFacts | null>;
}

// ---------------------------------------------------------------------------
// people : personnel, tutelle, statut d'élève
// ---------------------------------------------------------------------------

export interface StaffAssignmentInfo {
  readonly staffId: Uuid;
  readonly displayName: string;
  /** `HOMEROOM`, `TEACHER`, `SUPERVISOR`… (rôle d'affectation de `people`). */
  readonly assignmentRole: string;
  readonly coversAllSubjects: boolean;
}

export interface StaffPort {
  listAssignmentsForClassroom(ctx: RequestContext, classroomId: Uuid, onDate: IsoDate): Promise<readonly StaffAssignmentInfo[]>;
  getStaffNames(ctx: RequestContext, staffIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
  /** Fiche du personnel liée au COMPTE (jamais par e-mail), `null` sans fiche. */
  staffIdOfUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  /** L'enseignant est-il affecté à cette classe ? (périmètre de lecture d'un enseignant). */
  isStaffAssignedToClassroom(ctx: RequestContext, userId: Uuid, classroomId: Uuid): Promise<boolean>;
  /** Nom figé d'un acteur (jamais vide : repli « Utilisateur »). */
  displayNameOfUser(ctx: RequestContext, userId: Uuid): Promise<string>;
}

export interface FamilyPort {
  /** Le tuteur LIÉ (lien vivant) d'un élève : relu à chaque lecture, jamais déduit d'un en-tête client. */
  isGuardianOfStudent(ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean>;
  /** Dossier élève du compte connecté (portail élève). */
  getStudentIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  getStudentNames(ctx: RequestContext, studentIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
}

export type StudentStatusTarget = "SUSPENDED" | "EXCLUDED" | "ACTIVE";

/** Statut de l'élève : UNIQUEMENT par un acte d'utilisateur habilité (jamais un job). */
export interface StudentStatusPort {
  changeStudentStatus(ctx: RequestContext, input: { studentId: Uuid; status: StudentStatusTarget; reasonText: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// notifications, documents, stockage, modèle de pack
// ---------------------------------------------------------------------------

export interface NotificationPort {
  /** Convocation du personnel (message neutre : date, lieu, classe). Lève (échec explicite) si personne n'est joignable. */
  notifyParticipants(ctx: RequestContext, input: { councilId: Uuid; staffIds: readonly Uuid[]; variables: Readonly<Record<string, string>>; clientKey: Uuid }): Promise<{ recipients: number; queued: number }>;
  /** Information NEUTRE des tuteurs (« une décision est disponible dans l'application ») : jamais le contenu de la décision. */
  notifyGuardians(ctx: RequestContext, input: { studentId: Uuid; studentName: string; clientKey: Uuid }): Promise<{ recipients: number; queued: number }>;
}

export interface MinutesDocumentRequest {
  readonly minutesId: Uuid;
  readonly title: string;
  readonly issuedAt: Date;
  /** Snapshot `council-minutes/1` : le rendu se fait DEPUIS CE SNAPSHOT SEUL. */
  readonly snapshot: Record<string, unknown>;
  readonly ruleSourceKind: RuleSourceKind | null;
  readonly templateKey: string | null;
}

export interface RenderedDocument {
  readonly documentId: Uuid;
  readonly renderStatus: "PENDING" | "RENDERED" | "FAILED";
  readonly objectKey: string | null;
  readonly pdfHash: string | null;
}

export interface DocumentsPort {
  requestMinutes(ctx: RequestContext, input: MinutesDocumentRequest): Promise<{ documentId: Uuid }>;
  /** État du document officiel d'un procès-verbal ; `null` : jamais demandé. */
  getMinutesDocument(ctx: RequestContext, minutesId: Uuid): Promise<RenderedDocument | null>;
  /** URL signée de lecture du PDF rendu (durée en secondes, ≤ 300). */
  signedReadUrl(ctx: RequestContext, objectKey: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
}

export interface StoragePort {
  /** La pièce (signature papier numérisée) existe-t-elle dans le stockage du tenant ? */
  objectExists(ctx: RequestContext, objectKey: string): Promise<boolean>;
}

export interface TemplatePort {
  /** Section `councils` du modèle de pack du système éducatif ; `null` : aucun modèle. */
  getSection(educationSystem: string): unknown | null;
}

export interface CouncilsPorts {
  readonly academic: AcademicPort;
  readonly outcomes: OutcomePort;
  readonly resultsRead: ResultsReadPort;
  readonly resultsWrite: ResultsWritePort;
  readonly ruleCodes: RuleCodesPort;
  readonly attendance: AttendancePort;
  readonly schoollife: SchoolLifePort;
  readonly staff: StaffPort;
  readonly family: FamilyPort;
  readonly studentStatus: StudentStatusPort;
  readonly notifications: NotificationPort;
  readonly documents: DocumentsPort;
  readonly storage: StoragePort;
  readonly templates: TemplatePort;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `councils.<entité>.<action>` — ex. `councils.council.opened`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (décision, signature, ouverture, déverrouillage, application d'exclusion, dérogation…). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
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
