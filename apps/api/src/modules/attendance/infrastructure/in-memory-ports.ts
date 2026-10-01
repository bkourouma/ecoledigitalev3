/**
 * Implémentations des ports :
 *  - EN MÉMOIRE : pour les tests du module et ceux des modules consommateurs (013, 016, 017…) ; elles se remplissent
 *    à la main (`addClassroom`, `addEnrollment`, `addOccurrence`…) ;
 *  - `UnavailablePorts` : ports par défaut du plugin tant que `academic`, `people` et `scheduling` ne sont pas
 *    branchés — le module échoue FERMÉ (`attendance.port_unavailable`), jamais en silence.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { portUnavailable } from "../domain/errors";
import type { IsoDate, Uuid } from "../domain/types";
import { getSettings } from "./reference-repository";
import type {
  AlertPolicyPort,
  AttendancePorts,
  ClassroomInfo,
  EnrollmentInfo,
  EnrollmentRosterPort,
  OccurrenceInfo,
  OccurrencePort,
  PeoplePort,
  PeriodInfo,
  PeriodPort,
  RosterEntry,
  RosterQuery,
  StoragePort,
} from "../application/ports";

// ---------------------------------------------------------------------------
// Ports indisponibles (échec fermé)
// ---------------------------------------------------------------------------

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined; // ne pas se faire passer pour une promesse
      return () => Promise.reject(portUnavailable(`${name}.${String(prop)}`));
    },
  });
}

/** Politique d'alerte par défaut : les règles de l'ÉTABLISSEMENT (`settings.alert_rules`), vides tant qu'il n'en déclare pas. */
export const settingsAlertPolicy: AlertPolicyPort = Object.freeze({
  async getRules(tx: Tx) {
    return (await getSettings(tx)).alertRules;
  },
});

export function unavailablePorts(overrides: Partial<AttendancePorts> = {}): AttendancePorts {
  return {
    roster: unavailable<EnrollmentRosterPort>("EnrollmentRosterPort"),
    periods: unavailable<PeriodPort>("PeriodPort"),
    occurrences: unavailable<OccurrencePort>("OccurrencePort"),
    people: unavailable<PeoplePort>("PeoplePort"),
    storage: unavailable<StoragePort>("StoragePort"),
    alertPolicy: settingsAlertPolicy,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// En mémoire
// ---------------------------------------------------------------------------

export class InMemoryRoster implements EnrollmentRosterPort {
  readonly classrooms = new Map<Uuid, ClassroomInfo>();
  readonly enrollments = new Map<Uuid, EnrollmentInfo & { fromDate?: IsoDate; toDate?: IsoDate; names?: string; offeringIds?: Uuid[] }>();
  readonly calls: RosterQuery[] = [];

  addClassroom(c: ClassroomInfo): this {
    this.classrooms.set(c.classroomId, c);
    return this;
  }

  /** `fromDate` / `toDate` : période pendant laquelle l'inscription est ACTIVE (défaut : toujours). */
  addEnrollment(e: EnrollmentInfo & { fromDate?: IsoDate; toDate?: IsoDate; names?: string; offeringIds?: Uuid[] }): this {
    this.enrollments.set(e.enrollmentId, e);
    return this;
  }

  removeEnrollment(enrollmentId: Uuid): this {
    this.enrollments.delete(enrollmentId);
    return this;
  }

  async getClassroom(_ctx: RequestContext, classroomId: Uuid): Promise<ClassroomInfo | null> {
    return this.classrooms.get(classroomId) ?? null;
  }

  async getRoster(_ctx: RequestContext, q: RosterQuery): Promise<readonly RosterEntry[]> {
    this.calls.push(q);
    return [...this.enrollments.values()]
      .filter((e) => e.classroomId === q.classroomId && e.active && (!e.fromDate || e.fromDate <= q.onDate) && (!e.toDate || e.toDate >= q.onDate))
      .filter((e) => !q.offeringId || !e.offeringIds || e.offeringIds.includes(q.offeringId))
      .map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, displayName: e.names ?? null }));
  }

  async getEnrollment(_ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null> {
    return this.enrollments.get(enrollmentId) ?? null;
  }

  async findEnrollmentsOfStudent(_ctx: RequestContext, studentId: Uuid, w: { from: IsoDate; to: IsoDate }): Promise<readonly EnrollmentInfo[]> {
    return [...this.enrollments.values()].filter(
      (e) => e.studentId === studentId && (!e.fromDate || e.fromDate <= w.to) && (!e.toDate || e.toDate >= w.from),
    );
  }
}

export class InMemoryPeriods implements PeriodPort {
  readonly periods = new Map<Uuid, PeriodInfo>();
  add(p: PeriodInfo): this {
    this.periods.set(p.periodId, p);
    return this;
  }
  async getPeriod(_ctx: RequestContext, periodId: Uuid): Promise<PeriodInfo | null> {
    return this.periods.get(periodId) ?? null;
  }
  async listPeriodsCovering(_ctx: RequestContext, q: { academicYearId: Uuid; date: IsoDate }): Promise<readonly PeriodInfo[]> {
    return [...this.periods.values()].filter((p) => p.academicYearId === q.academicYearId && p.startsOn <= q.date && p.endsOn >= q.date);
  }
}

