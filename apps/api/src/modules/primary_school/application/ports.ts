/**
 * Ports du module primary_school. Le pack Primary est une COMPOSITION des modules existants : classe, période, inscription,
 * élève, enseignant, délibération, décision, résultat d'année et document sont des UUID SANS clé étrangère, dont l'existence et
 * le contenu viennent de ces ports, fournis à l'assemblage par `academic`, `people`, `results`, `rules`, `attendance` et
 * `reportcards` (adaptateurs `apps/api/src/platform/adapters/*-primary.ts`, enregistrés par `registerPrimarySchoolPorts`).
 *
 * Tant qu'un port n'est pas branché le module ÉCHOUE FERMÉ (`primary_school.port_unavailable`) : aucune écriture sur une classe
 * dont on ne sait pas qu'elle existe, aucun scellement sans résultat d'année, aucun accès famille sans lien de tutelle.
 * Les implémentations en mémoire (`infrastructure/in-memory-ports.ts`) servent aux tests et aux modules consommateurs.
 *
 * Aucune fonction de port ne prend de `Tx` (hors audit) : un port appartient à un AUTRE module, qui ouvre sa propre lecture.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { IsoDate, SourceKind, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Audit (adaptateur : infrastructure/audit-adapter.ts -> runtime.auditPort)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `entité.verbe`, ex. `primary_school.annual_review.sealed`. */
  action: string;
  resourceType: string;
  resourceId: string;
  /** JAMAIS d'appréciation, de niveau de maîtrise ni de note : identifiants, comptages et codes de cycle de vie seulement. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  sensitive?: boolean;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({ async record() {} });

/** Journal en mémoire pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, _ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

// ---------------------------------------------------------------------------
// academic : classes, inscriptions, périodes
// ---------------------------------------------------------------------------

export interface ClassroomInfo {
  readonly id: Uuid;
  readonly name: string | null;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  /** Code du niveau de classe (PS, CP1…). */
  readonly gradeLevelCode: string | null;
  /** Cycle (PRESCHOOL, PRIMARY). */
  readonly educationLevelCode: string | null;
  readonly status: string;
}

export interface RosterEntryInfo {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly displayName: string | null;
  readonly isRepeating: boolean;
}

export interface EnrollmentInfo {
  readonly id: Uuid;
  readonly classroomId: Uuid;
  readonly studentId: Uuid;
  readonly academicYearId: Uuid;
  readonly gradeLevelCode: string | null;
  readonly status: string;
  readonly isRepeating: boolean;
}

export interface PeriodInfo {
  readonly id: Uuid;
  readonly label: string;
  readonly ordinal: number;
}

export interface YearInfo {
  readonly id: Uuid;
  readonly institutionId: Uuid;
  readonly label: string | null;
  readonly status: string;
  /** L'année est clôturée (`closeAcademicYear` accompli). */
  readonly closed: boolean;
}

export interface ClassroomPort {
  /** `null` : classe inconnue du tenant (ou hors périmètre de l'appelant). */
  getClassroom(ctx: RequestContext, classroomId: Uuid): Promise<ClassroomInfo | null>;
  /** Élèves inscrits (actifs) de la classe, avec nom d'affichage quand il est connu. */
  listRoster(ctx: RequestContext, classroomId: Uuid): Promise<readonly RosterEntryInfo[]>;
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Périodes d'enseignement de l'année, par ordre. */
  listPeriods(ctx: RequestContext, academicYearId: Uuid): Promise<readonly PeriodInfo[]>;
  getYear(ctx: RequestContext, academicYearId: Uuid): Promise<YearInfo | null>;
  listClassrooms(ctx: RequestContext, filter: { academicYearId?: Uuid | undefined; institutionId?: Uuid | undefined }): Promise<readonly ClassroomInfo[]>;
  listInstitutions(ctx: RequestContext): Promise<ReadonlyArray<{ id: Uuid; name: string | null }>>;
}

/** État EFFECTIF d'une classe × période (academic) : la saisie est-elle arrêtée ? Échec fermé : inconnu = verrouillé. */
export interface PeriodStatePort {
  getState(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }): Promise<{ locked: boolean; state: string }>;
  /** Toutes les périodes de l'année sont-elles clôturées pour cette classe ? */
  allPeriodsClosed(ctx: RequestContext, input: { classroomId: Uuid; academicYearId: Uuid }): Promise<boolean>;
}

/** Issue d'inscription (`academic.recordEnrollmentOutcome`) : la décision confirmée du conseil l'alimente sans saisie manuelle. */
export interface OutcomePort {
  recordOutcome(ctx: RequestContext, input: { enrollmentId: Uuid; outcomeCode: string; decisionRef?: Uuid | undefined }): Promise<void>;
}

// ---------------------------------------------------------------------------
// people : enseignement, tutelle, noms
// ---------------------------------------------------------------------------

