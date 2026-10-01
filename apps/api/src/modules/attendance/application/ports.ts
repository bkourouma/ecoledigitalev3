/**
 * Ports du module attendance. Les références vers élèves, classes, inscriptions, séances (occurrences), périodes et
 * personnel sont des UUID SANS clé étrangère : leur existence et leur appartenance sont vérifiées à l'écriture par
 * ces ports, fournis à l'assemblage par les modules `academic`, `people` et `scheduling` (specs 004, 008/009, 017).
 *
 * Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ : `attendance.port_unavailable` (aucune écriture sans la
 * source de vérité du roster). Les implémentations en mémoire de `infrastructure/in-memory-ports.ts` servent aux tests
 * et aux modules consommateurs.
 *
 * Aucune fonction de port ne prend de `Tx` (hors `AlertPolicyPort`) : un port appartient à un AUTRE module, qui ouvre
 * sa propre lecture ; seule la décision métier traverse la frontière.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AlertRule } from "../domain/alerts";
import type { IsoDate, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// academic : classes, inscriptions, périodes
// ---------------------------------------------------------------------------

export interface ClassroomInfo {
  readonly classroomId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  /** Niveau d'enseignement (clé de la politique d'appel) ; `null` si inconnu. */
  readonly educationLevelCode: string | null;
  readonly active: boolean;
}

export interface RosterEntry {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly displayName?: string | null;
}

export interface RosterQuery {
  readonly classroomId: Uuid;
  /** Date de la séance : inscriptions ACTIVES (et sélections confirmées pour une offre à la carte) à cette date. */
  readonly onDate: IsoDate;
  readonly curriculumNodeId?: Uuid | null;
  readonly offeringId?: Uuid | null;
}

export interface EnrollmentInfo {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly classroomId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly active: boolean;
  /** Bornes de l'année scolaire de l'inscription (bornent la fenêtre d'un justificatif). */
  readonly academicYearStart: IsoDate | null;
  readonly academicYearEnd: IsoDate | null;
}

export interface EnrollmentRosterPort {
  getClassroom(ctx: RequestContext, classroomId: Uuid): Promise<ClassroomInfo | null>;
  getRoster(ctx: RequestContext, query: RosterQuery): Promise<readonly RosterEntry[]>;
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null>;
  /** Inscriptions d'un élève qui recoupent la fenêtre (une seule le plus souvent ; plusieurs en cas de changement de classe). */
  findEnrollmentsOfStudent(ctx: RequestContext, studentId: Uuid, window: { from: IsoDate; to: IsoDate }): Promise<readonly EnrollmentInfo[]>;
}

export interface PeriodInfo {
  readonly periodId: Uuid;
  readonly academicYearId: Uuid;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly parentPeriodId: Uuid | null;
}

export interface PeriodPort {
  getPeriod(ctx: RequestContext, periodId: Uuid): Promise<PeriodInfo | null>;
  /** Toutes les périodes (parentes comprises : semestre, session…) dont les dates contiennent `date`. */
  listPeriodsCovering(ctx: RequestContext, query: { academicYearId: Uuid; date: IsoDate }): Promise<readonly PeriodInfo[]>;
}

// ---------------------------------------------------------------------------
// scheduling : occurrences
// ---------------------------------------------------------------------------

export interface OccurrenceStaff {
  readonly staffId: Uuid;
  /** `LEAD`, `CO_TEACHER`, `SUBSTITUTE`, `SUPERVISOR`… (information de scheduling). */
  readonly role: string;
}

export interface OccurrenceInfo {
  readonly occurrenceId: Uuid;
  readonly classroomId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly curriculumNodeId: Uuid | null;
  readonly offeringId: Uuid | null;
  readonly date: IsoDate;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly durationMinutes: number | null;
  readonly status: "PLANNED" | "HELD" | "CANCELLED";
  readonly staff: readonly OccurrenceStaff[];
}

export interface OccurrencePort {
  getOccurrence(ctx: RequestContext, occurrenceId: Uuid): Promise<OccurrenceInfo | null>;
  /** Séances planifiées (non annulées) de `[from, to]`, pour la conformité de l'appel. */
  listExpectedOccurrences(ctx: RequestContext, query: { from: IsoDate; to: IsoDate; institutionId?: Uuid; staffId?: Uuid }): Promise<readonly OccurrenceInfo[]>;
}

// ---------------------------------------------------------------------------
// people : élèves, tuteurs, personnel
// ---------------------------------------------------------------------------

export interface PeoplePort {
  /** Le tuteur LIÉ (non révoqué) d'un élève : jamais déduit d'un en-tête client. */
  isGuardianOfStudent(ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean>;
  /** Identifiant d'élève de l'utilisateur connecté (portail élève), sinon `null`. */
  getStudentIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  listChildrenOfGuardian(ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]>;
  /** Membre du personnel de l'utilisateur connecté, sinon `null` (aucun profil = aucun droit d'enseignant). */
  getStaffIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  isStaffAssignedToClassroom(ctx: RequestContext, staffId: Uuid, classroomId: Uuid): Promise<boolean>;
  getStaffById(ctx: RequestContext, staffId: Uuid): Promise<{ staffId: Uuid; displayName: string; active: boolean } | null>;
  getStudentsByIds(ctx: RequestContext, studentIds: readonly Uuid[]): Promise<ReadonlyArray<{ studentId: Uuid; displayName: string }>>;
}

// ---------------------------------------------------------------------------
// Stockage objet des pièces (jamais le disque local)
// ---------------------------------------------------------------------------

export interface StoragePort {
  put(key: string, data: Uint8Array, options: { contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
}

// ---------------------------------------------------------------------------
// Alertes : règles fournies par le pack / un RuleSet (jamais en constante)
// ---------------------------------------------------------------------------

export interface AlertPolicyPort {
  /** Règles d'alerte applicables au tenant de la transaction. Vide = aucune alerte. */
  getRules(tx: Tx, ctx: RequestContext): Promise<readonly AlertRule[]>;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `attendance.<entité>.<action>` — ex. `attendance.justification.accepted`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (réouverture, surcharge, décision de justificatif, congé, lecture de pièce). */
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

export interface AttendancePorts {
  readonly roster: EnrollmentRosterPort;
  readonly periods: PeriodPort;
  readonly occurrences: OccurrencePort;
  readonly people: PeoplePort;
  readonly storage: StoragePort;
  readonly alertPolicy: AlertPolicyPort;
}
