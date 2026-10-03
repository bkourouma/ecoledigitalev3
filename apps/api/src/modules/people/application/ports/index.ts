/**
 * Ports du module `people` : ce qu'il CONSOMME des modules voisins (injecté au câblage, jamais importé) et ce qu'il
 * PUBLIE pour eux. Un port non câblé a un repli explicite et SÛR (documenté à côté de chaque port).
 */
import type { AppError, RequestContext, Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `entité.verbe`, ex. `people.student.status_changed`. */
  action: string;
  /** Type d'objet (snake_case). */
  entity: string;
  entityId?: string | null;
  /** `notice` pour toute lecture / modification de donnée personnelle sensible. */
  severity?: "info" | "notice" | "warning" | "critical";
  reason?: string | null;
  /** AUCUNE donnée personnelle : identifiants, noms de champs modifiés, statuts. */
  metadata?: Record<string, unknown> | null;
  before?: unknown;
  after?: unknown;
}

/** Écrit dans la MÊME transaction que l'opération : pas de donnée sans trace. Structurellement `RuntimeAuditPort.record`. */
export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = Object.freeze({ async record() {} });

/** Journal en mémoire (tests). */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<AuditEntry & { requestId?: string }> = [];
  async record(_tx: Tx, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  find(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }
}

// ---------------------------------------------------------------------------
// Comptes de portail (module iam)
// ---------------------------------------------------------------------------

export interface InviteInput {
  email: string;
  /** Clés de rôles SYSTÈME RBAC (`parent`, `eleve`, `enseignant`…) : l'adaptateur crée l'accès IAM et attribue le rôle. */
  roles: readonly string[];
}

/**
 * Création d'un accès au tenant et ENVOI d'une invitation à définir son mot de passe (jeton à usage unique) — AUCUN mot
 * de passe en clair n'est généré, stocké ni renvoyé. Repli si non câblé : `501 people.account_provisioning_unavailable`
 * (aucun compte créé).
 */
export interface AccountProvisioner {
  invite(ctx: RequestContext, input: InviteInput): Promise<Result<{ identityId: string; membershipId: string }, AppError>>;
  /** Accorde un rôle système à une identité qui a déjà un accès (personne cumulant parent et enseignant). Idempotent. */
  grantRole(ctx: RequestContext, input: { identityId: string; role: string }): Promise<Result<void, AppError>>;
}

// ---------------------------------------------------------------------------
// Stockage objet (photos, pièces)
// ---------------------------------------------------------------------------

/** Repli si non câblé : refus des téléversements (`people.storage_unavailable`). */
export interface StoragePort {
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL signée à durée courte (jamais un chemin disque). */
  signedUrl(key: string, options: { ttlSec: number }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Cœur académique (module academic) — lecture
// ---------------------------------------------------------------------------

export interface AcademicClassroom {
  id: string;
  academicYearId: string;
  /** Statut de la classe côté academic (`DRAFT`, `ACTIVE`, `CLOSED`…) : `DRAFT` ⇒ pas de nœud stable. */
  status?: string;
  /** Nom et code lisibles (portail « mes classes ») ; facultatifs : un adaptateur ancien ne les fournit pas. */
  name?: string | null;
  code?: string | null;
}
export interface AcademicNode {
  id: string;
  isTransversal: boolean;
  isMandatory: boolean;
  subjectId?: string | null;
  label?: string | null;
}
export interface AcademicPeriod {
  id: string;
  academicYearId: string;
}
export interface AcademicEnrollment {
  enrollmentId: string;
  studentId: string;
  academicYearId: string;
  institutionId: string;
  classroomId: string;
  classroomName?: string | null;
  status: string;
  mode?: string;
  fundingType?: string;
  registrationNumber?: string | null;
  enrolledOn: string;
}

/**
 * Repli si non câblé : toute CRÉATION d'affectation est refusée (`people.academic_unavailable`, échec fermé) ; la garde
 * d'ouverture d'offre et `listUnstaffedNodes` renvoient une erreur ; `rebuildEnrollmentProjection` est indisponible.
 */
export interface AcademicQuery {
  getClassroom(ctx: RequestContext, classroomId: string): Promise<AcademicClassroom | null>;
  getCurriculumNode(ctx: RequestContext, nodeId: string): Promise<AcademicNode | null>;
  getAcademicPeriod(ctx: RequestContext, periodId: string): Promise<AcademicPeriod | null>;
  /** Nœuds du curriculum de la classe (obligatoires ou non, transversaux ou non). */
  listNodesForClassroom(ctx: RequestContext, classroomId: string, options?: { periodId?: string }): Promise<AcademicNode[]>;
  /** Code du niveau d'enseignement de la classe (portail enseignant : politique d'appel du cycle). Facultatif. */
  educationLevelOf?(ctx: RequestContext, classroomId: string): Promise<string | null>;
  /** Classes de l'année (rapport « matières sans enseignant »). Facultatif. */
  listClassrooms?(ctx: RequestContext, filter: { academicYearId: string; programId?: string }): Promise<AcademicClassroom[]>;
  /** Périodes d'une année (portail enseignant : choisir la période d'une évaluation sans `academic.year.read`). Facultatif. */
  listPeriodsOfYear?(ctx: RequestContext, academicYearId: string): Promise<Array<{ id: string; label: string; startsOn: string; endsOn: string }>>;
  /** Offre = classe × nœuds (garde d'ouverture). Facultatif. */
  getOffering?(ctx: RequestContext, offeringId: string): Promise<{ id: string; classroomId: string; periodId?: string | null; nodeIds: string[] } | null>;
  /** Inscriptions d'un élève (reconstruction de la projection). Facultatif. */
  listEnrollmentsByStudent?(ctx: RequestContext, studentId: string): Promise<AcademicEnrollment[]>;
}

// ---------------------------------------------------------------------------
// Annuaire d'inscriptions (accès « classe » d'un enseignant)
// ---------------------------------------------------------------------------

/**
 * Qui est inscrit dans quelle classe. Sert à limiter un enseignant aux élèves de SES classes. Implémentation par défaut :
 * la projection `student_enrollment_summaries` (alimentée par les événements d'academic), sans dépendre d'academic ;
 * un adaptateur `academic.getRoster` peut la remplacer. Repli : aucun élève (échec fermé).
 */
export interface EnrollmentDirectory {
  listClassroomIdsOfStudent(ctx: RequestContext, studentId: string, options: { onDate: string }): Promise<string[]>;
  listStudentIdsOfClassrooms(ctx: RequestContext, classroomIds: readonly string[], options: { onDate: string }): Promise<string[]>;
}

export const noEnrollmentDirectory: EnrollmentDirectory = Object.freeze({
  async listClassroomIdsOfStudent() {
    return [];
  },
  async listStudentIdsOfClassrooms() {
    return [];
  },
});

// ---------------------------------------------------------------------------
// Profil pays (tenancy)
// ---------------------------------------------------------------------------

/** Pays par défaut du tenant (nationalité par défaut, indicatif des téléphones). Repli : aucun. */
export interface CountryProfileProvider {
  defaultCountry(ctx: RequestContext): Promise<string | null>;
}
