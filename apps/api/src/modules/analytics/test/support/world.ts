/**
 * Année scolaire SIMULÉE pour les tests de cohérence : un « monde » de faits sources (ports en mémoire) généré de façon
 * déterministe (graine fixe), plus des fonctions de calcul DIRECT sur ce monde (la vérité de la source) auxquelles on
 * compare les agrégats SQL des read-models. Les valeurs de résultats (moyennes, validé / non validé, décisions) sont ici
 * des DONNÉES de la source simulée (celles de `results`), pas des règles : `analytics` ne les calcule jamais.
 */
import { InMemoryAnalyticsWorld } from "../../infrastructure/in-memory-sources";
import type { AttendanceDayFact, ClassPeriodResults, ClassroomFact, EnrollmentFact, FinanceScopeFacts, ResultFact, ResultLineFact, StaffPresenceFact } from "../../domain/types";

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const IDS = {
  institution: uuid(1),
  campusA: uuid(2),
  campusB: uuid(3),
  yearNow: uuid(10),
  yearPrev: uuid(11),
  p1: uuid(20),
  p2: uuid(21),
  pPrev: uuid(22),
  classA: uuid(30),
  classB: uuid(31),
  classC: uuid(32),
  classD: uuid(33),
  classPrev: uuid(34),
  periodRun: uuid(40),
} as const;

export const TODAY = "2026-03-20";
export const YEAR_CODE = "2025-2026";

export interface Simulation {
  world: InMemoryAnalyticsWorld;
  classrooms: ClassroomFact[];
  enrollments: EnrollmentFact[];
}

