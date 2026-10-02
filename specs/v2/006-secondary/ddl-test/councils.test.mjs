// Tests de comportement du schéma `councils` (migrations 1800-1804 de data-model.md).
// Exécution : node specs/v2/006-secondary/ddl-test/run.mjs
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, createDatabase, inTenant, insert, newTenant, structuralIsolationViolations, uuid } from "./harness.mjs";

let d; // { db, close }
const USER_A = uuid();
const USER_B = uuid();

before(async () => {
  d = await createDatabase("councils", ["18"]);
});
after(async () => {
  await d?.close();
});

const mk = (tx, table, cols) => insert(tx, table, { id: uuid(), tenant_id: tx.tenantId, ...cols });
const asUser = async (fn, { tenant, user = USER_A, commit = false } = {}) => {
  const t = tenant ?? (await newTenant(d.db, "c"));
  return inTenant(d.db, { tenantId: t, userId: user, actor: "user" }, fn, { commit });
};

/** Référentiels de départ d'un tenant de test (génériques, aucune valeur réglementaire). */
const seeded = new WeakMap();
async function seedReference(tx) {
  if (!seeded.has(tx)) seeded.set(tx, await doSeedReference(tx));
  return seeded.get(tx);
}
async function doSeedReference(tx) {
  const role = (code, extra = {}) => mk(tx, "councils.participant_roles", { code, label: code, ...extra });
  await role("PRESIDENT_ROLE", { can_decide: true });
  await role("SECRETARY_ROLE", { can_decide: false });
  await role("TEACHER", { can_decide: false });
  await role("DELEGATE", { is_external: true, counts_for_quorum: false, may_sign: true });
  const type = (code, family, extra = {}) =>
    mk(tx, "councils.decision_types", { code, label: code, family, ...extra });
  const ids = {};
  ids.PASSAGE = await type("PASSAGE", "PASSAGE", { applies_to: "BOTH", exclusive_group: "YEAR_OUTCOME", results_decision_kind: "YEAR_END", results_final_code: "PROMOTED", academic_outcome_code: "PROMOTED" });
  ids.REPEAT = await type("REPEAT", "REPEAT", { applies_to: "BOTH", exclusive_group: "YEAR_OUTCOME", results_decision_kind: "YEAR_END", results_final_code: "REPEAT", academic_outcome_code: "REPEATED", requires_justification: true });
  ids.ORIENT = await type("ORIENT", "ORIENTATION", { applies_to: "BOTH", exclusive_group: "YEAR_OUTCOME", requires_target: true, requires_vote: true });
  ids.EXCL = await type("EXCL", "EXCLUSION", { applies_to: "BOTH", needs_human_application: true, requires_justification: true });
  ids.OPINION = await type("OPINION", "REQUIRED_OPINION", { applies_to: "BOTH" });
  ids.PERIOD_ONLY = await type("PERIOD_ONLY", "OTHER", { applies_to: "PERIOD" });
  return ids;
}

