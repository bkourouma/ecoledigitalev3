/**
 * Ports en mémoire (tests et modules consommateurs) et ports « indisponibles » (échec FERMÉ).
 *
 * `inMemoryPorts()` fournit un monde simulé complet (inscriptions, périodes, tuteurs, affectations d'enseignants, vue
 * d'absences, notifications, statut d'élève) ; `unavailablePorts()` lève `schoollife.port_unavailable` à chaque appel : c'est
 * le comportement par défaut tant que la plateforme n'a pas branché de port.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type {
  AbsenceView,
  AttendanceViewPort,
  EnrollmentInfo,
  EnrollmentPort,
  GuardianInfo,
  GuardianNotification,
  NotificationPort,
  PeoplePort,
  PeriodInfo,
  PeriodPort,
  RosterEntry,
  SchoolLifePorts,
  StudentStatusPort,
  StudentStatusTarget,
} from "../application/ports";

const unavailable = (name: string) => (): never => {
  throw portUnavailable(name);
};

/** Tous les ports lèvent `schoollife.port_unavailable`. */
export function unavailablePorts(): SchoolLifePorts {
  return {
    enrollments: { getEnrollment: unavailable("academic"), listEnrollmentsOfStudent: unavailable("academic"), getRoster: unavailable("academic") },
    periods: { listPeriodsCovering: unavailable("academic") },
    people: {
      isGuardianOfStudent: unavailable("people"),
      getStudentIdForUser: unavailable("people"),
      listChildrenOfGuardian: unavailable("people"),
      staffCanReadStudent: unavailable("people"),
      isStaffAssignedToClassroom: unavailable("people"),
      listGuardiansOfStudent: unavailable("people"),
      getStudentNames: unavailable("people"),
      displayNameOfUser: unavailable("people"),
    },
    attendance: { listAbsences: unavailable("attendance") },
    notifications: { notifyGuardians: unavailable("notifications") },
    studentStatus: { changeStudentStatus: unavailable("people") },
  };
}

export class InMemoryEnrollments implements EnrollmentPort {
  private readonly byId = new Map<string, EnrollmentInfo>();
  add(e: EnrollmentInfo): void {
    this.byId.set(e.enrollmentId, e);
  }
  async getEnrollment(_ctx: RequestContext, enrollmentId: string): Promise<EnrollmentInfo | null> {
    return this.byId.get(enrollmentId) ?? null;
  }
  async listEnrollmentsOfStudent(_ctx: RequestContext, studentId: string): Promise<readonly EnrollmentInfo[]> {
    return [...this.byId.values()].filter((e) => e.studentId === studentId && e.active);
  }
  async getRoster(_ctx: RequestContext, classroomId: string): Promise<readonly RosterEntry[]> {
    return [...this.byId.values()].filter((e) => e.classroomId === classroomId && e.active).map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId }));
  }
}

export class InMemoryPeriods implements PeriodPort {
  private readonly periods: PeriodInfo[] = [];
  add(p: PeriodInfo): void {
    this.periods.push(p);
  }
  async listPeriodsCovering(_ctx: RequestContext, q: { academicYearId: string; date: string }): Promise<readonly PeriodInfo[]> {
    return this.periods.filter((p) => p.academicYearId === q.academicYearId && p.startsOn <= q.date && q.date <= p.endsOn);
  }
}

export class InMemoryPeople implements PeoplePort {
  private readonly guardianUsers = new Map<string, Set<string>>(); // userId -> studentIds
  private readonly studentUsers = new Map<string, string>(); // userId -> studentId
  private readonly teachers = new Map<string, Set<string>>(); // userId -> studentIds de ses classes
  private readonly classroomsOfTeacher = new Map<string, Set<string>>();
  private readonly guardiansOf = new Map<string, GuardianInfo[]>();
  private readonly names = new Map<string, string>();
  private readonly userNames = new Map<string, string>();

