// Tests de comportement du schéma `stateassign` (migrations 2000-2001 de data-model.md).
// Exécution : node specs/v2/006-secondary/ddl-test/run.mjs
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, inTenant, insert, newTenant, uuid } from "./harness.mjs";

let d;
const SECRETARY = uuid();
const BURSAR = uuid();

before(async () => {
  d = await createDatabase("stateassign", ["20"]);
});
after(async () => {
  await d?.close();
});

const mk = (tx, table, cols) => insert(tx, table, { id: uuid(), tenant_id: tx.tenantId, ...cols });
const asUser = async (fn, { user = SECRETARY, tenant } = {}) => {
  const t = tenant ?? (await newTenant(d.db, "sa"));
  return inTenant(d.db, { tenantId: t, userId: user, actor: "user" }, fn);
};
const asSecretary = (tx) => tx.as({ userId: SECRETARY, actor: "user" });
const asBursar = (tx) => tx.as({ userId: BURSAR, actor: "user" });

async function assignment(tx, extra = {}) {
  return mk(tx, "stateassign.assignments", {
    institution_id: extra.institution_id ?? uuid(),
    academic_year_id: extra.academic_year_id ?? uuid(),
    enrollment_id: uuid(),
    student_id: uuid(),
    assignment_reference: `REF-${uuid().slice(0, 8)}`,
    issued_on: "2026-09-15",
    issuing_authority: "Autorité d'affectation (libellé libre)",
    declared_state_amount: 400000,
    declared_parent_amount: 100000,
    received_by: SECRETARY,
    ...extra,
  });
}
const status = async (tx, id) => (await tx.one("SELECT status FROM stateassign.assignments WHERE id = $1", [id])).status;
async function activeAssignment(tx, extra = {}) {
  const id = await assignment(tx, extra);
  await asBursar(tx);
  await tx.q("UPDATE stateassign.assignments SET status = 'VERIFIED', verification_note = 'Pièces conformes' WHERE id = $1", [id]);
  await tx.q("UPDATE stateassign.assignments SET status = 'ACTIVE' WHERE id = $1", [id]);
  return id;
}

describe("isolation, droits, aucune valeur livrée", () => {
  it("RLS forcée sur les 5 tables ; FK composites ; aucun DELETE ; aucun réglage par défaut", async () => {
    const a = await newTenant(d.db, "a");
    const b = await newTenant(d.db, "b");
    const idA = await inTenant(d.db, { tenantId: a, userId: SECRETARY }, (tx) => assignment(tx), { commit: true });
    await inTenant(d.db, { tenantId: b, userId: SECRETARY }, async (tx) => {
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM stateassign.assignments"))[0].n, 0);
      await tx.fail(
        "INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'ATTENDANCE','2026-12-01')",
        [uuid(), b, idA],
        /foreign key|23503|violates/,
      );
      await tx.fail("DELETE FROM stateassign.assignments", [], /permission denied|42501/);
      await tx.fail("DELETE FROM stateassign.assignment_events", [], /permission denied|42501/);
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM stateassign.settings"))[0].n, 0);
    });
    const tables = (await d.db.query("SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS frls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'stateassign' AND c.relkind = 'r'")).rows;
    assert.equal(tables.length, 5);
    assert.ok(tables.every((t) => t.rls && t.frls));
  });
});

