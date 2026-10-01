import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { capitalizePeriod, listAcquiredUe, listDebts } from "../../application/ledger";
import { checkPrerequisites, getPrerequisites, setPrerequisites } from "../../application/prerequisites";
import { closeResitWindow, getResitWindow, listResitCandidates, listResitWindows, listStudentResits, openResitWindow } from "../../application/resit";
import type { ResitCandidateLine } from "../../application/ports";
import { adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, ueLine, type School, type TestStudent, type TestWorld } from "../support/world";

describeIntegration("prérequis entre UE et rattrapage (Postgres réel)", () => {
  let db: HigherTestDb;

  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 3, ues = 4) => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students, ues: Array.from({ length: ues }, (_, i) => ({ code: `UE${201 + i}`, credits: 6 })) });
    return { w, s };
  };
  const events = async (tenantId: string, type: string) => adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY occurred_at, id", [tenantId, type]);

  describe("prérequis (US2)", () => {
    it("AC2.1 : refuse l'auto-référence, un autre programme, un cycle ; accepte un graphe acyclique", async () => {
      const { w, s } = await fresh();
      const [u1, u2, u3, u4] = s.ues;
      const set = (ue: typeof u1, ...p: Array<typeof u1>) => setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: ue!.nodeId, prerequisites: p.map((x) => ({ prerequisiteNodeId: x!.nodeId })) });

      const self = await set(u1, u1);
      expect(!self.ok && self.error.code).toBe("higher.prerequisite_self");

      const otherProgram = newId();
      const foreign = { nodeId: newId(), code: "UEX", label: "Autre programme", credits: 3, programNodeId: otherProgram };
      w.ports.curriculum.addUe(foreign);
      const cross = await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: u1!.nodeId, prerequisites: [{ prerequisiteNodeId: foreign.nodeId }] });
      expect(!cross.ok && cross.error.code).toBe("higher.prerequisite_cross_program");

      const unknown = await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: u1!.nodeId, prerequisites: [{ prerequisiteNodeId: newId() }] });
      expect(!unknown.ok && unknown.error.code).toBe("higher.prerequisite_unknown_ue");

      // u2 -> u1, u3 -> u2, u4 -> u3 : chaîne acyclique ; fermer la boucle u1 -> u4 est refusé.
      unwrap(await set(u2, u1));
      unwrap(await set(u3, u2));
      unwrap(await set(u4, u3));
      const loop = await set(u1, u4);
      expect(!loop.ok && loop.error.code).toBe("higher.prerequisite_cycle");
      expect(!loop.ok && (loop.error as { details?: { cycle?: string[] } }).details?.cycle?.length).toBe(5); // u1 -> u4 -> u3 -> u2 -> u1
      const direct = await set(u1, u2);
      expect(!direct.ok && direct.error.code).toBe("higher.prerequisite_cycle");
      // La liste est REMPLACÉE : u3 n'exige plus que u1 (plus de chemin vers u2), puis u1 -> u3 redevient un cycle.
      unwrap(await set(u3, u1));
      expect((await getPrerequisites(w.deps, s.admin.ctx, u3!.nodeId)).ok).toBe(true);
      const again = await set(u1, u3);
      expect(!again.ok && again.error.code).toBe("higher.prerequisite_cycle");
      // Un prérequis en double dans la liste est refusé.
      const dup = await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: u4!.nodeId, prerequisites: [{ prerequisiteNodeId: u1!.nodeId }, { prerequisiteNodeId: u1!.nodeId }] });
      expect(dup.ok).toBe(false);
    });

    it("défense en profondeur : la base refuse un cycle même si l'application est contournée", async () => {
      const { w, s } = await fresh(1, 3);
      const [a, b, c] = s.ues;
      unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: b!.nodeId, prerequisites: [{ prerequisiteNodeId: a!.nodeId }] }));
      unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: c!.nodeId, prerequisites: [{ prerequisiteNodeId: b!.nodeId }] }));
      const insert = (ue: string, pre: string) => db.admin.query("INSERT INTO higher.ue_prerequisites (id, tenant_id, ue_node_id, prerequisite_node_id) VALUES ($1,$2,$3,$4)", [newId(), s.tenantId, ue, pre]);
      await expect(insert(a!.nodeId, c!.nodeId)).rejects.toMatchObject({ message: expect.stringContaining("higher.prerequisite_cycle") });
      await expect(insert(a!.nodeId, a!.nodeId)).rejects.toMatchObject({ code: "23514" }); // CHECK (ue <> prérequis)
      await insert(c!.nodeId, a!.nodeId); // chemin parallèle acyclique : accepté
    });

    it("AC2.2/AC2.3 : checkPrerequisites rend { satisfied, missing[] } depuis le registre (VALIDATED, ATTENDED, MIN_AVERAGE)", async () => {
      const { w, s } = await fresh(2, 4);
      const [u1, u2, u3, u4] = s.ues;
      const [a, b] = s.students;
      unwrap(await setPrerequisites(w.deps, s.admin.ctx, {
        ueNodeId: u4!.nodeId,
        prerequisites: [{ prerequisiteNodeId: u1!.nodeId }, { prerequisiteNodeId: u2!.nodeId, mode: "MIN_AVERAGE", minAverage: "12" }, { prerequisiteNodeId: u3!.nodeId, mode: "ATTENDED" }],
      }));
      expect(unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: a!.studentId, ueNodeId: u1!.nodeId }))).toEqual({ satisfied: true, missing: [] }); // aucune exigence

      const none = unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: a!.studentId, ueNodeId: u4!.nodeId }));
      expect(none.satisfied).toBe(false);
      expect(none.missing.map((m) => [m.prerequisiteNodeId, m.reason])).toEqual([[u1!.nodeId, "NOT_ACQUIRED"], [u2!.nodeId, "NOT_ACQUIRED"], [u3!.nodeId, "NOT_ATTENDED"]]);

      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, a!, u1!), ueLine(s, a!, u2!, { averageExact: "11.999" }), ueLine(s, b!, u1!), ueLine(s, b!, u2!, { averageExact: "12.000" })]);
      unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      w.ports.enrollments.markAttended(a!.studentId, u3!.nodeId);
      w.ports.enrollments.markAttended(b!.studentId, u3!.nodeId);

      const ca = unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: a!.studentId, ueNodeId: u4!.nodeId }));
      expect(ca.missing).toEqual([expect.objectContaining({ prerequisiteNodeId: u2!.nodeId, reason: "AVERAGE_TOO_LOW", minAverage: "12.000" })]); // 11.999 < 12, comparaison EXACTE
      const cb = unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: b!.studentId, ueNodeId: u4!.nodeId }));
      expect(cb).toEqual({ satisfied: true, missing: [] });
    });

    it("AC2.4 : modifier les prérequis avertit les inscrits qui ne les satisferaient plus, sans toucher leurs inscriptions", async () => {
      const { w, s } = await fresh(2, 3);
      const [u1, u2] = s.ues;
      const [a, b] = s.students;
      w.ports.enrollments.addRegistrant(u2!.nodeId, a!.studentId);
      w.ports.enrollments.addRegistrant(u2!.nodeId, b!.studentId);
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, b!, u1!)]);
      unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const r = unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: u2!.nodeId, prerequisites: [{ prerequisiteNodeId: u1!.nodeId }] }));
      expect(r.prerequisites).toHaveLength(1);
      expect(r.warnings).toEqual([{ studentId: a!.studentId, missing: [expect.objectContaining({ prerequisiteNodeId: u1!.nodeId, reason: "NOT_ACQUIRED" })] }]);
      expect(w.audit.actions()).toContain("higher.prerequisite.set");
      // Retirer tous les prérequis : liste vide, aucun avertissement.
      expect(unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: u2!.nodeId, prerequisites: [] }))).toEqual({ prerequisites: [], warnings: [] });
    });

    it("graphe de 50 UE sur 10 niveaux : validation sans cycle, puis refus du cycle de fermeture", async () => {
      const w = makeWorld(db);
      scriptRules(w);
      const s = await seedSchool(db, w, { students: 1, ues: Array.from({ length: 50 }, (_, i) => ({ code: `G${String(i).padStart(2, "0")}`, credits: 2 })) });
      const levels = Array.from({ length: 10 }, (_, l) => s.ues.slice(l * 5, l * 5 + 5));
      for (let l = 1; l < 10; l += 1) {
        for (const ue of levels[l]!) {
          const prereq = levels[l - 1]!.slice(0, 2).map((p) => ({ prerequisiteNodeId: p.nodeId }));
          unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: ue.nodeId, prerequisites: prereq }));
        }
      }
      const loop = await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: levels[0]![0]!.nodeId, prerequisites: [{ prerequisiteNodeId: levels[9]![4]!.nodeId }] });
      expect(!loop.ok && loop.error.code).toBe("higher.prerequisite_cycle");
    });
  });

  describe("rattrapage (US3)", () => {
    const candidates = (s: School, st: TestStudent[], ecuePerUe = 1): ResitCandidateLine[] =>
      st.flatMap((x, i) => s.ues.slice(0, 2).flatMap((ue, j) => Array.from({ length: ecuePerUe }, (_, k) => ({ enrollmentId: x.enrollmentId, studentId: x.studentId, ecueNodeId: newId(), ueNodeId: ue.nodeId, session1Average: `${7 + i + j + k}.5` }))));

    it("AC3.1/AC3.2 : candidats fournis par results, une inscription par candidat, déverrouillage de la seule session 2, événements", async () => {
      const { w, s } = await fresh(2, 3);
      const list = candidates(s, s.students);
      w.ports.credits.setResitCandidates(s.classroomId, s.periodId, { stateId: newId(), candidates: list });
      const before = w.ports.credits.calls;
      const found = unwrap(await listResitCandidates(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      expect(found.candidates).toHaveLength(4);
      expect(w.ports.credits.calls).toBe(before); // la liste vient du port results, jamais recalculée ici

      const opened = unwrap(await openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" }));
      expect(opened.window).toMatchObject({ status: "OPEN", opensOn: "2026-10-05", closesOn: "2026-10-19", resultsStateId: found.stateId });
      expect(opened.registrations).toHaveLength(4);
      expect(opened.registrations[0]).toMatchObject({ status: "REGISTERED", outcome: null });
      expect(w.ports.resitSession.opened).toHaveLength(1);
      expect(w.ports.resitSession.opened[0]).toMatchObject({ stateId: found.stateId, classroomId: s.classroomId, academicPeriodId: s.periodId });
      expect((await events(s.tenantId, "higher.resit.registered"))).toHaveLength(4);
      expect((await events(s.tenantId, "higher.resit.window_opened"))[0]!.payload).toMatchObject({ v: 1, windowId: opened.window.id, classroomId: s.classroomId, periodId: s.periodId });
      expect(w.audit.actions()).toContain("higher.resit_window.opened");
    });

    it("AC3.6 : une seule fenêtre ouverte par classe x période ; une ECUE n'est inscrite qu'une fois par période", async () => {
      const { w, s } = await fresh(1, 2);
      const list = candidates(s, s.students);
      w.ports.credits.setResitCandidates(s.classroomId, s.periodId, { stateId: newId(), candidates: list });
      const input = { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" };
      unwrap(await openResitWindow(w.deps, s.admin.ctx, input));
      const second = await openResitWindow(w.deps, s.admin.ctx, input);
      expect(!second.ok && second.error.code).toBe("higher.resit_window_open_exists");

      // Fenêtre fermée puis rouverte pour la même période : les ECUE déjà inscrites ne sont pas dupliquées.
      const win = unwrap(await listResitWindows(w.deps, s.admin.ctx, { classroomId: s.classroomId })).items[0]!;
      unwrap(await closeResitWindow(w.deps, s.admin.ctx, { windowId: win.id }));
      expect(w.ports.resitSession.closed).toHaveLength(1);
      const reopened = unwrap(await openResitWindow(w.deps, s.admin.ctx, input));
      expect(reopened.registrations).toHaveLength(0);
      expect(reopened.alreadyRegistered).toBe(list.length);
      expect((await adminRows(db, "SELECT 1 FROM higher.resit_registrations WHERE tenant_id = $1", [s.tenantId]))).toHaveLength(list.length);
      const closedAgain = await closeResitWindow(w.deps, s.admin.ctx, { windowId: win.id });
      expect(!closedAgain.ok && closedAgain.error.code).toBe("higher.resit_window_not_open");
    });

    it("fenêtre : dates cohérentes, aucune ECUE à repasser refusée, périmètre par ECUE", async () => {
      const { w, s } = await fresh(1, 2);
      const bad = await openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-19", closesOn: "2026-10-05" });
      expect(!bad.ok && bad.error.code).toBe("higher.resit_window_dates");
      const empty = await openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" });
      expect(!empty.ok && empty.error.code).toBe("higher.resit_no_candidates");
      expect(w.ports.resitSession.opened).toHaveLength(0);

      const list = candidates(s, s.students);
      w.ports.credits.setResitCandidates(s.classroomId, s.periodId, { stateId: newId(), candidates: list });
      const one = unwrap(await openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19", nodeIds: [list[0]!.ecueNodeId] }));
      expect(one.registrations.map((r) => r.ecueNodeId)).toEqual([list[0]!.ecueNodeId]);
      expect(one.window.nodeIds).toEqual([list[0]!.ecueNodeId]);
    });

    it("un échec du déverrouillage de la session 2 annule l'ouverture (aucune fenêtre fantôme)", async () => {
      const { w, s } = await fresh(1, 2);
      w.ports.credits.setResitCandidates(s.classroomId, s.periodId, { stateId: newId(), candidates: candidates(s, s.students) });
      w.ports.resitSession.failOnOpen = new Error("assess indisponible") as never;
      await expect(openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" })).rejects.toThrow("assess indisponible");
      expect(await adminRows(db, "SELECT 1 FROM higher.resit_windows WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM higher.resit_registrations WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
    });

    it("AC3.4/AC3.5 : bout en bout S1 clos -> fenêtre -> notes S2 -> reclôture : capitalisation session 2, dette, issue visible", async () => {
      const { w, s } = await fresh(2, 3);
      const [ok1, ko] = s.students;
      const [u1, u2, u3] = s.ues;
      // Clôture S1 (version 1) : ok1 a u1 ; u2 à repasser pour les deux ; ko : u1 à repasser aussi.
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
        ueLine(s, ok1!, u1!),
        ueLine(s, ok1!, u2!, { validated: false, ueState: "RESIT", sessionObtained: null, averageExact: "8.4" }),
        ueLine(s, ko!, u1!, { validated: false, ueState: "RESIT", sessionObtained: null, averageExact: "9.1" }),
        ueLine(s, ko!, u2!, { validated: false, ueState: "RESIT", sessionObtained: null, averageExact: "6.0" }),
        ueLine(s, ko!, u3!),
      ]);
      expect(unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }))).toMatchObject({ acquired: 2, debtsOpened: 0 });
      const list: ResitCandidateLine[] = [
        { enrollmentId: ok1!.enrollmentId, studentId: ok1!.studentId, ecueNodeId: newId(), ueNodeId: u2!.nodeId, session1Average: "8.4" },
        { enrollmentId: ko!.enrollmentId, studentId: ko!.studentId, ecueNodeId: newId(), ueNodeId: u1!.nodeId, session1Average: "9.1" },
        { enrollmentId: ko!.enrollmentId, studentId: ko!.studentId, ecueNodeId: newId(), ueNodeId: u2!.nodeId, session1Average: "6.0" },
      ];
      w.ports.credits.setResitCandidates(s.classroomId, s.periodId, { stateId: newId(), candidates: list });
      const win = unwrap(await openResitWindow(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" }));

      // L'étudiant voit ses ECUE à repasser et la fenêtre.
      const mine = unwrap(await listStudentResits(w.deps, s.admin.ctx, ko!.studentId));
      expect(mine).toHaveLength(2);
      expect(mine.every((r) => r.phase === "TO_RETAKE" && r.opensOn === "2026-10-05" && r.windowStatus === "OPEN")).toBe(true);

      // Notes de session 2 (circuit assess/results) puis reclôture : version 2. ok1 valide u2 en session 2 ; ko valide u1, reste en dette sur u2.
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
        ueLine(s, ok1!, u1!, { resultsVersion: 2 }),
        ueLine(s, ok1!, u2!, { resultsVersion: 2, via: "RESIT", sessionObtained: 2, averageExact: "10.2" }),
        ueLine(s, ko!, u1!, { resultsVersion: 2, via: "RESIT", sessionObtained: 2, averageExact: "10.0" }),
        ueLine(s, ko!, u2!, { resultsVersion: 2, validated: false, ueState: "DEBT", sessionObtained: null, averageExact: "5.5" }),
        ueLine(s, ko!, u3!, { resultsVersion: 2 }),
      ]);
      const report = unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      expect(report).toMatchObject({ acquired: 2, debtsOpened: 1, resitSettled: 3, revoked: 0 });
      const ledger = await adminRows(db, "SELECT acquired_via, session_obtained, average_exact::text FROM higher.credit_ledger WHERE tenant_id = $1 AND acquired_via = 'RESIT' ORDER BY average_exact", [s.tenantId]);
      expect(ledger).toEqual([{ acquired_via: "RESIT", session_obtained: 2, average_exact: "10.0" }, { acquired_via: "RESIT", session_obtained: 2, average_exact: "10.2" }]);

      expect(unwrap(await listDebts(w.deps, s.admin.ctx, ko!.studentId)).map((d) => d.ueNodeId)).toEqual([u2!.nodeId]);
      expect(unwrap(await listDebts(w.deps, s.admin.ctx, ok1!.studentId))).toHaveLength(0);
      expect(unwrap(await listAcquiredUe(w.deps, s.admin.ctx, ok1!.studentId)).map((e) => e.sessionObtained).sort()).toEqual([1, 2]);

      const after = unwrap(await listStudentResits(w.deps, s.admin.ctx, ko!.studentId));
      expect(after.map((r) => [r.ueNodeId === u1!.nodeId, r.phase]).sort()).toEqual([[false, "NOT_VALIDATED"], [true, "VALIDATED"]]);
      expect((await events(s.tenantId, "higher.ue.debt_detected")).map((e) => e.payload.ueNodeId)).toEqual([u2!.nodeId]);

      // Fermeture de la fenêtre.
      const closed = unwrap(await closeResitWindow(w.deps, s.admin.ctx, { windowId: win.window.id }));
      expect(closed.status).toBe("CLOSED");
      expect((await events(s.tenantId, "higher.resit.window_closed"))).toHaveLength(1);
      const detail = unwrap(await getResitWindow(w.deps, s.admin.ctx, win.window.id));
      expect(detail.registrations.every((r) => r.status === "GRADED")).toBe(true);
    });
  });
});
