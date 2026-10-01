import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import {
  peopleStudentDetailDtoSchema,
  peopleStudentListDtoSchema,
  peopleStudentSensitiveDtoSchema,
  peopleStatusHistoryDtoSchema,
  peopleDuplicateCandidateDtoSchema,
} from "@ecoledigitale/contracts/src/v2/people";
import { changeStudentStatus, createStudent, exportStudents, findDuplicateStudents, getStatusHistory, getStudent, getStudentSensitive, getStudentsByIds, listStudents, updateStudent } from "../../application/students";
import { adminOne, adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { count, mkStudent, person, word } from "../support/scenario";

describeIntegration("dossier permanent de l'élève (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    world = makeWorld(db);
    tenant = await db.createTenant("ecole-a");
    ctx = ctxFor(tenant);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("AC1.1 crée atomiquement personne, dossier, numéro, historique NULL -> ACTIVE et événement", async () => {
    const s = await mkStudent(world.deps, ctx, {}, { nationality: "CI" });
    expect(peopleStudentDetailDtoSchema.safeParse(s).success).toBe(true);
    expect(s.studentNumber).toMatch(/^\d{5}$/);
    expect(s.status).toBe("ACTIVE");
    const history = unwrap(await getStatusHistory(world.deps, ctx, s.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "ACTIVE" });
    expect(peopleStatusHistoryDtoSchema.safeParse(history[0]).success).toBe(true);
    const events = await adminRows(db, "SELECT type, payload FROM kernel.domain_events WHERE aggregate_id = $1", [s.id]);
    expect(events.map((e) => e.type)).toEqual(["people.student.created"]);
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(/birth|phone|email/i);
  });

  it("AC1.5 le sexe est obligatoire et n'a aucune valeur par défaut", async () => {
    const r = await createStudent(world.deps, ctx, { person: { lastName: word(), firstName: word() } } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("people.sex_required");
  });

  it("AC1.4 doublon : 409 avec candidats, confirmation avec motif, désactivable", async () => {
    const draft = person({ lastName: "Kouamé", firstName: "Jean-Marc", birthDate: "2010-04-02" });
    const first = unwrap(await createStudent(world.deps, ctx, { person: draft }));
    expect(first.kind).toBe("created");
    // permutation nom / prénom, accents et casse ignorés
    const dup = await createStudent(world.deps, ctx, { person: { ...draft, lastName: "jean-marc", firstName: "KOUAME" } });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe("people.possible_duplicate");
      const candidates = (dup.error.details as { candidates: unknown[] }).candidates;
      expect(candidates).toHaveLength(1);
      expect(peopleDuplicateCandidateDtoSchema.safeParse(candidates[0]).success).toBe(true);
    }
    // validateOnly ne crée rien et renvoie les candidats
    const before = await count(db, "SELECT count(*) AS n FROM people.students");
    const v = unwrap(await createStudent(world.deps, ctx, { person: draft, validateOnly: true }));
    expect(v.kind).toBe("validated");
    expect(await count(db, "SELECT count(*) AS n FROM people.students")).toBe(before);
    // confirmation avec motif (tracée)
    const ok2 = unwrap(await createStudent(world.deps, ctx, { person: draft, acknowledgeDuplicate: true, duplicateReason: "Jumeaux, même naissance" }));
    expect(ok2.kind).toBe("created");
    expect(world.audit.find("people.student.duplicate_acknowledged")).toHaveLength(1);
    // des homonymes de dates différentes ne sont pas des doublons
    const other = await createStudent(world.deps, ctx, { person: { ...draft, birthDate: "2012-01-01" } });
    expect(other.ok).toBe(true);
    // via la recherche
    const found = unwrap(await findDuplicateStudents(world.deps, ctx, { lastName: "Kouame", firstName: "Jean Marc", birthDate: "2010-04-02" }));
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it("AC1.6 idempotent par externalRef", async () => {
    const body = { person: person(), externalRef: "IMPORT-001" };
    const a = unwrap(await createStudent(world.deps, ctx, body));
    const b = unwrap(await createStudent(world.deps, ctx, body));
    if (a.kind !== "created" || b.kind !== "created") throw new Error("created attendu");
    expect(b.replayed).toBe(true);
    expect(b.student.id).toBe(a.student.id);
  });

  it("AC1.3 le matricule est immuable et la lecture n'écrit jamais", async () => {
    const s = await mkStudent(world.deps, ctx);
    const before = await adminRows(db, "SELECT id, student_number, updated_at FROM people.students ORDER BY id");
    for (let i = 0; i < 5; i += 1) {
      unwrap(await listStudents(world.deps, ctx, {}));
      unwrap(await getStudent(world.deps, ctx, s.id));
      unwrap(await getStudentsByIds(world.deps, ctx, [s.id]));
    }
    expect(await adminRows(db, "SELECT id, student_number, updated_at FROM people.students ORDER BY id")).toEqual(before);
    await expect(db.admin.query("UPDATE people.students SET student_number = 'X' WHERE id = $1", [s.id])).rejects.toThrow(/people.student_identity_immutable/);
    await expect(db.admin.query("DELETE FROM people.students WHERE id = $1", [s.id])).rejects.toThrow(/people.immutable/);
    await expect(db.admin.query("DELETE FROM people.persons WHERE id = $1", [s.personId])).rejects.toThrow(/people.immutable/);
  });

  it("AC1.2 50 créations concurrentes : numéros contigus 1…50 sans doublon", async () => {
    const t2 = await db.createTenant("ecole-concurrence");
    const c2 = ctxFor(t2);
    const results = await Promise.all(Array.from({ length: 50 }, () => createStudent(world.deps, c2, { person: person() })));
    for (const r of results) expect(r.ok).toBe(true);
    const seq = (await adminRows<{ sequence_number: number }>(db, "SELECT sequence_number FROM people.students WHERE tenant_id = $1 ORDER BY sequence_number", [t2])).map((r) => r.sequence_number);
    expect(seq).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const numbers = await adminRows<{ student_number: string }>(db, "SELECT student_number FROM people.students WHERE tenant_id = $1", [t2]);
    expect(new Set(numbers.map((n) => n.student_number)).size).toBe(50);
  });

  it("une création annulée rend son numéro à la suivante (gapless)", async () => {
    const t3 = await db.createTenant("ecole-rollback");
    const c3 = ctxFor(t3);
    const a = await mkStudent(world.deps, c3);
    // identifiant national dupliqué : la création échoue APRÈS avoir pris le numéro, tout est annulé
    unwrap(await createStudent(world.deps, c3, { person: person(), nationalStudentId: "NAT-1" }));
    const bad = await createStudent(world.deps, c3, { person: person(), nationalStudentId: "NAT-1" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("people.national_id_conflict");
    const c = await mkStudent(world.deps, c3);
    expect([a.sequenceNumber, c.sequenceNumber]).toEqual([1, 3]);
  });

  it("AC3.1 statut : transitions, motif exigé, historique avec auteur, événement", async () => {
    const s = await mkStudent(world.deps, ctx);
    const noReason = await changeStudentStatus(world.deps, ctx, s.id, { status: "EXCLUDED" });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error.code).toBe("people.reason_required");
    const bad = await changeStudentStatus(world.deps, ctx, s.id, { status: "ARCHIVED" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("people.invalid_transition");
    const out = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "WITHDRAWN", reasonText: "Déménagement", reasonCode: "MOVED" }));
    expect(out.status).toBe("WITHDRAWN");
    expect(out.leftOn).toBe("2025-09-01");
    unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "ARCHIVED" }));
    const back = await changeStudentStatus(world.deps, ctx, s.id, { status: "ACTIVE" });
    expect(back.ok).toBe(false); // retour depuis ARCHIVED : motif exigé
    const back2 = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "ACTIVE", reasonText: "Réinscription" }));
    expect(back2.status).toBe("ACTIVE");
    expect(back2.leftOn).toBeNull();
    const h = unwrap(await getStatusHistory(world.deps, ctx, s.id));
    expect(h.map((x) => x.toStatus)).toEqual(["ACTIVE", "ARCHIVED", "WITHDRAWN", "ACTIVE"]);
    expect(h.every((x) => x.changedBy === ctx.userId)).toBe(true);
    const events = await adminRows(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'people.student.status_changed' ORDER BY occurred_at", [s.id]);
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain("Déménagement"); // le texte libre reste dans l'historique
    await expect(db.admin.query("UPDATE people.student_status_history SET to_status = 'ACTIVE' WHERE student_id = $1", [s.id])).rejects.toThrow(/people.immutable/);
  });

  it("US4 listes : aucun champ sensible, pagination plafonnée à 200, recherche tolérante", async () => {
    const t4 = await db.createTenant("ecole-liste");
    const c4 = ctxFor(t4);
    const s = await mkStudent(world.deps, c4, { nationalStudentId: "MAT-NAT-9", birthCertificateNumber: "ACTE-42" }, { lastName: "Traoré", firstName: "Aminata" });
    for (let i = 0; i < 4; i += 1) await mkStudent(world.deps, c4);
    const list = unwrap(await listStudents(world.deps, c4, { limit: 1000 }));
    expect(list.limit).toBe(200);
    expect(peopleStudentListDtoSchema.safeParse(list).success).toBe(true);
    const text = JSON.stringify(list);
    expect(text).not.toContain("MAT-NAT-9");
    expect(text).not.toContain("ACTE-42");
    expect(text).not.toMatch(/nationalStudentId|birthCertificate|attributes|birthDate/);
    expect(unwrap(await listStudents(world.deps, c4, { q: "traore" })).items.map((i) => i.id)).toEqual([s.id]);
    expect(unwrap(await listStudents(world.deps, c4, { q: "Aminata Traore" })).items.map((i) => i.id)).toEqual([s.id]);
    expect(unwrap(await listStudents(world.deps, c4, { q: s.studentNumber })).items.map((i) => i.id)).toContain(s.id);
    // identifiant national : recherche seulement avec la permission sensible
    expect(unwrap(await listStudents(world.deps, c4, { q: "MAT-NAT-9" })).items).toHaveLength(0);
    expect(unwrap(await listStudents(world.deps, c4, { q: "MAT-NAT-9" }, { allowNationalIdSearch: true })).items.map((i) => i.id)).toEqual([s.id]);
  });

  it("AC7.1 champs sensibles : seulement par getStudentSensitive, lecture auditée", async () => {
    const s = await mkStudent(world.deps, ctx, { nationalStudentId: `NAT-${word()}`, civilRegistryOffice: "Bureau X", attributes: { sousPrefecture: "Y" } });
    expect(JSON.stringify(s)).not.toMatch(/nationalStudentId|civilRegistryOffice|attributes/);
    const before = world.audit.find("people.student.sensitive_read").length;
    const sens = unwrap(await getStudentSensitive(world.deps, ctx, s.id));
    expect(peopleStudentSensitiveDtoSchema.safeParse(sens).success).toBe(true);
    expect(sens.civilRegistryOffice).toBe("Bureau X");
    const entries = world.audit.find("people.student.sensitive_read");
    expect(entries.length).toBe(before + 1);
    expect(entries.at(-1)?.severity).toBe("notice");
    // modifier un champ sensible sans permission dédiée est refusé
    const denied = await updateStudent(world.deps, ctx, s.id, { civilRegistryOffice: "Z" }, { allowSensitive: false });
    expect(denied.ok).toBe(false);
  });

  it("AC7.4 export CSV audité, sans champ sensible, protégé contre l'injection de formule", async () => {
    const t5 = await db.createTenant("ecole-export");
    const c5 = ctxFor(t5);
    await mkStudent(world.deps, c5, {}, { lastName: "=CMD()", firstName: "Test" });
    const out = unwrap(await exportStudents(world.deps, c5, {}));
    expect(out.count).toBe(1);
    expect(out.csv).toContain("'=CMD()");
    expect(out.csv).not.toMatch(/birth|phone/i);
    expect(world.audit.find("people.student.exported").at(-1)?.severity).toBe("notice");
  });

  it("RLS : un autre tenant ne voit ni ne modifie rien", async () => {
    const tx1 = await db.createTenant("rls-1");
    const tx2 = await db.createTenant("rls-2");
    const s = await mkStudent(world.deps, ctxFor(tx1));
    const other = await getStudent(world.deps, ctxFor(tx2), s.id);
    expect(other.ok).toBe(false);
    expect(unwrap(await listStudents(world.deps, ctxFor(tx2), {})).total).toBe(0);
    expect((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM people.students WHERE tenant_id = $1", [tx2])).n).toBe("0");
  });
});

describe("(garde de lecture)", () => {
  it("le fichier se charge sans base", () => {
    expect(typeof listStudents).toBe("function");
  });
});