describe("dossier d'affectation", () => {
  it("création manuelle par un utilisateur identifié ; import par un job ; référence nettoyée ; montants entiers positifs", async () => {
    await asUser(async (tx) => {
      const id = await assignment(tx, { assignment_reference: "  AFF-2026-001  " });
      assert.equal((await tx.one("SELECT assignment_reference FROM stateassign.assignments WHERE id = $1", [id])).assignment_reference, "AFF-2026-001");
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, received_by) VALUES ($1,$2,$3,$4,$5,$6,'X',$7)", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), BURSAR], /receiver_mismatch/);
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, received_by, declared_state_amount) VALUES ($1,$2,$3,$4,$5,$6,'Y',$7,-1)", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), SECRETARY], /check|23514/);
      // un import est écrit par le système (acteur 'system'), sans enregistrant humain
      await tx.as({ actor: "system", userId: "" });
      const imp = await mk(tx, "stateassign.assignments", { institution_id: uuid(), academic_year_id: uuid(), enrollment_id: uuid(), student_id: uuid(), assignment_reference: "IMP-1", source: "IMPORT" });
      assert.ok(imp);
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, source) VALUES ($1,$2,$3,$4,$5,$6,'M-1','MANUAL')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid()], /human_actor_required|check|23514/);
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, source) VALUES ($1,$2,$3,$4,$5,$6,'G-1','GATEWAY')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid()], /check|23514/); // empreinte de l'échange requise
    });
  });

  it("un dossier vivant par inscription ; une référence par établissement et année (hors rejeté ou remplacé)", async () => {
    await asUser(async (tx) => {
      const inst = uuid();
      const year = uuid();
      const enrollment = uuid();
      const first = await mk(tx, "stateassign.assignments", { institution_id: inst, academic_year_id: year, enrollment_id: enrollment, student_id: uuid(), assignment_reference: "R-1", received_by: SECRETARY });
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, received_by) VALUES ($1,$2,$3,$4,$5,$6,'R-2',$7)", [uuid(), tx.tenantId, inst, year, enrollment, uuid(), SECRETARY], /unique|23505/);
      await tx.fail("INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, assignment_reference, received_by) VALUES ($1,$2,$3,$4,$5,$6,'R-1',$7)", [uuid(), tx.tenantId, inst, year, uuid(), uuid(), SECRETARY], /unique|23505/);
      await tx.q("UPDATE stateassign.assignments SET status = 'REJECTED', rejection_reason = 'Acte non reconnu' WHERE id = $1", [first]);
      // la référence et l'inscription sont libérées par le rejet
      await mk(tx, "stateassign.assignments", { institution_id: inst, academic_year_id: year, enrollment_id: enrollment, student_id: uuid(), assignment_reference: "R-1", received_by: SECRETARY });
    });
  });

  it("vérification : acte humain ; l'enregistrant ne vérifie pas son propre dossier ; le vérificateur est la session", async () => {
    await asUser(async (tx) => {
      const id = await assignment(tx);
      await tx.fail("UPDATE stateassign.assignments SET status = 'VERIFIED' WHERE id = $1", [id], /four_eyes_required/);
      await tx.fail("UPDATE stateassign.assignments SET status = 'ACTIVE' WHERE id = $1", [id], /transition/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE stateassign.assignments SET status = 'VERIFIED' WHERE id = $1", [id], /human_actor_required/);
      await asBursar(tx);
      await tx.q("UPDATE stateassign.assignments SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [id, SECRETARY]);
      const row = await tx.one("SELECT verified_by, verified_at FROM stateassign.assignments WHERE id = $1", [id]);
      assert.equal(row.verified_by, BURSAR, "vérificateur = utilisateur de la session, non falsifiable");
      assert.ok(row.verified_at);
    });
  });

  it("réglage : séparation des tâches désactivable ; alors l'enregistrant peut vérifier", async () => {
    await asUser(async (tx) => {
      const inst = uuid();
      await tx.q("INSERT INTO stateassign.settings (tenant_id, institution_id, require_separate_verifier) VALUES ($1,$2,false)", [tx.tenantId, inst]);
      const id = await assignment(tx, { institution_id: inst });
      await tx.q("UPDATE stateassign.assignments SET status = 'VERIFIED' WHERE id = $1", [id]);
      assert.equal(await status(tx, id), "VERIFIED");
    });
  });

  it("contenu figé après vérification (référence, autorité, montants déclarés) ; modifiable avant", async () => {
    await asUser(async (tx) => {
      const id = await assignment(tx);
      await tx.q("UPDATE stateassign.assignments SET declared_state_amount = 450000 WHERE id = $1", [id]);
      await asBursar(tx);
      await tx.q("UPDATE stateassign.assignments SET status = 'VERIFIED' WHERE id = $1", [id]);
      await tx.fail("UPDATE stateassign.assignments SET declared_state_amount = 500000 WHERE id = $1", [id], /content_frozen/);
      await tx.fail("UPDATE stateassign.assignments SET assignment_reference = 'AUTRE' WHERE id = $1", [id], /content_frozen/);
      await tx.fail("UPDATE stateassign.assignments SET enrollment_id = $2 WHERE id = $1", [id, uuid()], /identity_immutable/);
      await tx.fail("UPDATE stateassign.assignments SET source = 'IMPORT' WHERE id = $1", [id], /identity_immutable/);
    });
  });

  it("cycle de vie : activation, suspension motivée, reprise, fin motivée ; rejet motivé ; états finals", async () => {
    await asUser(async (tx) => {
      const id = await activeAssignment(tx);
      assert.ok((await tx.one("SELECT activated_at FROM stateassign.assignments WHERE id = $1", [id])).activated_at);
      await tx.fail("UPDATE stateassign.assignments SET status = 'SUSPENDED' WHERE id = $1", [id], /check|23514/);
      await tx.q("UPDATE stateassign.assignments SET status = 'SUSPENDED', suspension_reason = 'Pièces à renouveler' WHERE id = $1", [id]);
      await tx.q("UPDATE stateassign.assignments SET status = 'ACTIVE' WHERE id = $1", [id]);
      await tx.fail("UPDATE stateassign.assignments SET status = 'ENDED' WHERE id = $1", [id], /check|23514/); // date et motif de fin
      await tx.q("UPDATE stateassign.assignments SET status = 'ENDED', ended_on = '2027-06-30', end_reason = 'Fin de l''année scolaire' WHERE id = $1", [id]);
      await tx.fail("UPDATE stateassign.assignments SET status = 'ACTIVE' WHERE id = $1", [id], /transition/);
      const ev = await tx.q("SELECT action, from_status, to_status FROM stateassign.assignment_events WHERE assignment_id = $1 ORDER BY occurred_at, to_status", [id]);
      assert.ok(ev.some((e) => e.action === "CREATED"));
      assert.ok(ev.some((e) => e.from_status === "ACTIVE" && e.to_status === "ENDED"));
      assert.ok(ev.filter((e) => e.action === "STATUS_CHANGED").length >= 5);
      await tx.fail("UPDATE stateassign.assignment_events SET reason = 'x'", [], /permission denied|immutable|42501/);
    });
  });

  it("avenant : l'ancienne version est REMPLACÉE (motif, date) avant la création de la version n+1 ; chaîne cohérente", async () => {
    await asUser(async (tx) => {
      const inst = uuid();
      const year = uuid();
      const v1 = await activeAssignment(tx, { institution_id: inst, academic_year_id: year, assignment_reference: "AFF-77" });
      const enrollment = (await tx.one("SELECT enrollment_id, student_id FROM stateassign.assignments WHERE id = $1", [v1]));
      const v2cols = { institution_id: inst, academic_year_id: year, enrollment_id: enrollment.enrollment_id, student_id: enrollment.student_id, assignment_reference: "AFF-77", version: 2, supersedes_id: v1, received_by: SECRETARY, declared_state_amount: 450000 };
      await asSecretary(tx);
      // la version 1 est encore vivante : l'avenant est refusé
      await tx.attempt(() => mk(tx, "stateassign.assignments", v2cols), /unique|23505|amendment_invalid/);
      await asBursar(tx);
      await tx.fail("UPDATE stateassign.assignments SET status = 'SUPERSEDED' WHERE id = $1", [v1], /check|23514/);
      await tx.q("UPDATE stateassign.assignments SET status = 'SUPERSEDED', ended_on = '2026-11-01', end_reason = 'Avenant n°2 : montant État révisé' WHERE id = $1", [v1]);
      await asSecretary(tx);
      await tx.attempt(() => mk(tx, "stateassign.assignments", { ...v2cols, version: 3 }), /amendment_invalid|check|23514/);
      await tx.attempt(() => mk(tx, "stateassign.assignments", { ...v2cols, enrollment_id: uuid() }), /amendment_invalid/);
      const v2 = await mk(tx, "stateassign.assignments", v2cols);
      assert.equal(await status(tx, v2), "RECEIVED");
      await tx.fail("UPDATE stateassign.assignments SET notes = 'x' WHERE id = $1", [v1], /final/);
      // une version 1 ne peut pas se prétendre issue d'un avenant
      await tx.attempt(() => mk(tx, "stateassign.assignments", { ...v2cols, version: 1, enrollment_id: uuid() }), /check|23514/);
    });
  });
});

