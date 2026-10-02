/**
 * NUMÉRO DE CANDIDAT : compteur transactionnel sans trou ni doublon SOUS CONCURRENCE (connexions réelles), numéro conservé et jamais
 * réattribué après un retrait, aucune consommation par une inscription annulée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createCandidate, registerCandidate, withdrawCandidate } from "../../application/candidates";
import { createExaminationsDeps } from "../../application/deps";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, prepareCandidate, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

describeIntegration("examinations : numéro de candidat (concurrence)", () => {
  let env: Env;

  beforeAll(async () => {
    env = await setupEnv({ poolSize: 4 });
    await seedPack(env);
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("20 inscriptions concurrentes sur 4 connexions donnent 20 numéros distincts, de 00001 à 00020, sans trou", async () => {
    const session = await openSession(env, "CEPE-CONC");
    const { pupils } = addPupils(env, 20);
    const ids: string[] = [];
    for (const p of pupils) ids.push(await prepareCandidate(env, env.ctxA(), session.id, p));
    const results = await Promise.all(ids.map((id) => registerCandidate(env.deps(), env.ctxA(), id)));
    const numbers = results.map((r) => unwrap(r).candidateNumber as string);
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `CEPE2027-${String(i + 1).padStart(5, "0")}`));
    const seq = await env.db.admin.query("SELECT last_value::int AS v FROM examinations.number_sequences WHERE tenant_id = $1 AND scope_key = $2", [env.tenantA, `cand:${session.id}`]);
    expect(seq.rows[0].v).toBe(20);
  });

  it("une inscription annulée (audit en échec) ne consomme aucun numéro ; le suivant n'a pas de trou", async () => {
    const session = await openSession(env, "CEPE-ROLLBACK");
    const { pupils } = addPupils(env, 3);
    const a = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    expect(a.number).toBe("CEPE2027-00001");
    const cId = await prepareCandidate(env, env.ctxA(), session.id, pupils[1]!);
    const failing = createExaminationsDeps({
      db: env.db.tenantDb,
      ports: inMemoryPorts(env.world),
      audit: {
        async record() {
          throw new Error("audit indisponible");
        },
      },
    });
    await expect(registerCandidate(failing, env.ctxA(), cId)).rejects.toThrow(/audit indisponible/);
    const still = await env.db.admin.query("SELECT registration_status, candidate_number FROM examinations.candidates WHERE id = $1", [cId]);
    expect(still.rows[0]).toEqual({ registration_status: "DRAFT", candidate_number: null });
    const b = unwrap(await registerCandidate(env.deps(), env.ctxA(), cId));
    expect(b.candidateNumber).toBe("CEPE2027-00002");
  });

  it("un candidat retiré GARDE son numéro, qui n'est jamais réattribué", async () => {
    const session = await openSession(env, "CEPE-WITHDRAW");
    const { pupils } = addPupils(env, 3);
    const first = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const second = await registerPupil(env, env.ctxA(), session.id, pupils[1]!);
    expect([first.number, second.number]).toEqual(["CEPE2027-00001", "CEPE2027-00002"]);
    const short = await withdrawCandidate(env.deps(), env.ctxA(), first.candidateId, "ok");
    expect(short.ok).toBe(false); // motif d'au moins 5 caractères
    const withdrawn = unwrap(await withdrawCandidate(env.deps(), env.ctxA(), first.candidateId, "Départ de l'établissement"));
    expect(withdrawn).toMatchObject({ registrationStatus: "WITHDRAWN", candidateNumber: "CEPE2027-00001" });
    const third = await registerPupil(env, env.ctxA(), session.id, pupils[2]!);
    expect(third.number).toBe("CEPE2027-00003");
    // le même élève peut redevenir candidat (vivant unique) mais reçoit un NOUVEAU numéro
    const again = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    expect(again.number).toBe("CEPE2027-00004");
    const numbers = (await env.db.admin.query("SELECT candidate_number FROM examinations.candidates WHERE session_id = $1 ORDER BY candidate_seq", [session.id])).rows.map((r) => r.candidate_number);
    expect(new Set(numbers).size).toBe(4);
  });

  it("un élève n'a qu'un candidat vivant par session ; une session d'un autre établissement refuse l'élève", async () => {
    const session = await openSession(env, "CEPE-UNIQUE");
    const { pupils } = addPupils(env, 1);
    const p = pupils[0]!;
    unwrap(await createCandidate(env.deps(), env.ctxA(), session.id, { studentId: p.studentId, enrollmentId: p.enrollmentId }));
    const dup = await createCandidate(env.deps(), env.ctxA(), session.id, { studentId: p.studentId, enrollmentId: p.enrollmentId });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("examinations.candidate_duplicate");
    const other = addPupils(env, 1, { institutionId: env.institutionB });
    const refused = await createCandidate(env.deps(), env.ctxA(), session.id, { studentId: other.pupils[0]!.studentId, enrollmentId: other.pupils[0]!.enrollmentId });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.candidate_institution");
  });
});