export class InMemoryOccurrences implements OccurrencePort {
  readonly occurrences = new Map<Uuid, OccurrenceInfo>();
  add(o: OccurrenceInfo): this {
    this.occurrences.set(o.occurrenceId, o);
    return this;
  }
  setStatus(occurrenceId: Uuid, status: OccurrenceInfo["status"]): void {
    const o = this.occurrences.get(occurrenceId);
    if (o) this.occurrences.set(occurrenceId, { ...o, status });
  }
  async getOccurrence(_ctx: RequestContext, occurrenceId: Uuid): Promise<OccurrenceInfo | null> {
    return this.occurrences.get(occurrenceId) ?? null;
  }
  async listExpectedOccurrences(_ctx: RequestContext, q: { from: IsoDate; to: IsoDate; institutionId?: Uuid; staffId?: Uuid }): Promise<readonly OccurrenceInfo[]> {
    return [...this.occurrences.values()].filter(
      (o) =>
        o.status !== "CANCELLED" &&
        o.date >= q.from &&
        o.date <= q.to &&
        (!q.institutionId || o.institutionId === q.institutionId) &&
        (!q.staffId || o.staff.some((s) => s.staffId === q.staffId)),
    );
  }
}

export class InMemoryPeople implements PeoplePort {
  readonly guardians = new Map<Uuid, Set<Uuid>>(); // userId -> studentIds
  readonly studentUsers = new Map<Uuid, Uuid>(); // userId -> studentId
  readonly staffUsers = new Map<Uuid, Uuid>(); // userId -> staffId
  readonly assignments = new Map<Uuid, Set<Uuid>>(); // staffId -> classroomIds
  readonly staff = new Map<Uuid, { displayName: string; active: boolean }>();
  readonly students = new Map<Uuid, string>();

  addGuardian(userId: Uuid, studentId: Uuid): this {
    const set = this.guardians.get(userId) ?? new Set<Uuid>();
    set.add(studentId);
    this.guardians.set(userId, set);
    return this;
  }
  addStudentUser(userId: Uuid, studentId: Uuid): this {
    this.studentUsers.set(userId, studentId);
    return this;
  }
  addStaff(staffId: Uuid, userId: Uuid | null, displayName = "Enseignant", active = true): this {
    if (userId) this.staffUsers.set(userId, staffId);
    this.staff.set(staffId, { displayName, active });
    return this;
  }
  assign(staffId: Uuid, classroomId: Uuid): this {
    const set = this.assignments.get(staffId) ?? new Set<Uuid>();
    set.add(classroomId);
    this.assignments.set(staffId, set);
    return this;
  }
  addStudent(studentId: Uuid, displayName: string): this {
    this.students.set(studentId, displayName);
    return this;
  }

  async isGuardianOfStudent(_ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean> {
    return this.guardians.get(userId)?.has(studentId) ?? false;
  }
  async getStudentIdForUser(_ctx: RequestContext, userId: Uuid): Promise<Uuid | null> {
    return this.studentUsers.get(userId) ?? null;
  }
  async listChildrenOfGuardian(_ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]> {
    return [...(this.guardians.get(userId) ?? [])];
  }
  async getStaffIdForUser(_ctx: RequestContext, userId: Uuid): Promise<Uuid | null> {
    return this.staffUsers.get(userId) ?? null;
  }
  async isStaffAssignedToClassroom(_ctx: RequestContext, staffId: Uuid, classroomId: Uuid): Promise<boolean> {
    return this.assignments.get(staffId)?.has(classroomId) ?? false;
  }
  async getStaffById(_ctx: RequestContext, staffId: Uuid): Promise<{ staffId: Uuid; displayName: string; active: boolean } | null> {
    const s = this.staff.get(staffId);
    return s ? { staffId, ...s } : null;
  }
  async getStudentsByIds(_ctx: RequestContext, ids: readonly Uuid[]): Promise<ReadonlyArray<{ studentId: Uuid; displayName: string }>> {
    return ids.filter((id) => this.students.has(id)).map((id) => ({ studentId: id, displayName: this.students.get(id) as string }));
  }
}

export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();
  readonly signed: Array<{ key: string; ttlSeconds: number }> = [];
  async put(key: string, data: Uint8Array, options: { contentType: string }): Promise<void> {
    this.objects.set(key, { data, contentType: options.contentType });
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async signedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }> {
    this.signed.push({ key, ttlSeconds });
    return { url: `memory://${key}?ttl=${ttlSeconds}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }
}

/** Jeu complet de ports en mémoire. */
export interface InMemoryWorld extends AttendancePorts {
  readonly roster: InMemoryRoster;
  readonly periods: InMemoryPeriods;
  readonly occurrences: InMemoryOccurrences;
  readonly people: InMemoryPeople;
  readonly storage: InMemoryStorage;
}

export function inMemoryPorts(overrides: Partial<AttendancePorts> = {}): InMemoryWorld {
  return {
    roster: new InMemoryRoster(),
    periods: new InMemoryPeriods(),
    occurrences: new InMemoryOccurrences(),
    people: new InMemoryPeople(),
    storage: new InMemoryStorage(),
    alertPolicy: settingsAlertPolicy,
    ...overrides,
  } as InMemoryWorld;
}