describe("rapprochement avec la facturation", () => {
  it("statut CALCULÉ par la base depuis les écarts et la tolérance de l'établissement ; un job peut rapprocher", async () => {
    await asUser(async (tx) => {
      const inst = uuid();
      await tx.q("INSERT INTO stateassign.settings (tenant_id, institution_id, reconciliation_tolerance) VALUES ($1,$2,500)", [tx.tenantId, inst]);
      const id = await activeAssignment(tx, { institution_id: inst });
      assert.equal((await tx.one("SELECT reconciliation_status FROM stateassign.assignments WHERE id = $1", [id])).reconciliation_status, "NEVER");
      await tx.as({ actor: "system", userId: "" });
      await tx.q("UPDATE stateassign.assignments SET last_reconciled_at = now(), reconciled_state_delta = 0, reconciled_parent_delta = -500, reconciliation_status = 'DISCREPANCY' WHERE id = $1", [id]);
      assert.equal((await tx.one("SELECT reconciliation_status FROM stateassign.assignments WHERE id = $1", [id])).reconciliation_status, "BALANCED", "tolérance de 500 : le statut saisi est ignoré");
      await tx.q("UPDATE stateassign.assignments SET last_reconciled_at = now(), reconciled_state_delta = 120000, reconciled_parent_delta = 0 WHERE id = $1", [id]);
      assert.equal((await tx.one("SELECT reconciliation_status FROM stateassign.assignments WHERE id = $1", [id])).reconciliation_status, "DISCREPANCY");
      await tx.fail("UPDATE stateassign.assignments SET last_reconciled_at = now(), reconciled_state_delta = NULL WHERE id = $1", [id], /reconciliation_incomplete/);
      const link = uuid();
      await tx.q("UPDATE stateassign.assignments SET finance_state_invoice_id = $2, finance_parent_invoice_id = $3, finance_scholarship_id = $4 WHERE id = $1", [id, link, uuid(), uuid()]);
      // un job ne modifie jamais le fond du dossier
      await tx.fail("UPDATE stateassign.assignments SET notes = 'modifié par un job' WHERE id = $1", [id], /human_actor_required/);
      const kinds = (await tx.q("SELECT action FROM stateassign.assignment_events WHERE assignment_id = $1", [id])).map((e) => e.action);
      assert.ok(kinds.includes("RECONCILED") && kinds.includes("LINKED"));
    });
  });
});

