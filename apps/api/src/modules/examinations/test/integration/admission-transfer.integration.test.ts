/**
 * TRANSMISSION AUX ADMISSIONS (Q-E18) : « admis / non admis » ET la MOYENNE partent dans l'événement dédié
 * `examinations.result.transmitted` (jamais dans `result.published`), pour les seuls types qui le demandent, les seuls candidats-élèves
 * d'une session officielle ; aucun nom ni date de naissance ; correction approuvée = retransmission (version plus grande) ; l'audit
 * trace la transmission SANS la valeur de la moyenne.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { examinationsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/examinations";
import { createExternalCandidate } from "../../application/external-candidates";
import { registerCandidate } from "../../application/candidates";
import { evaluateEligibility } from "../../application/eligibility";
import { actOnPiece, listPieces } from "../../application/pieces";
import { createExamType, getExamType, updateExamType } from "../../application/reference";
import { publishResult, saveResults } from "../../application/results";
import { approveRevision, requestResultRevision } from "../../application/revisions";
import { transitionSession } from "../../application/sessions";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

describeIntegration("examinations : transmission du résultat et de la moyenne aux admissions (Q-E18)", () => {
  let env: Env;
  let typeId: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    typeId = (await env.db.admin.query("SELECT id FROM examinations.exam_types WHERE tenant_id = $1 AND code = 'CEPE'", [env.tenantA])).rows[0].id as string;
  });
  afterAll(async () => {
    await env?.drop();
  });

  const transmitted = async (): Promise<Array<{ type: string; payload: Record<string, unknown> }>> =>
    (await env.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'examinations.result.transmitted' ORDER BY created_at, id", [env.tenantA])).rows;

  async function closeAndEnter(sessionId: string, items: Array<{ candidateId: string; resultCode: "ADMITTED" | "FAILED" | "ABSENT"; average: string | null }>) {
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "IN_PROGRESS"));
    unwrap(await saveResults(env.deps(), env.ctxA(), sessionId, { items }));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "RESULTS_ENTERED"));
  }

  it("par défaut un type transmet RIEN ; le CEPE du pack l'active (décision Q-E18) ; le paramètre se change, de façon tracée", async () => {
    const created = unwrap(await createExamType(env.deps(), env.ctxA(), { code: "BEPCX", label: "Examen d'essai (fictif)", educationLevelCode: "SECONDARY", sourceKind: "placeholder" }));
    expect(created.transmitsToAdmission).toBe(false);
    expect(unwrap(await getExamType(env.deps(), env.ctxA(), typeId)).transmitsToAdmission).toBe(true);
    const off = unwrap(await updateExamType(env.deps(), env.ctxA(), created.id, { transmitsToAdmission: true }));
    expect(off.transmitsToAdmission).toBe(true);
    const audit = env.audit.entries.filter((e) => e.entry.action === "examinations.type.update").at(-1)!;
    expect(audit.entry).toMatchObject({ sensitive: true, after: { transmitsToAdmission: true } });
  });

  it("publication d'un résultat : l'événement dédié porte admis ET moyenne, sans nom ; `result.published` reste sans moyenne", async () => {
    const session = await openSession(env, "CEPE-ADM-1");
    const { pupils } = addPupils(env, 2);
    const a = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const b = await registerPupil(env, env.ctxA(), session.id, pupils[1]!);
    await closeAndEnter(session.id, [
      { candidateId: a.candidateId, resultCode: "ADMITTED", average: "12.25" },
      { candidateId: b.candidateId, resultCode: "FAILED", average: "8.5" },
    ]);
    const ra = (await env.db.admin.query("SELECT id FROM examinations.candidate_results WHERE candidate_id = $1", [a.candidateId])).rows[0].id as string;
    unwrap(await publishResult(env.deps(), env.ctxA(), ra));
    const events = (await transmitted()).filter((e) => e.payload.candidateId === a.candidateId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      v: 1, sessionId: session.id, candidateId: a.candidateId, resultId: ra, studentId: pupils[0]!.studentId, institutionId: env.institutionA, examTypeCode: "CEPE", sessionYear: 2027,
      outcome: "ADMITTED", admitted: true, average: "12.25", revision: expect.any(Number),
    });
    expect(() => examinationsEventPayloadSchemas["examinations.result.transmitted"].parse(events[0]!.payload)).not.toThrow();
    const published = (await env.db.admin.query("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'examinations.result.published' AND payload->>'candidateId' = $2", [env.tenantA, a.candidateId])).rows[0].payload;
    expect(JSON.stringify(published)).not.toMatch(/average|moyenne|12\.25/);
    // la transmission est tracée SANS la valeur de la moyenne
    const audit = env.audit.entries.find((e) => e.entry.action === "examinations.result.transmit" && (e.entry.metadata as { candidateId?: string }).candidateId === a.candidateId)!;
    expect(audit.entry.metadata).toMatchObject({ outcome: "ADMITTED", withAverage: true });
    expect(JSON.stringify(audit.entry)).not.toMatch(/12\.25/);
    // publication de la session : le non admis part aussi (avec sa moyenne), sans doublon pour le résultat déjà publié
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "PUBLISHED"));
    const after = (await transmitted()).filter((e) => e.payload.sessionId === session.id);
    expect(after.filter((e) => e.payload.candidateId === a.candidateId)).toHaveLength(1);
    const failed = after.find((e) => e.payload.candidateId === b.candidateId)!;
    expect(failed.payload).toMatchObject({ outcome: "FAILED", admitted: false, average: "8.5", studentId: pupils[1]!.studentId });
    expect(JSON.stringify(after.map((e) => e.payload))).not.toMatch(/ELEVE|Prénom|Abidjan|2016-05-05/);
  });

  it("un absent est transmis sans moyenne ; un type qui ne transmet pas ne transmet rien ; ni examen blanc, ni candidat libre", async () => {
    // absent : « non admis » sans moyenne (la base interdit une moyenne à un absent)
    const s1 = await openSession(env, "CEPE-ADM-2");
    const { pupils } = addPupils(env, 1);
    const absent = await registerPupil(env, env.ctxA(), s1.id, pupils[0]!);
    await closeAndEnter(s1.id, [{ candidateId: absent.candidateId, resultCode: "ABSENT", average: null }]);
    unwrap(await transitionSession(env.deps(), env.ctxA(), s1.id, "PUBLISHED"));
    const abs = (await transmitted()).find((e) => e.payload.candidateId === absent.candidateId)!;
    expect(abs.payload).toMatchObject({ outcome: "ABSENT", admitted: false, average: null });

    // paramètre désactivé : rien ne part
    unwrap(await updateExamType(env.deps(), env.ctxA(), typeId, { transmitsToAdmission: false }));
    const s2 = await openSession(env, "CEPE-ADM-3");
    const more = addPupils(env, 1).pupils;
    const quiet = await registerPupil(env, env.ctxA(), s2.id, more[0]!);
    await closeAndEnter(s2.id, [{ candidateId: quiet.candidateId, resultCode: "ADMITTED", average: "14" }]);
    unwrap(await transitionSession(env.deps(), env.ctxA(), s2.id, "PUBLISHED"));
    expect((await transmitted()).some((e) => e.payload.candidateId === quiet.candidateId)).toBe(false);
    unwrap(await updateExamType(env.deps(), env.ctxA(), typeId, { transmitsToAdmission: true }));

    // candidat LIBRE : aucun dossier élève, rien à transmettre aux admissions
    const s3 = await openSession(env, "CEPE-ADM-4", { startsOn: "2027-06-10" });
    const free = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), s3.id, { identity: { lastName: "LIBREADM", firstName: "Candidat", birthDate: "2015-03-04", sex: "M" }, profile: { contactPhone: "+2250700011111", declaredInExamGrade: true, declaredPriorAttempts: 0 } }));
    const pieces = unwrap(await listPieces(env.deps(), env.ctxA(), free.id));
    for (const p of pieces.pieces.filter((x) => x.required)) {
      unwrap(await actOnPiece(env.deps(), env.ctxA(), free.id, p.requirementId, { action: "SIGHT" }));
      unwrap(await actOnPiece(env.deps(), env.ctxA(), free.id, p.requirementId, { action: "ACCEPT" }));
    }
    unwrap(await evaluateEligibility(env.deps(), env.ctxA(), free.id, { mode: "EVALUATE" }));
    unwrap(await registerCandidate(env.deps(), env.ctxA(), free.id));
    await closeAndEnter(s3.id, [{ candidateId: free.id, resultCode: "ADMITTED", average: "13" }]);
    unwrap(await transitionSession(env.deps(), env.ctxA(), s3.id, "PUBLISHED"));
    expect((await transmitted()).some((e) => e.payload.candidateId === free.id)).toBe(false);
    // …mais son résultat publié, lui, est bien annoncé (sans moyenne)
    expect((await env.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'examinations.result.published' AND payload->>'candidateId' = $2", [env.tenantA, free.id])).rows[0].n).toBe(1);

    // examen blanc : jamais de transmission
    const mock = await openSession(env, "CEPE-ADM-BLANC", { kind: "MOCK" });
    expect((await transmitted()).some((e) => e.payload.sessionId === mock.id)).toBe(false);
  });

  it("une correction approuvée après transmission retransmet le résultat corrigé (version plus grande), la moyenne corrigée comprise", async () => {
    const session = await openSession(env, "CEPE-ADM-5");
    const { pupils } = addPupils(env, 1);
    const reg = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    await closeAndEnter(session.id, [{ candidateId: reg.candidateId, resultCode: "FAILED", average: "9.4" }]);
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "PUBLISHED"));
    const result = (await env.db.admin.query("SELECT id FROM examinations.candidate_results WHERE candidate_id = $1", [reg.candidateId])).rows[0].id as string;
    const before = (await transmitted()).filter((e) => e.payload.candidateId === reg.candidateId);
    expect(before).toHaveLength(1);
    expect(before[0]!.payload).toMatchObject({ outcome: "FAILED", admitted: false, average: "9.4" });
    const req = unwrap(await requestResultRevision(env.deps(), env.ctxA(env.userA1), result, { resultCode: "ADMITTED", average: "10.2", reason: "Moyenne relevée au procès-verbal du jury" }));
    unwrap(await approveRevision(env.deps(), env.ctxA(env.userA2), req.id));
    const all = (await transmitted()).filter((e) => e.payload.candidateId === reg.candidateId);
    expect(all).toHaveLength(2);
    expect(all[1]!.payload).toMatchObject({ outcome: "ADMITTED", admitted: true, average: "10.2" });
    expect(all[1]!.payload.revision as number).toBeGreaterThan(all[0]!.payload.revision as number);
    expect(env.audit.entries.some((e) => e.entry.action === "examinations.result.transmit" && (e.entry.metadata as { kind?: string }).kind === "REVISION")).toBe(true);
  });
});