/** Séance PLANNED avec président, secrétaire, enseignant ; `open` la passe à OPEN. */
async function council(tx, { open = false, typeExtra = {}, scope = "PERIOD", participants = true, institution = uuid() } = {}) {
  await seedReference(tx);
  const typeId = await mk(tx, "councils.council_types", { code: `T${uuid().slice(0, 8).toUpperCase()}`, label: "Conseil", scope, ...typeExtra });
  const cls = uuid();
  const id = await mk(tx, "councils.councils", {
    institution_id: institution,
    academic_year_id: uuid(),
    classroom_id: cls,
    academic_period_id: scope === "PERIOD" ? uuid() : null,
    council_type_id: typeId,
    scope,
    created_by: USER_A,
    title: "Conseil de test",
  });
  const out = { id, typeId, classroom: cls, institution };
  if (participants) {
    const p = (role, fn, name, presence = "PRESENT") =>
      mk(tx, "councils.participants", { council_id: id, role_code: role, council_function: fn, staff_id: uuid(), display_name: name, presence });
    out.president = await p("PRESIDENT_ROLE", "PRESIDENT", "Président Test");
    out.secretary = await p("SECRETARY_ROLE", "SECRETARY", "Secrétaire Test");
    out.teacher = await p("TEACHER", null, "Enseignant Test");
  }
  if (open) {
    await tx.q("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [id]);
  }
  return out;
}

async function item(tx, councilId, extra = {}) {
  return mk(tx, "councils.agenda_items", {
    council_id: councilId,
    enrollment_id: uuid(),
    student_id: uuid(),
    student_display_name: "Élève Test",
    ...extra,
  });
}

async function decide(tx, c, itemId, typeId, extra = {}) {
  const row = (await tx.q("SELECT enrollment_id, student_id FROM councils.agenda_items WHERE id = $1", [itemId]))[0];
  return mk(tx, "councils.decisions", {
    council_id: c.id,
    agenda_item_id: itemId,
    enrollment_id: row.enrollment_id,
    student_id: row.student_id,
    decision_type_id: typeId,
    decision_type_code: "X",
    family: "OTHER",
    decision_mode: "CONSENSUS",
    decider_participant_id: c.president,
    recorded_by: USER_A,
    recorded_by_name: "Secrétaire Test",
    ...extra,
  });
}

const status = async (tx, id) => (await tx.one("SELECT status FROM councils.councils WHERE id = $1", [id])).status;

describe("isolation et droits", () => {
  it("RLS : un tenant ne voit ni n'écrit les lignes d'un autre (18 tables couvertes par le test générique de la plateforme)", async () => {
    const a = await newTenant(d.db, "a");
    const b = await newTenant(d.db, "b");
    await inTenant(d.db, { tenantId: a, userId: USER_A }, async (tx) => {
      await seedReference(tx);
    }, { commit: true });
    await inTenant(d.db, { tenantId: b, userId: USER_B }, async (tx) => {
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM councils.decision_types"))[0].n, 0);
      await tx.fail(
        "INSERT INTO councils.participant_roles (id, tenant_id, code, label) VALUES ($1, $2, 'X', 'X')",
        [uuid(), a],
        /row-level security|42501/,
      );
    });
    const { tables, problems } = await structuralIsolationViolations(d.db, "councils");
    assert.equal(tables.length, 18);
    assert.deepEqual(problems, []);
  });

  it("FK composites : une séance ne peut pas désigner le type de conseil d'un autre tenant", async () => {
    const a = await newTenant(d.db, "a");
    const b = await newTenant(d.db, "b");
    const typeA = await inTenant(d.db, { tenantId: a, userId: USER_A }, (tx) => mk(tx, "councils.council_types", { code: "TA", label: "A", scope: "PERIOD" }), { commit: true });
    await inTenant(d.db, { tenantId: b, userId: USER_B }, async (tx) => {
      await tx.fail(
        "INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, academic_period_id, council_type_id, scope, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'PERIOD',$8)",
        [uuid(), b, uuid(), uuid(), uuid(), uuid(), typeA, USER_B],
        /foreign key|23503/,
      );
    });
  });

  it("app_user n'a aucun droit de DDL", async () => {
    await asUser(async (tx) => {
      await tx.fail("CREATE TABLE councils.pirate (id int)", [], /permission denied|42501/);
      await tx.fail("ALTER TABLE councils.decisions DISABLE TRIGGER decisions_guard", [], /must be owner|42501/);
    });
  });

  it("aucune suppression physique : DELETE refusé sur décisions, procès-verbaux, journal, signatures", async () => {
    await asUser(async (tx) => {
      await tx.fail("DELETE FROM councils.decisions", [], /permission denied|42501/);
      await tx.fail("DELETE FROM councils.minutes", [], /permission denied|42501/);
      await tx.fail("DELETE FROM councils.events", [], /permission denied|42501/);
      await tx.fail("DELETE FROM councils.minute_signatures", [], /permission denied|42501/);
    });
  });
});

describe("référentiels : contraintes de données", () => {
  it("types de décision : orientation exige une cible, exclusion exige une application humaine, correspondance results réservée aux familles passage/redoublement", async () => {
    await asUser(async (tx) => {
      const base = { id: uuid(), tenant_id: tx.tenantId, label: "L" };
      const ins = (cols) =>
        tx.fail(
          `INSERT INTO councils.decision_types (${Object.keys({ ...base, ...cols }).join(",")}) VALUES (${Object.keys({ ...base, ...cols }).map((_, i) => `$${i + 1}`).join(",")})`,
          Object.values({ ...base, ...cols }),
          /check|23514/,
        );
      await ins({ code: "O1", family: "ORIENTATION" });
      await ins({ code: "E1", family: "EXCLUSION" });
      await ins({ code: "R1", family: "OTHER", results_decision_kind: "YEAR_END", results_final_code: "PROMOTED" });
      await ins({ code: "R2", family: "PASSAGE", results_decision_kind: "YEAR_END" });
    });
  });

  it("types de conseil : au moins un signataire exigé ; fonctions limitées à président / secrétaire ; quorum strictement positif", async () => {
    await asUser(async (tx) => {
      const sql = "INSERT INTO councils.council_types (id, tenant_id, code, label, scope, signer_functions, min_participants) VALUES ($1,$2,$3,'L','YEAR',$4,$5)";
      await tx.fail(sql, [uuid(), tx.tenantId, "A1", "{}", null], /check|23514/);
      await tx.fail(sql, [uuid(), tx.tenantId, "A2", "{PRESIDENT,MINISTER}", null], /check|23514/);
      await tx.fail(sql, [uuid(), tx.tenantId, "A3", "{PRESIDENT}", 0], /check|23514/);
      await tx.q(sql, [uuid(), tx.tenantId, "A4", "{PRESIDENT}", null]);
    });
  });

  it("aucune valeur réglementaire par défaut : quorum NULL, aucun rôle exigé, aucun type livré", async () => {
    await asUser(async (tx) => {
      const id = await mk(tx, "councils.council_types", { code: "BARE", label: "Nu", scope: "YEAR" });
      const t = await tx.one("SELECT min_participants, required_role_codes, requires_decision_per_student FROM councils.council_types WHERE id = $1", [id]);
      assert.equal(t.min_participants, null);
      assert.deepEqual(t.required_role_codes, []);
      assert.equal(t.requires_decision_per_student, false);
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM councils.decision_types"))[0].n, 0);
    });
  });
});

describe("séance : création, ouverture, quorum", () => {
  it("la portée du conseil doit être celle de son type ; création en PLANNED seulement", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const typeId = await mk(tx, "councils.council_types", { code: "YR", label: "Année", scope: "YEAR" });
      await tx.fail(
        "INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, academic_period_id, council_type_id, scope, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'PERIOD',$8)",
        [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), typeId, USER_A],
        /scope_mismatch/,
      );
      await tx.fail(
        "INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, council_type_id, scope, created_by, status, held_on) VALUES ($1,$2,$3,$4,$5,$6,'YEAR',$7,'OPEN', current_date)",
        [uuid(), tx.tenantId, uuid(), uuid(), uuid(), typeId, USER_A],
        /initial_status/,
      );
    });
  });

  it("un seul conseil vivant par classe, type et période ; annuler libère la place", async () => {
    await asUser(async (tx) => {
      const c = await council(tx, { participants: false });
      const dupe = [uuid(), tx.tenantId, c.institution, uuid(), c.classroom, (await tx.one("SELECT academic_period_id FROM councils.councils WHERE id = $1", [c.id])).academic_period_id, c.typeId, USER_A];
      const sql = "INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, academic_period_id, council_type_id, scope, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'PERIOD',$8)";
      await tx.fail(sql, dupe, /unique|23505/);
      await tx.q("UPDATE councils.councils SET status = 'CANCELLED', cancel_reason = 'Séance reportée' WHERE id = $1", [c.id]);
      await tx.q(sql, dupe);
    });
  });

  it("ouverture : un président PRÉSENT est indispensable", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const c = await council(tx);
      await tx.q("UPDATE councils.participants SET presence = 'ABSENT' WHERE id = $1", [c.president]);
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /president_required/);
      await tx.q("UPDATE councils.participants SET presence = 'PRESENT' WHERE id = $1", [c.president]);
      await tx.q("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id]);
      const row = await tx.one("SELECT status, opened_by, opened_at FROM councils.councils WHERE id = $1", [c.id]);
      assert.equal(row.status, "OPEN");
      assert.equal(row.opened_by, USER_A);
      assert.ok(row.opened_at);
    });
  });

  it("quorum : refus sous le seuil, ouverture avec dérogation motivée, dérogation interdite par l'établissement", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const c = await council(tx, { typeExtra: { min_participants: 4 } });
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /quorum_not_met: 3 présent/);
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date, quorum_waived = true WHERE id = $1", [c.id], /check|23514/); // motif absent
      await tx.q("UPDATE councils.councils SET status = 'OPEN', held_on = current_date, quorum_waived = true, quorum_waiver_reason = 'Urgence de fin de période' WHERE id = $1", [c.id]);
      const ev = await tx.q("SELECT kind, reason FROM councils.events WHERE council_id = $1 ORDER BY occurred_at, kind", [c.id]);
      assert.ok(ev.some((e) => e.kind === "OPENED" && e.reason === "Urgence de fin de période"));

      const c2 = await council(tx, { typeExtra: { min_participants: 4 } });
      await tx.q("INSERT INTO councils.settings (tenant_id, institution_id, allow_quorum_waiver) VALUES ($1,$2,false)", [tx.tenantId, c2.institution]);
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date, quorum_waived = true, quorum_waiver_reason = 'Urgence de fin de période' WHERE id = $1", [c2.id], /quorum_waiver_forbidden/);
    });
  });

  it("rôles exigés : un rôle sans présent bloque l'ouverture ; les délégués externes ne comptent pas au quorum", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const c = await council(tx, { typeExtra: { required_role_codes: "{DELEGATE}", min_participants: 3 } });
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /rôles manquants : DELEGATE/);
      await mk(tx, "councils.participants", { council_id: c.id, role_code: "DELEGATE", person_id: uuid(), display_name: "Délégué", presence: "PRESENT" });
      const q = await tx.one("SELECT * FROM councils.check_quorum($1)", [c.id]);
      assert.equal(q.present_count, 3, "le délégué ne compte pas au quorum");
      assert.equal(q.met, true);
      await tx.q("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id]);
    });
  });

  it("l'application seule (acteur système) ne peut ni ouvrir ni clore ni annuler une séance", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const c = await council(tx);
      await tx.as({ actor: "system" });
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /human_decision_required/);
      await tx.fail("UPDATE councils.councils SET status = 'CANCELLED', cancel_reason = 'Annulé par job' WHERE id = $1", [c.id], /human_decision_required/);
      await tx.as({ actor: "superAdmin" });
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /human_decision_required/);
    });
  });

  it("transitions : table fermée (PLANNED -> CLOSED, CANCELLED -> OPEN, SIGNED -> CLOSED interdits) ; identité figée", async () => {
    await asUser(async (tx) => {
      const c = await council(tx);
      await tx.fail("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id], /transition: PLANNED -> CLOSED/);
      await tx.fail("UPDATE councils.councils SET classroom_id = $2 WHERE id = $1", [c.id, uuid()], /identity_immutable/);
      await tx.q("UPDATE councils.councils SET status = 'CANCELLED', cancel_reason = 'Annulé pour test' WHERE id = $1", [c.id]);
      await tx.fail("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id], /transition: CANCELLED -> OPEN/);
      await tx.fail("UPDATE councils.councils SET title = 'x' WHERE id = $1", [c.id], /locked/);
    });
  });
});

