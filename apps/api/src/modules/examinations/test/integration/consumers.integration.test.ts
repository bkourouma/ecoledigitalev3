/**
 * Abonné `academic.enrollment.withdrawn` : retrait automatique du candidat (motif tracé, numéro conservé), idempotent, sans effet une
 * fois les résultats saisis. Le worker charge les abonnés du module.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { onEnrollmentWithdrawn, AUTOMATIC_WITHDRAWAL_REASON } from "../../application/consumers";
import { transitionSession } from "../../application/sessions";
import subscribers from "../../subscribers";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

describeIntegration("examinations : abonnés", () => {
  let env: Env;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("déclare son abonné au motif exact de l'événement consommé", () => {
    expect(subscribers).toHaveLength(1);
    expect((subscribers[0] as { name: string; pattern: string }).pattern).toBe("academic.enrollment.withdrawn");
    expect((subscribers[0] as { name: string }).name).toBe("examinations.withdraw-on-enrollment-withdrawn");
  });

  it("retire le candidat de l'élève qui quitte l'établissement : numéro conservé, motif tracé, événement sans identité ; rejeu sans effet", async () => {
    const session = await openSession(env, "CEPE-ABO");
    const { pupils } = addPupils(env, 2);
    const a = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const b = await registerPupil(env, env.ctxA(), session.id, pupils[1]!);
    const first = unwrap(await onEnrollmentWithdrawn(env.deps(), env.tenantA, { enrollmentId: pupils[0]!.enrollmentId, status: "WITHDRAWN" }));
    expect(first.affected).toBe(1);
    const row = (await env.db.admin.query("SELECT registration_status, candidate_number, withdrawn_reason FROM examinations.candidates WHERE id = $1", [a.candidateId])).rows[0];
    expect(row).toEqual({ registration_status: "WITHDRAWN", candidate_number: a.number, withdrawn_reason: AUTOMATIC_WITHDRAWAL_REASON });
    const other = (await env.db.admin.query("SELECT registration_status FROM examinations.candidates WHERE id = $1", [b.candidateId])).rows[0];
    expect(other.registration_status).toBe("REGISTERED");
    const ev = (await env.db.admin.query("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'examinations.candidate.withdrawn'", [env.tenantA])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ reasonCode: "ENROLLMENT_WITHDRAWN", candidateId: a.candidateId });
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/ELEVE|Prénom/);
    const replay = unwrap(await onEnrollmentWithdrawn(env.deps(), env.tenantA, { enrollmentId: pupils[0]!.enrollmentId }));
    expect(replay.affected).toBe(0);
    expect(replay.ignored).toBeDefined();
  });

  it("une fois les résultats saisis le retrait est impossible : le candidat reste, l'événement n'est pas une erreur", async () => {
    const session = await openSession(env, "CEPE-ABO2");
    const { pupils } = addPupils(env, 1);
    const a = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "IN_PROGRESS"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "RESULTS_ENTERED")); // résultats saisis
    const r = unwrap(await onEnrollmentWithdrawn(env.deps(), env.tenantA, { enrollmentId: pupils[0]!.enrollmentId }));
    expect(r.affected).toBe(0);
    expect((await env.db.admin.query("SELECT registration_status FROM examinations.candidates WHERE id = $1", [a.candidateId])).rows[0].registration_status).toBe("REGISTERED");
  });

  it("une charge illisible est refusée avec un code stable (le worker la relancera puis la mettra en dead-letter)", async () => {
    const r = await onEnrollmentWithdrawn(env.deps(), env.tenantA, { pas: "d'enrollmentId" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("examinations.invalid_input");
  });
});
