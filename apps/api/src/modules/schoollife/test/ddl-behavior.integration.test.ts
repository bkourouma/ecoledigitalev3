// @ts-nocheck — port VERBATIM des 28 tests de comportement du DDL (specs/v2/006-secondary/ddl-test/schoollife.test.mjs) :
// scénarios en SQL brut sous app_user, volontairement peu typés. S'ignore sans TEST_DATABASE_URL.
import { afterAll as after, beforeAll as before, describe, it } from "vitest";
import assert from "node:assert/strict";
import { inTenant, insert, newTenant, structuralIsolationViolations, uuid } from "./support/sql-harness";
import { createModuleTestDb, TEST_DATABASE_URL } from "./support/db";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

let d;
const PROPOSER = uuid();
const VALIDATOR = uuid();

before(async () => {
  if (!TEST_DATABASE_URL) return;
  const m = await createModuleTestDb();
  d = { db: m.admin, close: () => m.drop() };
});
after(async () => {
  await d?.close();
});
const mk = (tx, table, cols) => insert(tx, table, { id: uuid(), tenant_id: tx.tenantId, ...cols });
const asUser = async (fn, { user = PROPOSER, tenant } = {}) => {
  const t = tenant ?? (await newTenant(d.db, "s"));
  return inTenant(d.db, { tenantId: t, userId: user, actor: "user" }, fn);
};

const refs = new WeakMap();
/** Types génériques de démonstration (aucune valeur réglementaire). */
async function seed(tx) {
  if (refs.has(tx)) return refs.get(tx);
  const sev = { LOW: await mk(tx, "schoollife.severity_levels", { code: "LOW", label: "Faible", rank: 1 }), HIGH: await mk(tx, "schoollife.severity_levels", { code: "HIGH", label: "Élevée", rank: 2 }) };
  const type = (code, kind, extra = {}) => mk(tx, "schoollife.event_types", { code, label: code, kind, ...extra });
  const t = {
    sev,
    INC: await type("INC", "INCIDENT"),
    WARN: await type("WARN", "WARNING"),
    SANC: await type("SANC", "SANCTION", { requires_validation: true, requires_four_eyes: true, appealable: true, approver_permission: "schoollife.measure.validate", notify_guardians: true }),
    EXCL: await type("EXCL", "TEMP_EXCLUSION", { requires_validation: true, requires_four_eyes: true, requires_dates: true, appealable: true }),
    ENC: await type("ENC", "ENCOURAGEMENT"),
    OBS: await type("OBS", "OBSERVATION", { visible_to_guardians: false, confidentiality_default: "RESTRICTED" }),
    HIDDEN: await type("HIDDEN", "SANCTION", { requires_validation: true, visible_to_guardians: false }),
  };
  refs.set(tx, t);
  return t;
}

const student = () => ({ enrollment_id: uuid(), student_id: uuid() });

async function proposeMeasure(tx, typeId, who = student(), extra = {}) {
  const id = await mk(tx, "schoollife.measures", {
    institution_id: extra.institution_id ?? uuid(),
    academic_year_id: uuid(),
    ...who,
    type_id: typeId,
    reason: "Comportement répété en classe",
    proposed_by: PROPOSER,
    proposed_by_name: "Éducateur",
    ...extra,
  });
  return { id, who };
}
const measureStatus = async (tx, id) => (await tx.one("SELECT status FROM schoollife.measures WHERE id = $1", [id])).status;
const asValidator = (tx) => tx.as({ userId: VALIDATOR });
const asProposer = (tx) => tx.as({ userId: PROPOSER });

describeDb("isolation et droits", () => {
  it("RLS forcée sur les 15 tables ; isolation entre tenants ; FK composites", async () => {
    const a = await newTenant(d.db, "a");
    const b = await newTenant(d.db, "b");
    const typeA = await inTenant(d.db, { tenantId: a, userId: PROPOSER }, async (tx) => (await seed(tx)).WARN, { commit: true });
    await inTenant(d.db, { tenantId: b, userId: PROPOSER }, async (tx) => {
      assert.equal((await tx.q("SELECT count(*)::int AS n FROM schoollife.event_types"))[0].n, 0);
      await tx.fail(
        "INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X')",
        [uuid(), b, uuid(), uuid(), uuid(), uuid(), typeA, PROPOSER],
        /foreign key|23503|violates/,
      );
    });
    const { tables, problems } = await structuralIsolationViolations(d.db, "schoollife");
    assert.equal(tables.length, 15);
    assert.deepEqual(problems, []);
  });

  it("aucun DELETE accordé ; pas de DDL pour app_user", async () => {
    await asUser(async (tx) => {
      for (const t of ["incidents", "measures", "notes", "convocations", "life_events", "conduct_movements", "confidential_reads"]) {
        await tx.fail(`DELETE FROM schoollife.${t}`, [], /permission denied|42501/);
      }
      await tx.fail("CREATE TABLE schoollife.pirate (id int)", [], /permission denied|42501/);
    });
  });
});

