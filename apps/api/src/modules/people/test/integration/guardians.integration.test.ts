import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { peopleChildDtoSchema, peopleGuardianDtoSchema, peopleGuardianLinkDtoSchema, peopleStudentGuardianDtoSchema, peopleStudentSummaryDtoSchema } from "@ecoledigitale/contracts/src/v2/people";
import { isGuardianOfStudentRule } from "../../domain/guardianship";
import {
  createGuardian,
  getChildView,
  getMyStudent,
  isGuardianOfStudent,
  linkGuardian,
  listChildrenOfIdentity,
  listGuardians,
  listGuardiansOfStudent,
  resolveStudentForIdentity,
  unlinkGuardian,
  updateChildEmergencyContact,
  updateGuardian,
  updateGuardianLink,
  updateMyContact,
} from "../../application/guardians";
import { addEmergencyContact } from "../../application/students";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { count, giveEnrollment, giveIdentity, link, mkGuardian, mkStudent, person, word } from "../support/scenario";

describeIntegration("tuteurs, liens et accès « enfant » (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    world = makeWorld(db);
    tenant = await db.createTenant("ecole-tuteurs");
    ctx = ctxFor(tenant);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("AC2.1 lien avec valeurs par défaut prudentes ; un seul contact principal ; bascule atomique", async () => {
    const student = await mkStudent(world.deps, ctx);
    const father = await mkGuardian(world.deps, ctx);
    const mother = await mkGuardian(world.deps, ctx);
    const l1 = await link(world.deps, ctx, student.id, father.id, { isPrimaryContact: true });
    expect(peopleGuardianLinkDtoSchema.safeParse(l1).success).toBe(true);
    expect(l1).toMatchObject({ canPickup: false, hasLegalCustody: false, portalAccess: true, isPrimaryContact: true, validTo: null });
    // un second principal échoue
    const second = await linkGuardian(world.deps, ctx, student.id, { guardianId: mother.id, relationshipCode: "MOTHER", isPrimaryContact: true });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("people.primary_guardian_conflict");
    const l2 = await link(world.deps, ctx, student.id, mother.id, { relationshipCode: "MOTHER" });
    // le même tuteur ne se lie pas deux fois
    const dup = await linkGuardian(world.deps, ctx, student.id, { guardianId: mother.id, relationshipCode: "MOTHER" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("people.link_exists");
    // bascule explicite : l'ancien principal est rétrogradé dans la même transaction
    const switched = unwrap(await updateGuardianLink(world.deps, ctx, student.id, l2.id, { isPrimaryContact: true }));
    expect(switched.isPrimaryContact).toBe(true);
    const list = unwrap(await listGuardiansOfStudent(world.deps, ctx, student.id));
    expect(list.filter((x) => x.link.isPrimaryContact)).toHaveLength(1);
    expect(list.every((x) => peopleStudentGuardianDtoSchema.safeParse(x).success)).toBe(true);
    expect(await count(db, "SELECT count(*) AS n FROM people.student_guardians WHERE student_id = $1 AND is_primary_contact AND valid_to IS NULL", [student.id])).toBe(1);
    // l'index unique refuse d'ailleurs deux principaux vivants, même par SQL direct
    await expect(db.admin.query("UPDATE people.student_guardians SET is_primary_contact = true WHERE id = $1", [l1.id])).rejects.toThrow(/student_guardians_one_primary/);
  });

  it("AC2.1 unlink CLÔT le lien (jamais de suppression) ; la base refuse le DELETE ; un lien clos peut être rétabli en une nouvelle ligne", async () => {
    const student = await mkStudent(world.deps, ctx);
    const g = await mkGuardian(world.deps, ctx);
    const l = await link(world.deps, ctx, student.id, g.id, { isPrimaryContact: true });
    const closed = unwrap(await unlinkGuardian(world.deps, ctx, student.id, l.id, { reason: "Déchéance de l'autorité" }));
    expect(closed.validTo).toBe("2025-09-01");
    expect(closed.isPrimaryContact).toBe(false);
    expect(closed.portalAccess).toBe(false);
    await expect(db.admin.query("DELETE FROM people.student_guardians WHERE id = $1", [l.id])).rejects.toThrow(/people.immutable/);
    const again = await unlinkGuardian(world.deps, ctx, student.id, l.id);
    expect(again.ok).toBe(false);
    const edit = await updateGuardianLink(world.deps, ctx, student.id, l.id, { canPickup: true });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.code).toBe("people.link_closed");
    // rétablissement : nouvelle ligne, l'historique des deux périodes est conservé
    const l2 = await link(world.deps, ctx, student.id, g.id, { isPrimaryContact: true });
    expect(l2.id).not.toBe(l.id);
    expect(unwrap(await listGuardiansOfStudent(world.deps, ctx, student.id)).map((x) => x.link.id)).toEqual([l2.id]);
    expect(unwrap(await listGuardiansOfStudent(world.deps, ctx, student.id, { includeClosed: true }))).toHaveLength(2);
    expect(world.audit.find("people.guardian.unlinked").at(-1)?.severity).toBe("notice");
    // événements agrégés pour les modules d'accès
    const types = (await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE type LIKE 'people.%guardian%' AND payload->>'studentId' = $1", [student.id])).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["people.guardian.linked", "people.guardian.unlinked", "people.student.guardian_changed"]));
  });

  it("un type de lien qui n'est pas une tutelle ne porte ni l'autorité ni l'accès au portail", async () => {
    const student = await mkStudent(world.deps, ctx);
    const neighbour = await mkGuardian(world.deps, ctx);
    const bad = await linkGuardian(world.deps, ctx, student.id, { guardianId: neighbour.id, relationshipCode: "EMERGENCY_CONTACT", hasLegalCustody: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("people.relationship_not_guardian");
    const ok1 = await link(world.deps, ctx, student.id, neighbour.id, { relationshipCode: "EMERGENCY_CONTACT" });
    expect(ok1).toMatchObject({ portalAccess: false, hasLegalCustody: false, relationshipKind: "EMERGENCY" });
    const unknown = await linkGuardian(world.deps, ctx, student.id, { guardianId: (await mkGuardian(world.deps, ctx)).id, relationshipCode: "NOPE" });
    expect(unknown.ok).toBe(false);
  });

  it("AC2.3 isGuardianOfStudent : matrice complète (vivant, clos, sans accès, urgence, autre élève, autre tenant, tuteur archivé)", async () => {
    const identity = newId();
    const child = await mkStudent(world.deps, ctx);
    const stranger = await mkStudent(world.deps, ctx);
    const parent = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, parent.personId, identity);
    const l = await link(world.deps, ctx, child.id, parent.id, { isPrimaryContact: true });
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(true); // lien vivant
    expect(await isGuardianOfStudent(world.deps, ctx, identity, stranger.id)).toBe(false); // autre élève
    expect(await isGuardianOfStudent(world.deps, ctx, newId(), child.id)).toBe(false); // autre identité
    expect(await isGuardianOfStudent(world.deps, ctxFor(await db.createTenant()), identity, child.id)).toBe(false); // autre tenant
    unwrap(await updateGuardianLink(world.deps, ctx, child.id, l.id, { portalAccess: false }));
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(false); // sans accès au portail (R7)
    unwrap(await updateGuardianLink(world.deps, ctx, child.id, l.id, { portalAccess: true }));
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(true);
    await db.admin.query("UPDATE people.guardians SET status = 'ARCHIVED' WHERE id = $1", [parent.id]);
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(false); // tuteur archivé
    await db.admin.query("UPDATE people.guardians SET status = 'ACTIVE' WHERE id = $1", [parent.id]);
    unwrap(await unlinkGuardian(world.deps, ctx, child.id, l.id));
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(false); // lien clos
    // contact d'urgence : même avec portal_access forcé en base, le type EMERGENCY n'ouvre jamais l'accès
    const l3 = await link(world.deps, ctx, child.id, parent.id, { relationshipCode: "EMERGENCY_CONTACT" });
    await db.admin.query("UPDATE people.student_guardians SET portal_access = true WHERE id = $1", [l3.id]);
    expect(await isGuardianOfStudent(world.deps, ctx, identity, child.id)).toBe(false);
  });

  it("la version SQL et la règle pure donnent la même décision sur toute la matrice", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const kinds: Array<[string, "GUARDIAN" | "EMERGENCY" | "OTHER"]> = [["FATHER", "GUARDIAN"], ["EMERGENCY_CONTACT", "EMERGENCY"], ["OTHER", "OTHER"]];
    for (const [code, kind] of kinds) {
      for (const portalAccess of [true, false]) {
        for (const alive of [true, false]) {
          for (const guardianStatus of ["ACTIVE", "ARCHIVED"] as const) {
            const child = await mkStudent(world.deps, c);
            const g = await mkGuardian(world.deps, c);
            const identity = await giveIdentity(db, g.personId);
            const l = await link(world.deps, c, child.id, g.id, { relationshipCode: code });
            await db.admin.query("UPDATE people.student_guardians SET portal_access = $2 WHERE id = $1", [l.id, portalAccess]);
            if (!alive) unwrap(await unlinkGuardian(world.deps, c, child.id, l.id));
            await db.admin.query("UPDATE people.guardians SET status = $2 WHERE id = $1", [g.id, guardianStatus]);
            const expected = isGuardianOfStudentRule({ personHasIdentity: true, personStatus: "ACTIVE", guardianStatus, linkAlive: alive, portalAccess: alive ? portalAccess : false, relationshipKind: kind });
            expect(await isGuardianOfStudent(world.deps, c, identity, child.id), `${code}/${portalAccess}/${alive}/${guardianStatus}`).toBe(expected);
          }
        }
      }
    }
  });

  it("AC2.4 un parent dont les enfants sont dans deux établissements les voit dans une seule liste triée ; deux tenants : deux personnes, aucune fusion", async () => {
    const identity = newId();
    const t = await db.createTenant("ecole-groupe");
    const c = ctxFor(t);
    const instA = newId();
    const instB = newId();
    const zoe = await mkStudent(world.deps, c, {}, { lastName: "Zongo", firstName: "Zoé" });
    const abel = await mkStudent(world.deps, c, {}, { lastName: "Adou", firstName: "Abel" });
    const other = await mkStudent(world.deps, c);
    await giveEnrollment(db, t, zoe.id, { classroomId: newId(), institutionId: instA, classroomName: "CE2 A" });
    await giveEnrollment(db, t, abel.id, { classroomId: newId(), institutionId: instB, classroomName: "6e B" });
    const parent = await mkGuardian(world.deps, c);
    await giveIdentity(db, parent.personId, identity);
    await link(world.deps, c, zoe.id, parent.id);
    await link(world.deps, c, abel.id, parent.id, { relationshipCode: "LEGAL_GUARDIAN" });
    const kids = unwrap(await listChildrenOfIdentity(world.deps, c, identity));
    expect(kids.map((k) => k.lastName)).toEqual(["Adou", "Zongo"]);
    expect(kids.map((k) => k.currentEnrollment?.institutionId).sort()).toEqual([instA, instB].sort());
    expect(kids.every((k) => peopleStudentSummaryDtoSchema.safeParse(k).success)).toBe(true);
    expect(kids.map((k) => k.id)).not.toContain(other.id);
    // même e-mail dans un autre tenant : une autre personne, aucune fusion ; ce tenant ne voit pas les enfants du premier
    const t2 = await db.createTenant("autre-groupe");
    const c2 = ctxFor(t2);
    const child2 = await mkStudent(world.deps, c2);
    const parent2 = await mkGuardian(world.deps, c2);
    await giveIdentity(db, parent2.personId, identity);
    await link(world.deps, c2, child2.id, parent2.id);
    expect(unwrap(await listChildrenOfIdentity(world.deps, c2, identity)).map((k) => k.id)).toEqual([child2.id]);
    expect(unwrap(await listChildrenOfIdentity(world.deps, c, identity)).map((k) => k.id)).toHaveLength(2);
  });

  it("AC5.2 getChildView : 404 pour tout élève hors lien vivant, aucun champ sensible, contacts d'urgence inclus", async () => {
    const identity = newId();
    const mine = await mkStudent(world.deps, ctx, { nationalStudentId: `N-${word()}`, birthCertificateNumber: "ACTE-1" });
    const notMine = await mkStudent(world.deps, ctx);
    const parent = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, parent.personId, identity);
    const co = await mkGuardian(world.deps, ctx);
    await link(world.deps, ctx, mine.id, parent.id, { isPrimaryContact: true });
    await link(world.deps, ctx, mine.id, co.id, { relationshipCode: "MOTHER" });
    unwrap(await addEmergencyContact(world.deps, ctx, mine.id, { contactName: "Voisine", phone: "0102030405" }));
    const view = unwrap(await getChildView(world.deps, ctx, identity, mine.id));
    expect(peopleChildDtoSchema.safeParse(view).success).toBe(true);
    expect(view.student.access).toBe("GUARDIAN");
    expect(view.emergencyContacts).toHaveLength(1);
    expect(view.guardians).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/nationalStudentId|birthCertificate|ACTE-1|attributes/);
    // les coordonnées des AUTRES tuteurs ne sont pas exposées
    expect(JSON.stringify(view.guardians)).not.toMatch(/phone|email/);
    const denied = await getChildView(world.deps, ctx, identity, notMine.id);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.httpStatus).toBe(404);
  });

  it("AC5.3 le parent met à jour ses coordonnées et un contact d'urgence de SON enfant (audité) mais pas ceux d'un autre élève", async () => {
    const identity = newId();
    const mine = await mkStudent(world.deps, ctx);
    const notMine = await mkStudent(world.deps, ctx);
    const parent = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, parent.personId, identity);
    await link(world.deps, ctx, mine.id, parent.id);
    const c1 = unwrap(await addEmergencyContact(world.deps, ctx, mine.id, { contactName: "Oncle", phone: "0102030405" }));
    const c2 = unwrap(await addEmergencyContact(world.deps, ctx, notMine.id, { contactName: "Autre", phone: "0506070809" }));
    const upd = unwrap(await updateChildEmergencyContact(world.deps, ctx, identity, mine.id, c1.id, { phone: "0111111111" }));
    expect(upd.phone).toBe("0111111111");
    expect(world.audit.find("people.student.emergency_contact_updated").at(-1)?.metadata).toMatchObject({ by: "GUARDIAN" });
    const denied = await updateChildEmergencyContact(world.deps, ctx, identity, notMine.id, c2.id, { phone: "0999999999" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.httpStatus).toBe(404);
    // coordonnées propres du tuteur : e-mail, téléphone, adresse ; jamais l'identité
    const res = unwrap(await updateMyContact(world.deps, ctx, identity, "GUARDIAN", { phone: "+2250707070707", city: "Bouaké" }));
    expect(res.fields).toEqual(["city", "phone"]);
    const row = (await adminRows<{ phone: string; city: string }>(db, "SELECT phone, city FROM people.persons WHERE id = $1", [parent.personId]))[0];
    expect(row).toEqual({ phone: "+2250707070707", city: "Bouaké" });
    expect(world.audit.find("people.guardian.own_contact_updated")).toHaveLength(1);
    const noProfile = await updateMyContact(world.deps, ctx, newId(), "GUARDIAN", { phone: "+2250707070707" });
    expect(noProfile.ok).toBe(false);
  });

  it("AC5.1 mon dossier : par l'identité courante uniquement, jamais « la fiche la plus récente »", async () => {
    const identity = newId();
    const s = await mkStudent(world.deps, ctx);
    await mkStudent(world.deps, ctx); // un dossier plus récent qui ne doit pas être renvoyé par repli
    await giveIdentity(db, s.personId, identity);
    expect(await resolveStudentForIdentity(world.deps, ctx, identity)).toBe(s.id);
    expect(unwrap(await getMyStudent(world.deps, ctx, identity)).id).toBe(s.id);
    expect(await resolveStudentForIdentity(world.deps, ctx, newId())).toBeNull();
    const none = await getMyStudent(world.deps, ctx, newId());
    expect(none.ok).toBe(false);
  });

  it("AC2.5 une personne peut être tuteur ET élève/personnel : un seul enregistrement persons", async () => {
    const g = await mkGuardian(world.deps, ctx);
    const dup = await createGuardian(world.deps, ctx, { personId: g.personId });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("people.person_already_guardian");
    expect(await count(db, "SELECT count(*) AS n FROM people.persons WHERE id = $1", [g.personId])).toBe(1);
  });

  it("tuteurs sans compte : joignables, recherche par téléphone normalisé, doublon d'e-mail signalé", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const g = await mkGuardian(world.deps, c, { phone: "+2250505050505", email: "famille@example.test" });
    expect(peopleGuardianDtoSchema.safeParse(g).success).toBe(true);
    expect(g.portalAccount).toBe("NONE");
    expect(unwrap(await listGuardians(world.deps, c, { q: "+225 05 05 05 05 05" })).items.map((x) => x.id)).toEqual([g.id]);
    // la famille partage une adresse e-mail : avertissement (pas une contrainte) et confirmation par motif
    const dup = await createGuardian(world.deps, c, { person: person({ email: "famille@example.test" }) });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("people.possible_duplicate");
    const confirmed = unwrap(await createGuardian(world.deps, c, { person: person({ email: "famille@example.test" }), acknowledgeDuplicate: true, duplicateReason: "Deux parents, même adresse" }));
    expect(confirmed.duplicates).toHaveLength(1);
    const updated = unwrap(await updateGuardian(world.deps, c, g.id, { occupation: "Commerçant" }));
    expect(updated.occupation).toBe("Commerçant");
  });
});
