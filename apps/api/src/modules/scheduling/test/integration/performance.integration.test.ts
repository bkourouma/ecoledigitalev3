/**
 * Mesures de performance de la spec 017 (§12, AC2.5, AC6.1, AC6.2, AC9.1), sur le volume de référence :
 * un établissement de 40 classes × 30 patrons hebdomadaires × 18 semaines (21 600 séances).
 *
 *   - génération complète du semestre (AC2.5)            < 60 s ; rejeu (idempotent)  bien plus court ;
 *   - vue d'une semaine de classe (AC6.1)                p95 < 200 ms ;
 *   - portail « Aujourd'hui » de l'enseignant (AC6.2)    p95 < 150 ms ;
 *   - `suggestSlots`, 1 enseignant + 1 classe, 4 sem.    p95 < 800 ms (AC9.1).
 *
 * Les seuils sont ceux de la spec, mesurés bout en bout du cas d'usage contre Postgres (réseau local, Docker) :
 * ils bornent une régression d'ordre de grandeur (index manquant, requête N+1), pas un SLA de production.
 * `ED_PERF_FACTOR` (défaut 1) relâche tous les seuils sur une machine lente ou partagée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateOccurrences } from "../../application/generation";
import { suggestSlots } from "../../application/aids";
import { createTimetable, publishTimetable, upsertTimetableEntries, type EntryInput } from "../../application/timetables";
import { listMyToday, listOccurrencesForClassroom } from "../../application/views";
import { adminOne, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { addClass, addRoom, addStaff, createWorld, unwrap, type ClassFixture, type World } from "../support/world";

const FACTOR = Math.max(1, Number(process.env.ED_PERF_FACTOR ?? 1) || 1);
const CLASSES = 40;
const PATTERNS_PER_CLASS = 30; // 5 jours × 6 créneaux
const WEEKS = 18;
const FROM = "2026-09-07"; // lundi
const TO = "2027-01-10"; // dimanche de la 18e semaine
const SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["08:00", "09:00"],
  ["09:00", "10:00"],
  ["10:00", "11:00"],
  ["11:00", "12:00"],
  ["14:00", "15:00"],
  ["15:00", "16:00"],
];

const percentile = (samples: number[], p: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
};

async function measure(n: number, fn: (i: number) => Promise<unknown>): Promise<{ p95: number; max: number; samples: number[] }> {
  await fn(0); // échauffement (plans de requête, connexions du pool)
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    samples.push(performance.now() - t0);
  }
  return { p95: percentile(samples, 95), max: Math.max(...samples), samples };
}

describeIntegration("performance (spec 017 : génération, vues, aide au placement)", () => {
  let db: SchedulingTestDb;
  let w: World;
  let timetableId: string;
  let classes: ClassFixture[] = [];
  let teachers: string[] = [];
  let teacherUsers: string[] = [];
  let generationMs = 0;

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
    const tt = unwrap(
      await createTimetable(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: w.yearId, name: "Volume de référence", validFrom: FROM, validTo: "2027-06-25", weekAAnchor: FROM } as Parameters<typeof createTimetable>[2]),
    );
    timetableId = tt.id;
    const entries: Omit<EntryInput, "timetableId">[] = [];
    for (let c = 0; c < CLASSES; c++) {
      const cls = addClass(w, `Classe perf ${c}`, { headcount: 30 });
      const userId = w.ctxOf().userId as string;
      const teacher = addStaff(w, `Prof perf ${c}`, { userId });
      const room = await addRoom(w, `PERF-${c}`, 40);
      classes.push(cls);
      teachers.push(teacher);
      teacherUsers.push(userId);
      for (let d = 1; d <= 5; d++) {
        for (const [start, end] of SLOTS) {
          entries.push({ kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, roomId: room.id, weekday: d, startTime: start, endTime: end, staff: [{ staffId: teacher, role: "LEAD" }] });
        }
      }
    }
    expect(entries).toHaveLength(CLASSES * PATTERNS_PER_CLASS);
    for (let i = 0; i < entries.length; i += 400) {
      unwrap(await upsertTimetableEntries(w.deps, w.ctx, { timetableId, entries: entries.slice(i, i + 400) }));
    }
    unwrap(await publishTimetable(w.deps, w.ctx, { timetableId }));
  }, 900_000);

  afterAll(async () => {
    await db.drop();
  });

  it(`AC2.5 : génération de ${CLASSES} classes × ${PATTERNS_PER_CLASS} patrons × ${WEEKS} semaines en moins de ${60 * FACTOR} s, puis rejeu idempotent`, async () => {
    const t0 = performance.now();
    const report = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId, from: FROM, to: TO }));
    generationMs = performance.now() - t0;
    const expected = CLASSES * PATTERNS_PER_CLASS * WEEKS;
    console.info(`[perf] génération : ${report.created} séances en ${(generationMs / 1000).toFixed(1)} s (${report.batches} lots)`);
    expect(report).toMatchObject({ created: expected, skippedConflict: 0, skippedBlocked: 0, skippedExisting: 0 });
    expect(generationMs).toBeLessThan(60_000 * FACTOR);
    const stored = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE tenant_id = $1", [w.tenantId]);
    expect(Number(stored.n)).toBe(expected);
    // Les réservations dérivées (enseignant, classe, salle) sont présentes pour chaque séance : la base arbitre vraiment.
    const claims = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.resource_claims WHERE tenant_id = $1", [w.tenantId]);
    expect(Number(claims.n)).toBe(expected * 3);

    const t1 = performance.now();
    const replay = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId, from: FROM, to: TO }));
    const replayMs = performance.now() - t1;
    console.info(`[perf] rejeu : ${(replayMs / 1000).toFixed(1)} s`);
    expect(replay).toMatchObject({ created: 0, skippedExisting: expected });
    expect(replayMs).toBeLessThan(60_000 * FACTOR);
  }, 600_000);

  it(`AC6.1 : vue d'une semaine de classe (30 séances) p95 < ${200 * FACTOR} ms sur ${CLASSES * PATTERNS_PER_CLASS * WEEKS} séances`, async () => {
    const m = await measure(40, async (i) => {
      const monday = new Date(Date.parse(`${FROM}T00:00:00Z`) + (i % WEEKS) * 7 * 86_400_000);
      const from = monday.toISOString().slice(0, 10);
      const to = new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const page = unwrap(await listOccurrencesForClassroom(w.deps, w.ctx, { classroomId: (classes[i % CLASSES] as ClassFixture).classroomId, from, to }));
      expect(page.items).toHaveLength(PATTERNS_PER_CLASS);
    });
    console.info(`[perf] vue semaine de classe : p95=${m.p95.toFixed(0)} ms, max=${m.max.toFixed(0)} ms`);
    expect(m.p95).toBeLessThan(200 * FACTOR);
  }, 300_000);

  it(`AC6.2 : portail « Aujourd'hui » de l'enseignant p95 < ${150 * FACTOR} ms`, async () => {
    // Horloge du monde : jeudi 1er octobre 2026 ⇒ 6 séances par enseignant (créneaux du jeudi).
    const m = await measure(40, async (i) => {
      const r = unwrap(await listMyToday(w.deps, w.ctxOf(teacherUsers[i % CLASSES] as string)));
      expect(r.date).toBe("2026-10-01");
      expect(r.items).toHaveLength(SLOTS.length);
    });
    console.info(`[perf] aujourd'hui : p95=${m.p95.toFixed(0)} ms, max=${m.max.toFixed(0)} ms`);
    expect(m.p95).toBeLessThan(150 * FACTOR);
  }, 300_000);

  it(`AC9.1 : suggestSlots (1 enseignant, 1 classe, 4 semaines) p95 < ${800 * FACTOR} ms, déterministe`, async () => {
    // Pas d'ouverture saturée : on demande un créneau de 30 min dans la plage 07:00-18:00 hors des créneaux déjà pris.
    let first: unknown = null;
    const m = await measure(25, async (i) => {
      const c = i % CLASSES;
      const r = unwrap(
        await suggestSlots(w.deps, w.ctx, {
          institutionId: w.institutionId,
          durationMinutes: 30,
          staffIds: [teachers[c] as string],
          classroomId: (classes[c] as ClassFixture).classroomId,
          window: { from: "2026-10-05", to: "2026-11-01" },
          count: 10,
          dayStart: "07:00",
          dayEnd: "18:00",
          weekdays: [1, 2, 3, 4, 5],
          useTimeSlots: false,
          stepMinutes: 30,
        }),
      );
      expect(r.length).toBeGreaterThan(0);
      // Aucune suggestion ne peut tomber sur un créneau déjà occupé par un patron (08-12, 14-16).
      for (const s of r) {
        const startsAt = new Date((s as { startsAt: Date | string }).startsAt);
        const h = startsAt.getUTCHours() + startsAt.getUTCMinutes() / 60; // fuseau par défaut : Africa/Abidjan = UTC
        expect(h >= 12 && h < 14 ? true : h < 8 || h >= 16).toBe(true);
      }
      if (i === 0) {
        if (first === null) first = r;
        else expect(r).toEqual(first); // même question ⇒ même réponse (échauffement puis 1re mesure)
      }
    });
    console.info(`[perf] suggestSlots : p95=${m.p95.toFixed(0)} ms, max=${m.max.toFixed(0)} ms`);
    expect(m.p95).toBeLessThan(800 * FACTOR);
  }, 300_000);
});