export interface ClassroomStaffInfo {
  readonly staffId: Uuid;
  readonly name: string | null;
  /** Rôle d'affectation (HOMEROOM, LEAD, SUPPORT…) : sert à proposer la convocation du conseil, jamais à décider d'un droit. */
  readonly roleCode: string;
}

export interface TeachingPort {
  /** Fiche de personnel liée au compte, ou `null` (un compte sans fiche n'enseigne rien). */
  staffIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  /** Le personnel est affecté à la classe à la date du jour. */
  isAssigned(ctx: RequestContext, staffId: Uuid, classroomId: Uuid): Promise<boolean>;
  /** Le personnel est TITULAIRE (HOMEROOM) de la classe. */
  isHomeroom(ctx: RequestContext, staffId: Uuid, classroomId: Uuid): Promise<boolean>;
  classroomIdsOfStaff(ctx: RequestContext, staffId: Uuid): Promise<readonly Uuid[]>;
  /** La classe a-t-elle un titulaire actif ? (garde d'activation, sans passer par un droit). */
  hasHomeroom(ctx: RequestContext, classroomId: Uuid): Promise<boolean>;
  listClassroomStaff(ctx: RequestContext, classroomId: Uuid): Promise<readonly ClassroomStaffInfo[]>;
  staffNames(ctx: RequestContext, staffIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
}

export interface GuardianshipPort {
  studentIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  isGuardianOf(ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean>;
  childrenOf(ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]>;
}

// ---------------------------------------------------------------------------
// results + rules : délibération, décisions, résultat d'année, règles
// ---------------------------------------------------------------------------

export interface CouncilOpening {
  readonly deliberationId: Uuid;
  readonly stateId: Uuid;
  readonly academicYearId: Uuid;
}

export interface DeliberationInfo {
  readonly id: Uuid;
  readonly classroomId: Uuid;
  readonly periodId: Uuid;
  readonly academicYearId: Uuid;
  readonly kind: string;
  readonly heldOn: IsoDate | null;
  readonly status: string;
  readonly participants: ReadonlyArray<{ staffId: Uuid; role: string }>;
}

export interface ProposalInfo {
  readonly decisionId: Uuid;
  readonly enrollmentId: Uuid;
  /** Proposition de la RÈGLE (code) : `PENDING`, `PROMOTED`, `REPEAT`, `COUNCIL_REVIEW`…, jamais un libellé. */
  readonly ruleProposalCode: string | null;
  readonly finalCode: string | null;
  readonly status: string;
  readonly justification: string | null;
}

export interface ConfirmedDecision {
  readonly decisionId: Uuid;
  readonly enrollmentId: Uuid;
  readonly finalCode: string;
  readonly ruleProposalCode: string | null;
  readonly changedFromProposal: boolean;
}

export interface YearResultInfo {
  /** Tous les résultats de période requis sont FINAL. */
  readonly complete: boolean;
  /** Référence du résultat d'année FINAL (`results.period_results.id`), ou `null`. */
  readonly yearResultRef: Uuid | null;
  /** Identifiant de la version de règle épinglée (UUID, `results.period_states.rule_version_id`). */
  readonly ruleVersionRef: Uuid | null;
  /** Origine du jeu de règles épinglé (`placeholder` = démonstration). */
  readonly ruleSourceKind: SourceKind | null;
  /** Décision de fin d'année proposée par la règle (code), si le résultat d'année la porte. */
  readonly yearDecisionCode: string | null;
}

export interface ResultsPort {
  /** Crée (ou retrouve) la délibération `COUNCIL` de la classe × période. */
  openCouncil(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid; heldOn?: IsoDate | undefined; participants: ReadonlyArray<{ staffId: Uuid; role: string }> }): Promise<CouncilOpening>;
  /** Délibération retrouvée par son identifiant ; la classe et la période (connues du dossier) évitent une recherche inter-modules. */
  getDeliberation(ctx: RequestContext, input: { deliberationId: Uuid; classroomId: Uuid; periodId: Uuid }): Promise<DeliberationInfo | null>;
  /** Propositions de la règle (décisions `PROPOSED`) et décisions confirmées de la classe × période. */
  listProposals(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }): Promise<readonly ProposalInfo[]>;
  confirmDecision(ctx: RequestContext, input: { decisionId: Uuid; deliberationId: Uuid; finalCode?: string | undefined; justification?: string | undefined }): Promise<ConfirmedDecision>;
  /** Résultat d'année d'une inscription ; `lastPeriodId` : dernière période de l'année (porte le résultat d'année FINAL et la décision). */
  getYearResult(ctx: RequestContext, input: { enrollmentId: Uuid; academicYearId: Uuid; lastPeriodId: Uuid | null }): Promise<YearResultInfo>;
  /** Origine du jeu de règles épinglé sur la période (pour le bandeau « règles de démonstration »). */
  getRuleSourceKind(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }): Promise<SourceKind | null>;
  /** Décision de FIN D'ANNÉE confirmée d'une inscription (portée par la dernière période de l'année de la classe), si elle existe. */
  getConfirmedYearDecision(ctx: RequestContext, input: { enrollmentId: Uuid; classroomId: Uuid; periodId: Uuid }): Promise<{ decisionId: Uuid; finalCode: string } | null>;
}