describe("ordre du jour : instantané de faits", () => {
  it("hash et version posés par la base ; reconstruire l'instantané incrémente la version", async () => {
    await asUser(async (tx) => {
      const c = await council(tx, { open: false });
      const facts = { results: { average: "12.5", rank: 3 }, attendance: { absentMinutes: 120 } };
      const id = await item(tx, c.id, { facts: JSON.stringify(facts), facts_hash: "forgé", facts_version: 99 });
      const row = await tx.one("SELECT facts_hash, facts_version, prepared_at, councils.minutes_hash(facts) AS expected FROM councils.agenda_items WHERE id = $1", [id]);
      assert.equal(row.facts_version, 1);
      assert.equal(row.facts_hash, row.expected);
      assert.ok(row.prepared_at);
      await tx.q("UPDATE councils.agenda_items SET facts = $2::jsonb, facts_hash = 'forgé', facts_version = 50 WHERE id = $1", [id, JSON.stringify({ ...facts, results: { average: "13.0", rank: 2 } })]);
      const row2 = await tx.one("SELECT facts_hash, facts_version, councils.minutes_hash(facts) AS expected FROM councils.agenda_items WHERE id = $1", [id]);
      assert.equal(row2.facts_version, 2);
      assert.equal(row2.facts_hash, row2.expected);
      // une mise à jour sans changement de faits ne touche ni hash ni version
      await tx.q("UPDATE councils.agenda_items SET facts_hash = 'forgé', facts_version = 7, status = 'REVIEWED' WHERE id = $1", [id]);
      const row3 = await tx.one("SELECT facts_hash, facts_version FROM councils.agenda_items WHERE id = $1", [id]);
      assert.equal(row3.facts_version, 2);
      assert.equal(row3.facts_hash, row2.facts_hash);
    });
  });

  it("un élève ne figure qu'une fois par séance ; DECIDED exige une décision enregistrée", async () => {
    await asUser(async (tx) => {
      const c = await council(tx);
      const enrollment = uuid();
      await item(tx, c.id, { enrollment_id: enrollment });
      await tx.fail(
        "INSERT INTO councils.agenda_items (id, tenant_id, council_id, enrollment_id, student_id, student_display_name) VALUES ($1,$2,$3,$4,$5,'Doublon')",
        [uuid(), tx.tenantId, c.id, enrollment, uuid()],
        /unique|23505/,
      );
      const other = await item(tx, c.id);
      await tx.fail("UPDATE councils.agenda_items SET status = 'DECIDED' WHERE id = $1", [other], /no_decision/);
    });
  });

  it("la séance verrouillée fige l'ordre du jour, les participants et les propositions", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      await decide(tx, c, it1, ref.PASSAGE);
      await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
      await tx.fail("INSERT INTO councils.agenda_items (id, tenant_id, council_id, enrollment_id, student_id, student_display_name) VALUES ($1,$2,$3,$4,$5,'Tardif')", [uuid(), tx.tenantId, c.id, uuid(), uuid()], /agenda_frozen/);
      await tx.fail("UPDATE councils.participants SET presence = 'ABSENT' WHERE id = $1", [c.teacher], /participants_frozen/);
      await tx.fail("DELETE FROM councils.participants WHERE id = $1", [c.teacher], /participants_frozen/);
      await tx.fail("INSERT INTO councils.proposals (id, tenant_id, council_id, agenda_item_id, kind, body, origin, proposed_by) VALUES ($1,$2,$3,$4,'REMARK','tard','HUMAN',$5)", [uuid(), tx.tenantId, c.id, it1, USER_A], /proposals_frozen/);
    });
  });
});

describe("propositions : une suggestion de règle n'est pas une décision", () => {
  it("une suggestion peut être écrite par le système mais ne peut être acceptée que par un humain", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      await tx.as({ actor: "system", userId: "" });
      const sid = await mk(tx, "councils.proposals", { council_id: c.id, agenda_item_id: it1, kind: "DECISION", code: "PASSAGE", origin: "RULE_SUGGESTION", rule_version_ref: "CI-SECONDARY-PLACEHOLDER@1" });
      await tx.fail("UPDATE councils.proposals SET status = 'ACCEPTED', resolved_by = $2, resolved_at = now() WHERE id = $1", [sid, USER_A], /human_decision_required/);
      await tx.as({ actor: "user", userId: USER_A });
      await tx.fail("UPDATE councils.proposals SET status = 'ACCEPTED', resolved_by = $2, resolved_at = now() WHERE id = $1", [sid, USER_B], /resolver_mismatch/);
      await tx.q("UPDATE councils.proposals SET status = 'ACCEPTED', resolved_by = $2, resolved_at = now() WHERE id = $1", [sid, USER_A]);
      await tx.fail("UPDATE councils.proposals SET status = 'REJECTED', resolved_by = $2, resolved_at = now() WHERE id = $1", [sid, USER_A], /proposal_resolved/);
      assert.ok(ref.PASSAGE);
    });
  });

  it("CHECK : une suggestion n'a pas d'auteur humain, une proposition humaine en a un ; résolution sans résolveur interdite", async () => {
    await asUser(async (tx) => {
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      const sql = "INSERT INTO councils.proposals (id, tenant_id, council_id, agenda_item_id, kind, body, code, origin, proposed_by, status) VALUES ($1,$2,$3,$4,'DECISION',NULL,'PASSAGE',$5,$6,$7)";
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, it1, "RULE_SUGGESTION", USER_A, "PROPOSED"], /check|23514/);
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, it1, "HUMAN", null, "PROPOSED"], /check|23514/);
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, it1, "HUMAN", USER_A, "ACCEPTED"], /check|23514/);
    });
  });

  it("une proposition humaine porte l'utilisateur de la session ; son contenu ne change jamais", async () => {
    await asUser(async (tx) => {
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      await tx.fail("INSERT INTO councils.proposals (id, tenant_id, council_id, agenda_item_id, kind, body, origin, proposed_by) VALUES ($1,$2,$3,$4,'APPRECIATION','Bon trimestre','HUMAN',$5)", [uuid(), tx.tenantId, c.id, it1, USER_B], /proposer_mismatch/);
      const pid = await mk(tx, "councils.proposals", { council_id: c.id, agenda_item_id: it1, kind: "APPRECIATION", body: "Bon trimestre", origin: "HUMAN", proposed_by: USER_A, proposed_by_name: "Prof principal" });
      await tx.fail("UPDATE councils.proposals SET body = 'Excellent' WHERE id = $1", [pid], /proposal_immutable/);
      await tx.q("UPDATE councils.proposals SET status = 'WITHDRAWN', resolved_by = $2, resolved_at = now() WHERE id = $1", [pid, USER_A]);
    });
  });
});