const day = (offset: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const r2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

export function simulateYear(seed = 20260320): Simulation {
  const rand = rng(seed);
  const world = new InMemoryAnalyticsWorld();
  let counter = 1000;
  const next = (): string => uuid(counter++);

  world.scopes = [
    { kind: "INSTITUTION", id: IDS.institution, parentId: null, label: "Collège Les Palmiers", status: "ACTIVE" },
    { kind: "CAMPUS", id: IDS.campusA, parentId: IDS.institution, label: "Campus Cocody", status: "ACTIVE" },
    { kind: "CAMPUS", id: IDS.campusB, parentId: IDS.institution, label: "Campus Marcory", status: "ACTIVE" },
  ];
  world.years = [
    { id: IDS.yearNow, institutionId: IDS.institution, code: YEAR_CODE, label: "Année 2025-2026", startsOn: "2025-09-15", endsOn: "2026-07-10", status: "OPEN", isCurrent: true },
    { id: IDS.yearPrev, institutionId: IDS.institution, code: "2024-2025", label: "Année 2024-2025", startsOn: "2024-09-16", endsOn: "2025-07-11", status: "ARCHIVED", isCurrent: false },
  ];
  world.periods = [
    { id: IDS.p1, yearId: IDS.yearNow, code: "S1", label: "Semestre 1", ordinal: 1, startsOn: "2025-09-15", endsOn: "2026-01-31", status: "CLOSED" },
    { id: IDS.p2, yearId: IDS.yearNow, code: "S2", label: "Semestre 2", ordinal: 2, startsOn: "2026-02-01", endsOn: "2026-07-10", status: "OPEN" },
    { id: IDS.pPrev, yearId: IDS.yearPrev, code: "S1", label: "Semestre 1", ordinal: 1, startsOn: "2024-09-16", endsOn: "2025-01-31", status: "CLOSED" },
  ];
  const room = (id: string, campusId: string, name: string, code: string, label: string, yearId = IDS.yearNow): ClassroomFact => ({
    id,
    institutionId: IDS.institution,
    campusId,
    yearId,
    name,
    gradeLevelCode: code,
    gradeLevelLabel: label,
    educationLevelCode: "SECONDARY_1",
    programLabel: "Enseignement général",
    kind: "CLASS",
    status: "ACTIVE",
    headcount: 0,
  });
  const classrooms = [
    room(IDS.classA, IDS.campusA, "6e A", "6E", "Sixième"),
    room(IDS.classB, IDS.campusA, "5e A", "5E", "Cinquième"),
    room(IDS.classC, IDS.campusB, "6e B", "6E", "Sixième"),
    room(IDS.classD, IDS.campusB, "5e B", "5E", "Cinquième"),
    room(IDS.classPrev, IDS.campusA, "6e A (2024)", "6E", "Sixième", IDS.yearPrev),
  ];
  world.classrooms = classrooms;

  // --- Inscriptions -------------------------------------------------------------------------------------------------
  const enrollments: EnrollmentFact[] = [];
  const statuses = ["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "CANCELLED", "WITHDRAWN"] as const;
  const inSchoolingOf = (s: string): boolean => s === "CONFIRMED";
  for (const c of classrooms.filter((x) => x.yearId === IDS.yearNow)) {
    const n = 12 + Math.floor(rand() * 7);
    for (let i = 0; i < n; i += 1) {
      const status = statuses[Math.floor(rand() * statuses.length)] as string;
      const month = Math.floor(rand() * 6); // sept..févr
      const createdAt = new Date(Date.UTC(2025, 8 + month, 1 + Math.floor(rand() * 26), 9, 0, 0)).toISOString();
      enrollments.push({
        enrollmentId: next(),
        studentId: next(),
        institutionId: c.institutionId,
        campusId: c.campusId,
        yearId: c.yearId,
        classroomId: c.id,
        status,
        fundingType: rand() < 0.25 ? "STATE_ASSIGNED" : "PRIVATE",
        sex: rand() < 0.5 ? "M" : "F",
        isRepeating: rand() < 0.1,
        inSchooling: inSchoolingOf(status),
        sourceKind: rand() < 0.6 ? "ADMISSION" : "MANUAL",
        enrolledOn: createdAt.slice(0, 10),
        endedOn: null,
        createdAt,
        confirmedAt: status === "CONFIRMED" ? new Date(Date.parse(createdAt) + 86_400_000 * 2).toISOString() : null,
        cancelledAt: status === "CANCELLED" ? new Date(Date.parse(createdAt) + 86_400_000 * 5).toISOString() : null,
      });
    }
  }
  // Une inscription de l'année précédente (autre année : ne doit pas apparaître dans l'année courante).
  enrollments.push({
    enrollmentId: next(), studentId: next(), institutionId: IDS.institution, campusId: IDS.campusA, yearId: IDS.yearPrev, classroomId: IDS.classPrev, status: "COMPLETED",
    fundingType: "PRIVATE", sex: "F", isRepeating: false, inSchooling: false, sourceKind: "MANUAL", enrolledOn: "2024-09-20", endedOn: "2025-07-11",
    createdAt: "2024-09-20T09:00:00.000Z", confirmedAt: "2024-09-21T09:00:00.000Z", cancelledAt: null,
  });
  world.enrollments = enrollments;
  for (const c of classrooms) c.headcount = enrollments.filter((e) => e.classroomId === c.id && e.inSchooling).length;

  // --- Résultats FINAL ------------------------------------------------------------------------------------------------
  const subjects = [
    { id: uuid(500), code: "MATH", label: "Mathématiques" },
    { id: uuid(501), code: "FR", label: "Français" },
    { id: uuid(502), code: "ANG", label: "Anglais" },
  ];
  const makeResults = (classroomId: string, periodId: string, state: "FINAL" | "NOT_FINAL"): ClassPeriodResults => {
    const members = enrollments.filter((e) => e.classroomId === classroomId && e.inSchooling);
    if (state === "NOT_FINAL") return { classroomId, periodId, yearId: IDS.yearNow, state, results: [], lines: [] };
    const results: ResultFact[] = [];
    const lines: ResultLineFact[] = [];
    members.forEach((e, index) => {
      const avg = 3 + rand() * 15;
      const validated = avg >= 10; // DONNÉE de la source simulée (la décision vient de `results`)
      results.push({
        enrollmentId: e.enrollmentId, studentId: e.studentId, resultsVersion: 1, average: r2(avg), rank: index + 1, cohortSize: members.length, mentionCode: null,
        decisionCode: validated ? "ADMITTED" : "ADJOURNED", decisionOutcome: validated ? "ADMITTED" : "ADJOURNED",
        yearDecisionCode: periodId === IDS.p2 ? (validated ? "PROMOTED" : rand() < 0.5 ? "REPEAT" : "PROMOTED") : null,
        yearDecisionOutcome: periodId === IDS.p2 ? (validated ? "PROMOTED" : "REPEAT") : null,
        validated, creditsAcquired: null, creditsRequired: null, finalizedAt: "2026-02-05T10:00:00.000Z",
      });
      for (const s of subjects) {
        const v = Math.max(0, Math.min(20, avg + (rand() - 0.5) * 6));
        lines.push({ enrollmentId: e.enrollmentId, nodeId: s.id, level: "SUBJECT", nodeCode: s.code, nodeLabel: s.label, value: r2(v), validated: v >= 10, sessionObtained: rand() < 0.15 ? 2 : 1, resitEligible: v < 10 });
      }
    });
    return { classroomId, periodId, yearId: IDS.yearNow, state, results, lines };
  };
  for (const id of [IDS.classA, IDS.classB, IDS.classC, IDS.classD]) world.putClassPeriod(makeResults(id, IDS.p1, "FINAL"));
  world.putClassPeriod(makeResults(IDS.classA, IDS.p2, "FINAL"));
  world.putClassPeriod(makeResults(IDS.classB, IDS.p2, "FINAL"));
  world.putClassPeriod(makeResults(IDS.classC, IDS.p2, "NOT_FINAL"));

  // --- Présences ---------------------------------------------------------------------------------------------------
  const attendance: AttendanceDayFact[] = [];
  for (let d = -9; d <= 0; d += 1) {
    for (const c of classrooms.filter((x) => x.yearId === IDS.yearNow)) {
      const records = enrollments.filter((e) => e.classroomId === c.id && e.inSchooling).length;
      const absent = Math.floor(rand() * Math.max(1, records / 4));
      const late = Math.floor(rand() * 3);
      const excused = Math.floor(rand() * (absent + 1));
      attendance.push({ day: day(d), classroomId: c.id, yearId: c.yearId, institutionId: c.institutionId, campusId: c.campusId, sessionsCount: 2, recordsCount: records, presentCount: records - absent, absentCount: absent, excusedCount: excused, lateCount: late, absentMinutes: absent * 60 });
    }
  }
  world.attendance = attendance;
  const staff: StaffPresenceFact[] = [];
  for (let d = -9; d <= 0; d += 1) {
    for (let s = 0; s < 8; s += 1) {
      const roll = rand();
      staff.push({ day: day(d), staffId: uuid(700 + s), statusCode: roll < 0.8 ? "PRESENT" : roll < 0.9 ? "ABSENT" : "LEAVE", present: roll < 0.8, absent: roll >= 0.8 && roll < 0.9, onLeave: roll >= 0.9 });
    }
  }
  world.staffPresence = staff;

  // --- Finance -----------------------------------------------------------------------------------------------------------
  const financeFor = (yearKey: string, campusKey: string, groups: string[]): FinanceScopeFacts => {
    const byGroup = groups.map((g, i) => {
      const billed = 1_000_000 + i * 250_000;
      const collected = Math.floor(billed * (0.45 + rand() * 0.5));
      const credited = i === 0 ? 50_000 : 0;
      const outstanding = billed - credited - collected;
      return { groupKey: g, label: classrooms.find((c) => c.id === g)?.name ?? g, invoiceCount: 10 + i, learnerCount: 10 + i, billed, credited, collected, outstanding, overdue: Math.floor(outstanding * 0.5), collectionRateBps: Math.floor(((collected * 10_000) / (billed - credited))) };
    });
    const sum = (k: "billed" | "credited" | "collected" | "outstanding" | "overdue") => byGroup.reduce((n, g) => n + g[k], 0);
    const netBilled = sum("billed") - sum("credited");
    const learners = byGroup.slice(0, 2).flatMap((g, gi) =>
      [0, 1, 2].map((k) => ({ learnerId: uuid(900 + gi * 10 + k), learnerName: `Élève ${gi}-${k}`, groupKey: g.groupKey, label: g.label, invoiceCount: 1, billed: 300_000, credited: 0, collected: k * 100_000, outstanding: 300_000 - k * 100_000, overdue: k === 0 ? 300_000 : 0, oldestOverdueDate: k === 0 ? "2025-11-30" : null, collectionRateBps: Math.floor((k * 100_000 * 10_000) / 300_000) })),
    );
    return {
      yearKey,
      campusKey,
      summary: { currency: "XOF", asOf: TODAY, invoiceCount: byGroup.reduce((n, g) => n + g.invoiceCount, 0), billed: sum("billed"), credited: sum("credited"), netBilled, collected: sum("collected"), outstanding: sum("outstanding"), overdue: sum("overdue"), overdueInvoiceCount: 7, unallocated: 25_000, collectionRateBps: Math.floor((sum("collected") * 10_000) / netBilled) },
      byGroup,
      byLearner: learners,
      aged: {
        currency: "XOF",
        asOf: TODAY,
        buckets: { NOT_DUE: { amount: 400_000, invoiceCount: 5 }, D1_30: { amount: 300_000, invoiceCount: 4 }, D31_60: { amount: 200_000, invoiceCount: 3 }, D61_90: { amount: 100_000, invoiceCount: 2 }, D91_PLUS: { amount: 50_000, invoiceCount: 1 } },
        learners: [{ learnerId: uuid(900), buckets: { NOT_DUE: 0, D1_30: 300_000, D31_60: 0, D61_90: 0, D91_PLUS: 0 }, total: 300_000 }],
      },
    };
  };
  world.putFinance(financeFor(YEAR_CODE, "*", [IDS.classA, IDS.classB, IDS.classC, IDS.classD]));
  world.putFinance(financeFor(YEAR_CODE, IDS.campusA, [IDS.classA, IDS.classB]));
  world.putFinance(financeFor("*", "*", [IDS.classA, IDS.classB, IDS.classC, IDS.classD]));

  world.collections = [];
  for (let d = -39; d <= 0; d += 1) {
    if (rand() < 0.3) continue;
    const collected = 100_000 + Math.floor(rand() * 400_000);
    const refunded = rand() < 0.1 ? 20_000 : 0;
    world.collections.push({ day: day(d), currency: "XOF", collected, refunded, net: collected - refunded, paymentCount: 1 + Math.floor(rand() * 5) });
  }
  world.cash = [
    { sessionId: uuid(800), registerId: uuid(810), cashierId: uuid(820), currency: "XOF", status: "CLOSED", openedAt: "2026-03-10T08:00:00.000Z", closedAt: "2026-03-10T17:00:00.000Z", openingFloat: 50_000, expected: 300_000, counted: 295_000, variance: -5_000 },
    { sessionId: uuid(801), registerId: uuid(810), cashierId: uuid(820), currency: "XOF", status: "CLOSED", openedAt: "2026-03-11T08:00:00.000Z", closedAt: "2026-03-11T17:00:00.000Z", openingFloat: 50_000, expected: 120_000, counted: 120_000, variance: 0 },
    { sessionId: uuid(802), registerId: uuid(811), cashierId: uuid(821), currency: "XOF", status: "OPEN", openedAt: "2026-03-20T08:00:00.000Z", closedAt: null, openingFloat: 50_000, expected: null, counted: null, variance: null },
  ];

  // --- Paie et charge d'enseignement ------------------------------------------------------------------------------
  world.payroll = [
    { periodId: uuid(600), status: "CALCULATED", yearId: IDS.yearNow, periodName: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", currency: "XOF", payslipCount: 3, total: 900_000 },
    { periodId: uuid(600), status: "APPROVED", yearId: IDS.yearNow, periodName: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", currency: "XOF", payslipCount: 4, total: 1_400_000 },
    { periodId: uuid(600), status: "PAID", yearId: IDS.yearNow, periodName: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", currency: "XOF", payslipCount: 2, total: 700_000 },
    { periodId: uuid(600), status: "CANCELLED", yearId: IDS.yearNow, periodName: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", currency: "XOF", payslipCount: 1, total: 120_000 },
    { periodId: uuid(600), status: "DISPUTED", yearId: IDS.yearNow, periodName: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", currency: "XOF", payslipCount: 1, total: 200_000 },
    { periodId: uuid(601), status: "PAID", yearId: IDS.yearNow, periodName: "Janvier 2026", startsOn: "2026-01-01", endsOn: "2026-01-31", currency: "XOF", payslipCount: 9, total: 3_100_000 },
  ];
  world.teachingLoad = [0, 1, 2, 3, 4, 5].map((i) => ({ staffId: uuid(700 + i), yearId: IDS.yearNow, displayName: `Enseignant ${i}`, status: "ACTIVE", plannedHours: 10 + i * 2.5, classroomCount: 1 + (i % 3), contractualHoursPerWeek: i % 2 === 0 ? 18 : null }));

  return { world, classrooms, enrollments };
}

// ------------------------------------------------------------------------------------------------------------------
// Vérité de la source (calcul direct, sans SQL)
// ------------------------------------------------------------------------------------------------------------------

export const count = <T>(xs: readonly T[], pred: (x: T) => boolean): number => xs.filter(pred).length;
export const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);
export const mean = (xs: readonly number[]): number => (xs.length === 0 ? NaN : sum(xs) / xs.length);
export const round2 = (n: number): number => Math.round(n * 100) / 100;