describe("contrôles périodiques", () => {
  it("planifiés sur un dossier vérifié ou actif ; un par nature et période ; résultat par un humain ; anomalie résolue avec motif", async () => {
    await asUser(async (tx) => {
      const received = await assignment(tx);
      await tx.fail("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'ATTENDANCE','2026-12-01')", [uuid(), tx.tenantId, received], /control_state/);
      const id = await activeAssignment(tx);
      const period = uuid();
      const control = await mk(tx, "stateassign.controls", { assignment_id: id, kind: "ATTENDANCE", academic_period_id: period, due_on: "2026-12-15" });
      await tx.fail("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, academic_period_id, due_on) VALUES ($1,$2,$3,'ATTENDANCE',$4,'2026-12-20')", [uuid(), tx.tenantId, id, period], /unique|23505/);
      await mk(tx, "stateassign.controls", { assignment_id: id, kind: "ATTENDANCE", academic_period_id: uuid(), due_on: "2027-03-15" });
      await mk(tx, "stateassign.controls", { assignment_id: id, kind: "IDENTITY", due_on: "2026-10-30" });
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE stateassign.controls SET status = 'OK' WHERE id = $1", [control], /human_actor_required/);
      await tx.as({ actor: "user", userId: BURSAR });
      await tx.fail("UPDATE stateassign.controls SET status = 'ANOMALY' WHERE id = $1", [control], /check|23514/); // constat obligatoire
      await tx.q("UPDATE stateassign.controls SET status = 'ANOMALY', findings = 'Absences non justifiées au-delà du suivi', evidence = '{\"unexcusedAbsences\": 9}'::jsonb WHERE id = $1", [control]);
      assert.equal((await tx.one("SELECT performed_by FROM stateassign.controls WHERE id = $1", [control])).performed_by, BURSAR);
      await tx.fail("UPDATE stateassign.controls SET status = 'OK' WHERE id = $1", [control], /resolution_required/);
      await tx.q("UPDATE stateassign.controls SET status = 'OK', anomaly_resolution = 'Justificatifs reçus et validés' WHERE id = $1", [control]);
      await tx.fail("UPDATE stateassign.controls SET status = 'ANOMALY', findings = 'Nouveau constat' WHERE id = $1", [control], /control_transition|control_final/);
      await tx.fail("UPDATE stateassign.controls SET due_on = '2027-01-01' WHERE id = $1", [control], /control_identity_immutable|control_final/);
    });
  });

  it("la planification peut être faite par un job (acteur système) ; la nature doit rester dans la liste", async () => {
    await asUser(async (tx) => {
      const id = await activeAssignment(tx);
      await tx.as({ actor: "system", userId: "" });
      await mk(tx, "stateassign.controls", { assignment_id: id, kind: "DOCUMENTS", due_on: "2026-12-01" });
      await tx.fail("INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, due_on) VALUES ($1,$2,$3,'LOTERIE','2026-12-01')", [uuid(), tx.tenantId, id], /check|23514/);
      await tx.fail("INSERT INTO stateassign.settings (tenant_id, institution_id, required_control_kinds) VALUES ($1,$2,'{ATTENDANCE,LOTERIE}')", [tx.tenantId, uuid()], /check|23514/);
    });
  });
});