describe("décisions : l'acte humain", () => {
  it("jamais sans utilisateur : refusées pour un acteur système, un enregistrant autre que la session, hors séance ouverte", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx);
      const it1 = await item(tx, c.id);
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PASSAGE, c.president, USER_A], /not_open/);
      await tx.q("UPDATE councils.councils SET status = 'OPEN', held_on = current_date WHERE id = $1", [c.id]);
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PASSAGE, c.president, USER_B], /recorder_mismatch/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PASSAGE, c.president, USER_A], /human_decision_required/);
      await tx.as({ actor: "user", userId: USER_A });
      const did = await decide(tx, c, it1, ref.PASSAGE);
      const row = await tx.one("SELECT decision_type_code, family, exclusive_group, facts_version FROM councils.decisions WHERE id = $1", [did]);
      assert.equal(row.decision_type_code, "PASSAGE", "code recopié du type, non falsifiable");
      assert.equal(row.family, "PASSAGE");
      assert.equal(row.exclusive_group, "YEAR_OUTCOME");
    });
  });

  it("le décideur est un participant PRÉSENT et habilité (can_decide)", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PASSAGE, c.teacher, USER_A], /decider_not_allowed/);
      const absent = await mk(tx, "councils.participants", { council_id: c.id, role_code: "PRESIDENT_ROLE", staff_id: uuid(), display_name: "Président suppléant", presence: "ABSENT" });
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PASSAGE, absent, USER_A], /decider_not_present/);
    });
  });

  it("écart avec la suggestion de la règle : justification d'au moins 20 caractères ; exigences propres au type (justification, vote, cible)", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      const sql = (extra) => decide(tx, c, it1, ref[extra.type], extra.cols);
      // écart sans justification suffisante : CHECK de table
      await tx.attempt(() => sql({ type: "PASSAGE", cols: { suggested_code: "REPEAT", differs_from_suggestion: true, justification: "trop court" } }), /check|23514/);
      await tx.attempt(() => sql({ type: "REPEAT", cols: {} }), /justification_required/);
      await tx.attempt(() => sql({ type: "ORIENT", cols: { target_grade_level_id: uuid() } }), /vote_required/);
      await tx.attempt(() => sql({ type: "ORIENT", cols: { decision_mode: "VOTE", votes_for: 5, votes_against: 1, votes_abstain: 0 } }), /target_required/);
      await tx.attempt(() => sql({ type: "ORIENT", cols: { decision_mode: "VOTE", votes_for: 5, votes_against: 1 } }), /check|23514/); // votes incomplets
      await sql({ type: "REPEAT", cols: { suggested_code: "PASSAGE", differs_from_suggestion: true, justification: "Résultats insuffisants malgré la suggestion favorable" } });
      const did = (await tx.one("SELECT differs_from_suggestion, suggested_code FROM councils.decisions WHERE agenda_item_id = $1", [it1]));
      assert.equal(did.differs_from_suggestion, true);
      assert.equal(did.suggested_code, "PASSAGE");
    });
  });

  it("groupe exclusif : passage et redoublement ne coexistent pas ; retirer libère ; l'élève passe DECIDED puis REVIEWED", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true });
      const it1 = await item(tx, c.id);
      const first = await decide(tx, c, it1, ref.PASSAGE);
      assert.equal((await tx.one("SELECT status FROM councils.agenda_items WHERE id = $1", [it1])).status, "DECIDED");
      await tx.attempt(() => decide(tx, c, it1, ref.REPEAT, { justification: "Résultats insuffisants constatés" }), /unique|23505/);
      await tx.fail("UPDATE councils.decisions SET status = 'WITHDRAWN' WHERE id = $1", [first], /check|23514/); // motif obligatoire
      await tx.fail("UPDATE councils.decisions SET justification = 'x' WHERE id = $1", [first], /decision_immutable/);
      await tx.q("UPDATE councils.decisions SET status = 'WITHDRAWN', withdrawn_reason = 'Erreur de saisie' WHERE id = $1", [first]);
      assert.equal((await tx.one("SELECT status FROM councils.agenda_items WHERE id = $1", [it1])).status, "REVIEWED");
      const second = await decide(tx, c, it1, ref.REPEAT, { justification: "Résultats insuffisants constatés", supersedes_id: first });
      assert.ok(second);
      await tx.fail("UPDATE councils.decisions SET status = 'RECORDED' WHERE id = $1", [first], /decision_final/);
    });
  });

  it("le type de décision doit s'appliquer à la portée du conseil", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true, scope: "YEAR" });
      const it1 = await item(tx, c.id);
      await tx.fail("INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, decision_mode, decider_participant_id, recorded_by, recorded_by_name) SELECT $1,$2,$3,$4,enrollment_id,student_id,$5,'X','OTHER','CONSENSUS',$6,$7,'S' FROM councils.agenda_items WHERE id = $4",
        [uuid(), tx.tenantId, c.id, it1, ref.PERIOD_ONLY, c.president, USER_A], /decision_scope/);
    });
  });
});

