/**
 * RÉVISIONS À QUATRE YEUX : un résultat publié ou une note après clôture ne se corrige que par une révision DEMANDÉE par une personne et
 * APPROUVÉE par une autre, insérée dans la même transaction que la correction ; documents dépendants révoqués ; aucune note dans les
 * événements ni dans l'audit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { bulkSaveScores } from "../../application/scores";
import { issueDocument, listIssuedDocuments } from "../../application/issued-documents";
import { listResults, publishResult, saveResults } from "../../application/results";
import { approveRevision, listRevisionRequests, rejectRevision, requestResultRevision, requestScoreRevision } from "../../application/revisions";
import { getSessionDetail, transitionSession } from "../../application/sessions";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

describeIntegration("examinations : révisions à quatre yeux", () => {
  let env: Env;
  let sessionId: string;
  let candidates: Array<{ candidateId: string; number: string }>;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    const session = await openSession(env, "CEPE-REV");
    sessionId = session.id;
    const { pupils } = addPupils(env, 3);
    candidates = [];
    for (const p of pupils) candidates.push(await registerPupil(env, env.ctxA(), sessionId, p));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "IN_PROGRESS"));
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), sessionId));
    const ep1 = detail.papers.find((p) => p.code === "EP1")!;
    unwrap(await bulkSaveScores(env.deps(), env.ctxA(), sessionId, { items: candidates.map((c) => ({ candidateId: c.candidateId, paperId: ep1.id, status: "ENTERED" as const, score: "9" })) }));
    unwrap(
      await saveResults(env.deps(), env.ctxA(), sessionId, {
        items: [
          { candidateId: candidates[0]!.candidateId, resultCode: "ADMITTED", average: "11.5" },
          { candidateId: candidates[1]!.candidateId, resultCode: "FAILED", average: "9.4" },
          { candidateId: candidates[2]!.candidateId, resultCode: "FAILED", average: "8" },
        ],
      }),
    );
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "RESULTS_ENTERED"));
  });
  afterAll(async () => {
    await env?.drop();
  });

  const resultOf = async (candidateId: string) => (await env.db.admin.query("SELECT id, result_code, average::text AS average, status FROM examinations.candidate_results WHERE candidate_id = $1", [candidateId])).rows[0];

  it("un résultat publié ne se dépublie pas et ne se corrige pas à la main (accès SQL direct refusé)", async () => {
    const r = await resultOf(candidates[1]!.candidateId);
    unwrap(await publishResult(env.deps(), env.ctxA(), r.id));
    const ctx = env.ctxA();
    await expect(env.db.tenantDb.run(ctx, (tx) => tx.query("UPDATE examinations.candidate_results SET result_code = 'ADMITTED' WHERE id = $1", [r.id]))).rejects.toThrow(/result_revision_required/);
    await expect(env.db.tenantDb.run(ctx, (tx) => tx.query("UPDATE examinations.candidate_results SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = $1", [r.id]))).rejects.toThrow(/result_published/);
    // la saisie en lot ne peut pas l'écraser non plus : elle signale la ligne
    const attempt = unwrap(await saveResults(env.deps(), env.ctxA(), sessionId, { items: [{ candidateId: candidates[1]!.candidateId, resultCode: "ADMITTED", average: "15" }] }));
    expect(attempt.saved).toBe(0);
    expect(attempt.failed[0]?.code).toBe("examinations.result_revision_required");
  });

  it("la demande est faite par une personne, approuvée par une AUTRE : refus si c'est la même personne", async () => {
    const r = await resultOf(candidates[1]!.candidateId);
    const req = unwrap(await requestResultRevision(env.deps(), env.ctxA(env.userA1), r.id, { resultCode: "ADMITTED", average: "10.2", reason: "Moyenne relevée au procès-verbal du jury" }));
    expect(req).toMatchObject({ status: "PENDING", requestedBy: env.userA1, current: { code: "FAILED", average: "9.4" } });
    const same = await approveRevision(env.deps(), env.ctxA(env.userA1), req.id);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.code).toBe("examinations.revision_same_person");
    // une seule demande en attente par résultat
    const dup = await requestResultRevision(env.deps(), env.ctxA(env.userA2), r.id, { resultCode: "FAILED", average: "9.0", reason: "Autre proposition concurrente" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("examinations.revision_pending");
    const before = await resultOf(candidates[1]!.candidateId);
    expect(before.result_code).toBe("FAILED"); // rien n'a bougé
    const approved = unwrap(await approveRevision(env.deps(), env.ctxA(env.userA2), req.id));
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: env.userA2 });
    const after = await resultOf(candidates[1]!.candidateId);
    expect(after).toMatchObject({ result_code: "ADMITTED", average: "10.200" });
    const rev = (await env.db.admin.query("SELECT requested_by, approved_by, from_code, to_code, reason FROM examinations.result_revisions WHERE result_id = $1", [r.id])).rows;
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ requested_by: env.userA1, approved_by: env.userA2, from_code: "FAILED", to_code: "ADMITTED" });
    const outcome = (await env.db.admin.query("SELECT outcome FROM examinations.candidates WHERE id = $1", [candidates[1]!.candidateId])).rows[0].outcome;
    expect(outcome).toBe("ADMITTED"); // l'issue suit le résultat corrigé
    // la demande décidée ne se rejoue pas
    const again = await approveRevision(env.deps(), env.ctxA(env.userA2), req.id);
    expect(again.ok).toBe(false);
  });

  it("l'approbateur n'est jamais désigné par la requête : un utilisateur système ne demande ni n'approuve", async () => {
    const sys = (await import("@ecoledigitale/kernel")).createSystemContext(env.tenantA);
    const r = await resultOf(candidates[2]!.candidateId);
    unwrap(await publishResult(env.deps(), env.ctxA(), r.id));
    const denied = await requestResultRevision(env.deps(), sys, r.id, { resultCode: "ABSENT", reason: "Demande sans utilisateur identifié" });
    expect(denied.ok).toBe(false);
    const ok = unwrap(await requestResultRevision(env.deps(), env.ctxA(env.userA1), r.id, { resultCode: "ABSENT", reason: "Candidat absent constaté à l'appel" }));
    const rejected = await rejectRevision(env.deps(), env.ctxA(env.userA1), ok.id, "Je refuse ma propre demande");
    expect(rejected.ok).toBe(false);
    const refusal = unwrap(await rejectRevision(env.deps(), env.ctxA(env.userA2), ok.id, "Preuve insuffisante"));
    expect(refusal).toMatchObject({ status: "REJECTED", decidedBy: env.userA2, decisionNote: "Preuve insuffisante" });
    expect((await resultOf(candidates[2]!.candidateId)).result_code).toBe("FAILED");
  });

  it("une note, une fois la session à résultats saisis, ne se corrige que par révision approuvée", async () => {
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), sessionId));
    const ep1 = detail.papers.find((p) => p.code === "EP1")!;
    const direct = unwrap(await bulkSaveScores(env.deps(), env.ctxA(), sessionId, { items: [{ candidateId: candidates[0]!.candidateId, paperId: ep1.id, status: "ENTERED", score: "14" }] }));
    expect(direct.failed[0]?.code).toBe("examinations.score_revision_required");
    const score = (await env.db.admin.query("SELECT id FROM examinations.paper_scores WHERE candidate_id = $1 AND paper_id = $2", [candidates[0]!.candidateId, ep1.id])).rows[0].id as string;
    const req = unwrap(await requestScoreRevision(env.deps(), env.ctxA(env.userA1), score, { status: "ENTERED", score: "14", reason: "Erreur de report de la note sur le PV" }));
    expect(req.current).toEqual({ status: "ENTERED", score: "9" });
    unwrap(await approveRevision(env.deps(), env.ctxA(env.userA2), req.id));
    expect((await env.db.admin.query("SELECT score::text AS s FROM examinations.paper_scores WHERE id = $1", [score])).rows[0].s).toBe("14.00");
    const pending = unwrap(await listRevisionRequests(env.deps(), env.ctxA(), sessionId, { status: "APPROVED", page: 1, pageSize: 20 }));
    expect(pending.total).toBe(2);
  });

  it("après publication de la session, la correction d'un résultat reste possible par révision ; le document dépendant est révoqué", async () => {
    // résultat admis publié + attestation émise
    const c0 = candidates[0]!;
    const r0 = await resultOf(c0.candidateId);
    unwrap(await publishResult(env.deps(), env.ctxA(), r0.id));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "PUBLISHED"));
    const doc = unwrap(await issueDocument(env.deps(), env.ctxA(), c0.candidateId, "ATTESTATION_REUSSITE"));
    expect(doc.status).toBe("ISSUED");
    const req = unwrap(await requestResultRevision(env.deps(), env.ctxA(env.userA1), r0.id, { resultCode: "FAILED", average: "8.9", reason: "Erreur de transcription de la décision du jury" }));
    unwrap(await approveRevision(env.deps(), env.ctxA(env.userA2), req.id));
    expect((await resultOf(c0.candidateId)).result_code).toBe("FAILED");
    const docs = unwrap(await listIssuedDocuments(env.deps(), env.ctxA(), sessionId, { kind: "ATTESTATION_REUSSITE", page: 1, pageSize: 20 }));
    expect(docs.items[0]).toMatchObject({ status: "REVOKED" });
    expect(docs.items[0]?.revokedReason).toContain("révision approuvée");
    // l'attestation ne se réémet plus : le candidat n'est plus admis
    const reissue = await issueDocument(env.deps(), env.ctxA(), c0.candidateId, "ATTESTATION_REUSSITE");
    expect(reissue.ok).toBe(false);
  });

  it("aucune note ni moyenne dans les événements ni dans l'audit des révisions", async () => {
    const events = await env.db.admin.query("SELECT type, payload::text AS p FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'examinations.%'", [env.tenantA]);
    const dump = events.rows.map((e) => e.p).join("\n");
    expect(dump).not.toMatch(/average|moyenne|score|"9\.4"|10\.2/);
    const audits = JSON.stringify(env.audit.entries.map((e) => e.entry));
    expect(audits).not.toMatch(/10\.2|"average"|9\.4|8\.9/);
    expect(audits).not.toContain("ELEVE");
    const listed = unwrap(await listResults(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    expect(listed.total).toBe(3);
  });
});
