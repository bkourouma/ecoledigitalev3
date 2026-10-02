/**
 * ÉLIGIBILITÉ par RÈGLE (jamais en dur) : journal en ajout seul, statut dérivé, dérogation motivée, saisie manuelle seulement sans
 * règle épinglée, échec FERMÉ quand les faits d'un autre module manquent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createCandidate, getCandidateDetail, registerCandidate } from "../../application/candidates";
import { evaluateEligibility } from "../../application/eligibility";
import { actOnPiece } from "../../application/pieces";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, seedPack, setupEnv, type Env } from "../support/env";
import { newId } from "@ecoledigitale/kernel";

describeIntegration("examinations : éligibilité par règle", () => {
  let env: Env;
  let sessionId: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    sessionId = (await openSession(env, "CEPE-ELIG")).id;
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("la règle décide : hors classe d'examen -> INELIGIBLE (motif NOT_IN_EXAM_GRADE), journal avec version de règle et empreinte", async () => {
    const { pupils } = addPupils(env, 1, { gradeLevelCode: "CM1" });
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    const { candidate, check } = unwrap(await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "EVALUATE" }));
    expect(candidate.eligibilityStatus).toBe("INELIGIBLE");
    expect(check).toMatchObject({ result: "INELIGIBLE", reasons: ["NOT_IN_EXAM_GRADE"], overridden: false });
    expect(check.ruleVersionRef).not.toBeNull();
    const row = (await env.db.admin.query("SELECT inputs_hash, evaluated_by FROM examinations.eligibility_checks WHERE id = $1", [check.id])).rows[0];
    expect(row.inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.evaluated_by).toBe(env.userA1);
    // les variables envoyées à la règle ne contiennent ni nom, ni identifiant d'élève
    const sent = JSON.stringify(env.rules.calls.map((x) => x.variables));
    expect(sent).not.toContain(pupils[0]!.studentId);
    expect(sent).not.toContain("ELEVE");
  });

  it("inscrire un candidat inéligible est refusé par la base ; la dérogation motivée (sensible, auditée) le rend éligible", async () => {
    const { pupils } = addPupils(env, 1, { gradeLevelCode: "CM1" });
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    unwrap(await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "EVALUATE" }));
    const refused = await registerCandidate(env.deps(), env.ctxA(), c.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.not_eligible");
    // dérogation : motif d'au moins 10 caractères exigé par le contrat Zod, le cas d'usage ET la base
    const tooShort = await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "OVERRIDE", reason: "court" });
    expect(tooShort.ok).toBe(false);
    unwrap(await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "OVERRIDE", reason: "Décision du directeur : acte de naissance en cours de légalisation" }));
    const second = (await env.db.admin.query("SELECT eligibility_status FROM examinations.candidates WHERE id = $1", [c.id])).rows[0];
    expect(second.eligibility_status).toBe("ELIGIBLE");
    const detail = unwrap(await getCandidateDetail(env.deps(), env.ctxA(), c.id));
    expect(detail.eligibilityChecks[0]).toMatchObject({ overridden: true });
    const audit = env.audit.entries.filter((e) => e.entry.action === "examinations.eligibility.override");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entry.sensitive).toBe(true);
    expect(audit[0]?.entry.reason).toContain("Décision du directeur");
  });

  it("le statut d'éligibilité ne se pose pas à la main : accès SQL direct refusé, journal en ajout seul", async () => {
    const { pupils } = addPupils(env, 1);
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    const ctx = env.ctxA();
    await expect(env.db.tenantDb.run(ctx, (tx) => tx.query("UPDATE examinations.candidates SET eligibility_status = 'ELIGIBLE' WHERE id = $1", [c.id]))).rejects.toThrow(/eligibility_derived/);
    unwrap(await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "EVALUATE" }));
    await expect(env.db.tenantDb.run(ctx, (tx) => tx.query("UPDATE examinations.eligibility_checks SET result = 'ELIGIBLE' WHERE candidate_id = $1", [c.id]))).rejects.toThrow(/append_only|ajout seul|permission denied/);
    await expect(env.db.tenantDb.run(ctx, (tx) => tx.query("DELETE FROM examinations.eligibility_checks WHERE candidate_id = $1", [c.id]))).rejects.toThrow(/append_only|ajout seul|permission/);
  });

  it("échec FERMÉ : sans les faits d'un autre module, aucune évaluation (jamais « éligible » par défaut)", async () => {
    const { pupils } = addPupils(env, 1);
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    env.world.eligibilityFailure = "academic.getEligibilityFacts";
    const r = await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "EVALUATE" });
    env.world.eligibilityFailure = null;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("examinations.port_unavailable");
    const checks = await env.db.admin.query("SELECT count(*)::int AS n FROM examinations.eligibility_checks WHERE candidate_id = $1", [c.id]);
    expect(checks.rows[0].n).toBe(0);
    expect((await env.db.admin.query("SELECT eligibility_status FROM examinations.candidates WHERE id = $1", [c.id])).rows[0].eligibility_status).toBe("NOT_EVALUATED");
  });

  it("une session SANS règle épinglée : évaluation automatique indisponible, saisie manuelle avec auteur ; avec une règle épinglée : manuel refusé", async () => {
    const bare = await setupEnv({ rules: { noBinding: true } });
    try {
      await seedPack(bare);
      const s = await openSession(bare, "CEPE-NORULE");
      expect(s.ruleVersionRef).toBeNull();
      const { pupils } = addPupils(bare, 1);
      const c = unwrap(await createCandidate(bare.deps(), bare.ctxA(), s.id, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
      const auto = await evaluateEligibility(bare.deps(), bare.ctxA(), c.id, { mode: "EVALUATE" });
      expect(auto.ok).toBe(false);
      if (!auto.ok) expect(auto.error.code).toBe("examinations.no_rule_version");
      const manual = unwrap(await evaluateEligibility(bare.deps(), bare.ctxA(), c.id, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] }));
      expect(manual.candidate.eligibilityStatus).toBe("ELIGIBLE");
      const row = (await bare.db.admin.query("SELECT rule_version_ref, evaluated_by FROM examinations.eligibility_checks WHERE candidate_id = $1", [c.id])).rows[0];
      expect(row).toEqual({ rule_version_ref: null, evaluated_by: bare.userA1 });
    } finally {
      await bare.drop();
    }
    const { pupils } = addPupils(env, 1);
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    const refused = await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.manual_eligibility_refused");
  });

  it("une pièce refusée ou absente ne vaut pas dossier complet ; la pièce doit appartenir à l'élève", async () => {
    const { pupils } = addPupils(env, 2);
    const c = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    const req = (await env.db.admin.query("SELECT r.id FROM examinations.document_requirements r JOIN examinations.sessions s ON s.exam_type_id = r.exam_type_id WHERE s.id = $1", [sessionId])).rows[0].id as string;
    const foreign = newId();
    env.world.pieces.set(foreign, pupils[1]!.studentId); // la pièce d'un AUTRE élève
    const wrong = await actOnPiece(env.deps(), env.ctxA(), c.id, req, { action: "SUBMIT", documentRef: foreign });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("examinations.piece_document_unknown");
    const mine = newId();
    env.world.pieces.set(mine, pupils[0]!.studentId);
    unwrap(await actOnPiece(env.deps(), env.ctxA(), c.id, req, { action: "SUBMIT", documentRef: mine }));
    const rejected = unwrap(await actOnPiece(env.deps(), env.ctxA(), c.id, req, { action: "REJECT", rejectionReason: "Illisible" }));
    expect(rejected.missing).toEqual(["ACTE_NAISSANCE"]);
    const ev = unwrap(await evaluateEligibility(env.deps(), env.ctxA(), c.id, { mode: "EVALUATE" }));
    expect(ev.check).toMatchObject({ result: "NEEDS_REVIEW", reasons: ["DOCUMENTS_MISSING"] });
  });
});
