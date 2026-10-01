import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, newId, unwrap, ValidationError } from "@ecoledigitale/kernel";
import { awardDiploma, evaluateStudentDiplomas, getAward, listAwards, recomputeDiploma, revokeAward } from "../../application/awards";
import { createHigherDeps } from "../../application/deps";
import { createDiploma, createDiplomaFromCurriculum, deleteDiploma, getDiploma, getStudentDiplomaProgress, listDiplomaCandidates, replaceRequirements, syncDiplomaRequirements, updateDiploma } from "../../application/diplomas";
import { capitalizePeriod } from "../../application/ledger";
import { onCreditsCapitalized, onResultsPeriodClosed } from "../../application/consumers";
import { getStudentDiplomaView } from "../../application/student-view";
import { adminOne, adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { CAPS, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestStudent, type TestWorld } from "../support/world";

describeIntegration("diplômes et octrois (Postgres réel)", () => {
  let db: HigherTestDb;

  beforeAll(async () => {
    db = await createHigherTestDb(16);
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 3, opts: Parameters<typeof seedSchool>[2] = {}) => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students, ...opts });
    return { w, s };
  };
  const capitalizeAll = async (w: TestWorld, s: School, st: TestStudent, ueIdx: number[], over = {}) => {
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, ueIdx.map((i) => ueLine(s, st, s.ues[i]!, over)));
    return unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
  };
  const completeCycle = (w: TestWorld, s: School, st: TestStudent, average = "13.5") =>
    w.ports.cycleResults.set(st.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average, credits: 18 }] });
  /** Diplôme dont la SEULE exigence est la 1re UE (6 crédits). */
  const oneUeDiploma = async (w: TestWorld, s: School, code: string) =>
    unwrap(await createDiploma(w.deps, s.admin.ctx, { code, label: `Diplôme ${code}`, gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
  const events = async (tenantId: string, type: string) => adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY occurred_at, id", [tenantId, type]);

  it("AC4.1/AC4.2 : création depuis le curriculum, exigences = UE du cycle, resynchronisation non destructive", async () => {
    const { w, s } = await fresh();
    const created = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE" }));
    expect(created.definition).toMatchObject({ code: "DIP-LIC-GL", label: "Licence Génie logiciel", gradeCode: "LICENCE", uvRequired: 18, status: "ACTIVE", autoAward: true });
    expect(created.requirements.map((r) => [r.ueCode, r.mandatory, r.credits])).toEqual([["UE101", true, 6], ["UE102", true, 6], ["UE103", true, 6]]);
    expect(created.requirementsCredits).toBe(18);

    // La direction rend UE103 facultative ; une UE est ajoutée et une retirée du curriculum.
    unwrap(await replaceRequirements(w.deps, s.admin.ctx, { definitionId: created.definition.id, requirements: [{ ueNodeId: s.ues[0]!.nodeId }, { ueNodeId: s.ues[1]!.nodeId }, { ueNodeId: s.ues[2]!.nodeId, mandatory: false }] }));
    w.ports.curriculum.removeUe(s.ues[1]!.nodeId);
    const added = { nodeId: newId(), code: "UE104", label: "Unité UE104", credits: 4, programNodeId: s.programNodeId };
    w.ports.curriculum.addUe(added, s.cycleNodeId);
    const report = unwrap(await syncDiplomaRequirements(w.deps, s.admin.ctx, created.definition.id));
    expect(report.added.map((a) => a.code)).toEqual(["UE104"]);
    expect(report.removed.map((r) => r.code)).toEqual(["UE102"]);
    expect(report.suggestedUvRequired).toBe(16);
    const after = unwrap(await getDiploma(w.deps, s.admin.ctx, created.definition.id));
    expect(after.requirements.find((r) => r.ueCode === "UE103")?.mandatory).toBe(false); // surcharge conservée
    expect(after.requirements.find((r) => r.ueCode === "UE102")?.removedFromCurriculum).toBe(true);
    expect(after.requirements.find((r) => r.ueCode === "UE104")?.mandatory).toBe(true);
  });

  it("AC4.3 : code unique, uv_required > 0, suppression refusée s'il existe un octroi", async () => {
    const { w, s } = await fresh(1);
    const base = { code: "LIC-X", label: "Licence X", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 12 };
    unwrap(await createDiploma(w.deps, s.admin.ctx, base));
    const dup = await createDiploma(w.deps, s.admin.ctx, base);
    expect(!dup.ok && dup.error.code).toBe("higher.diploma_duplicate_code");
    const zero = await createDiploma(w.deps, s.admin.ctx, { ...base, code: "LIC-Y", uvRequired: 0 });
    expect(!zero.ok && zero.error.code).toBe("higher.invalid_input");
    const foreign = await createDiploma(w.deps, s.admin.ctx, { ...base, code: "LIC-Z", requirements: [{ ueNodeId: newId() }] });
    expect(!foreign.ok && foreign.error.code).toBe("higher.requirement_cross_cycle");
    const badNode = await createDiploma(w.deps, s.admin.ctx, { ...base, code: "LIC-W", curriculumNodeId: newId() });
    expect(!badNode.ok && badNode.error.code).toBe("higher.curriculum_node_not_found");

    // Suppression libre sans octroi ; refusée avec un octroi (désactivation à la place).
    const withAward = await oneUeDiploma(w, s, "LIC-A");
    const st = s.students[0]!;
    await capitalizeAll(w, s, st, [0]);
    completeCycle(w, s, st);
    unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: withAward.definition.id, studentId: st.studentId, via: "MANUAL" }));
    const refused = await deleteDiploma(w.deps, s.admin.ctx, withAward.definition.id);
    expect(!refused.ok && refused.error.code).toBe("higher.diploma_has_awards");
    const off = unwrap(await updateDiploma(w.deps, s.admin.ctx, { definitionId: withAward.definition.id, status: "INACTIVE" }));
    expect(off.status).toBe("INACTIVE");
    const removable = unwrap(await createDiploma(w.deps, s.admin.ctx, { ...base, code: "LIC-DEL" }));
    expect(unwrap(await deleteDiploma(w.deps, s.admin.ctx, removable.definition.id))).toEqual({ deleted: true });
  });

  it("AC4.4/AC4.5 : progression à la demande ; éligibilité = obligatoires validées ET total d'UV (règle, facultatives comptées)", async () => {
    const { w, s } = await fresh(2);
    const [a, b] = s.students;
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-P", uvRequired: 12 }));
    unwrap(await replaceRequirements(w.deps, s.admin.ctx, { definitionId: def.definition.id, requirements: [{ ueNodeId: s.ues[0]!.nodeId }, { ueNodeId: s.ues[1]!.nodeId }, { ueNodeId: s.ues[2]!.nodeId, mandatory: false }] }));

    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, a!, s.ues[0]!), ueLine(s, a!, s.ues[2]!), ueLine(s, b!, s.ues[0]!), ueLine(s, b!, s.ues[1]!)]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));

    const pa = unwrap(await getStudentDiplomaProgress(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId }));
    expect(pa.progress).toMatchObject({ uvValidated: 12, uvRequired: 12, percent: 100 });
    expect(pa.progress.missingMandatory.map((m) => m.code)).toEqual(["UE102"]);
    expect(pa.eligibility?.eligible).toBe(false); // UE102 obligatoire manquante malgré 12 UV
    const pb = unwrap(await getStudentDiplomaProgress(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: b!.studentId }));
    expect(pb.progress).toMatchObject({ uvValidated: 12, percent: 100 });
    expect(pb.eligibility?.eligible).toBe(true);
    expect(await adminRows(db, "SELECT 1 FROM higher.diploma_awards WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0); // aucune ligne d'octroi tant que non obtenu

    const candidates = unwrap(await listDiplomaCandidates(w.deps, s.admin.ctx, def.definition.id));
    expect(candidates.map((c) => [c.fullName, c.eligible, c.uvValidated, c.awardStatus])).toEqual([["Étudiant 01", false, 12, null], ["Étudiant 02", true, 12, null]]);
  });

  it("AC5.3 : octroi manuel exige l'éligibilité ; forcé = permission + motif de 20 caractères, mention conservée", async () => {
    const { w, s } = await fresh(2);
    const [a, b] = s.students;
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-F" }));
    await capitalizeAll(w, s, a!, [0]);
    completeCycle(w, s, a!);

    const notEligible = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId, via: "MANUAL" });
    expect(!notEligible.ok && notEligible.error.code).toBe("higher.diploma_not_eligible");
    const noCap = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId, via: "MANUAL", force: true, reason: "Décision du jury exceptionnelle n°42", caps: CAPS.none });
    expect(!noCap.ok && noCap.error.kind).toBe("forbidden");
    const noReason = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId, via: "MANUAL", force: true, reason: "trop court", caps: CAPS.admin });
    expect(!noReason.ok && noReason.error.code).toBe("higher.force_reason_required");

    const forced = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: a!.studentId, via: "MANUAL", force: true, reason: "Décision du jury exceptionnelle n°42", caps: CAPS.admin }));
    expect(forced.status).toBe("AWARDED");
    if (forced.status !== "AWARDED") return;
    expect(forced.award).toMatchObject({ awardedVia: "FORCED", forcedReason: "Décision du jury exceptionnelle n°42", mentionCode: "GOOD", cycleAverage: "13.500", awardedByName: "Directrice des études" });
    expect(forced.award.requirementsSnapshot.requirements.filter((r) => r.validated)).toHaveLength(1);
    expect(w.audit.actions()).toContain("higher.award.forced");
    expect(w.audit.entries.find((e) => e.entry.action === "higher.award.forced")?.entry).toMatchObject({ sensitive: true, reason: "Décision du jury exceptionnelle n°42" });

    // « Forcer » un étudiant éligible n'est qu'un octroi manuel (aucun motif conservé).
    await capitalizeAll(w, s, b!, [0, 1, 2]);
    completeCycle(w, s, b!);
    const normal = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: b!.studentId, via: "MANUAL", force: true, reason: "Décision du jury exceptionnelle n°42", caps: CAPS.admin }));
    expect(normal.status === "AWARDED" && normal.award.awardedVia).toBe("MANUAL");
    expect(normal.status === "AWARDED" && normal.award.forcedReason).toBeNull();
    expect(normal.status === "AWARDED" && normal.award.acquiredDate).toBe("2026-10-01");
  });

  it("AC5.1/AC6.2 : octroi automatique sur capitalisation ; mention en attente = l'octroi attend ; un seul octroi par étudiant", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-AUTO" }));
    await capitalizeAll(w, s, st, [0, 1, 2]);

    // Cycle sans résultat FINAL complet : mention PENDING, l'octroi automatique attend.
    const first = unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[2]!.nodeId }));
    expect(first).toMatchObject({ evaluated: 1, awarded: 0, skipped: { MENTION_PENDING: 1 } });

    completeCycle(w, s, st, "15.25");
    const second = unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[2]!.nodeId }));
    expect(second.awarded).toBe(1);
    const [award] = unwrap(await listAwards(w.deps, s.admin.ctx, { definitionId: def.definition.id })).items;
    expect(award).toMatchObject({ reference: "DIP-2026-000001", awardedVia: "AUTO", status: "OBTAINED", creditsTotal: 18, mentionCode: "GOOD", cycleAverage: "15.250", awardedByName: "Système (octroi automatique)", awardedBy: null });
    expect(award!.acquiredDate).toBe("2026-10-01");
    expect(award!.academicYearId).toBe(s.yearId);
    expect(award!.ruleSetCode).toBe("SCRIPTED-TEST");

    // Rejeu : idempotent (l'octroi existe).
    expect(unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[2]!.nodeId }))).toMatchObject({ awarded: 0, skipped: { ALREADY_AWARDED: 1 } });
    const manualAgain = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" });
    expect(!manualAgain.ok && manualAgain.error.code).toBe("higher.diploma_already_awarded");
    expect((await events(s.tenantId, "higher.diploma.awarded")).map((e) => e.payload)).toEqual([expect.objectContaining({ v: 1, reference: "DIP-2026-000001", via: "AUTO", studentId: st.studentId })]);
  });

  it("AC5.6/AC5.1 : définition INACTIVE ou auto_award=false : pas d'octroi automatique (événement « éligible » seulement)", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-NOAUTO", autoAward: false }));
    await capitalizeAll(w, s, st, [0, 1, 2]);
    completeCycle(w, s, st);
    expect(unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[0]!.nodeId }))).toMatchObject({ awarded: 0, skipped: { AUTO_AWARD_DISABLED: 1 } });
    expect(await events(s.tenantId, "higher.diploma.eligible")).toHaveLength(1);
    unwrap(await updateDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, autoAward: true, status: "INACTIVE" }));
    // Une définition INACTIVE n'est plus évaluée du tout.
    expect(unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[0]!.nodeId }))).toMatchObject({ evaluated: 0, awarded: 0 });
    // …mais un octroi manuel reste possible.
    const manual = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" }));
    expect(manual.status).toBe("AWARDED");
  });

  it("AC5.2/R-HIG-10 : une panne de l'évaluation d'éligibilité ne touche JAMAIS la capitalisation, et se rejoue", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const def = await oneUeDiploma(w, s, "LIC-FAIL");
    completeCycle(w, s, st);
    w.ports.rules.failWith = new ValidationError("Règles indisponibles (test).", [], { code: "rules.no_active_ruleset" });

    // La clôture est traitée par l'abonné de capitalisation : le registre se remplit malgré la panne des règles.
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
    const cap = unwrap(await onResultsPeriodClosed(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, resultsVersion: 1 }));
    expect(cap.acquired).toBe(1);
    const [cEvent] = await events(s.tenantId, "higher.credits.capitalized");

    // L'abonné d'éligibilité échoue (le worker le rejouera) : aucun octroi, registre intact.
    const failed = await onCreditsCapitalized(w.deps, s.admin.ctx, cEvent!.payload);
    expect(failed.ok).toBe(false);
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED'", [s.tenantId])).n)).toBe(1);
    expect(await adminRows(db, "SELECT 1 FROM higher.diploma_awards WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);

    // Règles rétablies : le rejeu octroie.
    w.ports.rules.failWith = null;
    const replay = unwrap(await onCreditsCapitalized(w.deps, s.admin.ctx, cEvent!.payload));
    expect(replay.awarded).toBe(1);
    expect(unwrap(await listAwards(w.deps, s.admin.ctx, { definitionId: def.definition.id })).items).toHaveLength(1);
  });

  it("R-HIG-07/AC5.8 : références continues et sans trou ; une transaction annulée ne consomme aucun numéro", async () => {
    const { w, s } = await fresh(4);
    const def = await oneUeDiploma(w, s, "LIC-N");
    for (const st of s.students) {
      await capitalizeAll(w, s, st, [0]);
      completeCycle(w, s, st);
    }
    const [s1, s2, s3, s4] = s.students;
    const award = async (st: TestStudent, deps = w.deps) => awardDiploma(deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" });
    expect(unwrap(await award(s1!))).toMatchObject({ award: { reference: "DIP-2026-000001" } });

    // Audit défaillant : l'octroi est annulé AVEC le numéro (aucun trou).
    const broken = createHigherDeps({
      db: db.tenantDb, clock: w.clock, ports: w.ports,
      audit: { record: async () => { throw new Error("audit en panne"); } },
    });
    await expect(award(s2!, broken)).rejects.toThrow("audit en panne");
    expect(unwrap(await award(s2!))).toMatchObject({ award: { reference: "DIP-2026-000002" } });

    // Erreur métier APRÈS l'attribution du numéro : on simule par une transaction annulée qui a consommé un numéro.
    await expect(
      w.deps.db.run(s.admin.ctx, async (tx) => {
        await tx.query("SELECT higher.next_number('DIPLOMA', 2026)");
        throw new Error("annulation");
      }),
    ).rejects.toThrow("annulation");
    expect(unwrap(await award(s3!))).toMatchObject({ award: { reference: "DIP-2026-000003" } });

    // Nouvelle année : compteur propre ; nouvel an civil de l'établissement.
    w.clock.set("2027-01-03T09:00:00.000Z");
    expect(unwrap(await award(s4!))).toMatchObject({ award: { reference: "DIP-2027-000001", referenceYear: 2027 } });
    const counters = await adminRows(db, "SELECT year, last_value::int AS last_value FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'DIPLOMA' ORDER BY year", [s.tenantId]);
    expect(counters).toEqual([{ year: 2026, last_value: 3 }, { year: 2027, last_value: 1 }]);
  });

  it("AC5.8/critère 3 : 1 000 octrois concurrents -> 1 000 références distinctes et continues", async () => {
    const { w, s } = await fresh(1);
    const def = await oneUeDiploma(w, s, "LIC-LOAD");
    const N = 1000;
    const crowd: TestStudent[] = Array.from({ length: N }, (_, i) => ({ studentId: newId(), enrollmentId: newId(), userId: newId(), fullName: `Foule ${i}` }));
    // Registre garni par SQL direct (le test mesure l'octroi, pas la capitalisation).
    const ue = s.ues[0]!;
    await db.admin.query(
      `INSERT INTO higher.credit_ledger (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits, acquired_via, session_obtained, source_result_id, source_results_version, acquired_at)
       SELECT gen_random_uuid(), $1, x.sid, gen_random_uuid(), $2, $3, $4, 6, 'DIRECT', 1, gen_random_uuid(), 1, $5 FROM unnest($6::uuid[]) AS x(sid)`,
      [s.tenantId, ue.nodeId, s.yearId, s.periodId, "2026-09-30T10:00:00Z", crowd.map((c) => c.studentId)],
    );
    for (const c of crowd) {
      w.ports.enrollments.setLastEnrollment(c.studentId, s.cycleNodeId, { enrollmentId: c.enrollmentId, academicYearId: s.yearId, academicYearLabel: "2026-2027" });
      w.ports.cycleResults.set(c.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "12", credits: 18 }] });
    }
    const t0 = Date.now();
    const results: Array<Awaited<ReturnType<typeof awardDiploma>>> = [];
    for (let i = 0; i < N; i += 100) {
      results.push(...(await Promise.all(crowd.slice(i, i + 100).map((c) => awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: c.studentId, via: "AUTO" })))));
    }
    const elapsed = Date.now() - t0;
    const awarded = results.map((r) => unwrap(r)).filter((r) => r.status === "AWARDED");
    expect(awarded).toHaveLength(N);
    const seqs = await adminRows<{ reference_seq: string }>(db, "SELECT reference_seq::text AS reference_seq FROM higher.diploma_awards a WHERE tenant_id = $1 ORDER BY a.reference_seq", [s.tenantId]);
    expect(seqs.map((r) => Number(r.reference_seq))).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(awarded.map((r) => (r.status === "AWARDED" ? r.award.reference : ""))).size).toBe(N);
    console.info(`[higher] ${N} octrois concurrents : ${elapsed} ms, références continues 1..${N}`);
  }, 300_000);

  it("AC5.5/Q-22 : révocation motivée et terminale ; plus d'octroi automatique ; ré-octroi = décision écrite + permission", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const def = await oneUeDiploma(w, s, "LIC-REV");
    await capitalizeAll(w, s, st, [0]);
    completeCycle(w, s, st);
    const a = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" }));
    if (a.status !== "AWARDED") throw new Error("octroi attendu");

    const short = await revokeAward(w.deps, s.admin.ctx, { awardId: a.award.id, reason: "court" });
    expect(!short.ok && short.error.code).toBe("higher.revoke_reason_required");
    const revoked = unwrap(await revokeAward(w.deps, s.admin.ctx, { awardId: a.award.id, reason: "Fraude avérée sur un mémoire" }));
    expect(revoked).toMatchObject({ status: "REVOKED", revokeReason: "Fraude avérée sur un mémoire", revokedByName: "Directrice des études" });
    expect(w.audit.entries.find((e) => e.entry.action === "higher.award.revoked")?.entry).toMatchObject({ sensitive: true, reason: "Fraude avérée sur un mémoire" });
    expect((await events(s.tenantId, "higher.diploma.revoked"))[0]?.payload).toMatchObject({ awardId: a.award.id, reason: "Fraude avérée sur un mémoire" });
    const twice = await revokeAward(w.deps, s.admin.ctx, { awardId: a.award.id, reason: "Fraude avérée sur un mémoire" });
    expect(!twice.ok && twice.error.code).toBe("higher.award_already_revoked");

    // Terminal : l'évaluation automatique ne ré-octroie pas.
    expect(unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[0]!.nodeId }))).toMatchObject({ awarded: 0, skipped: { REVOKED_BEFORE: 1 } });
    // Octroi manuel sans autorisation exceptionnelle : refusé.
    const plain = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" });
    expect(!plain.ok && plain.error.code).toBe("higher.reaward_forbidden");
    const noDecision = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL", caps: CAPS.admin });
    expect(!noDecision.ok && noDecision.error.code).toBe("higher.reaward_forbidden");
    // Décision écrite + permission : ré-octroi lié au prédécesseur, nouvelle référence.
    const re = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL", caps: CAPS.admin, reawardDecision: "Décision DG n°2026/118 du 12/10/2026 (recours accepté)" }));
    expect(re.status === "AWARDED" && re.award).toMatchObject({ predecessorAwardId: a.award.id, reference: "DIP-2026-000002", status: "OBTAINED", reawardDecision: "Décision DG n°2026/118 du 12/10/2026 (recours accepté)" });
    expect(unwrap(await getAward(w.deps, s.admin.ctx, a.award.id)).status).toBe("REVOKED"); // l'historique est conservé
  });

  it("AC5.4 : modifier la définition ou le curriculum après l'octroi ne change pas l'octroi (snapshot figé)", async () => {
    const { w, s } = await fresh(1);
    const st = s.students[0]!;
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-SNAP" }));
    await capitalizeAll(w, s, st, [0, 1, 2]);
    completeCycle(w, s, st);
    const a = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" }));
    if (a.status !== "AWARDED") throw new Error("octroi attendu");
    const before = JSON.stringify(a.award.requirementsSnapshot);
    unwrap(await updateDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, uvRequired: 60, label: "Licence modifiée" }));
    unwrap(await replaceRequirements(w.deps, s.admin.ctx, { definitionId: def.definition.id, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    w.ports.curriculum.removeUe(s.ues[1]!.nodeId);
    const now = unwrap(await getAward(w.deps, s.admin.ctx, a.award.id));
    expect(JSON.stringify(now.requirementsSnapshot)).toBe(before);
    expect(now.requirementsSnapshot.uvRequired).toBe(18);
    expect(now.requirementsSnapshot.requirements).toHaveLength(3);
    expect(now.definitionHash).toBe(a.award.definitionHash);
    // Les écritures qui fondent l'octroi sont protégées : la révocation du crédit est refusée par la base.
    await expect(db.admin.query("UPDATE higher.credit_ledger SET status = 'REVOKED', revoked_at = now(), revoke_reason = 'x' WHERE tenant_id = $1 AND ue_node_id = $2", [s.tenantId, s.ues[0]!.nodeId])).rejects.toMatchObject({ message: expect.stringContaining("higher.credit_in_use") });
  });

  it("recompute de masse : octroie les étudiants éligibles du cycle, ignore les autres", async () => {
    const { w, s } = await fresh(3);
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-MASS" }));
    const [a, b, c] = s.students;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [...s.ues.map((u) => ueLine(s, a!, u)), ...s.ues.map((u) => ueLine(s, b!, u)), ueLine(s, c!, s.ues[0]!)]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    completeCycle(w, s, a!);
    completeCycle(w, s, b!);
    const r = unwrap(await recomputeDiploma(w.deps, s.admin.ctx, def.definition.id));
    expect(r).toMatchObject({ evaluated: 3, awarded: 2, failed: 0, skipped: { NOT_ELIGIBLE: 1 } });
    const view = unwrap(await getStudentDiplomaView(w.deps, s.admin.ctx, c!.studentId));
    expect(view.awards).toHaveLength(0);
    expect(view.progress[0]).toMatchObject({ eligible: false, progress: { uvValidated: 6, percent: 33 } });
  });
});
