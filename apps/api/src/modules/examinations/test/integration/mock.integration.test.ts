/**
 * EXAMENS BLANCS : liés à `assess`, notes PUBLIÉES importées, moyenne et issue CALCULÉES PAR LA RÈGLE (jamais en dur), tracées par version
 * de règle et empreinte d'entrées (reproductible) ; jamais un résultat officiel, jamais un document officiel, jamais importés.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { issueDocument } from "../../application/issued-documents";
import { closeMockJury, getJury, openJury, saveJuryDecisions } from "../../application/jury";
import { computeMock, importFromAssess, linkAssessment, listLinks, unlinkAssessment } from "../../application/mock";
import { listResults } from "../../application/results";
import { getSessionDetail, transitionSession } from "../../application/sessions";
import { getStatistics } from "../../application/statistics";
import { describeIntegration } from "../support/db";
import { FAKE_RULE_VERSION_ID } from "../support/fake-rules";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env, type Pupil } from "../support/env";

describeIntegration("examinations : examens blancs", () => {
  let env: Env;
  let officialId: string;
  let mockId: string;
  let pupils: Pupil[];
  let classroomId: string;
  let assessmentId: string;
  const sessionPapers: Record<string, string> = {};

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    officialId = (await openSession(env, "CEPE-OFF")).id;
    const added = addPupils(env, 4);
    pupils = added.pupils;
    classroomId = added.classroomId;
    mockId = (await openSession(env, "CEPE-BLANC", { kind: "MOCK", mockOf: officialId })).id;
    for (const p of pupils) await registerPupil(env, env.ctxA(), mockId, p, { official: false });
    assessmentId = newId();
    env.world.assessments.set(assessmentId, {
      assessmentId, classroomId, typeCode: "EXAMEN_BLANC", scaleMax: "20", title: "Examen blanc EP1",
      grades: [
        { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId, score: "14" },
        { studentId: pupils[1]!.studentId, enrollmentId: pupils[1]!.enrollmentId, score: "7" },
        { studentId: pupils[2]!.studentId, enrollmentId: pupils[2]!.enrollmentId, score: null, entryStatus: "ABSENT_UNEXCUSED" },
        { studentId: pupils[3]!.studentId, enrollmentId: pupils[3]!.enrollmentId, score: null, entryStatus: "NOT_GRADED" },
      ],
    });
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), mockId));
    for (const p of detail.papers) sessionPapers[p.code] = p.id;
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("un lien ne concerne qu'un examen blanc, une évaluation de type « examen blanc », de la bonne classe et du même barème", async () => {
    const official = await linkAssessment(env.deps(), env.ctxA(), officialId, { paperId: sessionPapers.EP1!, classroomId, assessmentId });
    expect(official.ok).toBe(false);
    if (!official.ok) expect(official.error.code).toBe("examinations.mock_only");
    const normal = newId();
    env.world.assessments.set(normal, { assessmentId: normal, classroomId, typeCode: "DEVOIR", scaleMax: "20", grades: [] });
    const notMock = await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP1!, classroomId, assessmentId: normal });
    expect(notMock.ok).toBe(false);
    if (!notMock.ok) expect(notMock.error.code).toBe("examinations.assessment_not_mock");
    const wrongClass = await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP1!, classroomId: newId(), assessmentId });
    expect(wrongClass.ok).toBe(false);
    const scale = await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP3!, classroomId, assessmentId }); // EP3 est notée sur 10
    expect(scale.ok).toBe(false);
    if (!scale.ok) expect(scale.error.code).toBe("examinations.assessment_scale_mismatch");
    const link = unwrap(await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP1!, classroomId, assessmentId }));
    expect(link.paperCode).toBe("EP1");
    // une évaluation n'alimente qu'une épreuve
    const twice = await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP2!, classroomId, assessmentId });
    expect(twice.ok).toBe(false);
    // liaison puis déliaison
    const tmp = newId();
    env.world.assessments.set(tmp, { assessmentId: tmp, classroomId, typeCode: "EXAMEN_BLANC", scaleMax: "20", grades: [] });
    const l2 = unwrap(await linkAssessment(env.deps(), env.ctxA(), mockId, { paperId: sessionPapers.EP2!, classroomId, assessmentId: tmp }));
    unwrap(await unlinkAssessment(env.deps(), env.ctxA(), mockId, l2.id));
    expect(unwrap(await listLinks(env.deps(), env.ctxA(), mockId))).toHaveLength(1);
  });

  it("import des notes publiées : notes ASSESS, absence conservée comme absence (jamais zéro), « non noté » ignoré", async () => {
    const early = await importFromAssess(env.deps(), env.ctxA(), mockId);
    expect(early.ok).toBe(false); // session pas encore en cours
    unwrap(await transitionSession(env.deps(), env.ctxA(), mockId, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), mockId, "IN_PROGRESS"));
    const r = unwrap(await importFromAssess(env.deps(), env.ctxA(), mockId));
    expect(r).toMatchObject({ saved: 3, skipped: 1, noCandidate: 0, failed: [] });
    const rows = (await env.db.admin.query("SELECT status, score::text AS score, source, source_ref FROM examinations.paper_scores WHERE session_id = $1 ORDER BY paper_scores.score NULLS LAST, status", [mockId])).rows;
    expect(rows).toEqual([
      { status: "ENTERED", score: "7.00", source: "ASSESS", source_ref: assessmentId },
      { status: "ENTERED", score: "14.00", source: "ASSESS", source_ref: assessmentId },
      { status: "ABSENT", score: null, source: "ASSESS", source_ref: assessmentId },
    ]);
    const replay = unwrap(await importFromAssess(env.deps(), env.ctxA(), mockId));
    expect(replay).toMatchObject({ saved: 0, unchanged: 3 });
  });

  it("le calcul est fait PAR LA RÈGLE : issue, moyenne, rang ; résultat COMPUTED tracé (version de règle, empreinte), reproductible", async () => {
    const calls = env.rules.calls.length;
    const report = unwrap(await computeMock(env.deps(), env.ctxA(), mockId));
    expect(report).toMatchObject({ computed: 4, skippedPublished: 0, failed: [], ruleVersionId: FAKE_RULE_VERSION_ID, demoRules: true });
    expect(env.rules.calls.length).toBeGreaterThan(calls); // le calcul passe par la règle
    const rows = (await env.db.admin.query("SELECT c.candidate_seq, r.result_code, r.average::text AS average, r.rank, r.source, r.rule_version_ref, r.inputs_hash FROM examinations.candidate_results r JOIN examinations.candidates c ON c.id = r.candidate_id WHERE r.session_id = $1 ORDER BY c.candidate_seq", [mockId])).rows;
    expect(rows.map((r) => [r.result_code, r.average, r.rank, r.source])).toEqual([
      ["ADMITTED", "14.000", 1, "COMPUTED"],
      ["FAILED", "7.000", 2, "COMPUTED"],
      ["ABSENT", null, null, "COMPUTED"], // absent à l'épreuve : aucune moyenne (jamais 0)
      ["ABSENT", null, null, "COMPUTED"], // sans note : jamais 0 non plus
    ]);
    expect(rows.every((r) => r.rule_version_ref === FAKE_RULE_VERSION_ID && /^[0-9a-f]{64}$/.test(r.inputs_hash))).toBe(true);
    const hashes = rows.map((r) => r.inputs_hash);
    const again = unwrap(await computeMock(env.deps(), env.ctxA(), mockId));
    expect(again.computed).toBe(4);
    const rows2 = (await env.db.admin.query("SELECT r.inputs_hash FROM examinations.candidate_results r JOIN examinations.candidates c ON c.id = r.candidate_id WHERE r.session_id = $1 ORDER BY c.candidate_seq", [mockId])).rows;
    expect(rows2.map((r) => r.inputs_hash)).toEqual(hashes); // mêmes entrées, même version -> même empreinte
  });

  it("un seuil modifié dans la règle change l'issue SANS toucher au code (paramètre de la version)", async () => {
    const strict = await setupEnv({ rules: { params: { seuilAdmission: "15" } } });
    try {
      await seedPack(strict);
      const off = (await openSession(strict, "O")).id;
      const m = (await openSession(strict, "M", { kind: "MOCK", mockOf: off })).id;
      const { pupils: ps, classroomId: cl } = addPupils(strict, 1);
      await registerPupil(strict, strict.ctxA(), m, ps[0]!, { official: false });
      const a = newId();
      strict.world.assessments.set(a, { assessmentId: a, classroomId: cl, typeCode: "EXAMEN_BLANC", scaleMax: "20", grades: [{ studentId: ps[0]!.studentId, enrollmentId: ps[0]!.enrollmentId, score: "14" }] });
      const det = unwrap(await getSessionDetail(strict.deps(), strict.ctxA(), m));
      unwrap(await linkAssessment(strict.deps(), strict.ctxA(), m, { paperId: det.papers.find((p) => p.code === "EP1")!.id, classroomId: cl, assessmentId: a }));
      unwrap(await transitionSession(strict.deps(), strict.ctxA(), m, "REGISTRATION_CLOSED"));
      unwrap(await transitionSession(strict.deps(), strict.ctxA(), m, "IN_PROGRESS"));
      unwrap(await importFromAssess(strict.deps(), strict.ctxA(), m));
      unwrap(await computeMock(strict.deps(), strict.ctxA(), m));
      expect((await strict.db.admin.query("SELECT result_code FROM examinations.candidate_results WHERE session_id = $1", [m])).rows[0].result_code).toBe("FAILED");
    } finally {
      await strict.drop();
    }
  });

  it("le calcul est refusé pour un examen OFFICIEL ; un résultat ne se supprime jamais", async () => {
    const official = await computeMock(env.deps(), env.ctxA(), officialId);
    expect(official.ok).toBe(false);
    if (!official.ok) expect(official.error.code).toBe("examinations.mock_only");
    const cand = (await env.db.admin.query("SELECT id FROM examinations.candidates WHERE session_id = $1 LIMIT 1", [mockId])).rows[0].id as string;
    await expect(env.db.tenantDb.run(env.ctxA(), (tx) => tx.query("DELETE FROM examinations.candidate_results WHERE candidate_id = $1", [cand]))).rejects.toThrow(/permission|denied/);
  });

  it("jury d'un examen blanc : relit les résultats de la règle, tranche, motive les écarts, se clôt une fois tous les candidats tranchés ; ne touche jamais au résultat calculé", async () => {
    const ids = (await env.db.admin.query("SELECT id FROM examinations.candidates WHERE session_id = $1 ORDER BY candidate_seq", [mockId])).rows.map((r) => r.id as string);
    const codes = async () => (await env.db.admin.query("SELECT r.result_code FROM examinations.candidate_results r JOIN examinations.candidates c ON c.id = r.candidate_id WHERE r.session_id = $1 ORDER BY c.candidate_seq", [mockId])).rows.map((r) => r.result_code);
    const before = await codes();

    // jamais pour un examen officiel
    const official = await openJury(env.deps(), env.ctxA(), officialId, {});
    expect(official.ok).toBe(false);
    if (!official.ok) expect(official.error.code).toBe("examinations.jury_mock_only");

    expect(unwrap(await getJury(env.deps(), env.ctxA(), mockId))).toBeNull();
    const opened = unwrap(await openJury(env.deps(), env.ctxA(), mockId, { heldOn: "2026-10-20", note: "Jury de l'examen blanc de CEPE" }));
    expect(opened).toMatchObject({ status: "OPEN", heldOn: "2026-10-20", counts: { total: 4, decided: 0, changed: 0 } });
    expect(opened.rows.map((r) => r.proposedCode)).toEqual(["ADMITTED", "FAILED", "ABSENT", "ABSENT"]);
    expect(unwrap(await openJury(env.deps(), env.ctxA(), mockId, {})).id).toBe(opened.id); // idempotent

    // confirmer la proposition (sans justification) ; un écart sans justification suffisante est refusé ligne par ligne
    const first = unwrap(
      await saveJuryDecisions(env.deps(), env.ctxA(), mockId, {
        items: [
          { candidateId: ids[0]!, finalCode: "ADMITTED" },
          { candidateId: ids[1]!, finalCode: "ADMITTED", justification: "trop court" },
          { candidateId: ids[2]!, finalCode: "DEFERRED", justification: "Absence justifiée par certificat médical : à rattraper." },
        ],
      }),
    );
    expect(first.saved).toBe(2);
    expect(first.failed).toEqual([expect.objectContaining({ index: 1, candidateId: ids[1], code: "examinations.jury_justification_required" })]);

    // clôture refusée tant qu'il reste des candidats sans décision
    const early = await closeMockJury(env.deps(), env.ctxA(), mockId);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.code).toBe("examinations.jury_incomplete");

    unwrap(
      await saveJuryDecisions(env.deps(), env.ctxA(), mockId, {
        items: [
          { candidateId: ids[1]!, finalCode: "ADMITTED", justification: "Progrès nets en fin d'année, avis unanime du jury." },
          { candidateId: ids[3]!, finalCode: "DEFERRED", justification: "Sans note : épreuve de remplacement à organiser." },
        ],
      }),
    );
    const closed = unwrap(await closeMockJury(env.deps(), env.ctxA(), mockId));
    expect(closed).toMatchObject({ status: "CLOSED", counts: { total: 4, decided: 4, changed: 3 } });
    expect(closed.rows.find((r) => r.candidateId === ids[1])?.decision).toMatchObject({ finalCode: "ADMITTED", changedFromProposal: true });

    // figé : plus de décision, ni par l'API ni par la base
    const late = await saveJuryDecisions(env.deps(), env.ctxA(), mockId, { items: [{ candidateId: ids[0]!, finalCode: "FAILED", justification: "Correction tardive qui ne doit pas passer." }] });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("examinations.jury_closed");
    await expect(env.db.admin.query("UPDATE examinations.mock_jury_decisions SET final_code = 'FAILED', justification = repeat('x', 30) WHERE candidate_id = $1", [ids[0]])).rejects.toThrow(/jury_closed/);

    // le résultat calculé par la règle n'a pas bougé
    expect(await codes()).toEqual(before);
  });

  it("publier un examen blanc n'émet AUCUN événement de résultat officiel ; aucun document officiel n'en découle", async () => {
    unwrap(await transitionSession(env.deps(), env.ctxA(), mockId, "RESULTS_ENTERED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), mockId, "PUBLISHED"));
    const published = unwrap(await listResults(env.deps(), env.ctxA(), mockId, { status: "PUBLISHED", page: 1, pageSize: 20 }));
    expect(published.total).toBe(4);
    const events = (await env.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type IN ('examinations.result.published', 'examinations.session.results_published')", [env.tenantA])).rows;
    expect(events.map((e) => e.type)).toEqual(["examinations.session.results_published"]);
    expect(events[0].payload).toMatchObject({ sessionKind: "MOCK", publishedCount: 4 });
    const cand = (await env.db.admin.query("SELECT id FROM examinations.candidates WHERE session_id = $1 ORDER BY candidate_seq LIMIT 1", [mockId])).rows[0].id as string;
    for (const kind of ["CONVOCATION", "ATTESTATION_REUSSITE", "RELEVE_NOTES"] as const) {
      const r = await issueDocument(env.deps(), env.ctxA(), cand, kind);
      expect(r.ok, kind).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("examinations.mock_no_official_document");
    }
    expect(env.world.officialRequests).toHaveLength(0);
  });

  it("les statistiques comparent l'examen blanc à la session officielle de la même édition ; le taux vient de la règle", async () => {
    const stats = unwrap(await getStatistics(env.deps(), env.ctxA(), officialId, { groupBy: "ALL", compare: "mock" }));
    expect(stats.compare?.label).toContain("Examen blanc");
    expect(stats.compare?.total).toMatchObject({ registered: 4, admitted: 1, failed: 1, absent: 2, present: 2, rate: "50" });
    const own = unwrap(await getStatistics(env.deps(), env.ctxA(), mockId, { groupBy: "ALL" }));
    expect(own.demoRules).toBe(true);
  });
});
