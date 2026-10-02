/**
 * Parcours officiel complet sur base réelle : de la classe de CM2 à l'attestation et à l'export, SANS Excel, avec les données FICTIVES
 * du CEPE (pack primaire) et les règles FICTIVES de test. Vérifie aussi que rien ne se calcule pour un examen OFFICIEL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { actOnPiece, listPieces } from "../../application/pieces";
import { createFromClassroom, getCandidateDetail, listCandidates, registerBatch } from "../../application/candidates";
import { evaluateAll } from "../../application/eligibility";
import { assignCandidate, autoAssign, getAssignmentsOverview, setSessionCenters } from "../../application/assignments";
import { createCenter, createRoom, instantiatePack, listExamTypes } from "../../application/reference";
import { bulkSaveScores } from "../../application/scores";
import { getSessionDetail, transitionSession } from "../../application/sessions";
import { saveResults, listResults } from "../../application/results";
import { issueBatch, issueDocument } from "../../application/issued-documents";
import { getStatistics } from "../../application/statistics";
import { listExportFormats } from "../../application/formats";
import { getExportDownload, runExport } from "../../application/exports";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, seedPack, setupEnv, type Env } from "../support/env";
import { newId } from "@ecoledigitale/kernel";

describeIntegration("examinations : parcours officiel (CEPE fictif)", () => {
  let env: Env;
  let sessionId: string;
  let classroomId: string;
  const pupilsCount = 6;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    classroomId = addPupils(env, pupilsCount).classroomId;
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("instancie le modèle de pack de façon idempotente : type CEPE FICTIF, 3 épreuves fictives, formats fictifs", async () => {
    const again = unwrap(await instantiatePack(env.deps(), env.ctxA(), "PRIMARY"));
    expect(again.createdTypes).toEqual([]);
    expect(again.existingTypes).toEqual(["CEPE"]);
    const types = unwrap(await listExamTypes(env.deps(), env.ctxA()));
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ code: "CEPE", placeholder: true, sourceKind: "placeholder", gradeLevelCode: "CM2" });
    const papers = await env.db.admin.query("SELECT code, source_kind FROM examinations.exam_papers WHERE tenant_id = $1 ORDER BY ordinal", [env.tenantA]);
    expect(papers.rows).toEqual([
      { code: "EP1", source_kind: "placeholder" },
      { code: "EP2", source_kind: "placeholder" },
      { code: "EP3", source_kind: "placeholder" },
    ]);
    const formats = unwrap(await listExportFormats(env.deps(), env.ctxA(), { status: "PUBLISHED" }));
    expect(formats.map((f) => f.code).sort()).toEqual(["LISTE_CANDIDATS_FICTIF", "RESULTATS_FICTIF"]);
    expect(formats.every((f) => f.placeholder)).toBe(true);
  });

  it("ouvre une session : définition copiée puis figée, règle épinglée, bandeau de démonstration", async () => {
    const s = await openSession(env, "CEPE-2027", { startsOn: "2027-06-10" });
    sessionId = s.id;
    expect(s.status).toBe("REGISTRATION_OPEN");
    expect(s.demoRules).toBe(true);
    expect(s.ruleVersionRef).not.toBeNull();
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), sessionId));
    expect(detail.papers.map((p) => p.code)).toEqual(["EP1", "EP2", "EP3"]);
    expect(detail.definitionLockedAt).not.toBeNull();
    expect(detail.progress.allowedNext).toEqual(["REGISTRATION_CLOSED"]);
  });

  it("sélectionne la classe de CM2, évalue l'éligibilité par la règle : pièces manquantes -> NEEDS_REVIEW", async () => {
    const report = unwrap(await createFromClassroom(env.deps(), env.ctxA(), sessionId, { classroomId }));
    expect(report).toMatchObject({ created: pupilsCount, failed: [] });
    // rejouer : tout est déjà candidat
    const again = unwrap(await createFromClassroom(env.deps(), env.ctxA(), sessionId, { classroomId }));
    expect(again.created).toBe(0);
    expect(again.skipped).toHaveLength(pupilsCount);
    const evaluated = unwrap(await evaluateAll(env.deps(), env.ctxA(), sessionId));
    expect(evaluated.byResult).toEqual({ NEEDS_REVIEW: pupilsCount });
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    expect(list.total).toBe(pupilsCount);
    expect(list.items.every((c) => c.eligibilityStatus === "NEEDS_REVIEW" && c.missingPieces.length === 1 && c.displayName)).toBe(true);
  });

  it("refuse l'inscription tant que la pièce n'est pas acceptée, puis inscrit : numéros sans trou", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const first = list.items[0]!;
    const refused = await registerBatch(env.deps(), env.ctxA(), [first.id]);
    expect(unwrap(refused).failed[0]?.code).toBe("examinations.not_eligible");
    for (const c of list.items) {
      const pieces = unwrap(await listPieces(env.deps(), env.ctxA(), c.id));
      const req = pieces.pieces[0]!;
      const documentId = newId();
      env.world.pieces.set(documentId, c.studentId);
      unwrap(await actOnPiece(env.deps(), env.ctxA(), c.id, req.requirementId, { action: "SUBMIT", documentRef: documentId }));
      unwrap(await actOnPiece(env.deps(), env.ctxA(), c.id, req.requirementId, { action: "ACCEPT" }));
    }
    const reevaluated = unwrap(await evaluateAll(env.deps(), env.ctxA(), sessionId));
    expect(reevaluated.byResult).toEqual({ ELIGIBLE: pupilsCount });
    const batch = unwrap(await registerBatch(env.deps(), env.ctxA(), list.items.map((c) => c.id)));
    expect(batch.failed).toEqual([]);
    expect(batch.registered).toHaveLength(pupilsCount);
    const numbers = batch.registered.map((r) => r.candidateNumber).sort();
    expect(numbers).toEqual(["CEPE2027-00001", "CEPE2027-00002", "CEPE2027-00003", "CEPE2027-00004", "CEPE2027-00005", "CEPE2027-00006"]);
    const detail = unwrap(await getCandidateDetail(env.deps(), env.ctxA(), first.id));
    expect(detail.candidate).toMatchObject({ registrationStatus: "REGISTERED", lastName: expect.stringMatching(/^ELEVE/), birthDate: "2016-05-05" });
    expect(detail.history.map((h) => h.kind)).toEqual(expect.arrayContaining(["CREATED", "ELIGIBILITY", "STATUS"]));
  });

  it("répartit : centre, salles, répartition automatique tout ou rien, place manuelle", async () => {
    const center = unwrap(await createCenter(env.deps(), env.ctxA(), { code: "C1", name: "Centre propre (fictif)", kind: "OWN" }));
    unwrap(await createRoom(env.deps(), env.ctxA(), center.id, { code: "S1", capacity: 2 }));
    unwrap(await setSessionCenters(env.deps(), env.ctxA(), sessionId, [center.id]));
    const tooSmall = await autoAssign(env.deps(), env.ctxA(), sessionId, { reassign: false });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.error.code).toBe("examinations.no_capacity");
    const overviewBefore = unwrap(await getAssignmentsOverview(env.deps(), env.ctxA(), sessionId));
    expect(overviewBefore.assignments).toHaveLength(0); // tout ou rien
    const rooms = unwrap(await createRoom(env.deps(), env.ctxA(), center.id, { code: "S2", capacity: 4 }));
    expect(rooms.capacity).toBe(4);
    const report = unwrap(await autoAssign(env.deps(), env.ctxA(), sessionId, { reassign: false }));
    expect(report.assigned).toBe(pupilsCount);
    const overview = unwrap(await getAssignmentsOverview(env.deps(), env.ctxA(), sessionId));
    expect(overview.unassigned).toBe(0);
    expect(overview.assignments.map((a) => `${a.roomCode}-${a.seatNumber}`)).toEqual(["S1-1", "S1-2", "S2-1", "S2-2", "S2-3", "S2-4"]);
    // un candidat ne peut pas prendre la place d'un autre
    const [a, b] = overview.assignments;
    const clash = await assignCandidate(env.deps(), env.ctxA(), b!.candidateId, { centerId: a!.centerId, roomId: a!.roomId, seatNumber: a!.seatNumber });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe("examinations.seat_taken");
  });

  it("émet les convocations en lot (scellées par le port), puis démarre la session : répartition figée", async () => {
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "REGISTRATION_CLOSED"));
    const batch = unwrap(await issueBatch(env.deps(), env.ctxA(), sessionId, { kind: "CONVOCATION" }));
    expect(batch.issued).toBe(pupilsCount);
    expect(env.world.officialRequests.filter((r) => r.kind === "EXAM_CONVOCATION")).toHaveLength(pupilsCount);
    const sealed = env.world.officialRequests[0]!;
    expect(sealed.content).toMatchObject({ watermark: expect.stringContaining("démonstration"), room: expect.any(String) });
    // rejouer : documents déjà vivants
    const again = unwrap(await issueBatch(env.deps(), env.ctxA(), sessionId, { kind: "CONVOCATION" }));
    expect(again.issued).toBe(0);
    expect(again.skipped).toHaveLength(pupilsCount);
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "IN_PROGRESS"));
    const frozen = await autoAssign(env.deps(), env.ctxA(), sessionId, { reassign: true });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("examinations.assignment_frozen");
  });

  it("saisit des notes en lot de façon idempotente et refuse un dépassement de barème", async () => {
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), sessionId));
    const ep3 = detail.papers.find((p) => p.code === "EP3")!;
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const items = list.items.map((c) => ({ candidateId: c.id, paperId: ep3.id, status: "ENTERED" as const, score: "7.5" }));
    const first = unwrap(await bulkSaveScores(env.deps(), env.ctxA(), sessionId, { items }));
    expect(first).toMatchObject({ saved: pupilsCount, unchanged: 0, failed: [] });
    const replay = unwrap(await bulkSaveScores(env.deps(), env.ctxA(), sessionId, { items }));
    expect(replay).toMatchObject({ saved: 0, unchanged: pupilsCount, failed: [] });
    const over = unwrap(await bulkSaveScores(env.deps(), env.ctxA(), sessionId, { items: [{ candidateId: list.items[0]!.id, paperId: ep3.id, status: "ENTERED", score: "10.5" }] }));
    expect(over.failed[0]?.code).toBe("examinations.score_above_scale");
  });

  it("enregistre les résultats officiels (saisis, jamais calculés) : admis, ajourné, absent", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const codes = ["ADMITTED", "ADMITTED", "FAILED", "ABSENT", "ADMITTED", "FAILED"] as const;
    const entered = unwrap(
      await saveResults(env.deps(), env.ctxA(), sessionId, {
        items: list.items.map((c, i) => ({ candidateId: c.id, resultCode: codes[i]!, average: codes[i] === "ABSENT" ? null : codes[i] === "FAILED" ? "8.5" : "12.25" })),
      }),
    );
    expect(entered).toMatchObject({ saved: pupilsCount, failed: [] });
    const results = unwrap(await listResults(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    expect(results.items.every((r) => r.source === "ENTERED" && r.status === "DRAFT" && r.ruleVersionRef === null)).toBe(true);
    // aucune moyenne n'a été calculée par le module : les valeurs sont celles qui ont été saisies
    expect(results.items.filter((r) => r.resultCode === "ADMITTED").map((r) => r.average)).toEqual(["12.25", "12.25", "12.25"]);
    const events = await env.db.admin.query("SELECT payload::text AS p FROM kernel.domain_events WHERE type LIKE 'examinations.%' AND tenant_id = $1", [env.tenantA]);
    expect(events.rows.length).toBeGreaterThan(0);
  });

  it("publie la session : résultats publiés, événements sans note, attestations pour les seuls admis, statistiques par la règle", async () => {
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "RESULTS_ENTERED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "PUBLISHED"));
    const published = await env.db.admin.query("SELECT count(*)::int AS n FROM examinations.candidate_results WHERE session_id = $1 AND status = 'PUBLISHED'", [sessionId]);
    expect(published.rows[0].n).toBe(pupilsCount);
    const ev = await env.db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = 'examinations.result.published' AND tenant_id = $1", [env.tenantA]);
    expect(ev.rows).toHaveLength(pupilsCount);
    for (const row of ev.rows) {
      expect(Object.keys(row.payload).sort()).toEqual(["candidateId", "examTypeCode", "institutionId", "outcome", "sessionId", "sessionYear", "studentId", "v"]);
    }
    const list = unwrap(await listResults(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const admitted = list.items.filter((r) => r.resultCode === "ADMITTED");
    const failed = list.items.find((r) => r.resultCode === "FAILED")!;
    for (const r of admitted) expect(unwrap(await issueDocument(env.deps(), env.ctxA(), r.candidateId, "ATTESTATION_REUSSITE")).status).toBe("ISSUED");
    const refused = await issueDocument(env.deps(), env.ctxA(), failed.candidateId, "ATTESTATION_REUSSITE");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.attestation_requires_admission");

    const stats = unwrap(await getStatistics(env.deps(), env.ctxA(), sessionId, { groupBy: "SEX" }));
    expect(stats.rateAvailable).toBe(true);
    expect(stats.demoRules).toBe(true);
    expect(stats.total).toMatchObject({ registered: 6, present: 5, admitted: 3, failed: 2, absent: 1, rate: "60" });
    expect(stats.groups.map((g) => g.groupKey).sort()).toEqual(["F", "M"]);
  });

  it("les réponses du module respectent les schémas partagés du contrat (le web les valide à la réception)", async () => {
    const c = await import("@ecoledigitale/contracts/src/v2/examinations");
    const deps = env.deps();
    const ctx = env.ctxA();
    c.examTypeDetailDtoSchema.parse(unwrap(await (await import("../../application/reference")).getExamType(deps, ctx, (await env.db.admin.query("SELECT id FROM examinations.exam_types WHERE tenant_id = $1", [env.tenantA])).rows[0].id)));
    c.examSessionDetailDtoSchema.parse(unwrap(await getSessionDetail(deps, ctx, sessionId)));
    c.examPageSchema(c.examSessionDtoSchema).parse(unwrap(await (await import("../../application/sessions")).listSessions(deps, ctx, { page: 1, pageSize: 50 })));
    const cands = unwrap(await listCandidates(deps, ctx, sessionId, { page: 1, pageSize: 50 }));
    c.examPageSchema(c.examCandidateDtoSchema).parse(cands);
    c.examCandidateDetailDtoSchema.parse(unwrap(await getCandidateDetail(deps, ctx, cands.items[0]!.id)));
    c.examPageSchema(c.examResultDtoSchema).parse(unwrap(await listResults(deps, ctx, sessionId, { page: 1, pageSize: 50 })));
    c.examStatisticsDtoSchema.parse(unwrap(await getStatistics(deps, ctx, sessionId, { groupBy: "SEX", compare: "previous_year" })));
    c.examAssignmentsOverviewSchema.parse(unwrap(await getAssignmentsOverview(deps, ctx, sessionId)));
    c.examScoreMatrixSchema.parse(unwrap(await (await import("../../application/scores")).getScoreMatrix(deps, ctx, sessionId)));
    c.examItemsSchema(c.examExportFormatDtoSchema).parse({ items: unwrap(await listExportFormats(deps, ctx)) });
    c.examItemsSchema(c.examImportFormatDtoSchema).parse({ items: unwrap(await (await import("../../application/formats")).listImportFormats(deps, ctx)) });
    c.examItemsSchema(c.examCenterDtoSchema).parse({ items: unwrap(await (await import("../../application/reference")).listCenters(deps, ctx)) });
    c.examPageSchema(c.examIssuedDocumentDtoSchema).parse(unwrap(await (await import("../../application/issued-documents")).listIssuedDocuments(deps, ctx, sessionId, { page: 1, pageSize: 50 })));
    c.examItemsSchema(c.examExportRunDtoSchema).parse({ items: unwrap(await (await import("../../application/exports")).listExports(deps, ctx, sessionId)) });
  });

  it("exporte la liste et les résultats avec les formats fictifs publiés ; fichier tracé (empreinte, effectif, version)", async () => {
    const formats = unwrap(await listExportFormats(env.deps(), env.ctxA(), { status: "PUBLISHED" }));
    const results = formats.find((f) => f.code === "RESULTATS_FICTIF")!;
    const run = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: results.id, filters: {} }));
    expect(run).toMatchObject({ status: "DONE", rowCount: 6, formatVersion: 1 });
    expect(run.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    const download = unwrap(await getExportDownload(env.deps(), env.ctxA(), run.id));
    expect(download).toMatchObject({ rowCount: 6, sha256: run.fileSha256 });
    const key = (await env.db.admin.query("SELECT storage_key FROM examinations.export_runs WHERE id = $1", [run.id])).rows[0].storage_key as string;
    const text = new TextDecoder().decode((await env.world.storage.get(key))!.bytes);
    expect(text.split("\r\n")[0]).toBe("NUMERO;NUMERO_OFFICIEL;DECISION;MOYENNE;EP1;EP2;EP3");
    expect(text).toContain("CEPE2027-00001;");
    expect(text).toContain("7,5"); // virgule décimale : transformation de la liste blanche
  });
});
