/**
 * ASSEMBLAGE RÉEL du module `people` dans la plateforme v2 : Postgres + Redis réels, vrais plugins legacy, `registerV2Platform`,
 * vrai worker (relais d'outbox, abonnés découverts sur disque), vrais modules iam / rbac / audit / tenancy.
 * Tout passe par HTTP. Scénario E2E de la spec 008 : « secrétariat crée un élève et ses deux tuteurs -> invitation au portail
 * -> le parent voit son enfant, pas un autre ».
 *
 * Il exige Redis : il s'ignore avec le seul Postgres du module. Pour le lancer (Docker, Postgres + Redis éphémères) :
 *
 *   cd apps/api && ED_PG_IMAGE=postgres:17-alpine node ../worker/scripts/with-infra.mjs src/modules/people/test/platform
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeIntegration } from "../../../../../test/helpers/fixtures";
import { REDIS_URL, startPhase1Platform, waitFor, type Phase1Env } from "../../../../../test/phase1/support/harness";
import { loginPlain, loginWithMfaEnrollment, provisionByConsole, readAuditLog, redeemInvitation, type ProvisionedOwner, type Session } from "../../../../../test/phase1/support/scenario";

const SENSITIVE_KEYS = /nationalStudentId|birthCertificate|civilRegistryOffice|"attributes"|password|secret|"token"/i;

describeIntegration.skipIf(!REDIS_URL)("module people assemblé dans la plateforme v2 (HTTP de bout en bout)", () => {
  let p: Phase1Env;
  let A: ProvisionedOwner;
  let owner: Session;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    p = await startPhase1Platform();
    A = await provisionByConsole(p, { name: "Lycée Alpha", slug: "alpha", packs: ["HIGHER"], ownerEmail: "owner@alpha.test" });
    await redeemInvitation(p, A.ownerEmail);
    owner = await loginWithMfaEnrollment(p, A.ownerEmail, A.slug);
  }, 240_000);
  afterAll(async () => {
    await p?.stop();
  });

  const call = (method: string, url: string, token: string | undefined, body?: unknown) =>
    p.http(method, `/api/v1/people${url}`, { ...(token ? { token } : {}), ...(body !== undefined ? { body } : {}) });

  it("le module est chargé ; ses permissions sont dans le catalogue RBAC ; ses référentiels sont amorcés par le worker", async () => {
    expect(p.status.modules).toContain("people");
    const catalog = await p.http("GET", "/api/v1/rbac/permissions", { token: owner.accessToken });
    const keys = (catalog.body.permissions as Array<{ key: string; sensitive: boolean }>).filter((k) => /^(student|guardian|staff|teaching|people)\./.test(k.key));
    expect(keys.map((k) => k.key)).toEqual(expect.arrayContaining(["student.class.read", "student.child.read", "student.self.read", "guardian.manage", "teaching.assign", "staff.contract.manage"]));
    expect(keys.find((k) => k.key === "student.sensitive.read")?.sensitive).toBe(true);
    await waitFor(async () => Number((await p.db.admin.query("SELECT count(*)::int AS n FROM people.relationship_types WHERE tenant_id = $1", [A.tenantId])).rows[0].n) >= 8, { label: "référentiels people amorcés (tenancy.tenant.provisioned)" });
    const settings = await call("GET", "/settings", owner.accessToken);
    expect(settings.status).toBe(200);
    expect(settings.body).toMatchObject({ studentNumberPattern: "{SEQ:5}", staffNumberPattern: "P{SEQ:4}", duplicateCheckEnabled: true });
  });

  it("sans jeton : 401 ; jeton legacy : jamais 200 ni 500", async () => {
    expect((await call("GET", "/students", undefined)).status).toBe(401);
    const legacy = p.generateLegacyToken({ id: "0192f0a4-7b1e-7c3a-8d2e-0000000000c1", tenantId: A.tenantId, tenantSlug: A.slug, role: "admin" });
    expect([401, 403]).toContain((await call("GET", "/students", legacy)).status);
  });

  it("crée un élève et ses deux tuteurs (numéro gapless, audit réel, aucun champ sensible dans les listes)", async () => {
    const child = await call("POST", "/students", owner.accessToken, { person: { lastName: "Koné", firstName: "Awa", sex: "F", birthDate: "2012-03-04" }, nationalStudentId: "NAT-CONE-1" });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    ids.child = child.body.student.id;
    expect(child.body.student.studentNumber).toBe("00001");
    const other = await call("POST", "/students", owner.accessToken, { person: { lastName: "Diallo", firstName: "Moussa", sex: "M", birthDate: "2011-06-05" } });
    ids.other = other.body.student.id;
    expect(other.body.student.studentNumber).toBe("00002");
    for (const [key, name, email] of [["father", "Koné Ibrahim", "pere@alpha.test"], ["mother", "Koné Fatou", "mere@alpha.test"]] as const) {
      const [lastName, firstName] = name.split(" ");
      const g = await call("POST", "/guardians", owner.accessToken, { person: { lastName, firstName, sex: key === "father" ? "M" : "F", birthDate: key === "father" ? "1980-01-02" : "1984-03-03", email, phone: "+225 07 00 00 00 0" + (key === "father" ? "1" : "2") } });
      expect(g.status, JSON.stringify(g.body)).toBe(201);
      ids[key] = g.body.guardian.id;
      ids[`${key}Person`] = g.body.guardian.personId;
    }
    expect((await call("POST", `/students/${ids.child}/guardians`, owner.accessToken, { guardianId: ids.father, relationshipCode: "FATHER", isPrimaryContact: true, hasLegalCustody: true })).status).toBe(201);
    expect((await call("POST", `/students/${ids.child}/guardians`, owner.accessToken, { guardianId: ids.mother, relationshipCode: "MOTHER" })).status).toBe(201);
    const list = await call("GET", "/students", owner.accessToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(SENSITIVE_KEYS);
    const sensitive = await call("GET", `/students/${ids.child}/sensitive`, owner.accessToken);
    expect(sensitive.status).toBe(200); // propriétaire + MFA satisfaite
    expect(sensitive.body.nationalStudentId).toBe("NAT-CONE-1");
    // l'audit RÉEL (module audit, chaîné) a tout enregistré, dont la lecture sensible, sans donnée personnelle
    const log = await readAuditLog(p, owner.accessToken);
    const actions = log.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["people.student.created", "people.guardian.created", "people.guardian.linked", "people.student.sensitive_read"]));
    expect(log.find((e) => e.action === "people.student.sensitive_read")?.severity).toBe("notice");
    expect(JSON.stringify(log.filter((e) => String(e.action).startsWith("people.")))).not.toMatch(/NAT-CONE-1|pere@alpha|2012-03-04/);
  });

  it("invitation au portail : aucun mot de passe ni jeton dans la réponse ; la projection des accès est alimentée par l'événement iam", async () => {
    const inv = await call("POST", `/persons/${ids.fatherPerson}/portal-invitation`, owner.accessToken, {});
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body).toMatchObject({ invited: true, role: "parent", status: "active" });
    expect(JSON.stringify(inv.body)).not.toMatch(/password|token|secret/i);
    ids.fatherIdentity = inv.body.identityId;
    expect(p.invitations.some((i) => i.email === "pere@alpha.test" && i.kind === "invitation")).toBe(true);
    await waitFor(async () => (await p.db.admin.query("SELECT 1 FROM people.identity_memberships WHERE tenant_id = $1 AND identity_id = $2", [A.tenantId, ids.fatherIdentity])).rowCount, { label: "projection iam.membership.created" });
    const g = await call("GET", `/guardians/${ids.father}`, owner.accessToken);
    expect(g.body.portalAccount).toBe("active");
    // relancer ne crée pas de second compte
    const again = await call("POST", `/persons/${ids.fatherPerson}/portal-invitation`, owner.accessToken, {});
    expect(again.status).toBe(200);
    expect(again.body.invited).toBe(false);
  });

  it("le parent invité voit SON enfant et lui seul ; aucun accès d'administration", async () => {
    await redeemInvitation(p, "pere@alpha.test");
    const parent = await loginPlain(p, "pere@alpha.test", A.slug);
    expect(parent.identityId).toBe(ids.fatherIdentity);
    const kids = await call("GET", "/children", parent.accessToken);
    expect(kids.status, JSON.stringify(kids.body)).toBe(200);
    expect(kids.body.items.map((k: { id: string }) => k.id)).toEqual([ids.child]);
    const own = await call("GET", `/children/${ids.child}`, parent.accessToken);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toMatch(SENSITIVE_KEYS);
    expect((await call("GET", `/children/${ids.other}`, parent.accessToken)).status).toBe(404);
    for (const [method, url] of [["GET", "/students"], ["GET", `/students/${ids.child}`], ["GET", `/students/${ids.child}/sensitive`], ["GET", "/guardians"], ["GET", "/staff"], ["GET", "/settings"], ["GET", "/me/student"]] as const) {
      expect((await call(method, url, parent.accessToken)).status, `${method} ${url}`).toBe(403);
    }
    expect((await call("PATCH", "/me/guardian", parent.accessToken, { phone: "+2250700000099" })).status).toBe(200);
    // le parent ne modifie JAMAIS les drapeaux de son lien (retrait, autorité, accès)
    const links = await call("GET", `/students/${ids.child}/guardians`, owner.accessToken);
    const linkId = links.body.items.find((l: { guardian: { id: string } }) => l.guardian.id === ids.father).link.id as string;
    expect((await call("PATCH", `/students/${ids.child}/guardians/${linkId}`, parent.accessToken, { canPickup: true })).status).toBe(403);
    // le secrétariat coupe le portail : l'accès disparaît immédiatement
    expect((await call("PATCH", `/students/${ids.child}/guardians/${linkId}`, owner.accessToken, { portalAccess: false })).status).toBe(200);
    expect((await call("GET", `/children/${ids.child}`, parent.accessToken)).status).toBe(404);
  });

  it("un enseignant invité : portail personnel opérationnel ; contrats illisibles pour un tiers", async () => {
    const t = await call("POST", "/staff", owner.accessToken, { person: { lastName: "Aka", firstName: "Marie", sex: "F", birthDate: "1988-08-08", email: "prof@alpha.test" }, categoryCode: "TEACHER" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    ids.teacher = t.body.staff.id;
    expect((await call("POST", `/staff/${ids.teacher}/contracts`, owner.accessToken, { contractTypeCode: "CDI", startsOn: "2024-09-01" })).status).toBe(201);
    const inv = await call("POST", `/staff/${ids.teacher}/portal-invitation`, owner.accessToken, {});
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.role).toBe("enseignant");
    await redeemInvitation(p, "prof@alpha.test");
    const teacher = await loginPlain(p, "prof@alpha.test", A.slug);

    // Le modèle système `enseignant` d'rbac n'accorde pas encore `staff.own.*` ni `student.class.read` (demande de
    // changement vers rbac, voir README) : on attribue ici le rôle CIBLE sous forme de rôle personnalisé.
    const role = await p.http("POST", "/api/v1/rbac/roles", {
      token: owner.accessToken,
      body: { key: "enseignant_cible", label: "Enseignant (cible)", permissions: ["staff.own.read", "staff.own.update", "student.class.read"] },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const assigned = await p.http("POST", "/api/v1/rbac/assignments", { token: owner.accessToken, body: { userId: inv.body.identityId, identityId: inv.body.identityId, roleId: role.body.id } });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);

    const me = await call("GET", "/me/staff", teacher.accessToken);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.id).toBe(ids.teacher);
    expect((await call("GET", "/me/contracts", teacher.accessToken)).body.items).toHaveLength(1); // ses propres contrats (lecture auditée)
    expect((await call("PATCH", "/me/staff", teacher.accessToken, { contact: { phone: "+2250700000077" } })).status).toBe(200);
    expect((await call("GET", `/staff/${ids.teacher}/contracts`, teacher.accessToken)).status).toBe(403);
    expect((await call("POST", `/staff/${ids.teacher}/status`, teacher.accessToken, { status: "LEFT", reasonText: "x" })).status).toBe(403);

    // Élèves de SES classes seulement : affectation et inscriptions posées en base (academic n'est pas encore câblé à la plateforme).
    const classA = "0192f0a4-7b1e-7c3a-8d2e-00000000a001";
    const classB = "0192f0a4-7b1e-7c3a-8d2e-00000000b001";
    const year = "0192f0a4-7b1e-7c3a-8d2e-00000000c001";
    const node = "0192f0a4-7b1e-7c3a-8d2e-00000000d001";
    await p.db.admin.query(
      `INSERT INTO people.teaching_assignments (id, tenant_id, staff_id, academic_year_id, classroom_id, curriculum_node_id, role_code, starts_on) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'LEAD', '2020-01-01')`,
      [A.tenantId, ids.teacher, year, classA, node],
    );
    for (const [student, classroom] of [[ids.child, classA], [ids.other, classB]] as const) {
      await p.db.admin.query(
        `INSERT INTO people.student_enrollment_summaries (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, status, enrolled_on, source_event_id, source_occurred_at)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 'Classe', 'ACTIVE', '2020-01-02', gen_random_uuid(), now())`,
        [A.tenantId, student, year, A.institutionId, classroom],
      );
    }
    const mine = await call("GET", "/students", teacher.accessToken);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.items.map((s: { id: string }) => s.id)).toEqual([ids.child]);
    const detail = await call("GET", `/students/${ids.child}`, teacher.accessToken);
    expect(detail.body).toMatchObject({ access: "CLASS", email: null });
    expect((await call("GET", `/students/${ids.other}`, teacher.accessToken)).status).toBe(404);
    expect((await call("GET", "/me/classes", teacher.accessToken)).body.items.map((c: { classroomId: string }) => c.classroomId)).toEqual([classA]);
  });
});

describe("(garde)", () => {
  it("le fichier se charge sans Redis", () => {
    expect(true).toBe(true);
  });
});
