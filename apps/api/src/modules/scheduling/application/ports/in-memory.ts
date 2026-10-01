/**
 * Implémentations EN MÉMOIRE des ports (tests, et branchement provisoire tant que les modules
 * `academic`, `people` et `attendance` ne sont pas assemblés).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { AcademicQuery, ClassroomInfo, CurriculumNodeInfo, OfferingInfo, PeriodInfo, StudentPlacements } from "./academic";
import type { AttendanceQuery } from "./attendance";
import type { PeopleQuery, StaffAvailabilityInfo, StaffCompetencyInfo, StaffInfo } from "./people";

export class InMemoryAcademicQuery implements AcademicQuery {
  readonly classrooms = new Map<string, ClassroomInfo>();
  readonly offerings = new Map<string, OfferingInfo>();
  readonly nodes = new Map<string, CurriculumNodeInfo>();
  readonly periods = new Map<string, PeriodInfo>();
  readonly placements = new Map<string, StudentPlacements>();
  /** Résolution par défaut d'une date → année/période (un seul exercice). */
  yearForDates: { academicYearId: string; periodId: string | null; from: string; to: string } | null = null;

  addClassroom(c: ClassroomInfo): this {
    this.classrooms.set(c.id, c);
    return this;
  }
  addOffering(o: OfferingInfo): this {
    this.offerings.set(o.id, o);
    return this;
  }
  addNode(n: CurriculumNodeInfo): this {
    this.nodes.set(n.id, n);
    return this;
  }
  addPeriod(p: PeriodInfo): this {
    this.periods.set(p.id, p);
    return this;
  }
  place(studentId: string, placements: StudentPlacements): this {
    this.placements.set(studentId, placements);
    return this;
  }

  async getClassroom(_ctx: RequestContext, id: string): Promise<ClassroomInfo | null> {
    return this.classrooms.get(id) ?? null;
  }
  async getOffering(_ctx: RequestContext, id: string): Promise<OfferingInfo | null> {
    return this.offerings.get(id) ?? null;
  }
  async getCurriculumNode(_ctx: RequestContext, id: string): Promise<CurriculumNodeInfo | null> {
    return this.nodes.get(id) ?? null;
  }
  async getPeriod(_ctx: RequestContext, id: string): Promise<PeriodInfo | null> {
    return this.periods.get(id) ?? null;
  }
  async resolvePeriodForDate(_ctx: RequestContext, _institutionId: string, date: string): Promise<{ academicYearId: string; periodId: string | null } | null> {
    const y = this.yearForDates;
    if (!y || date < y.from || date > y.to) return null;
    return { academicYearId: y.academicYearId, periodId: y.periodId };
  }
  async listStudentPlacements(_ctx: RequestContext, studentId: string): Promise<StudentPlacements> {
    return this.placements.get(studentId) ?? { classroomIds: [], offeringIds: [] };
  }
}

export class InMemoryPeopleQuery implements PeopleQuery {
  readonly staff = new Map<string, StaffInfo>();
  readonly availabilities: StaffAvailabilityInfo[] = [];
  readonly competencies: StaffCompetencyInfo[] = [];
  /** `staffId|classroomId` */
  readonly assignments = new Set<string>();
  /** `userId|studentId` */
  readonly guardianships = new Set<string>();
  readonly studentByUser = new Map<string, string>();

  addStaff(s: StaffInfo): this {
    this.staff.set(s.id, s);
    return this;
  }
  assign(staffId: string, classroomId: string): this {
    this.assignments.add(`${staffId}|${classroomId}`);
    return this;
  }
  addGuardian(userId: string, studentId: string): this {
    this.guardianships.add(`${userId}|${studentId}`);
    return this;
  }
  linkStudent(userId: string, studentId: string): this {
    this.studentByUser.set(userId, studentId);
    return this;
  }

  async getStaffByIds(_ctx: RequestContext, ids: readonly string[]): Promise<StaffInfo[]> {
    return ids.flatMap((id) => {
      const s = this.staff.get(id);
      return s ? [s] : [];
    });
  }
  async listTeachingStaff(): Promise<StaffInfo[]> {
    return [...this.staff.values()];
  }
  async listAvailabilities(_ctx: RequestContext, staffIds: readonly string[]): Promise<StaffAvailabilityInfo[]> {
    return this.availabilities.filter((a) => staffIds.includes(a.staffId));
  }
  async listCompetencies(_ctx: RequestContext, staffIds: readonly string[]): Promise<StaffCompetencyInfo[]> {
    return this.competencies.filter((c) => staffIds.includes(c.staffId));
  }
  async isStaffAssignedToClassroom(_ctx: RequestContext, staffId: string, classroomId: string): Promise<boolean> {
    return this.assignments.has(`${staffId}|${classroomId}`);
  }
  async isGuardianOfStudent(_ctx: RequestContext, userId: string, studentId: string): Promise<boolean> {
    return this.guardianships.has(`${userId}|${studentId}`);
  }
  async resolveStaffForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    for (const s of this.staff.values()) if (s.userId === userId) return s.id;
    return null;
  }
  async resolveStudentForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.studentByUser.get(userId) ?? null;
  }
}

export class InMemoryAttendanceQuery implements AttendanceQuery {
  readonly submitted = new Set<string>();
  async hasSubmittedAttendance(_ctx: RequestContext, occurrenceId: string): Promise<boolean> {
    return this.submitted.has(occurrenceId);
  }
}
