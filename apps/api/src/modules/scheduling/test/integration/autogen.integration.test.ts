/**
 * Générateur d'emploi du temps (spec 017, O-05) sur Postgres : demande → proposition (brouillon) → examen →
 * application par un humain. Garanties vérifiées : aucune écriture dans un emploi du temps publié, confirmations
 * obligatoires, proposition figée par la base, reproductibilité par graine, tâche asynchrone, RLS entre tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, noopLogger } from "@ecoledigitale/kernel";
import { createTimetable, getTimetable, getTimetableConflicts, publishTimetable, upsertTimetableEntry } from "../../application/timetables";
import { updateSchedulingSettings } from "../../application/reference";
import { applyAutogenRun, discardAutogenRun, executeAutogenRun, getAutogenDefaults, getAutogenRun, listAutogenRuns, processQueuedAutogenRuns, startAutogenRun } from "../../application/autogen";
import type { AutogenParams } from "../../application/autogen-input";
import jobs from "../../jobs";
import { registerSchedulingPorts, resetSchedulingPorts } from "../../ports-registry";
import { adminOne, adminRows, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { addClass, addRoom, addStaff, createWorld, expectErr, outboxTypes, unwrap, type World } from "../support/world";

describeIntegration("générateur d'emploi du temps", () => {
  let db: SchedulingTestDb;
  let w: World;
  let teachers: string[] = [];
  let classes: Array<{ classroomId: string; nodes: string[] }> = [];

  /** Une classe de plus avec `n` matières (nœuds de curriculum). */
  const addClassWithNodes = (world: World, name: string, n: number): { classroomId: string; nodes: string[] } => {
    const base = addClass(world, name, { headcount: 25 });
    const nodes = [base.nodeId];
    for (let i = 1; i < n; i++) {
      const id = newId();
      world.academic.addNode({ id, label: `Matière ${i + 1} (${name})`, hoursTotalMinutes: null, subjectId: null });
      nodes.push(id);
    }
    return { classroomId: base.classroomId, nodes };
  };

  const params = (world: World, over: Partial<AutogenParams> = {}): AutogenParams => ({
    institutionId: world.institutionId,
    academicYearId: world.yearId,
    name: "Proposition de rentrée",
    validFrom: "2026-09-07",
    validTo: "2027-01-29",
    seed: "graine-1",
    maxIterations: 3000,
    timeLimitSeconds: 20,
    mode: "SYNC",
    requirements: classes.flatMap((c, ci) =>
      c.nodes.map((nodeId, ni) => ({ classroomId: c.classroomId, curriculumNodeId: nodeId, sessionsPerWeek: 3, teacherIds: [teachers[(ci + ni) % teachers.length]!, teachers[(ci + ni + 1) % teachers.length]!] })),
    ),
    ...over,
  });

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
    unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { openingStart: "08:00", openingEnd: "12:00", openingWeekdays: [1, 2, 3, 4, 5] } }));
    teachers = ["Prof 1", "Prof 2", "Prof 3", "Prof 4", "Prof 5", "Prof 6"].map((n) => addStaff(w, n));
    classes = [addClassWithNodes(w, "6e A", 4), addClassWithNodes(w, "6e B", 4), addClassWithNodes(w, "5e A", 4)];
    for (const code of ["S1", "S2", "S3"]) await addRoom(w, code, 30);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("valeurs par défaut de l'écran de lancement : grille déduite de l'ouverture, aucune règle inventée", async () => {
    const d = unwrap(await getAutogenDefaults(w.deps, w.ctx, { institutionId: w.institutionId }));
    expect(d).toMatchObject({ gridSource: "REGULAR", weekdays: [1, 2, 3, 4, 5], rooms: 3, ports: { academic: true, people: true } });
    expect(d.periods.map((p) => p.startTime)).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    // Établissement sans ouverture renseignée : rien n'est deviné.
    const other = await createWorld({ db });
    const none = unwrap(await getAutogenDefaults(other.deps, other.ctx, { institutionId: other.institutionId }));
    expect(none).toMatchObject({ gridSource: "NONE", weekdays: [], periods: [] });
    await expectErr(startAutogenRun(other.deps, other.ctx, params(other, { requirements: [{ classroomId: newId(), curriculumNodeId: newId(), sessionsPerWeek: 1 }] })), "VALIDATION_FAILED");
  });

  it("génère une proposition valide, puis un humain l'applique dans un NOUVEAU brouillon sans conflit", async () => {
    const started = unwrap(await startAutogenRun(w.deps, w.ctx, params(w)));
    expect(started.executed).toBe(true);
    expect(started.run.status).toBe("COMPLETED");
    const got = unwrap(await getAutogenRun(w.deps, w.ctx, { runId: started.run.id }));
    const result = got.result!;
    expect(result.stats.sessions).toBe(36);
    expect(result.stats.placed + result.score.unplacedSessions).toBe(36);
    expect(result.unplaced).toEqual([]);
    expect(result.labels.classrooms[classes[0]!.classroomId]).toBe("6e A");

    // Rien n'existe encore côté emplois du temps : la proposition n'est qu'un brouillon de calcul.
    expect(await adminRows(db, "SELECT 1 FROM scheduling.timetables WHERE tenant_id = $1", [w.tenantId])).toHaveLength(0);

    const applied = unwrap(await applyAutogenRun(w.deps, w.ctx, { runId: started.run.id, name: "EDT 2026-2027 (auto)" }));
    expect(applied.timetable.status).toBe("DRAFT");
    expect(applied.entriesCreated).toBe(36);
    expect(applied.run.status).toBe("APPLIED");
    expect(applied.run.appliedTimetableId).toBe(applied.timetable.id);
    const tt = unwrap(await getTimetable(w.deps, w.ctx, { timetableId: applied.timetable.id }));
    expect(tt.entries).toHaveLength(36);
    expect(tt.entries.every((e) => e.staff.length === 1 && e.roomId !== null && e.kind === "LESSON" && e.weekPattern === "EVERY")).toBe(true);
    // Indépendamment du moteur : la base et le contrôle de conflits entre patrons ne voient aucun conflit.
    expect(unwrap(await getTimetableConflicts(w.deps, w.ctx, { timetableId: applied.timetable.id }))).toEqual([]);
    const dup = await adminRows(
      db,
      `SELECT a.id FROM scheduling.timetable_entries a JOIN scheduling.timetable_entries b ON a.timetable_id = b.timetable_id AND a.id < b.id AND a.weekday = b.weekday
         AND a.starts_time < b.ends_time AND b.starts_time < a.ends_time AND (a.classroom_id = b.classroom_id OR a.room_id = b.room_id)
        WHERE a.timetable_id = $1`,
      [applied.timetable.id],
    );
    expect(dup).toEqual([]);
    const staffClash = await adminRows(
      db,
      `SELECT 1 FROM scheduling.timetable_entry_staff s1 JOIN scheduling.timetable_entries a ON a.id = s1.entry_id
         JOIN scheduling.timetable_entry_staff s2 ON s2.staff_id = s1.staff_id AND s2.entry_id <> s1.entry_id
         JOIN scheduling.timetable_entries b ON b.id = s2.entry_id AND b.timetable_id = a.timetable_id AND b.weekday = a.weekday AND a.starts_time < b.ends_time AND b.starts_time < a.ends_time
        WHERE a.timetable_id = $1`,
      [applied.timetable.id],
    );
    expect(staffClash).toEqual([]);

    const types = await outboxTypes(w);
    expect(types).toContain("scheduling.autogen_run.completed");
    expect(types).toContain("scheduling.autogen_run.applied");
    expect(w.audit.actions()).toEqual(expect.arrayContaining(["scheduling.autogen_run.requested", "scheduling.autogen_run.completed", "scheduling.autogen_run.applied"]));

    // Une proposition ne s'applique qu'une fois.
    await expectErr(applyAutogenRun(w.deps, w.ctx, { runId: started.run.id }), "scheduling.autogen_not_applicable");
  });

  it("reproductible : même graine ⇒ même proposition ; la proposition est figée par la base", async () => {
    const a = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { seed: "repro" })));
    const b = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { seed: "repro" })));
    const c = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { seed: "autre" })));
    const placementsOf = async (id: string) => unwrap(await getAutogenRun(w.deps, w.ctx, { runId: id })).result!.placements;
    expect(await placementsOf(b.run.id)).toEqual(await placementsOf(a.run.id));
    expect(await placementsOf(c.run.id)).not.toEqual(await placementsOf(a.run.id));
    expect(a.run.seed).toBe("repro");

    await expect(db.admin.query("UPDATE scheduling.autogen_runs SET result = '{}'::jsonb WHERE id = $1", [a.run.id])).rejects.toThrow(/autogen_immutable/);
    await expect(db.admin.query("UPDATE scheduling.autogen_runs SET params = '{}'::jsonb WHERE id = $1", [a.run.id])).rejects.toThrow(/autogen_immutable/);
    await expect(db.admin.query("UPDATE scheduling.autogen_runs SET status = 'RUNNING' WHERE id = $1", [a.run.id])).rejects.toThrow(/autogen_transition/);
    await expect(db.admin.query("DELETE FROM scheduling.autogen_runs WHERE id = $1", [a.run.id])).rejects.toThrow(/immutable/);
  });

  it("n'écrase JAMAIS un emploi du temps publié : application à un nouveau brouillon, remplacement d'un brouillon confirmé, publié refusé", async () => {
    const teacher = teachers[0]!;
    const published = unwrap(await createTimetable(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: w.yearId, name: "Publié", validFrom: "2026-09-07", validTo: "2027-01-29" }));
    unwrap(
      await upsertTimetableEntry(w.deps, w.ctx, { timetableId: published.id, kind: "LESSON", classroomId: classes[0]!.classroomId, curriculumNodeId: classes[0]!.nodes[0]!, weekday: 1, startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher, role: "LEAD" }] }),
    );
    unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: published.id }));
    const before = await adminRows(db, "SELECT id, weekday, starts_time, ends_time, updated_at FROM scheduling.timetable_entries WHERE timetable_id = $1 ORDER BY id", [published.id]);

    const run = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { seed: "pub" })));
    expect(unwrap(await getAutogenRun(w.deps, w.ctx, { runId: run.run.id })).result!.publishedTimetable).toEqual({ id: published.id, name: "Publié" });

    // 1. Le publié ne peut pas être la cible, avec ou sans confirmation.
    for (const confirmReplace of [false, true]) {
      await expectErr(applyAutogenRun(w.deps, w.ctx, { runId: run.run.id, mode: "REPLACE_DRAFT", targetTimetableId: published.id, confirmReplace }), "scheduling.autogen_would_overwrite_published");
    }
    // 2. Un brouillon existant : confirmation obligatoire.
    const draft = unwrap(await createTimetable(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: w.yearId, name: "Brouillon à remplacer", validFrom: "2026-09-07", validTo: "2027-01-29" }));
    unwrap(
      await upsertTimetableEntry(w.deps, w.ctx, { timetableId: draft.id, kind: "LESSON", classroomId: classes[1]!.classroomId, curriculumNodeId: classes[1]!.nodes[0]!, weekday: 2, startTime: "08:00", endTime: "09:00", staff: [{ staffId: teachers[1]!, role: "LEAD" }] }),
    );
    await expectErr(applyAutogenRun(w.deps, w.ctx, { runId: run.run.id, mode: "REPLACE_DRAFT", targetTimetableId: draft.id }), "scheduling.autogen_confirmation_required");
    expect(unwrap(await getTimetable(w.deps, w.ctx, { timetableId: draft.id })).entries).toHaveLength(1);
    const replaced = unwrap(await applyAutogenRun(w.deps, w.ctx, { runId: run.run.id, mode: "REPLACE_DRAFT", targetTimetableId: draft.id, confirmReplace: true }));
    expect(replaced).toMatchObject({ entriesReplaced: 1, entriesCreated: 36 });
    expect(replaced.timetable.id).toBe(draft.id);

    // 3. Le publié est intact, entrée par entrée.
    const after = await adminRows(db, "SELECT id, weekday, starts_time, ends_time, updated_at FROM scheduling.timetable_entries WHERE timetable_id = $1 ORDER BY id", [published.id]);
    expect(after).toEqual(before);
    expect((await adminOne(db, "SELECT status FROM scheduling.timetables WHERE id = $1", [published.id])).status).toBe("PUBLISHED");
  });

  it("respecte l'occupation d'un autre emploi du temps (fixedTimetableId) et les disponibilités / plafonds des enseignants", async () => {
    const world = await createWorld({ db });
    unwrap(await updateSchedulingSettings(world.deps, world.ctx, { institutionId: world.institutionId, patch: { openingStart: "08:00", openingEnd: "12:00", openingWeekdays: [1, 2, 3, 4, 5] } }));
    const t1 = addStaff(world, "Prof Fixe");
    const t2 = addStaff(world, "Prof Libre");
    const cls = addClassWithNodes(world, "Seconde", 3);
    await addRoom(world, "A1", 30);
    await addRoom(world, "A2", 30);
    const other = unwrap(await createTimetable(world.deps, world.ctx, { institutionId: world.institutionId, academicYearId: world.yearId, name: "Autre", validFrom: "2026-09-07", validTo: "2027-01-29" }));
    const otherCls = addClassWithNodes(world, "Autre classe", 1);
    unwrap(await upsertTimetableEntry(world.deps, world.ctx, { timetableId: other.id, kind: "LESSON", classroomId: otherCls.classroomId, curriculumNodeId: otherCls.nodes[0]!, weekday: 1, startTime: "08:00", endTime: "10:00", staff: [{ staffId: t1, role: "LEAD" }] }));
    // Disponibilités déclarées : t2 indisponible le mardi.
    world.people.availabilities.push({ staffId: t2, weekday: 2, date: null, startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE" });
    const r = unwrap(
      await startAutogenRun(world.deps, world.ctx, {
        ...params(world, { seed: "fixed" }),
        fixedTimetableId: other.id,
        requirements: cls.nodes.map((n, i) => ({ classroomId: cls.classroomId, curriculumNodeId: n, sessionsPerWeek: 3, teacherIds: i === 0 ? [t1] : [t2] })),
        teachers: [{ staffId: t2, maxPeriodsPerDay: 2 }],
        closedRanges: [{ weekday: 5, startTime: "10:00", endTime: "12:00" }],
      }),
    );
    const result = unwrap(await getAutogenRun(world.deps, world.ctx, { runId: r.run.id })).result!;
    const mine = result.placements.filter((p) => p.teacherId === t1);
    expect(mine.length).toBe(3);
    expect(mine.some((p) => p.weekday === 1 && (p.startTime === "08:00" || p.startTime === "09:00"))).toBe(false);
    const lib = result.placements.filter((p) => p.teacherId === t2);
    expect(lib.some((p) => p.weekday === 2)).toBe(false);
    for (let d = 1; d <= 5; d++) expect(lib.filter((p) => p.weekday === d).length).toBeLessThanOrEqual(2);
    expect(result.placements.some((p) => p.weekday === 5 && p.startTime >= "10:00")).toBe(false);
  });

  it("ce qui ne peut pas être placé est rapporté avec ses causes ; l'appliquer exige une confirmation explicite", async () => {
    const world = await createWorld({ db });
    unwrap(await updateSchedulingSettings(world.deps, world.ctx, { institutionId: world.institutionId, patch: { openingStart: "08:00", openingEnd: "10:00", openingWeekdays: [1, 2] } }));
    const teacher = addStaff(world, "Seul prof");
    const cls = addClassWithNodes(world, "Surchargée", 2);
    await addRoom(world, "Z1", 30);
    // 2 jours × 2 périodes = 4 cases, 6 séances demandées.
    const run = unwrap(
      await startAutogenRun(world.deps, world.ctx, {
        ...params(world, { seed: "over" }),
        requirements: [
          { classroomId: cls.classroomId, curriculumNodeId: cls.nodes[0]!, sessionsPerWeek: 3, teacherIds: [teacher], maxPerDay: 2 },
          { classroomId: cls.classroomId, curriculumNodeId: cls.nodes[1]!, sessionsPerWeek: 3, teacherIds: [teacher], maxPerDay: 2 },
        ],
      }),
    );
    const { result } = unwrap(await getAutogenRun(world.deps, world.ctx, { runId: run.run.id }));
    expect(result!.stats.placed).toBe(4);
    expect(result!.score.unplacedSessions).toBe(2);
    expect(result!.unplaced.reduce((n, u) => n + u.missing, 0)).toBe(2);
    expect(result!.unplaced[0]!.reasons[0]!.code).toBe("CLASS_OVERLOADED");
    expect(run.run.summary).toMatchObject({ sessions: 6, placed: 4, unplacedSessions: 2 });
    await expectErr(applyAutogenRun(world.deps, world.ctx, { runId: run.run.id }), "scheduling.autogen_confirmation_required");
    const ok = unwrap(await applyAutogenRun(world.deps, world.ctx, { runId: run.run.id, acceptUnplaced: true }));
    expect(ok).toMatchObject({ entriesCreated: 4, unplacedSessions: 2 });
  });

  it("grosse demande : mise en file, calculée par la tâche asynchrone ; abandon d'une proposition", async () => {
    const queued = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { mode: "ASYNC", seed: "async" })));
    expect(queued.executed).toBe(false);
    expect(queued.run.status).toBe("QUEUED");
    // Une demande en file ne s'applique pas.
    await expectErr(applyAutogenRun(w.deps, w.ctx, { runId: queued.run.id }), "scheduling.autogen_not_applicable");
    const report = unwrap(await processQueuedAutogenRuns(w.deps, w.ctx, { max: 5 }));
    expect(report.processed).toBeGreaterThanOrEqual(1);
    const done = unwrap(await getAutogenRun(w.deps, w.ctx, { runId: queued.run.id }));
    expect(done.run.status).toBe("COMPLETED");
    expect(done.run.startedAt).not.toBeNull();
    // Rejouer le calcul d'un run déjà pris ne fait rien.
    expect(unwrap(await executeAutogenRun(w.deps, w.ctx, queued.run.id))).toBeNull();

    const discarded = unwrap(await discardAutogenRun(w.deps, w.ctx, { runId: queued.run.id, reason: "Mauvais paramètres" }));
    expect(discarded.status).toBe("DISCARDED");
    await expectErr(applyAutogenRun(w.deps, w.ctx, { runId: queued.run.id }), "scheduling.autogen_not_applicable");
    const list = unwrap(await listAutogenRuns(w.deps, w.ctx, { status: "DISCARDED" }));
    expect(list.map((x) => x.id)).toContain(queued.run.id);
  });

  it("job du worker `scheduling.process-autogen-runs` : calcule les demandes en file de CHAQUE tenant, rejouable", async () => {
    const job = jobs.find((j) => j.name === "scheduling.process-autogen-runs")!;
    expect(job.perTenant).toBe(true);
    const jw = await createWorld({ db });
    unwrap(await updateSchedulingSettings(jw.deps, jw.ctx, { institutionId: jw.institutionId, patch: { openingStart: "08:00", openingEnd: "12:00", openingWeekdays: [1, 2, 3] } }));
    const t = addStaff(jw, "Prof Job");
    const cls = addClassWithNodes(jw, "Classe Job", 2);
    await addRoom(jw, "J1", 30);
    registerSchedulingPorts({ academic: jw.academic, people: jw.people });
    try {
      const queued = unwrap(
        await startAutogenRun(jw.deps, jw.ctx, {
          ...params(jw, { mode: "ASYNC", seed: "job" }),
          requirements: cls.nodes.map((n) => ({ classroomId: cls.classroomId, curriculumNodeId: n, sessionsPerWeek: 2, teacherIds: [t] })),
        }),
      );
      expect(queued.run.status).toBe("QUEUED");
      const run = () => (job as { handler: (c: unknown) => Promise<void> }).handler({ tenant: { id: jw.tenantId, slug: "t" }, tenantDb: db.tenantDb, logger: noopLogger, systemDb: db.systemDb, name: job.name, db: undefined });
      await run();
      const done = unwrap(await getAutogenRun(jw.deps, jw.ctx, { runId: queued.run.id }));
      expect(done.run.status).toBe("COMPLETED");
      expect(done.result!.stats.placed).toBe(4);
      await run(); // file vide : sans effet
      expect(unwrap(await getAutogenRun(jw.deps, jw.ctx, { runId: queued.run.id })).run.completedAt).toEqual(done.run.completedAt);
    } finally {
      resetSchedulingPorts();
    }
  });

  it("run en échec : l'erreur est enregistrée (jamais une exception) ; un run interrompu est repéré", async () => {
    const run = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { mode: "ASYNC", seed: "boom" })));
    // La classe disparaît entre la demande et le calcul.
    const saved = w.academic.classrooms.get(classes[0]!.classroomId)!;
    w.academic.classrooms.delete(classes[0]!.classroomId);
    unwrap(await processQueuedAutogenRuns(w.deps, w.ctx, { max: 10 }));
    w.academic.classrooms.set(saved.id, saved);
    const failed = unwrap(await getAutogenRun(w.deps, w.ctx, { runId: run.run.id })).run;
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("scheduling.not_found");
    expect(await outboxTypes(w)).toContain("scheduling.autogen_run.failed");

    // Interrompu : RUNNING depuis plus de 20 minutes (horloge figée de l'essai).
    const stuck = unwrap(await startAutogenRun(w.deps, w.ctx, params(w, { mode: "ASYNC", seed: "stuck" })));
    await db.admin.query("UPDATE scheduling.autogen_runs SET status = 'RUNNING', started_at = '2026-09-30T00:00:00Z' WHERE id = $1", [stuck.run.id]);
    const report = unwrap(await processQueuedAutogenRuns(w.deps, w.ctx, { max: 0 }));
    expect(report.interrupted).toBe(1);
    expect(unwrap(await getAutogenRun(w.deps, w.ctx, { runId: stuck.run.id })).run).toMatchObject({ status: "FAILED", errorCode: "scheduling.autogen_interrupted" });
  });

  it("validations immédiates : classe d'une autre année, enseignant parti, nœud inconnu, salle indisponible, séance trop longue", async () => {
    const base = params(w);
    const req = base.requirements[0]!;
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, requirements: [{ ...req, curriculumNodeId: newId() }] }), "scheduling.not_found");
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, requirements: [{ ...req, classroomId: newId() }] }), "scheduling.not_found");
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, academicYearId: newId() }), "VALIDATION_FAILED");
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, requirements: [{ ...req, sessionPeriods: 5 }] }), "VALIDATION_FAILED");
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, requirements: [{ ...req, roomId: newId() }] }), "VALIDATION_FAILED");
    const left = addStaff(w, "Parti", { status: "LEFT" });
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, requirements: [{ ...req, teacherIds: [left] }] }), "scheduling.staff_not_eligible");
    await expectErr(startAutogenRun(w.deps, w.ctx, { ...base, validTo: "2026-01-01" }), "VALIDATION_FAILED");
  });

  it("isolation A/B : un tenant ne voit, n'applique ni n'abandonne les propositions de l'autre", async () => {
    const a = await createWorld({ db });
    const b = await createWorld({ db });
    for (const world of [a, b]) unwrap(await updateSchedulingSettings(world.deps, world.ctx, { institutionId: world.institutionId, patch: { openingStart: "08:00", openingEnd: "12:00", openingWeekdays: [1, 2, 3] } }));
    const t = addStaff(a, "Prof A");
    const cls = addClassWithNodes(a, "Classe A", 1);
    await addRoom(a, "RA", 30);
    const run = unwrap(
      await startAutogenRun(a.deps, a.ctx, {
        ...params(a, { seed: "iso" }),
        requirements: [{ classroomId: cls.classroomId, curriculumNodeId: cls.nodes[0]!, sessionsPerWeek: 2, teacherIds: [t] }],
      }),
    );
    expect(unwrap(await listAutogenRuns(b.deps, b.ctx, {}))).toEqual([]);
    await expectErr(getAutogenRun(b.deps, b.ctx, { runId: run.run.id }), "scheduling.not_found");
    await expectErr(applyAutogenRun(b.deps, b.ctx, { runId: run.run.id }), "scheduling.not_found");
    await expectErr(discardAutogenRun(b.deps, b.ctx, { runId: run.run.id }), "scheduling.not_found");
    expect(unwrap(await executeAutogenRun(b.deps, b.ctx, run.run.id))).toBeNull();
    expect(unwrap(await processQueuedAutogenRuns(b.deps, b.ctx))).toEqual({ processed: 0, failed: 0, interrupted: 0 });
    // Lecture directe sous le contexte de B (RLS), sans passer par les cas d'usage.
    const rows = await b.db.tenantDb.run(b.ctx, async (tx) => tx.many("SELECT id FROM scheduling.autogen_runs"));
    expect(rows).toEqual([]);
    // Toujours intact chez A.
    expect(unwrap(await getAutogenRun(a.deps, a.ctx, { runId: run.run.id })).run.status).toBe("COMPLETED");
  });
});
