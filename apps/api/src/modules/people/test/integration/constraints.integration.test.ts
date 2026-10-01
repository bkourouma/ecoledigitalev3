import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { allowedStudentTransitions, canTransitionStaff, canTransitionStudent, STAFF_STATUSES, STUDENT_STATUSES } from "../../domain/status";
import { searchKey } from "../../domain/normalize";
import { adminRows, createPeopleTestDb, describeIntegration, type PeopleTestDb } from "../support/db";
import { mkStaff, mkStudent, uniqueBirthDate, word } from "../support/scenario";
import { createPeopleDeps } from "../../application/deps";
import { ctxFor, makeWorld } from "../support/db";

/**
 * Comportements imposés PAR LA BASE (data-model.md §6) : ils tiennent même si un appelant contourne les cas d'usage.
 * On écrit ici en superuser (RLS contournée) pour tester les déclencheurs et contraintes eux-mêmes, et avec le rôle de
 * l'application quand il s'agit de droits.
 */
describeIntegration("invariants du schéma people (Postgres réel)", () => {
  let db: PeopleTestDb;
  let tenant: string;
  let deps: ReturnType<typeof createPeopleDeps>;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    tenant = await db.createTenant("invariants");
    ctx = ctxFor(tenant);
    deps = makeWorld(db).deps;
  });
  afterAll(async () => {
    await db.drop();
  });

  const insertPerson = async (over: Record<string, unknown> = {}): Promise<string> => {
    const id = newId();
    const cols = { id, tenant_id: tenant, last_name: word(), first_name: word(), ...over };
    const keys = Object.keys(cols);
    await db.admin.query(`INSERT INTO people.persons (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(cols));
    return id;
  };

  it("persons : identité unique par tenant, référence externe unique, longueurs et formats", async () => {
    const identity = newId();
    await insertPerson({ identity_id: identity });
    await expect(insertPerson({ identity_id: identity })).rejects.toThrow(/persons_identity_unique/);
    // la même identité dans un AUTRE tenant : deux personnes, aucune fusion
    const other = await db.createTenant();
    await db.admin.query("INSERT INTO people.persons (id, tenant_id, last_name, first_name, identity_id) VALUES ($1,$2,'A','B',$3)", [newId(), other, identity]);
    await insertPerson({ external_ref: "EXT-1" });
    await expect(insertPerson({ external_ref: "EXT-1" })).rejects.toThrow(/persons_external_ref_unique/);
    await expect(insertPerson({ phone: "1234" })).rejects.toThrow(/phone/);
    await expect(insertPerson({ phone: "1".repeat(41) })).rejects.toThrow(/phone/);
    await insertPerson({ phone: "+".concat("2".repeat(38)) }); // 39 caractères : accepté (le legacy limitait à 20)
    await expect(insertPerson({ email: "pas-un-email" })).rejects.toThrow(/email/);
    await expect(insertPerson({ sex: "X" })).rejects.toThrow(/sex/);
    await expect(insertPerson({ nationality: "civ" })).rejects.toThrow(/nationality/);
    await expect(insertPerson({ birth_date: "1850-01-01" })).rejects.toThrow(/birth_date/);
    await expect(insertPerson({ last_name: "   " })).rejects.toThrow(/last_name/);
    // l'e-mail n'est PAS unique (une famille partage une adresse)
    await insertPerson({ email: "famille@example.test" });
    await insertPerson({ email: "famille@example.test" });
  });

  it("search_key : colonne générée sans accents, identique à la normalisation de l'application", async () => {
    const id = await insertPerson({ last_name: "Kouamé", first_name: "Jean-Marc", other_names: "Éloi" });
    const row = (await adminRows<{ search_key: string }>(db, "SELECT search_key FROM people.persons WHERE id = $1", [id]))[0];
    expect(row?.search_key).toBe(searchKey("Kouamé", "Jean-Marc", "Éloi"));
    const sim = await adminRows<{ s: number }>(db, "SELECT similarity(search_key, 'kouame jean marc') AS s FROM people.persons WHERE id = $1", [id]);
    expect(Number(sim[0]?.s)).toBeGreaterThan(0.4);
  });

  it("students : identifiant national et référence externe uniques (partiels), numéro d'ordre figé", async () => {
    const s1 = await mkStudent(deps, ctx, { nationalStudentId: "NAT-1", externalRef: "S-1" });
    await expect(mkStudent(deps, ctx, { nationalStudentId: "NAT-1" })).rejects.toThrow(); // via cas d'usage : erreur métier (unwrap)
    await expect(db.admin.query("UPDATE people.students SET sequence_number = 99 WHERE id = $1", [s1.id])).rejects.toThrow(/people.student_identity_immutable/);
    await expect(db.admin.query("UPDATE people.students SET person_id = $2 WHERE id = $1", [s1.id, await insertPerson()])).rejects.toThrow(/people.student_identity_immutable/);
    // une personne a au plus un dossier élève
    await expect(
      db.admin.query(`INSERT INTO people.students (id, tenant_id, person_id, student_number, sequence_number) VALUES ($1,$2,$3,'ZZ-1',9001)`, [newId(), tenant, s1.personId]),
    ).rejects.toThrow(/students_tenant_id_person_id_key/);
    // dates cohérentes
    await expect(db.admin.query("UPDATE people.students SET first_enrolled_on = '2025-09-01', left_on = '2025-01-01' WHERE id = $1", [s1.id])).rejects.toThrow(/left_on|check/i);
  });

  it("transitions de statut : la base applique exactement la table du domaine (8 × 8 combinaisons)", async () => {
    for (const from of STUDENT_STATUSES) {
      for (const to of STUDENT_STATUSES) {
        if (from === to) continue;
        const s = await mkStudent(deps, ctx);
        // amener le dossier à `from` en contournant les règles (superuser, déclencheurs de transition inclus)
        await db.admin.query("ALTER TABLE people.students DISABLE TRIGGER students_guard");
        await db.admin.query("UPDATE people.students SET status = $2 WHERE id = $1", [s.id, from]);
        await db.admin.query("ALTER TABLE people.students ENABLE TRIGGER students_guard");
        const attempt = db.admin.query("UPDATE people.students SET status = $2 WHERE id = $1", [s.id, to]);
        if (canTransitionStudent(from, to)) await expect(attempt, `${from}->${to}`).resolves.toBeDefined();
        else await expect(attempt, `${from}->${to}`).rejects.toThrow(/people.student_transition/);
      }
    }
    expect(allowedStudentTransitions("ACTIVE")).not.toContain("ARCHIVED");
  });

  it("transitions du personnel : miroir exact du déclencheur staff_guard", async () => {
    for (const from of STAFF_STATUSES) {
      for (const to of STAFF_STATUSES) {
        if (from === to) continue;
        const s = await mkStaff(deps, ctx);
        await db.admin.query("ALTER TABLE people.staff DISABLE TRIGGER staff_guard");
        await db.admin.query("UPDATE people.staff SET status = $2, left_on = CASE WHEN $2 = 'LEFT' THEN current_date ELSE NULL END WHERE id = $1", [s.id, from]);
        await db.admin.query("ALTER TABLE people.staff ENABLE TRIGGER staff_guard");
        const attempt = db.admin.query("UPDATE people.staff SET status = $2, left_on = CASE WHEN $2 = 'LEFT' THEN current_date ELSE NULL END WHERE id = $1", [s.id, to]);
        if (canTransitionStaff(from, to)) await expect(attempt, `${from}->${to}`).resolves.toBeDefined();
        else await expect(attempt, `${from}->${to}`).rejects.toThrow(/people.staff_transition/);
      }
    }
  });

  it("compteurs : un pas exactement, clé immuable, pas de numéro sans contexte de tenant", async () => {
    await mkStudent(deps, ctx);
    await expect(db.admin.query("UPDATE people.number_sequences SET last_value = last_value + 5 WHERE tenant_id = $1 AND kind = 'STUDENT'", [tenant])).rejects.toThrow(/people.sequence_step/);
    await expect(db.admin.query("UPDATE people.number_sequences SET last_value = last_value - 1 WHERE tenant_id = $1 AND kind = 'STUDENT'", [tenant])).rejects.toThrow(/people.sequence_step/);
    await expect(db.admin.query("UPDATE people.number_sequences SET kind = 'STAFF' WHERE tenant_id = $1 AND kind = 'STUDENT'", [tenant])).rejects.toThrow();
    await expect(db.appPool.query("SELECT people.next_number('STUDENT')")).rejects.toThrow(/contexte de tenant absent/);
  });

  it("droits du rôle applicatif : aucun DELETE sur les dossiers, l'historique et les contrats ; DELETE permis seulement où prévu", async () => {
    const priv = async (table: string, p: string) => (await db.appPool.query("SELECT has_table_privilege(current_user, $1, $2) AS ok", [`people.${table}`, p])).rows[0].ok as boolean;
    for (const t of ["persons", "students", "guardians", "student_guardians", "student_status_history", "staff", "staff_contracts", "staff_status_history", "teaching_assignments", "teaching_assignment_history", "number_sequences"]) {
      expect(await priv(t, "DELETE"), `DELETE sur ${t}`).toBe(false);
    }
    for (const t of ["student_status_history", "staff_status_history", "teaching_assignment_history"]) expect(await priv(t, "UPDATE"), `UPDATE sur ${t}`).toBe(false);
    for (const t of ["student_emergency_contacts", "student_prior_education", "staff_qualifications", "staff_competencies", "staff_availabilities", "staff_affiliations"]) {
      expect(await priv(t, "DELETE"), `DELETE sur ${t}`).toBe(true);
    }
    expect(await priv("persons", "TRUNCATE")).toBe(false);
  });

  it("liens : contact principal unique et vivant, un seul lien vivant par couple, fin >= début, historique conservé", async () => {
    const s = await mkStudent(deps, ctx);
    const mkG = async () => {
      const personId = await insertPerson();
      const id = newId();
      await db.admin.query("INSERT INTO people.guardians (id, tenant_id, person_id) VALUES ($1,$2,$3)", [id, tenant, personId]);
      return id;
    };
    const g1 = await mkG();
    const g2 = await mkG();
    const ins = (g: string, extra = "") =>
      db.admin.query(`INSERT INTO people.student_guardians (id, tenant_id, student_id, guardian_id, relationship_code, is_primary_contact${extra ? ", valid_to" : ""}) VALUES ($1,$2,$3,$4,'FATHER', ${extra ? "false, $5" : "true"})`, extra ? [newId(), tenant, s.id, g, extra] : [newId(), tenant, s.id, g]);
    await ins(g1);
    await expect(ins(g2)).rejects.toThrow(/student_guardians_one_primary/);
    await expect(db.admin.query(`INSERT INTO people.student_guardians (id, tenant_id, student_id, guardian_id, relationship_code) VALUES ($1,$2,$3,$4,'FATHER')`, [newId(), tenant, s.id, g1])).rejects.toThrow(/student_guardians_one_alive/);
    await expect(db.admin.query(`INSERT INTO people.student_guardians (id, tenant_id, student_id, guardian_id, relationship_code, valid_from, valid_to) VALUES ($1,$2,$3,$4,'FATHER','2025-09-01','2025-01-01')`, [newId(), tenant, s.id, g2])).rejects.toThrow(/valid_to|check/i);
    await expect(db.admin.query(`INSERT INTO people.student_guardians (id, tenant_id, student_id, guardian_id, relationship_code) VALUES ($1,$2,$3,$4,'INEXISTANT')`, [newId(), tenant, s.id, g2])).rejects.toThrow(/foreign key|clé étrangère/i);
  });

  it("qualifications qui expirent : la fonction SQL ne renvoie que le personnel actif, dans la fenêtre", async () => {
    const s = await mkStaff(deps, ctx);
    const left = await mkStaff(deps, ctx);
    const q = async (staffId: string, expires: string) => {
      const id = newId();
      await db.admin.query("INSERT INTO people.staff_qualifications (id, tenant_id, staff_id, kind, label, expires_on) VALUES ($1,$2,$3,'OTHER','Q',$4)", [id, tenant, staffId, expires]);
      return id;
    };
    const near = await q(s.id, "2025-09-20");
    await q(s.id, "2026-09-20");
    await q(left.id, "2025-09-20");
    await db.admin.query("UPDATE people.staff SET status = 'LEFT', left_on = '2025-08-31' WHERE id = $1", [left.id]);
    const res = await db.tenantDb.run(ctx, async (tx) => tx.many<{ qualification_id: string; days_left: number }>("SELECT qualification_id, days_left FROM people.expiring_qualifications('2025-09-01'::date, 30)"));
    expect(res.filter((r) => r.qualification_id === near)).toEqual([{ qualification_id: near, days_left: 19 }]);
    expect(res.every((r) => r.days_left >= 0 && r.days_left <= 30)).toBe(true);
    void uniqueBirthDate;
  });

  it("référentiels : code en majuscules, unicité par tenant, FK composite vers les types", async () => {
    await expect(db.admin.query("INSERT INTO people.relationship_types (id, tenant_id, code, label) VALUES ($1,$2,'pere','Père')", [newId(), tenant])).rejects.toThrow(/code/);
    await db.admin.query("INSERT INTO people.relationship_types (id, tenant_id, code, label) VALUES ($1,$2,'TUTEUR_X','Tuteur X')", [newId(), tenant]);
    await expect(db.admin.query("INSERT INTO people.relationship_types (id, tenant_id, code, label) VALUES ($1,$2,'TUTEUR_X','Autre')", [newId(), tenant])).rejects.toThrow(/duplicate|unique/i);
    const other = await db.createTenant();
    await db.admin.query("INSERT INTO people.relationship_types (id, tenant_id, code, label) VALUES ($1,$2,'TUTEUR_X','Tuteur X')", [newId(), other]); // même code, autre tenant : permis
    await expect(db.admin.query("INSERT INTO people.settings (tenant_id, student_number_pattern) VALUES ($1, 'sans-compteur')", [other])).rejects.toThrow(/check|student_number_pattern/i);
  });
});
