/**
 * Emplois du temps, patrons récurrents et génération d'occurrences (spec 017 US2, US7) : conflits entre
 * patrons, publication, génération IDEMPOTENTE hors jours bloquants, alternance A/B, changement d'heure,
 * plafond d'heures, propagation, fin de patron, clonage, génération glissante, performance.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { createAccountingOccurrence, createOccurrence, holdOccurrence, rescheduleOccurrence } from "../../application/occurrences";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent, updateSchedulingSettings, upsertConflictPolicy } from "../../application/reference";
import {
  archiveTimetable,
  cloneTimetable,
  createTimetable,
  endTimetableEntry,
  getTimetable,
  getTimetableConflicts,
  listGenerationRuns,
  publishTimetable,
  removeTimetableEntry,
  updateTimetable,
  upsertTimetableEntries,
  upsertTimetableEntry,
  type EntryInput,
} from "../../application/timetables";
import { generateOccurrences, generateRolling, listExpectedWithoutOccurrence } from "../../application/generation";
import { listOccurrences } from "../../application/views";
import { adminOne, adminRows, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { D, addClass, addEquipment, addRoom, addStaff, createWorld, expectErr, outboxTypes, unwrap, type ClassFixture, type World } from "../support/world";

describeIntegration("emplois du temps et génération d'occurrences", () => {
  let db: SchedulingTestDb;
  let w: World;

  const newTimetable = async (world: World, over: Record<string, unknown> = {}) =>
    unwrap(
      await createTimetable(world.deps, world.ctx, {
        institutionId: world.institutionId,
        academicYearId: world.yearId,
        name: "Emploi du temps 2026-2027",
        validFrom: "2026-09-07",
        validTo: "2027-01-29",
        weekAAnchor: "2026-09-07",
        ...over,
      } as Parameters<typeof createTimetable>[2]),
    );
  const entry = (world: World, timetableId: string, cls: ClassFixture, teacher: string, over: Partial<EntryInput> = {}): EntryInput => ({
    timetableId,
    kind: "LESSON",
    classroomId: cls.classroomId,
    curriculumNodeId: cls.nodeId,
    weekday: 1,
    startTime: "08:00",
    endTime: "10:00",
    staff: [{ staffId: teacher, role: "LEAD" }],
    ...over,
  });
  void entry;

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("emploi du temps et patrons", () => {
    it("valide les bornes : ancre = lundi, fin ≥ début, période de l'académique", async () => {
      const base = { institutionId: w.institutionId, academicYearId: w.yearId, name: "X", validFrom: "2026-09-07", validTo: "2027-01-29" };
      await expectErr(createTimetable(w.deps, w.ctx, { ...base, weekAAnchor: "2026-09-08" }), "VALIDATION_FAILED");
      await expectErr(createTimetable(w.deps, w.ctx, { ...base, validTo: "2026-09-01" }), "VALIDATION_FAILED");
      const periodId = newId();
      w.academic.addPeriod({ id: periodId, academicYearId: w.yearId, startsOn: "2026-09-07", endsOn: "2026-12-18" });
      await expectErr(createTimetable(w.deps, w.ctx, { ...base, periodId }), "VALIDATION_FAILED"); // dépasse la période (jusqu'au 29/01)
      const ok = unwrap(await createTimetable(w.deps, w.ctx, { ...base, periodId, validTo: "2026-12-18" }));
      expect(ok).toMatchObject({ status: "DRAFT", periodId, validTo: "2026-12-18" });
      await expectErr(createTimetable(w.deps, w.ctx, { ...base, periodId: newId() }), "scheduling.not_found");
    });

    it("patron : validations (cours = classe + nœud, alternance = ancre, jour jamais atteint, bornes, minute)", async () => {
      const t = await newTimetable(w, { weekAAnchor: null, name: "Sans ancre" });
      const cls = addClass(w, "Pat A");
      const teacher = addStaff(w, "Prof Patron");
      const e = (over: Partial<EntryInput> = {}) => entry(w, t.id, cls, teacher, over);
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ weekPattern: "WEEK_A" })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ classroomId: null })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ endTime: "08:00" })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ validFrom: "2026-10-10", validTo: "2026-10-01" })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ validFrom: "2028-01-01", validTo: "2028-02-01" })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ weekday: 9 })), "VALIDATION_FAILED");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, e({ staff: [{ staffId: newId(), role: "LEAD" }] })), "scheduling.staff_not_eligible");
      const minute = unwrap(await upsertTimetableEntry(w.deps, w.ctx, e({ weekday: 7, startTime: "08:05", endTime: "08:50" })));
      expect(minute.entry).toMatchObject({ weekday: 7, startMinute: 485, endMinute: 530 });
    });

    it("conflits entre patrons : enseignant, classe, salle ; bout à bout et alternance complémentaire autorisés ; lot atomique", async () => {
      const t = await newTimetable(w, { name: "Conflits patrons" });
      const c1 = addClass(w, "Pc1");
      const c2 = addClass(w, "Pc2");
      const teacher = addStaff(w, "Prof Conflit");
      const room = await addRoom(w, "PC-R", 30);
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c1, teacher, { roomId: room.id })));
      // Même enseignant qui chevauche → refusé, expliqué.
      const e1 = await expectErr(upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c2, teacher, { startTime: "09:00", endTime: "11:00" })), "scheduling.conflict_detected");
      expect(e1.message).toContain("Prof Conflit");
      // Salle partagée.
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c2, addStaff(w, "Autre"), { roomId: room.id, startTime: "09:00", endTime: "10:00" })), "scheduling.conflict_detected");
      // Bout à bout : ok.
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c2, teacher, { startTime: "10:00", endTime: "12:00" })));
      // Alternance : WEEK_A et WEEK_B du même enseignant au même créneau → pas de conflit.
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c1, teacher, { weekday: 2, weekPattern: "WEEK_A" })));
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, c2, teacher, { weekday: 2, weekPattern: "WEEK_B" })));
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pc3"), teacher, { weekday: 2 })), "scheduling.conflict_detected"); // EVERY contre A et B
      // Lot ATOMIQUE : le 2e patron entre en conflit → aucun des deux n'est enregistré.
      const before = unwrap(await getTimetable(w.deps, w.ctx, { timetableId: t.id })).entries.length;
      const r = await upsertTimetableEntries(w.deps, w.ctx, {
        timetableId: t.id,
        entries: [
          { ...entry(w, t.id, addClass(w, "Pc4"), addStaff(w, "Libre"), { weekday: 5 }), timetableId: undefined as never },
          { ...entry(w, t.id, c1, teacher, { weekday: 1, startTime: "09:00", endTime: "09:30" }), timetableId: undefined as never },
        ].map(({ timetableId: _t, ...rest }) => rest),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("scheduling.conflict_detected");
        expect((r.error.details as { entryIndex: number }).entryIndex).toBe(1);
      }
      expect(unwrap(await getTimetable(w.deps, w.ctx, { timetableId: t.id })).entries).toHaveLength(before);
    });

    it("politique WARN sur les enseignants : le patron en conflit est accepté avec ses conflits en avertissement", async () => {
      unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "WARN" }));
      try {
        const t = await newTimetable(w, { name: "Warn patrons" });
        const teacher = addStaff(w, "Prof Warn");
        unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pw1"), teacher)));
        const r = unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pw2"), teacher)));
        expect(r.conflicts.map((c) => c.severity)).toEqual(["WARNING"]);
        expect(unwrap(await getTimetableConflicts(w.deps, w.ctx, { timetableId: t.id })).map((c) => c.severity)).toEqual(["WARNING"]);
      } finally {
        unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "BLOCK" }));
      }
    });

    it("dépassement motivé d'un conflit entre patrons : motif ≥ 5 caractères", async () => {
      const t = await newTimetable(w, { name: "Override patrons" });
      const teacher = addStaff(w, "Prof Override");
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Po1"), teacher)));
      const dup = entry(w, t.id, addClass(w, "Po2"), teacher);
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, { ...dup, overrideReason: "non" }), "scheduling.conflict_detected");
      const r = unwrap(await upsertTimetableEntry(w.deps, w.ctx, { ...dup, overrideReason: "Co-enseignement validé" }));
      expect(r.conflicts[0]?.severity).toBe("BLOCKING");
    });

    it("avertissements du patron : indisponibilité déclarée de l'enseignant (lundi 8-10) sans blocage", async () => {
      const t = await newTimetable(w, { name: "Warnings patrons" });
      const teacher = addStaff(w, "Prof Indispo");
      w.people.availabilities.push({ staffId: teacher, weekday: 1, date: null, startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE" });
      const r = unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pwarn"), teacher)));
      expect(r.warnings.map((x) => x.code)).toContain("STAFF_UNAVAILABLE");
      expect(r.conflicts).toEqual([]);
    });

    it("publication : refuse un emploi du temps vide ou en conflit (WARN toléré), un seul publié par année/période, événement", async () => {
      const empty = await newTimetable(w, { name: "Vide" });
      await expectErr(publishTimetable(w.deps, w.ctx, { timetableId: empty.id }), "VALIDATION_FAILED");
      const t = await newTimetable(w, { name: "À publier" });
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pub"), addStaff(w, "Prof Pub"))));
      const pub = unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: t.id }));
      expect(pub.status).toBe("PUBLISHED");
      expect(await outboxTypes(w, t.id)).toContain("scheduling.timetable.published");
      expect(unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: t.id })).status).toBe("PUBLISHED"); // idempotent
      const t2 = await newTimetable(w, { name: "Second publié" });
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t2.id, addClass(w, "Pub2"), addStaff(w, "Prof Pub2"))));
      await expectErr(publishTimetable(w.deps, w.ctx, { timetableId: t2.id }), "scheduling.timetable_already_published");
      // Un brouillon ne génère rien.
      await expectErr(generateOccurrences(w.deps, w.ctx, { timetableId: t2.id, from: "2026-09-07", to: "2026-09-30" }), "scheduling.invalid_window");
      // Archiver libère la place et empêche toute modification.
      unwrap(await archiveTimetable(w.deps, w.ctx, { timetableId: t.id }));
      expect(await outboxTypes(w, t.id)).toContain("scheduling.timetable.archived");
      await expectErr(upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, addClass(w, "Pub3"), addStaff(w, "Prof Pub3"))), "scheduling.timetable_not_editable");
      unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: t2.id }));
      await expectErr(updateTimetable(w.deps, w.ctx, { timetableId: t2.id, name: "Renommé" }), "scheduling.timetable_not_editable");
    });
  });

  describe("génération d'occurrences", () => {
    // Monde dédié : un seul emploi du temps publié par (établissement, année, période, campus).
    let w: World;
    let gen: { timetableId: string; teacherA: string; teacherB: string; cA: ClassFixture; cB: ClassFixture; entryMon: string; entryA: string; entryB: string };

    beforeAll(async () => {
      w = await createWorld({ db });
      const t = await newTimetable(w, { name: "Génération" });
      const cA = addClass(w, "Gen A");
      const cB = addClass(w, "Gen B");
      const teacherA = addStaff(w, "Prof Gen A");
      const teacherB = addStaff(w, "Prof Gen B");
      const room = await addRoom(w, "GEN-R", 40);
      const mon = unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, cA, teacherA, { roomId: room.id, title: "Maths" })));
      const wa = unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, cA, teacherA, { weekday: 2, startTime: "08:00", endTime: "09:00", weekPattern: "WEEK_A" })));
      const wb = unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, cB, teacherB, { weekday: 2, startTime: "08:00", endTime: "09:00", weekPattern: "WEEK_B" })));
      unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: t.id }));
      gen = { timetableId: t.id, teacherA, teacherB, cA, cB, entryMon: mon.entry.id, entryA: wa.entry.id, entryB: wb.entry.id };
    });

    it("jours fériés/vacances du tenant sautés ; alternance A/B ; rapport exact ; journal immuable ; événement de synthèse", async () => {
      unwrap(await createCalendarEvent(w.deps, w.ctx, { institutionId: w.institutionId, kindCode: "HOLIDAY", title: "Fête de l'Indépendance", startsOn: "2026-10-12", endsOn: "2026-10-12" }));
      unwrap(await createCalendarEvent(w.deps, w.ctx, { institutionId: w.institutionId, kindCode: "VACATION", title: "Vacances de la Toussaint", startsOn: "2026-10-26", endsOn: "2026-11-01" }));
      const report = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2026-09-07", to: "2026-11-08" }));
      // Lundis de la fenêtre : 07/09 … 02/11 (9), dont le 12/10 (férié) et le 26/10 (vacances) → 7.
      // Semaine A = semaine du 07/09 (ancre) : mardis A 08/09, 22/09, 06/10, 20/10, 03/11 (5) ; mardis B 15/09, 29/09, 13/10 (3) — le 27/10 (B) est en vacances.
      expect(report).toMatchObject({ created: 7 + 5 + 3, skippedExisting: 0, skippedConflict: 0, skippedCapped: 0, skippedBlocked: 3, batches: 8 });
      const monday = await adminRows<{ occurs_on: string }>(db, "SELECT occurs_on::text FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 ORDER BY occurs_on", [gen.entryMon]);
      expect(monday.map((r) => r.occurs_on)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-19", "2026-11-02"]);
      const a = await adminRows<{ occurs_on: string }>(db, "SELECT occurs_on::text FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 ORDER BY occurs_on", [gen.entryA]);
      const b = await adminRows<{ occurs_on: string }>(db, "SELECT occurs_on::text FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 ORDER BY occurs_on", [gen.entryB]);
      expect(a.map((r) => r.occurs_on)).toEqual(["2026-09-08", "2026-09-22", "2026-10-06", "2026-10-20", "2026-11-03"]);
      expect(b.map((r) => r.occurs_on)).toEqual(["2026-09-15", "2026-09-29", "2026-10-13"]);
      const sample = await adminOne<{ origin: string; status: string; generated_for: string; room_id: string; n: string }>(
        db,
        `SELECT o.origin, o.status, o.generated_for::text, o.room_id, (SELECT count(*)::text FROM scheduling.occurrence_staff s WHERE s.occurrence_id = o.id) AS n
           FROM scheduling.session_occurrences o WHERE o.timetable_entry_id = $1 AND o.occurs_on = '2026-10-05'`,
        [gen.entryMon],
      );
      expect(sample).toMatchObject({ origin: "GENERATED", status: "PLANNED", generated_for: "2026-10-05", n: "1" });
      expect(sample.room_id).not.toBeNull();
      // Réservations dérivées créées par la base.
      const claims = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.resource_claims c JOIN scheduling.session_occurrences o ON o.id = c.occurrence_id WHERE o.timetable_entry_id = $1", [gen.entryMon]);
      expect(Number(claims.n)).toBe(monday.length * 3);

      const runs = unwrap(await listGenerationRuns(w.deps, w.ctx, { timetableId: gen.timetableId }));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ createdCount: report.created, skippedBlocked: report.skippedBlocked });
      await expect(db.admin.query("UPDATE scheduling.generation_runs SET created_count = 0")).rejects.toThrow(/scheduling\.immutable/);
      expect(await outboxTypes(w, gen.timetableId)).toContain("scheduling.generation.completed");
    });

    it("IDEMPOTENTE : rejouer ne crée rien ; une fenêtre qui chevauche ne crée que le complément", async () => {
      const before = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE timetable_entry_id IN ($1, $2, $3)", [gen.entryMon, gen.entryA, gen.entryB]);
      const again = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2026-09-07", to: "2026-11-08" }));
      expect(again.created).toBe(0);
      expect(again.skippedExisting).toBeGreaterThan(0);
      const extended = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2026-10-26", to: "2026-11-22" }));
      expect(extended.created).toBeGreaterThan(0);
      const after = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE timetable_entry_id IN ($1, $2, $3)", [gen.entryMon, gen.entryA, gen.entryB]);
      expect(Number(after.n)).toBe(Number(before.n) + extended.created);
      const dup = await adminRows(db, "SELECT timetable_entry_id, generated_for, count(*) FROM scheduling.session_occurrences WHERE timetable_entry_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1");
      expect(dup).toEqual([]);
    });

    it("une occurrence reportée n'est pas régénérée à son créneau d'origine ; une annulée reste annulée", async () => {
      const occ = (await adminOne<{ id: string }>(db, "SELECT id FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 AND occurs_on = '2026-09-14'", [gen.entryMon])).id;
      unwrap(await rescheduleOccurrence(w.deps, w.ctx, { occurrenceId: occ, date: "2026-09-14", startTime: "14:00", endTime: "16:00", reason: "Réunion" }));
      const again = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2026-09-14", to: "2026-09-14" }));
      expect(again.created).toBe(0);
      const rows = await adminRows<{ starts_at: Date }>(db, "SELECT starts_at FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 AND generated_for = '2026-09-14'", [gen.entryMon]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.starts_at.toISOString()).toBe("2026-09-14T14:00:00.000Z");
    });

    it("une réservation existante (séance ponctuelle) fait sauter le créneau : compté, expliqué, la génération n'échoue pas", async () => {
      const w = await createWorld({ db });
      const t = await newTimetable(w, { name: "Génération conflit", validFrom: "2026-11-02", validTo: "2026-11-30" });
      const cls = addClass(w, "GenC");
      const teacher = addStaff(w, "Prof GenC");
      unwrap(await upsertTimetableEntry(w.deps, w.ctx, entry(w, t.id, cls, teacher, { weekday: 3, startTime: "10:00", endTime: "12:00" })));
      unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: t.id }));
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", title: "Conseil", date: "2026-11-11", startTime: "11:00", endTime: "12:00", staff: [{ staffId: teacher }] }));
      const r = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: t.id, from: "2026-11-02", to: "2026-11-30" }));
      expect(r).toMatchObject({ created: 3, skippedConflict: 1 });
      expect(r.conflicts[0]).toMatchObject({ entryId: expect.any(String), date: "2026-11-11", resourceKind: "STAFF" });
      expect(r.conflicts[0]?.message).toContain("Prof GenC");
      expect(r.conflicts[0]?.message).toContain("11/11/2026");
      // Rejouée : l'état ne change pas (le créneau en conflit reste sauté).
      const again = unwrap(await generateOccurrences(w.deps, w.ctx, { timetableId: t.id, from: "2026-11-02", to: "2026-11-30" }));
      expect(again).toMatchObject({ created: 0, skippedConflict: 1 });
    });

    it("la fenêtre est bornée par le garde-fou de l'établissement et la validité de l'emploi du temps", async () => {
      await expectErr(generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2027-06-01", to: "2027-07-01" }), "scheduling.invalid_window"); // hors validité
      await expectErr(generateOccurrences(w.deps, w.ctx, { timetableId: gen.timetableId, from: "2026-10-10", to: "2026-10-01" }), "scheduling.invalid_window");
      await expectErr(generateOccurrences(w.deps, w.ctx, { timetableId: newId(), from: "2026-09-07", to: "2026-09-30" }), "scheduling.not_found");
      // Garde-fou technique (réglable par établissement) : plus de `max_generation_weeks` semaines d'un coup est refusé.
      const long = await createWorld({ db });
      const t = await newTimetable(long, { name: "Longue", validFrom: "2026-09-07", validTo: "2028-12-31" });
      unwrap(await upsertTimetableEntry(long.deps, long.ctx, entry(long, t.id, addClass(long, "Longue A"), addStaff(long, "Prof Longue"))));
      unwrap(await publishTimetable(long.deps, long.ctx, { timetableId: t.id }));
      const guard = await expectErr(generateOccurrences(long.deps, long.ctx, { timetableId: t.id, from: "2026-09-07", to: "2028-12-31" }), "scheduling.invalid_window");
      expect(guard.message).toContain("60 semaines");
      unwrap(await updateSchedulingSettings(long.deps, long.ctx, { institutionId: long.institutionId, patch: { maxGenerationWeeks: 10, generationHorizonWeeks: 2 } }));
      await expectErr(generateOccurrences(long.deps, long.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-12-31" }), "scheduling.invalid_window");
      expect(unwrap(await generateOccurrences(long.deps, long.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-04" })).created).toBe(4);
    });
  });

  describe("plafond d'heures du nœud et offres à la carte", () => {
    it("capByNodeHours : le cumul généré par (classe × nœud) ne dépasse pas le volume horaire, rejeu inclus", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Cap A", { hoursTotalMinutes: 5 * 60 }); // 5 h pour des cours de 2 h
      const teacher = addStaff(world, "Prof Cap");
      const t = await newTimetable(world, { name: "Cap", validFrom: "2026-09-07", validTo: "2026-10-31" });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      const r = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-31", capByNodeHours: true }));
      expect(r.created).toBe(2); // 2 × 2 h = 4 h ; une 3e séance de 2 h ferait 6 h > 5 h
      expect(r.skippedCapped).toBe(6); // 8 lundis − 2
      const again = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-31", capByNodeHours: true }));
      expect(again.created).toBe(0);
      // Sans plafond, le reste est généré.
      const rest = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-31" }));
      expect(rest.created).toBe(6);
    });

    it("offre à la carte : réserve l'offre, pas la classe ; offre non planifiable ou hors fenêtre : séances sautées avec avertissement", async () => {
      const world = await createWorld({ db });
      const classroomId = newId();
      world.academic.addClassroom({ id: classroomId, institutionId: world.institutionId, campusId: world.campusId, academicYearId: world.yearId, name: "Licence 1", headcount: 20 });
      const mkOffer = (label: string, over: Record<string, unknown> = {}) => {
        const nodeId = newId();
        const offeringId = newId();
        world.academic.addNode({ id: nodeId, label, hoursTotalMinutes: null, subjectId: null });
        world.academic.addOffering({ id: offeringId, classroomId, curriculumNodeId: nodeId, status: "OPEN", startsOn: null, endsOn: null, label, aLaCarte: true, headcount: 5, ...over } as never);
        return { classroomId, nodeId, offeringId };
      };
      const o1 = mkOffer("UE Algèbre");
      const o2 = mkOffer("UE Analyse");
      const closed = mkOffer("UE Fermée", { status: "CLOSED" });
      const windowed = mkOffer("UE Fenêtre", { startsOn: "2026-10-01", endsOn: "2026-10-14" });
      const t = await newTimetable(world, { name: "À la carte", validFrom: "2026-09-07", validTo: "2026-10-31" });
      for (const [o, name] of [[o1, "Pr1"], [o2, "Pr2"], [closed, "Pr3"], [windowed, "Pr4"]] as const) {
        unwrap(
          await upsertTimetableEntry(world.deps, world.ctx, {
            ...entry(world, t.id, o as ClassFixture, addStaff(world, name)),
            offeringId: o.offeringId,
            claimsClassroom: false,
          }),
        );
      }
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      const r = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-31" }));
      // o1, o2 : 8 lundis chacun (même créneau, même classe, enseignants et offres distincts → aucun conflit) ; fenêtrée : 2 (05/10 et 12/10).
      expect(r.created).toBe(8 + 8 + 2);
      expect(r.warnings.map((x) => x.code)).toEqual(expect.arrayContaining(["ENTRY_SKIPPED_OFFERING", "OFFERING_WINDOW"]));
      const claims = await adminRows<{ resource_kind: string; resource_id: string }>(db, "SELECT DISTINCT c.resource_kind, c.resource_id FROM scheduling.resource_claims c JOIN scheduling.session_occurrences o ON o.id = c.occurrence_id WHERE o.classroom_id = $1 AND c.resource_kind = 'CLASSROOM'", [classroomId]);
      expect(claims.map((c) => c.resource_id).sort()).toEqual([o1.offeringId, o2.offeringId, windowed.offeringId].sort()); // jamais la classe
    });
  });

  describe("changement d'heure (fuseau à heure d'été)", () => {
    it("« lundi 08:00 » reste 08:00 locale, les instants UTC suivent le changement d'heure ; occurs_on = date civile locale", async () => {
      const paris = await createWorld({ db, timezone: "Europe/Paris" });
      const cls = addClass(paris, "DST A");
      const teacher = addStaff(paris, "Prof DST");
      const t = await newTimetable(paris, { name: "DST", validFrom: "2027-03-15", validTo: "2027-04-30" });
      unwrap(await upsertTimetableEntry(paris.deps, paris.ctx, entry(paris, t.id, cls, teacher)));
      unwrap(await upsertTimetableEntry(paris.deps, paris.ctx, entry(paris, t.id, addClass(paris, "DST B"), addStaff(paris, "Prof DST2"), { weekday: 7, startTime: "00:30", endTime: "01:30" })));
      unwrap(await publishTimetable(paris.deps, paris.ctx, { timetableId: t.id }));
      unwrap(await generateOccurrences(paris.deps, paris.ctx, { timetableId: t.id, from: "2027-03-15", to: "2027-04-12" }));
      const rows = await adminRows<{ occurs_on: string; starts_at: Date; ends_at: Date }>(
        db,
        `SELECT o.occurs_on::text, o.starts_at, o.ends_at FROM scheduling.session_occurrences o JOIN scheduling.timetable_entries e ON e.id = o.timetable_entry_id
          WHERE e.timetable_id = $1 AND e.weekday = 1 ORDER BY o.occurs_on`,
        [t.id],
      );
      expect(rows.map((r) => [r.occurs_on, r.starts_at.toISOString()])).toEqual([
        ["2027-03-15", "2027-03-15T07:00:00.000Z"], // CET (UTC+1)
        ["2027-03-22", "2027-03-22T07:00:00.000Z"],
        ["2027-03-29", "2027-03-29T06:00:00.000Z"], // CEST (UTC+2) : l'heure d'été a commencé le 28/03
        ["2027-04-05", "2027-04-05T06:00:00.000Z"],
        ["2027-04-12", "2027-04-12T06:00:00.000Z"],
      ]);
      expect(rows.every((r) => r.ends_at.getTime() - r.starts_at.getTime() === 2 * 3_600_000)).toBe(true);
      // Dimanche 00:30 locale : l'instant UTC tombe la veille, la date civile reste celle du dimanche.
      const sunday = await adminRows<{ occurs_on: string; starts_at: Date }>(
        db,
        `SELECT o.occurs_on::text, o.starts_at FROM scheduling.session_occurrences o JOIN scheduling.timetable_entries e ON e.id = o.timetable_entry_id WHERE e.timetable_id = $1 AND e.weekday = 7 ORDER BY o.occurs_on`,
        [t.id],
      );
      expect(sunday[0]).toMatchObject({ occurs_on: "2027-03-21" });
      expect(sunday[0]?.starts_at.toISOString()).toBe("2027-03-20T23:30:00.000Z");
      // 2027-03-28 : 00:30 locale (avant le saut de 02:00 → 03:00) = 23:30Z la veille (UTC+1).
      expect(sunday.find((s) => s.occurs_on === "2027-03-28")?.starts_at.toISOString()).toBe("2027-03-27T23:30:00.000Z");
    });
  });

  describe("modification, fin et retrait d'un patron", () => {
    it("propagate = FUTURE_PLANNED : met à jour les occurrences futures PLANNED ; épargne le constaté, le déplacé à la main et le passé ; NONE ne touche à rien", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Prop A");
      const teacher = addStaff(world, "Prof Prop");
      const t = await newTimetable(world, { name: "Propagation", validFrom: "2026-09-07", validTo: "2026-12-18" });
      const e = unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      world.clock.set("2026-10-05T12:00:00.000Z"); // « aujourd'hui » : le 05/10 (matin passé), les lundis suivants sont futurs
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-11-02" }));
      const byDate = async (d: string) => (await adminOne<{ id: string }>(db, "SELECT id FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 AND generated_for = $2", [e.entry.id, d])).id;
      const held = await byDate("2026-10-12");
      unwrap(await holdOccurrence(world.deps, world.ctx, { occurrenceId: held, source: "ATTENDANCE" }));
      const manual = await byDate("2026-10-19");
      unwrap(await rescheduleOccurrence(world.deps, world.ctx, { occurrenceId: manual, date: "2026-10-19", startTime: "14:00", endTime: "16:00" }));

      // NONE : aucune propagation.
      const none = unwrap(await upsertTimetableEntry(world.deps, world.ctx, { ...entry(world, t.id, cls, teacher, { startTime: "09:00", endTime: "11:00" }), entryId: e.entry.id, propagate: "NONE" }));
      expect(none.propagation).toBeNull();
      expect((await adminOne<{ h: string }>(db, "SELECT to_char(starts_at, 'HH24:MI') AS h FROM scheduling.session_occurrences WHERE id = $1", [await byDate("2026-10-26")])).h).toBe("08:00");
      // Un rejeu de la génération n'ajoute RIEN à côté des occurrences déjà générées (généré pour la même date de patron).
      const replay = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-10-26", to: "2026-11-02" }));
      expect(replay.created).toBe(0);

      const r = unwrap(await upsertTimetableEntry(world.deps, world.ctx, { ...entry(world, t.id, cls, teacher, { startTime: "09:00", endTime: "11:00" }), entryId: e.entry.id, propagate: "FUTURE_PLANNED" }));
      expect(r.propagation?.updated).toBe(2); // 26/10 et 02/11 (12/10 constatée, 19/10 déplacée, 05/10 et avant : passé)
      expect(r.propagation?.skipped.map((s) => [s.occursOn, s.reason])).toEqual([["2026-10-19", "MANUALLY_MODIFIED"]]);
      expect((await adminOne<{ h: string }>(db, "SELECT to_char(starts_at, 'HH24:MI') AS h FROM scheduling.session_occurrences WHERE id = $1", [await byDate("2026-10-26")])).h).toBe("09:00");
      expect((await adminOne<{ h: string }>(db, "SELECT to_char(starts_at, 'HH24:MI') AS h FROM scheduling.session_occurrences WHERE id = $1", [held])).h).toBe("08:00"); // constatée : intacte
      expect((await adminOne<{ h: string }>(db, "SELECT to_char(starts_at, 'HH24:MI') AS h FROM scheduling.session_occurrences WHERE id = $1", [manual])).h).toBe("14:00");
      expect((await adminOne<{ h: string }>(db, "SELECT to_char(starts_at, 'HH24:MI') AS h FROM scheduling.session_occurrences WHERE id = $1", [await byDate("2026-09-14")])).h).toBe("08:00"); // passé
    });

    it("propagation : un changement d'enseignant et de salle suit ; un conflit introduit est signalé, pas appliqué", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Prop B");
      const t1 = addStaff(world, "Titulaire");
      const t2 = addStaff(world, "Nouveau");
      const room = await addRoom(world, "PR-1", 30);
      const tt = await newTimetable(world, { name: "Propagation 2", validFrom: "2026-10-05", validTo: "2026-10-30" });
      const e = unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, tt.id, cls, t1)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: tt.id }));
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: tt.id, from: "2026-10-05", to: "2026-10-30" }));
      // Le nouvel enseignant a déjà une réunion le 19/10 de 8 h à 9 h.
      unwrap(await createOccurrence(world.deps, world.ctx, { kind: "MEETING", date: "2026-10-19", startTime: "08:00", endTime: "09:00", staff: [{ staffId: t2 }] }));
      const r = unwrap(await upsertTimetableEntry(world.deps, world.ctx, { ...entry(world, tt.id, cls, t2, { roomId: room.id }), entryId: e.entry.id, propagate: "FUTURE_PLANNED" }));
      expect(r.propagation?.updated).toBe(3); // 05/10, 12/10, 26/10
      expect(r.propagation?.skipped).toMatchObject([{ occursOn: "2026-10-19", reason: "CONFLICT" }]);
      const rows = await adminRows<{ occurs_on: string; staff: string; room_id: string | null }>(
        db,
        `SELECT o.occurs_on::text, string_agg(s.staff_id::text, ',') AS staff, o.room_id FROM scheduling.session_occurrences o
           JOIN scheduling.occurrence_staff s ON s.occurrence_id = o.id WHERE o.timetable_entry_id = $1 GROUP BY o.id ORDER BY o.occurs_on`,
        [e.entry.id],
      );
      expect(rows.map((x) => [x.occurs_on, x.staff === t2 ? "nouveau" : x.staff === t1 ? "titulaire" : x.staff, x.room_id === room.id])).toEqual([
        ["2026-10-05", "nouveau", true],
        ["2026-10-12", "nouveau", true],
        ["2026-10-19", "titulaire", false],
        ["2026-10-26", "nouveau", true],
      ]);
    });

    it("fin d'un patron : les occurrences futures PLANNED sont annulées (motif pattern_removed), les constatées restent ; suppression physique seulement sans occurrence", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Fin A");
      const teacher = addStaff(world, "Prof Fin");
      const t = await newTimetable(world, { name: "Fin patron", validFrom: "2026-09-07", validTo: "2026-12-18" });
      const e = unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      const never = unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, addClass(world, "Fin B"), addStaff(world, "Prof Fin B"), { weekday: 5 })));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      world.clock.set("2026-10-05T12:00:00.000Z");
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-26" }));
      const heldFuture = (await adminOne<{ id: string }>(db, "SELECT id FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 AND generated_for = '2026-10-12'", [e.entry.id])).id;
      unwrap(await holdOccurrence(world.deps, world.ctx, { occurrenceId: heldFuture, source: "ATTENDANCE" }));

      const r = unwrap(await removeTimetableEntry(world.deps, world.ctx, { entryId: e.entry.id }));
      expect(r).toMatchObject({ deleted: false, ended: true });
      expect(r.cancelledOccurrences).toBe(2); // 19/10 et 26/10 ; 12/10 constatée ; 05/10 démarré avant « maintenant » mais il est 12:00 → passé
      const statuses = await adminRows<{ occurs_on: string; status: string; cancel_reason: string | null }>(db, "SELECT occurs_on::text, status, cancel_reason FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 ORDER BY occurs_on", [e.entry.id]);
      expect(statuses.filter((s) => s.status === "CANCELLED")).toEqual([
        { occurs_on: "2026-10-19", status: "CANCELLED", cancel_reason: "pattern_removed" },
        { occurs_on: "2026-10-26", status: "CANCELLED", cancel_reason: "pattern_removed" },
      ]);
      expect(statuses.find((s) => s.occurs_on === "2026-10-12")?.status).toBe("HELD");
      // Le patron terminé ne génère plus rien.
      const regen = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-10-27", to: "2026-12-18" }));
      expect(regen.created).toBeGreaterThan(0); // le patron du vendredi continue
      const afterEnd = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE timetable_entry_id = $1 AND generated_for > '2026-10-26'", [e.entry.id]);
      expect(afterEnd.n).toBe("0");
      // Un patron qui a des occurrences est terminé, jamais supprimé physiquement.
      const gone = unwrap(await removeTimetableEntry(world.deps, world.ctx, { entryId: (await adminOne<{ id: string }>(db, "SELECT id FROM scheduling.timetable_entries WHERE timetable_id = $1 AND weekday = 5", [t.id])).id }));
      expect(gone).toMatchObject({ deleted: false, ended: true }); // des occurrences existent : le patron est terminé, pas supprimé
      const unused = unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, addClass(world, "Fin C"), addStaff(world, "Prof Fin C"), { weekday: 6 })));
      // Pas encore de génération pour ce patron : suppression physique.
      const gone2 = unwrap(await removeTimetableEntry(world.deps, world.ctx, { entryId: unused.entry.id }));
      expect(gone2).toEqual({ deleted: true, ended: false, cancelledOccurrences: 0 });
    });
  });

  describe("calendrier de l'établissement", () => {
    it("un jour bloquant créé APRÈS la génération signale les séances PLANNED concernées (événement), sans les annuler ; doublon signalé", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Cal A");
      const teacher = addStaff(world, "Prof Cal");
      const t = await newTimetable(world, { name: "Calendrier", validFrom: "2026-09-07", validTo: "2026-10-30" });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-10-30" }));
      const r = unwrap(await createCalendarEvent(world.deps, world.ctx, { institutionId: world.institutionId, kindCode: "CLOSURE", title: "Fermeture exceptionnelle", startsOn: "2026-10-12", endsOn: "2026-10-16" }));
      expect(r.affectedOccurrences.map((o) => o.occursOn)).toEqual(["2026-10-12"]);
      expect(r.duplicates).toEqual([]);
      expect(await outboxTypes(world, r.event.id)).toEqual(expect.arrayContaining(["scheduling.calendar_event.created", "scheduling.calendar_event.blocking_overlap"]));
      const still = await adminOne<{ status: string }>(db, "SELECT status FROM scheduling.session_occurrences WHERE occurs_on = '2026-10-12' AND timetable_entry_id IS NOT NULL AND tenant_id = $1", [world.tenantId]);
      expect(still.status).toBe("PLANNED");
      const dup = unwrap(await createCalendarEvent(world.deps, world.ctx, { institutionId: world.institutionId, kindCode: "CLOSURE", title: "fermeture exceptionnelle", startsOn: "2026-10-12", endsOn: "2026-10-16" }));
      expect(dup.duplicates).toEqual([r.event.id]);
      // Événement non bloquant : rien à signaler. Mise à jour / suppression publient leurs événements.
      const meeting = unwrap(await createCalendarEvent(world.deps, world.ctx, { institutionId: world.institutionId, kindCode: "MEETING", title: "Réunion pédagogique", startsOn: "2026-10-20", endsOn: "2026-10-20", startsTime: "14:00", endsTime: "16:00" }));
      expect(meeting.event.blocksTeaching).toBe(false);
      expect(meeting.affectedOccurrences).toEqual([]);
      const upd = unwrap(await updateCalendarEvent(world.deps, world.ctx, { eventId: meeting.event.id, kindCode: "HOLIDAY", title: "Jour férié", startsOn: "2026-10-20", endsOn: "2026-10-20" }));
      expect(upd.event.blocksTeaching).toBe(true);
      expect(upd.affectedOccurrences).toEqual([]); // aucune séance ce mardi-là
      unwrap(await deleteCalendarEvent(world.deps, world.ctx, { eventId: meeting.event.id }));
      expect(await outboxTypes(world, meeting.event.id)).toEqual(expect.arrayContaining(["scheduling.calendar_event.updated", "scheduling.calendar_event.deleted"]));
      await expectErr(createCalendarEvent(world.deps, world.ctx, { institutionId: world.institutionId, kindCode: "INCONNU", title: "x", startsOn: "2026-10-20", endsOn: "2026-10-20" }), "VALIDATION_FAILED");
      await expectErr(createCalendarEvent(world.deps, world.ctx, { institutionId: world.institutionId, kindCode: "HOLIDAY", title: "x", startsOn: "2026-10-21", endsOn: "2026-10-20" }), "VALIDATION_FAILED");
    });

    it("séances manquantes : les dates de patron sans occurrence (génération oubliée) sont listées, puis comblées par un rejeu", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Man A");
      const teacher = addStaff(world, "Prof Man");
      const t = await newTimetable(world, { name: "Manquantes", validFrom: "2026-09-07", validTo: "2026-10-30" });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-09-21" }));
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, addClass(world, "Man B"), addStaff(world, "Prof Man B"), { weekday: 3 })));
      const missing = unwrap(await listExpectedWithoutOccurrence(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-09-30" }));
      expect(missing.map((m) => m.date)).toEqual(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-28", "2026-09-30"]);
      unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-09-30" }));
      expect(unwrap(await listExpectedWithoutOccurrence(world.deps, world.ctx, { timetableId: t.id, from: "2026-09-07", to: "2026-09-30" }))).toEqual([]);
    });
  });

  describe("clonage", () => {
    it("copie les patrons d'une année vers un brouillon, remappe nœuds et classes, liste ce qui n'a pas de cible", async () => {
      const world = await createWorld({ db });
      const cls = addClass(world, "Clone A");
      const clsB = addClass(world, "Clone B");
      const teacher = addStaff(world, "Prof Clone");
      const src = await newTimetable(world, { name: "2026-2027" });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, src.id, cls, teacher)));
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, src.id, clsB, addStaff(world, "Prof Clone B"), { weekday: 3 })));
      const cartes = addClass(world, "Clone Carte", { aLaCarte: true });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, { ...entry(world, src.id, cartes, addStaff(world, "Prof Carte"), { weekday: 4 }), offeringId: cartes.offeringId, claimsClassroom: false }));
      const newCls = addClass(world, "Clone A 2027");
      const r = unwrap(
        await cloneTimetable(world.deps, world.ctx, {
          sourceId: src.id,
          name: "2027-2028",
          validFrom: "2027-09-06",
          validTo: "2028-01-28",
          weekAAnchor: "2027-09-06",
          nodeMap: { [cls.nodeId]: newCls.nodeId },
          classroomMap: { [cls.classroomId]: newCls.classroomId },
        }),
      );
      expect(r.timetable).toMatchObject({ status: "DRAFT", clonedFromId: src.id, name: "2027-2028" });
      expect(r.copied).toBe(1);
      expect(r.unmapped.map((u) => u.reason).sort()).toEqual(["NODE_NOT_MAPPED", "OFFERING_NOT_CARRIED"]);
      const copied = unwrap(await getTimetable(world.deps, world.ctx, { timetableId: r.timetable.id })).entries;
      expect(copied).toHaveLength(1);
      expect(copied[0]).toMatchObject({ classroomId: newCls.classroomId, curriculumNodeId: newCls.nodeId, validFrom: null });
      // Sans table de correspondance : copie intégrale (sauf offres à la carte).
      const plain = unwrap(await cloneTimetable(world.deps, world.ctx, { sourceId: src.id, name: "Copie simple", validFrom: "2026-09-07", validTo: "2027-01-29" }));
      expect(plain.copied).toBe(2);
    });
  });

  describe("génération glissante (job quotidien)", () => {
    it("prolonge chaque emploi du temps publié jusqu'à l'horizon de l'établissement ; idempotent ; avance avec la date", async () => {
      const world = await createWorld({ db });
      unwrap(await updateSchedulingSettings(world.deps, world.ctx, { institutionId: world.institutionId, patch: { generationHorizonWeeks: 2 } }));
      const cls = addClass(world, "Roll A");
      const teacher = addStaff(world, "Prof Roll");
      const t = await newTimetable(world, { name: "Glissant", validFrom: "2026-09-07", validTo: "2027-01-29" });
      unwrap(await upsertTimetableEntry(world.deps, world.ctx, entry(world, t.id, cls, teacher)));
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      world.clock.set("2026-10-01T07:00:00.000Z");
      const first = unwrap(await generateRolling(world.deps, world.ctx));
      expect(first).toMatchObject({ timetables: 1, failed: [] });
      expect(first.created).toBe(2); // lundis 05/10 et 12/10 (horizon = 15/10)
      expect(unwrap(await generateRolling(world.deps, world.ctx)).created).toBe(0);
      world.clock.set("2026-10-08T07:00:00.000Z");
      expect(unwrap(await generateRolling(world.deps, world.ctx)).created).toBe(1); // 19/10 (horizon = 22/10)
      const all = unwrap(await listOccurrences(world.deps, world.ctx, { classroomId: cls.classroomId }));
      expect(all.items.map((o) => o.occursOn)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    });
  });

  describe("équipements des patrons", () => {
    it("un patron équipé génère ses séances ; celles qui dépasseraient le stock sont sautées et comptées", async () => {
      const world = await createWorld({ db });
      const kit = await addEquipment(world, "KIT-G", 1);
      const t = await newTimetable(world, { name: "Équipement", validFrom: "2026-10-05", validTo: "2026-10-18" });
      const mk = (name: string, start: string, end: string) =>
        upsertTimetableEntry(world.deps, world.ctx, { ...entry(world, t.id, addClass(world, name), addStaff(world, `Prof ${name}`), { startTime: start, endTime: end }), equipment: [{ equipmentId: kit.id, quantity: 1 }] });
      unwrap(await mk("EqA", "08:00", "10:00"));
      unwrap(await mk("EqB", "09:00", "11:00")); // même matériel (1 seul exemplaire), plage chevauchante
      unwrap(await publishTimetable(world.deps, world.ctx, { timetableId: t.id }));
      const r = unwrap(await generateOccurrences(world.deps, world.ctx, { timetableId: t.id, from: "2026-10-05", to: "2026-10-18" }));
      expect(r.created).toBe(2); // une séance équipée par lundi (05/10, 12/10)
      expect(r.skippedConflict).toBe(2);
      expect(r.conflicts[0]?.message).toContain("Stock d'équipement");
    });
  });

  describe("accès au rapport d'occupation et séances comptables hors génération", () => {
    it("les séances comptables ne sont jamais produites par la génération", async () => {
      const n = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE origin = 'ACCOUNTING' AND timetable_entry_id IS NOT NULL");
      expect(n.n).toBe("0");
      void createAccountingOccurrence;
    });
  });
});