describeDb("types d'événements : paramètres, aucune valeur livrée", () => {
  it("aucun type, aucun niveau de gravité, aucun barème par défaut (tout est donnée d'établissement)", async () => {
    await asUser(async (tx) => {
      for (const t of ["event_types", "severity_levels", "conduct_scales", "settings"]) {
        assert.equal((await tx.q(`SELECT count(*)::int AS n FROM schoollife.${t}`))[0].n, 0);
      }
      await tx.q("INSERT INTO schoollife.settings (tenant_id, institution_id) VALUES ($1, $2)", [tx.tenantId, uuid()]);
      const row = await tx.one("SELECT conduct_points_enabled, retention_days FROM schoollife.settings");
      assert.equal(row.conduct_points_enabled, false, "points de conduite désactivés par défaut");
      assert.equal(row.retention_days, null, "aucune durée de conservation codée");
    });
  });

  it("contraintes : exclusion = validation obligatoire ; dates réservées aux exclusions ; quatre yeux => validation ; incident sans circuit", async () => {
    await asUser(async (tx) => {
      const ins = (cols, pattern) =>
        tx.fail(
          `INSERT INTO schoollife.event_types (id, tenant_id, code, label, ${Object.keys(cols).join(",")}) VALUES ($1,$2,$3,'L',${Object.keys(cols).map((_, i) => `$${i + 4}`).join(",")})`,
          [uuid(), tx.tenantId, `C${uuid().slice(0, 6).toUpperCase()}`, ...Object.values(cols)],
          pattern ?? /check|23514/,
        );
      await ins({ kind: "TEMP_EXCLUSION", requires_dates: true, requires_validation: false });
      await ins({ kind: "TEMP_EXCLUSION", requires_dates: false, requires_validation: true });
      await ins({ kind: "SANCTION", requires_dates: true });
      await ins({ kind: "SANCTION", requires_four_eyes: true, requires_validation: false });
      await ins({ kind: "INCIDENT", requires_validation: true });
      await ins({ kind: "WARNING", appealable: true });
      await ins({ kind: "SANCTION", approver_permission: "Pas Une Permission" });
    });
  });

  it("la famille d'un type utilisé ne change plus", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await proposeMeasure(tx, t.WARN);
      await tx.fail("UPDATE schoollife.event_types SET kind = 'SANCTION', requires_validation = true WHERE id = $1", [t.WARN], /type_kind_locked/);
      await tx.q("UPDATE schoollife.event_types SET label = 'Avertissement écrit' WHERE id = $1", [t.WARN]);
    });
  });
});

describeDb("incidents", () => {
  const incident = (tx, typeId, extra = {}) =>
    mk(tx, "schoollife.incidents", { institution_id: uuid(), academic_year_id: uuid(), type_id: typeId, occurred_at: "2026-11-03T09:30:00Z", description: "Altercation dans la cour", reported_by: PROPOSER, reported_by_name: "Éducateur", ...extra });

  it("déclaration par un utilisateur seulement ; le déclarant est la session ; type d'incident exigé", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await tx.fail("INSERT INTO schoollife.incidents (id, tenant_id, institution_id, academic_year_id, type_id, occurred_at, description, reported_by, reported_by_name) VALUES ($1,$2,$3,$4,$5,now(),'Description',$6,'X')", [uuid(), tx.tenantId, uuid(), uuid(), t.INC, VALIDATOR], /reporter_mismatch/);
      await tx.fail("INSERT INTO schoollife.incidents (id, tenant_id, institution_id, academic_year_id, type_id, occurred_at, description, reported_by, reported_by_name) VALUES ($1,$2,$3,$4,$5,now(),'Description',$6,'X')", [uuid(), tx.tenantId, uuid(), uuid(), t.WARN, PROPOSER], /type_kind/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("INSERT INTO schoollife.incidents (id, tenant_id, institution_id, academic_year_id, type_id, occurred_at, description, reported_by, reported_by_name) VALUES ($1,$2,$3,$4,$5,now(),'Description',$6,'X')", [uuid(), tx.tenantId, uuid(), uuid(), t.INC, PROPOSER], /human_actor_required/);
    });
  });

  it("circuit : DECLARED -> UNDER_REVIEW -> CONFIRMED -> CLOSED ; clôture motivée et immuable ; historique automatique", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const id = await incident(tx, t.INC);
      await tx.fail("UPDATE schoollife.incidents SET status = 'CONFIRMED' WHERE id = $1", [id], /incident_transition/);
      await tx.q("UPDATE schoollife.incidents SET status = 'UNDER_REVIEW', assigned_to = $2 WHERE id = $1", [id, VALIDATOR]);
      await tx.fail("UPDATE schoollife.incidents SET description = 'Autre description' WHERE id = $1", [id], /description_frozen/);
      await tx.q("UPDATE schoollife.incidents SET status = 'CONFIRMED' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.incidents SET status = 'CLOSED' WHERE id = $1", [id], /check|23514/); // note de résolution
      await tx.q("UPDATE schoollife.incidents SET status = 'CLOSED', resolution_note = 'Mesure prise, famille informée' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.incidents SET assigned_to = NULL WHERE id = $1", [id], /closed/);
      const ev = await tx.q("SELECT action, from_status, to_status, actor_id, actor_kind FROM schoollife.life_events WHERE entity_id = $1 ORDER BY occurred_at, to_status", [id]);
      assert.equal(ev.length, 4);
      assert.ok(ev.every((e) => e.actor_id === PROPOSER && e.actor_kind === "user"));
      assert.ok(ev.some((e) => e.action === "CREATED" && e.to_status === "DECLARED"));
      assert.ok(ev.some((e) => e.from_status === "CONFIRMED" && e.to_status === "CLOSED"));
    });
  });

  it("confidentialité : plancher imposé par le type, jamais abaissée", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const strict = await mk(tx, "schoollife.event_types", { code: "SECRET", label: "Secret", kind: "INCIDENT", confidentiality_default: "CONFIDENTIAL" });
      await tx.fail("INSERT INTO schoollife.incidents (id, tenant_id, institution_id, academic_year_id, type_id, occurred_at, description, reported_by, reported_by_name, confidentiality) VALUES ($1,$2,$3,$4,$5,now(),'Description',$6,'X','STANDARD')", [uuid(), tx.tenantId, uuid(), uuid(), strict, PROPOSER], /confidentiality_floor/);
      const id = await incident(tx, t.INC, { confidentiality: "RESTRICTED" });
      await tx.fail("UPDATE schoollife.incidents SET confidentiality = 'STANDARD' WHERE id = $1", [id], /confidentiality_lowered/);
      await tx.q("UPDATE schoollife.incidents SET confidentiality = 'CONFIDENTIAL' WHERE id = $1", [id]);
    });
  });

  it("implications : une par (élève, rôle) ; plus d'ajout sur un incident écarté ou clos", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const id = await incident(tx, t.INC);
      const s = student();
      await mk(tx, "schoollife.incident_involvements", { incident_id: id, ...s, role: "AUTHOR" });
      await tx.fail("INSERT INTO schoollife.incident_involvements (id, tenant_id, incident_id, enrollment_id, student_id, role) VALUES ($1,$2,$3,$4,$5,'AUTHOR')", [uuid(), tx.tenantId, id, s.enrollment_id, s.student_id], /unique|23505/);
      await mk(tx, "schoollife.incident_involvements", { incident_id: id, ...s, role: "WITNESS" });
      await tx.q("UPDATE schoollife.incidents SET status = 'DISMISSED', resolution_note = 'Faits non établis' WHERE id = $1", [id]);
      await tx.fail("INSERT INTO schoollife.incident_involvements (id, tenant_id, incident_id, enrollment_id, student_id, role) VALUES ($1,$2,$3,$4,$5,'VICTIM')", [uuid(), tx.tenantId, id, uuid(), uuid()], /closed/);
    });
  });
});