export interface RulesPort {
  /** Règle `quorum_conseil` du RuleSet lié. `null` : aucune règle liée (aucun quorum bloquant). */
  quorum(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid; convened: number; present: number }): Promise<{ met: boolean } | null>;
  /** Motifs d'examen (`cas_limite`, `cas_absences`, `cas_deja_redoublant`) par inscription ; absents : aucune règle liée. */
  councilFlags(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid; enrollmentIds: readonly Uuid[] }): Promise<ReadonlyMap<Uuid, readonly string[]>>;
}

// ---------------------------------------------------------------------------
// attendance, reportcards
// ---------------------------------------------------------------------------

export interface AttendanceYearSummary {
  readonly openDays: number | null;
  readonly absentDays: number | null;
  readonly justifiedAbsentDays: number | null;
  readonly lateCount: number | null;
}

export interface AttendanceRegisterRow {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly displayName: string | null;
  /**
   * Colonne du registre -> code de statut du pointage (P, A, L…), tel que reconstitué depuis les pointages. La colonne est une date
   * (`AAAA-MM-JJ`, appel de la journée entière) ou une demi-journée (`AAAA-MM-JJ:MORNING` / `AAAA-MM-JJ:AFTERNOON`, décision Q-P17).
   */
  readonly days: Readonly<Record<string, string>>;
}

export interface AttendancePort {
  /** Récapitulatif d'assiduité d'une inscription pour l'année (dérivé par `attendance`, jamais recalculé ici). */
  summarize(ctx: RequestContext, input: { enrollmentId: Uuid; academicYearId: Uuid }): Promise<AttendanceYearSummary>;
  /** Registre d'appel mensuel d'une classe (R3). */
  monthlyRegister(ctx: RequestContext, input: { classroomId: Uuid; month: string }): Promise<{ days: readonly string[]; rows: readonly AttendanceRegisterRow[] }>;
}

export interface MinutesRequest {
  /** Version du procès-verbal (`council_minutes.id`) : source du document ; une nouvelle version = un nouveau document. */
  readonly minutesId: Uuid;
  readonly deliberationId: Uuid;
  readonly classroomId: Uuid;
  readonly title: string;
  readonly issuedAt: Date;
  readonly content: Record<string, unknown>;
  readonly contentHash: string;
  /** `placeholder` : filigrane « règles de démonstration ». */
  readonly ruleSourceKind: SourceKind | null;
}

export interface ReviewDocumentRequest {
  readonly reviewId: Uuid;
  readonly title: string;
  readonly issuedAt: Date;
  readonly content: Record<string, unknown>;
  readonly contentHash: string;
  readonly ruleSourceKind: SourceKind | null;
}

export interface DocumentsPort {
  /** Périodes dont le bulletin est PUBLIÉ aux familles pour cette inscription (AC5.6 : les compétences ne se voient qu'après publication). */
  publishedPeriodIds(ctx: RequestContext, input: { studentId: Uuid; enrollmentId: Uuid }): Promise<readonly Uuid[]>;
  /** Demande le PV du conseil (nature `COUNCIL_MINUTES`) à partir d'un contenu FIGÉ. Idempotent par (délibération, empreinte). */
  requestCouncilMinutes(ctx: RequestContext, input: MinutesRequest): Promise<{ documentId: Uuid }>;
  /** Demande le PDF du bilan scellé (nature `ANNUAL_REVIEW`). Le rendu est asynchrone : `reportcard_id` est renseigné par l'événement de rendu. */
  requestAnnualReview(ctx: RequestContext, input: ReviewDocumentRequest): Promise<{ documentId: Uuid | null }>;
}

export interface PrimarySchoolPorts {
  readonly classrooms: ClassroomPort;
  readonly periods: PeriodStatePort;
  readonly outcomes: OutcomePort;
  readonly teaching: TeachingPort;
  readonly guardianship: GuardianshipPort;
  readonly results: ResultsPort;
  readonly rules: RulesPort;
  readonly attendance: AttendancePort;
  readonly documents: DocumentsPort;
  /** Fournisseur du modèle de pack `primary_school` (`tenancy.getPackTemplateSection`) ; défaut : modèle livré avec le module. */
  readonly templates: TemplatePort;
}

export interface TemplatePort {
  /** Section `primary_school` du modèle (système éducatif, pack PRIMARY), ou `null`. Le contenu est validé par le module. */
  getSection(educationSystem: string): unknown | null;
}
