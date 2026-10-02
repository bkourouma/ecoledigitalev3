/**
 * Ports du module admissions. Établissement, niveau, classe, élève, inscription, facture, pièces et notifications sont des
 * UUID / codes SANS clé étrangère : leur existence et leurs règles sont vérifiées par ces ports, fournis à l'assemblage par
 * `apps/api/src/platform/adapters` (people, academic, finance, documents/stockage, notifications). Tant qu'un port n'est pas
 * branché, le module ÉCHOUE FERMÉ (`admissions.port_unavailable`).
 *
 * Un port appartient à un AUTRE module : aucune fonction de port ne prend de `Tx`. Les appels aux modules voisins qui écrivent
 * (`people`, `academic`, `finance`) se font dans la transaction de l'appelant (même contexte → SAVEPOINT de `TenantDb`) et sont
 * SÉQUENTIELS (une transaction = une connexion : jamais de `Promise.all`).
 *
 * Interfaces attendues des modules voisins (si un point manque, l'adaptateur échoue fermé) : voir README, section « Interfaces ».
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

export type Uuid = string;

// ---------------------------------------------------------------------------
// people : dossier permanent de l'élève, tuteurs, doublons
// ---------------------------------------------------------------------------

export interface StudentDuplicate {
  readonly studentId: Uuid;
  /** Score 0-100 du rapprochement (aucune donnée nominative n'est conservée dans `duplicate_candidates`). */
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface NewStudent {
  /** Idempotence : une même clé ne crée jamais deux élèves (identifiant de l'offre). */
  readonly externalRef: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string;
  readonly birthPlace: string | null;
  readonly gender: "FEMALE" | "MALE";
  readonly nationality: string | null;
}

export interface NewGuardian {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly profession: string | null;
}