describeDb("mesures : circuit de validation et séparation des tâches", () => {
  it("une sanction se PROPOSE ; la validation exige une autre personne ; les champs de validation sont posés par la base", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X','VALIDATED')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.SANC, PROPOSER], /validation_required/);
      const { id } = await proposeMeasure(tx, t.SANC);
      assert.equal((await tx.one("SELECT kind FROM schoollife.measures WHERE id = $1", [id])).kind, "SANCTION", "famille recopiée du type");
      await tx.fail("UPDATE schoollife.measures SET status = 'VALIDATED' WHERE id = $1", [id], /four_eyes_required/); // le proposant ne valide pas
      await tx.fail("UPDATE schoollife.measures SET status = 'NOTIFIED' WHERE id = $1", [id], /measure_transition/);
      await asValidator(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by = $2, validated_by_name = 'Directeur' WHERE id = $1", [id, PROPOSER]);
      const row = await tx.one("SELECT validated_by, validated_at, validated_by_name FROM schoollife.measures WHERE id = $1", [id]);
      assert.equal(row.validated_by, VALIDATOR, "validated_by = utilisateur de la session, non falsifiable");
      assert.ok(row.validated_at);
    });
  });

  it("un avertissement n'a pas de circuit : il est directement en vigueur (validé par son auteur)", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const { id } = await proposeMeasure(tx, t.WARN, student(), { status: "VALIDATED" });
      const row = await tx.one("SELECT status, validated_by FROM schoollife.measures WHERE id = $1", [id]);
      assert.equal(row.status, "VALIDATED");
      assert.equal(row.validated_by, PROPOSER);
    });
  });

  it("jamais par un acteur système (job, règle) ; le proposant est la session", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.SANC, VALIDATOR], /proposer_mismatch/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.SANC, PROPOSER], /human_actor_required/);
      await tx.as({ actor: "superAdmin", userId: PROPOSER });
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.SANC, PROPOSER], /human_actor_required/);
    });
  });

  it("cycle complet : validée -> notifiée -> exécutée ; contenu figé après validation ; rejet et annulation motivés ; état final", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const { id } = await proposeMeasure(tx, t.SANC);
      await asValidator(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'Directeur' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.measures SET reason = 'Motif réécrit après coup' WHERE id = $1", [id], /measure_frozen/);
      await tx.fail("UPDATE schoollife.measures SET type_id = $2 WHERE id = $1", [id, t.WARN], /measure_identity_immutable/);
      await tx.q("UPDATE schoollife.measures SET status = 'NOTIFIED' WHERE id = $1", [id]);
      const n = await tx.one("SELECT notified_by, notified_at FROM schoollife.measures WHERE id = $1", [id]);
      assert.equal(n.notified_by, VALIDATOR);
      assert.ok(n.notified_at);
      await tx.q("UPDATE schoollife.measures SET status = 'EXECUTED' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.measures SET status = 'REVOKED' WHERE id = $1", [id], /check|23514/); // motif
      await tx.q("UPDATE schoollife.measures SET status = 'REVOKED', revoked_reason = 'Erreur d''identification de l''élève' WHERE id = $1", [id]);
      assert.equal((await tx.one("SELECT revoked_by FROM schoollife.measures WHERE id = $1", [id])).revoked_by, VALIDATOR);
      await tx.fail("UPDATE schoollife.measures SET status = 'EXECUTED' WHERE id = $1", [id], /measure_final/);

      await asProposer(tx);
      const r = await proposeMeasure(tx, t.SANC);
      await tx.fail("UPDATE schoollife.measures SET status = 'REJECTED' WHERE id = $1", [r.id], /check|23514/);
      await tx.q("UPDATE schoollife.measures SET status = 'REJECTED', validation_note = 'Faits insuffisamment établis' WHERE id = $1", [r.id]);
      await tx.fail("UPDATE schoollife.measures SET status = 'VALIDATED' WHERE id = $1", [r.id], /measure_final/);
      const events = await tx.q("SELECT to_status FROM schoollife.life_events WHERE entity_id = $1 ORDER BY occurred_at, to_status", [id]);
      assert.deepEqual(events.map((e) => e.to_status).sort(), ["EXECUTED", "NOTIFIED", "PROPOSED", "REVOKED", "VALIDATED"]);
    });
  });

  it("exclusion temporaire : dates obligatoires, jamais de chevauchement entre exclusions vivantes d'un même élève", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.EXCL, PROPOSER], /dates_required/);
      const who = student();
      const a = await proposeMeasure(tx, t.EXCL, who, { starts_on: "2026-11-10", ends_on: "2026-11-12" });
      const b = await proposeMeasure(tx, t.EXCL, who, { starts_on: "2026-11-11", ends_on: "2026-11-14" }); // PROPOSED : pas encore en vigueur
      await tx.fail("INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, reason, proposed_by, proposed_by_name, starts_on, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,'Motif valable',$8,'X','2026-11-14','2026-11-10')", [uuid(), tx.tenantId, uuid(), uuid(), who.enrollment_id, who.student_id, t.EXCL, PROPOSER], /check|23514/); // fin avant début
      await asValidator(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [a.id]);
      await tx.fail("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [b.id], /exclusion|23P01/);
      await asProposer(tx);
      const c = await proposeMeasure(tx, t.EXCL, who, { starts_on: "2026-11-13", ends_on: "2026-11-15" });
      await asValidator(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [c.id]);
      // les dates ne changent plus une fois notifiée
      await tx.q("UPDATE schoollife.measures SET status = 'NOTIFIED' WHERE id = $1", [c.id]);
      await tx.fail("UPDATE schoollife.measures SET ends_on = '2026-11-20' WHERE id = $1", [c.id], /measure_frozen/);
    });
  });

  it("une mesure liée à un incident vise un élève désigné comme auteur ; une mesure confidentielle n'est jamais visible des familles", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const inc = await mk(tx, "schoollife.incidents", { institution_id: uuid(), academic_year_id: uuid(), type_id: t.INC, occurred_at: "2026-11-03T09:30:00Z", description: "Altercation dans la cour", reported_by: PROPOSER, reported_by_name: "Éducateur" });
      const author = student();
      const victim = student();
      await mk(tx, "schoollife.incident_involvements", { incident_id: inc, ...author, role: "AUTHOR" });
      await mk(tx, "schoollife.incident_involvements", { incident_id: inc, ...victim, role: "VICTIM" });
      await tx.attempt(() => proposeMeasure(tx, t.SANC, victim, { incident_id: inc }), /not_involved/);
      const ok = await proposeMeasure(tx, t.SANC, author, { incident_id: inc, confidentiality: "CONFIDENTIAL", visible_to_guardians: true });
      assert.equal((await tx.one("SELECT visible_to_guardians FROM schoollife.measures WHERE id = $1", [ok.id])).visible_to_guardians, false);
      const hidden = await proposeMeasure(tx, t.HIDDEN, student(), { visible_to_guardians: true });
      assert.equal((await tx.one("SELECT visible_to_guardians FROM schoollife.measures WHERE id = $1", [hidden.id])).visible_to_guardians, false, "le type interdit le partage");
      await tx.fail("UPDATE schoollife.measures SET visible_to_guardians = true WHERE id = $1", [hidden.id], /visibility_widened/);
    });
  });
});