describe("clôture, procès-verbal, signatures", () => {
  async function closedCouncil(tx, extra = {}) {
    const ref = await seedReference(tx);
    const c = await council(tx, { open: true, ...extra });
    const it1 = await item(tx, c.id, { facts: JSON.stringify({ results: { average: "11.20" } }) });
    const decision = await decide(tx, c, it1, ref.PASSAGE);
    await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
    return { ref, c, it1, decision };
  }
  const snapshot = (n = 1) => JSON.stringify({ meta: { schema: "council-minutes/1", version: String(n) }, decisions: [{ student: "Élève", code: "PASSAGE" }], participants: 3 });
  const makeMinutes = (tx, c, extra = {}) => mk(tx, "councils.minutes", { council_id: c.id, version: 99, snapshot: snapshot(), snapshot_hash: "0".repeat(64), generated_by: USER_A, ...extra });

  it("clôture : refusée tant que des élèves restent sans décision (si le type l'exige) ; posée par un utilisateur", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const c = await council(tx, { open: true, typeExtra: { requires_decision_per_student: true } });
      await item(tx, c.id);
      await tx.fail("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id], /undecided_students: 1/);
    });
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const row = await tx.one("SELECT closed_by, closed_at FROM councils.councils WHERE id = $1", [c.id]);
      assert.equal(row.closed_by, USER_A);
      assert.ok(row.closed_at);
    });
  });

  it("procès-verbal : séance close exigée ; hash calculé par la base (le hash fourni est ignoré) ; version attribuée par la base", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const open = await council(tx, { open: true });
      await tx.fail("INSERT INTO councils.minutes (id, tenant_id, council_id, version, snapshot, snapshot_hash, generated_by) VALUES ($1,$2,$3,1,'{}'::jsonb,$4,$5)", [uuid(), tx.tenantId, open.id, "0".repeat(64), USER_A], /not_closed/);
      assert.ok(ref);
    });
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const mid = await makeMinutes(tx, c);
      const row = await tx.one("SELECT version, snapshot_hash, councils.minutes_hash(snapshot) AS expected, status FROM councils.minutes WHERE id = $1", [mid]);
      assert.equal(row.version, 1);
      assert.equal(row.snapshot_hash, row.expected);
      assert.notEqual(row.snapshot_hash, "0".repeat(64));
      assert.equal(row.status, "GENERATED");
      assert.match(row.snapshot_hash, /^[0-9a-f]{64}$/);
    });
  });

  it("procès-verbal immuable : snapshot, hash, version intouchables ; ni suppression ; un seul vivant", async () => {
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const mid = await makeMinutes(tx, c);
      await tx.fail("UPDATE councils.minutes SET snapshot = '{\"x\":1}'::jsonb WHERE id = $1", [mid], /minutes_immutable/);
      await tx.fail("UPDATE councils.minutes SET snapshot_hash = $2 WHERE id = $1", [mid, "f".repeat(64)], /minutes_immutable/);
      await tx.fail("UPDATE councils.minutes SET version = 2 WHERE id = $1", [mid], /minutes_immutable/);
      await tx.fail("DELETE FROM councils.minutes WHERE id = $1", [mid], /permission denied|42501|immutable/);
      await tx.fail("UPDATE councils.minutes SET status = 'SIGNED', signed_at = now() WHERE id = $1", [mid], /signatures_missing/);
      await tx.fail("INSERT INTO councils.minutes (id, tenant_id, council_id, version, snapshot, snapshot_hash, generated_by) VALUES ($1,$2,$3,2,'{}'::jsonb,$4,$5)", [uuid(), tx.tenantId, c.id, "0".repeat(64), USER_A], /unique|23505/);
      // le rendu PDF (worker) ne touche que les champs de rendu
      await tx.q("UPDATE councils.minutes SET render_status = 'RENDERED', render_object_key = 'minutes/x.pdf', render_hash = $2 WHERE id = $1", [mid, "a".repeat(64)]);
    });
  });

  it("signatures : mauvais hash, participant non signataire, signataire usurpé refusés ; tout recueilli => procès-verbal ET séance SIGNED", async () => {
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const mid = await makeMinutes(tx, c);
      const { snapshot_hash: hash } = await tx.one("SELECT snapshot_hash FROM councils.minutes WHERE id = $1", [mid]);
      const sign = (participant, extra = {}) => ({
        sql: "INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user) VALUES ($1,$2,$3,$4,'X','X',$5,$6,$7)",
        params: [uuid(), tx.tenantId, mid, participant, extra.method ?? "ELECTRONIC", extra.hash ?? hash, extra.user ?? USER_A],
      });
      let s = sign(c.president, { hash: "e".repeat(64) });
      await tx.fail(s.sql, s.params, /signature_hash_mismatch/);
      s = sign(c.teacher);
      await tx.fail(s.sql, s.params, /not_a_signer/);
      s = sign(c.president, { user: USER_B });
      await tx.fail(s.sql, s.params, /signer_mismatch/);
      s = sign(c.president);
      await tx.q(s.sql, s.params);
      assert.equal(await status(tx, c.id), "CLOSED", "une signature sur deux ne signe pas la séance");
      assert.equal((await tx.one("SELECT status FROM councils.minutes WHERE id = $1", [mid])).status, "GENERATED");
      const dup = sign(c.president);
      await tx.fail(dup.sql, dup.params, /unique|23505/);
      s = sign(c.secretary);
      await tx.q(s.sql, s.params);
      assert.equal(await status(tx, c.id), "SIGNED");
      const m = await tx.one("SELECT status, signed_at FROM councils.minutes WHERE id = $1", [mid]);
      assert.equal(m.status, "SIGNED");
      assert.ok(m.signed_at);
      const sigs = await tx.q("SELECT signer_name, role_code, method, signed_at FROM councils.minute_signatures WHERE minutes_id = $1 ORDER BY role_code", [mid]);
      assert.equal(sigs.length, 2);
      assert.deepEqual(sigs.map((x) => x.signer_name).sort(), ["Président Test", "Secrétaire Test"]);
      assert.ok(sigs.every((x) => x.signed_at), "signatures datées");
      await tx.fail("UPDATE councils.minute_signatures SET signer_name = 'Autre'", [], /immutable|permission denied|42501/);
      await tx.fail("UPDATE councils.councils SET title = 'Changé' WHERE id = $1", [c.id], /locked/);
    });
  });

  it("signature papier numérisée : pièce obligatoire ; acteur système refusé", async () => {
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const mid = await makeMinutes(tx, c);
      const { snapshot_hash: hash } = await tx.one("SELECT snapshot_hash FROM councils.minutes WHERE id = $1", [mid]);
      const sql = "INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user, evidence_object_key) VALUES ($1,$2,$3,$4,'X','X','SCANNED_PAPER',$5,$6,$7)";
      await tx.fail(sql, [uuid(), tx.tenantId, mid, c.president, hash, USER_A, null], /check|23514/);
      await tx.q(sql, [uuid(), tx.tenantId, mid, c.president, hash, USER_A, "scans/pv-president.png"]);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail(sql, [uuid(), tx.tenantId, mid, c.secretary, hash, USER_A, "scans/pv-sec.png"], /human_decision_required/);
    });
  });

  it("déverrouillage motivé : demande approuvée par une autre personne, consommée une fois ; PV remplacé ; nouvelle version à la reclôture", async () => {
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const mid = await makeMinutes(tx, c);
      const { snapshot_hash: hash } = await tx.one("SELECT snapshot_hash FROM councils.minutes WHERE id = $1", [mid]);
      for (const p of [c.president, c.secretary]) {
        await tx.q("INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user) VALUES ($1,$2,$3,$4,'X','X','ELECTRONIC',$5,$6)", [uuid(), tx.tenantId, mid, p, hash, USER_A]);
      }
      assert.equal(await status(tx, c.id), "SIGNED");

      // sans demande approuvée : refus
      await tx.fail("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id], /unlock_not_approved/);
      // demande : motif d'au moins 20 caractères
      await tx.fail("INSERT INTO councils.unlock_requests (id, tenant_id, council_id, requested_by, requested_by_name, reason) VALUES ($1,$2,$3,$4,'Demandeur','trop court')", [uuid(), tx.tenantId, c.id, USER_A], /check|23514/);
      const rid = await mk(tx, "councils.unlock_requests", { council_id: c.id, requested_by: USER_A, requested_by_name: "Directeur", reason: "Erreur de saisie d'une décision détectée après signature" });
      await tx.fail("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id], /unlock_not_approved/); // demande non approuvée
      // auto-approbation interdite (quatre yeux)
      await tx.fail("UPDATE councils.unlock_requests SET status = 'APPROVED', decided_by = $2, decided_by_name = 'Directeur' WHERE id = $1", [rid, USER_A], /check|23514/);
      await tx.fail("UPDATE councils.unlock_requests SET status = 'APPROVED', decided_by = $2, decided_by_name = 'Directeur', four_eyes_waived = true WHERE id = $1", [rid, USER_A], /four_eyes_required/);
      await tx.as({ userId: USER_B });
      await tx.q("UPDATE councils.unlock_requests SET status = 'APPROVED', decided_by = $2, decided_by_name = 'Proviseur', decision_note = 'Approuvé' WHERE id = $1", [rid, USER_B]);
      await tx.fail("UPDATE councils.unlock_requests SET reason = 'autre motif très différent du premier' WHERE id = $1", [rid], /unlock_immutable/);
      await tx.q("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id]);

      const row = await tx.one("SELECT status, reopen_count, signed_at, closed_at FROM councils.councils WHERE id = $1", [c.id]);
      assert.equal(row.status, "OPEN");
      assert.equal(row.reopen_count, 1);
      assert.equal(row.signed_at, null);
      assert.equal(row.closed_at, null);
      assert.equal((await tx.one("SELECT status FROM councils.unlock_requests WHERE id = $1", [rid])).status, "CONSUMED");
      assert.equal((await tx.one("SELECT status FROM councils.minutes WHERE id = $1", [mid])).status, "SUPERSEDED");
      const ev = await tx.q("SELECT kind, reason FROM councils.events WHERE council_id = $1 AND kind = 'REOPENED'", [c.id]);
      assert.equal(ev.length, 1);
      assert.match(ev[0].reason, /Erreur de saisie/);

      // décisions de nouveau possibles ; la reclôture produit la version 2 du procès-verbal qui remplace la 1
      await tx.as({ userId: USER_A });
      await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
      const mid2 = await makeMinutes(tx, c, { snapshot: snapshot(2) });
      const v2 = await tx.one("SELECT version, supersedes_id FROM councils.minutes WHERE id = $1", [mid2]);
      assert.equal(v2.version, 2);
      assert.equal(v2.supersedes_id, mid);
      // la demande consommée ne rouvre plus rien
      await tx.fail("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id], /unlock_not_approved/);
    });
  });

  it("déverrouillage : une seule demande ouverte à la fois ; impossible si la séance n'est pas verrouillée", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const open = await council(tx, { open: true });
      await tx.fail("INSERT INTO councils.unlock_requests (id, tenant_id, council_id, requested_by, requested_by_name, reason) VALUES ($1,$2,$3,$4,'D','Motif suffisamment long pour passer')", [uuid(), tx.tenantId, open.id, USER_A], /unlock_not_needed/);
    });
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      await mk(tx, "councils.unlock_requests", { council_id: c.id, requested_by: USER_A, requested_by_name: "D", reason: "Premier motif suffisamment long" });
      await tx.fail("INSERT INTO councils.unlock_requests (id, tenant_id, council_id, requested_by, requested_by_name, reason) VALUES ($1,$2,$3,$4,'D','Second motif suffisamment long')", [uuid(), tx.tenantId, c.id, USER_A], /unique|23505/);
    });
  });

  it("journal de séance : événements automatiques (CREATED, OPENED, CLOSED) en ajout seul", async () => {
    await asUser(async (tx) => {
      const { c } = await closedCouncil(tx);
      const kinds = (await tx.q("SELECT kind FROM councils.events WHERE council_id = $1 ORDER BY occurred_at, kind", [c.id])).map((e) => e.kind);
      assert.deepEqual(kinds.sort(), ["CLOSED", "CREATED", "OPENED"]);
      const e = (await tx.q("SELECT actor_id, actor_kind FROM councils.events WHERE council_id = $1 AND kind = 'CLOSED'", [c.id]))[0];
      assert.equal(e.actor_id, USER_A);
      assert.equal(e.actor_kind, "user");
      await tx.fail("UPDATE councils.events SET reason = 'réécrit' WHERE council_id = $1", [c.id], /immutable|permission denied|42501/);
    });
  });
});

