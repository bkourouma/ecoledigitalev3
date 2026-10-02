/**
 * Ports du module higher. Les références vers le curriculum, les inscriptions, les étudiants, les résultats et les
 * signataires sont des UUID SANS clé étrangère : leur existence et leur contenu viennent de ces ports, fournis à
 * l'assemblage par `academic` (004), `people` (008), `results` (011), `rules` (012) et `reportcards` (013), qui
 * s'enregistrent par `registerHigherPorts(app, ports)` (comme `attendance`).
 *
 * Tant qu'un port n'est pas branché le module ÉCHOUE FERMÉ (`higher.port_unavailable`), jamais en silence : aucune
 * capitalisation sans la source de vérité des résultats, aucune émission sans signataire. Les implémentations en mémoire
 * (`infrastructure/in-memory-ports.ts`) servent aux tests et aux modules consommateurs.
 *
 * Aucune fonction de port ne prend de `Tx` (hors audit) : un port appartient à un AUTRE module, qui ouvre sa propre
 * lecture ; seule la décision métier traverse la frontière.
 */
import type { AppError, RequestContext, Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { DecimalString, IsoDate, UeState, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// results : résultats FINAL publiés (source de la capitalisation et du rattrapage)
// ---------------------------------------------------------------------------

/** Une ligne d'UE d'un résultat `FINAL` publié (011) : un étudiant, une UE, une période. */
export interface UeResultLine {
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  /** Crédits de l'UE FIGÉS au résultat (AC1.5). */
  readonly credits: number;
  /** Moyenne d'UE exacte (jamais arrondie), ou `null`. */
  readonly averageExact: DecimalString | null;
  /** Décidé par la règle `ue_validee` du module results — ce module ne recalcule rien. */
  readonly validated: boolean;
  /** État rendu par la règle `etat_ue` (`VALIDATED` | `RESIT` | `DEBT`). */
  readonly ueState: UeState;
  /** Session d'obtention (règle `session_validation_ue`) ; `null` si non validée. */
  readonly sessionObtained: 1 | 2 | null;
  readonly via: "DIRECT" | "RESIT" | "JURY_OVERRIDE";
  /** `results.overrides.id` si la validation vient du jury. */
  readonly overrideId: Uuid | null;
  readonly compensatedEcueCount: number;
  readonly sourceResultId: Uuid;
  readonly resultsVersion: number;
  /** Date de validation de l'UE (clôture du résultat) ; à défaut, l'instant de la capitalisation. */
  readonly validatedAt?: Date | undefined;
}

export interface ListFinalLinesQuery {
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly stateId?: Uuid | undefined;
  readonly resultsVersion?: number | undefined;
}

/** Candidat au rattrapage : ligne d'ECUE `resit_eligible` d'un résultat FINAL (règle `eligible_rattrapage`). */
export interface ResitCandidateLine {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly ecueNodeId: Uuid;
  readonly ueNodeId: Uuid;
  readonly session1Average: DecimalString | null;
}

export interface ResitCandidates {
  readonly stateId: Uuid;
  readonly candidates: readonly ResitCandidateLine[];
}

export interface CreditsSourcePort {
  /** Lignes d'UE des résultats `FINAL` publiés d'une classe × période (version la plus récente par défaut). */
  listFinalUeLines(ctx: RequestContext, query: ListFinalLinesQuery): Promise<readonly UeResultLine[]>;
  /** Candidats au rattrapage d'une classe × période (jamais recalculés ici, AC3.1). */
  listResitCandidates(ctx: RequestContext, query: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<ResitCandidates>;
}

/** Ouverture / fermeture de la session 2 d'une période (réouverture de type `RESIT_SESSION` de 011). */
export interface ResitSessionPort {
  openResitSession(ctx: RequestContext, input: { stateId: Uuid; classroomId: Uuid; academicPeriodId: Uuid; nodeIds: readonly Uuid[] }): Promise<void>;
  closeResitSession(ctx: RequestContext, input: { stateId: Uuid | null; classroomId: Uuid; academicPeriodId: Uuid }): Promise<void>;
}

export interface CycleSemesterResult {
  readonly academicPeriodId: Uuid;
  readonly academicYearId: Uuid;
  /** Moyenne de semestre exacte du résultat FINAL. */
  readonly average: DecimalString | null;
  /** Crédits du semestre (pondération de la moyenne de cycle). */
  readonly credits: number;
}

export interface CycleResults {
  /** Tous les semestres du cycle ont un résultat FINAL ? Sinon la mention est « en attente ». */
  readonly complete: boolean;
  readonly semesters: readonly CycleSemesterResult[];
}

export interface CycleResultsPort {
  /** Résultats FINAL des semestres d'un cycle (ou programme) pour un étudiant. */
  getCycleResults(ctx: RequestContext, input: { studentId: Uuid; nodeId: Uuid }): Promise<CycleResults>;
}

// ---------------------------------------------------------------------------
// academic : curriculum et inscriptions
// ---------------------------------------------------------------------------

export interface CurriculumNodeInfo {
  readonly nodeId: Uuid;
  readonly code: string;
  readonly label: string;
  /** Nœud « cycle / diplôme » racine d'un ensemble de niveaux (exigence envers 004). */
  readonly isCycle: boolean;
  /** Nœud « programme / filière ». */
  readonly isProgram: boolean;
}

export interface UeInfo {
  readonly nodeId: Uuid;
  readonly code: string;
  readonly label: string;
  readonly credits: number;
  /** Programme / filière auquel l'UE appartient (condition « même programme » des prérequis). */
  readonly programNodeId: Uuid | null;
  readonly category?: string | null;
}

export interface CurriculumPort {
  getNode(ctx: RequestContext, nodeId: Uuid): Promise<CurriculumNodeInfo | null>;
  getUe(ctx: RequestContext, ueNodeId: Uuid): Promise<UeInfo | null>;
  /** UE d'un cycle / diplôme (tous niveaux). */
  listCycleUe(ctx: RequestContext, cycleNodeId: Uuid): Promise<readonly UeInfo[]>;
  /** UE d'un programme / filière. */
  listProgramUe(ctx: RequestContext, programNodeId: Uuid): Promise<readonly UeInfo[]>;
}

export interface CycleEnrollment {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly academicYearId: Uuid;
}

export interface LastEnrollment {
  readonly enrollmentId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicYearLabel: string | null;
}

export interface EnrollmentInfo {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly academicYearId: Uuid;
  readonly active: boolean;
}

export interface EnrollmentDirectory {
  /** Inscriptions des étudiants d'un cycle (candidats à la diplomation). */
  listCycleEnrollments(ctx: RequestContext, cycleNodeId: Uuid): Promise<readonly CycleEnrollment[]>;
  /** Dernière inscription de l'étudiant dans le cycle / programme (année académique du diplôme). */
  getLastEnrollment(ctx: RequestContext, input: { studentId: Uuid; nodeId: Uuid }): Promise<LastEnrollment | null>;
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Étudiants actuellement inscrits à une UE (avertissement lors d'un changement de prérequis). */
  listUeRegistrants(ctx: RequestContext, ueNodeId: Uuid): Promise<readonly Uuid[]>;
  /** L'étudiant a-t-il SUIVI l'UE (mode de prérequis `ATTENDED`) ? */
  hasAttendedUe(ctx: RequestContext, input: { studentId: Uuid; ueNodeId: Uuid }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// people : étudiants, tuteurs, utilisateurs
// ---------------------------------------------------------------------------

export interface StudentIdentity {
  readonly studentId: Uuid;
  readonly fullName: string;
  readonly matricule: string | null;
  readonly birthDate: IsoDate | null;
  readonly birthPlace: string | null;
}

export interface StudentDirectory {
  getIdentity(ctx: RequestContext, studentId: Uuid): Promise<StudentIdentity | null>;
  /** Profil d'étudiant lié à un compte (portail étudiant). */
  getStudentIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  /** Le compte est-il tuteur lié (non révoqué) de l'étudiant ? */
  isGuardianOf(ctx: RequestContext, input: { userId: Uuid; studentId: Uuid }): Promise<boolean>;
}

export interface ActorDirectory {
  /** Nom d'affichage d'un utilisateur (imprimé dans l'octroi et le document). `null` si inconnu. */
  displayName(ctx: RequestContext, userId: Uuid): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// reportcards : signataires et identité de l'établissement
// ---------------------------------------------------------------------------

export interface SignatoryInfo {
  readonly signatoryId: Uuid;
  readonly fullName: string;
  readonly title: string | null;
  readonly function: string | null;
  readonly active: boolean;
}

export interface SignatoryDirectory {
  getSignatory(ctx: RequestContext, signatoryId: Uuid): Promise<SignatoryInfo | null>;
}

export interface InstitutionProfile {
  readonly name: string;
  readonly shortName?: string | null;
  readonly address?: string | null;
  readonly country?: string | null;
  /** Référence du logo (stockage), copiée dans le snapshot ; le rendu la résout. */
  readonly logoRef?: string | null;
}

export interface InstitutionPort {
  getInstitution(ctx: RequestContext, institutionId: Uuid | null): Promise<InstitutionProfile>;
}

// ---------------------------------------------------------------------------
// rules : éligibilité au diplôme, moyenne de cycle, mention
// ---------------------------------------------------------------------------

export interface RuleRef {
  readonly ruleSetCode: string;
  readonly ruleVersionId: Uuid;
  readonly versionNo: number;
  readonly definitionHash: string;
}

export interface RuleScope {
  readonly institutionId?: Uuid | undefined;
  readonly curriculumNodeId?: Uuid | undefined;
  /** Date d'effet du jeu de règles (`AAAA-MM-JJ`). */
  readonly onDate: IsoDate;
}

export interface EligibilityEvaluation {
  readonly eligible: boolean;
  readonly rule: RuleRef;
  readonly inputsHash: string;
  readonly outputsHash: string;
}

export interface CycleEvaluation {
  /** Moyenne de cycle exacte (règle `moyenne_annuelle`), `null` sans semestre noté. */
  readonly average: DecimalString | null;
  /** Code de mention du contrat (règle `mention_diplome`). */
  readonly mentionCode: string;
  readonly rule: RuleRef;
}

export interface DiplomaRulesPort {
  /** Règle `diplome_eligible`. */
  evaluateEligibility(
    ctx: RequestContext,
    input: { exigences: ReadonlyArray<{ valide: boolean; obligatoire: boolean; uv: number }>; uvRequises: number; scope: RuleScope },
  ): Promise<Result<EligibilityEvaluation, AppError>>;
  /** Règles `moyenne_annuelle` puis `mention_diplome`. */
  evaluateCycle(
    ctx: RequestContext,
    input: { semestres: ReadonlyArray<{ moyenne: DecimalString | null; credits: number }>; scope: RuleScope },
  ): Promise<Result<CycleEvaluation, AppError>>;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `higher.<entité>.<action>` — ex. `higher.award.revoked`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (octroi, forçage, révocation, émission, affectation de signataire). */
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

// ---------------------------------------------------------------------------
// reportcards : scellement, rendu PDF et stockage des documents officiels
// ---------------------------------------------------------------------------

/** Résultat du scellement d'un document : signature Ed25519 de l'empreinte du snapshot (clé de l'environnement). */
export interface SealedDocumentInfo {
  readonly signingKeyId: string;
  readonly signature: string;
}

/** Un PDF rendu depuis le snapshot et stocké : clé d'objet, empreinte SHA-256 du fichier, gabarit utilisé. */
export interface RenderedDocumentFile {
  readonly objectKey: string;
  readonly pdfHash: string;
  readonly pages: number;
  readonly templateKey: string;
  readonly templateVersion: number;
}

/**
 * Fichiers des documents officiels (013) : le module `higher` produit le snapshot immuable et son empreinte ; `reportcards`
 * le SCELLE (signature Ed25519, code inscrit dans l'index de vérification publique), le RAND en PDF (gabarit de plateforme,
 * worker) et le STOCKE. Repli si non branché : `higher.port_unavailable` (jamais de document « scellé » en silence).
 */
export interface DocumentFilesPort {
  /** Prépare le scellement HORS transaction (enregistrement de la clé publique de signature : accès système). Échoue si aucune clé n'est configurée. */
  prepareSeal(ctx: RequestContext): Promise<Result<void, AppError>>;
  /** Signe l'empreinte et inscrit le code dans l'index public, DANS la transaction de l'appelant (document et index naissent ensemble). */
  seal(ctx: RequestContext, tx: Tx, input: { documentId: Uuid; kind: string; snapshotHash: string; verificationCode: string; issuedAt: Date }): Promise<Result<SealedDocumentInfo, AppError>>;
  /** Rend le PDF depuis le contexte du gabarit, le stocke et indexe son empreinte (reconnaissance d'un fichier téléversé). Idempotent. */
  render(ctx: RequestContext, input: { documentId: Uuid; kind: string; templateKey: string; title: string; context: Readonly<Record<string, unknown>>; verificationCode: string; issuedAt: Date; logoRef: string | null }): Promise<Result<RenderedDocumentFile, AppError>>;
  /** URL de lecture à durée courte (jamais un chemin de stockage). */
  signedUrl(ctx: RequestContext, objectKey: string, options: { ttlSec: number; fileName: string }): Promise<string>;
}

export interface HigherPorts {
  readonly documents: DocumentFilesPort;
  readonly credits: CreditsSourcePort;
  readonly resitSession: ResitSessionPort;
  readonly cycleResults: CycleResultsPort;
  readonly curriculum: CurriculumPort;
  readonly enrollments: EnrollmentDirectory;
  readonly students: StudentDirectory;
  readonly actors: ActorDirectory;
  readonly signatories: SignatoryDirectory;
  readonly institution: InstitutionPort;
  readonly rules: DiplomaRulesPort;
}
