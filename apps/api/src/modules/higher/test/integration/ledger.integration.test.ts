import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { awardDiploma, revokeAward } from "../../application/awards";
import { createDiplomaFromCurriculum } from "../../application/diplomas";
import { capitalizePeriod, expireCredits, getCreditSummary, listAcquiredUe, listDebts } from "../../application/ledger";
import { updateHigherSettings } from "../../application/settings";
import { adminOne, adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { CAPS, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

describeIntegration("registre de crédits — capitalisation (Postgres réel)", () => {
  let db: HigherTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 3): Promise<{ w: TestWorld; s: School }> => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students });
    world = w;
    return { w, s };
  };
  const capitalize = (w: TestWorld, s: School, version?: number) =>
    capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, ...(version ? { resultsVersion: version } : {}) });
  const events = async (tenantId: string, type: string) =>
    adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY occurred_at, id", [tenantId, type]);

  it("AC1.1/AC1.2 : une écriture par UE validée, crédits et moyenne figés ; rejouer n'ajoute rien", async () => {
    const { w, s } = await fresh();
    const [st1, st2] = s.students;
    const [ue1, ue2, ue3] = s.ues;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
      ueLine(s, st1!, ue1!, { averageExact: "14.3333" }),
      ueLine(s, st1!, ue2!),
      ueLine(s, st2!, ue1!, { via: "RESIT", sessionObtained: 2 }),
      ueLine(s, st2!, ue3!, { validated: false, ueState: "RESIT", sessionObtained: null }),
    ]);
    const first = unwrap(await capitalize(w, s));
    expect(first).toMatchObject({ linesRead: 4, acquired: 3, alreadyAcquired: 0, debtsOpened: 0 });
    const rows = await adminRows(db, "SELECT student_id, ue_node_id, credits::text, average_exact::text, acquired_via, session_obtained, status FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.student_id === st1!.studentId && r.ue_node_id === ue1!.nodeId)).toMatchObject({ credits: "6.00", average_exact: "14.3333", acquired_via: "DIRECT", session_obtained: 1, status: "ACQUIRED" });
    expect(rows.find((r) => r.student_id === st2!.studentId && r.ue_node_id === ue1!.nodeId)).toMatchObject({ acquired_via: "RESIT", session_obtained: 2 });

    const again = unwrap(await capitalize(w, s));
    expect(again).toMatchObject({ acquired: 0, alreadyAcquired: 3 });
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId])).n)).toBe(3);
    expect(await events(s.tenantId, "higher.credits.capitalized")).toHaveLength(3); // pas d'événement fantôme au rejeu
  });

  it("l'événement capitalisé porte les champs du contrat ; l'audit du lot est écrit", async () => {
    const { w, s } = await fresh(1);
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, s.ues[0]!)]);
    unwrap(await capitalize(w, s));
    const [e] = await events(s.tenantId, "higher.credits.capitalized");
    expect(e!.payload).toMatchObject({ v: 1, studentId: s.students[0]!.studentId, ueNodeId: s.ues[0]!.nodeId, credits: 6, via: "DIRECT", sessionObtained: 1 });
    expect(w.audit.actions()).toContain("higher.ledger.capitalized");
  });

  it("AC1.5 : modifier les crédits de l'UE dans le curriculum ne change pas l'écriture", async () => {
    const { w, s } = await fresh(1);
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, s.ues[0]!)]);
    unwrap(await capitalize(w, s));
    w.ports.curriculum.updateCredits(s.ues[0]!.nodeId, 9);
    unwrap(await capitalize(w, s));
    expect((await adminOne<{ credits: string }>(db, "SELECT credits::text FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId])).credits).toBe("6.00");
  });

  it("AC1.6 : une UE à 0 crédit est inscrite au registre sans rien ajouter au total", async () => {
    const { w, s } = await fresh(1);
    const zero = { nodeId: newId(), code: "UE0", label: "Conduite", credits: 0 };
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, zero, { credits: 0 }), ueLine(s, s.students[0]!, s.ues[0]!)]);
    unwrap(await capitalize(w, s));
    const summary = unwrap(await getCreditSummary(w.deps, s.admin.ctx, s.students[0]!.studentId));
    expect(summary).toMatchObject({ totalCredits: 6, acquiredUeCount: 2 });
  });

  it("dette : UE non validée en état DEBT -> dette ouverte + événement ; levée à l'acquisition de l'UE", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const ue = s.ues[0]!;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, ue, { validated: false, ueState: "DEBT", sessionObtained: null, averageExact: "7.2" })]);
    expect(unwrap(await capitalize(w, s))).toMatchObject({ acquired: 0, debtsOpened: 1 });
    expect(unwrap(await capitalize(w, s))).toMatchObject({ debtsOpened: 0 }); // idempotent
    expect(unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId))).toHaveLength(1);
    expect(await events(s.tenantId, "higher.ue.debt_detected")).toHaveLength(1);

    // Rattrapage réussi l'année suivante (nouvelle période) : l'UE est acquise, la dette levée.
    w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, ue, { academicPeriodId: s.period2Id, via: "RESIT", sessionObtained: 2 })]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.period2Id }));
    expect(unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId))).toHaveLength(0);
    expect(unwrap(await listAcquiredUe(w.deps, s.admin.ctx, st.studentId))).toHaveLength(1);
  });

  it("une UE à repasser (RESIT) n'est PAS une dette", async () => {
    const { w, s } = await fresh(1);
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, s.ues[0]!, { validated: false, ueState: "RESIT", sessionObtained: null })]);
    expect(unwrap(await capitalize(w, s))).toMatchObject({ debtsOpened: 0 });
  });

  it("AC1.4 : une reclôture qui invalide l'UE révoque l'écriture ; bloquée si un diplôme octroyé s'appuie dessus", async () => {
    const { w, s } = await fresh(2);
    const [a, b] = s.students;
    const lines1 = s.ues.flatMap((ue) => [ueLine(s, a!, ue), ueLine(s, b!, ue)]);
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, lines1);
    unwrap(await capitalize(w, s));

    // Diplôme complet (18 crédits) pour A uniquement.
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-GL" }));
    w.ports.cycleResults.set(a!.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "13.1", credits: 18 }] });
    const awarded = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId, via: "MANUAL" }));
    expect(awarded.status).toBe("AWARDED");

    // Reclôture (version 2) : l'UE1 n'est plus validée ni pour A ni pour B.
    const ue1 = s.ues[0]!;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
      ueLine(s, a!, ue1, { validated: false, ueState: "DEBT", sessionObtained: null, resultsVersion: 2 }),
      ueLine(s, b!, ue1, { validated: false, ueState: "DEBT", sessionObtained: null, resultsVersion: 2 }),
    ]);
    const r = unwrap(await capitalize(w, s));
    expect(r).toMatchObject({ revoked: 1, revocationBlocked: 1, debtsOpened: 1 });
    const status = await adminRows<{ student_id: string; status: string }>(db, "SELECT student_id, status FROM higher.credit_ledger WHERE tenant_id = $1 AND ue_node_id = $2", [s.tenantId, ue1.nodeId]);
    expect(status.find((x) => x.student_id === b!.studentId)?.status).toBe("REVOKED");
    expect(status.find((x) => x.student_id === a!.studentId)?.status).toBe("ACQUIRED"); // soutient le diplôme : bloqué
    expect(await events(s.tenantId, "higher.credits.revocation_blocked")).toHaveLength(1);
    expect(await events(s.tenantId, "higher.credits.revoked")).toHaveLength(1);

    // La révocation du diplôme précède : alors la reclôture suivante peut révoquer.
    if (awarded.status === "AWARDED") unwrap(await revokeAward(w.deps, s.admin.ctx, { awardId: awarded.award.id, reason: "Erreur de saisie des notes" }));
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, a!, ue1, { validated: false, ueState: "DEBT", sessionObtained: null, resultsVersion: 3 })]);
    expect(unwrap(await capitalize(w, s))).toMatchObject({ revoked: 1, revocationBlocked: 0 });
  });

  it("durée de validité (réglage) : valid_until posé ; une acquisition périmée est remplacée puis balayée", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    unwrap(await updateHigherSettings(w.deps, s.admin.ctx, { creditValidityMonths: 12 }));
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validatedAt: new Date("2026-09-30T10:00:00Z") }), ueLine(s, st, s.ues[1]!, { validatedAt: new Date("2026-09-30T10:00:00Z") })]);
    unwrap(await capitalize(w, s));
    const rows = await adminRows<{ valid_until: string }>(db, "SELECT valid_until::text FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId]);
    expect(rows.every((r) => r.valid_until === "2027-09-30")).toBe(true);

    // 13 mois plus tard : les acquisitions ne comptent plus ; le balayage les passe EXPIRED.
    w.clock.set("2027-11-15T08:00:00.000Z");
    expect(unwrap(await listAcquiredUe(w.deps, s.admin.ctx, st.studentId))).toHaveLength(0);
    // L'UE est réacquise (nouvelle clôture) : l'ancienne écriture périmée est remplacée, sans violer l'unicité.
    w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[0]!, { academicPeriodId: s.period2Id, validatedAt: new Date("2027-11-10T10:00:00Z") })]);
    expect(unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.period2Id }))).toMatchObject({ acquired: 1, replacedExpired: 1 });
    expect(unwrap(await expireCredits(w.deps, s.admin.ctx))).toEqual({ expired: 1 }); // l'UE2 périmée
    expect(unwrap(await expireCredits(w.deps, s.admin.ctx))).toEqual({ expired: 0 });
    const live = unwrap(await listAcquiredUe(w.deps, s.admin.ctx, st.studentId));
    expect(live.map((e) => e.ueNodeId)).toEqual([s.ues[0]!.nodeId]);
  });

  it("jury : une validation JURY_OVERRIDE sans référence est ignorée, avec référence elle est capitalisée avec son origine", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const overrideId = newId();
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
      ueLine(s, st, s.ues[0]!, { via: "JURY_OVERRIDE", overrideId: null }),
      ueLine(s, st, s.ues[1]!, { via: "JURY_OVERRIDE", overrideId, compensatedEcueCount: 1 }),
    ]);
    expect(unwrap(await capitalize(w, s))).toMatchObject({ acquired: 1, rejected: 1 });
    const row = await adminOne(db, "SELECT acquired_via, override_id, compensated_ecue_count FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId]);
    expect(row).toMatchObject({ acquired_via: "JURY_OVERRIDE", override_id: overrideId, compensated_ecue_count: 1 });
  });

  it("AC1.3 : 100 étudiants x 4 UE capitalisés en moins de 30 s", async () => {
    const { w, s } = await fresh(100);
    const ues = [...s.ues, { nodeId: newId(), code: "UE104", label: "U104", credits: 6 }];
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, s.students.flatMap((st) => ues.map((ue) => ueLine(s, st, ue))));
    const t0 = Date.now();
    expect(unwrap(await capitalize(w, s))).toMatchObject({ acquired: 400 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(30_000);
    console.info(`[higher] capitalisation de 400 lignes : ${elapsed} ms`);
  });
});
