/**
 * Ports sources EN MÉMOIRE : un « monde » de faits que les tests (et les scénarios d'année simulée) remplissent, lu par les
 * MÊMES cas d'usage que les adaptateurs réels. Permet de prouver la cohérence read-model / source sans autre module :
 * on modifie le monde, on rafraîchit (ou on reconstruit), puis on compare les agrégats SQL au calcul direct sur le monde.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { AnalyticsSourcePorts } from "../application/ports";
import type {
  AttendanceDayFact,
  CashSessionFact,
  ClassPeriodResults,
  ClassroomFact,
  CollectionPointFact,
  EnrollmentFact,
  FinanceScopeFacts,
  PayrollStatusFact,
  PeriodFact,
  ScopeFact,
  StaffPresenceFact,
  TeachingLoadFact,
  YearFact,
} from "../domain/types";

export class InMemoryAnalyticsWorld {
  scopes: ScopeFact[] = [];
  years: YearFact[] = [];
  periods: PeriodFact[] = [];
  classrooms: ClassroomFact[] = [];
  enrollments: EnrollmentFact[] = [];
  classPeriods = new Map<string, ClassPeriodResults>();
  attendance: AttendanceDayFact[] = [];
  staffPresence: StaffPresenceFact[] = [];
  finance = new Map<string, FinanceScopeFacts>();
  collections: CollectionPointFact[] = [];
  cash: CashSessionFact[] = [];
  payroll: PayrollStatusFact[] = [];
  teachingLoad: TeachingLoadFact[] = [];
  /** Nombre d'appels par méthode de port (preuve de coalescence et de lecture unique). */
  readonly calls: Record<string, number> = {};
  /** Méthodes qui échouent (simulation d'une source en panne) : `"results.readClassPeriod"`. */
  readonly failing = new Set<string>();

  private hit(name: string): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    if (this.failing.has(name)) throw new Error(`Source en panne (${name}).`);
  }

  putClassPeriod(data: ClassPeriodResults): void {
    this.classPeriods.set(`${data.classroomId}|${data.periodId}`, data);
  }

  putFinance(f: FinanceScopeFacts): void {
    this.finance.set(`${f.yearKey}|${f.campusKey}`, f);
  }

  ports(): AnalyticsSourcePorts {
    const w = this;
    return {
      scopes: {
        async listScopes() {
          w.hit("scopes.listScopes");
          return structuredClone(w.scopes);
        },
      },
      calendar: {
        async listYears() {
          w.hit("calendar.listYears");
          return structuredClone(w.years);
        },
        async listPeriods(_ctx: RequestContext, yearId: string) {
          w.hit("calendar.listPeriods");
          return structuredClone(w.periods.filter((p) => p.yearId === yearId));
        },
        async listClassrooms(_ctx: RequestContext, yearId: string) {
          w.hit("calendar.listClassrooms");
          return structuredClone(w.classrooms.filter((c) => c.yearId === yearId));
        },
      },
      enrollments: {
        async listEnrollments(_ctx, input) {
          w.hit("enrollments.listEnrollments");
          return structuredClone(w.enrollments.filter((e) => input.yearId === null || e.yearId === input.yearId));
        },
      },
      results: {
        async listClassPeriods(_ctx, input) {
          w.hit("results.listClassPeriods");
          const out: Array<{ classroomId: string; periodId: string }> = [];
          for (const c of w.classPeriods.values()) {
            if ((input.periodId && c.periodId !== input.periodId) || (input.yearId && c.yearId !== input.yearId)) continue;
            out.push({ classroomId: c.classroomId, periodId: c.periodId });
          }
          return out;
        },
        async readClassPeriod(_ctx, input) {
          w.hit("results.readClassPeriod");
          const found = w.classPeriods.get(`${input.classroomId}|${input.periodId}`);
          return structuredClone(found ?? { classroomId: input.classroomId, periodId: input.periodId, yearId: null, state: "NOT_FINAL" as const, results: [], lines: [] });
        },
      },
      attendance: {
        async readDays(_ctx, input) {
          w.hit("attendance.readDays");
          return structuredClone(w.attendance.filter((a) => a.day >= input.from && a.day <= input.to));
        },
      },
      staffPresence: {
        async readDays(_ctx, input) {
          w.hit("staffPresence.readDays");
          return structuredClone(w.staffPresence.filter((a) => a.day >= input.from && a.day <= input.to));
        },
      },
      finance: {
        async readScope(_ctx, input) {
          w.hit("finance.readScope");
          return structuredClone(w.finance.get(`${input.yearCode ?? "*"}|${input.campusId ?? "*"}`) ?? null);
        },
        async readCollections(_ctx, input) {
          w.hit("finance.readCollections");
          return structuredClone(w.collections.filter((c) => c.day >= input.from && c.day <= input.to));
        },
        async listCashSessions() {
          w.hit("finance.listCashSessions");
          return structuredClone(w.cash);
        },
      },
      payroll: {
        async readMass() {
          w.hit("payroll.readMass");
          return structuredClone(w.payroll);
        },
      },
      teachingLoad: {
        async readLoads(_ctx, input) {
          w.hit("teachingLoad.readLoads");
          return structuredClone(w.teachingLoad.filter((t) => t.yearId === input.yearId));
        },
      },
    };
  }
}