describeDb("recours", () => {
  async function notifiedSanction(tx, typeId) {
    await asProposer(tx);
    const { id } = await proposeMeasure(tx, typeId);
    await asValidator(tx);
    await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [id]);
    await tx.q("UPDATE schoollife.measures SET status = 'NOTIFIED' WHERE id = $1", [id]);
    return id;
  }
  const appeal = async (tx, measureId) =>
    mk(tx, "schoollife.measure_appeals", { measure_id: measureId, filed_by: (await tx.one("SELECT kernel.current_user_id() AS u")).u, filed_by_name: "Parent", reason: "Les faits ne sont pas établis" });

  it("dépôt : seulement sur une mesure notifiée ou exécutée dont le type est susceptible de recours ; la mesure passe APPEALED", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const w = await proposeMeasure(tx, t.WARN, student(), { status: "VALIDATED" });
      await tx.attempt(() => appeal(tx, w.id), /not_appealable/); // avertissement : pas de recours
      const early = await proposeMeasure(tx, t.SANC);
      await tx.attempt(() => appeal(tx, early.id), /not_appealable/); // pas encore notifiée
      const m = await notifiedSanction(tx, t.SANC);
      const a = await appeal(tx, m);
      assert.equal(await measureStatus(tx, m), "APPEALED");
      await tx.attempt(() => appeal(tx, m), /not_appealable|unique|23505/);
      assert.ok(a);
    });
  });

  it("issue : maintenue -> mesure EXECUTED ; annulée -> mesure REVOKED avec le motif du recours ; décision motivée par l'utilisateur de la session", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const m1 = await notifiedSanction(tx, t.SANC);
      const a1 = await appeal(tx, m1);
      await tx.fail("UPDATE schoollife.measure_appeals SET status = 'UPHELD', decided_by = $2, decided_by_name = 'D', decision_note = 'court' WHERE id = $1", [a1, VALIDATOR], /check|23514/);
      await tx.fail("UPDATE schoollife.measure_appeals SET status = 'UPHELD', decided_by = $2, decided_by_name = 'D', decision_note = 'Sanction proportionnée aux faits' WHERE id = $1", [a1, PROPOSER], /decider_mismatch/);
      await tx.q("UPDATE schoollife.measure_appeals SET status = 'UPHELD', decided_by = $2, decided_by_name = 'D', decision_note = 'Sanction proportionnée aux faits' WHERE id = $1", [a1, VALIDATOR]);
      assert.equal(await measureStatus(tx, m1), "EXECUTED");
      await tx.fail("UPDATE schoollife.measure_appeals SET status = 'OVERTURNED' WHERE id = $1", [a1], /appeal_final/);

      const m2 = await notifiedSanction(tx, t.SANC);
      const a2 = await appeal(tx, m2);
      await tx.q("UPDATE schoollife.measure_appeals SET status = 'OVERTURNED', decided_by = $2, decided_by_name = 'D', decision_note = 'Faits non établis après audition' WHERE id = $1", [a2, VALIDATOR]);
      const r = await tx.one("SELECT status, revoked_reason, revoked_by FROM schoollife.measures WHERE id = $1", [m2]);
      assert.equal(r.status, "REVOKED");
      assert.equal(r.revoked_reason, "Faits non établis après audition");
      assert.equal(r.revoked_by, VALIDATOR);
      // une mesure ne passe pas APPEALED sans recours déposé
      const m3 = await notifiedSanction(tx, t.SANC);
      await tx.fail("UPDATE schoollife.measures SET status = 'APPEALED' WHERE id = $1", [m3], /not_appealable/);
    });
  });
});

