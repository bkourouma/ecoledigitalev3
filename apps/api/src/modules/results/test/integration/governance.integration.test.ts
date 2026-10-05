/**
 * Surcharges justifiées (injectées dans le contexte, tracées, auditées, quatre yeux), décisions (proposition conservée,
 * justification), appréciations, recalcul COALESCÉ (40 publications ⇒ un calcul), lecture famille, isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { resultsIsolationAllowlistTables, resultsIsolationFixtures, resultsTenantTables } from "../../../isolation-allowlist.results";
import { computePeriod } from "../../application/compute";
import { approveOverride, confirmDecisionUseCase, listAppreciationsView, listDecisionsView, listOverridesView, rejectOverride, requestOverride, revokeOverrideUseCase, updateResultsSettings, writeAppreciation } from "../../application/governance";
import { closePeriod, lockPeriod } from "../../application/lifecycle";
import { processDueRecomputes, recomputeNow, requestRecompute } from "../../application/recompute";
import { explainResult, getEnrollmentResult, getPeriodView, listChildResults, listMyResults } from "../../application/reads";
import type { EnrollmentRef } from "../../domain/types";
import { adminOne, adminRows, createResultsTestDb, ctxFor, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("surcharges, décisions, recalcul coalescé, lecture famille, isolation (Postgres réel)", () => {
  let db: ResultsTestDb;
  let w: World;
  const classroomId = newId();
  const yearId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId, period: p, ues: [{ code: "UE1", ecues: [{ code: "E1", credits: "4" }, { code: "E2", credits: "4" }] }] });
  const id = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  const ref = { classroomId, academicPeriodId: p.id };
  let stateId: string;

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    w.curriculum.set(built.structure);
    students = Array.from({ length: 3 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const pair = (e: EnrollmentRef, node: string, dev: string, exam: string) => [grade(e.enrollmentId, id(node), dev), grade(e.enrollmentId, id(node), exam, { aggregationGroup: "EXAM" })];
    // a : tout validé ; b : E2 à 4 (éliminatoire < 5) bloque l'UE ; c : moyenne
    w.assess.grades = [...pair(students[0]!, "E1", "14", "14"), ...pair(students[0]!, "E2", "13", "13"), ...pair(students[1]!, "E1", "16", "16"), ...pair(students[1]!, "E2", "4", "4"), ...pair(students[2]!, "E1", "11", "11"), ...pair(students[2]!, "E2", "11", "11")];
    unwrap(await computePeriod(w.deps, w.director, ref));
    stateId = unwrap(await getPeriodView(w.deps, w.director, { ...ref, caps: CAPS_ALL })).state.id;
    w.names.staff.set(w.director.userId as string, newId());
  });
  afterAll(async () => {
    await db.drop();
  });

  const b = () => students[1]!;
  const lineOf = async (e: EnrollmentRef, level: string, node?: string) =>
    unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL })).lines.find((l) => l.level === level && (node === undefined || l.curriculumNodeId === id(node)))!;
  const headerOf = async (e: EnrollmentRef) => unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL })).header;

  describe("surcharges", () => {
    it("état initial : b a une ECUE éliminatoire qui bloque son UE (aucune compensation)", async () => {
      expect(await lineOf(b(), "ECUE", "E2")).toMatchObject({ value: "4", statusCode: "ELIMINATORY", validated: false });
      expect(await lineOf(b(), "UE", "UE1")).toMatchObject({ validated: false });
      expect((await headerOf(b())).validated).toBe(false);
    });

    it("exige le droit, une cible permise, une justification de 20 caractères, un nœud pour un niveau ECUE", async () => {
      const base = { stateId, enrollmentId: b().enrollmentId, level: "ECUE" as const, curriculumNodeId: id("E2"), ruleKey: "ecue_validee", kind: "VALIDATION" as const, flag: true, justification: "Le jury valide l'ECUE après examen de la copie." };
      expect(await requestOverride(w.deps, w.director, { ...base, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
      expect(await requestOverride(w.deps, w.director, { ...base, justification: "trop court", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.justification_required" } });
      expect(await requestOverride(w.deps, w.director, { ...base, ruleKey: "rang", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_not_allowed" } });
      expect(await requestOverride(w.deps, w.director, { ...base, curriculumNodeId: undefined, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_invalid" } });
      expect(await requestOverride(w.deps, w.director, { ...base, kind: "VALUE", flag: undefined, value: "x", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_not_allowed" } });
      expect(await requestOverride(w.deps, w.director, { ...base, enrollmentId: newId(), caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_invalid" } });
    });

    let overrideId: string;
    it("valide l'ECUE par le jury : demande (valeur d'origine conservée) → approbation par un tiers → rejouée par le recalcul, tracée, sans toucher aux notes", async () => {
      w.audit.clear();
      const req = unwrap(
        await requestOverride(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, level: "ECUE", curriculumNodeId: id("E2"), ruleKey: "ecue_validee", kind: "VALIDATION", flag: true, justification: "Le jury valide l'ECUE après examen de la copie.", caps: CAPS_ALL }),
      );
      overrideId = req.id;
      expect(req).toMatchObject({ status: "REQUESTED", originalValue: "false", overrideFlag: true, requestedBy: w.director.userId });
      // une seule surcharge active par cible
      expect(await requestOverride(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, level: "ECUE", curriculumNodeId: id("E2"), ruleKey: "ecue_validee", kind: "VALIDATION", flag: true, justification: "Une autre demande pour la même cible.", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_duplicate" } });
      // pas encore approuvée : aucun effet
      unwrap(await computePeriod(w.deps, w.director, ref));
      expect(await lineOf(b(), "UE", "UE1")).toMatchObject({ validated: false });

      // quatre yeux
      expect(await approveOverride(w.deps, w.director, { overrideId, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.four_eyes" } });
      expect(await approveOverride(w.deps, w.second, { overrideId, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
      const approved = unwrap(await approveOverride(w.deps, w.second, { overrideId, comment: "Conforme au procès-verbal du jury.", caps: CAPS_ALL }));
      expect(approved).toMatchObject({ status: "APPROVED", decidedBy: w.second.userId, fourEyesWaived: false });
      expect(w.audit.actions()).toEqual(["results.override.requested", "results.override.approved"]);
      expect(w.audit.entries.every((e) => e.severity === "warning")).toBe(true);

      // le recalcul rejoue l'effet : validation_manuelle lève l'élimination ; l'UE est validée (moyenne ≥ 10 : (16×4+4×4)/8 = 10)
      unwrap(await computePeriod(w.deps, w.director, ref));
      const e2 = await lineOf(b(), "ECUE", "E2");
      expect(e2).toMatchObject({ value: "4", validated: true, overridden: true, statusCode: "ELIMINATORY" }); // le statut reste « éliminatoire » (comme le legacy) ; la validation manuelle lève le verrou de l'UE
      expect(await lineOf(b(), "UE", "UE1")).toMatchObject({ validated: true, value: "10" });
      expect((await headerOf(b())).validated).toBe(true);
      // les notes publiées n'ont jamais bougé
      expect(w.assess.grades.find((g) => g.enrollmentId === b().enrollmentId && g.curriculumNodeId === id("E2") && g.aggregationGroup === "EXAM")?.score).toBe("4");
      // événement sans donnée de note
      const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'results.override.approved'");
      expect(ev[0]!.payload).toMatchObject({ v: 1, overrideId, enrollmentId: b().enrollmentId, stateId });
    });

    it("la trace marque l'étape surchargée : valeur d'origine et surcharge", async () => {
      const header = await headerOf(b());
      const ex = unwrap(await explainResult(w.deps, w.director, { resultId: header.id, caps: CAPS_ALL }));
      expect(ex.source).toBe("REPLAY"); // brouillon : expliqué par rejeu avec les données courantes
      const e2 = ex.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))!;
      const marks = (e2.trace as Array<{ ruleKey: string; overridden?: { overrideId: string; original: unknown } }>).filter((t) => t.overridden);
      expect(marks).toHaveLength(1);
      expect(marks[0]).toMatchObject({ ruleKey: "ecue_validee", overridden: { overrideId, original: null } });
    });

    it("révocation motivée : l'effet disparaît au recalcul suivant ; la surcharge reste consultable", async () => {
      expect(await revokeOverrideUseCase(w.deps, w.second, { overrideId, reason: "court", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.justification_required" } });
      const revoked = unwrap(await revokeOverrideUseCase(w.deps, w.second, { overrideId, reason: "Le jury a annulé sa décision lors de la séance suivante.", caps: CAPS_ALL }));
      expect(revoked).toMatchObject({ status: "REVOKED" });
      unwrap(await computePeriod(w.deps, w.director, ref));
      expect(await lineOf(b(), "UE", "UE1")).toMatchObject({ validated: false });
      expect((await lineOf(b(), "ECUE", "E2")).overridden).toBe(false);
      const all = unwrap(await listOverridesView(w.deps, w.director, { stateId, caps: CAPS_ALL }));
      expect(all.map((o) => o.status)).toEqual(["REVOKED"]);
      expect(await revokeOverrideUseCase(w.deps, w.second, { overrideId, reason: "Révocation déjà faite hier.", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.override_transition" } });
    });

    it("surcharge de VALEUR : la moyenne d'UE imposée alimente les étapes en aval (semestre, décision) ; rejet motivé ; contenu immuable", async () => {
      const c = students[2]!;
      const req = unwrap(await requestOverride(w.deps, w.director, { stateId, enrollmentId: c.enrollmentId, level: "UE", curriculumNodeId: id("UE1"), ruleKey: "moyenne_ue", kind: "VALUE", value: "14.5", justification: "Erreur matérielle sur la fiche de report des moyennes de l'UE.", caps: CAPS_ALL }));
      expect(req.originalValue).toBe("11");
      const rejected = unwrap(await rejectOverride(w.deps, w.second, { overrideId: req.id, comment: "Pièce justificative manquante.", caps: CAPS_ALL }));
      expect(rejected.status).toBe("REJECTED");
      // une seconde demande après rejet est possible
      const again = unwrap(await requestOverride(w.deps, w.director, { stateId, enrollmentId: c.enrollmentId, level: "UE", curriculumNodeId: id("UE1"), ruleKey: "moyenne_ue", kind: "VALUE", value: "14.5", justification: "Erreur matérielle corrigée, pièce justificative jointe cette fois.", caps: CAPS_ALL }));
      unwrap(await approveOverride(w.deps, w.second, { overrideId: again.id, caps: CAPS_ALL }));
      unwrap(await computePeriod(w.deps, w.director, ref));
      expect(await lineOf(c, "UE", "UE1")).toMatchObject({ value: "14.5", overridden: true });
      expect((await headerOf(c)).average).toBe("14.5");
      expect(await adminRows(db, "SELECT 1 FROM results.overrides")).toHaveLength(3);
      const attempt = await db.admin.query("UPDATE results.overrides SET override_value = 1 WHERE id = $1", [again.id]).then(() => "ok", (e: Error) => e.message);
      expect(attempt).toMatch(/results\.override_immutable/);
      expect(await db.admin.query("DELETE FROM results.overrides").then(() => "ok", (e: Error) => e.message)).toMatch(/results\.immutable/);
    });
  });

  describe("décisions", () => {
    it("la proposition de la règle est CONSERVÉE avec la décision finale ; une décision différente exige droit et justification (≥ 20) et un code permis", async () => {
      const ds = unwrap(await listDecisionsView(w.deps, w.director, { stateId, caps: CAPS_ALL }));
      const d = ds.find((x) => x.enrollmentId === b().enrollmentId)!;
      expect(d).toMatchObject({ kind: "SEMESTER_STATUS", status: "PROPOSED", proposedCode: "RESIT", proposedOutcome: "RESIT", finalCode: null });
      expect(await confirmDecisionUseCase(w.deps, w.director, { decisionId: d.id, finalCode: "ADMITTED", justification: "Le conseil admet l'étudiant au vu de son dossier global.", caps: { decisionRecord: true } })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
      expect(await confirmDecisionUseCase(w.deps, w.director, { decisionId: d.id, finalCode: "ADMITTED", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.justification_required" } });
      expect(await confirmDecisionUseCase(w.deps, w.director, { decisionId: d.id, finalCode: "ADMIS_PAR_LE_JURY", justification: "Un code qui n'existe pas dans le contrat de règles.", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.invalid_input" } });

      w.audit.clear();
      const done = unwrap(await confirmDecisionUseCase(w.deps, w.director, { decisionId: d.id, finalCode: "ADMITTED", justification: "Le conseil admet l'étudiant au vu de son dossier global.", caps: CAPS_ALL }));
      expect(done).toMatchObject({ status: "CONFIRMED", proposedCode: "RESIT", finalCode: "ADMITTED", finalOutcome: "ADMITTED", decidedBy: w.director.userId });
      expect(w.audit.entries[0]).toMatchObject({ action: "results.decision.confirmed", severity: "warning" });
      const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'results.decision.confirmed'");
      expect(ev[0]!.payload).toMatchObject({ v: 1, finalCode: "ADMITTED", outcome: "ADMITTED", changedFromProposal: true, enrollmentId: b().enrollmentId });
      // la proposition ne peut plus être altérée par la base
      const sql = await db.admin.query("UPDATE results.decisions SET proposed_code = 'ADMITTED' WHERE id = $1", [d.id]).then(() => "ok", (e: Error) => e.message);
      expect(sql).toMatch(/results\.decision_immutable/);
      // le recalcul ne l'écrase pas
      unwrap(await computePeriod(w.deps, w.director, ref));
      expect((unwrap(await listDecisionsView(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, caps: CAPS_ALL }))[0])).toMatchObject({ proposedCode: "RESIT", finalCode: "ADMITTED" });
    });

    it("sans modification, la confirmation de la proposition ne demande aucune justification", async () => {
      const a = unwrap(await listDecisionsView(w.deps, w.director, { stateId, enrollmentId: students[0]!.enrollmentId, caps: CAPS_ALL }))[0]!;
      const done = unwrap(await confirmDecisionUseCase(w.deps, w.director, { decisionId: a.id, caps: { decisionRecord: true } }));
      expect(done).toMatchObject({ status: "CONFIRMED", finalCode: a.proposedCode, justification: null });
    });
  });

  describe("appréciations et délibérations", () => {
    it("rédaction par l'enseignant (matière) ou le conseil, modifiable jusqu'à la clôture", async () => {
      const staffId = newId();
      const rec = unwrap(await writeAppreciation(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, curriculumNodeId: id("E1"), authorStaffId: staffId, authorRole: "TEACHER", body: "Bon trimestre.", caps: CAPS_ALL }));
      const upd = unwrap(await writeAppreciation(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, curriculumNodeId: id("E1"), authorStaffId: staffId, authorRole: "TEACHER", body: "Très bon trimestre.", caps: CAPS_ALL }));
      expect(upd.id).toBe(rec.id);
      expect(upd.body).toBe("Très bon trimestre.");
      expect(await writeAppreciation(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, authorStaffId: staffId, authorRole: "TEACHER", body: "x", caps: CAPS_ALL })).toMatchObject({ ok: false });
      expect(await writeAppreciation(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, authorStaffId: staffId, authorRole: "COUNCIL", body: "Encouragements.", caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
      expect(unwrap(await listAppreciationsView(w.deps, w.director, { stateId, enrollmentId: b().enrollmentId, caps: CAPS_ALL }))).toHaveLength(1);
    });
  });

  describe("recalcul coalescé (AC8.1)", () => {
    it("40 publications en rafale ⇒ UNE demande, temporisée depuis le DERNIER événement ; un seul calcul", async () => {
      const room = newId();
      const key = { classroomId: room, academicPeriodId: p.id };
      let last = null as unknown as { id: string; notBefore: Date };
      for (let i = 0; i < 40; i += 1) {
        w.clock.advance(100);
        last = unwrap(await requestRecompute(w.deps, w.director, { ...key, enrollmentIds: [students[i % 3]!.enrollmentId], cause: { event: "assess.grade.published", id: newId() } }));
      }
      const rows = await adminRows<{ id: string; status: string; not_before: Date; causes: unknown[]; scope_enrollments: string[] | null }>(db, "SELECT id, status, not_before, causes, scope_enrollments FROM results.recompute_requests WHERE classroom_id = $1", [room]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.causes.length).toBe(40);
      expect(rows[0]!.scope_enrollments).toHaveLength(3);
      expect(rows[0]!.not_before.getTime()).toBe(last.notBefore.getTime());
      // pas encore échue
      expect(unwrap(await processDueRecomputes(w.deps, w.director)).claimed).toBe(0);
    });

    it("échéance : le job exécute la demande (curriculum absent de cette classe ⇒ BLOQUÉE avec diagnostic), puis la file se vide", async () => {
      w.clock.advance(11_000);
      const report = unwrap(await processDueRecomputes(w.deps, w.director));
      expect(report.claimed).toBeGreaterThanOrEqual(1);
      const open = await adminRows(db, "SELECT 1 FROM results.recompute_requests WHERE status IN ('PENDING','RUNNING')");
      expect(open).toHaveLength(0);
    });

    it("recalcul manuel : droit requis ; la demande manuelle est servie sans doublon", async () => {
      expect(await recomputeNow(w.deps, w.director, { ...ref, caps: {} })).toMatchObject({ ok: false });
      const r = unwrap(await recomputeNow(w.deps, w.director, { ...ref, caps: CAPS_ALL })) as { report: { unchanged: number } };
      expect(r.report.unchanged).toBeGreaterThan(0);
      expect(await adminRows(db, "SELECT 1 FROM results.recompute_requests WHERE status = 'PENDING' AND classroom_id = $1", [classroomId])).toHaveLength(0);
    });
  });

  describe("lecture famille (élève, tuteur)", () => {
    it("Q-P18 : AVANT la clôture, la famille ne voit un rang provisoire QUE si la classe est libérée (port) ; jamais de moyenne, mention, décision ni ligne ; échec fermé", async () => {
      const pupilUser = newId();
      const tenantCtx = (u: string) => ctxFor(w.tenantId, u, ["eleve"], false);
      w.guardianship.studentByUser.set(pupilUser, students[0]!.studentId);
      // le brouillon calculé porte un rang (posé ici pour ne dépendre d'aucune règle du jeu d'essai) ; il est recalculé à la clôture
      await adminRows(db, `UPDATE results.period_results SET rank = 1, cohort_size = 3 WHERE status = 'DRAFT' AND student_id = $1`, [students[0]!.studentId]);
      const draft = await adminOne<{ n: number }>(db, `SELECT count(*)::int AS n FROM results.period_results WHERE status = 'DRAFT' AND scope = 'PERIOD' AND student_id = $1`, [students[0]!.studentId]);
      expect(draft.n).toBe(1);

      const released = new Set<string>();
      let failing = false;
      const withRelease = {
        ...w.deps,
        ports: Object.create(w.deps.ports, {
          familyRelease: {
            value: {
              async isReleased(_ctx: unknown, input: { classroomId: string; academicPeriodId: string }): Promise<boolean> {
                if (failing) throw new Error("port en panne");
                return released.has(`${input.classroomId}:${input.academicPeriodId}`);
              },
            },
          },
        }),
      } as typeof w.deps;

      // 1. port non branché : rien (échec fermé) ; 2. branché mais classe non libérée : rien
      expect(unwrap(await listMyResults(w.deps, tenantCtx(pupilUser)))).toEqual([]);
      expect(unwrap(await listMyResults(withRelease, tenantCtx(pupilUser)))).toEqual([]);

      // 3. libérée : un rang provisoire, rien d'autre
      released.add(`${classroomId}:${p.id}`);
      const provisional = unwrap(await listMyResults(withRelease, tenantCtx(pupilUser)));
      expect(provisional).toHaveLength(1);
      expect(provisional[0]).toMatchObject({ provisional: true, scope: "PERIOD", rank: 1, cohortSize: 3, average: null, averageDisplay: null, mentionCode: null, decisionCode: null, decisionOutcome: null, creditsAcquired: null, validated: null, finalizedAt: null, lines: [] });

      // 4. port en panne : échec fermé (aucun rang), jamais une erreur côté famille
      failing = true;
      expect(unwrap(await listMyResults(withRelease, tenantCtx(pupilUser)))).toEqual([]);
      failing = false;

      // 5. une autre classe libérée ne libère pas celle-ci
      released.clear();
      released.add(`${newId()}:${p.id}`);
      expect(unwrap(await listMyResults(withRelease, tenantCtx(pupilUser)))).toEqual([]);
    });

    it("rien avant la clôture ; après : résultats FINAL seulement, sans surcharge, trace ni entrée de calcul", async () => {
      const pupilUser = newId();
      const guardianUser = newId();
      const tenantCtx = (u: string) => ctxFor(w.tenantId, u, ["eleve"], false);
      w.guardianship.studentByUser.set(pupilUser, students[0]!.studentId);
      w.guardianship.links.add(`${guardianUser}|${students[0]!.studentId}`);
      expect(unwrap(await listMyResults(w.deps, tenantCtx(pupilUser)))).toEqual([]);

      // clôture (délibération non requise pour ce test)
      unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: false }));
      w.assess.pending = [];
      unwrap(await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
      unwrap(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));

      const mine = unwrap(await listMyResults(w.deps, tenantCtx(pupilUser)));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ scope: "PERIOD", version: expect.any(Number) });
      expect(mine[0]!.average).not.toBeNull();
      const text = JSON.stringify(mine);
      expect(text).not.toMatch(/inputs|trace|override|justification|inputsHash/i);

      const child = unwrap(await listChildResults(w.deps, tenantCtx(guardianUser), { studentId: students[0]!.studentId }));
      expect(child).toHaveLength(1);
      expect(await listChildResults(w.deps, tenantCtx(guardianUser), { studentId: students[1]!.studentId })).toMatchObject({ ok: false, error: { code: "results.not_visible" } });
      expect(await listMyResults(w.deps, tenantCtx(guardianUser))).toMatchObject({ ok: false });
    });
  });

  describe("isolation multi-tenant", () => {
    it("test d'isolation générique : structure + comportement de chaque table du schéma results, allowlist vide", async () => {
      const options = { pool: db.appPool, schemas: ["results"], allowlist: resultsIsolationAllowlistTables, fixtures: resultsIsolationFixtures as never };
      const report = await checkTenantIsolation(options);
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
      expect([...covered].sort()).toEqual([...resultsTenantTables].sort());
      await assertTenantIsolation(options);
    });

    it("RLS forcée partout ; le tenant B ne voit, ne modifie ni ne lit aucun résultat du tenant A", async () => {
      const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'results' AND table_type = 'BASE TABLE' ORDER BY 1");
      expect(tables.map((r) => r.t)).toEqual([...resultsTenantTables].sort());
      expect(await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'results' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")).toEqual([]);
      const other = await db.createTenant();
      const bCtx = ctxFor(other);
      for (const table of resultsTenantTables) {
        const rows = await db.tenantDb.run(bCtx, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [w.tenantId]));
        expect(rows, table).toHaveLength(0);
      }
      expect(await getEnrollmentResult(w.deps, bCtx, { enrollmentId: students[0]!.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.result_not_found" } });
      expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM results.period_results WHERE tenant_id = $1", [w.tenantId])).n)).toBeGreaterThan(0);
    });
  });
});
