/**
 * Comportement de la BASE (migrations 2300-2303), sous le rôle applicatif soumis à la RLS : les 12 tests du DDL de référence de
 * `specs/v2/006-secondary/ddl-test/stateassign.test.mjs` repris (même invariants, mêmes messages), plus les invariants ajoutés par
 * ce module (créances sur l'État, formats d'export, réglages, `control.due`). Chaque instruction s'exécute dans sa propre
 * transaction `TenantDb.run` : un refus de la base annule seulement cette instruction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { PEOPLE, createEnv, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
const { secretary: SECRETARY, bursar: BURSAR } = PEOPLE;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env?.close();
});

/** Un contexte utilisateur (HUMAIN) ou système (job) sur un tenant. */
const user = (tenant: string, who: string = SECRETARY) => env.user(tenant, who);
const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> => env.db.tenantDb.run(ctx, fn);

interface AssignmentCols {
  institution?: string;
  year?: string;
  enrollment?: string;
  student?: string;
  reference?: string;
  version?: number;
  supersedes?: string | null;
  source?: string;
  state?: number | null;
  parent?: number | null;
  receivedBy?: string | null;
  hash?: string | null;
}

async function insertAssignment(ctx: RequestContext, c: AssignmentCols = {}): Promise<{ id: string; institution: string; year: string; enrollment: string; student: string }> {
  const id = uuid();
  const institution = c.institution ?? uuid();
  const year = c.year ?? uuid();
  const enrollment = c.enrollment ?? uuid();
  const student = c.student ?? uuid();
  await run(ctx, (tx) =>
    tx.query(
      `INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, version, supersedes_id,
         assignment_reference, issued_on, issuing_authority, source, external_payload_hash, declared_state_amount, declared_parent_amount, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-09-15','Autorité d''affectation (libellé libre)',$10,$11,$12,$13,$14)`,
      [id, ctx.tenantId, institution, year, enrollment, student, c.version ?? 1, c.supersedes ?? null, c.reference ?? `REF-${uuid().slice(0, 8)}`, c.source ?? "MANUAL", c.hash ?? null, c.state === undefined ? 400000 : c.state, c.parent === undefined ? 100000 : c.parent, c.receivedBy === undefined ? SECRETARY : c.receivedBy],
    ),
  );
  return { id, institution, year, enrollment, student };
}

const statusOf = async (ctx: RequestContext, id: string): Promise<string> =>
  run(ctx, async (tx) => (await tx.queryOne<{ status: string }>("SELECT status FROM stateassign.assignments WHERE id = $1", [id]))!.status);

const update = (ctx: RequestContext, id: string, set: string, params: unknown[] = []) =>
  run(ctx, (tx) => tx.query(`UPDATE stateassign.assignments SET ${set} WHERE id = $1`, [id, ...params]));

/** Dossier vérifié (par le trésorier) puis activé. */
async function activeAssignment(tenant: string, c: AssignmentCols = {}) {
  const a = await insertAssignment(user(tenant), c);
  await update(user(tenant, BURSAR), a.id, "status = 'VERIFIED', verification_note = 'Pièces conformes'");
  await update(user(tenant, BURSAR), a.id, "status = 'ACTIVE'");
  return a;
}

