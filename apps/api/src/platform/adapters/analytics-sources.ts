/**
 * tenancy, academic, people, results, attendance, finance, payroll -> analytics : les PORTS SOURCES des read-models de
 * direction (`AnalyticsSourcePorts`). Chaque port traduit l'API PUBLIQUE d'un module fournisseur vers des faits que
 * `analytics` persiste : jamais de SQL, jamais d'accès à un schéma tiers.
 *
 * Règles (platform-assembly §11) :
 *  - appels SÉQUENTIELS (une connexion partagée par contexte : pas de `Promise.all` sur des lectures de modules) ;
 *  - échec fermé : une lecture impossible LÈVE (`*.port_unavailable` -> la passe est marquée UNAVAILABLE ; autre erreur ->
 *    FAILED, avec reprise) — jamais un zéro qui passerait pour une mesure ;
 *  - résultats : UNIQUEMENT les FINAL de `results` (moyennes, rangs, décisions viennent de `rules` via `results` ; ici on
 *    transporte). Un FINAL reste la version officielle d'une période rouverte tant qu'une nouvelle clôture ne le remplace pas ;
 *  - classification des statuts (présent, absent, en scolarité) : donnée des modules `attendance` / `academic`, jamais
 *    devinée d'après un libellé.
 */
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { getClassroomFacts, getResultsStructure, listAcademicPeriods, listAcademicYears, listClassrooms, listEnrollments, opensSchooling } from "../../modules/academic";
import type { AnalyticsSourcePorts } from "../../modules/analytics";
import { getAttendanceSession, listAttendanceSessions, listStaffLeaves, listStaffRecords, listStatusDefinitions } from "../../modules/attendance";
import { getAgedBalance, getCollectionsTrend, getFinanceSummary, getReceivablesByGroup, getReceivablesByLearner, listSessionPage, type LearnerReceivableRow } from "../../modules/finance";
import { getStudentsByIds, getTeachingLoad, listStaff } from "../../modules/people";
import { ownerMass } from "../../modules/payroll";
import { getClassMatrix, getFinalResult } from "../../modules/results";
import { listCampuses, listInstitutions } from "../../modules/tenancy";
import type { AdapterKit } from "./kit";

