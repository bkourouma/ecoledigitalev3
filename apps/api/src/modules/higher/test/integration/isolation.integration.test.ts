import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { higherIsolationAllowlistTables, higherIsolationFixtures, higherTenantTables } from "../../../isolation-allowlist.higher";
import { declareAnnualUe, listAnnualUes } from "../../application/annual-ue";
import { awardDiploma, getAward, listAwards, revokeAward } from "../../application/awards";
import { grantExemption, listExemptions } from "../../application/exemptions";
import { createDiploma, getDiploma } from "../../application/diplomas";
import { assignSlot, getDocument, issueAwardDocument, listDocuments, listSlots } from "../../application/documents";
import { capitalizePeriod, getCreditSummary, listAcquiredUe, listDebts } from "../../application/ledger";
import { setPrerequisites, getPrerequisites } from "../../application/prerequisites";
import { getResitWindow, openResitWindow } from "../../application/resit";
import { getHigherSettings, updateHigherSettings } from "../../application/settings";
import { adminOne, adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

describeIntegration("isolation multi-tenant et invariants de la base (Postgres réel)", () => {
  let db: HigherTestDb;
  let world: TestWorld;
  let a: School;
  let tenantB: string;
  let awardA: string;
  let documentA: string;
  let windowA: string;
  let definitionA: string;

  beforeAll(async () => {
    db = await createHigherTestDb();
    world = makeWorld(db);
    scriptRules(world);
    a = await seedSchool(db, world, { students: 2 });
    tenantB = await db.createTenant();
    const [s1, s2] = a.students;
    const ctx = a.admin.ctx;
    // Une donnée dans CHAQUE table du schéma, côté A.
    unwrap(await updateHigherSettings(world.deps, ctx, { creditValidityMonths: 60 }));
    const def = unwrap(await createDiploma(world.deps, ctx, { code: "ISO-A", label: "Licence A", gradeCode: "LICENCE", curriculumNodeId: a.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: a.ues[0]!.nodeId }] }));
    definitionA = def.definition.id;
    world.ports.credits.setFinalLines(a.classroomId, a.periodId, [
      ueLine(a, s1!, a.ues[0]!),
      ueLine(a, s2!, a.ues[1]!, { validated: false, ueState: "DEBT", sessionObtained: null }),
    ]);
    unwrap(await capitalizePeriod(world.deps, ctx, { classroomId: a.classroomId, academicPeriodId: a.periodId }));
    world.ports.cycleResults.set(s1!.studentId, a.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: a.periodId, academicYearId: a.yearId, average: "13", credits: 6 }] });
    const award = unwrap(await awardDiploma(world.deps, ctx, { definitionId: definitionA, studentId: s1!.studentId, via: "MANUAL" }));
    if (award.status !== "AWARDED") throw new Error("octroi attendu");
    awardA = award.award.id;
    unwrap(await assignSlot(world.deps, ctx, { slotKey: "DIPLOMA_LEFT", signatoryId: a.signatories.left, validFrom: "2026-01-01" }));
    unwrap(await assignSlot(world.deps, ctx, { slotKey: "DIPLOMA_RIGHT", signatoryId: a.signatories.right, validFrom: "2026-01-01" }));
    documentA = unwrap(await issueAwardDocument(world.deps, ctx, { awardId: awardA, kind: "DIPLOMA" })).document.id;
    unwrap(await setPrerequisites(world.deps, ctx, { ueNodeId: a.ues[1]!.nodeId, prerequisites: [{ prerequisiteNodeId: a.ues[0]!.nodeId }] }));
    world.ports.credits.setResitCandidates(a.classroomId, a.periodId, {
      stateId: newId(),
      candidates: [{ enrollmentId: s2!.enrollmentId, studentId: s2!.studentId, ecueNodeId: newId(), ueNodeId: a.ues[1]!.nodeId, session1Average: "7.5" }],
    });
    windowA = unwrap(await openResitWindow(world.deps, ctx, { classroomId: a.classroomId, academicPeriodId: a.periodId, opensOn: "2026-10-05", closesOn: "2026-10-19" })).window.id;
    // O-11 : une UE annuelle (deux UE hors cycle des diplômes) et la partie d'un semestre reçue ; O-14 : une dispense.
    const annualA = { nodeId: newId(), code: "UEA1", label: "UE annuelle A1", credits: 4 };
    const annualB = { nodeId: newId(), code: "UEA2", label: "UE annuelle A2", credits: 4 };
    world.ports.curriculum.addUe({ ...annualA, programNodeId: a.programNodeId });
    world.ports.curriculum.addUe({ ...annualB, programNodeId: a.programNodeId });
    unwrap(await declareAnnualUe(world.deps, ctx, { ueNodeId: annualA.nodeId, memberNodeIds: [annualB.nodeId], reason: "UE annuelle d'isolation" }));
    world.ports.credits.setFinalLines(a.classroomId, a.period2Id, [ueLine(a, s1!, annualA, { academicPeriodId: a.period2Id })]);
    unwrap(await capitalizePeriod(world.deps, ctx, { classroomId: a.classroomId, academicPeriodId: a.period2Id }));
    unwrap(await grantExemption(world.deps, ctx, { studentId: s2!.studentId, enrollmentId: s2!.enrollmentId, ueNodeId: a.ues[2]!.nodeId, academicPeriodId: a.periodId, reason: "Dispense d'isolation accordée" }));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test d'isolation générique : structure + comportement de chaque table du schéma higher, allowlist vide", async () => {
    const options = { pool: db.appPool, schemas: ["higher"], allowlist: higherIsolationAllowlistTables, fixtures: higherIsolationFixtures as never };
    const report = await checkTenantIsolation(options);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.allowlisted).toEqual([]);
    const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
    expect([...covered].sort()).toEqual([...higherTenantTables].sort());
    console.info(`[higher] isolation : ${report.behavioural.length} tables testées en comportement, ${report.structuralOnly.length} en structure (FK composites)`);
    await assertTenantIsolation(options);
  });

  it("aucune table du schéma n'échappe à la liste attendue ; RLS activée ET forcée partout", async () => {
    const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'higher' AND table_type = 'BASE TABLE' ORDER BY 1");
    expect(tables.map((r) => r.t)).toEqual([...higherTenantTables].sort());
    const noRls = await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'higher' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls).toEqual([]);
  });

  it("sous le tenant B, AUCUNE ligne du tenant A n'est visible ni modifiable dans AUCUNE des 16 tables", async () => {
    const b = ctxFor(tenantB);
    for (const table of higherTenantTables) {
      const own = Number((await adminOne<{ n: string }>(db, `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [a.tenantId])).n);
      expect(own, `${table} doit contenir une ligne de A`).toBeGreaterThan(0);
      const seen = await db.tenantDb.run(b, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [a.tenantId]));
      expect(seen, table).toHaveLength(0);
      const all = await db.tenantDb.run(b, (tx) => tx.many(`SELECT * FROM ${table}`));
      expect(all, table).toHaveLength(0);
    }
    const upd = await db.tenantDb.run(b, (tx) => tx.query("UPDATE higher.credit_ledger SET status = status"));
    expect(upd.rowCount).toBe(0);
    const del = await db.tenantDb.run(b, (tx) => tx.query("DELETE FROM higher.diploma_definitions"));
    expect(del.rowCount).toBe(0);
    // Sans contexte de tenant : rien n'est visible ni insérable (échec fermé).
    const client = await db.appPool.connect();
    try {
      expect((await client.query("SELECT count(*)::int AS n FROM higher.credit_ledger")).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO higher.settings (tenant_id, credit_validity_months) VALUES ($1, 3)", [a.tenantId])).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
    // Le compteur de numérotation est PAR tenant : le tenant B démarre à 1, A n'est pas affecté.
    const nextB = await db.tenantDb.run(b, async (tx) => (await tx.queryOne<{ n: string }>("SELECT higher.next_number('DIPLOMA', 2026)::text AS n"))!.n);
    expect(nextB).toBe("1");
    expect(Number((await adminOne<{ v: string }>(db, "SELECT last_value::text AS v FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [a.tenantId])).v)).toBe(1);
  });

  it("cas d'usage : le tenant B ne lit, n'octroie, ne révoque, n'émet ni n'ouvre rien sur les objets du tenant A", async () => {
    const b = ctxFor(tenantB, newId(), ["directeur"], true);
    const code = async (r: Promise<{ ok: boolean; error?: { code: string } }>) => {
      const x = await r;
      return x.ok ? "OK" : x.error?.code;
    };
    expect(await code(getDiploma(world.deps, b, definitionA))).toBe("higher.diploma_not_found");
    expect(await code(getAward(world.deps, b, awardA))).toBe("higher.award_not_found");
    expect(await code(revokeAward(world.deps, b, { awardId: awardA, reason: "Tentative de révocation inter-tenant" }))).toBe("higher.award_not_found");
    expect(await code(getDocument(world.deps, b, documentA))).toBe("higher.document_not_found");
    expect(await code(getResitWindow(world.deps, b, windowA))).toBe("higher.resit_window_not_found");
    expect(await code(awardDiploma(world.deps, b, { definitionId: definitionA, studentId: a.students[1]!.studentId, via: "MANUAL" }))).toBe("higher.diploma_not_found");
    expect(await code(issueAwardDocument(world.deps, b, { awardId: awardA, kind: "DIPLOMA" }))).toBe("higher.award_not_found");
    expect(unwrap(await listAwards(world.deps, b)).items).toHaveLength(0);
    expect(unwrap(await listDocuments(world.deps, b)).items).toHaveLength(0);
    expect(unwrap(await listSlots(world.deps, b))).toHaveLength(0);
    expect(unwrap(await listAcquiredUe(world.deps, b, a.students[0]!.studentId))).toHaveLength(0);
    expect(unwrap(await getCreditSummary(world.deps, b, a.students[0]!.studentId))).toMatchObject({ totalCredits: 0, acquiredUeCount: 0 });
    expect(unwrap(await listDebts(world.deps, b, a.students[1]!.studentId))).toHaveLength(0);
    expect(unwrap(await getPrerequisites(world.deps, b, a.ues[1]!.nodeId))).toHaveLength(0);
    expect(unwrap(await getHigherSettings(world.deps, b))).toEqual({ creditValidityMonths: null });
    // O-11 / O-14 : ni UE annuelle ni dispense visibles depuis B
    expect(unwrap(await listAnnualUes(world.deps, b))).toHaveLength(0);
    expect(unwrap(await listExemptions(world.deps, b))).toHaveLength(0);
    // Côté A, tout est intact.
    expect(unwrap(await listAnnualUes(world.deps, a.admin.ctx))).toHaveLength(1);
    expect(unwrap(await listExemptions(world.deps, a.admin.ctx))).toHaveLength(1);
    expect(unwrap(await getAward(world.deps, a.admin.ctx, awardA)).status).toBe("OBTAINED");
    expect(unwrap(await getHigherSettings(world.deps, a.admin.ctx))).toEqual({ creditValidityMonths: 60 });
  });

  describe("invariants imposés par la base (superuser : seules les contraintes et déclencheurs jugent)", () => {
    const q = (sql: string, params: unknown[] = []) => db.admin.query(sql, params);

    it("registre : contenu immuable, jamais supprimé, une seule acquisition valide par (étudiant, UE), transitions légales", async () => {
      const row = await adminOne<{ id: string; student_id: string; ue_node_id: string }>(db, "SELECT id, student_id, ue_node_id FROM higher.credit_ledger WHERE tenant_id = $1 LIMIT 1", [a.tenantId]);
      await expect(q("UPDATE higher.credit_ledger SET credits = 99 WHERE id = $1", [row.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("UPDATE higher.credit_ledger SET average_exact = 20 WHERE id = $1", [row.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("DELETE FROM higher.credit_ledger WHERE id = $1", [row.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      // Doublon d'acquisition : refusé par l'index unique partiel.
      await expect(
        q(
          `INSERT INTO higher.credit_ledger (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits, acquired_via, session_obtained, source_result_id, source_results_version, acquired_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,6,'DIRECT',1,$8,1, now())`,
          [newId(), a.tenantId, row.student_id, newId(), row.ue_node_id, a.yearId, a.periodId, newId()],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      // Cohérence origine / session, jury sans référence, crédits négatifs : refusés par CHECK.
      const raw = (credits: number, via: string, session: number, override: string | null) =>
        q(
          `INSERT INTO higher.credit_ledger (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits, acquired_via, session_obtained, override_id, source_result_id, source_results_version, acquired_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1, now())`,
          [newId(), a.tenantId, newId(), newId(), newId(), a.yearId, a.periodId, credits, via, session, override, newId()],
        );
      await expect(raw(-1, "DIRECT", 1, null)).rejects.toMatchObject({ code: "23514" });
      await expect(raw(6, "JURY_OVERRIDE", 1, null)).rejects.toMatchObject({ code: "23514" });
      await expect(raw(6, "DIRECT", 2, null)).rejects.toMatchObject({ code: "23514" });
      await expect(raw(6, "RESIT", 1, null)).rejects.toMatchObject({ code: "23514" });
      await raw(6, "RESIT", 2, null); // session 2 <-> origine RESIT : accepté
      // Une écriture soutenant un octroi ne peut être révoquée.
      const supporting = await adminOne<{ id: string }>(db, "SELECT id FROM higher.credit_ledger WHERE tenant_id = $1 AND student_id = $2 AND ue_node_id = $3", [a.tenantId, a.students[0]!.studentId, a.ues[0]!.nodeId]);
      await expect(q("UPDATE higher.credit_ledger SET status = 'EXPIRED', expired_at = now() WHERE id = $1", [supporting.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.credit_in_use") });
    });

    it("octrois : unique non révoqué, révocation terminale et motivée, contenu figé, jamais supprimé, forcé motivé", async () => {
      const s1 = a.students[0]!;
      await expect(
        q(
          `INSERT INTO higher.diploma_awards (id, tenant_id, definition_id, student_id, reference, reference_year, reference_seq, awarded_via, credits_total, requirements_snapshot, eligibility,
              rule_set_code, rule_version_id, rule_version_no, definition_hash, awarded_at, awarded_by_name, acquired_date)
           VALUES ($1,$2,$3,$4,'DIP-2026-000777',2026,777,'AUTO',6,'{}','{}','X',$5,1,'h',now(),'Système',current_date)`,
          [newId(), a.tenantId, definitionA, s1.studentId, newId()],
        ),
      ).rejects.toMatchObject({ code: "23505" }); // un seul octroi OBTAINED par (définition, étudiant)
      await expect(q("UPDATE higher.diploma_awards SET credits_total = 99 WHERE id = $1", [awardA])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("UPDATE higher.diploma_awards SET requirements_snapshot = '{}'::jsonb WHERE id = $1", [awardA])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("UPDATE higher.diploma_awards SET reference = 'DIP-2026-000099' WHERE id = $1", [awardA])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("DELETE FROM higher.diploma_awards WHERE id = $1", [awardA])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
      await expect(q("UPDATE higher.diploma_awards SET status = 'REVOKED', revoked_at = now(), revoke_reason = 'court' WHERE id = $1", [awardA])).rejects.toMatchObject({ code: "23514" }); // motif < 10 caractères
      await expect(q("DELETE FROM higher.diploma_definitions WHERE id = $1", [definitionA])).rejects.toMatchObject({ message: expect.stringContaining("higher.definition_has_awards") });
    });

    it("compteurs : n'avancent que de 1, ne se suppriment pas", async () => {
      await expect(q("UPDATE higher.number_counters SET last_value = last_value + 5 WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [a.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.counter_monotonic") });
      await expect(q("UPDATE higher.number_counters SET last_value = 0 WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [a.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.counter_monotonic") });
      await expect(q("DELETE FROM higher.number_counters WHERE tenant_id = $1", [a.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    });

    it("emplacements : deux affectations qui se chevauchent sont refusées par la base ; seule la fin de validité change", async () => {
      await expect(
        q("INSERT INTO higher.official_document_slots (id, tenant_id, slot_key, signatory_id, valid_from, created_by, created_at) VALUES ($1,$2,'DIPLOMA_LEFT',$3,'2026-06-01',$4, now())", [newId(), a.tenantId, newId(), newId()]),
      ).rejects.toMatchObject({ code: "23P01" });
      const slot = await adminOne<{ id: string }>(db, "SELECT id FROM higher.official_document_slots WHERE tenant_id = $1 AND slot_key = 'DIPLOMA_LEFT'", [a.tenantId]);
      await expect(q("UPDATE higher.official_document_slots SET signatory_id = $2 WHERE id = $1", [slot.id, newId()])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    });

    it("fenêtres : une seule ouverte par (classe, période)", async () => {
      await expect(
        q("INSERT INTO higher.resit_windows (id, tenant_id, classroom_id, academic_period_id, opens_on, closes_on, status, opened_by, opened_at) VALUES ($1,$2,$3,$4,'2026-11-01','2026-11-10','OPEN',$5, now())", [newId(), a.tenantId, a.classroomId, a.periodId, newId()]),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("migrations rejouables : le schéma se recrée sur une base vierge (idempotence du runner)", async () => {
      const other = await createHigherTestDb(2);
      try {
        const n = await other.admin.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'higher'");
        expect(n.rows[0].n).toBe(higherTenantTables.length);
      } finally {
        await other.drop();
      }
    });
  });
});
