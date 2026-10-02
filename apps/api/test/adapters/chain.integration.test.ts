/**
 * Chaîne ASSEMBLÉE de bout en bout, sur Postgres réel et avec les VRAIS adaptateurs (aucun port en mémoire entre modules) :
 *
 *   people (élèves, enseignant) + academic (année, périodes, curriculum, classe, inscriptions)
 *     -> assess (circuit de saisie, validation, publication)  [roster / périodes / curriculum / enseignement par adaptateurs]
 *     -> results (verrou, calcul par les VRAIES règles, clôture FINAL)  [structure de classe, effectif par adaptateurs]
 *     -> reportcards (bulletins : snapshot strict `reportcard/1`, signé)  [bundle de résultats, tutelle, nom de l'émetteur]
 *     -> higher (capitalisation des crédits, cycle, rattrapage)  [crédits FINAL, cycle, étudiants par adaptateurs]
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { reportcardSnapshotSchema } from "@ecoledigitale/contracts/src/v2/reportcards";
import { updateProgram } from "../../src/modules/academic";
import {
  createHigherDeps,
  createRulesAdapter,
  getCreditSummary,
  listAcquiredUe,
  onResultsPeriodClosed,
  type HigherDeps,
} from "../../src/modules/higher";
import {
  InMemoryStorage,
  StaticKeyProvider,
  createBatch,
  createReportcardsDeps,
  createSignatory,
  ensureBuiltinTemplates,
  generateSigningKeyPair,
  getReportCard,
  listReportCards,
  preflight,
  putBranding,
  putTemplateConfig,
  type ReportcardsDeps,
} from "../../src/modules/reportcards";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, bindCreditRules, closeSemester, createAssemblyWorld, ctxOf, publishAssessment, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

describeIntegration("chaîne assemblée : people + academic -> assess -> results -> reportcards / higher (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let closure: { state: { id: string; resultsVersion: number }; closureHash: string; resultsCount: number };

  beforeAll(async () => {
    w = await createAssemblyWorld();
    await bindCreditRules(w);
    school = await seedHigherSchool(w, { pupils: 3 });
    // Deux ECUE par UE ; un devoir et un examen chacune ; l'élève 3 est absent à l'examen de la première ECUE.
    const { ue1, ue2 } = school.seed;
    const grid: Array<[string, string[], Array<string | null>, Array<string | null>]> = [
      ["E11", [ue1.ecueIds[0]!], ["14", "12", "9"], ["15", "11", null]],
      ["E12", [ue1.ecueIds[1]!], ["10", "13", "8"], ["12", "14", "7"]],
      ["E21", [ue2.ecueIds[0]!], ["16", "9", "11"], ["13", "10", "12"]],
      ["E22", [ue2.ecueIds[1]!], ["8", "12", "10"], ["9", "15", "11"]],
    ];
    for (const [, nodes, devoir, examen] of grid) {
      await publishAssessment(w, school, { typeCode: "DEVOIR", nodeId: nodes[0]!, scores: devoir });
      await publishAssessment(w, school, { typeCode: "EXAMEN", nodeId: nodes[0]!, scores: examen });
    }
    closure = (await closeSemester(w, school)) as unknown as typeof closure;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("academic -> results : la structure de calcul vient des DONNÉES du curriculum (contrat, rang de période, crédits, parents)", async () => {
    const s = await w.ports.results.curriculum!.getStructure(w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId });
    expect(s).toMatchObject({ contractId: "credit-semester@1", levelCode: "L1", terminalExamRequired: false, firstPeriodId: null });
    expect(s!.period).toMatchObject({ rankInYear: 1, countInYear: 2, isSecondSemester: false });
    expect(s!.nodes.map((n) => [n.code, n.kind, n.credits])).toEqual([
      ["UE1", "UE", "6"],
      ["E11", "ECUE", "3"],
      ["E12", "ECUE", "3"],
      ["UE2", "UE", "6"],
      ["E21", "ECUE", "4"],
      ["E22", "ECUE", "2"],
    ]);
    const ue1 = s!.nodes.find((n) => n.code === "UE1")!;
    expect(s!.nodes.filter((n) => n.parentId === ue1.id).map((n) => n.code)).toEqual(["E11", "E12"]);
    const roster = await w.ports.results.roster!.listEnrollments(w.director, school.ref.classroomId);
    expect(roster.map((r) => r.enrollmentId).sort()).toEqual(school.pupils.map((p) => p.enrollmentId).sort());
    expect(roster.every((r) => r.active)).toBe(true);
  });

  it("assess -> results : la période est CLOSE, tous les résultats sont FINAL (calcul réel sur les notes publiées)", async () => {
    expect(closure.resultsCount).toBe(3);
    const headers = await adminRows<{ status: string; contract_id: string }>(w, "SELECT status, contract_id FROM results.period_results WHERE tenant_id = $1 AND scope = 'PERIOD' AND academic_period_id = $2", [w.tenantId, school.ref.academicPeriodId]);
    const final = headers.filter((h) => h.status === "FINAL");
    expect(final).toHaveLength(3);
    // les versions antérieures (brouillons des recalculs) sont remplacées, jamais laissées « courantes »
    expect(headers.filter((h) => h.status !== "FINAL").every((h) => h.status === "SUPERSEDED" || h.status === "DRAFT")).toBe(true);
    expect(new Set(final.map((h) => h.contract_id))).toEqual(new Set(["credit-semester@1"]));
  });

  it("results -> reportcards : état de période, effectif et bundle de résultats prêts à figer (noms réels, libellés, règles, trace)", async () => {
    const port = w.ports.reportcards.results!;
    const state = await port.getPeriodState(w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId });
    expect(state).toMatchObject({ status: "CLOSED", pack: "HIGHER", resultsVersion: 1, deliberationHeld: false, institutionId: w.academic.institutionId });
    expect(state!.closureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state!.closureHash).not.toBe("0".repeat(64));

    const roster = await port.listRoster(w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId });
    expect(roster.map((r) => r.outcome)).toEqual(["FINAL", "FINAL", "FINAL"]);

    const p = school.pupils[0]!;
    const bundle = (await port.getFinalBundle(w.director, { enrollmentId: p.enrollmentId, academicPeriodId: school.ref.academicPeriodId }))!;
    expect(bundle.student).toMatchObject({ id: p.studentId, lastName: p.lastName, firstNames: "Prenom1", birthPlace: "Abidjan", repeating: false });
    expect(bundle.enrollment).toMatchObject({ id: p.enrollmentId, classroomLabel: "Licence 1 A", levelLabel: "Licence 1", programLabel: "Informatique", classSize: 3 });
    expect(bundle.lines.filter((l) => l.level === "UE").map((l) => l.code)).toEqual(["UE1", "UE2"]);
    expect(bundle.lines.filter((l) => l.level === "ECUE").map((l) => [l.code, l.parentCode])).toEqual([["E11", "UE1"], ["E12", "UE1"], ["E21", "UE2"], ["E22", "UE2"]]);
    const ue1 = bundle.lines.find((l) => l.code === "UE1")!;
    expect(ue1).toMatchObject({ level: "UE", credits: "6", label: "UE UE1" });
    expect(ue1.exact).toMatch(/^\d+(\.\d{1,6})?$/);
    expect(bundle.summary.averageExact).toMatch(/^\d+(\.\d{1,6})?$/);
    expect(bundle.summary.creditsRequired).toBe("12");
    expect(bundle.rules).toMatchObject({ contractId: "credit-semester@1", resultsStateId: state!.stateId, resultsVersion: 1, closureHash: state!.closureHash });
    expect(Object.keys(bundle.labels).length).toBeGreaterThan(0);
    expect(bundle.explain.length).toBeGreaterThan(0);
    expect(bundle.attendance).toBeNull(); // le récapitulatif d'assiduité est lu à part (port AttendanceSummary)

    // Sans résultat FINAL : pas de bundle.
    expect(await port.getFinalBundle(w.director, { enrollmentId: newId(), academicPeriodId: school.ref.academicPeriodId })).toBeNull();
  });

  describe("reportcards : émission d'un lot avec les ports réels (snapshot strict, signé)", () => {
    let rc: ReportcardsDeps;
    let batchCards: Array<{ id: string; studentId: string }>;

    beforeAll(async () => {
      rc = createReportcardsDeps({
        db: w.tenantDb,
        systemDb: w.systemDb,
        clock: w.clock,
        keys: new StaticKeyProvider(generateSigningKeyPair().privateKey, "assembly-key-2026"),
        ports: { ...w.ports.reportcards, storage: new InMemoryStorage(w.clock) },
        config: { verificationBaseUrl: "https://verif.example.test" },
      });
      unwrap(await ensureBuiltinTemplates(rc));
      unwrap(await putBranding(rc, w.director, { legalName: "Établissement de démonstration", headerLeft: ["Ministère exemple"], address: "1 rue de l'Exemple", primaryColor: "#14532D" }));
      const signatory = unwrap(await createSignatory(rc, w.director, { fullName: "Personne Fictive Une", title: "Directeur", jobFunction: "Direction des études" }));
      unwrap(await putTemplateConfig(rc, w.director, { documentKind: "REPORT_CARD", pack: "HIGHER", templateKey: "higher-bulletin-credits", options: {}, signatureAssignments: [{ slot: "director-studies", signatoryId: signatory.id }] }));
    });

    it("le contrôle préalable est vert : période close, identité, gabarit, signataire", async () => {
      const view = unwrap(await preflight(rc, w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId }));
      expect(view.issues.filter((i) => i.blocking)).toEqual([]);
      expect(view.enrollments).toEqual({ total: 3, eligible: 3, excluded: 0 });
    });

    it("le lot émet un bulletin par inscription : le snapshot produit par l'adaptateur respecte le contrat `reportcard/1`", async () => {
      const batch = unwrap(await createBatch(rc, w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, idempotencyKey: "lot-asm-1" }));
      expect(batch.batch).toMatchObject({ total: 3, issued: 3, excluded: 0, failed: 0 });
      const page = unwrap(await listReportCards(rc, w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, limit: 50 }));
      batchCards = page.items.map((c) => ({ id: c.card.id, studentId: c.card.studentId }));
      expect(batchCards).toHaveLength(3);
      const detail = unwrap(await getReportCard(rc, w.director, batchCards[0]!.id));
      const parsed = reportcardSnapshotSchema.safeParse(detail.snapshot);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      const events = await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.snapshot.created'", [w.tenantId]);
      expect(Number(events[0]!.n)).toBe(3);
    });
  });

  describe("results -> higher : capitalisation des crédits, cycle et dettes (UE identifiées par lignée)", () => {
    let hd: HigherDeps;

    beforeAll(() => {
      hd = createHigherDeps({
        db: w.tenantDb,
        clock: w.clock,
        portsProvider: () => ({ ...w.ports.higher, rules: createRulesAdapter(() => w.kit.rules) }),
      });
    });

    it("le programme devient un cycle : `higher` le voit (isCycle) et liste ses UE par lignée stable", async () => {
      unwrap(await updateProgram(w.academic.deps, w.director, school.seed.programId, { isCycle: true }));
      const node = await hd.ports.curriculum.getNode(w.director, school.seed.programId);
      expect(node).toMatchObject({ nodeId: school.seed.programId, code: "INFO", isCycle: true, isProgram: true });
      const ues = await hd.ports.curriculum.listCycleUe(w.director, school.seed.programId);
      expect(ues.map((u) => [u.code, u.credits, u.nodeId, u.programNodeId])).toEqual([
        ["UE1", 6, school.seed.ue1.lineageId, school.seed.programId],
        ["UE2", 6, school.seed.ue2.lineageId, school.seed.programId],
      ]);
      expect((await hd.ports.curriculum.getUe(w.director, school.seed.ue1.lineageId))?.code).toBe("UE1");
      expect(await hd.ports.curriculum.getUe(w.director, newId())).toBeNull();
    });

    it("la clôture capitalise les UE validées dans le registre de crédits, par lignée (rejeu : aucun doublon)", async () => {
      const payload = { v: 1, classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, stateId: closure.state.id, resultsVersion: closure.state.resultsVersion };
      const report = unwrap(await onResultsPeriodClosed(hd, w.director, payload));
      expect(report).toBeDefined();
      const lines = await hd.ports.credits.listFinalUeLines(w.director, { classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId });
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines.map((l) => l.ueNodeId))).toEqual(new Set([school.seed.ue1.lineageId, school.seed.ue2.lineageId]));
      for (const l of lines) {
        expect(l).toMatchObject({ academicYearId: school.seed.yearId, academicPeriodId: school.ref.academicPeriodId, resultsVersion: 1, credits: 6 });
        expect(["VALIDATED", "RESIT", "DEBT"]).toContain(l.ueState);
      }
      const validated = lines.filter((l) => l.validated);
      for (const l of validated) {
        const acquired = unwrap(await listAcquiredUe(hd, w.director, l.studentId));
        expect(acquired.some((e) => e.ueNodeId === l.ueNodeId && e.credits === 6)).toBe(true);
      }
      const again = unwrap(await onResultsPeriodClosed(hd, w.director, payload));
      expect(again).toBeDefined();
      const ledger = await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED'", [w.tenantId]);
      expect(Number(ledger[0]!.n)).toBe(validated.length);
      const summary = unwrap(await getCreditSummary(hd, w.director, school.pupils[0]!.studentId));
      expect(summary.studentId).toBe(school.pupils[0]!.studentId);
    });

    it("cycle incomplet : un seul semestre FINAL sur deux => `complete: false` (mention en attente)", async () => {
      const r = await hd.ports.cycleResults.getCycleResults(w.director, { studentId: school.pupils[0]!.studentId, nodeId: school.seed.programId });
      expect(r.complete).toBe(false);
      expect(r.semesters).toHaveLength(1);
      expect(r.semesters[0]).toMatchObject({ academicPeriodId: school.ref.academicPeriodId, academicYearId: school.seed.yearId });
      expect(r.semesters[0]!.average).toMatch(/^\d+(\.\d+)?$/);
    });

    it("inscriptions du cycle et dernière inscription de l'étudiant (année du diplôme)", async () => {
      const cycle = await hd.ports.enrollments.listCycleEnrollments(w.director, school.seed.programId);
      expect(cycle.map((e) => e.studentId).sort()).toEqual(school.pupils.map((p) => p.studentId).sort());
      const last = await hd.ports.enrollments.getLastEnrollment(w.director, { studentId: school.pupils[0]!.studentId, nodeId: school.seed.programId });
      expect(last).toMatchObject({ enrollmentId: school.pupils[0]!.enrollmentId, academicYearId: school.seed.yearId });
      expect(last!.academicYearLabel).toBeTruthy();
      const identity = await hd.ports.students.getIdentity(w.director, school.pupils[0]!.studentId);
      expect(identity).toMatchObject({ studentId: school.pupils[0]!.studentId, birthPlace: "Abidjan" });
      expect(identity!.fullName).toContain("ETUDIANT1");
    });

    it("session 2 : `higher` rouvre la SEULE session de rattrapage de la période close, puis la referme (version n+1)", async () => {
      await hd.ports.resitSession.openResitSession(w.director, { stateId: closure.state.id, classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, nodeIds: [] });
      const reopened = await adminRows<{ status: string; last_reopen_kind: string }>(w, "SELECT status, last_reopen_kind FROM results.period_states WHERE id = $1", [closure.state.id]);
      expect(reopened[0]).toMatchObject({ status: "OPEN", last_reopen_kind: "RESIT_SESSION" });
      // rejeu : déjà ouverte, rien à faire
      await hd.ports.resitSession.openResitSession(w.director, { stateId: closure.state.id, classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, nodeIds: [] });
      await hd.ports.resitSession.closeResitSession(w.director, { stateId: closure.state.id, classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId });
      const closed = await adminRows<{ status: string; results_version: number }>(w, "SELECT status, results_version FROM results.period_states WHERE id = $1", [closure.state.id]);
      expect(closed[0]).toMatchObject({ status: "CLOSED", results_version: 2 });
    });
  });

  it("tutelle et comptes : un compte n'a aucun droit « élève » ni « tuteur » sans fiche liée (échec fermé)", async () => {
    const stranger = ctxOf(w, newId(), ["parent"], false);
    const g = w.ports.results.guardianship!;
    expect(await g.studentIdForUser(stranger, stranger.userId!)).toBeNull();
    expect(await g.isGuardianOf(stranger, stranger.userId!, school.pupils[0]!.studentId)).toBe(false);
    // L'enseignant lié à sa fiche de personnel : résolu par la liaison explicite, jamais par e-mail.
    expect(await w.ports.results.names!.staffIdForUser(school.teacher.ctx, school.teacher.ctx.userId!)).toBe(school.teacher.staffId);
    expect(await w.ports.results.names!.nameOf(school.teacher.ctx, school.teacher.ctx.userId!)).toContain("ENSEIGNANT");
    expect(await w.ports.results.names!.nameOf(stranger, stranger.userId!)).toBe("Utilisateur");
  });
});