describe("effets des décisions", () => {
  async function signedCouncil(tx, { settingsTrigger } = {}) {
    const ref = await seedReference(tx);
    const institution = uuid();
    if (settingsTrigger) {
      await tx.q("INSERT INTO councils.settings (tenant_id, institution_id, effects_trigger) VALUES ($1,$2,$3)", [tx.tenantId, institution, settingsTrigger]);
    }
    const c = await council(tx, { open: true, institution });
    const it1 = await item(tx, c.id);
    const passage = await decide(tx, c, it1, ref.PASSAGE);
    const it2 = await item(tx, c.id);
    const excl = await decide(tx, c, it2, ref.EXCL, { justification: "Faits graves établis par le conseil de discipline" });
    await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
    return { ref, c, passage, excl };
  }
  const effect = (tx, c, decision, kind, status = "PENDING") =>
    mk(tx, "councils.effects", { council_id: c.id, decision_id: decision, effect_kind: kind, status });

  it("par défaut les effets ne naissent qu'à la signature ; réglage CLOSED : dès la clôture", async () => {
    await asUser(async (tx) => {
      const { c, passage } = await signedCouncil(tx);
      await tx.fail("INSERT INTO councils.effects (id, tenant_id, council_id, decision_id, effect_kind) VALUES ($1,$2,$3,$4,'RESULTS_DECISION')", [uuid(), tx.tenantId, c.id, passage], /effects_too_early/);
    });
    await asUser(async (tx) => {
      const { c, passage } = await signedCouncil(tx, { settingsTrigger: "CLOSED" });
      await effect(tx, c, passage, "RESULTS_DECISION");
    });
  });

  it("un effet vivant par (décision, nature) ; l'exclusion n'est JAMAIS appliquée automatiquement", async () => {
    await asUser(async (tx) => {
      const { c, passage, excl } = await signedCouncil(tx, { settingsTrigger: "CLOSED" });
      await effect(tx, c, passage, "ENROLLMENT_OUTCOME");
      await tx.fail("INSERT INTO councils.effects (id, tenant_id, council_id, decision_id, effect_kind) VALUES ($1,$2,$3,$4,'ENROLLMENT_OUTCOME')", [uuid(), tx.tenantId, c.id, passage], /unique|23505/);
      // exclusion : tout effet (hors notification) naît en attente d'un humain
      await tx.fail("INSERT INTO councils.effects (id, tenant_id, council_id, decision_id, effect_kind, status) VALUES ($1,$2,$3,$4,'STUDENT_STATUS_REQUEST','PENDING')", [uuid(), tx.tenantId, c.id, excl], /human_application_required/);
      await tx.fail("INSERT INTO councils.effects (id, tenant_id, council_id, decision_id, effect_kind, status) VALUES ($1,$2,$3,$4,'ENROLLMENT_OUTCOME','PENDING')", [uuid(), tx.tenantId, c.id, excl], /human_application_required/);
      const req = await effect(tx, c, excl, "STUDENT_STATUS_REQUEST", "AWAITING_HUMAN");
      await effect(tx, c, excl, "NOTIFY_GUARDIANS", "PENDING"); // la notification reste automatique
      // le worker (acteur système) ne peut pas l'appliquer
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE councils.effects SET status = 'APPLIED', applied_at = now() WHERE id = $1", [req], /human_decision_required/);
      // un humain habilité l'applique : applied_by est posé par la base
      await tx.as({ actor: "user", userId: USER_B });
      await tx.q("UPDATE councils.effects SET status = 'APPLIED', applied_at = now(), applied_by = $2 WHERE id = $1", [req, USER_A]);
      const row = await tx.one("SELECT status, applied_by FROM councils.effects WHERE id = $1", [req]);
      assert.equal(row.status, "APPLIED");
      assert.equal(row.applied_by, USER_B, "applied_by = utilisateur de la session, non falsifiable");
    });
  });

  it("appréciation générale et distinction : seul un humain qui ACCEPTE la proposition produit l'effet correspondant", async () => {
    await asUser(async (tx) => {
      await seedReference(tx);
      const institution = uuid();
      await tx.q("INSERT INTO councils.settings (tenant_id, institution_id, effects_trigger) VALUES ($1,$2,'CLOSED')", [tx.tenantId, institution]);
      const c = await council(tx, { open: true, institution });
      const it1 = await item(tx, c.id);
      const human = { origin: "HUMAN", proposed_by: USER_A, proposed_by_name: "Professeur principal" };
      const appreciation = await mk(tx, "councils.proposals", { council_id: c.id, agenda_item_id: it1, kind: "APPRECIATION", body: "Bon trimestre, à encourager", ...human });
      const distinction = await mk(tx, "councils.proposals", { council_id: c.id, agenda_item_id: it1, kind: "DISTINCTION", code: "HONOR_ROLL", ...human });
      await tx.q("UPDATE councils.proposals SET status = 'ACCEPTED', resolved_by = $2, resolved_at = now() WHERE id = $1", [appreciation, USER_A]);
      await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
      const sql = "INSERT INTO councils.effects (id, tenant_id, council_id, proposal_id, effect_kind) VALUES ($1,$2,$3,$4,$5)";
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, distinction, "RESULTS_DISTINCTION"], /effect_proposal/); // non acceptée
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, appreciation, "RESULTS_DISTINCTION"], /effect_proposal/); // mauvaise nature
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, appreciation, "RESULTS_DECISION"], /check|23514/); // une décision, pas une proposition
      await tx.q(sql, [uuid(), tx.tenantId, c.id, appreciation, "RESULTS_APPRECIATION"]);
      await tx.fail(sql, [uuid(), tx.tenantId, c.id, appreciation, "RESULTS_APPRECIATION"], /unique|23505/);
    });
  });

  it("machine d'états des effets : APPLIED -> REVERTED motivé, jamais si irréversible ; échec puis reprise", async () => {
    await asUser(async (tx) => {
      const { c, passage } = await signedCouncil(tx, { settingsTrigger: "CLOSED" });
      const e1 = await effect(tx, c, passage, "RESULTS_DECISION");
      await tx.q("UPDATE councils.effects SET status = 'FAILED', attempts = 1, last_error = 'results indisponible' WHERE id = $1", [e1]);
      await tx.q("UPDATE councils.effects SET status = 'PENDING' WHERE id = $1", [e1]);
      await tx.q("UPDATE councils.effects SET status = 'APPLIED', applied_at = now() WHERE id = $1", [e1]);
      await tx.fail("UPDATE councils.effects SET status = 'PENDING' WHERE id = $1", [e1], /effect_transition/);
      await tx.fail("UPDATE councils.effects SET status = 'REVERTED', reverted_at = now() WHERE id = $1", [e1], /check|23514/); // motif obligatoire
      await tx.q("UPDATE councils.effects SET status = 'REVERTED', reverted_at = now(), revert_reason = 'Décision retirée' WHERE id = $1", [e1]);
      const e2 = await effect(tx, c, passage, "ENROLLMENT_OUTCOME");
      await tx.q("UPDATE councils.effects SET status = 'APPLIED', applied_at = now(), irreversible = true WHERE id = $1", [e2]);
      await tx.fail("UPDATE councils.effects SET status = 'REVERTED', reverted_at = now(), revert_reason = 'Tentative' WHERE id = $1", [e2], /effect_irreversible/);
    });
  });

  it("déverrouillage : refusé tant qu'un effet est APPLIED (même annulable) ; les effets non appliqués sont écartés (SKIPPED) puis réarmables", async () => {
    await asUser(async (tx) => {
      const { c, passage, excl } = await signedCouncil(tx, { settingsTrigger: "CLOSED" });
      const applied = await effect(tx, c, passage, "ENROLLMENT_OUTCOME");
      await tx.q("UPDATE councils.effects SET status = 'APPLIED', applied_at = now() WHERE id = $1", [applied]);
      const awaiting = await effect(tx, c, excl, "STUDENT_STATUS_REQUEST", "AWAITING_HUMAN");
      const rid = await mk(tx, "councils.unlock_requests", { council_id: c.id, requested_by: USER_A, requested_by_name: "D", reason: "Correction nécessaire après contrôle des décisions" });
      await tx.as({ userId: USER_B });
      await tx.q("UPDATE councils.unlock_requests SET status = 'APPROVED', decided_by = $2, decided_by_name = 'P' WHERE id = $1", [rid, USER_B]);
      await tx.fail("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id], /effect_irreversible/);
      await tx.q("UPDATE councils.effects SET status = 'REVERTED', reverted_at = now(), revert_reason = 'Annulation avant réouverture' WHERE id = $1", [applied]);
      await tx.q("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [c.id]);
      assert.equal((await tx.one("SELECT status FROM councils.effects WHERE id = $1", [awaiting])).status, "SKIPPED");
      // réarmement après nouvelle clôture : la demande d'exclusion redevient AWAITING_HUMAN
      await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
      await tx.q("UPDATE councils.effects SET status = 'AWAITING_HUMAN' WHERE id = $1", [awaiting]);
      await tx.fail("UPDATE councils.effects SET status = 'PENDING' WHERE id = $1", [awaiting], /effect_transition/);
    });
  });
});