describeIntegration("stateassign : comportement de la base (DDL de référence + créances)", () => {
  it("1. RLS forcée sur les 8 tables ; FK composites ; aucun DELETE ; aucun réglage par défaut", async () => {
    const a = await env.tenant();
    const b = await env.tenant();
    const inA = await insertAssignment(user(a));
    // le tenant B ne voit rien de A, et ne peut pas rattacher un contrôle à un dossier de A (FK composite)
    await run(user(b), async (tx) => {
      expect((await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM stateassign.assignments"))!.n).toBe(0);
      expect((await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM stateassign.settings"))!.n).toBe(0);
    });
    await expect(run(user(b), (tx) => tx.query("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'ATTENDANCE','2026-12-01')", [uuid(), b, inA.id]))).rejects.toThrow(/foreign key|violates/);
    await expect(run(user(a), (tx) => tx.query("DELETE FROM stateassign.assignments"))).rejects.toThrow(/permission denied/);
    await expect(run(user(a), (tx) => tx.query("DELETE FROM stateassign.assignment_events"))).rejects.toThrow(/permission denied/);
    await expect(run(user(a), (tx) => tx.query("DELETE FROM stateassign.receivables"))).rejects.toThrow(/permission denied/);
    await expect(run(user(a), (tx) => tx.query("DELETE FROM stateassign.receivable_events"))).rejects.toThrow(/permission denied/);
    // structure : tenant_id + RLS forcée sur chaque table du schéma
    const rows = await env.db.admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'stateassign' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(rows.rows.map((r: { relname: string }) => r.relname)).toEqual(["assignment_events", "assignments", "controls", "documents", "export_formats", "receivable_events", "receivables", "settings"]);
    for (const r of rows.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
      expect(r.has_tenant, r.relname).toBe(true);
    }
  });

  it("2. création manuelle par un utilisateur identifié ; import par un job ; référence nettoyée ; montants entiers positifs", async () => {
    const t = await env.tenant();
    const { id } = await insertAssignment(user(t), { reference: "  AFF-2026-001  " });
    expect(await run(user(t), async (tx) => (await tx.queryOne<{ r: string }>("SELECT assignment_reference AS r FROM stateassign.assignments WHERE id = $1", [id]))!.r)).toBe("AFF-2026-001");
    // l'enregistrant est l'utilisateur de la session
    await expect(insertAssignment(user(t), { receivedBy: BURSAR })).rejects.toThrow(/receiver_mismatch/);
    await expect(insertAssignment(user(t), { state: -1 })).rejects.toThrow(/check/);
    // un import est écrit par le système, sans enregistrant humain
    const imp = await insertAssignment(env.system(t), { source: "IMPORT", receivedBy: null, reference: "IMP-1" });
    expect(imp.id).toBeTruthy();
    await expect(insertAssignment(env.system(t), { source: "MANUAL", receivedBy: null })).rejects.toThrow(/human_actor_required|check/);
    await expect(insertAssignment(env.system(t), { source: "GATEWAY", receivedBy: null })).rejects.toThrow(/check/); // empreinte de l'échange requise
    const gw = await insertAssignment(env.system(t), { source: "GATEWAY", receivedBy: null, hash: "a".repeat(64) });
    expect(gw.id).toBeTruthy();
  });

  it("3. un dossier vivant par inscription ; une référence par établissement et année (hors rejeté ou remplacé)", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const enrollment = uuid();
    const first = await insertAssignment(user(t), { institution: inst, year, enrollment, reference: "R-1" });
    await expect(insertAssignment(user(t), { institution: inst, year, enrollment, reference: "R-2" })).rejects.toThrow(/unique/);
    await expect(insertAssignment(user(t), { institution: inst, year, reference: "R-1" })).rejects.toThrow(/unique/);
    await update(user(t), first.id, "status = 'REJECTED', rejection_reason = 'Acte non reconnu'");
    // la référence et l'inscription sont libérées par le rejet
    const again = await insertAssignment(user(t), { institution: inst, year, enrollment, reference: "R-1" });
    expect(again.id).toBeTruthy();
  });

  it("4. vérification : acte humain ; l'enregistrant ne vérifie pas son propre dossier ; le vérificateur est la session", async () => {
    const t = await env.tenant();
    const { id } = await insertAssignment(user(t));
    await expect(update(user(t), id, "status = 'VERIFIED'")).rejects.toThrow(/four_eyes_required/);
    await expect(update(user(t), id, "status = 'ACTIVE'")).rejects.toThrow(/transition/);
    await expect(update(env.system(t), id, "status = 'VERIFIED'")).rejects.toThrow(/human_actor_required/);
    await update(user(t, BURSAR), id, "status = 'VERIFIED', verified_by = $2", [SECRETARY]);
    const row = await run(user(t), async (tx) => (await tx.queryOne<{ verified_by: string; verified_at: Date }>("SELECT verified_by, verified_at FROM stateassign.assignments WHERE id = $1", [id]))!);
    expect(row.verified_by).toBe(BURSAR); // vérificateur = utilisateur de la session, non falsifiable
    expect(row.verified_at).toBeTruthy();
  });

  it("5. réglage : séparation des tâches désactivable ; alors l'enregistrant peut vérifier", async () => {
    const t = await env.tenant();
    const inst = uuid();
    await run(user(t), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, require_separate_verifier) VALUES ($1,$2,false)", [t, inst]));
    const { id } = await insertAssignment(user(t), { institution: inst });
    await update(user(t), id, "status = 'VERIFIED'");
    expect(await statusOf(user(t), id)).toBe("VERIFIED");
  });

  it("6. contenu figé après vérification (référence, autorité, montants déclarés) ; modifiable avant", async () => {
    const t = await env.tenant();
    const { id } = await insertAssignment(user(t));
    await update(user(t), id, "declared_state_amount = 450000");
    await update(user(t, BURSAR), id, "status = 'VERIFIED'");
    await expect(update(user(t), id, "declared_state_amount = 500000")).rejects.toThrow(/content_frozen/);
    await expect(update(user(t), id, "assignment_reference = 'AUTRE'")).rejects.toThrow(/content_frozen/);
    await expect(update(user(t), id, "enrollment_id = $2", [uuid()])).rejects.toThrow(/identity_immutable/);
    await expect(update(user(t), id, "source = 'IMPORT'")).rejects.toThrow(/identity_immutable/);
  });

  it("7. cycle de vie : activation, suspension motivée, reprise, fin motivée ; rejet motivé ; états finals ; historique en ajout seul", async () => {
    const t = await env.tenant();
    const { id } = await activeAssignment(t);
    expect(await run(user(t), async (tx) => (await tx.queryOne<{ a: Date | null }>("SELECT activated_at AS a FROM stateassign.assignments WHERE id = $1", [id]))!.a)).toBeTruthy();
    await expect(update(user(t), id, "status = 'SUSPENDED'")).rejects.toThrow(/check/);
    await update(user(t), id, "status = 'SUSPENDED', suspension_reason = 'Pièces à renouveler'");
    await update(user(t), id, "status = 'ACTIVE'");
    await expect(update(user(t), id, "status = 'ENDED'")).rejects.toThrow(/check/); // date et motif de fin
    await update(user(t), id, "status = 'ENDED', ended_on = '2027-06-30', end_reason = 'Fin de l''année scolaire'");
    await expect(update(user(t), id, "status = 'ACTIVE'")).rejects.toThrow(/transition|final/);
    const events = await run(user(t), (tx) => tx.many<{ action: string; from_status: string | null; to_status: string | null }>("SELECT action, from_status, to_status FROM stateassign.assignment_events WHERE assignment_id = $1 ORDER BY occurred_at, to_status", [id]));
    expect(events.some((e) => e.action === "CREATED")).toBe(true);
    expect(events.some((e) => e.from_status === "ACTIVE" && e.to_status === "ENDED")).toBe(true);
    expect(events.filter((e) => e.action === "STATUS_CHANGED").length).toBeGreaterThanOrEqual(5);
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.assignment_events SET reason = 'x'"))).rejects.toThrow(/permission denied|immutable/);
  });

  it("8. avenant : l'ancienne version est REMPLACÉE (motif, date) avant la création de la version n+1 ; chaîne cohérente", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const v1 = await activeAssignment(t, { institution: inst, year, reference: "AFF-77" });
    const base = { institution: inst, year, enrollment: v1.enrollment, student: v1.student, reference: "AFF-77", supersedes: v1.id, version: 2, state: 450000 };
    // la version 1 est encore vivante : l'avenant est refusé
    await expect(insertAssignment(user(t), base)).rejects.toThrow(/unique|amendment_invalid/);
    await expect(update(user(t, BURSAR), v1.id, "status = 'SUPERSEDED'")).rejects.toThrow(/check/);
    await update(user(t, BURSAR), v1.id, "status = 'SUPERSEDED', ended_on = '2026-11-01', end_reason = 'Avenant n°2 : montant État révisé'");
    await expect(insertAssignment(user(t), { ...base, version: 3 })).rejects.toThrow(/amendment_invalid|check/);
    await expect(insertAssignment(user(t), { ...base, enrollment: uuid() })).rejects.toThrow(/amendment_invalid/);
    const v2 = await insertAssignment(user(t), base);
    expect(await statusOf(user(t), v2.id)).toBe("RECEIVED");
    await expect(update(user(t), v1.id, "notes = 'x'")).rejects.toThrow(/final/);
    // une version 1 ne peut pas se prétendre issue d'un avenant
    await expect(insertAssignment(user(t), { ...base, version: 1, enrollment: uuid() })).rejects.toThrow(/amendment_invalid|check/);
  });

  it("9. rapprochement : statut CALCULÉ par la base depuis les écarts et la tolérance ; un job peut rapprocher mais pas modifier le fond", async () => {
    const t = await env.tenant();
    const inst = uuid();
    await run(user(t), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, reconciliation_tolerance) VALUES ($1,$2,500)", [t, inst]));
    const { id } = await activeAssignment(t, { institution: inst });
    const recon = async () => run(user(t), async (tx) => (await tx.queryOne<{ s: string }>("SELECT reconciliation_status AS s FROM stateassign.assignments WHERE id = $1", [id]))!.s);
    expect(await recon()).toBe("NEVER");
    await update(env.system(t), id, "last_reconciled_at = now(), reconciled_state_delta = 0, reconciled_parent_delta = -500, reconciliation_status = 'DISCREPANCY'");
    expect(await recon()).toBe("BALANCED"); // tolérance de 500 : le statut saisi est ignoré
    await update(env.system(t), id, "last_reconciled_at = now(), reconciled_state_delta = 120000, reconciled_parent_delta = 0");
    expect(await recon()).toBe("DISCREPANCY");
    await expect(update(env.system(t), id, "last_reconciled_at = now(), reconciled_state_delta = NULL")).rejects.toThrow(/reconciliation_incomplete/);
    await update(env.system(t), id, "finance_state_invoice_id = $2, finance_parent_invoice_id = $3, finance_scholarship_id = $4", [uuid(), uuid(), uuid()]);
    await expect(update(env.system(t), id, "notes = 'modifié par un job'")).rejects.toThrow(/human_actor_required/);
    const kinds = (await run(user(t), (tx) => tx.many<{ action: string }>("SELECT action FROM stateassign.assignment_events WHERE assignment_id = $1", [id]))).map((e) => e.action);
    expect(kinds).toContain("RECONCILED");
    expect(kinds).toContain("LINKED");
  });

  it("10. contrôles : planifiés sur un dossier vérifié ou actif ; un par nature et période ; résultat par un humain ; anomalie résolue avec motif", async () => {
    const t = await env.tenant();
    const received = await insertAssignment(user(t));
    const insertControl = (ctx: RequestContext, assignmentId: string, kind: string, period: string | null, due: string) => {
      const id = uuid();
      return run(ctx, (tx) => tx.query("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, academic_period_id, due_on) VALUES ($1,$2,$3,$4,$5,$6)", [id, t, assignmentId, kind, period, due])).then(() => id);
    };
    await expect(insertControl(user(t), received.id, "ATTENDANCE", null, "2026-12-01")).rejects.toThrow(/control_state/);
    const a = await activeAssignment(t);
    const period = uuid();
    const control = await insertControl(user(t), a.id, "ATTENDANCE", period, "2026-12-15");
    await expect(insertControl(user(t), a.id, "ATTENDANCE", period, "2026-12-20")).rejects.toThrow(/unique/);
    await insertControl(user(t), a.id, "ATTENDANCE", uuid(), "2027-03-15");
    await insertControl(user(t), a.id, "IDENTITY", null, "2026-10-30");
    const set = (ctx: RequestContext, sql: string, params: unknown[] = []) => run(ctx, (tx) => tx.query(`UPDATE stateassign.controls SET ${sql} WHERE id = $1`, [control, ...params]));
    await expect(set(env.system(t), "status = 'OK'")).rejects.toThrow(/human_actor_required/);
    await expect(set(user(t, BURSAR), "status = 'ANOMALY'")).rejects.toThrow(/check/); // constat obligatoire
    await set(user(t, BURSAR), `status = 'ANOMALY', findings = 'Absences non justifiées au-delà du suivi', evidence = '{"unexcusedAbsences": 9}'::jsonb`);
    expect(await run(user(t), async (tx) => (await tx.queryOne<{ p: string }>("SELECT performed_by AS p FROM stateassign.controls WHERE id = $1", [control]))!.p)).toBe(BURSAR);
    await expect(set(user(t, BURSAR), "status = 'OK'")).rejects.toThrow(/resolution_required/);
    await set(user(t, BURSAR), "status = 'OK', anomaly_resolution = 'Justificatifs reçus et validés'");
    await expect(set(user(t, BURSAR), "status = 'ANOMALY', findings = 'Nouveau constat'")).rejects.toThrow(/control_transition|control_final/);
    await expect(set(user(t, BURSAR), "due_on = '2027-01-01'")).rejects.toThrow(/control_identity_immutable|control_final/);
  });

  it("11. la planification peut être faite par un job ; la nature reste dans la liste ; un job ne pose que le marqueur d'alerte", async () => {
    const t = await env.tenant();
    const a = await activeAssignment(t);
    const id = uuid();
    await run(env.system(t), (tx) => tx.query("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'DOCUMENTS','2026-12-01')", [id, t, a.id]));
    await expect(run(env.system(t), (tx) => tx.query("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'LOTERIE','2026-12-01')", [uuid(), t, a.id]))).rejects.toThrow(/check/);
    await expect(run(user(t), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, required_control_kinds) VALUES ($1,$2,'{ATTENDANCE,LOTERIE}')", [t, uuid()]))).rejects.toThrow(/check/);
    // le job pose le marqueur d'alerte ; il ne modifie pas le constat
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.controls SET due_notified_at = now() WHERE id = $1", [id]));
    await expect(run(env.system(t), (tx) => tx.query("UPDATE stateassign.controls SET findings = 'écrit par un job' WHERE id = $1", [id]))).rejects.toThrow(/human_actor_required/);
  });

  it("12. documents : références seulement, une fois par dossier ; retrait motivé ; ajout par un humain", async () => {
    const t = await env.tenant();
    const { id } = await insertAssignment(user(t));
    const ref = uuid();
    const doc = uuid();
    const insertDoc = (ctx: RequestContext, documentRef: string, addedBy: string, docId = uuid()) =>
      run(ctx, (tx) => tx.query("INSERT INTO stateassign.documents (id, tenant_id, assignment_id, kind, document_ref, label, added_by) VALUES ($1,$2,$3,'ASSIGNMENT_ORDER',$4,'Acte d''affectation',$5)", [docId, t, id, documentRef, addedBy]));
    await insertDoc(user(t), ref, SECRETARY, doc);
    await expect(insertDoc(user(t), ref, SECRETARY)).rejects.toThrow(/unique/);
    await expect(insertDoc(user(t), uuid(), BURSAR)).rejects.toThrow(/adder_mismatch/);
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.documents SET document_ref = $2 WHERE id = $1", [doc, uuid()]))).rejects.toThrow(/document_immutable/);
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.documents SET status = 'WITHDRAWN' WHERE id = $1", [doc]))).rejects.toThrow(/check/);
    await run(user(t), (tx) => tx.query("UPDATE stateassign.documents SET status = 'WITHDRAWN', withdrawn_reason = 'Pièce remplacée' WHERE id = $1", [doc]));
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.documents SET status = 'ACTIVE' WHERE id = $1", [doc]))).rejects.toThrow(/document_withdrawn/);
    await expect(insertDoc(env.system(t), uuid(), SECRETARY)).rejects.toThrow(/human_actor_required/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Créances sur l'État (2302-2303), réglages, formats d'export
// ---------------------------------------------------------------------------------------------------------------------

describeIntegration("stateassign : créances sur l'État et formats (base)", () => {
  async function scheduleRow(ctx: RequestContext, a: { id: string; institution: string; year: string; enrollment: string; student: string }, label: string, due: string, expected: number) {
    const id = uuid();
    await run(ctx, (tx) =>
      tx.query(
        `INSERT INTO stateassign.receivables (id, tenant_id, assignment_id, institution_id, academic_year_id, enrollment_id, student_id, seq, label, due_on, expected_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11)`,
        [id, ctx.tenantId, a.id, a.institution, a.year, a.enrollment, a.student, label, due, expected, ctx.userId ?? PEOPLE.director],
      ),
    );
    return id;
  }
  const receivable = (ctx: RequestContext, id: string) =>
    run(ctx, async (tx) => (await tx.queryOne<{ seq: number; status: string; received_amount: string; row_version: number; overdue_flagged_at: Date | null }>("SELECT seq, status, received_amount::text, row_version, overdue_flagged_at FROM stateassign.receivables WHERE id = $1", [id]))!);

  it("planifier est un acte humain, sur un dossier vérifié ; le numéro d'ordre et le statut initial sont posés par la base", async () => {
    const t = await env.tenant();
    const received = await insertAssignment(user(t));
    await expect(scheduleRow(user(t), received, "1er versement", "2026-12-01", 100000)).rejects.toThrow(/receivable_state/);
    const a = await activeAssignment(t);
    await expect(scheduleRow(env.system(t), a, "1er versement", "2026-12-01", 100000)).rejects.toThrow(/human_actor_required/);
    const r1 = await scheduleRow(user(t), a, "1er versement", "2026-12-01", 100000);
    const r2 = await scheduleRow(user(t), a, "2e versement", "2027-03-01", 150000);
    expect((await receivable(user(t), r1)).seq).toBe(1);
    expect((await receivable(user(t), r2)).seq).toBe(2);
    expect((await receivable(user(t), r1)).status).toBe("OPEN");
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET enrollment_id = $2 WHERE id = $1", [r1, uuid()]))).rejects.toThrow(/receivable_identity_immutable/);
  });

  it("la somme des échéances ne dépasse pas le montant déclaré à la charge de l'État ; un dossier sans montant n'accepte aucune échéance", async () => {
    const t = await env.tenant();
    const a = await activeAssignment(t, { state: 300000 });
    await scheduleRow(user(t), a, "A", "2026-12-01", 200000);
    await expect(scheduleRow(user(t), a, "B", "2027-03-01", 100001)).rejects.toThrow(/receivable_exceeds_declared/);
    await scheduleRow(user(t), a, "B", "2027-03-01", 100000); // pile le montant déclaré
    const noAmount = await activeAssignment(t, { state: null });
    await expect(scheduleRow(user(t), noAmount, "A", "2026-12-01", 1)).rejects.toThrow(/declared_amount_required/);
  });

  it("le STATUT est calculé depuis les montants (un statut saisi est ignoré) ; le rapprochement peut venir d'un job, pas le fond", async () => {
    const t = await env.tenant();
    const a = await activeAssignment(t, { state: 300000 });
    const id = await scheduleRow(user(t), a, "A", "2026-12-01", 100000);
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET received_amount = 40000, last_reconciled_at = now(), status = 'RECEIVED' WHERE id = $1", [id]));
    expect((await receivable(user(t), id)).status).toBe("PARTIALLY_RECEIVED");
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET received_amount = 100000 WHERE id = $1", [id]));
    expect((await receivable(user(t), id)).status).toBe("RECEIVED");
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET received_amount = 0 WHERE id = $1", [id]));
    expect((await receivable(user(t), id)).status).toBe("OPEN");
    await expect(run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET expected_amount = 90000 WHERE id = $1", [id]))).rejects.toThrow(/human_actor_required/);
    await expect(run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET received_amount = 100001 WHERE id = $1", [id]))).rejects.toThrow(/check/);
    // le marqueur d'alerte de retard est posé par un job ; un report par un humain le réinitialise
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET overdue_flagged_at = now() WHERE id = $1", [id]));
    expect((await receivable(user(t), id)).overdue_flagged_at).toBeTruthy();
    await run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET due_on = '2027-01-15' WHERE id = $1", [id]));
    expect((await receivable(user(t), id)).overdue_flagged_at).toBeNull();
  });

  it("l'annulation est humaine, motivée, refusée dès qu'un versement est rapproché ; CANCELLED est final ; l'historique des créances est en ajout seul", async () => {
    const t = await env.tenant();
    const a = await activeAssignment(t, { state: 300000 });
    const open = await scheduleRow(user(t), a, "A", "2026-12-01", 100000);
    const paid = await scheduleRow(user(t), a, "B", "2027-03-01", 100000);
    await run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET received_amount = 10000 WHERE id = $1", [paid]));
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET status = 'CANCELLED', cancel_reason = 'Erreur de saisie' WHERE id = $1", [paid]))).rejects.toThrow(/receivable_cancel_received/);
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET status = 'CANCELLED' WHERE id = $1", [open]))).rejects.toThrow(/check/); // motif obligatoire
    await expect(run(env.system(t), (tx) => tx.query("UPDATE stateassign.receivables SET status = 'CANCELLED', cancel_reason = 'Erreur de saisie' WHERE id = $1", [open]))).rejects.toThrow(/human_actor_required/);
    await run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET status = 'CANCELLED', cancel_reason = 'Erreur de saisie' WHERE id = $1", [open]));
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.receivables SET label = 'autre' WHERE id = $1", [open]))).rejects.toThrow(/receivable_final/);
    // une échéance annulée libère le montant déclaré
    await scheduleRow(user(t), a, "C", "2027-06-01", 100000);
    const events = await run(user(t), (tx) => tx.many<{ action: string; from_amount: string | null; to_amount: string | null }>("SELECT action, from_amount::text, to_amount::text FROM stateassign.receivable_events WHERE receivable_id = ANY($1::uuid[]) ORDER BY occurred_at", [[open, paid]]));
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["CREATED", "RECEIVED_UPDATED", "CANCELLED"]));
    expect(events.find((e) => e.action === "RECEIVED_UPDATED")).toMatchObject({ from_amount: "0", to_amount: "10000" });
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.receivable_events SET reason = 'x'"))).rejects.toThrow(/permission denied|immutable/);
  });

  it("un avenant ne peut pas descendre sous le calendrier déjà planifié ; les créances suivent l'inscription (pas la version)", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const v1 = await activeAssignment(t, { institution: inst, year, reference: "AFF-9", state: 300000 });
    await scheduleRow(user(t), v1, "A", "2026-12-01", 250000);
    await update(user(t, BURSAR), v1.id, "status = 'SUPERSEDED', ended_on = '2026-11-01', end_reason = 'Avenant : montant révisé'");
    const base = { institution: inst, year, enrollment: v1.enrollment, student: v1.student, reference: "AFF-9", supersedes: v1.id, version: 2 };
    await expect(insertAssignment(user(t), { ...base, state: 200000 })).rejects.toThrow(/amendment_below_schedule/);
    const v2 = await insertAssignment(user(t), { ...base, state: 260000 });
    const kept = await run(user(t), (tx) => tx.many<{ assignment_id: string }>("SELECT assignment_id FROM stateassign.receivables WHERE enrollment_id = $1", [v1.enrollment]));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.assignment_id).toBe(v1.id);
    expect(v2.id).toBeTruthy();
  });

  it("formats d'export et réglages : actes humains, identité figée", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const insert = (ctx: RequestContext, code: string) =>
      run(ctx, (tx) => tx.query(`INSERT INTO stateassign.export_formats (id, tenant_id, institution_id, code, label, dataset, columns) VALUES ($1,$2,$3,$4,'Format',$5,'[{"key":"reference","header":"Réf"}]'::jsonb)`, [uuid(), t, inst, code, "ASSIGNMENTS"]));
    await expect(insert(env.system(t), "fmt-a")).rejects.toThrow(/human_actor_required/);
    await insert(user(t), "fmt-a");
    await expect(insert(user(t), "fmt-a")).rejects.toThrow(/unique/);
    await expect(run(user(t), (tx) => tx.query(`UPDATE stateassign.export_formats SET code = 'autre' WHERE institution_id = $1`, [inst]))).rejects.toThrow(/identity_immutable/);
    await expect(run(user(t), (tx) => tx.query(`INSERT INTO stateassign.export_formats (id, tenant_id, institution_id, code, label, dataset, columns) VALUES ($1,$2,$3,'x2','F','ASSIGNMENTS','[]'::jsonb)`, [uuid(), t, inst]))).rejects.toThrow(/check/);
    await expect(run(env.system(t), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id) VALUES ($1,$2)", [t, inst]))).rejects.toThrow(/human_actor_required/);
    await run(user(t), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, reconciliation_tolerance, control_due_offset_days) VALUES ($1,$2,0,15)", [t, inst]));
    await expect(run(user(t), (tx) => tx.query("UPDATE stateassign.settings SET control_due_offset_days = -1 WHERE institution_id = $1", [inst]))).rejects.toThrow(/check/);
  });
});