describeDb("encouragements et observations", () => {
  const note = (tx, typeId, extra = {}) =>
    mk(tx, "schoollife.notes", { institution_id: uuid(), academic_year_id: uuid(), ...student(), type_id: typeId, body: "Excellente participation en classe", occurred_on: "2026-11-05", author_id: PROPOSER, author_name: "Professeur", ...extra });

  it("auteur = session ; visibilité limitée par le type ; confidentiel = personnel seulement ; confidentialité plancher", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      await tx.fail("INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, body, occurred_on, author_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Corps',now(),$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.ENC, VALIDATOR], /author_mismatch/);
      await tx.fail("INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, body, occurred_on, author_id, author_name, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,'Corps',now(),$8,'X','GUARDIANS')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.OBS, PROPOSER], /visibility_forbidden|confidentiality_floor/);
      await tx.fail("INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, body, occurred_on, author_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Corps',now(),$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.OBS, PROPOSER], /confidentiality_floor/); // OBS impose RESTRICTED
      await tx.fail("INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, body, occurred_on, author_id, author_name, confidentiality, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,'Corps',now(),$8,'X','CONFIDENTIAL','GUARDIANS')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.ENC, PROPOSER], /check|23514/);
      await tx.fail("INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, body, occurred_on, author_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Corps',now(),$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), t.WARN, PROPOSER], /type_kind/);
      const id = await note(tx, t.ENC, { visibility: "STUDENT_AND_GUARDIANS" });
      assert.equal((await tx.one("SELECT kind FROM schoollife.notes WHERE id = $1", [id])).kind, "ENCOURAGEMENT");
    });
  });

  it("une note ne change pas ; elle se retire avec un motif, et seulement par un utilisateur ; trace automatique", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const id = await note(tx, t.ENC);
      await tx.fail("UPDATE schoollife.notes SET body = 'Réécrit' WHERE id = $1", [id], /note_immutable/);
      await tx.fail("UPDATE schoollife.notes SET status = 'WITHDRAWN' WHERE id = $1", [id], /check|23514/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE schoollife.notes SET status = 'WITHDRAWN', withdrawn_reason = 'Erreur de saisie' WHERE id = $1", [id], /human_actor_required/);
      await asProposer(tx);
      await tx.as({ actor: "user" });
      await tx.q("UPDATE schoollife.notes SET status = 'WITHDRAWN', withdrawn_reason = 'Erreur de saisie' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.notes SET status = 'ACTIVE' WHERE id = $1", [id], /note_withdrawn/);
      assert.equal((await tx.q("SELECT 1 FROM schoollife.life_events WHERE entity_id = $1 AND to_status = 'WITHDRAWN'", [id])).length, 1);
    });
  });
});