describe("documents du dossier", () => {
  it("références seulement, une fois par dossier ; retrait motivé ; ajout par un humain", async () => {
    await asUser(async (tx) => {
      const id = await assignment(tx);
      const ref = uuid();
      const doc = await mk(tx, "stateassign.documents", { assignment_id: id, kind: "ASSIGNMENT_ORDER", document_ref: ref, label: "Acte d'affectation", added_by: SECRETARY });
      await tx.fail("INSERT INTO stateassign.documents (id, tenant_id, assignment_id, kind, document_ref, added_by) VALUES ($1,$2,$3,'OTHER',$4,$5)", [uuid(), tx.tenantId, id, ref, SECRETARY], /unique|23505/);
      await tx.fail("INSERT INTO stateassign.documents (id, tenant_id, assignment_id, kind, document_ref, added_by) VALUES ($1,$2,$3,'OTHER',$4,$5)", [uuid(), tx.tenantId, id, uuid(), BURSAR], /adder_mismatch/);
      await tx.fail("UPDATE stateassign.documents SET document_ref = $2 WHERE id = $1", [doc, uuid()], /document_immutable/);
      await tx.fail("UPDATE stateassign.documents SET status = 'WITHDRAWN' WHERE id = $1", [doc], /check|23514/);
      await tx.q("UPDATE stateassign.documents SET status = 'WITHDRAWN', withdrawn_reason = 'Pièce remplacée' WHERE id = $1", [doc]);
      await tx.fail("UPDATE stateassign.documents SET status = 'ACTIVE' WHERE id = $1", [doc], /document_withdrawn/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("INSERT INTO stateassign.documents (id, tenant_id, assignment_id, kind, document_ref, added_by) VALUES ($1,$2,$3,'OTHER',$4,$5)", [uuid(), tx.tenantId, id, uuid(), SECRETARY], /human_actor_required/);
    });
  });
});
