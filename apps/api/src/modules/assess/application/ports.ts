/**
 * Ports du module `assess` : tout ce qui vient d'ailleurs (audit, classes, inscriptions, périodes, curriculum,
 * affectations, tutelle) est décrit STRUCTURELLEMENT ici, sans importer un autre module (ADR-001). Les modules
 * `academic`, `people` et `scheduling` fournissent leurs implémentations et les enregistrent par
 * `registerAssessPorts(app, ports)` (`http/plugin.ts`) ; tant qu'un port n'est pas branché, il est INDISPONIBLE
 * (échec fermé, `assess.port_unavailable`), jamais « tout autorisé ».
 *
 * Les références sont des UUID sans clé étrangère : `academic.classrooms.id`, `academic.enrollments.id`,
 * `academic.curriculum_nodes.id`, `academic.academic_periods.id`, `people.students.id`, `people.staff.id`.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

/** Entrée d'audit telle que l'attend `audit.record` (identique à `RuntimeAuditEntry` de la plateforme). */
export interface AuditEntry {
  /** `assess.<entité>.<verbe>`, ex. `assess.assessment.published`. */
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

/** `runtime.auditPort` (seul `record` est utilisé). */
export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit n'est pas branché */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
  clear(): void {
    this.entries.length = 0;
  }
}

export interface ClassroomInfo {
  readonly id: string;
  readonly academicYearId: string;
  readonly institutionId?: string | null;
}

export interface RosterEntry {
  readonly enrollmentId: string;
  readonly studentId: string;
  readonly classroomId: string;
  /** Inscription active (confirmée, non retirée) : seule une inscription active reçoit une ligne `NOT_GRADED`. */
  readonly active: boolean;
}

/** Classes et inscriptions (academic / people). */
export interface RosterPort {
  getClassroom(ctx: RequestContext, classroomId: string): Promise<ClassroomInfo | null>;
  /** Inscriptions de la classe (actives ou non) : une note reste attachée à son inscription d'origine. */
  listEnrollments(ctx: RequestContext, classroomId: string): Promise<readonly RosterEntry[]>;
}

export interface PeriodInfo {
  readonly id: string;
  readonly academicYearId: string;
}

export interface PeriodPort {
  getPeriod(ctx: RequestContext, periodId: string): Promise<PeriodInfo | null>;
}

export interface NodeInfo {
  readonly id: string;
  /** Le nœud accepte-t-il une session 2 (rattrapage) ? `resit_allowed` du curriculum (R-ASS-07). */
  readonly resitAllowed: boolean;
}

export interface CurriculumPort {
  getNode(ctx: RequestContext, nodeId: string): Promise<NodeInfo | null>;
  /** Le nœud fait-il partie du programme suivi par la classe (P-ASS-52) ? */
  nodeInClassroom(ctx: RequestContext, nodeId: string, classroomId: string): Promise<boolean>;
}

/** Affectations d'enseignement (009 / 004) : qui enseigne quoi dans quelle classe. */
export interface TeachingAssignmentPort {
  /** Personnel (`people.staff.id`) lié au compte, ou `null`. */
  staffIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  teaches(ctx: RequestContext, staffId: string, nodeId: string, classroomId: string): Promise<boolean>;
}

/** Lien élève ↔ compte et tutelle (008). */
export interface GuardianshipPort {
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
}

/** Identité figée (nom affiché) d'un acteur, pour les révisions et l'historique. */
export interface ActorNamePort {
  nameOf(ctx: RequestContext, userId: string): Promise<string>;
}

export interface AssessPorts {
  readonly roster: RosterPort;
  readonly periods: PeriodPort;
  readonly curriculum: CurriculumPort;
  readonly teaching: TeachingAssignmentPort;
  readonly guardianship: GuardianshipPort;
  readonly names: ActorNamePort;
}