describeDb("convocations", () => {
  const convocation = (tx, extra = {}) => {
    const guardian = uuid();
    return mk(tx, "schoollife.convocations", { institution_id: uuid(), academic_year_id: uuid(), ...student(), guardian_ids: `{${guardian}}`, reason_kind: "DISCIPLINE", reason: "Entretien suite à un incident", scheduled_at: "2026-12-01T08:00:00Z", convened_by: PROPOSER, convened_by_name: "Éducateur", ...extra });
  };

  it("circuit DRAFT -> SENT -> ACKNOWLEDGED -> HELD ; dates posées par la base ; accusé par un tuteur convoqué seulement", async () => {
    await asUser(async (tx) => {
      const guardian = uuid();
      const id = await convocation(tx, { guardian_ids: `{${guardian}}` });
      await tx.fail("UPDATE schoollife.convocations SET status = 'HELD' WHERE id = $1", [id], /convocation_transition/);
      await tx.q("UPDATE schoollife.convocations SET status = 'SENT', notification_ref = $2 WHERE id = $1", [id, uuid()]);
      assert.ok((await tx.one("SELECT sent_at FROM schoollife.convocations WHERE id = $1", [id])).sent_at);
      await tx.fail("UPDATE schoollife.convocations SET reason = 'Autre motif' WHERE id = $1", [id], /convocation_frozen/);
      await tx.fail("UPDATE schoollife.convocations SET status = 'ACKNOWLEDGED', acknowledged_by_guardian_id = $2 WHERE id = $1", [id, uuid()], /acknowledger/);
      await tx.q("UPDATE schoollife.convocations SET status = 'ACKNOWLEDGED', acknowledged_by_guardian_id = $2 WHERE id = $1", [id, guardian]);
      await tx.q("UPDATE schoollife.convocations SET status = 'HELD', outcome_note = 'Entretien tenu, engagement de la famille' WHERE id = $1", [id]);
      await tx.fail("UPDATE schoollife.convocations SET status = 'CANCELLED', cancel_reason = 'Trop tard' WHERE id = $1", [id], /convocation_final/);
    });
  });

  it("report : la convocation d'origine passe RESCHEDULED et la nouvelle la référence ; annulation motivée ; destinataires non vides", async () => {
    await asUser(async (tx) => {
      const id = await convocation(tx);
      await tx.q("UPDATE schoollife.convocations SET status = 'SENT' WHERE id = $1", [id]);
      await tx.q("UPDATE schoollife.convocations SET status = 'RESCHEDULED' WHERE id = $1", [id]);
      const next = await convocation(tx, { rescheduled_from_id: id });
      assert.ok(next);
      await tx.fail("UPDATE schoollife.convocations SET status = 'CANCELLED' WHERE id = $1", [next], /check|23514/);
      await tx.fail("INSERT INTO schoollife.convocations (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, guardian_ids, reason_kind, reason, scheduled_at, convened_by, convened_by_name) VALUES ($1,$2,$3,$4,$5,$6,'{}','OTHER','Motif valable',now(),$7,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), PROPOSER], /check|23514/);
      await tx.fail("INSERT INTO schoollife.convocations (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, guardian_ids, reason_kind, reason, scheduled_at, convened_by, convened_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'OTHER','Motif valable',now(),$8,'X')", [uuid(), tx.tenantId, uuid(), uuid(), uuid(), uuid(), `{${uuid()}}`, VALIDATOR], /convener_mismatch/);
    });
  });
});

describeDb("barèmes de points de conduite : paramètres, pas du code", () => {
  async function scaleWorld(tx, { enabled = true } = {}) {
    const t = await seed(tx);
    const institution = uuid();
    if (enabled) await tx.q("INSERT INTO schoollife.settings (tenant_id, institution_id, conduct_points_enabled) VALUES ($1,$2,true)", [tx.tenantId, institution]);
    const scale = await mk(tx, "schoollife.conduct_scales", { institution_id: institution, code: "BAREME_DEMO", label: "Barème de démonstration", initial_points: 20, min_points: 0, max_points: 20, reset_scope: "YEAR", effective_from: "2026-09-01", source_kind: "placeholder" });
    await mk(tx, "schoollife.conduct_scale_items", { scale_id: scale, event_type_id: t.SANC, points_delta: -3 });
    await mk(tx, "schoollife.conduct_scale_items", { scale_id: scale, event_type_id: t.ENC, points_delta: 1 });
    return { t, institution, scale };
  }
  const activate = (tx, scale) => tx.q("UPDATE schoollife.conduct_scales SET status = 'ACTIVE' WHERE id = $1", [scale]);

  it("un barème se crée en brouillon, ne s'active qu'avec des valeurs et par un utilisateur, puis se fige", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const empty = await mk(tx, "schoollife.conduct_scales", { institution_id: uuid(), code: "VIDE", label: "Vide", initial_points: 10, reset_scope: "PERIOD", effective_from: "2026-09-01" });
      await tx.fail("UPDATE schoollife.conduct_scales SET status = 'ACTIVE' WHERE id = $1", [empty], /scale_empty/);
      await tx.fail("INSERT INTO schoollife.conduct_scale_items (id, tenant_id, scale_id, event_type_id, points_delta) VALUES ($1,$2,$3,$4,-2)", [uuid(), tx.tenantId, empty, t.INC], /type_kind/);
      await tx.fail("INSERT INTO schoollife.conduct_scale_items (id, tenant_id, scale_id, event_type_id, points_delta) VALUES ($1,$2,$3,$4,0)", [uuid(), tx.tenantId, empty, t.SANC], /check|23514/);
      const { scale } = await scaleWorld(tx);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE schoollife.conduct_scales SET status = 'ACTIVE' WHERE id = $1", [scale], /human_actor_required/);
      await asProposer(tx);
      await tx.as({ actor: "user" });
      await activate(tx, scale);
      await tx.fail("UPDATE schoollife.conduct_scales SET initial_points = 15 WHERE id = $1", [scale], /scale_frozen/);
      await tx.fail("INSERT INTO schoollife.conduct_scale_items (id, tenant_id, scale_id, event_type_id, points_delta) VALUES ($1,$2,$3,$4,-1)", [uuid(), tx.tenantId, scale, t.WARN], /scale_frozen/);
      await tx.q("UPDATE schoollife.conduct_scales SET effective_to = '2027-06-30' WHERE id = $1", [scale]); // clôture de la période d'effet
      await tx.q("UPDATE schoollife.conduct_scales SET status = 'RETIRED' WHERE id = $1", [scale]);
      await tx.fail("UPDATE schoollife.conduct_scales SET effective_to = NULL WHERE id = $1", [scale], /scale_frozen/);
    });
  });

  it("un seul barème ACTIF par établissement, niveau et période d'effet", async () => {
    await asUser(async (tx) => {
      const { institution, scale } = await scaleWorld(tx);
      await activate(tx, scale);
      const grade = uuid();
      const other = (code, extra = {}) => mk(tx, "schoollife.conduct_scales", { institution_id: institution, code, label: code, initial_points: 20, reset_scope: "YEAR", effective_from: "2026-09-01", ...extra });
      const clash = await other("CONCURRENT");
      const t = await seed(tx);
      await mk(tx, "schoollife.conduct_scale_items", { scale_id: clash, event_type_id: t.SANC, points_delta: -2 });
      await tx.fail("UPDATE schoollife.conduct_scales SET status = 'ACTIVE' WHERE id = $1", [clash], /exclusion|23P01/);
      const levelScale = await other("PAR_NIVEAU", { grade_level_id: grade });
      await mk(tx, "schoollife.conduct_scale_items", { scale_id: levelScale, event_type_id: t.SANC, points_delta: -2 });
      await tx.q("UPDATE schoollife.conduct_scales SET status = 'ACTIVE' WHERE id = $1", [levelScale]); // autre périmètre : accepté
    });
  });

  it("mouvements : points de conduite activés, barème actif, points conformes au barème, une écriture par source, inversion exacte, ajout seul", async () => {
    await asUser(async (tx) => {
      const { t, scale } = await scaleWorld(tx);
      const who = student();
      const year = uuid();
      const period = uuid();
      const movement = (cols) => ({
        sql: "INSERT INTO schoollife.conduct_movements (id, tenant_id, scale_id, enrollment_id, student_id, academic_year_id, academic_period_id, delta, reason, source_kind, source_id, reverses_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        params: [uuid(), tx.tenantId, scale, who.enrollment_id, who.student_id, year, period, cols.delta ?? -3, cols.reason ?? "Sanction validée", cols.source_kind ?? "MEASURE", cols.source_id ?? null, cols.reverses_id ?? null, PROPOSER],
      });
      let m = movement({ source_id: uuid() });
      await tx.fail(m.sql, m.params, /scale_not_active/); // barème encore en brouillon
      await activate(tx, scale);
      // mesure source : doit être validée et concerner l'inscription
      const prop = await proposeMeasure(tx, t.SANC, who);
      m = movement({ source_id: prop.id });
      await tx.fail(m.sql, m.params, /source_invalid/); // encore PROPOSED
      await asValidator(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [prop.id]);
      await asProposer(tx);
      m = movement({ source_id: prop.id, delta: -5 });
      await tx.fail(m.sql, m.params, /delta_not_in_scale/);
      m = movement({ source_id: prop.id });
      await tx.q(m.sql, m.params);
      const dup = movement({ source_id: prop.id });
      await tx.fail(dup.sql, dup.params, /unique|23505/);
      const first = (await tx.one("SELECT id FROM schoollife.conduct_movements WHERE source_id = $1", [prop.id])).id;
      let bad = movement({ source_id: null, delta: -2, reverses_id: first });
      await tx.fail(bad.sql, bad.params, /reversal_mismatch/);
      const rev = movement({ source_id: null, delta: 3, reverses_id: first, reason: "Mesure révoquée" });
      await tx.q(rev.sql, rev.params);
      const rev2 = movement({ source_id: null, delta: 3, reverses_id: first });
      await tx.fail(rev2.sql, rev2.params, /unique|23505/);
      await tx.fail("UPDATE schoollife.conduct_movements SET delta = -1", [], /permission denied|immutable|42501/);
      // ajustement manuel : libre mais motivé et journalisé par la nature du registre
      const adj = movement({ source_kind: "MANUAL_ADJUSTMENT", delta: 2, reason: "Bonus exceptionnel du conseil" });
      await tx.q(adj.sql, adj.params);
    });
  });

  it("les points de conduite non activés par l'établissement refusent tout mouvement", async () => {
    await asUser(async (tx) => {
      const { scale } = await scaleWorld(tx, { enabled: false });
      await activate(tx, scale);
      await tx.fail(
        "INSERT INTO schoollife.conduct_movements (id, tenant_id, scale_id, enrollment_id, student_id, academic_year_id, delta, reason, source_kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,-1,'Ajustement','MANUAL_ADJUSTMENT',$7)",
        [uuid(), tx.tenantId, scale, uuid(), uuid(), uuid(), PROPOSER],
        /conduct_disabled/,
      );
    });
  });

  it("solde dérivé : borné par le barème, remise à zéro par période, par année ou jamais", async () => {
    await asUser(async (tx) => {
      const t = await seed(tx);
      const institution = uuid();
      await tx.q("INSERT INTO schoollife.settings (tenant_id, institution_id, conduct_points_enabled) VALUES ($1,$2,true)", [tx.tenantId, institution]);
      const mkScale = async (code, reset, extra = {}) => {
        const s = await mk(tx, "schoollife.conduct_scales", { institution_id: institution, code, label: code, grade_level_id: uuid(), initial_points: 20, min_points: 0, max_points: 22, reset_scope: reset, effective_from: "2026-09-01", ...extra });
        await mk(tx, "schoollife.conduct_scale_items", { scale_id: s, event_type_id: t.SANC, points_delta: -4 });
        await activate(tx, s);
        return s;
      };
      const student_ = uuid();
      const year = uuid();
      const p1 = uuid();
      const p2 = uuid();
      const manual = (scale, delta, period, yr = year) =>
        tx.q("INSERT INTO schoollife.conduct_movements (id, tenant_id, scale_id, enrollment_id, student_id, academic_year_id, academic_period_id, delta, reason, source_kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Ajustement de test','MANUAL_ADJUSTMENT',$9)", [uuid(), tx.tenantId, scale, uuid(), student_, yr, period, delta, PROPOSER]);
      const bal = async (scale, period) => (await tx.one("SELECT schoollife.conduct_balance($1,$2,$3,$4) AS b", [student_, scale, year, period])).b;
      const perPeriod = await mkScale("PAR_PERIODE", "PERIOD");
      await manual(perPeriod, -7, p1);
      await manual(perPeriod, -2, p2);
      assert.equal(await bal(perPeriod, p1), 13);
      assert.equal(await bal(perPeriod, p2), 18);
      const perYear = await mkScale("PAR_ANNEE", "YEAR");
      await manual(perYear, -7, p1);
      await manual(perYear, -2, p2);
      assert.equal(await bal(perYear, p1), 11);
      assert.equal(await bal(perYear, null), 11);
      const never = await mkScale("JAMAIS", "NEVER");
      await manual(never, -7, p1);
      await manual(never, -2, p2, uuid());
      assert.equal(await bal(never, p1), 11);
      const floor = await mkScale("PLANCHER", "YEAR");
      await manual(floor, -50, p1);
      assert.equal(await bal(floor, p1), 0, "borné par min_points");
      const ceil = await mkScale("PLAFOND", "YEAR");
      await manual(ceil, 9, p1);
      assert.equal(await bal(ceil, p1), 22, "borné par max_points");
    });
  });
});