describe("orientation et passage d'une série à l'autre", () => {
  const path = (tx, extra = {}) =>
    mk(tx, "councils.orientation_paths", { kind: "SERIES_CHANGE", from_grade_level_id: extra.from ?? uuid(), to_program_id: extra.toProgram ?? uuid(), to_grade_level_id: extra.toLevel ?? uuid(), ...extra.cols });

  it("aucun parcours livré par défaut (aucun parcours officiel inventé) ; unicité d'un parcours", async () => {
    await asUser(async (tx) => {
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM councils.orientation_paths"))[0].n, 0);
      const fromLevel = uuid();
      const toProgram = uuid();
      const toLevel = uuid();
      await path(tx, { from: fromLevel, toProgram, toLevel });
      await tx.fail(
        "INSERT INTO councils.orientation_paths (id, tenant_id, kind, from_grade_level_id, to_program_id, to_grade_level_id) VALUES ($1,$2,'SERIES_CHANGE',$3,$4,$5)",
        [uuid(), tx.tenantId, fromLevel, toProgram, toLevel],
        /unique|23505/,
      );
    });
  });

  it("transfert de série : décision humaine obligatoire, parcours autorisé ou dérogation motivée, cible conforme à la décision du conseil", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true, scope: "YEAR" });
      const it1 = await item(tx, c.id);
      const targetProgram = uuid();
      const targetLevel = uuid();
      const fromProgram = uuid();
      const fromLevel = uuid();
      const dec = await decide(tx, c, it1, ref.ORIENT, { decision_mode: "VOTE", votes_for: 6, votes_against: 1, votes_abstain: 1, target_program_id: targetProgram, target_grade_level_id: targetLevel, target_label: "Série visée" });
      const enrollment = (await tx.one("SELECT enrollment_id, student_id FROM councils.agenda_items WHERE id = $1", [it1]));
      const base = { institution_id: c.institution, enrollment_id: enrollment.enrollment_id, student_id: enrollment.student_id, from_program_id: fromProgram, from_grade_level_id: fromLevel, to_program_id: targetProgram, to_grade_level_id: targetLevel, effective_kind: "NEXT_YEAR", decided_via: "COUNCIL", decision_id: dec, created_by: USER_A };
      const ins = (cols) => {
        const all = { id: uuid(), tenant_id: tx.tenantId, ...base, ...cols };
        const keys = Object.keys(all);
        return { sql: `INSERT INTO councils.series_transfers (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, params: Object.values(all) };
      };
      // ni parcours ni dérogation : CHECK
      let s = ins({});
      await tx.fail(s.sql, s.params, /override_actor/); // ni parcours déclaré ni dérogation de l'utilisateur de la session
      // dérogation de parcours : motif de 20 caractères et utilisateur de la session
      s = ins({ path_override_reason: "Parcours non encore saisi dans le référentiel", path_override_by: USER_B });
      await tx.fail(s.sql, s.params, /override_actor/);
      // décision du conseil qui vise une autre série
      const otherDec = await decide(tx, c, await item(tx, c.id), ref.ORIENT, { decision_mode: "VOTE", votes_for: 4, votes_against: 0, votes_abstain: 0, target_program_id: uuid(), target_grade_level_id: targetLevel });
      s = ins({ decision_id: otherDec, path_override_reason: "Parcours non encore saisi dans le référentiel", path_override_by: USER_A });
      await tx.fail(s.sql, s.params, /decision_target_mismatch/);
      // acte de direction sans référence d'acte : CHECK
      s = ins({ decided_via: "DIRECTOR_ACT", decision_id: null, path_override_reason: "Parcours non encore saisi dans le référentiel", path_override_by: USER_A });
      await tx.fail(s.sql, s.params, /check|23514/);
      // correct : dérogation motivée
      s = ins({ path_override_reason: "Parcours non encore saisi dans le référentiel", path_override_by: USER_A });
      await tx.q(s.sql, s.params);
      // un seul transfert vivant par inscription
      s = ins({ path_override_reason: "Parcours non encore saisi dans le référentiel", path_override_by: USER_A });
      await tx.fail(s.sql, s.params, /unique|23505/);
    });
  });

  it("transfert via un parcours déclaré : le parcours doit correspondre ; l'acte de direction exige référence et signataire ; application sans trace refusée", async () => {
    await asUser(async (tx) => {
      const fromLevel = uuid();
      const toProgram = uuid();
      const toLevel = uuid();
      const fromProgram = uuid();
      const good = await path(tx, { from: fromLevel, toProgram, toLevel });
      const wrong = await path(tx, { from: fromLevel, toProgram: uuid(), toLevel });
      const base = { id: null, tenant_id: tx.tenantId, institution_id: uuid(), enrollment_id: uuid(), student_id: uuid(), from_program_id: fromProgram, from_grade_level_id: fromLevel, to_program_id: toProgram, to_grade_level_id: toLevel, effective_kind: "MID_YEAR", effective_on: "2027-01-10", decided_via: "DIRECTOR_ACT", act_reference: "ACTE-2027-014", act_issued_by: USER_A, created_by: USER_A };
      const ins = (cols) => {
        const all = { ...base, id: uuid(), ...cols };
        const keys = Object.keys(all);
        return { sql: `INSERT INTO councils.series_transfers (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, params: Object.values(all) };
      };
      let s = ins({ path_id: wrong });
      await tx.fail(s.sql, s.params, /path_mismatch/);
      s = ins({ path_id: good, effective_on: null });
      await tx.fail(s.sql, s.params, /check|23514/); // MID_YEAR sans date
      s = ins({ path_id: good, act_reference: null });
      await tx.fail(s.sql, s.params, /check|23514/);
      s = ins({ path_id: good });
      await tx.q(s.sql, s.params);
      const tid = (await tx.one("SELECT id FROM councils.series_transfers LIMIT 1")).id;
      await tx.fail("UPDATE councils.series_transfers SET status = 'APPLIED', applied_at = now() WHERE id = $1", [tid], /check|23514/); // applied_ref obligatoire
      await tx.fail("UPDATE councils.series_transfers SET to_program_id = $2 WHERE id = $1", [tid, uuid()], /transfer_immutable/);
      await tx.fail("UPDATE councils.series_transfers SET status = 'CANCELLED' WHERE id = $1", [tid], /check|23514/); // motif
      await tx.q("UPDATE councils.series_transfers SET status = 'APPLIED', applied_at = now(), applied_ref = $2 WHERE id = $1", [tid, uuid()]);
      await tx.fail("UPDATE councils.series_transfers SET status = 'PLANNED' WHERE id = $1", [tid], /transfer_transition/);
    });
  });

  it("dossier d'orientation : un par inscription ; vœux classés ; accord de la famille exigé par le parcours avant application", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true, scope: "YEAR" });
      const it1 = await item(tx, c.id);
      const targetProgram = uuid();
      const targetLevel = uuid();
      const fromProgram = uuid();
      const fromLevel = uuid();
      const dec = await decide(tx, c, it1, ref.ORIENT, { decision_mode: "VOTE", votes_for: 3, votes_against: 0, votes_abstain: 0, target_program_id: targetProgram, target_grade_level_id: targetLevel });
      const row = await tx.one("SELECT enrollment_id, student_id FROM councils.agenda_items WHERE id = $1", [it1]);
      const pid = await path(tx, { from: fromLevel, toProgram: targetProgram, toLevel: targetLevel, cols: { requires_guardian_consent: true, kind: "ORIENTATION" } });
      const fid = await mk(tx, "councils.orientation_files", { institution_id: c.institution, academic_year_id: uuid(), enrollment_id: row.enrollment_id, student_id: row.student_id, current_program_id: fromProgram, current_grade_level_id: fromLevel, guardian_consent: "PENDING", created_by: USER_A });
      await tx.fail("INSERT INTO councils.orientation_files (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, current_program_id, current_grade_level_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [uuid(), tx.tenantId, c.institution, uuid(), row.enrollment_id, row.student_id, fromProgram, fromLevel, USER_A], /unique|23505/);
      await mk(tx, "councils.orientation_wishes", { file_id: fid, rank: 1, to_program_id: targetProgram, to_grade_level_id: targetLevel, source: "GUARDIAN", expressed_by: USER_A });
      await tx.fail("INSERT INTO councils.orientation_wishes (id, tenant_id, file_id, rank, to_program_id, to_grade_level_id, source, expressed_by) VALUES ($1,$2,$3,1,$4,$5,'STUDENT',$6)", [uuid(), tx.tenantId, fid, targetProgram, targetLevel, USER_A], /unique|23505/);
      await tx.fail("UPDATE councils.orientation_files SET status = 'DECIDED' WHERE id = $1", [fid], /check|23514/); // decision_id obligatoire
      await tx.q("UPDATE councils.orientation_files SET status = 'DECIDED', decision_id = $2 WHERE id = $1", [fid, dec]);
      await mk(tx, "councils.series_transfers", { institution_id: c.institution, enrollment_id: row.enrollment_id, student_id: row.student_id, from_program_id: fromProgram, from_grade_level_id: fromLevel, to_program_id: targetProgram, to_grade_level_id: targetLevel, effective_kind: "NEXT_YEAR", decided_via: "COUNCIL", decision_id: dec, path_id: pid, created_by: USER_A });
      await tx.fail("UPDATE councils.orientation_files SET status = 'APPLIED' WHERE id = $1", [fid], /consent_required/);
      await tx.fail("UPDATE councils.orientation_files SET guardian_consent = 'GIVEN' WHERE id = $1", [fid], /check|23514/); // qui a recueilli l'accord ?
      await tx.q("UPDATE councils.orientation_files SET guardian_consent = 'GIVEN', consent_recorded_by = $2, consent_recorded_at = now() WHERE id = $1", [fid, USER_A]);
      await tx.q("UPDATE councils.orientation_files SET status = 'APPLIED' WHERE id = $1", [fid]);
    });
  });

  it("une décision retenue dans un dossier doit concerner la même inscription", async () => {
    await asUser(async (tx) => {
      const ref = await seedReference(tx);
      const c = await council(tx, { open: true, scope: "YEAR" });
      const it1 = await item(tx, c.id);
      const dec = await decide(tx, c, it1, ref.PASSAGE);
      const fid = await mk(tx, "councils.orientation_files", { institution_id: c.institution, academic_year_id: uuid(), enrollment_id: uuid(), student_id: uuid(), current_program_id: uuid(), current_grade_level_id: uuid(), created_by: USER_A });
      await tx.fail("UPDATE councils.orientation_files SET status = 'DECIDED', decision_id = $2 WHERE id = $1", [fid, dec], /orientation_decision/);
    });
  });
});

