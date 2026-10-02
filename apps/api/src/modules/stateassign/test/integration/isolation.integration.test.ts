/**
 * Isolation multi-tenant du module : structure et comportement (`assertTenantIsolation`), puis un test A/B RÉEL avec les cas
 * d'usage sur les huit tables : le tenant B ne lit, ne modifie, ne rapproche, ne planifie ni n'exporte rien de A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import allowlist, { fixtures } from "../../../isolation-allowlist.stateassign";
import { actOnAssignment, amendAssignment, getAssignmentDetail, listAssignmentPage, recordAssignment, updateAssignment } from "../../application/assignments";
import { completeControl, planControl, waiveControl } from "../../application/controls";
import { addAssignmentDocument, withdrawAssignmentDocument } from "../../application/documents";
import { cancelReceivable, listReceivablePage, scheduleReceivable } from "../../application/receivables";
import { reconcileAssignment } from "../../application/reconciliation";
import { createFormat, exportCsv, getSummary, listFormats, updateFormat } from "../../application/reports";
import { getInstitutionSettings, updateInstitutionSettings } from "../../application/settings";
import { PEOPLE, createEnv, errorCodeOf, unwrapOk, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env?.close();
});

const TABLES = ["assignment_events", "assignments", "controls", "documents", "export_formats", "receivable_events", "receivables", "settings"];

describeIntegration("stateassign : isolation par tenant", () => {
  it("assertTenantIsolation : tables de tenant à RLS forcée, aucune table globale", async () => {
    expect(allowlist).toEqual([]);
    const report = await assertTenantIsolation({ pool: env.db.appPool, schemas: ["stateassign"], allowlist: allowlist.map((e) => e.table), fixtures });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    const all = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].sort();
    expect(all).toEqual(TABLES.map((t) => `stateassign.${t}`));
    expect(report.behavioural).toContain("stateassign.assignments");
  });

  it("A/B : le tenant B ne voit rien des huit tables de A et ne peut y écrire ni par SQL ni par les cas d'usage", async () => {
    const a = await env.tenant("iso-a");
    const b = await env.tenant("iso-b");
    // --- tout un dossier chez A -------------------------------------------------------------------------------------
    const e = env.enroll();
    const doc = uuid();
    env.world.documentIds.add(doc);
    const ctxA = (who: string) => env.user(a, who);
    const rec = unwrapOk(await recordAssignment(env.deps, ctxA(PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "ISO-A", declaredStateAmount: 400000, declaredParentAmount: 100000 }));
    unwrapOk(await actOnAssignment(env.deps, ctxA(PEOPLE.bursar), rec.id, "verify", {}));
    unwrapOk(await actOnAssignment(env.deps, ctxA(PEOPLE.bursar), rec.id, "activate", {}));
    const receivable = unwrapOk(await scheduleReceivable(env.deps, ctxA(PEOPLE.bursar), rec.id, { label: "1er", dueOn: "2027-01-15", expectedAmount: 100000 }));
    const control = unwrapOk(await planControl(env.deps, ctxA(PEOPLE.bursar), rec.id, { kind: "IDENTITY", dueOn: "2027-01-31" }));
    const document = unwrapOk(await addAssignmentDocument(env.deps, ctxA(PEOPLE.bursar), rec.id, { kind: "ASSIGNMENT_ORDER", documentRef: doc }, { read: true }));
    unwrapOk(await updateInstitutionSettings(env.deps, ctxA(PEOPLE.director), e.institutionId, { requireSeparateVerifier: true, reconciliationTolerance: 100, requiredControlKinds: [], controlDueOffsetDays: null, receivableGraceDays: 5 }));
    const format = unwrapOk(await createFormat(env.deps, ctxA(PEOPLE.bursar), { institutionId: e.institutionId, code: "iso-fmt", label: "F", dataset: "ASSIGNMENTS", columns: [{ key: "reference", header: "R" }], delimiter: ";", includeBom: true }));

    const ctxB = (who: string = PEOPLE.bursar) => env.user(b, who);
    // --- SQL : rien de visible ---------------------------------------------------------------------------------------
    for (const table of TABLES) {
      const n = await env.deps.db.run(ctxB(), async (tx) => (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM stateassign.${table}`))!.n);
      expect(n, table).toBe(0);
      const own = await env.db.admin.query(`SELECT count(*)::int AS n FROM stateassign.${table} WHERE tenant_id = $1`, [a]);
      expect(own.rows[0].n, `${table} : A garde ses lignes`).toBeGreaterThan(0);
    }
    // --- SQL : écritures croisées refusées ---------------------------------------------------------------------------
    const upd = await env.deps.db.run(ctxB(), (tx) => tx.query("UPDATE stateassign.assignments SET notes = 'piraté' WHERE id = $1", [rec.id]));
    expect(upd.rowCount).toBe(0);
    await expect(env.deps.db.run(ctxB(), (tx) => tx.query("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'IDENTITY','2027-02-01')", [uuid(), b, rec.id]))).rejects.toThrow(/foreign key|violates/);
    await expect(env.deps.db.run(ctxB(), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id) VALUES ($1,$2)", [a, uuid()]))).rejects.toThrow(/row-level security|violates/);
    // --- cas d'usage : tout répond « introuvable » pour B -----------------------------------------------------------
    expect(errorCodeOf(await getAssignmentDetail(env.deps, ctxB(), rec.id))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await actOnAssignment(env.deps, ctxB(PEOPLE.director), rec.id, "suspend", { reason: "Tentative inter-établissements" }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await updateAssignment(env.deps, ctxB(), rec.id, { notes: "x", rowVersion: 1 }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await amendAssignment(env.deps, ctxB(), rec.id, { reason: "Avenant illégitime", effectiveOn: "2027-01-01", declaredStateAmount: 1, rowVersion: 1 }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await reconcileAssignment(env.deps, ctxB(), rec.id))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await scheduleReceivable(env.deps, ctxB(), rec.id, { label: "x", dueOn: "2027-01-01", expectedAmount: 1 }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await cancelReceivable(env.deps, ctxB(), receivable.id, { reason: "Tentative inter-établissements", rowVersion: 1 }))).toBe("stateassign.receivable_not_found");
    expect(errorCodeOf(await planControl(env.deps, ctxB(), rec.id, { kind: "OTHER", dueOn: "2027-01-01" }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await completeControl(env.deps, ctxB(), control.id, { outcome: "OK" }))).toBe("stateassign.control_not_found");
    expect(errorCodeOf(await waiveControl(env.deps, ctxB(), control.id, { reason: "Tentative inter-établissements" }))).toBe("stateassign.control_not_found");
    expect(errorCodeOf(await addAssignmentDocument(env.deps, ctxB(), rec.id, { kind: "OTHER", documentRef: doc }, { read: true }))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await withdrawAssignmentDocument(env.deps, ctxB(), document.id, { reason: "Tentative inter-établissements" }))).toBe("stateassign.document_not_found");
    expect(errorCodeOf(await updateFormat(env.deps, ctxB(), format.id, { label: "piraté" }))).toBe("stateassign.export_format_not_found");
    // --- listes, états et exports : vides chez B ---------------------------------------------------------------------
    expect(unwrapOk(await listAssignmentPage(env.deps, ctxB(), { page: 1, pageSize: 50 } as never)).total).toBe(0);
    expect(unwrapOk(await listReceivablePage(env.deps, ctxB(), { page: 1, pageSize: 50 })).total).toBe(0);
    expect(unwrapOk(await listFormats(env.deps, ctxB(), {})).items).toEqual([]);
    expect(unwrapOk(await getSummary(env.deps, ctxB(), {})).assignmentsByStatus).toEqual({});
    expect(unwrapOk(await getInstitutionSettings(env.deps, ctxB(), e.institutionId)).isDefault).toBe(true);
    const csv = unwrapOk(await exportCsv(env.deps, ctxB(), { dataset: "ASSIGNMENTS" }));
    expect(csv.meta).toMatchObject({ rowCount: 0, totalCount: 0 });
    expect(csv.body).not.toContain("ISO-A");
    // et A n'a rien perdu
    expect(unwrapOk(await getAssignmentDetail(env.deps, ctxA(PEOPLE.bursar), rec.id)).assignment.status).toBe("ACTIVE");
  });

  it("l'historique des dossiers et des créances de A est invisible de B (événements en ajout seul)", async () => {
    const a = await env.tenant("iso-hist-a");
    const b = await env.tenant("iso-hist-b");
    const e = env.enroll();
    const rec = unwrapOk(await recordAssignment(env.deps, env.user(a, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "ISO-H", declaredStateAmount: 1000 }));
    unwrapOk(await actOnAssignment(env.deps, env.user(a, PEOPLE.bursar), rec.id, "verify", {}));
    const seenByB = await env.deps.db.run(env.user(b, PEOPLE.bursar), (tx) => tx.many("SELECT id FROM stateassign.assignment_events WHERE assignment_id = $1", [rec.id]));
    expect(seenByB).toEqual([]);
    const seenByA = await env.deps.db.run(env.user(a, PEOPLE.bursar), (tx) => tx.many("SELECT id FROM stateassign.assignment_events WHERE assignment_id = $1", [rec.id]));
    expect(seenByA.length).toBeGreaterThanOrEqual(2);
  });
});