describeDb("qui voit quoi (audience_may_see) et lectures confidentielles", () => {
  it("table de vérité : jamais un confidentiel, jamais un incident, mesure visible après notification, note selon sa visibilité", async () => {
    await asUser(async (tx) => {
      const may = async (...a) => (await tx.one("SELECT schoollife.audience_may_see($1,$2,$3,$4,$5,$6) AS v", a)).v;
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", true, "PROPOSED", null), false);
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", true, "VALIDATED", null), false);
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", true, "NOTIFIED", null), true);
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", true, "EXECUTED", null), true);
      assert.equal(await may("GUARDIAN", "MEASURE", "RESTRICTED", true, "NOTIFIED", null), true);
      assert.equal(await may("GUARDIAN", "MEASURE", "CONFIDENTIAL", true, "NOTIFIED", null), false);
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", false, "NOTIFIED", null), false);
      assert.equal(await may("GUARDIAN", "MEASURE", "STANDARD", true, "REVOKED", null), false);
      assert.equal(await may("STUDENT", "MEASURE", "STANDARD", true, "NOTIFIED", null), true);
      assert.equal(await may("GUARDIAN", "INCIDENT", "STANDARD", true, "CONFIRMED", null), false);
      assert.equal(await may("GUARDIAN", "NOTE", "STANDARD", true, "ACTIVE", "STAFF_ONLY"), false);
      assert.equal(await may("GUARDIAN", "NOTE", "STANDARD", true, "ACTIVE", "GUARDIANS"), true);
      assert.equal(await may("STUDENT", "NOTE", "STANDARD", true, "ACTIVE", "GUARDIANS"), false);
      assert.equal(await may("STUDENT", "NOTE", "STANDARD", true, "ACTIVE", "STUDENT_AND_GUARDIANS"), true);
      assert.equal(await may("GUARDIAN", "NOTE", "STANDARD", true, "WITHDRAWN", "GUARDIANS"), false);
      assert.equal(await may("GUARDIAN", "CONVOCATION", "STANDARD", true, "DRAFT", null), false);
      assert.equal(await may("GUARDIAN", "CONVOCATION", "STANDARD", true, "SENT", null), true);
      assert.equal(await may("STUDENT", "CONVOCATION", "STANDARD", true, "SENT", null), false);
      assert.equal(await may("TEACHER", "MEASURE", "STANDARD", true, "NOTIFIED", null), false, "audience inconnue : refus");
    });
  });

  it("lecture d'un élément confidentiel : journalisée au nom de l'utilisateur de la session, avec un motif, en ajout seul", async () => {
    await asUser(async (tx) => {
      const entity = uuid();
      await tx.fail("INSERT INTO schoollife.confidential_reads (id, tenant_id, entity_kind, entity_id, reader_user_id, purpose) VALUES ($1,$2,'MEASURE',$3,$4,'Instruction du dossier')", [uuid(), tx.tenantId, entity, VALIDATOR], /reader_mismatch/);
      await tx.fail("INSERT INTO schoollife.confidential_reads (id, tenant_id, entity_kind, entity_id, reader_user_id, purpose) VALUES ($1,$2,'MEASURE',$3,$4,'x')", [uuid(), tx.tenantId, entity, PROPOSER], /check|23514/);
      await tx.q("INSERT INTO schoollife.confidential_reads (id, tenant_id, entity_kind, entity_id, reader_user_id, purpose) VALUES ($1,$2,'MEASURE',$3,$4,'Instruction du dossier')", [uuid(), tx.tenantId, entity, PROPOSER]);
      await tx.fail("UPDATE schoollife.confidential_reads SET purpose = 'autre chose'", [], /permission denied|immutable|42501/);
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("INSERT INTO schoollife.confidential_reads (id, tenant_id, entity_kind, entity_id, reader_user_id, purpose) VALUES ($1,$2,'MEASURE',$3,$4,'Instruction du dossier')", [uuid(), tx.tenantId, entity, PROPOSER], /human_actor_required/);
    });
  });
});