const PAGE = 200;
const iso = (d: Date | string | null | undefined): string | null => (d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export function createAnalyticsSources(kit: AdapterKit): AnalyticsSourcePorts {
  const { academic, people, finance, attendance, results, payroll } = kit;

  /** Toutes les pages d'une liste paginée par `page`/`pageSize` (academic). */
  async function allPages<T>(fetch: (page: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const r = await fetch(page);
      out.push(...r.items);
      if (r.items.length === 0 || out.length >= r.total) break;
    }
    return out;
  }

  const classroomsOf = (ctx: RequestContext, yearId: string) => allPages((page) => listClassrooms(academic, ctx, { academicYearId: yearId, page, pageSize: PAGE }).then(unwrap));

  return {
    scopes: {
      async listScopes(ctx) {
        const deps = { db: kit.tenantDb, clock: kit.clock };
        const out: Awaited<ReturnType<AnalyticsSourcePorts["scopes"]["listScopes"]>> = [];
        for (const i of unwrap(await listInstitutions(deps, ctx))) {
          out.push({ kind: "INSTITUTION", id: i.id, parentId: null, label: i.name, status: i.status });
          for (const c of unwrap(await listCampuses(deps, ctx, i.id))) out.push({ kind: "CAMPUS", id: c.id, parentId: i.id, label: c.name, status: c.status });
        }
        return out;
      },
    },

    calendar: {
      async listYears(ctx) {
        return unwrap(await listAcademicYears(academic, ctx)).map((y) => ({ id: y.id, institutionId: y.institutionId, code: y.code, label: y.label, startsOn: y.startsOn, endsOn: y.endsOn, status: y.status, isCurrent: y.isCurrent }));
      },
      async listPeriods(ctx, yearId) {
        return unwrap(await listAcademicPeriods(academic, ctx, yearId)).map((p) => ({ id: p.id, yearId: p.academicYearId, code: p.code, label: p.label, ordinal: p.ordinal, startsOn: p.startsOn, endsOn: p.endsOn, status: p.status }));
      },
      async listClassrooms(ctx, yearId) {
        const out: Awaited<ReturnType<AnalyticsSourcePorts["calendar"]["listClassrooms"]>> = [];
        for (const c of await classroomsOf(ctx, yearId)) {
          const facts = unwrap(await getClassroomFacts(academic, ctx, c.id));
          out.push({ id: c.id, institutionId: c.institutionId, campusId: c.campusId, yearId: c.academicYearId, name: c.name, gradeLevelCode: facts.gradeLevelCode, gradeLevelLabel: facts.gradeLevelLabel, educationLevelCode: facts.educationLevelCode, programLabel: facts.programLabel, kind: c.kind, status: c.status, headcount: c.enrolledCount });
        }
        return out;
      },
    },

    enrollments: {
      async listEnrollments(ctx, input) {
        const rows = await allPages((page) => listEnrollments(academic, ctx, { academicYearId: input.yearId, page, pageSize: PAGE }).then(unwrap));
        // Sexe de l'élève : people, par lots (le sexe n'est jamais déduit du prénom).
        const sexOf = new Map<string, "M" | "F" | null>();
        const ids = [...new Set(rows.map((e) => e.studentId))];
        for (let i = 0; i < ids.length; i += 400) for (const s of unwrap(await getStudentsByIds(people, ctx, ids.slice(i, i + 400)))) sexOf.set(s.id, s.sex);
        return rows.map((e) => ({
          enrollmentId: e.id,
          studentId: e.studentId,
          institutionId: e.institutionId,
          campusId: e.campusId,
          yearId: e.academicYearId,
          classroomId: e.classroomId,
          status: e.status,
          fundingType: e.fundingType,
          sex: sexOf.get(e.studentId) ?? null,
          isRepeating: e.isRepeating,
          inSchooling: opensSchooling(e.status),
          sourceKind: e.sourceKind,
          enrolledOn: e.enrolledOn,
          endedOn: e.endedOn,
          createdAt: e.createdAt,
          confirmedAt: e.confirmedAt,
          cancelledAt: e.cancelledAt,
        }));
      },
    },

    results: {
      async listClassPeriods(ctx, input) {
        const periodIds: Array<{ id: string; yearId: string }> = [];
        const years = unwrap(await listAcademicYears(academic, ctx)).filter((y) => !input.yearId || y.id === input.yearId);
        for (const y of years) for (const p of unwrap(await listAcademicPeriods(academic, ctx, y.id))) if (!input.periodId || p.id === input.periodId) periodIds.push({ id: p.id, yearId: y.id });
        const out: Array<{ classroomId: string; periodId: string }> = [];
        const byYear = new Map<string, Awaited<ReturnType<typeof classroomsOf>>>();
        for (const p of periodIds) {
          if (!byYear.has(p.yearId)) byYear.set(p.yearId, await classroomsOf(ctx, p.yearId));
          for (const c of byYear.get(p.yearId) ?? []) out.push({ classroomId: c.id, periodId: p.id });
        }
        return out;
      },

      async readClassPeriod(ctx, input) {
        const empty = { classroomId: input.classroomId, periodId: input.periodId, yearId: null, state: "NOT_FINAL" as const, results: [], lines: [] };
        const matrix = await getClassMatrix(results, ctx, { classroomId: input.classroomId, academicPeriodId: input.periodId, withLines: true, caps: { read: true } });
        if (!matrix.ok) {
          const code = (matrix.error as { code?: string }).code ?? "";
          if (/port_unavailable$/.test(code)) throw matrix.error; // fermé : la passe est marquée UNAVAILABLE
          return empty; // aucun état de résultats pour cette (classe, période) : rien n'a été clôturé
        }
        const state = matrix.value.state;
        // Version OFFICIELLE : le FINAL (celui de la vue de travail s'il l'est, sinon le FINAL conservé d'une période rouverte).
        const finals = [];
        for (const row of matrix.value.rows) {
          if (row.header.status === "FINAL") finals.push({ header: row.header, lines: row.lines });
          else {
            const official = unwrap(await getFinalResult(results, ctx, { enrollmentId: row.header.enrollmentId, academicPeriodId: input.periodId }));
            if (official) finals.push({ header: official, lines: official.lines });
          }
        }
        if (finals.length === 0) return { ...empty, yearId: state.academicYearId };

        const structure = await getResultsStructure(academic, ctx, { classroomId: input.classroomId, periodId: input.periodId });
        const nodes = new Map((structure.ok ? structure.value.nodes : []).map((n) => [n.id, n]));
        const decisionOf = (enrollmentId: string, scope: "PERIOD" | "YEAR") =>
          matrix.value.decisions.find((d) => d.enrollmentId === enrollmentId && d.scope === scope && (d.status === "CONFIRMED" || d.status === "PUBLISHED") && d.finalCode !== null);

        const rows: Awaited<ReturnType<AnalyticsSourcePorts["results"]["readClassPeriod"]>> = { classroomId: input.classroomId, periodId: input.periodId, yearId: state.academicYearId, state: "FINAL", results: [], lines: [] };
        for (const { header, lines } of finals) {
          const period = decisionOf(header.enrollmentId, "PERIOD");
          const year = decisionOf(header.enrollmentId, "YEAR");
          rows.results.push({
            enrollmentId: header.enrollmentId,
            studentId: header.studentId,
            resultsVersion: header.version,
            average: header.average,
            rank: header.rank,
            cohortSize: header.cohortSize,
            mentionCode: header.mentionCode,
            decisionCode: period?.finalCode ?? header.decisionCode,
            decisionOutcome: period?.finalOutcome ?? header.decisionOutcome,
            yearDecisionCode: year?.finalCode ?? null,
            yearDecisionOutcome: year?.finalOutcome ?? null,
            validated: header.validated,
            creditsAcquired: header.creditsAcquired,
            creditsRequired: header.creditsRequired,
            finalizedAt: iso(header.finalizedAt),
          });
          for (const l of lines) {
            if (!l.curriculumNodeId || (l.level !== "SUBJECT" && l.level !== "ECUE" && l.level !== "UE")) continue;
            const node = nodes.get(l.curriculumNodeId);
            rows.lines.push({ enrollmentId: header.enrollmentId, nodeId: l.curriculumNodeId, level: l.level, nodeCode: node?.code ?? "", nodeLabel: node?.label ?? "", value: l.value, validated: l.validated, sessionObtained: l.sessionObtained, resitEligible: l.resitEligible });
          }
        }
        return rows;
      },
    },

    attendance: {
      async readDays(ctx, input) {
        const defs = new Map(unwrap(await listStatusDefinitions(attendance, ctx, "STUDENT")).map((d) => [d.code, d]));
        const campusOf = new Map<string, { campusId: string | null; institutionId: string }>();
        type Agg = { day: string; classroomId: string; yearId: string; institutionId: string; sessions: number; records: number; present: number; absent: number; excused: number; late: number; minutes: number };
        const agg = new Map<string, Agg>();
        let cursor: string | undefined;
        do {
          const page = unwrap(await listAttendanceSessions(attendance, ctx, { from: input.from, to: input.to, limit: PAGE, cursor }));
          for (const s of page.items) {
            if (s.status !== "SUBMITTED" && s.status !== "VALIDATED") continue;
            const detail = unwrap(await getAttendanceSession(attendance, ctx, { sessionId: s.id }));
            const key = `${s.sessionDate}|${s.classroomId}`;
            const a = agg.get(key) ?? { day: s.sessionDate, classroomId: s.classroomId, yearId: s.academicYearId, institutionId: s.institutionId, sessions: 0, records: 0, present: 0, absent: 0, excused: 0, late: 0, minutes: 0 };
            a.sessions += 1;
            for (const st of detail.students) {
              const rec = st.record;
              if (!rec) continue;
              const def = defs.get(rec.statusCode);
              if (!def) continue; // un statut sans définition ne compte pas (même règle que le récapitulatif d'attendance)
              a.records += 1;
              if (def.countsAsPresent) a.present += 1;
              if (def.countsAsAbsence) {
                a.absent += 1;
                a.minutes += rec.countedMinutes ?? 0;
                if (rec.excused) a.excused += 1;
              }
              if (def.countsAsLate) a.late += 1;
            }
            agg.set(key, a);
            if (!campusOf.has(s.classroomId)) {
              const facts = await getClassroomFacts(academic, ctx, s.classroomId);
              campusOf.set(s.classroomId, { campusId: facts.ok ? facts.value.campusId : null, institutionId: s.institutionId });
            }
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return [...agg.values()].map((a) => ({ day: a.day, classroomId: a.classroomId, yearId: a.yearId, institutionId: a.institutionId, campusId: campusOf.get(a.classroomId)?.campusId ?? null, sessionsCount: a.sessions, recordsCount: a.records, presentCount: a.present, absentCount: a.absent, excusedCount: a.excused, lateCount: a.late, absentMinutes: a.minutes }));
      },
    },

    staffPresence: {
      async readDays(ctx, input) {
        const defs = new Map(unwrap(await listStatusDefinitions(attendance, ctx, "STAFF")).map((d) => [d.code, d]));
        const perDay = new Map<string, { statusCode: string; present: boolean; absent: boolean }>();
        let cursor: string | undefined;
        do {
          const page = unwrap(await listStaffRecords(attendance, ctx, { from: input.from, to: input.to, limit: PAGE, cursor, caps: { staffRead: true } }));
          for (const r of page.items) {
            const def = defs.get(r.statusCode);
            perDay.set(`${r.workDate}|${r.staffId}`, { statusCode: r.statusCode, present: def?.countsAsPresent === true, absent: def?.countsAsAbsence === true });
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        const out = new Map<string, import("../../modules/analytics").StaffPresenceFact>();
        for (const [key, v] of perDay) {
          const [day, staffId] = key.split("|") as [string, string];
          out.set(key, { day, staffId, statusCode: v.statusCode, present: v.present, absent: v.absent, onLeave: false });
        }
        // Congés APPROUVÉS : un jour de congé sans pointage « présent » est un jour de congé.
        let leaveCursor: string | undefined;
        do {
          const page = unwrap(await listStaffLeaves(attendance, ctx, { status: "APPROVED", from: input.from, to: input.to, limit: PAGE, cursor: leaveCursor, caps: { staffRead: true } }));
          for (const l of page.items) {
            for (const day of days(l.startsOn > input.from ? l.startsOn : input.from, l.endsOn < input.to ? l.endsOn : input.to)) {
              const key = `${day}|${l.staffId}`;
              const existing = out.get(key);
              if (existing?.present) continue;
              out.set(key, { day, staffId: l.staffId, statusCode: existing?.statusCode ?? l.leaveTypeCode, present: false, absent: false, onLeave: true });
            }
          }
          leaveCursor = page.nextCursor ?? undefined;
        } while (leaveCursor);
        return [...out.values()];
      },
    },

    finance: {
      async readScope(ctx, input) {
        const filter = { ...(input.yearCode ? { academicYear: input.yearCode } : {}), ...(input.campusId ? { campusId: input.campusId } : {}), asOf: input.asOf };
        const summary = unwrap(await getFinanceSummary(finance, ctx, filter));
        if (summary.invoiceCount === 0) return null; // aucune facture dans ce périmètre : pas de ligne (le manque se lit dans la fraîcheur)
        const groups = unwrap(await getReceivablesByGroup(finance, ctx, filter));
        const items: LearnerReceivableRow[] = [];
        for (let offset = 0; offset < 20_000; offset += 500) {
          const page = unwrap(await getReceivablesByLearner(finance, ctx, { ...filter, limit: 500, offset, onlyOutstanding: false }));
          items.push(...page.items);
          if (page.items.length < 500) break;
        }
        const aged = unwrap(await getAgedBalance(finance, ctx, { ...filter, byLearner: 200 }));
        const names = new Map<string, string>();
        const ids = [...new Set(items.map((l) => l.learnerId))];
        for (let i = 0; i < ids.length; i += 400) for (const s of unwrap(await getStudentsByIds(people, ctx, ids.slice(i, i + 400)))) names.set(s.id, s.displayName);
        const m = (x: { amount: number }): number => x.amount;
        return {
          yearKey: input.yearCode ?? "*",
          campusKey: input.campusId ?? "*",
          summary: { currency: summary.currency, asOf: summary.asOf, invoiceCount: summary.invoiceCount, billed: m(summary.billed), credited: m(summary.credited), netBilled: m(summary.netBilled), collected: m(summary.collected), outstanding: m(summary.outstanding), overdue: m(summary.overdue), overdueInvoiceCount: summary.overdueInvoiceCount, unallocated: m(summary.unallocatedPayments), collectionRateBps: summary.collectionRateBps },
          byGroup: groups.map((g) => ({ groupKey: g.key ?? "", label: g.label, invoiceCount: g.invoiceCount, learnerCount: g.learnerCount, billed: m(g.billed), credited: m(g.credited), collected: m(g.collected), outstanding: m(g.outstanding), overdue: m(g.overdue), collectionRateBps: g.collectionRateBps })),
          byLearner: items.map((l) => ({ learnerId: l.learnerId, learnerName: names.get(l.learnerId) ?? null, groupKey: l.key, label: l.label, invoiceCount: l.invoiceCount, billed: m(l.billed), credited: m(l.credited), collected: m(l.collected), outstanding: m(l.outstanding), overdue: m(l.overdue), oldestOverdueDate: l.oldestOverdueDate, collectionRateBps: l.collectionRateBps })),
          aged: {
            currency: aged.currency,
            asOf: aged.asOf,
            buckets: Object.fromEntries(Object.entries(aged.buckets).map(([k, b]) => [k, { amount: m(b.amount), invoiceCount: b.invoiceCount }])) as never,
            learners: aged.learners.map((l) => ({ learnerId: l.learnerId, buckets: Object.fromEntries(Object.entries(l.buckets).map(([k, v]) => [k, m(v)])) as never, total: m(l.total) })),
          },
        };
      },

      async readCollections(ctx, input) {
        // finance renvoie un seau par jour (sans trou) : les jours sans mouvement ne sont pas stockés (la lecture comble les seaux).
        return unwrap(await getCollectionsTrend(finance, ctx, { from: input.from, to: input.to, granularity: "day" }))
          .filter((p) => p.paymentCount > 0 || p.collected.amount !== 0 || p.refunded.amount !== 0)
          .map((p) => ({ day: p.bucket, currency: p.collected.currency, collected: p.collected.amount, refunded: p.refunded.amount, net: p.net.amount, paymentCount: p.paymentCount }));
      },

      async listCashSessions(ctx) {
        const out: Awaited<ReturnType<AnalyticsSourcePorts["finance"]["listCashSessions"]>> = [];
        for (let offset = 0; offset < 5_000; offset += 200) {
          const page = unwrap(await listSessionPage(finance, ctx, { limit: 200, offset }));
          for (const s of page) out.push({ sessionId: s.id, registerId: s.registerId, cashierId: s.cashierId, currency: s.openingFloat.currency, status: s.status, openedAt: iso(s.openedAt), closedAt: iso(s.closedAt), openingFloat: s.openingFloat.amount, expected: s.expected?.amount ?? null, counted: s.counted?.amount ?? null, variance: s.variance?.amount ?? null });
          if (page.length < 200) break;
        }
        return out;
      },
    },

    payroll: {
      async readMass(ctx) {
        const mass = unwrap(await ownerMass(payroll, ctx, {}));
        const out: Awaited<ReturnType<AnalyticsSourcePorts["payroll"]["readMass"]>> = [];
        for (const p of mass.periods) {
          for (const [status, v] of Object.entries(p.byStatus)) {
            if (!v) continue;
            out.push({ periodId: p.periodId, status, yearId: p.academicYearId, periodName: p.periodName, startsOn: p.startDate, endsOn: p.endDate, currency: v.total.currency, payslipCount: v.payslips, total: v.total.amount });
          }
        }
        return out;
      },
    },

    teachingLoad: {
      async readLoads(ctx, input) {
        const out: Awaited<ReturnType<AnalyticsSourcePorts["teachingLoad"]["readLoads"]>> = [];
        for (let offset = 0; offset < 5_000; offset += 200) {
          const page = unwrap(await listStaff(people, ctx, { canTeach: true, academicYearId: input.yearId, limit: 200, offset }));
          for (const s of page.items) {
            const load = unwrap(await getTeachingLoad(people, ctx, s.id, { yearId: input.yearId }));
            if (load.plannedHours <= 0 && load.byClassroom.length === 0) continue; // sans affectation cette année : hors charge
            out.push({ staffId: s.id, yearId: input.yearId, displayName: s.displayName, status: s.status, plannedHours: load.plannedHours, classroomCount: load.byClassroom.length, contractualHoursPerWeek: load.contractualHoursPerWeek ?? null });
          }
          if (page.items.length < 200) break;
        }
        return out;
      },
    },
  };
}
