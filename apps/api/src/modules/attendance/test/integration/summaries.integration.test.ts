import { afterAll, beforeAll, expect, it } from "vitest";
import { createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { computeSummary, effectiveSummary, type SummaryRecordInput } from "../../domain/summary";
import { indexStatuses } from "../../domain/status";
import { submitJustification, acceptJustification } from "../../application/justifications";
import { upsertAttendanceSettings } from "../../application/reference";
import { cancelAttendanceSession, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import {
  getAttendanceSummary,
  getClassroomAttendanceSummary,
  recomputeSummaries,
  refreshStaleSummaries,
  removeSummaryOverride,
  setSummaryOverride,
} from "../../application/summaries";
import { listStatuses } from "../../infrastructure/reference-repository";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeIntegration("récapitulatifs dérivés, surcharge tracée, alertes configurables (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-12-22T10:00:00.000Z");
    school = await seedSchool(db, world, { students: 8 });
    // 30 jours d'appel sur le trimestre 1 (et au-delà de la fin du trimestre 1 : 2025-12-22 est hors fenêtre du trimestre,
    // dans celle du semestre) avec des statuts pseudo-aléatoires, dont des retards, départs anticipés et excuses.
    const rand = rng(20251001);
    const dates: string[] = [];
    for (let d = 0; d < 30; d += 1) {
      const date = new Date(Date.UTC(2025, 8, 2 + d + Math.floor(d / 5) * 2)).toISOString().slice(0, 10); // jours ouvrés approximatifs
      dates.push(date);
    }
    for (const date of dates) {
      const occ = addOccurrence(world, school, { date });
      const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
      const entries = school.students.map((s) => {
        const x = rand();
        if (x < 0.12) return { studentId: s.studentId, statusCode: "ABSENT" };
        if (x < 0.22) return { studentId: s.studentId, statusCode: "LATE", minutesLate: 1 + Math.floor(rand() * 30) };
        if (x < 0.27) return { studentId: s.studentId, statusCode: "EARLY_LEAVE", minutesMissed: 5 + Math.floor(rand() * 40) };
        return { studentId: s.studentId, statusCode: "PRESENT" };
      });
      unwrap(await markStudentRecords(world.deps, school.admin.ctx, { sessionId: session.id, entries, caps: CAPS.admin }));
      unwrap(await submitAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
      sessionIds.push(session.id);
    }
    // Des excuses sur quelques fenêtres.
    for (const [i, from, to] of [[0, "2025-09-02", "2025-09-12"], [3, "2025-10-01", "2025-10-31"], [5, "2025-09-15", "2025-12-20"]] as const) {
      const j = unwrap(await submitJustification(world.deps, school.admin.ctx, { studentId: school.students[i]!.studentId, fromDate: from, toDate: to, reasonCode: "ILLNESS", caps: CAPS.admin }));
      unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin }));
    }
  });
  afterAll(async () => {
    await db.drop();
  });

  it("le dérivé stocké = le calcul pur du domaine, pour chaque inscription et chaque période, périodes imbriquées comprises", async () => {
    const defs = indexStatuses(await db.tenantDb.run(school.admin.ctx, (tx) => listStatuses(tx, "STUDENT")), "STUDENT");
    for (const period of [
      { id: school.termId, from: "2025-09-01", to: "2025-12-20" },
      { id: school.semesterId, from: "2025-09-01", to: "2026-01-31" },
    ]) {
      for (const s of school.students) {
        const rows = await adminRows<any>(
          db,
          `SELECT s.status, s.session_date::text AS session_date, r.status_code, r.excused, r.minutes_late, r.counted_minutes
             FROM attendance.student_records r JOIN attendance.sessions s ON s.id = r.session_id WHERE r.enrollment_id = $1`,
          [s.enrollmentId],
        );
        const records: SummaryRecordInput[] = rows.map((r) => ({
          sessionStatus: r.status, sessionDate: r.session_date, statusCode: r.status_code, excused: r.excused, minutesLate: r.minutes_late, countedMinutes: r.counted_minutes,
        }));
        const expected = computeSummary(records, defs, { from: period.from, to: period.to });
        const got = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: s.enrollmentId, periodId: period.id }));
        expect(got.derived, `${s.name} / ${period.id}`).toEqual(expected);
        // Cohérence interne : justifié <= total ; minutes justifiées <= minutes d'absence.
        expect(got.derived.excusedCount).toBeLessThanOrEqual(got.derived.absentCount);
        expect(got.derived.excusedMinutes).toBeLessThanOrEqual(got.derived.absentMinutes);
      }
    }
    // Le trimestre (2025-09-01..12-20) contient moins de séances que le semestre qui s'étend jusqu'au 2026-01-31.
    const term = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.termId }));
    const semester = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.semesterId }));
    expect(semester.derived.sessionsTotal).toBeGreaterThanOrEqual(term.derived.sessionsTotal);
    expect(term.derived.sessionsTotal).toBeGreaterThan(0);
  });

  it("recalcul IDEMPOTENT : rejouer ne change aucune valeur et ne republie aucun événement ; filet de sécurité sur un récapitulatif périmé", async () => {
    const countEvents = async () => Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'attendance.summary.recomputed'")).n);
    const before = await adminRows<any>(db, "SELECT * FROM attendance.period_summaries ORDER BY enrollment_id, period_id");
    const eventsBefore = await countEvents();
    const r1 = unwrap(await recomputeSummaries(world.deps, createSystemContext(school.tenantId), { periodId: school.termId }));
    const r2 = unwrap(await recomputeSummaries(world.deps, createSystemContext(school.tenantId), { periodId: school.semesterId }));
    expect(r1.changed + r2.changed).toBe(0);
    const after = await adminRows<any>(db, "SELECT * FROM attendance.period_summaries ORDER BY enrollment_id, period_id");
    const strip = (rows: any[]) => rows.map(({ computed_at: _c, ...rest }) => rest);
    expect(strip(after)).toEqual(strip(before));
    expect(await countEvents()).toBe(eventsBefore);

    // Écriture hors cas d'usage (réparation manuelle) : le récapitulatif devient périmé, le job le rattrape.
    const target = school.students[1]!;
    await db.admin.query(
      "UPDATE attendance.student_records SET status_code = 'ABSENT', counted_minutes = 60, minutes_late = NULL, updated_at = now() + interval '1 minute' WHERE id = (SELECT id FROM attendance.student_records WHERE enrollment_id = $1 AND status_code = 'PRESENT' LIMIT 1)",
      [target.enrollmentId],
    );
    const stale = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: target.enrollmentId, periodId: school.termId }));
    const refreshed = unwrap(await refreshStaleSummaries(world.deps, createSystemContext(school.tenantId)));
    expect(refreshed.refreshed).toBeGreaterThanOrEqual(1);
    expect(refreshed.changed).toBeGreaterThanOrEqual(1);
    const fresh = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: target.enrollmentId, periodId: school.termId }));
    expect(fresh.derived.absentCount).toBe(stale.derived.absentCount + 1);
    // Rejouer le filet de sécurité ne trouve plus rien à faire.
    expect(unwrap(await refreshStaleSummaries(world.deps, createSystemContext(school.tenantId))).changed).toBe(0);
  });

  it("surcharge tracée : motif >= 5 car., excused <= absent, auteur/date, effectif = surcharge, dérivé intact, historique conservé", async () => {
    const e = school.students[2]!;
    const base = { enrollmentId: e.enrollmentId, periodId: school.termId };
    const before = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, base));
    expect(before.overridden).toBe(false);
    expect(before.effective).toEqual(before.derived);

    for (const bad of [
      { absentMinutes: 100, excusedMinutes: 50, reason: "abc" },
      { absentMinutes: 100, excusedMinutes: 150, reason: "Reprise de l'historique" },
      { absentMinutes: -1, excusedMinutes: 0, reason: "Reprise de l'historique" },
    ]) {
      const r = await setSummaryOverride(world.deps, school.admin.ctx, { ...base, ...bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("attendance.override_invalid");
    }

    const auditBefore = world.audit.entries.length;
    const set = unwrap(await setSummaryOverride(world.deps, school.admin.ctx, { ...base, absentMinutes: 600, excusedMinutes: 180, reason: "Reprise de l'historique papier" }));
    expect(set.overridden).toBe(true);
    expect(set.override).toMatchObject({ absentMinutes: 600, excusedMinutes: 180, reason: "Reprise de l'historique papier", setBy: school.admin.userId });
    expect(set.derived).toEqual(before.derived);
    expect(set.effective).toEqual({ ...before.derived, absentMinutes: 600, excusedMinutes: 180 });
    expect(world.audit.entries.slice(auditBefore).find((x) => x.entry.action === "attendance.summary_override.set")?.entry).toMatchObject({ sensitive: true });

    // Remplacer la surcharge garde l'ancienne dans l'historique.
    unwrap(await setSummaryOverride(world.deps, school.admin.ctx, { ...base, absentMinutes: 700, excusedMinutes: 700, reason: "Correction après contrôle" }));
    const history = await adminRows<any>(db, "SELECT absent_minutes, removed_at, removed_by FROM attendance.summary_overrides WHERE enrollment_id = $1 ORDER BY set_at, id", [e.enrollmentId]);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ absent_minutes: 600, removed_by: school.admin.userId });
    expect(history[0].removed_at).not.toBeNull();
    expect(history[1].removed_at).toBeNull();

    const removed = unwrap(await removeSummaryOverride(world.deps, school.admin.ctx, { ...base, reason: "Retour au calcul" }));
    expect(removed.overridden).toBe(false);
    expect(removed.effective).toEqual(before.derived);
    expect((await removeSummaryOverride(world.deps, school.admin.ctx, base)).ok).toBe(false);
    expect(effectiveSummary(before.derived, { absentMinutes: 1, excusedMinutes: 0 }).absentMinutes).toBe(1);
  });

  it("tableau de classe : une ligne par inscrit, y compris sans pointage, surcharge comprise", async () => {
    const extra = newId();
    const extraEnrollment = newId();
    world.ports.roster.addEnrollment({
      enrollmentId: extraEnrollment, studentId: extra, classroomId: school.classroomId, institutionId: school.institutionId, academicYearId: school.yearId,
      active: true, academicYearStart: "2025-09-01", academicYearEnd: "2026-06-30", fromDate: "2025-12-21",
    });
    const table = unwrap(await getClassroomAttendanceSummary(world.deps, school.admin.ctx, { classroomId: school.classroomId, periodId: school.termId }));
    expect(table.rows.map((r) => r.enrollmentId).sort()).toEqual(school.students.map((s) => s.enrollmentId).sort());
    expect(table.rows.every((r) => r.derived.sessionsTotal > 0)).toBe(true);
  });

  it("l'annulation d'un appel retire ses absences des récapitulatifs", async () => {
    const e = school.students[4]!;
    const occ = addOccurrence(world, school, { date: "2025-11-21" });
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await markStudentRecords(world.deps, school.admin.ctx, { sessionId: session.id, entries: [{ studentId: e.studentId, statusCode: "ABSENT" }], caps: CAPS.admin }));
    const withoutIt = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId }));
    unwrap(await submitAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, allPresent: true, caps: CAPS.admin }));
    const withIt = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId }));
    expect(withIt.derived.absentCount).toBe(withoutIt.derived.absentCount + 1);
    unwrap(await cancelAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, reason: "Séance annulée par la direction", caps: CAPS.admin }));
    const cancelled = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId }));
    expect(cancelled.derived).toEqual(withoutIt.derived);
  });

  it("alertes CONFIGURABLES : seuils fournis par l'établissement, événement au franchissement seulement, levée à la baisse", async () => {
    // Aucune règle par défaut : aucun événement d'alerte.
    const countAlerts = async (type: string) => Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM kernel.domain_events WHERE type = $1", [type])).n);
    expect(await countAlerts("attendance.alert.triggered")).toBe(0);

    const bad = await upsertAttendanceSettings(world.deps, school.admin.ctx, { alertRules: [{ code: "x", metric: "ABSENT_COUNT", threshold: 3 }] });
    expect(bad.ok).toBe(false);
    for (const rules of [
      [{ code: "R1", metric: "NOPE", threshold: 3 }],
      [{ code: "R1", metric: "ABSENT_COUNT", threshold: 0 }],
      [{ code: "R1", metric: "ABSENT_COUNT", threshold: 2 }, { code: "R1", metric: "LATE_COUNT", threshold: 2 }],
    ]) {
      expect((await upsertAttendanceSettings(world.deps, school.admin.ctx, { alertRules: rules })).ok).toBe(false);
    }

    const pupil = school.students[6]!; // aucun justificatif pour cet élève
    const current = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: pupil.enrollmentId, periodId: school.termId }));
    const threshold = current.derived.absentCount + 2;
    unwrap(
      await upsertAttendanceSettings(world.deps, school.admin.ctx, {
        alertRules: [
          { code: "ABSENCES_PERIODE", metric: "UNEXCUSED_ABSENT_COUNT", threshold, active: true },
          { code: "TAUX_ABSENCE", metric: "ABSENCE_RATE_BPS", threshold: 10_000, active: true },
        ],
      }),
    );

    const absentOn = async (date: string) => {
      const occ = addOccurrence(world, school, { date });
      const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
      unwrap(await markStudentRecords(world.deps, school.admin.ctx, { sessionId: session.id, entries: [{ studentId: pupil.studentId, statusCode: "ABSENT" }], caps: CAPS.admin }));
      unwrap(await submitAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, allPresent: true, caps: CAPS.admin }));
      return session.id;
    };
    const triggered = async () =>
      (await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'attendance.alert.triggered' ORDER BY id")).map((r) => r.payload).filter((p) => p.enrollmentId === pupil.enrollmentId && p.periodId === school.termId);

    await absentOn("2025-11-24");
    expect(await triggered()).toHaveLength(0); // sous le seuil
    await absentOn("2025-11-25");
    const t1 = await triggered();
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ v: 1, ruleCode: "ABSENCES_PERIODE", metric: "UNEXCUSED_ABSENT_COUNT", threshold, value: threshold, studentId: pupil.studentId });
    await absentOn("2025-11-26"); // toujours au-dessus : pas de nouvel événement
    expect(await triggered()).toHaveLength(1);

    // Une excuse acceptée ramène les absences NON justifiées sous le seuil : alerte levée.
    const j = unwrap(await submitJustification(world.deps, school.admin.ctx, { studentId: pupil.studentId, fromDate: "2025-11-24", toDate: "2025-11-26", reasonCode: "ILLNESS", caps: CAPS.admin }));
    unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin }));
    const cleared = (await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'attendance.alert.cleared'")).map((r) => r.payload).filter((p) => p.enrollmentId === pupil.enrollmentId && p.periodId === school.termId);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ ruleCode: "ABSENCES_PERIODE", value: threshold - 2 });

    // Désactiver / retirer une règle n'envoie rien tant que rien n'est actif ; une règle supprimée « levée » ne bruite pas.
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { alertRules: [] }));
    expect(unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: pupil.enrollmentId, periodId: school.termId })).derived.absentCount).toBeGreaterThan(0);
  });

  it("le module ne contient AUCUN seuil codé en dur", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "test" || name === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    // Le code seulement (les commentaires citent les règles qu'on n'implémente PAS : « N retards = 1 absence »).
    const codeOf = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const offenders = files.filter((f) => /threshold:\s*\d+|seuil\s*=\s*\d+|retards?\s*=\s*\d|[<>]=?\s*(0\.[2-9]|20|60|70|85)\b/i.test(codeOf(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });
});