export interface StudentRegistry {
  findDuplicateStudents(ctx: RequestContext, draft: { lastName: string; firstName: string; birthDate: string }): Promise<readonly StudentDuplicate[]>;
  studentExists(ctx: RequestContext, studentId: Uuid): Promise<boolean>;
  /** Crée l'élève avec son matricule ; le port le laisse `INACTIVE` (jusqu'à la confirmation de l'inscription). */
  createStudent(ctx: RequestContext, student: NewStudent): Promise<{ studentId: Uuid; studentNumber: string | null; status: string }>;
  createGuardian(ctx: RequestContext, guardian: NewGuardian): Promise<{ guardianId: Uuid }>;
  linkGuardian(
    ctx: RequestContext,
    link: { studentId: Uuid; guardianId: Uuid; relationshipCode: string; isPrimaryContact: boolean; isFinancialResponsible: boolean; hasLegalCustody: boolean },
  ): Promise<void>;
  changeStudentStatus(ctx: RequestContext, studentId: Uuid, status: "ACTIVE" | "INACTIVE", reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// academic : inscription (PENDING), annulation
// ---------------------------------------------------------------------------

export interface NewEnrollment {
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly fundingType: string;
  readonly assignmentReference: string | null;
  readonly isRepeating: boolean;
  readonly originSchool: string | null;
  /** Traçabilité : identifiant de la candidature (`source_kind = ADMISSION`). */
  readonly applicationId: Uuid;
}

export interface EnrollmentService {
  /** Inscription `PENDING` (ou confirmée d'emblée si aucun frais d'inscription n'est dû : `academic` décide). */
  enrollStudent(ctx: RequestContext, input: NewEnrollment): Promise<{ enrollmentId: Uuid; registrationNumber: string | null; status: string }>;
  /** Annule une inscription en attente (délai de paiement dépassé, retrait avant paiement). */
  cancelEnrollment(ctx: RequestContext, enrollmentId: Uuid, reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// finance : facture des frais d'inscription
// ---------------------------------------------------------------------------

export interface RegistrationFeeService {
  /**
   * Émet la facture des frais d'inscription de l'inscription (ligne de catégorie `REGISTRATION`). `invoiceId = null` : aucun frais
   * d'inscription n'est dû (barème absent) — `academic` confirme alors l'inscription immédiatement. IDEMPOTENT par `idempotencyKey`.
   */
  issueRegistrationInvoice(ctx: RequestContext, input: { studentId: Uuid; enrollmentId: Uuid; idempotencyKey: string }): Promise<{ invoiceId: Uuid | null }>;
  cancelInvoice(ctx: RequestContext, invoiceId: Uuid, reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// tenancy / academic / people : catalogue (établissements, niveaux, classes, liens de parenté)
// ---------------------------------------------------------------------------

export interface InstitutionInfo {
  readonly id: Uuid;
  readonly name: string;
}

export interface ClassroomInfo {
  readonly id: Uuid;
  readonly label: string;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly gradeLevelCode: string;
  readonly open: boolean;
}

export interface InstitutionCatalog {
  listInstitutions(ctx: RequestContext): Promise<readonly InstitutionInfo[]>;
  getInstitution(ctx: RequestContext, institutionId: Uuid): Promise<InstitutionInfo | null>;
  gradeLevels(ctx: RequestContext, institutionId: Uuid): Promise<ReadonlyArray<{ code: string; label: string }>>;
  classroom(ctx: RequestContext, classroomId: Uuid): Promise<ClassroomInfo | null>;
  classroomsOf(ctx: RequestContext, query: { institutionId: Uuid; academicYearId: Uuid; gradeLevelCode: string }): Promise<readonly ClassroomInfo[]>;
  relationshipTypes(ctx: RequestContext): Promise<ReadonlyArray<{ code: string; label: string }>>;
}

// ---------------------------------------------------------------------------
// documents / stockage : pièces justificatives
// ---------------------------------------------------------------------------

export interface StoredPiece {
  readonly storageKey: string;
  /** Identifiant du document dans `documents` (null tant que le stockage est le repli `StoragePort`). */
  readonly documentRef: Uuid | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Sous-ensemble des droits de la GED utile au dépôt (niveau de la catégorie + droit de dépôt). */
export interface DocumentCaps {
  readonly upload?: boolean;
  readonly manage?: boolean;
  readonly read?: boolean;
  readonly readRestricted?: boolean;
  readonly readConfidential?: boolean;
}

export interface DocumentStore {
  /**
   * Contrôle le TYPE RÉEL (octets magiques, jamais le type déclaré), la taille, l'antivirus ; écrit l'objet ; renvoie l'empreinte
   * SHA-256. Lève une `ValidationError` `admissions.file_rejected` (ou le code de `documents`) si le fichier est refusé.
   */
  store(ctx: RequestContext, input: { applicationId: Uuid; requirementId: Uuid; fileName: string; bytes: Uint8Array; acceptsMime: readonly string[]; maxSizeBytes: number }): Promise<StoredPiece>;
  remove(ctx: RequestContext, piece: { storageKey: string | null; documentRef: Uuid | null }): Promise<void>;
  /** Rattache les pièces au dossier permanent de l'élève (`documents`) ; `linked: false` si le port ne sait que le stockage. */
  link(ctx: RequestContext, piece: { storageKey: string | null; documentRef: Uuid | null }, owner: { type: "STUDENT"; id: Uuid }): Promise<{ linked: boolean }>;
  signedUrl(ctx: RequestContext, piece: { storageKey: string | null; documentRef: Uuid | null }, options: { ttlSeconds: number; fileName: string; contentType: string }): Promise<{ url: string; expiresAt: Date }>;
  /**
   * Rattachement DIFFÉRÉ au dossier permanent de l'élève (GED), sous l'identité de l'humain qui l'a demandé (`ctx.userId` est le
   * déposant). Absent ou non branché : échec fermé (`admissions.port_unavailable`). Renvoie la référence du document de la GED ;
   * `alreadyPresent` si la GED connaissait déjà ce fichier pour cet élève et cette catégorie (idempotence).
   */
  attachToStudentFile?(
    ctx: RequestContext,
    piece: { storageKey: string; contentType: string | null; fileName: string; title: string },
    target: { type: "STUDENT"; id: Uuid; categoryId: Uuid },
    /** Droits RÉELS de la personne dans la GED, relus par la route (jamais élargis par admissions). */
    caps: DocumentCaps,
  ): Promise<{ documentRef: Uuid; alreadyPresent: boolean }>;
}

// ---------------------------------------------------------------------------
// Notifications aux familles (canaux externes) — jamais de simulation
// ---------------------------------------------------------------------------

export type NotificationChannel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

export interface ApplicantMessage {
  readonly applicationId: Uuid;
  readonly guardianId: Uuid;
  readonly templateCode: string;
  /** Résolu à l'envoi depuis le tuteur ; JAMAIS conservé par le module. */
  readonly recipient: { readonly firstName: string; readonly email: string | null; readonly phone: string | null };
  /** Variables du gabarit (libellés de pièces manquantes, lien de réponse à une offre…). Aucune donnée n'est stockée. */
  readonly data: Readonly<Record<string, string | readonly string[]>>;
  readonly dedupeKey: string;
}

export interface DeliveryReceipt {
  readonly channel: NotificationChannel;
  readonly status: "SENT" | "QUEUED";
  readonly providerRef?: string | null;
}

export interface ApplicantNotifier {
  /** Envoie par le premier canal disponible ; lève si AUCUN canal ne convient (le module consigne `SKIPPED` / `CHANNEL_UNAVAILABLE`). */
  send(ctx: RequestContext, message: ApplicantMessage): Promise<DeliveryReceipt>;
}

// ---------------------------------------------------------------------------
// Captcha, comptes
// ---------------------------------------------------------------------------

export interface Captcha {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export interface ActorDirectory {
  /** Nom d'affichage d'un compte (figé dans la décision). `null` : inconnu. */
  displayName(ctx: RequestContext, userId: Uuid): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `admissions.<entité>.<action>`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  /** Identifiants, codes et compteurs UNIQUEMENT (aucun nom, aucune naissance, aucun contact). */
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

/** Ports que la plateforme branche. Un port absent échoue fermé (sauf `notifier`, `captcha`, `actors` : valeurs sûres par défaut). */
export interface AdmissionsPorts {
  readonly students: StudentRegistry;
  readonly enrollments: EnrollmentService;
  readonly fees: RegistrationFeeService;
  readonly catalog: InstitutionCatalog;
  readonly documents: DocumentStore;
  readonly notifier: ApplicantNotifier;
  readonly captcha: Captcha | null;
  readonly actors: ActorDirectory;
}
