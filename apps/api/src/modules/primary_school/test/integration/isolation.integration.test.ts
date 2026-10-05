/**
 * Isolation multi-tenant (Postgres réel, rôle applicatif NON propriétaire : la RLS s'applique) : structure et comportement A/B de
 * chaque table du schéma, puis lecture croisée réelle sur toutes les tables après un parcours complet du tenant A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { unwrap } from "@ecoledigitale/kernel";
import allowlist, { fixtures } from "../../../isolation-allowlist.primary_school";
import { createFramework, publishFramework, putStructure } from "../../application/frameworks";
import { instantiatePrimaryReferenceData } from "../../application/template";
import { bulkRecordCompetencies } from "../../application/competencies";
import { prepareCouncil } from "../../application/council";
import { prepareAnnualReviews } from "../../application/reviews";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, ctxOf, depsOf, IDS } from "../support/world";

describeIntegration("primary_school : isolation par tenant (RLS forcée)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("iso-a");
    tenantB = await db.createTenant("iso-b");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("assertTenantIsolation : chaque table du schéma est isolée (tenant_id + RLS forcée, aucune table globale)", async () => {
    const report = await assertTenantIsolation({ pool: db.appPool, schemas: ["primary_school"], allowlist: allowlist.map((e) => e.table), fixtures: fixtures as never });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(allowlist).toEqual([]); // l'allowlist du module est VIDE
    // les tables sans clé étrangère composite obligatoire sont éprouvées en comportement (A ne voit pas B)
    expect(report.behavioural).toEqual(expect.arrayContaining(["primary_school.rating_scales", "primary_school.appreciation_phrases", "primary_school.settings", "primary_school.year_archives", "primary_school.council_minutes"]));
  });

  it("parcours complet du tenant A, puis lecture croisée : le tenant B ne voit AUCUNE ligne sur aucune table", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    unwrap(await instantiatePrimaryReferenceData(deps, admin, { institutionId: w.world.institutionId }));
    const scale = unwrap(await (await import("../../application/frameworks")).listScales(deps, admin))[0]!;
    const fw = unwrap(await createFramework(deps, admin, { code: "ISO_FW", label: "Test", scaleId: scale.id, gradeLevelCodes: ["CE1"], sourceKind: "placeholder" }));
    unwrap(await putStructure(deps, admin, fw.id, { domains: [{ code: "D", label: "Domaine", competencies: [{ code: "D.1", label: "C1" }] }] }));
    const published = unwrap(await publishFramework(deps, admin, fw.id));
    const competencyId = published.domains[0]!.competencies[0]!.id;
    unwrap(await bulkRecordCompetencies(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId: w.periods[0]!, frameworkId: published.id, lines: [{ enrollmentId: w.students.s1.enrollmentId, competencyId, ratingLevelId: scale.levels[0]!.id }] }, {}));
    unwrap(await prepareCouncil(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId: w.periods[2]! }, {}));
    unwrap(await prepareAnnualReviews(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, academicYearId: w.yearId }, {}));

    const tables = (await db.admin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'primary_school' ORDER BY table_name`)).rows.map((r) => r.table_name as string);
    expect(tables.length).toBe(18);
    const populated: string[] = [];
    for (const t of tables) {
      const a = (await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.${t} WHERE tenant_id = $1`, [tenantA])).rows[0].n as number;
      if (a > 0) populated.push(t);
      const seenByB = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM primary_school.${t}`), { readOnly: true });
      expect(seenByB?.n, `le tenant B voit des lignes de ${t}`).toBe(0);
      const seenByA = await db.tenantDb.run(admin, (tx) => tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM primary_school.${t}`), { readOnly: true });
      expect(seenByA?.n, `le tenant A ne voit pas ses propres lignes de ${t}`).toBe(a);
    }
    // le parcours a réellement peuplé les tables principales (la preuve n'est pas vide)
    expect(populated).toEqual(expect.arrayContaining(["rating_scales", "rating_levels", "competency_frameworks", "competencies", "competency_assessments", "council_cases", "council_attendance", "annual_reviews", "settings", "appreciation_phrases", "template_applications"]));
    // lecture par identifiant d'une ligne de A sous le contexte de B : aucune ligne
    const id = (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 LIMIT 1`, [tenantA])).rows[0].id as string;
    const cross = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.many(`SELECT id FROM primary_school.annual_reviews WHERE id = $1`, [id]), { readOnly: true });
    expect(cross).toEqual([]);
    // mise à jour croisée : aucune ligne touchée
    const updated = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.query(`UPDATE primary_school.annual_reviews SET grade_level_code = 'CM2' WHERE id = $1`, [id]));
    expect(updated.rowCount).toBe(0);
  });
});
