/**
 * Ports du module `schoollife`. Les références vers inscriptions, élèves, classes, périodes, tuteurs sont des UUID SANS clé
 * étrangère : leur existence et leur appartenance sont vérifiées à l'écriture par ces ports, branchés par la plateforme
 * (`apps/api/src/platform/adapters/*-schoollife.ts`) à partir des API publiques d'`academic`, `people`, `attendance`,
 * `notifications`.
 *
 * Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ (`schoollife.port_unavailable`) : aucune écriture sans la source de
 * vérité de l'inscription ; aucune convocation « envoyée » sans notification réellement mise en file ; aucun changement de statut
 * d'élève sans le module `people`. Les lectures optionnelles (vue d'`attendance`) se dégradent avec un indicateur
 * `available: false`. Implémentations en mémoire : `infrastructure/in-memory-ports.ts`.
 *
 * Aucune fonction de port ne prend de `Tx` : un port appartient à un AUTRE module, qui ouvre sa propre lecture (dans la
 * transaction du contexte si c'est le même — SAVEPOINT) ; seule la décision métier traverse la frontière.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

export type Uuid = string;
export type IsoDate = string;

// ---------------------------------------------------------------------------
// academic : inscriptions, classes, périodes
// ---------------------------------------------------------------------------

export interface EnrollmentInfo {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  /** Niveau (clé d'un barème par niveau) ; `null` si inconnu. */
  readonly gradeLevelId: Uuid | null;
  readonly active: boolean;
}

export interface RosterEntry {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
}

export interface EnrollmentPort {
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Inscriptions VIVANTES d'un élève (une par année en général), plus récente d'abord. */
  listEnrollmentsOfStudent(ctx: RequestContext, studentId: Uuid): Promise<readonly EnrollmentInfo[]>;
  /** Effectif d'une classe à une date. */
  getRoster(ctx: RequestContext, classroomId: Uuid, onDate: IsoDate): Promise<readonly RosterEntry[]>;
}

export interface PeriodInfo {
  readonly periodId: Uuid;
  readonly academicYearId: Uuid;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
}

export interface PeriodPort {
  /** Toutes les périodes (parentes comprises) de l'année qui contiennent `date`. */
  listPeriodsCovering(ctx: RequestContext, query: { academicYearId: Uuid; date: IsoDate }): Promise<readonly PeriodInfo[]>;
}

// ---------------------------------------------------------------------------
// people : élèves, tuteurs, personnel
// ---------------------------------------------------------------------------

export interface GuardianInfo {
  readonly guardianId: Uuid;
  /** Compte de portail du tuteur (identité IAM), `null` sans compte. */
  readonly userId: Uuid | null;
  readonly displayName: string;
}

export interface PeoplePort {
  /** Le tuteur LIÉ (lien vivant) d'un élève : jamais déduit d'un en-tête client, relu à chaque lecture. */
  isGuardianOfStudent(ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean>;
  /** Dossier élève du compte connecté (portail élève), sinon `null`. */
  getStudentIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  listChildrenOfGuardian(ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]>;
  /** L'enseignant du contexte est-il affecté à (une classe de) cet élève ? (même règle que `student.class.read`) */
  staffCanReadStudent(ctx: RequestContext, studentId: Uuid): Promise<boolean>;
  isStaffAssignedToClassroom(ctx: RequestContext, userId: Uuid, classroomId: Uuid): Promise<boolean>;
  /** Tuteurs vivants d'un élève (identifiant de tuteur, compte éventuel, nom). */
  listGuardiansOfStudent(ctx: RequestContext, studentId: Uuid): Promise<readonly GuardianInfo[]>;
  getStudentNames(ctx: RequestContext, studentIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
  /** Nom figé d'un acteur (jamais vide : repli « Utilisateur »). */
  displayNameOfUser(ctx: RequestContext, userId: Uuid): Promise<string>;
}

// ---------------------------------------------------------------------------
// attendance : VUE (lecture seule, jamais de copie)
// ---------------------------------------------------------------------------

export interface AbsenceView {
  readonly recordId: Uuid;
  readonly sessionDate: IsoDate;
  readonly statusCode: string;
  readonly excused: boolean;
  readonly countedMinutes: number | null;
  readonly minutesLate: number | null;
}

export interface AttendanceViewPort {
  /** Absences et retards d'un élève (les plus récents d'abord). */
  listAbsences(ctx: RequestContext, query: { studentId: Uuid; from?: IsoDate; to?: IsoDate; limit: number }): Promise<readonly AbsenceView[]>;
}

// ---------------------------------------------------------------------------
// notifications : information des tuteurs
// ---------------------------------------------------------------------------

export type NotificationKind = "CONVOCATION" | "MEASURE_NOTICE";
export type NotificationChannelName = "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" | "IN_APP";

export interface GuardianNotification {
  readonly kind: NotificationKind;
  readonly studentId: Uuid;
  /** Tuteurs visés (compte ou non) ; l'adaptateur résout les coordonnées et le consentement. */
  readonly guardianIds: readonly Uuid[];
  readonly channels: readonly NotificationChannelName[];
  /** Variables minimales : jamais de motif disciplinaire ni de déclaration d'élève. */
  readonly variables: Readonly<Record<string, string>>;
  /** Clé d'idempotence (UUID) : un réessai ne double pas l'envoi ; sert de `notification_ref`. */
  readonly clientKey: Uuid;
}

export interface NotificationPort {
  /** Met la notification en file. Lève (échec explicite) si personne n'est joignable : le statut suit la réalité. */
  notifyGuardians(ctx: RequestContext, input: GuardianNotification): Promise<{ recipients: number; queued: number }>;
}

// ---------------------------------------------------------------------------
// people : statut de l'élève (suspension / exclusion) — UNIQUEMENT par un acte d'utilisateur habilité
// ---------------------------------------------------------------------------

export type StudentStatusTarget = "SUSPENDED" | "EXCLUDED" | "ACTIVE";

export interface StudentStatusPort {
  changeStudentStatus(ctx: RequestContext, input: { studentId: Uuid; status: StudentStatusTarget; reasonText: string }): Promise<void>;
}

export interface SchoolLifePorts {
  readonly enrollments: EnrollmentPort;
  readonly periods: PeriodPort;
  readonly people: PeoplePort;
  readonly attendance: AttendanceViewPort;
  readonly notifications: NotificationPort;
  readonly studentStatus: StudentStatusPort;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `schoollife.<entité>.<action>` — ex. `schoollife.measure.validated`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (validation, révocation, exclusion, lecture confidentielle, ajustement de points…). */
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
