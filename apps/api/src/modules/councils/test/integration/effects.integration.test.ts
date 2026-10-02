/**
 * Effets des décisions : file idempotente, exclusion = acte HUMAIN (jamais un job), échec fermé des ports, reprise par le job,
 * déclencheur configurable (`CLOSED` / `SIGNED`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createCouncilsDeps } from "../../application/deps";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, SECRETARY_CAPS, councilOn, freshClassroom, makeWorld, type FreshClass, type TestWorld } from "../support/world";
import { getAgenda, prepareCouncil } from "../../application/agenda";
import { closeCouncil, createCouncil, listParticipantsView, openCouncil } from "../../application/councils";
import { recordDecision } from "../../application/deliberation";
import { applyEffect, listEffectsOfCouncilView, listEffectsView, processRunnableEffects, retryEffect, revertEffect, skipEffect } from "../../application/effects";
import { generateMinutes, signMinutes } from "../../application/minutes";
import { upsertSettings } from "../../application/reference";
import { portUnavailable } from "../../domain/errors";

const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

describeIntegration("effets des décisions (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  /** Bilan de fin d'année jusqu'à la clôture ; `sign` poursuit jusqu'à la signature complète. */
  async function runCouncil(cls: FreshClass, decisionType: string, options: { sign?: boolean; justification?: string } = {}) {
    const d = w.director.ctx;
    const council = await councilOn(w, cls, { scope: "YEAR" });
    unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    unwrap(await openCouncil(w.deps, d, DIRECTOR_CAPS, council.id, {}));
    const president = unwrap(await listParticipantsView(w.deps, d, DIRECTOR_CAPS, council.id)).find((p) => p.councilFunction === "PRESIDENT")!;
    const items = unwrap(await getAgenda(w.deps, d, DIRECTOR_CAPS, council.id)).items;
    for (const it of items) unwrap(await recordDecision(w.deps, d, DIRECTOR_CAPS, it.id, { decisionTypeId: w.decisionTypes[decisionType]!, deciderParticipantId: president.id, mode: "CONSENSUS", ...(options.justification ? { justification: options.justification } : {}) }));
    unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    const minutes = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    if (options.sign !== false) {
      unwrap(await signMinutes(w.deps, d, DIRECTOR_CAPS, minutes.id));
      unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    }
    return { council, minutes, items };
  }
  const effectsOf = async (councilId: string) => unwrap(await listEffectsOfCouncilView(w.deps, w.director.ctx, DIRECTOR_CAPS, councilId)).items;

  it("EXCLUSION : les effets naissent AWAITING_HUMAN ; un job, le système ou un utilisateur non habilité ne les appliquent jamais ; l'humain habilité, si", async () => {
    const cls = freshClassroom(w, { students: 1 });
    const { council } = await runCouncil(cls, "EXCLUSION", { justification: "Faits graves établis, recommandation du conseil." });
    const effects = await effectsOf(council.id);
    const byKind = Object.fromEntries(effects.map((e) => [e.kind, e]));
    expect(byKind.STUDENT_STATUS_REQUEST).toMatchObject({ status: "AWAITING_HUMAN" });
    expect(byKind.ENROLLMENT_OUTCOME).toMatchObject({ status: "AWAITING_HUMAN" });
    expect(byKind.NOTIFY_GUARDIANS).toMatchObject({ status: "APPLIED" }); // la notification n'attend pas d'humain
    expect(effects.filter((e) => e.kind === "RESULTS_DECISION")).toHaveLength(0); // l'exclusion n'a aucun code dans les contrats de règles

    // le job ne touche JAMAIS un effet en attente d'un humain
    unwrap(await processRunnableEffects(w.deps, w.systemCtx()));
    expect((await effectsOf(council.id)).filter((e) => e.status === "AWAITING_HUMAN")).toHaveLength(2);
    expect(w.ports.statusChanges).toHaveLength(0);

    const target = byKind.STUDENT_STATUS_REQUEST!.id;
    expect(code(await applyEffect(w.deps, w.systemCtx(), DIRECTOR_CAPS, target))).toBe("councils.human_decision_required");
    expect(code(await applyEffect(w.deps, w.director.ctx, { effectManage: true }, target))).toBe("councils.permission_required");
    // la base refuse aussi l'application par un acteur système (applied_by non falsifiable)
    await expect(db.tenantDb.run(w.systemCtx(), (tx) => tx.query("UPDATE councils.effects SET status = 'APPLIED', applied_at = now() WHERE id = $1", [target]))).rejects.toThrow(/human_decision_required/);

    const applied = unwrap(await applyEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, target));
    expect(applied).toMatchObject({ status: "APPLIED", appliedBy: w.director.userId });
    expect(w.ports.statusChanges).toEqual([expect.objectContaining({ status: "EXCLUDED", actor: "user" })]);
    unwrap(await applyEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, byKind.ENROLLMENT_OUTCOME!.id));
    expect(w.ports.outcomeCalls.at(-1)).toMatchObject({ outcomeCode: "EXCLUDED" });
    // lever l'exclusion : acte humain motivé
    const reverted = unwrap(await revertEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, target, { reason: "Recours accepté par la direction." }));
    expect(reverted.status).toBe("REVERTED");
    expect(w.ports.statusChanges.at(-1)).toMatchObject({ status: "ACTIVE" });
    // écarter un effet exige un motif
    await expect(skipEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, byKind.NOTIFY_GUARDIANS!.id, {})).resolves.toMatchObject({ ok: false });
  });

  it("RESULTS_DECISION appliqué : annulé par le retrait unitaire de `results` quand il existe (la séance redevient réouvrable) ; refus de `results` : l'effet reste appliqué ; sans retrait : ancien comportement", async () => {
    const cls = freshClassroom(w, { students: 1 });
    const { council } = await runCouncil(cls, "PASSAGE");
    const resultsEffect = (await effectsOf(council.id)).find((e) => e.kind === "RESULTS_DECISION")!;
    expect(resultsEffect.status).toBe("APPLIED");
    expect(resultsEffect.externalRef).toBeTruthy();

    // `results` refuse (période clôturée, décision publiée…) : l'erreur est rendue telle quelle, l'effet reste APPLIED
    w.ports.failResults = { op: "withdrawDecision", error: portUnavailable("results") };
    expect(code(await revertEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, resultsEffect.id, { reason: "Décision à reprendre en conseil." }))).toBe("councils.port_unavailable");
    w.ports.failResults = null;
    expect((await effectsOf(council.id)).find((e) => e.id === resultsEffect.id)?.status).toBe("APPLIED");

    // sans API de retrait : l'annulation passe par la réouverture de la période de résultats (comportement historique)
    const original = w.ports.resultsWrite.withdrawDecision;
    (w.ports.resultsWrite as { withdrawDecision?: unknown }).withdrawDecision = undefined;
    expect(code(await revertEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, resultsEffect.id, { reason: "Décision à reprendre en conseil." }))).toBe("councils.effect_revert_via_results");
    (w.ports.resultsWrite as { withdrawDecision?: unknown }).withdrawDecision = original;

    // avec l'API : retrait de la décision de `results` désignée par la référence de l'effet, motif transmis, acte source tracé
    const reverted = unwrap(await revertEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, resultsEffect.id, { reason: "Décision à reprendre en conseil." }));
    expect(reverted).toMatchObject({ status: "REVERTED" });
    const withdraw = w.ports.resultsWrites.filter((x) => x.op === "withdrawDecision").at(-1)!;
    expect(withdraw.input).toMatchObject({ decisionId: resultsEffect.externalRef, reason: "Décision à reprendre en conseil." });
    expect(String(withdraw.input.councilRef)).toMatch(/^decision:/);
    w.ports.resultsWrites.length = 0; // les tests suivants comptent leurs propres écritures
  });

  it("échec d'un port : l'effet est FAILED avec diagnostic sans bloquer la signature ; port non branché : l'effet reste PENDING ; le job rejoue", async () => {
    const cls = freshClassroom(w, { students: 2 });
    w.ports.failResults = { op: "publishYearDecision", error: new Error("results momentanément indisponible") };
    const { council } = await runCouncil(cls, "PASSAGE");
    let effects = await effectsOf(council.id);
    const failed = effects.filter((e) => e.kind === "RESULTS_DECISION");
    expect(failed).toHaveLength(2);
    expect(failed.every((e) => e.status === "FAILED" && e.attempts === 1 && e.lastError?.includes("indisponible"))).toBe(true);
    // les autres effets de la même séance sont appliqués : un échec n'annule pas les autres
    expect(effects.filter((e) => e.kind === "ENROLLMENT_OUTCOME").every((e) => e.status === "APPLIED")).toBe(true);
    const status = await db.admin.query("SELECT status FROM councils.councils WHERE id = $1", [council.id]);
    expect(status.rows[0].status).toBe("SIGNED");

    // la liste de direction expose les échecs
    const queue = unwrap(await listEffectsView(w.deps, w.director.ctx, { status: "FAILED", councilId: council.id, page: 1, pageSize: 50 }));
    expect(queue.total).toBe(2);

    // reprise : la panne cesse, le job rejoue (au nom de l'humain qui a enregistré la décision) sans doublon
    w.ports.failResults = null;
    const run = unwrap(await processRunnableEffects(w.deps, w.systemCtx()));
    expect(run.applied).toBeGreaterThanOrEqual(2);
    effects = await effectsOf(council.id);
    expect(effects.filter((e) => e.kind === "RESULTS_DECISION").every((e) => e.status === "APPLIED")).toBe(true);
    expect(w.ports.resultsWrites.filter((x) => x.op === "publishYearDecision" && (x.input.councilRef as string).startsWith("decision:"))).toHaveLength(2);
    // rejouer le job n'applique rien de plus
    expect(unwrap(await processRunnableEffects(w.deps, w.systemCtx())).attempted).toBe(0);

    // port NON BRANCHÉ : l'effet reste PENDING (jamais appliqué à moitié)
    const cls2 = freshClassroom(w, { students: 1 });
    w.ports.failResults = { op: "publishYearDecision", error: portUnavailable("results") };
    const second = await runCouncil(cls2, "PASSAGE");
    const pending = (await effectsOf(second.council.id)).find((e) => e.kind === "RESULTS_DECISION")!;
    expect(pending).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(pending.lastError).toContain("councils.port_unavailable");
    w.ports.failResults = null;
    const retried = unwrap(await retryEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, pending.id));
    expect(retried.status).toBe("APPLIED");
    expect(code(await retryEffect(w.deps, w.director.ctx, { read: true }, pending.id))).toBe("councils.invalid_state");
  }, 60_000);

  it("échec fermé : sans port branché le module refuse d'écrire ; une ouverture refusée par results n'ouvre rien", async () => {
    const bare = createCouncilsDeps({ db: db.tenantDb, clock: w.clock });
    const refused = await createCouncil(bare, w.director.ctx, { classroomId: w.classroomId, academicPeriodId: w.periodId, councilTypeId: w.types.PERIOD });
    expect(code(refused)).toBe("councils.port_unavailable");

    const cls = freshClassroom(w, { students: 1 });
    const council = await councilOn(w, cls);
    w.ports.failResults = { op: "openDeliberation", error: portUnavailable("results") };
    expect(code(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {}))).toBe("councils.port_unavailable");
    w.ports.failResults = null;
    const row = await db.admin.query("SELECT status, results_deliberation_id FROM councils.councils WHERE id = $1", [council.id]);
    expect(row.rows[0]).toEqual({ status: "PLANNED", results_deliberation_id: null });
    expect(unwrap(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {})).council.status).toBe("OPEN");
  });

  it("créer une séance exige des résultats au moins au niveau du type (409 results_not_ready avec l'état constaté)", async () => {
    const cls = freshClassroom(w, { students: 1 });
    w.ports.setState(cls.classroomId, cls.periodId, { stateId: "00000000-0000-4000-8000-0000000000aa", status: "OPEN", ruleVersionRef: null, ruleSourceKind: null });
    const r = await createCouncil(w.deps, w.director.ctx, { classroomId: cls.classroomId, academicPeriodId: cls.periodId, councilTypeId: w.types.PERIOD });
    expect(code(r)).toBe("councils.results_not_ready");
    expect(!r.ok && r.error.details).toMatchObject({ required: "GRADING_LOCKED", actual: "OPEN" });
    w.ports.setState(cls.classroomId, cls.periodId, null);
    expect(code(await createCouncil(w.deps, w.director.ctx, { classroomId: cls.classroomId, academicPeriodId: cls.periodId, councilTypeId: w.types.PERIOD }))).toBe("councils.results_not_ready");
    // période d'une autre année, classe inconnue, portée incohérente
    expect(code(await createCouncil(w.deps, w.director.ctx, { classroomId: cls.classroomId, councilTypeId: w.types.PERIOD }))).toBe("councils.scope_mismatch");
    expect(code(await createCouncil(w.deps, w.director.ctx, { classroomId: "00000000-0000-4000-8000-000000000001", academicPeriodId: cls.periodId, councilTypeId: w.types.PERIOD }))).toBe("councils.classroom_not_found");
  });

  it("déclencheur CLOSED : les effets naissent dès la clôture ; deux créations simultanées : une seule réussit", async () => {
    unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, effectsTrigger: "CLOSED" }));
    try {
      const cls = freshClassroom(w, { students: 1 });
      const { council } = await runCouncil(cls, "PASSAGE", { sign: false });
      const effects = await effectsOf(council.id);
      expect(effects.filter((e) => e.kind === "RESULTS_DECISION" && e.status === "APPLIED")).toHaveLength(1);
    } finally {
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, effectsTrigger: "SIGNED" }));
    }
    const cls = freshClassroom(w, { students: 1 });
    const input = { classroomId: cls.classroomId, academicPeriodId: cls.periodId, councilTypeId: w.types.PERIOD };
    const results = await Promise.all([createCouncil(w.deps, w.director.ctx, input), createCouncil(w.deps, w.director2.ctx, input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(code)).toEqual(["councils.duplicate"]);
  }, 60_000);
});
