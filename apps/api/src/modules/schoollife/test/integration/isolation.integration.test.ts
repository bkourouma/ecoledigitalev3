/**
 * Isolation multi-tenant (RLS) de la vie scolaire sur Postgres réel : contrôle générique de la plateforme (structure de
 * chaque table + comportement A/B quand la ligne est fabricable), puis scénarios métier A/B par les cas d'usage et en SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { createRequestContext, unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../../isolation-allowlist.schoollife";
import { declareIncident, getIncidentView } from "../../application/incidents";
import { getMeasureView, proposeMeasure, validateMeasure } from "../../application/measures";
import { getStudentLife } from "../../application/dossier";
import { getReference } from "../../application/reference";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, EDUCATOR_CAPS, makeWorld, type TestWorld } from "../support/world";

const TABLES = [
  "schoollife.conduct_movements",
  "schoollife.conduct_scale_items",
  "schoollife.conduct_scales",
  "schoollife.confidential_reads",
  "schoollife.convocations",
  "schoollife.event_types",
  "schoollife.incident_involvements",
  "schoollife.incidents",
  "schoollife.job_notifications",
  "schoollife.life_events",
  "schoollife.measure_appeals",
  "schoollife.measure_effects",
  "schoollife.measures",
  "schoollife.notes",
  "schoollife.settings",
  "schoollife.severity_levels",
];

describeIntegration("vie scolaire : isolation multi-tenant (Postgres réel)", () => {
  let db: ModuleTestDb;
  let a: TestWorld;
  let b: TestWorld;
  let incidentA: string;
  let measureA: string;

  beforeAll(async () => {
    db = await createModuleTestDb();
    a = await makeWorld(db);
    b = await makeWorld(db);
    incidentA = unwrap(
      await declareIncident(a.deps, a.educator.ctx, EDUCATOR_CAPS, { typeId: a.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Fait du tenant A", involvements: [{ enrollmentId: a.students[0]!.enrollmentId, role: "AUTHOR" }] }),
    ).id;
    const m = unwrap(await proposeMeasure(a.deps, a.educator.ctx, EDUCATOR_CAPS, { enrollmentId: a.students[0]!.enrollmentId, typeId: a.types.SANC, reason: "Motif du tenant A" }));
    unwrap(await validateMeasure(a.deps, a.director2.ctx, DIRECTOR_CAPS, m.id, {}));
    measureA = m.id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("test générique de la plateforme : 16 tables, RLS forcée, allowlist VIDE (aucune table globale)", async () => {
    expect(allowlist).toEqual([]);
    const options = { pool: db.appPool, schemas: ["schoollife"], allowlist: [] as string[] };
    const report = await checkTenantIsolation(options);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    const covered = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].sort();
    expect(covered).toEqual([...TABLES].sort());
    console.info(`[schoollife] isolation : ${report.behavioural.length} tables en comportement, ${report.structuralOnly.length} en structure (déclencheurs d'acteur humain)`);
    await assertTenantIsolation(options);
  });

  it("aucune table hors liste ; RLS activée ET forcée partout ; aucun DELETE accordé à app_user", async () => {
    const tables = await db.admin.query("SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'schoollife' AND table_type = 'BASE TABLE' ORDER BY 1");
    expect(tables.rows.map((r) => r.t)).toEqual([...TABLES].sort());
    const noRls = await db.admin.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'schoollife' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls.rows).toEqual([]);
    const deletes = await db.admin.query("SELECT table_name FROM information_schema.role_table_grants WHERE table_schema = 'schoollife' AND grantee = 'app_user' AND privilege_type = 'DELETE' ORDER BY 1");
    // Seules les valeurs d'un barème BROUILLON se suppriment (déclencheur : refus dès que le barème est actif ou retiré).
    expect(deletes.rows.map((r) => r.table_name)).toEqual(["conduct_scale_items"]);
  });

  it("sous le tenant B, AUCUNE ligne du tenant A n'est visible ni modifiable, dans aucune table", async () => {
    for (const table of TABLES) {
      const rows = await db.tenantDb.run(b.director.ctx, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [a.tenantId]));
      expect(rows, table).toHaveLength(0);
    }
    expect((await db.tenantDb.run(a.director.ctx, (tx) => tx.many("SELECT id FROM schoollife.measures"))).length).toBeGreaterThan(0);
    const upd = await db.tenantDb.run(b.director.ctx, (tx) => tx.query("UPDATE schoollife.incidents SET description = 'piraté'"));
    expect(upd.rowCount).toBe(0);
    expect(Number((await db.admin.query("SELECT count(*) AS n FROM schoollife.incidents WHERE description = 'piraté'")).rows[0].n)).toBe(0);
    // Sans contexte de tenant : rien n'est visible ni insérable (échec fermé).
    const client = await db.appPool.connect();
    try {
      expect((await client.query("SELECT count(*)::int AS n FROM schoollife.measures")).rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("cas d'usage : le tenant B ne lit ni l'incident, ni la mesure, ni le dossier du tenant A, même avec les pleins pouvoirs", async () => {
    const ctxB = createRequestContext({ tenantId: b.tenantId, userId: b.director.userId, roles: [] });
    const incident = await getIncidentView(a.deps, ctxB, DIRECTOR_CAPS, incidentA);
    expect(incident.ok).toBe(false);
    const measure = await getMeasureView(a.deps, ctxB, DIRECTOR_CAPS, measureA);
    expect(measure.ok).toBe(false);
    const life = unwrap(await getStudentLife(a.deps, ctxB, DIRECTOR_CAPS, { studentId: a.students[0]!.studentId }));
    expect(life.incidents).toEqual([]);
    expect(life.measures).toEqual([]);
    expect(life.history).toEqual([]);
    // les types d'événements d'un tenant sont inconnus de l'autre (clés étrangères composites)
    const cross = await proposeMeasure(b.deps, b.educator.ctx, EDUCATOR_CAPS, { enrollmentId: b.students[0]!.enrollmentId, typeId: a.types.WARN, reason: "Type d'un autre tenant" });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe("schoollife.type_not_found");
    const ref = unwrap(await getReference(b.deps, b.director.ctx));
    expect(ref.eventTypes.map((t) => t.id)).not.toContain(a.types.WARN);
  });

  it("clés étrangères composites : une ligne ne peut pas pointer la ligne d'un autre tenant", async () => {
    await expect(
      db.admin.query(
        `INSERT INTO schoollife.incident_involvements (id, tenant_id, incident_id, enrollment_id, student_id, role) VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), gen_random_uuid(), 'AUTHOR')`,
        [b.tenantId, incidentA],
      ),
    ).rejects.toThrow(/foreign key|violates|human_actor/);
  });
});
