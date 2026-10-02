/**
 * Isolation A/B (RLS forcée) sur Postgres RÉEL : aucune ligne d'un tenant n'est visible ni écrivable depuis un autre, pour les 18 tables
 * du module — et le contrôle STRUCTUREL de chacune (tenant_id, RLS forcée, policy unique, index en tête, droits).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { structuralIsolationViolations } from "../support/sql-harness";
import { DIRECTOR_CAPS, SECRETARY_CAPS, councilOn, freshClassroom, makeWorld, type TestWorld } from "../support/world";
import { getAgenda, prepareCouncil } from "../../application/agenda";
import { closeCouncil, getCouncilDetail, listCouncilsView, openCouncil, listParticipantsView } from "../../application/councils";
import { addProposal, recordDecision } from "../../application/deliberation";
import { generateMinutes, signMinutes } from "../../application/minutes";
import { instantiateCouncilsReferenceData } from "../../application/template";
import { requestUnlock } from "../../application/unlock";
import { createFile } from "../../application/orientation";

describeIntegration("isolation entre tenants (Postgres réel, RLS forcée)", () => {
  let db: ModuleTestDb;
  let a: TestWorld;
  let b: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    a = await makeWorld(db);
    b = await makeWorld(db);
    // des lignes dans (presque) toutes les tables du tenant A : séance close, PV signé, demande de déverrouillage, dossier d'orientation
    const cls = freshClassroom(a, { students: 1 });
    const council = await councilOn(a, cls, { scope: "YEAR" });
    const d = a.director.ctx;
    unwrap(await prepareCouncil(a.deps, d, DIRECTOR_CAPS, council.id));
    unwrap(await openCouncil(a.deps, d, DIRECTOR_CAPS, council.id, {}));
    const president = unwrap(await listParticipantsView(a.deps, d, DIRECTOR_CAPS, council.id)).find((p) => p.councilFunction === "PRESIDENT")!;
    const item = unwrap(await getAgenda(a.deps, d, DIRECTOR_CAPS, council.id)).items[0]!;
    unwrap(await addProposal(a.deps, d, DIRECTOR_CAPS, item.id, { kind: "REMARK", body: "Remarque de séance." }));
    unwrap(await recordDecision(a.deps, d, DIRECTOR_CAPS, item.id, { decisionTypeId: a.decisionTypes.PASSAGE!, deciderParticipantId: president.id, mode: "CONSENSUS" }));
    unwrap(await closeCouncil(a.deps, d, DIRECTOR_CAPS, council.id));
    const minutes = unwrap(await generateMinutes(a.deps, a.secretary.ctx, SECRETARY_CAPS, council.id));
    unwrap(await signMinutes(a.deps, d, DIRECTOR_CAPS, minutes.id));
    unwrap(await signMinutes(a.deps, a.secretary.ctx, SECRETARY_CAPS, minutes.id));
    unwrap(await requestUnlock(a.deps, a.secretary.ctx, SECRETARY_CAPS, council.id, { reason: "Vérification d'une erreur possible dans une décision." }));
    unwrap(await createFile(a.deps, d, { enrollmentId: cls.students[0]!.enrollmentId }));
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("les 18 tables du schéma : tenant_id, RLS forcée, policy unique, index en tête, droits app_user", async () => {
    const { tables, problems } = await structuralIsolationViolations(db.admin, "councils");
    expect(tables).toHaveLength(18);
    expect(problems).toEqual([]);
  });

  it("chaque tenant ne voit que ses lignes, table par table ; une écriture vers un autre tenant est refusée", async () => {
    const { tables } = await structuralIsolationViolations(db.admin, "councils");
    let withRows = 0;
    for (const table of tables) {
      for (const [world, other] of [[a, b], [b, a]] as const) {
        const seen = await db.tenantDb.run(world.director.ctx, async (tx) => (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM councils.${table}`))?.n ?? 0, { readOnly: true });
        const own = (await db.admin.query(`SELECT count(*)::int AS n FROM councils.${table} WHERE tenant_id = $1`, [world.tenantId])).rows[0].n;
        expect(seen, `${table} vu depuis ${world.tenantId}`).toBe(own);
        const leaked = await db.tenantDb.run(world.director.ctx, async (tx) => (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM councils.${table} WHERE tenant_id = $1`, [other.tenantId]))?.n ?? 0, { readOnly: true });
        expect(leaked, `${table} : lignes de l'autre tenant`).toBe(0);
        if (own > 0) withRows += 1;
      }
    }
    expect(withRows).toBeGreaterThanOrEqual(19); // 15 tables vivantes pour A + les 4 référentiels de B (sinon le contrôle serait vide)
    // WITH CHECK : B ne peut pas écrire dans les lignes de A
    await expect(db.tenantDb.run(b.director.ctx, (tx) => tx.query("INSERT INTO councils.participant_roles (id, tenant_id, code, label) VALUES (gen_random_uuid(), $1, 'INTRUS', 'Intrus')", [a.tenantId]))).rejects.toThrow(/row-level security/);
    const updated = await db.tenantDb.run(b.director.ctx, (tx) => tx.query("UPDATE councils.councils SET title = 'piraté'"));
    expect(updated.rowCount).toBe(0);
  });

  it("via les cas d'usage : une séance du tenant A est introuvable (404) pour le tenant B, et les listes sont disjointes", async () => {
    const listA = unwrap(await listCouncilsView(a.deps, a.director.ctx, DIRECTOR_CAPS, { page: 1, pageSize: 50 }));
    expect(listA.total).toBeGreaterThan(0);
    const listB = unwrap(await listCouncilsView(b.deps, b.director.ctx, DIRECTOR_CAPS, { page: 1, pageSize: 50 }));
    expect(listB.total).toBe(0);
    const id = listA.items[0]!.id;
    const foreign = await getCouncilDetail(b.deps, b.director.ctx, DIRECTOR_CAPS, id);
    expect(foreign.ok).toBe(false);
    expect(!foreign.ok && foreign.error.httpStatus).toBe(404);
  });

  it("l'instanciation du modèle de pack est idempotente par tenant et n'écrase jamais une personnalisation", async () => {
    await db.tenantDb.run(a.director.ctx, (tx) => tx.query("UPDATE councils.participant_roles SET label = 'Libellé personnalisé' WHERE code = 'TEACHER'"));
    const again = unwrap(await instantiateCouncilsReferenceData(a.deps, a.director.ctx, { institutionId: a.institutionId }));
    expect(again.created).toEqual({ roles: 0, councilTypes: 0, decisionTypes: 0, settings: 0 });
    const label = await db.admin.query("SELECT label FROM councils.participant_roles WHERE tenant_id = $1 AND code = 'TEACHER'", [a.tenantId]);
    expect(label.rows[0].label).toBe("Libellé personnalisé");
    const roles = await db.admin.query("SELECT tenant_id, count(*)::int AS n FROM councils.participant_roles GROUP BY tenant_id");
    expect(roles.rows.map((r) => r.n)).toEqual([7, 7]);
  });
});