  addStudent(studentId: string, name: string, userId?: string): void {
    this.names.set(studentId, name);
    if (userId) this.studentUsers.set(userId, studentId);
  }
  addGuardian(studentId: string, guardian: GuardianInfo): void {
    this.guardiansOf.set(studentId, [...(this.guardiansOf.get(studentId) ?? []), guardian]);
    if (guardian.userId) this.guardianUsers.set(guardian.userId, new Set([...(this.guardianUsers.get(guardian.userId) ?? []), studentId]));
  }
  /** Lie un enseignant à une classe et à ses élèves. */
  assignTeacher(userId: string, classroomId: string, studentIds: readonly string[]): void {
    this.teachers.set(userId, new Set([...(this.teachers.get(userId) ?? []), ...studentIds]));
    this.classroomsOfTeacher.set(userId, new Set([...(this.classroomsOfTeacher.get(userId) ?? []), classroomId]));
  }
  nameUser(userId: string, name: string): void {
    this.userNames.set(userId, name);
  }
  async isGuardianOfStudent(_ctx: RequestContext, userId: string, studentId: string): Promise<boolean> {
    return this.guardianUsers.get(userId)?.has(studentId) ?? false;
  }
  async getStudentIdForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.studentUsers.get(userId) ?? null;
  }
  async listChildrenOfGuardian(_ctx: RequestContext, userId: string): Promise<readonly string[]> {
    return [...(this.guardianUsers.get(userId) ?? [])];
  }
  async staffCanReadStudent(ctx: RequestContext, studentId: string): Promise<boolean> {
    return ctx.userId !== null && (this.teachers.get(ctx.userId)?.has(studentId) ?? false);
  }
  async isStaffAssignedToClassroom(_ctx: RequestContext, userId: string, classroomId: string): Promise<boolean> {
    return this.classroomsOfTeacher.get(userId)?.has(classroomId) ?? false;
  }
  async listGuardiansOfStudent(_ctx: RequestContext, studentId: string): Promise<readonly GuardianInfo[]> {
    return this.guardiansOf.get(studentId) ?? [];
  }
  async getStudentNames(_ctx: RequestContext, studentIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return new Map(studentIds.filter((id) => this.names.has(id)).map((id) => [id, this.names.get(id) as string]));
  }
  async displayNameOfUser(_ctx: RequestContext, userId: string): Promise<string> {
    return this.userNames.get(userId) ?? "Utilisateur";
  }
}

export class InMemoryAttendance implements AttendanceViewPort {
  private readonly rows = new Map<string, AbsenceView[]>();
  add(studentId: string, row: AbsenceView): void {
    this.rows.set(studentId, [...(this.rows.get(studentId) ?? []), row]);
  }
  async listAbsences(_ctx: RequestContext, q: { studentId: string; from?: string; to?: string; limit: number }): Promise<readonly AbsenceView[]> {
    return (this.rows.get(q.studentId) ?? [])
      .filter((r) => (!q.from || r.sessionDate >= q.from) && (!q.to || r.sessionDate <= q.to))
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
      .slice(0, q.limit);
  }
}

export class InMemoryNotifications implements NotificationPort {
  readonly sent: Array<{ ctx: RequestContext; input: GuardianNotification }> = [];
  /** Aucun tuteur joignable : l'adaptateur réel lève, le statut de la convocation ne change pas. */
  unreachable = false;
  async notifyGuardians(ctx: RequestContext, input: GuardianNotification): Promise<{ recipients: number; queued: number }> {
    if (this.unreachable) throw new Error("Aucun destinataire joignable pour cette audience.");
    this.sent.push({ ctx, input });
    return { recipients: input.guardianIds.length, queued: input.guardianIds.length * input.channels.length };
  }
}

export class InMemoryStudentStatus implements StudentStatusPort {
  readonly calls: Array<{ ctx: RequestContext; studentId: string; status: StudentStatusTarget; reasonText: string }> = [];
  failWith: Error | null = null;
  async changeStudentStatus(ctx: RequestContext, input: { studentId: string; status: StudentStatusTarget; reasonText: string }): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.calls.push({ ctx, ...input });
  }
}

export interface InMemoryWorld extends SchoolLifePorts {
  readonly enrollments: InMemoryEnrollments;
  readonly periods: InMemoryPeriods;
  readonly people: InMemoryPeople;
  readonly attendance: InMemoryAttendance;
  readonly notifications: InMemoryNotifications;
  readonly studentStatus: InMemoryStudentStatus;
}

export function inMemoryPorts(): InMemoryWorld {
  return {
    enrollments: new InMemoryEnrollments(),
    periods: new InMemoryPeriods(),
    people: new InMemoryPeople(),
    attendance: new InMemoryAttendance(),
    notifications: new InMemoryNotifications(),
    studentStatus: new InMemoryStudentStatus(),
  };
}