describe("concurrence", () => {
  it("deux signataires qui signent en même temps : le procès-verbal et la séance passent SIGNED (signatures sérialisées)", async () => {
    const tenant = await newTenant(d.db, "conc");
    // préparation validée (COMMIT) : séance close avec un procès-verbal généré
    const ids = await inTenant(
      d.db,
      { tenantId: tenant, userId: USER_A, actor: "user" },
      async (tx) => {
        const ref = await seedReference(tx);
        const c = await council(tx, { open: true });
        const it1 = await item(tx, c.id);
        await decide(tx, c, it1, ref.PASSAGE);
        await tx.q("UPDATE councils.councils SET status = 'CLOSED' WHERE id = $1", [c.id]);
        const mid = await mk(tx, "councils.minutes", { council_id: c.id, version: 1, snapshot: JSON.stringify({ meta: { schema: "council-minutes/1" } }), snapshot_hash: "0".repeat(64), generated_by: USER_A });
        const { snapshot_hash: hash } = await tx.one("SELECT snapshot_hash FROM councils.minutes WHERE id = $1", [mid]);
        return { c, mid, hash };
      },
      { commit: true },
    );
    const sign = async (participant, user) => {
      const client = new Client({ connectionString: d.url });
      await client.connect();
      try {
        await inTenant(
          client,
          { tenantId: tenant, userId: user, actor: "user" },
          async (tx) => {
            await tx.q(
              "INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user) VALUES ($1,$2,$3,$4,'X','X','ELECTRONIC',$5,$6)",
              [uuid(), tenant, ids.mid, participant, ids.hash, user],
            );
            await new Promise((r) => setTimeout(r, 300)); // garde la transaction ouverte : l'autre signature doit attendre
          },
          { commit: true },
        );
      } finally {
        await client.end();
      }
    };
    await Promise.all([sign(ids.c.president, uuid()), sign(ids.c.secretary, uuid())]);
    await inTenant(d.db, { tenantId: tenant, userId: USER_A }, async (tx) => {
      assert.equal(await status(tx, ids.c.id), "SIGNED");
      assert.equal((await tx.one("SELECT status FROM councils.minutes WHERE id = $1", [ids.mid])).status, "SIGNED");
      assert.equal((await tx.q("SELECT 1 FROM councils.minute_signatures WHERE minutes_id = $1", [ids.mid])).length, 2);
    });
  });

  it("deux conseils concurrents pour la même classe, le même type et la même période : un seul est créé", async () => {
    const tenant = await newTenant(d.db, "conc2");
    const base = await inTenant(
      d.db,
      { tenantId: tenant, userId: USER_A },
      async (tx) => {
        const typeId = await mk(tx, "councils.council_types", { code: "CONC", label: "Conseil", scope: "PERIOD" });
        return { typeId, cls: uuid(), period: uuid(), inst: uuid(), year: uuid() };
      },
      { commit: true },
    );
    const create = async () => {
      const client = new Client({ connectionString: d.url });
      await client.connect();
      try {
        await inTenant(
          client,
          { tenantId: tenant, userId: USER_A, actor: "user" },
          async (tx) => {
            await tx.q(
              "INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, academic_period_id, council_type_id, scope, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'PERIOD',$8)",
              [uuid(), tenant, base.inst, base.year, base.cls, base.period, base.typeId, USER_A],
            );
            await new Promise((r) => setTimeout(r, 200));
          },
          { commit: true },
        );
        return "ok";
      } catch (e) {
        return e.code;
      } finally {
        await client.end();
      }
    };
    const results = await Promise.all([create(), create()]);
    assert.deepEqual([...results].sort(), ["23505", "ok"]);
  });
});
