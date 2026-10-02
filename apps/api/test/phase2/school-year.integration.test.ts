/**
 * TEST DE SORTIE DE PHASE 2 — UNE ANNÉE SCOLAIRE SIMULÉE, de bout en bout, sur la plateforme ASSEMBLÉE.
 *
 * Tout passe par HTTP (`app.inject`) avec les VRAIS plugins (legacy + v2), les VRAIS adaptateurs inter-modules
 * (`platform/adapters`) et le VRAI worker en processus (relais d'outbox, abonnés, jobs) sur Postgres + Redis jetables.
 * Les acteurs sont de vrais comptes IAM (invitation, mot de passe, MFA TOTP) portant les rôles SYSTÈME de `rbac`
 * (owner, directeur, responsable_pedagogique, enseignant, parent) : aucun contexte forgé, aucun contournement.
 *
 * Scénario (un tenant du pack HIGHER, un second tenant pour l'isolation) :
 *   (1) console : provisionnement HIGHER, abonnement PROFESSIONAL + HIGHER ; propriétaire (MFA), direction, pédagogie
 *   (2) années et périodes ; programme, matières, curriculum UE/ECUE publié ; classe
 *   (3) élèves et tuteurs ; comptes de portail ; enseignant affecté
 *   (4) inscription ; frais d'inscription facturés puis payés (sandbox, webhook signé) => CONFIRMATION AUTOMATIQUE par événement
 *   (5) emploi du temps : patron récurrent, occurrences, conflit refusé
 *   (6) appels : séance, rejeu hors-ligne idempotent, conflit
 *   (7) évaluations, saisie en lot, workflow DRAFT -> PUBLISHED
 *   (8) clôture de période : résultats `rules` (CI-HIGHER-LMD, rattrapage = REMPLACE, semestre = toutes les UE)
 *   (9) bulletins : snapshot signé, PDF, vérification publique
 *   (10) diplôme et attestation ; (11) paie de l'enseignant ; (12) audit chaîné ; (13) isolation ; (14) accès parent.
 * Les étapes partagent l'état : elles s'exécutent dans l'ordre.
 */
import { createHmac, createPublicKey, verify as edVerify } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeadLetterAdmin } from "../../../worker/src/events/dlq-admin";
import { audit } from "../../src/modules/audit";
import { DEFAULT_SANDBOX_SECRET } from "../../src/modules/finance";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, waitFor } from "../phase1/support/harness";
import { PASSWORD, loginPlain, loginWithMfaEnrollment, provisionByConsole, readAuditLog, redeemInvitation, type ProvisionedOwner } from "../phase1/support/scenario";
import { activatePortalAccount, actorFrom, expectStatus, onboardStaffMember, type Actor } from "./support/actors";
import { startPhase2Platform, type Phase2Env } from "./support/platform";

const day = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number): string => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * day));

/** État partagé du scénario. */
interface World {
  T?: ProvisionedOwner; // tenant principal (HIGHER)
  U?: ProvisionedOwner; // second tenant (isolation)
  owner?: Actor;
  directeur?: Actor;
  pedago?: Actor;
  teacher?: Actor;
  parent?: Actor;
  ownerU?: Actor;
  year: { id?: string; code?: string; startsOn?: string; endsOn?: string };
  periodIds: string[];
  programId?: string;
  gradeLevelId?: string;
  versionId?: string;
  ue: Array<{ id: string; lineageId: string; ecues: Array<{ id: string; lineageId: string; code: string }> }>;
  classroomId?: string;
  students: Array<{ id: string; enrollmentId?: string; lastName: string; personId?: string }>;
  guardianId?: string;
  teacherStaffId?: string;
  teacherPersonId?: string;
  /** Occurrences PASSÉES du cours (plus ancienne d abord). */
  occ: Array<{ id: string; startsAt: string }>;
  signatoryId?: string;
  /** Identifiants de ressources du tenant principal (preuves d isolation). */
  ids: Record<string, string>;
}

describeIntegration.skipIf(!REDIS_URL)("TEST DE SORTIE DE PHASE 2 — une année scolaire simulée, de bout en bout (HIGHER)", () => {
  let p: Phase2Env;
  const W: World = { year: {}, periodIds: [], ue: [], students: [], occ: [], ids: {} };
  const own = (): Actor => W.owner as Actor;
  const T = (): ProvisionedOwner => W.T as ProvisionedOwner;

  beforeAll(async () => {
    p = await startPhase2Platform();
  }, 300_000);
  afterAll(async () => {
    await p?.stop();
  });

  // ===========================================================================================================
  describe("(1) console : provisionnement HIGHER, abonnement, équipe de direction", () => {
    it("la console provisionne le tenant, puis l'abonnement PROFESSIONAL + pack HIGHER (décision métier du 2026-10-01)", async () => {
      W.T = await provisionByConsole(p, { name: "Université Horizon", slug: "horizon", packs: ["HIGHER"], ownerEmail: "owner@horizon.test" });
      const sub = await p.http("PUT", `/api/v1/platform/tenants/${T().tenantId}/subscription`, {
        token: p.operatorToken,
        body: { planKey: "PROFESSIONAL", packs: ["HIGHER"], status: "ACTIVE" },
      });
      expectStatus(sub, 200);
      await redeemInvitation(p, T().ownerEmail);
      const session = await loginWithMfaEnrollment(p, T().ownerEmail, T().slug);
      W.owner = actorFrom(p.http, "owner", T().ownerEmail, session);
      const ent = await own().get("/api/v1/entitlements/me");
      expect(ent.body.tenantId).toBe(T().tenantId);
    });

    it("direction et responsable pédagogique : comptes réels, rôles système, MFA (permissions sensibles)", async () => {
      W.directeur = await onboardStaffMember(p, own(), T().slug, "directeur@horizon.test", "directeur");
      W.pedago = await onboardStaffMember(p, own(), T().slug, "pedagogie@horizon.test", "responsable_pedagogique");
      expect(W.directeur.identityId).not.toBe(own().identityId);
    });
  });

  // ===========================================================================================================
  describe("(2) année, périodes, programme, curriculum UE/ECUE publié, classe", () => {
    it("les référentiels du pack HIGHER sont instanciés par l'événement tenancy.institution.created (worker)", async () => {
      const levels = await waitFor(
        async () => {
          const r = await own().get("/api/v1/academic/reference/grade-levels");
          return (r.body.items as Array<{ code: string }>).some((g) => g.code === "L1") ? r.body.items : false;
        },
        { label: "niveaux du pack HIGHER (L1)", timeoutMs: 45_000 },
      );
      expect(levels.length).toBeGreaterThan(0);
    });

    it("politique de confirmation : ON_REGISTRATION_FEE_PAID (décision métier du 2026-10-01)", async () => {
      const r = await own().put(`/api/v1/academic/institutions/${T().institutionId}/settings`, { enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID", registrationNumberPrefix: "UH", registrationNumberPattern: "{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}" });
      expect(r.body.enrollmentConfirmationPolicy).toBe("ON_REGISTRATION_FEE_PAID");
      expect(r.body.registrationNumberPattern).toBe("{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}");
    });

    it("année académique contenant aujourd'hui, ouverte et courante ; deux semestres, le premier ouvert", async () => {
      const startsOn = addDays(iso(new Date()), -100);
      const code = `${startsOn.slice(0, 4)}-${addDays(startsOn, 364).slice(0, 4)}`;
      const y = await own().post("/api/v1/academic/years", { institutionId: T().institutionId, code, label: "Année simulée", startsOn }, 201);
      W.year = { id: y.body.id, code, startsOn, endsOn: y.body.endsOn };
      await own().post(`/api/v1/academic/years/${W.year.id}/open`);
      await own().post(`/api/v1/academic/years/${W.year.id}/set-current`);
      const plan = await own().post(`/api/v1/academic/years/${W.year.id}/period-plan`, { planCode: "TWO_SEMESTERS" }, 201);
      W.periodIds = (plan.body.items as Array<{ id: string }>).map((x) => x.id);
      expect(W.periodIds).toHaveLength(2);
      await own().post(`/api/v1/academic/periods/${W.periodIds[0]}/open`);
    });

    it("programme INFO (cycle LICENCE), quatre matières, curriculum L1 > S1 > 2 UE × 2 ECUE, publié", async () => {
      const grades = await own().get("/api/v1/academic/reference/grade-levels");
      const levels = await own().get("/api/v1/academic/reference/education-levels");
      const l1 = (grades.body.items as Array<{ id: string; code: string }>).find((g) => g.code === "L1");
      const licence = (levels.body.items as Array<{ id: string; code: string }>).find((l) => l.code === "LICENCE");
      expect(l1 && licence).toBeTruthy();
      W.gradeLevelId = l1!.id;
      const prog = await own().post("/api/v1/academic/programs", { institutionId: T().institutionId, educationLevelId: licence!.id, code: "INFO", label: "Informatique", gradeLevelIds: [l1!.id] }, 201);
      W.programId = prog.body.id;

      const subjects: string[] = [];
      for (const code of ["ALGO", "PROG", "MATH", "STAT"]) {
        subjects.push((await own().post("/api/v1/academic/subjects", { institutionId: T().institutionId, code, label: `Matière ${code}` }, 201)).body.id);
      }
      const version = await own().post("/api/v1/academic/curriculum-versions", { programId: W.programId, academicYearId: W.year.id }, 201);
      W.versionId = version.body.id;
      const node = async (body: Record<string, unknown>): Promise<any> => (await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/nodes`, body, 201)).body;
      const level = await node({ nodeTypeCode: "LEVEL", code: "L1", label: "Licence 1", gradeLevelId: l1!.id });
      const periodNode = await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
      const specs: Array<[string, Array<{ code: string; subject: number; credits: string; coef: string }>]> = [
        ["UE1", [{ code: "E11", subject: 0, credits: "3", coef: "2" }, { code: "E12", subject: 1, credits: "3", coef: "1.5" }]],
        ["UE2", [{ code: "E21", subject: 2, credits: "4", coef: "2" }, { code: "E22", subject: 3, credits: "2", coef: "1" }]],
      ];
      for (const [code, ecues] of specs) {
        const credits = ecues.reduce((n, e) => n + Number(e.credits), 0);
        const ue = await node({ parentId: periodNode.id, nodeTypeCode: "UE", code, label: `UE ${code}`, credits: String(credits) });
        const made: Array<{ id: string; lineageId: string; code: string }> = [];
        for (const e of ecues) {
          const n = await node({ parentId: ue.id, nodeTypeCode: "ECUE", code: e.code, label: `ECUE ${e.code}`, subjectId: subjects[e.subject], credits: e.credits, coefficient: e.coef, resitAllowed: true });
          made.push({ id: n.id, lineageId: n.lineageId, code: e.code });
        }
        W.ue.push({ id: ue.id, lineageId: ue.lineageId, ecues: made });
      }
      const check = await own().get(`/api/v1/academic/curriculum-versions/${W.versionId}/validate`);
      expect(JSON.stringify(check.body)).not.toMatch(/"severity":"error"/);
      const published = await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/publish`);
      expect(published.body.status).toBe("PUBLISHED");
    });

    it("classe L1-A rattachée au curriculum publié, activée", async () => {
      const c = await own().post(
        "/api/v1/academic/classrooms",
        { institutionId: T().institutionId, academicYearId: W.year.id, programId: W.programId, gradeLevelId: W.gradeLevelId, curriculumVersionId: W.versionId, code: "L1-A", name: "Licence 1 A", capacity: 30 },
        201,
      );
      W.classroomId = c.body.id;
      await own().post(`/api/v1/academic/classrooms/${W.classroomId}/activate`, {});
      const got = await own().get(`/api/v1/academic/classrooms/${W.classroomId}`);
      expect(got.body.status).toBe("ACTIVE");
    });
  });

  // ===========================================================================================================
  describe("(3) élèves, tuteurs, comptes de portail, enseignant affecté", () => {
    it("trois étudiants et un tuteur (lié à l'étudiant 2) ; numéro d'ordre attribué", async () => {
      const base = [
        ["ETUDIANT1", "Awa", "F", "2005-01-11"],
        ["ETUDIANT2", "Koffi", "M", "2005-02-12"],
        ["ETUDIANT3", "Mariam", "F", "2005-03-13"],
      ] as const;
      const studentNumbers: string[] = [];
      const sequences: number[] = [];
      for (const [lastName, firstName, sex, birthDate] of base) {
        const r = await own().post("/api/v1/people/students", { person: { lastName, firstName, sex, birthDate, birthPlace: "Abidjan" } }, 201);
        W.students.push({ id: r.body.student.id, lastName, personId: r.body.student.personId });
        studentNumbers.push(r.body.student.studentNumber);
        sequences.push(r.body.student.sequenceNumber);
      }
      // Numéro d'élève et numéro d'ordre : attribués, uniques, croissants (sans trou).
      expect(new Set(studentNumbers).size).toBe(3);
      expect(sequences).toEqual([sequences[0], sequences[0]! + 1, sequences[0]! + 2]);
      const g = await own().post("/api/v1/people/guardians", { person: { lastName: "TUTEUR", firstName: "Yao", sex: "M", email: "tuteur@horizon.test", phone: "+225 07 11 22 33 44" } }, 201);
      W.guardianId = g.body.guardian.id;
      const rel = await own().get("/api/v1/people/reference/relationship-types");
      const relationshipCode = (rel.body.items as Array<{ code: string }>)[0]?.code as string;
      expect(relationshipCode).toBeTruthy();
      await own().post(`/api/v1/people/students/${W.students[1]!.id}/guardians`, { guardianId: W.guardianId, relationshipCode, isPrimaryContact: true, isFinancialResponsible: true, hasLegalCustody: true, portalAccess: true }, 201);
    });

    it("doublon probable : refusé tant qu'il n'est pas confirmé avec un motif (un dossier élève n'est jamais dupliqué par erreur)", async () => {
      const same = { person: { lastName: "ETUDIANT1", firstName: "Awa", sex: "F", birthDate: "2005-01-11", birthPlace: "Abidjan" } };
      const refused = await own().raw("POST", "/api/v1/people/students", same);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.code).toBe("people.possible_duplicate");
      const students = await p.db.admin.query("SELECT count(*)::int AS n FROM people.students WHERE tenant_id = $1", [T().tenantId]);
      expect(students.rows[0].n).toBe(3);
    });

    it("enseignant : fiche de personnel, invitation de portail (rôle système enseignant), compte lié à la fiche", async () => {
      const cats = await own().get("/api/v1/people/reference/staff-categories");
      const teacherCat = (cats.body.items as Array<{ code: string; canTeach: boolean }>).find((c) => c.canTeach);
      expect(teacherCat, "catégorie de personnel enseignant").toBeDefined();
      const s = await own().post("/api/v1/people/staff", { person: { lastName: "ENSEIGNANT", firstName: "Issa", sex: "M", birthDate: "1985-04-04", email: "enseignant@horizon.test" }, categoryCode: teacherCat!.code, hiredOn: "2020-09-01" }, 201);
      W.teacherStaffId = s.body.staff?.id ?? s.body.id;
      W.teacherPersonId = s.body.staff?.personId ?? s.body.personId;
      const inv = await own().post(`/api/v1/people/staff/${W.teacherStaffId}/portal-invitation`, { role: "enseignant" }, [200, 201]);
      expect(inv.body.invited).toBe(true);
      W.teacher = await activatePortalAccount(p, T().slug, "enseignant@horizon.test", "enseignant");
      await own().post(
        "/api/v1/people/teaching-assignments",
        { staffId: W.teacherStaffId, academicYearId: W.year.id, classroomId: W.classroomId, roleCode: "LEAD", coversAllSubjects: true, startsOn: W.year.startsOn },
        201,
      );
      const me = await W.teacher.get("/api/v1/people/me/staff");
      expect(me.body.id ?? me.body.staff?.id).toBe(W.teacherStaffId);
    });

    it("tuteur : invitation de portail (rôle parent), compte actif", async () => {
      const g = await own().get(`/api/v1/people/guardians/${W.guardianId}`);
      const inv = await own().post(`/api/v1/people/persons/${g.body.personId}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201]);
      expect(inv.body.invited).toBe(true);
      W.parent = await activatePortalAccount(p, T().slug, "tuteur@horizon.test", "parent");
    });
  });

  // ===========================================================================================================
  describe("(4) inscription, frais d'inscription payés (sandbox, webhook signé) => CONFIRMATION AUTOMATIQUE par événement", () => {
    let invoiceId: string;
    let paymentId: string;
    let providerRef: string;
    const sign = (raw: string): string => createHmac("sha256", DEFAULT_SANDBOX_SECRET).update(raw, "utf8").digest("hex");
    const statusOf = async (enrollmentId: string): Promise<string> => (await own().get(`/api/v1/academic/enrollments/${enrollmentId}`)).body.enrollment.status as string;

    it("barème : frais d'inscription (catégorie REGISTRATION) 50 000 XOF pour l'année", async () => {
      const fee = await own().post("/api/v1/finance/fees", { code: "INSC", name: "Frais d'inscription", category: "REGISTRATION" }, 201);
      await own().post("/api/v1/finance/fee-schedules", { feeId: fee.body.id, academicYear: W.year.code, amount: 50000, effectiveFrom: "2020-01-01" }, 201);
    });

    it("l'inscription reste EN ATTENTE tant que les frais ne sont pas payés (sonde finance -> academic)", async () => {
      const numbers: string[] = [];
      for (const s of W.students) {
        const e = await own().post("/api/v1/academic/enrollments", { studentId: s.id, classroomId: W.classroomId, enrolledOn: W.year.startsOn }, 201);
        s.enrollmentId = e.body.id;
        expect(e.body.status, JSON.stringify(e.body)).toBe("PENDING");
        numbers.push(e.body.registrationNumber);
      }
      // Numéro d'inscription généré par le motif de l'établissement (préfixe, programme, niveau, rang de l'élève) : un par élève.
      expect(numbers.every((n) => /^UH-INFO-L1-\d{4}$/.test(n)), numbers.join(",")).toBe(true);
      expect(new Set(numbers).size).toBe(3);
    });

    it("facture des frais d'inscription de l'étudiant 1 (liée à l'inscription), émise", async () => {
      const s = W.students[0]!;
      const r = await own().post(
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: s.id, enrollmentId: s.enrollmentId, academicYear: W.year.code, items: [{ feeCode: "INSC" }], issue: true },
        [200, 201],
        { "idempotency-key": "p2-inv-etu1" },
      );
      const inv = r.body.invoices[0];
      invoiceId = inv.id;
      W.ids.invoice = inv.id;
      expect(inv.total.amount).toBe(50000);
      expect(inv.status).toBe("ISSUED");
      expect(await statusOf(s.enrollmentId!)).toBe("PENDING");
    });

    it("paiement en ligne (sandbox, en attente) puis webhook SIGNÉ : facture soldée, reçu, inscription CONFIRMÉE par événement", async () => {
      const s = W.students[0]!;
      const init = await own().post(
        "/api/v1/finance/payments/online",
        { learnerId: s.id, enrollmentId: s.enrollmentId, amount: 50000, provider: "sandbox", invoiceId, metadata: { sandbox: "pending" } },
        201,
        { "idempotency-key": "p2-pay-etu1" },
      );
      paymentId = init.body.payment.id;
      W.ids.payment = init.body.payment.id;
      providerRef = init.body.payment.providerRef;
      expect(init.body.payment.status).toBe("PENDING");
      expect(await statusOf(s.enrollmentId!)).toBe("PENDING");

      const raw = JSON.stringify({ id: "evt-p2-0001", type: "payment.succeeded", reference: paymentId, transaction: providerRef, amount: 50000, currency: "XOF", occurred_at: new Date().toISOString() });
      const hook = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${T().tenantId}`, { rawBody: raw, headers: { "x-sandbox-signature": sign(raw) } });
      expectStatus(hook, 200);
      expect(hook.body).toMatchObject({ status: "PROCESSED", replayed: false, paymentId });
      expect((await own().get(`/api/v1/finance/invoices/${invoiceId}`)).body.status).toBe("PAID");
      expect((await own().get(`/api/v1/finance/payments/${paymentId}/receipt`)).body.number).toMatch(/^REC-\d{4}-\d{6}$/);

      // La confirmation arrive par l'événement `finance.invoice.paid` (relais d'outbox -> abonné `academic.confirm-on-invoice-paid`).
      await waitFor(async () => (await statusOf(s.enrollmentId!)) === "ACTIVE", { label: "inscription de l'étudiant 1 confirmée par l'événement de paiement", timeoutMs: 45_000 });
    });

    it("la confirmation ne s'étend PAS aux autres inscriptions (jamais en bloc) ; elles sont soldées par virement à leur tour", async () => {
      expect(await statusOf(W.students[1]!.enrollmentId!)).toBe("PENDING");
      expect(await statusOf(W.students[2]!.enrollmentId!)).toBe("PENDING");
      for (const [i, s] of [W.students[1]!, W.students[2]!].entries()) {
        const inv = await own().post(
          "/api/v1/finance/invoices/from-schedule",
          { learnerId: s.id, enrollmentId: s.enrollmentId, academicYear: W.year.code, items: [{ feeCode: "INSC" }], issue: true },
          [200, 201],
          { "idempotency-key": `p2-inv-etu${i + 2}` },
        );
        const pay = await own().post(
          "/api/v1/finance/payments",
          { learnerId: s.id, enrollmentId: s.enrollmentId, amount: 50000, method: "TRANSFER", reference: `VIR-${i + 2}`, allocation: { mode: "AUTO", invoiceIds: [inv.body.invoices[0].id] } },
          [200, 201],
          { "idempotency-key": `p2-vir-etu${i + 2}` },
        );
        expect(pay.body.payment.status).toBe("CONFIRMED");
        await waitFor(async () => (await statusOf(s.enrollmentId!)) === "ACTIVE", { label: `inscription de l'étudiant ${i + 2} confirmée`, timeoutMs: 45_000 });
      }
      const roster = await own().get(`/api/v1/academic/classrooms/${W.classroomId}/roster`);
      expect(JSON.stringify(roster.body)).toContain(W.students[0]!.enrollmentId);
    });

    it("IDEMPOTENCE ET CONCURRENCE : même clé = même facture (autre contenu refusé) ; cinq webhooks identiques SIMULTANÉS = un seul paiement, un seul reçu", async () => {
      const s5 = await own().post("/api/v1/people/students", { person: { lastName: "ETUDIANT5", firstName: "Nadia", sex: "F", birthDate: "2005-05-05" } }, 201);
      const learnerId = s5.body.student.id as string;
      const body = { learnerId, academicYear: W.year.code, items: [{ feeCode: "INSC" }], issue: true };
      const first = await own().post("/api/v1/finance/invoices/from-schedule", body, [200, 201], { "idempotency-key": "p2-idem-etu5" });
      const replay = await own().post("/api/v1/finance/invoices/from-schedule", body, [200, 201], { "idempotency-key": "p2-idem-etu5" });
      expect(replay.body.invoices[0].id).toBe(first.body.invoices[0].id);
      const other = await own().raw("POST", "/api/v1/finance/invoices/from-schedule", { ...body, items: [{ feeCode: "INSC", quantity: 2 }] }, { "idempotency-key": "p2-idem-etu5" });
      expect(other.status, JSON.stringify(other.body)).toBeGreaterThanOrEqual(400);
      expect(other.status).toBeLessThan(500);
      const invoices = await p.db.admin.query("SELECT count(*)::int AS n FROM finance.invoices WHERE tenant_id = $1 AND learner_id = $2", [T().tenantId, learnerId]);
      expect(invoices.rows[0].n).toBe(1);

      const init = await own().post(
        "/api/v1/finance/payments/online",
        { learnerId, amount: 50000, provider: "sandbox", invoiceId: first.body.invoices[0].id, metadata: { sandbox: "pending" } },
        201,
        { "idempotency-key": "p2-pay-etu5" },
      );
      const raw = JSON.stringify({ id: "evt-p2-concurrent", type: "payment.succeeded", reference: init.body.payment.id, transaction: init.body.payment.providerRef, amount: 50000, currency: "XOF", occurred_at: new Date().toISOString() });
      const hooks = await Promise.all(
        Array.from({ length: 5 }, () => p.http("POST", `/api/v1/finance/webhooks/sandbox/${T().tenantId}`, { rawBody: raw, headers: { "x-sandbox-signature": sign(raw) } })),
      );
      expect(hooks.map((h) => h.status), JSON.stringify(hooks.map((h) => h.body))).toEqual([200, 200, 200, 200, 200]);
      expect(hooks.filter((h) => h.body.replayed === false)).toHaveLength(1);
      const receipts = await p.db.admin.query("SELECT count(*)::int AS n FROM finance.receipts WHERE tenant_id = $1 AND payment_id = $2", [T().tenantId, init.body.payment.id]);
      expect(receipts.rows[0].n).toBe(1);
      expect((await own().get(`/api/v1/finance/invoices/${first.body.invoices[0].id}`)).body.status).toBe("PAID");
    });
  });

  // ===========================================================================================================
  describe("(5) emploi du temps : patron récurrent, occurrences générées, conflit refusé", () => {
    const today = iso(new Date());
    const weekdayOf = (d: string): number => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // ISO : lundi = 1
    let timetableId: string;
    let entryId: string;
    const lessonWeekday = weekdayOf(addDays(today, -14));
    const lessonDates: string[] = [];

    it("emploi du temps du semestre : un cours hebdomadaire (ALGO, 08:00-10:00) animé par l'enseignant, publié", async () => {
      const tt = await own().post(
        "/api/v1/scheduling/timetables",
        { institutionId: T().institutionId, academicYearId: W.year.id, name: "Semestre 1 — L1-A", validFrom: W.year.startsOn, validTo: addDays(W.year.startsOn!, 180) },
        201,
      );
      timetableId = tt.body.id;
      const e = await own().post(
        `/api/v1/scheduling/timetables/${timetableId}/entries`,
        { classroomId: W.classroomId, curriculumNodeId: W.ue[0]!.ecues[0]!.id, weekday: lessonWeekday, startTime: "08:00", endTime: "10:00", staff: [{ staffId: W.teacherStaffId, role: "LEAD" }], title: "Algorithmique" },
        201,
      );
      entryId = e.body.entry.id;
      expect(e.body.conflicts).toEqual([]);
      const pub = await own().post(`/api/v1/scheduling/timetables/${timetableId}/publish`);
      expect(pub.body.status).toBe("PUBLISHED");
    });

    it("génération IDEMPOTENTE des occurrences datées (feature scheduling.generation) : un second passage ne crée rien", async () => {
      const body = { from: addDays(today, -30), to: addDays(today, 14) };
      const first = await own().post(`/api/v1/scheduling/timetables/${timetableId}/generate`, body);
      expect(first.body.created ?? first.body.createdCount ?? 0, JSON.stringify(first.body)).toBeGreaterThanOrEqual(5);
      const second = await own().post(`/api/v1/scheduling/timetables/${timetableId}/generate`, body);
      expect(second.body.created ?? second.body.createdCount ?? 0, JSON.stringify(second.body)).toBe(0);
      const list = await own().get(`/api/v1/scheduling/occurrences?classroomId=${W.classroomId}&from=${addDays(today, -30)}&to=${addDays(today, 14)}&limit=100`);
      const items = list.body.items as Array<{ id: string; date?: string; startsAt: string; status: string }>;
      expect(items.length).toBeGreaterThanOrEqual(5);
      expect(new Set(items.map((o) => o.startsAt)).size).toBe(items.length); // pas de doublon
      for (const o of items) lessonDates.push(o.startsAt.slice(0, 10));
      W.occ = items
        .filter((o) => Date.parse(o.startsAt) < Date.now() - 3 * 3_600_000)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((o) => ({ id: o.id, startsAt: o.startsAt }));
      expect(W.occ.length).toBeGreaterThanOrEqual(3);
      expect(items.every((o) => o.status === "PLANNED")).toBe(true);
    });

    it("un cours qui chevauche le premier (même classe, même enseignant) est REFUSÉ (409 : conflit imposé)", async () => {
      const res = await own().raw("POST", `/api/v1/scheduling/timetables/${timetableId}/entries`, {
        classroomId: W.classroomId,
        curriculumNodeId: W.ue[0]!.ecues[1]!.id,
        weekday: lessonWeekday,
        startTime: "09:00",
        endTime: "11:00",
        staff: [{ staffId: W.teacherStaffId, role: "LEAD" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(JSON.stringify(res.body)).toMatch(/conflict/i);
      // L'enseignant ne peut pas non plus être placé deux fois sur le même créneau d'un jour précis par une séance isolée.
      const day = lessonDates[0] as string;
      const adhoc = await own().raw("POST", "/api/v1/scheduling/occurrences", {
        kind: "LESSON",
        classroomId: W.classroomId,
        curriculumNodeId: W.ue[0]!.ecues[1]!.id,
        date: day,
        startTime: "09:00",
        endTime: "10:00",
        staff: [{ staffId: W.teacherStaffId }],
      });
      expect(adhoc.status, JSON.stringify(adhoc.body)).toBe(409);
    });
  });

  // ===========================================================================================================
  describe("(6) appels : séance, soumission, validation, rejeu hors-ligne idempotent, conflit", () => {
    const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;
    let sessionId: string;
    let offlineSessionId: string;
    let syncBatch: Record<string, unknown>;
    const teacher = (): Actor => W.teacher as Actor;
    const dir = (): Actor => W.directeur as Actor;

    it("l'enseignant ouvre l'appel d'une séance PASSÉE, pointe présent / absent / en retard, soumet", async () => {
      const opened = await teacher().post("/api/v1/attendance/sessions", { occurrenceId: W.occ[0]!.id }, [200, 201]);
      sessionId = opened.body.session.id;
      W.ids.attendanceSession = opened.body.session.id;
      expect(opened.body.session.status).toBe("OPEN");
      expect(opened.body.session.occurrenceId).toBe(W.occ[0]!.id);
      const marked = await teacher().put(`/api/v1/attendance/sessions/${sessionId}/records`, {
        entries: [
          { studentId: W.students[0]!.id, statusCode: "PRESENT" },
          { studentId: W.students[1]!.id, statusCode: "ABSENT" },
          { studentId: W.students[2]!.id, statusCode: "LATE", minutesLate: 10 },
        ],
      });
      expect(marked.body.created).toBe(3);
      // rejeu du même lot : aucun changement (idempotent)
      const again = await teacher().put(`/api/v1/attendance/sessions/${sessionId}/records`, { entries: [{ studentId: W.students[0]!.id, statusCode: "PRESENT" }] });
      expect(again.body.unchanged).toBe(1);
      const submitted = await teacher().post(`/api/v1/attendance/sessions/${sessionId}/submit`, {});
      expect(submitted.body.session.status).toBe("SUBMITTED");
      expect(submitted.body.absentCount).toBe(1);
      expect(submitted.body.lateCount).toBe(1);
      expect((await teacher().post(`/api/v1/attendance/sessions/${sessionId}/submit`, {})).body.alreadySubmitted).toBe(true);
    });

    it("la direction valide l'appel (séparation : l'enseignant ne le peut pas)", async () => {
      const denied = await teacher().raw("POST", `/api/v1/attendance/sessions/${sessionId}/validate`, {});
      expect(denied.status).toBe(403);
      const validated = await dir().post(`/api/v1/attendance/sessions/${sessionId}/validate`, {});
      expect(validated.body.status).toBe("VALIDATED");
    });

    it("l'appel soumis marque la séance du patron « réalisée » par l'événement (abonné scheduling.hold-on-attendance)", async () => {
      await waitFor(async () => (await own().get(`/api/v1/scheduling/occurrences/${W.occ[0]!.id}`)).body.status === "HELD", { label: "séance passée à HELD par l'appel", timeoutMs: 45_000 });
    });

    it("hors-ligne : un lot synchronisé crée l'appel d'une 2e séance ; son REJEU est idempotent (aucun doublon)", async () => {
      syncBatch = {
        deviceId: "tablette-salle-12",
        clientSentAt: new Date().toISOString(),
        sessions: [
          {
            clientId: uuid(900),
            target: { occurrenceId: W.occ[1]!.id },
            clientOpenedAt: new Date(Date.now() - 60_000).toISOString(),
            submit: {},
            records: [
              { clientId: uuid(901), studentId: W.students[0]!.id, statusCode: "PRESENT", clientMarkedAt: new Date(Date.now() - 50_000).toISOString() },
              { clientId: uuid(902), studentId: W.students[1]!.id, statusCode: "PRESENT", clientMarkedAt: new Date(Date.now() - 49_000).toISOString() },
              { clientId: uuid(903), studentId: W.students[2]!.id, statusCode: "ABSENT", clientMarkedAt: new Date(Date.now() - 48_000).toISOString() },
            ],
          },
        ],
      };
      const first = await teacher().post("/api/v1/attendance/sync", syncBatch, [200, 201]);
      expect(first.body.totals).toMatchObject({ applied: 3, conflicts: 0, rejected: 0 });
      offlineSessionId = first.body.sessions[0].sessionId;
      expect(first.body.sessions[0].submitted).toBe(true);

      const replay = await teacher().post("/api/v1/attendance/sync", syncBatch, [200, 201]);
      expect(replay.body.totals).toMatchObject({ applied: 0, replayed: 3, conflicts: 0, rejected: 0 });
      expect(replay.body.sessions[0]).toMatchObject({ outcome: "REPLAYED", sessionId: offlineSessionId });
      const sessions = await dir().get(`/api/v1/attendance/sessions?classroomId=${W.classroomId}`);
      expect((sessions.body.items as Array<{ occurrenceId: string }>).filter((s) => s.occurrenceId === W.occ[1]!.id)).toHaveLength(1);
      const records = await p.db.admin.query("SELECT count(*)::int AS n FROM attendance.student_records WHERE tenant_id = $1 AND session_id = $2", [T().tenantId, offlineSessionId]);
      expect(records.rows[0].n).toBe(3);
    });

    it("un clientId réutilisé avec un AUTRE contenu est refusé (attendance.idempotency_key_reused)", async () => {
      const tampered = JSON.parse(JSON.stringify(syncBatch));
      tampered.sessions[0].records[0].statusCode = "ABSENT";
      const res = await teacher().raw("POST", "/api/v1/attendance/sync", tampered);
      expect(JSON.stringify(res.body), String(res.status)).toMatch(/idempotency_key_reused/);
    });

    it("CONCURRENCE : le même lot envoyé deux fois SIMULTANÉMENT (double envoi du réseau) ne crée qu'un appel et trois pointages", async () => {
      const batch = {
        deviceId: "tablette-salle-13",
        clientSentAt: new Date().toISOString(),
        sessions: [
          {
            clientId: uuid(920),
            target: { occurrenceId: W.occ[2]!.id },
            clientOpenedAt: new Date(Date.now() - 60_000).toISOString(),
            records: W.students.map((s, i) => ({ clientId: uuid(921 + i), studentId: s.id, statusCode: "PRESENT", clientMarkedAt: new Date(Date.now() - 50_000 + i).toISOString() })),
          },
        ],
      };
      const [a, b] = await Promise.all([teacher().raw("POST", "/api/v1/attendance/sync", batch), teacher().raw("POST", "/api/v1/attendance/sync", batch)]);
      expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
      const totals = [a.body.totals, b.body.totals];
      expect(totals.reduce((n, t) => n + t.applied, 0), JSON.stringify(totals)).toBe(3);
      expect(totals.reduce((n, t) => n + t.rejected + t.conflicts, 0), JSON.stringify(totals)).toBe(0);
      const rows = await p.db.admin.query(
        "SELECT count(DISTINCT s.id)::int AS sessions, count(r.id)::int AS records FROM attendance.sessions s LEFT JOIN attendance.student_records r ON r.session_id = s.id WHERE s.tenant_id = $1 AND s.occurrence_id = $2",
        [T().tenantId, W.occ[2]!.id],
      );
      expect(rows.rows[0]).toEqual({ sessions: 1, records: 3 });
    });

    it("conflit : une saisie hors-ligne tardive sur l'appel déjà VALIDÉ n'est jamais écrite en silence (file de conflits)", async () => {
      const late = {
        deviceId: "tablette-salle-12",
        clientSentAt: new Date().toISOString(),
        sessions: [
          {
            clientId: uuid(910),
            target: { occurrenceId: W.occ[0]!.id },
            clientOpenedAt: new Date(Date.now() - 120_000).toISOString(),
            records: [{ clientId: uuid(911), studentId: W.students[1]!.id, statusCode: "PRESENT", clientMarkedAt: new Date(Date.now() - 100_000).toISOString() }],
          },
        ],
      };
      const res = await teacher().post("/api/v1/attendance/sync", late, [200, 201]);
      expect(res.body.totals.conflicts, JSON.stringify(res.body)).toBe(1);
      const queue = await dir().get(`/api/v1/attendance/sync/conflicts?status=OPEN&sessionId=${sessionId}`);
      expect(queue.body.items).toHaveLength(1);
      expect(queue.body.items[0].kind).toBe("SESSION_LOCKED");
      // L'absent reste absent.
      const rec = await p.db.admin.query(
        `SELECT status_code FROM attendance.student_records WHERE tenant_id = $1 AND session_id = $2 AND student_id = $3`,
        [T().tenantId, sessionId, W.students[1]!.id],
      );
      expect(rec.rows[0].status_code).toBe("ABSENT");
      const resolved = await dir().post(`/api/v1/attendance/sync/conflicts/${queue.body.items[0].id}/resolve`, { resolution: "KEEP_EXISTING", note: "Appel déjà validé par la direction" });
      expect(resolved.status).toBeLessThan(300);
    });

    it("le récapitulatif de présence de l'étudiant 2 compte son absence ; l'appel hors-ligne est validé par la direction", async () => {
      await dir().post(`/api/v1/attendance/sessions/${offlineSessionId}/validate`, {});
      const s = await dir().get(`/api/v1/attendance/enrollments/${W.students[1]!.enrollmentId}/summary?periodId=${W.periodIds[0]}`);
      expect(JSON.stringify(s.body)).toMatch(/absent/i);
    });
  });

  // ===========================================================================================================
  describe("(7) évaluations, saisie de notes en lot, circuit DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED", () => {
    const types: Record<string, string> = {};
    const assessmentIds: string[] = [];
    const metaOf = new Map<string, { code: string; type: string }>();
    const teacher = (): Actor => W.teacher as Actor;
    const pedago = (): Actor => W.pedago as Actor;
    const dir = (): Actor => W.directeur as Actor;
    /**
     * Notes par ECUE (E11, E12, E21, E22) : [devoir, examen] pour les étudiants 1, 2, 3.
     *  - étudiant 1 : 15 partout (toutes les UE validées) ;
     *  - étudiant 2 : UE1 à 18, UE2 à 9 => moyenne du semestre 13,5 MAIS une UE non validée : semestre NON validé (aucune compensation) ;
     *  - étudiant 3 : 8 partout et absent à l'examen de E11.
     */
    const GRID: Record<string, { devoir: Array<string | null>; examen: Array<string | null> }> = {
      E11: { devoir: ["15", "18", "8"], examen: ["15", "18", null] },
      E12: { devoir: ["15", "18", "8"], examen: ["15", "18", "8"] },
      E21: { devoir: ["15", "9", "8"], examen: ["15", "9", "8"] },
      E22: { devoir: ["15", "9", "8"], examen: ["15", "9", "8"] },
    };
    const ecueIdOf = (code: string): string => W.ue.flatMap((u) => u.ecues).find((e) => e.code === code)!.id;
    const gradesBody = (scores: Array<string | null>) => ({
      entries: W.students.map((s, i) => (scores[i] == null ? { enrollmentId: s.enrollmentId, entryStatus: "ABSENT_UNEXCUSED" } : { enrollmentId: s.enrollmentId, score: scores[i] })),
    });

    it("les types d'évaluation du pack HIGHER sont créés par l'événement de provisionnement (abonné assess.seed-assessment-types)", async () => {
      const items = await waitFor(
        async () => {
          const r = await teacher().get("/api/v1/assess/assessment-types");
          return (r.body.items as Array<{ code: string }>).length > 0 ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "types d'évaluation", timeoutMs: 45_000 },
      );
      for (const t of items) types[t.code] = t.id;
      expect(types.DEVOIR && types.EXAMEN).toBeTruthy();
    });

    it("création en lot : un devoir et un examen par ECUE (8 évaluations), par l'enseignant AFFECTÉ", async () => {
      const periods = await own().get(`/api/v1/academic/years/${W.year.id}/periods`);
      const s1 = (periods.body.items as Array<{ id: string; startsOn: string }>).find((x) => x.id === W.periodIds[0])!;
      const assessedOn = addDays(s1.startsOn, 10);
      for (const code of ["DEVOIR", "EXAMEN"]) {
        const r = await teacher().post(
          "/api/v1/assess/assessments/bulk",
          {
            typeId: types[code],
            academicPeriodId: W.periodIds[0],
            title: `${code} S1`,
            assessedOn,
            targets: Object.keys(GRID).map((c) => ({ classroomId: W.classroomId, curriculumNodeId: ecueIdOf(c) })),
          },
          201,
        );
        expect(r.body.items).toHaveLength(4);
        for (const it of r.body.items as Array<{ id: string; curriculumNodeId: string; typeCode: string; status: string }>) {
          expect(it.status).toBe("DRAFT");
          assessmentIds.push(it.id);
          metaOf.set(it.id, { code: Object.keys(GRID).find((c) => ecueIdOf(c) === it.curriculumNodeId) as string, type: code });
        }
      }
      expect(assessmentIds).toHaveLength(8);
      W.ids.assessment = assessmentIds[0]!;
    });

    it("séparation des tâches : l'enseignant ne publie pas, le responsable pédagogique ne saisit pas", async () => {
      const id = assessmentIds[0]!;
      expect((await teacher().raw("POST", `/api/v1/assess/assessments/${id}/transitions`, { to: "PUBLISHED" })).status).toBe(403);
      expect((await pedago().raw("PUT", `/api/v1/assess/assessments/${id}/grades`, gradesBody(["10", "10", "10"]))).status).toBe(403);
    });

    it("saisie en lot (idempotente), soumission, relecture, validation (MFA), publication (direction)", async () => {
      for (const id of assessmentIds) {
        const meta = metaOf.get(id) as { code: string; type: string };
        const scores = meta.type === "DEVOIR" ? GRID[meta.code]!.devoir : GRID[meta.code]!.examen;
        const saved = await teacher().put(`/api/v1/assess/assessments/${id}/grades`, gradesBody(scores), 200, { "idempotency-key": `p2-grades-${id}` });
        expect(saved.body.created).toBe(3);
        const replay = await teacher().put(`/api/v1/assess/assessments/${id}/grades`, gradesBody(scores), 200, { "idempotency-key": `p2-grades-${id}` });
        expect(replay.body.replayed).toBe(true);
        await teacher().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "SUBMITTED" });
        await pedago().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "REVIEWED" });
        await pedago().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "APPROVED" });
        const pub = await dir().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "PUBLISHED" });
        expect(pub.body.assessment.status).toBe("PUBLISHED");
      }
    });

    it("une note publiée est IMMUABLE : plus de saisie directe, même par l'enseignant propriétaire", async () => {
      const id = assessmentIds[0]!;
      const res = await teacher().raw("PUT", `/api/v1/assess/assessments/${id}/grades`, gradesBody(["20", "20", "20"]));
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      const sheet = await dir().get(`/api/v1/assess/assessments/${id}/grades`);
      expect(sheet.body.assessment.status).toBe("PUBLISHED");
    });
  });

  // ===========================================================================================================
  describe("(8) clôture de période : résultats calculés par `rules` (CI-HIGHER-LMD) — semestre validé = TOUTES les UE", () => {
    const dir = (): Actor => W.directeur as Actor;
    const closure: { stateId?: string; hash?: string; version?: number } = {};
    const ctxPath = (): string => `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`;

    it("le tenant lie le contrat de calcul à crédits au jeu de règles national CI-HIGHER-LMD ; pas de délibération requise", async () => {
      const catalog = await own().get("/api/v1/rules/rule-sets");
      expect(JSON.stringify(catalog.body)).toContain("CI-HIGHER-LMD");
      const b = await own().put("/api/v1/rules/bindings", { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      expect(b.body.ruleSetCode).toBe("CI-HIGHER-LMD");
      await own().put("/api/v1/results/settings", { requireDeliberation: false });
    });

    it("verrouillage des notes (toutes les évaluations sont publiées) puis CLÔTURE par la direction : résultats FINAL", async () => {
      const locked = await dir().post(`${ctxPath()}/lock`, {});
      expect(locked.body.status).toBe("GRADING_LOCKED");
      const closed = await dir().post(`${ctxPath()}/close`, {});
      expect(closed.body.state.status).toBe("CLOSED");
      expect(closed.body.resultsCount).toBe(3);
      expect(closed.body.closureHash).toMatch(/^[0-9a-f]{64}$/);
      closure.stateId = closed.body.state.id;
      closure.hash = closed.body.closureHash;
      closure.version = closed.body.resultsVersion;
    });

    it("les règles ont tranché : étudiant 1 ADMIS ; étudiant 2 — moyenne de semestre ≥ 10 mais UE2 non validée => semestre NON validé, rattrapage", async () => {
      const rows = await p.db.admin.query(
        `SELECT enrollment_id, contract_id, rule_set_code, validated, decision_outcome, average::text AS average, credits_acquired::text AS credits_acquired, credits_required::text AS credits_required
           FROM results.period_results
          WHERE tenant_id = $1 AND scope = 'PERIOD' AND academic_period_id = $2 AND status = 'FINAL'`,
        [T().tenantId, W.periodIds[0]],
      );
      expect(rows.rows).toHaveLength(3);
      expect(new Set(rows.rows.map((r) => r.contract_id))).toEqual(new Set(["credit-semester@1"]));
      expect(new Set(rows.rows.map((r) => r.rule_set_code))).toEqual(new Set(["CI-HIGHER-LMD"]));
      const of = (i: number) => rows.rows.find((r) => r.enrollment_id === W.students[i]!.enrollmentId);
      // Étudiant 1 : 15 partout -> les deux UE validées, semestre ADMIS (12 crédits sur 12).
      expect(of(0)).toMatchObject({ validated: true, decision_outcome: "ADMITTED", average: "15", credits_acquired: "12.00", credits_required: "12.00" });
      // Étudiant 2 : 18 en UE1 et 9 en UE2 = moyenne 13,5 (>= 10) MAIS UE2 non validée : PAS de compensation, semestre non validé (rattrapage ouvert, les ECUE le permettent).
      expect(of(1)).toMatchObject({ validated: false, decision_outcome: "RESIT", average: "13.5", credits_acquired: "6.00", credits_required: "12.00" });
      expect(Number(of(1)!.average)).toBeGreaterThanOrEqual(10);
      // Étudiant 3 : 8 partout (absent à un examen) : rien de validé.
      expect(of(2)).toMatchObject({ validated: false, decision_outcome: "RESIT", average: "8", credits_acquired: "0.00" });
      // La lecture HTTP des résultats donne la même chose, avec la version de règle épinglée.
      const detail = await dir().get(`/api/v1/results/enrollments/${W.students[1]!.enrollmentId}/periods/${W.periodIds[0]}`);
      expect(detail.body.header).toMatchObject({ status: "FINAL", ruleSetCode: "CI-HIGHER-LMD", contractId: "credit-semester@1", validated: false });
      expect(detail.body.header.inputsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(detail.body.header.outputsHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ===========================================================================================================
  describe("(8b) capitalisation des crédits (événement results.period.closed) ; rattrapage : la session 2 REMPLACE la session 1", () => {
    const dir = (): Actor => W.directeur as Actor;
    const teacher = (): Actor => W.teacher as Actor;
    const pedago = (): Actor => W.pedago as Actor;
    const ctxPath = (): string => `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`;
    const ecue = (code: string): string => W.ue.flatMap((u) => u.ecues).find((e) => e.code === code)!.id;
    const lineage = (code: string): string => W.ue.flatMap((u) => u.ecues).find((e) => e.code === code)!.lineageId;
    const lineOf = async (studentIdx: number, code: string): Promise<any> => {
      const r = await dir().get(`/api/v1/results/enrollments/${W.students[studentIdx]!.enrollmentId}/periods/${W.periodIds[0]}`);
      return { header: r.body.header, line: (r.body.lines as any[]).find((l) => l.curriculumNodeId === ecue(code)), ue: r.body.lines.filter((l: any) => l.level === "UE") };
    };
    let windowId: string;

    it("`higher` capitalise les UE validées dans le registre de crédits, par lignée : 2 + 1 + 0 acquisitions", async () => {
      await waitFor(
        async () => {
          const r = await p.db.admin.query("SELECT count(*)::int AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED'", [T().tenantId]);
          return r.rows[0].n === 3;
        },
        { label: "crédits capitalisés par l'abonné higher", timeoutMs: 45_000 },
      );
      const rows = await p.db.admin.query("SELECT student_id, count(*)::int AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED' GROUP BY student_id", [T().tenantId]);
      const byStudent = new Map<string, number>(rows.rows.map((r) => [r.student_id as string, r.n as number]));
      expect(byStudent.get(W.students[0]!.id)).toBe(2);
      expect(byStudent.get(W.students[1]!.id)).toBe(1); // UE1 seulement : aucune compensation de UE2
      expect(byStudent.get(W.students[2]!.id)).toBeUndefined();
      const credits = await dir().get(`/api/v1/higher/students/${W.students[0]!.id}/credits`);
      expect(JSON.stringify(credits.body)).toContain(W.ue[0]!.lineageId);
    });

    it("candidats au rattrapage : les ECUE non validées des étudiants 2 et 3 ; la direction ouvre la fenêtre sur E21 et E22", async () => {
      const cands = await dir().get(`/api/v1/higher/resit-candidates?classroomId=${W.classroomId}&periodId=${W.periodIds[0]}`);
      const set = new Set((cands.body.candidates as Array<{ studentId: string; ecueNodeId: string }>).map((c) => `${c.studentId}:${c.ecueNodeId}`));
      expect(set.has(`${W.students[1]!.id}:${lineage("E21")}`), JSON.stringify(cands.body)).toBe(true);
      expect(set.has(`${W.students[0]!.id}:${lineage("E21")}`)).toBe(false);
      const today = iso(new Date());
      const opened = await dir().post("/api/v1/higher/resit-windows", { classroomId: W.classroomId, academicPeriodId: W.periodIds[0], opensOn: today, closesOn: addDays(today, 14), nodeIds: [lineage("E21"), lineage("E22")] }, 201);
      windowId = opened.body.window.id;
      expect(opened.body.registrations.length).toBeGreaterThanOrEqual(2);
      const state = await dir().get(`${ctxPath()}/state`);
      expect(state.body.state.status).toBe("OPEN"); // la SEULE session 2 est rouverte
    });

    it("l'enseignant saisit les examens de SESSION 2 (feature assess.session2) ; le circuit les publie", async () => {
      const types = await teacher().get("/api/v1/assess/assessment-types");
      const examen = (types.body.items as Array<{ id: string; code: string }>).find((t) => t.code === "EXAMEN")!;
      const periods = await own().get(`/api/v1/academic/years/${W.year.id}/periods`);
      const s1 = (periods.body.items as Array<{ id: string; startsOn: string }>).find((x) => x.id === W.periodIds[0])!;
      const bulk = await teacher().post(
        "/api/v1/assess/assessments/bulk",
        { typeId: examen.id, academicPeriodId: W.periodIds[0], title: "Examen S1 — session 2", assessedOn: addDays(s1.startsOn, 20), sessionNo: 2, targets: [{ classroomId: W.classroomId, curriculumNodeId: ecue("E21") }, { classroomId: W.classroomId, curriculumNodeId: ecue("E22") }] },
        201,
      );
      for (const a of bulk.body.items as Array<{ id: string }>) {
        // étudiant 1 dispensé (il n'est pas candidat) ; étudiant 2 : 5 (PLUS BAS que sa note de session 1, 9) ; étudiant 3 : 14.
        await teacher().put(`/api/v1/assess/assessments/${a.id}/grades`, {
          entries: [
            { enrollmentId: W.students[0]!.enrollmentId, entryStatus: "EXEMPT" },
            { enrollmentId: W.students[1]!.enrollmentId, score: "5" },
            { enrollmentId: W.students[2]!.enrollmentId, score: "14" },
          ],
        });
        await teacher().post(`/api/v1/assess/assessments/${a.id}/transitions`, { to: "SUBMITTED" });
        await pedago().post(`/api/v1/assess/assessments/${a.id}/transitions`, { to: "REVIEWED" });
        await pedago().post(`/api/v1/assess/assessments/${a.id}/transitions`, { to: "APPROVED" });
        await dir().post(`/api/v1/assess/assessments/${a.id}/transitions`, { to: "PUBLISHED" });
      }
    });

    it("reclôture : la note de session 2 REMPLACE celle de session 1 — même plus faible (décision métier du 2026-10-01)", async () => {
      await dir().post(`${ctxPath()}/lock`, {});
      const closed = await dir().post(`${ctxPath()}/close`, {});
      expect(closed.body.resultsVersion).toBeGreaterThanOrEqual(2);
      const e21 = await lineOf(1, "E21");
      expect(e21.line.outputs.note_s1).toBe("9");
      expect(e21.line.outputs.note_s2).toBe("5");
      expect(e21.line.outputs.note_examen, "REMPLACE : 5 et non max(9, 5)").toBe("5");
      expect(e21.line.outputs.session_retenue).toBe(2);
      // L'étudiant 3 (14 > 8) est lui aussi remplacé.
      expect((await lineOf(2, "E21")).line.outputs.note_examen).toBe("14");
      // Aucune compensation : l'étudiant 2 reste sans UE2 validée, son semestre n'est pas validé.
      const r2 = await lineOf(1, "E21");
      expect(r2.header.validated).toBe(false);
      expect(r2.ue.find((u: any) => u.curriculumNodeId === W.ue[1]!.id).validated).toBe(false);
    });

    it("la direction ferme la fenêtre de rattrapage ; l'étudiant 2 reste le seul sans la UE2 au registre (dette d'UE)", async () => {
      const closed = await dir().post(`/api/v1/higher/resit-windows/${windowId}/close`, {});
      expect(closed.body.status).toBe("CLOSED");
      const ue2 = await p.db.admin.query(
        "SELECT count(*)::int AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED' AND student_id = $2 AND ue_node_id = $3",
        [T().tenantId, W.students[1]!.id, W.ue[1]!.lineageId],
      );
      expect(ue2.rows[0].n).toBe(0);
    });

    it("clôture académique de la période : notes puis résultats (les abonnés présences et résultats l'absorbent)", async () => {
      await dir().post(`/api/v1/academic/periods/${W.periodIds[0]}/close-grading`, {}, [200, 201, 409]);
      const closed = await dir().raw("POST", `/api/v1/academic/periods/${W.periodIds[0]}/close`, {});
      expect([200, 201], JSON.stringify(closed.body)).toContain(closed.status);
    });
  });

  // ===========================================================================================================
  describe("(9) bulletins : snapshot signé, PDF rendu par le worker, publication, vérification publique", () => {
    const cards: Array<{ id: string; studentId: string; verificationCode: string; snapshotHash: string; issuedAt: string }> = [];
    const periodQuery = (): string => `classroomId=${W.classroomId}&academicPeriodId=${W.periodIds[0]}`;

    it("identité de l'établissement, signataire et gabarit du pack HIGHER (gestion réservée aux permissions sensibles, MFA)", async () => {
      await own().put("/api/v1/reportcards/branding", { legalName: "Université Horizon", headerLeft: ["République de Côte d'Ivoire"], address: "Abidjan", primaryColor: "#14532D" });
      const sig = await own().post("/api/v1/reportcards/signatories", { fullName: "Dr Fictif Directeur", title: "Directeur des études", jobFunction: "Direction des études" }, 201);
      W.signatoryId = sig.body.id;
      const templates = await own().get("/api/v1/reportcards/templates");
      expect(JSON.stringify(templates.body)).toContain("higher-bulletin-credits");
      await own().put("/api/v1/reportcards/template-configs", {
        documentKind: "REPORT_CARD",
        pack: "HIGHER",
        templateKey: "higher-bulletin-credits",
        options: {},
        signatureAssignments: [{ slot: "director-studies", signatoryId: sig.body.id }],
      });
      // L'enseignant n'a aucun droit sur l'identité de l'établissement.
      expect((await (W.teacher as Actor).raw("PUT", "/api/v1/reportcards/branding", { legalName: "Piraté" })).status).toBe(403);
    });

    it("contrôle préalable vert, puis lot d'émission : un bulletin SIGNÉ par inscription (période close, résultats FINAL)", async () => {
      const pre = await own().get(`/api/v1/reportcards/preflight?${periodQuery()}`);
      expect(pre.body.issues.filter((i: { blocking: boolean }) => i.blocking), JSON.stringify(pre.body)).toEqual([]);
      expect(pre.body.enrollments).toMatchObject({ total: 3, eligible: 3, excluded: 0 });
      const batch = await own().post("/api/v1/reportcards/batches", { classroomId: W.classroomId, academicPeriodId: W.periodIds[0], idempotencyKey: "p2-lot-bulletins-1" }, [200, 202]);
      expect(batch.body.batch ?? batch.body).toMatchObject({ total: 3 });
      const page = await own().get(`/api/v1/reportcards/report-cards?${periodQuery()}&live=true`);
      for (const c of page.body.items as Array<any>) cards.push({ id: c.id, studentId: c.studentId, verificationCode: c.verificationCode, snapshotHash: c.snapshotHash, issuedAt: c.issuedAt });
      expect(cards).toHaveLength(3);
      W.ids.reportCard = cards.find((c) => c.studentId === W.students[1]!.id)!.id;
      expect(new Set(cards.map((c) => c.verificationCode)).size).toBe(3);
      // Rejouer le lot (même clé) ne crée rien.
      const replay = await own().post("/api/v1/reportcards/batches", { classroomId: W.classroomId, academicPeriodId: W.periodIds[0], idempotencyKey: "p2-lot-bulletins-1" }, [200, 202]);
      expect((replay.body.batch ?? replay.body).id).toBe((batch.body.batch ?? batch.body).id);
      expect((await own().get(`/api/v1/reportcards/report-cards?${periodQuery()}&live=true`)).body.items).toHaveLength(3);
    });

    it("le snapshot porte la version de règle, les crédits et les décisions : étudiant 2 = semestre non validé malgré sa moyenne", async () => {
      const mine = cards.find((c) => c.studentId === W.students[1]!.id)!;
      const detail = await own().get(`/api/v1/reportcards/report-cards/${mine.id}`);
      const snap = detail.body.snapshot;
      expect(snap.rules).toMatchObject({ ruleSetCode: "CI-HIGHER-LMD", contractId: "credit-semester@1" });
      expect(snap.rules.resultsVersion).toBeGreaterThanOrEqual(2);
      expect(snap.results.summary.decisionOutcome).toBe("ADJOURNED");
      expect(Number(snap.results.summary.creditsAcquired)).toBeLessThan(Number(snap.results.summary.creditsRequired));
    });

    it("le worker rend le PDF depuis le snapshot seul (événement reportcards.snapshot.created), stocké et lisible par URL signée", async () => {
      for (const c of cards) {
        await waitFor(async () => (await own().get(`/api/v1/reportcards/report-cards/${c.id}`)).body.renders?.some((r: { status: string }) => r.status === "RENDERED"), { label: `PDF du bulletin ${c.id}`, timeoutMs: 90_000 });
      }
      const dl = await own().get(`/api/v1/reportcards/report-cards/${cards[0]!.id}/pdf`);
      expect(dl.body.contentType).toBe("application/pdf");
      expect(dl.body.pdfHash).toMatch(/^[0-9a-f]{64}$/);
      const u = new URL(dl.body.url);
      const file = await p.app.inject({ method: "GET", url: `${u.pathname}${u.search}` });
      expect(file.statusCode).toBe(200);
      expect(file.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      // rendu réel (Chrome présent) ou déterministe : la preuve de ce qui a été exécuté est consignée.
      // eslint-disable-next-line no-console
      console.log(`PDF-RENDER mode=${p.realPdf ? "chrome" : "deterministe"} bytes=${file.rawPayload.length} chrome=${p.chromePath ?? "-"}`);
    });

    it("publication par lot (gestion, MFA), puis VÉRIFICATION PUBLIQUE sans authentification : valide, sans donnée personnelle", async () => {
      const pub = await own().post("/api/v1/reportcards/publish", { reportCardIds: cards.map((c) => c.id) });
      expect(pub.body.published).toBe(3);
      const c = cards[0]!;
      const res = await p.http("GET", `/api/v1/public/verify/${c.verificationCode}`);
      expectStatus(res, 200);
      expect(res.body.status).toBe("AUTHENTIC");
      expect(res.body.snapshotHash).toBe(c.snapshotHash);
      expect(res.body.institutionName).toBe("Université Horizon");
      const dump = JSON.stringify(res.body);
      expect(dump).not.toContain("ETUDIANT");
      expect(dump).not.toContain("2005-");
      // Un code inconnu ou mal formé reçoit la MÊME réponse (aucune énumération).
      const unknown = await p.http("GET", "/api/v1/public/verify/ZZZZZZZZZZZZZZZZZZZZZZZZZZ");
      const malformed = await p.http("GET", "/api/v1/public/verify/pas-un-code");
      expect(unknown.status).toBe(404);
      expect(malformed.body).toEqual(unknown.body);
    });

    it("signature Ed25519 vérifiable HORS LIGNE avec la clé publique publiée (/.well-known) : message ed-rc/v1", async () => {
      const c = cards[0]!;
      const verify = (await p.http("GET", `/api/v1/public/verify/${c.verificationCode}`)).body;
      const wk = await p.http("GET", "/.well-known/ecoledigitale-keys.json");
      expectStatus(wk, 200);
      const key = (wk.body.keys as Array<{ keyId: string; publicKey: string }>).find((k) => k.keyId === p.signingKeyId);
      expect(key, "clé publique publiée").toBeDefined();
      const message = Buffer.concat([Buffer.from("ed-rc/v1"), Buffer.from([0]), Buffer.from(c.snapshotHash), Buffer.from([0]), Buffer.from(c.verificationCode), Buffer.from([0]), Buffer.from(new Date(c.issuedAt).toISOString())]);
      const publicKey = createPublicKey({ key: Buffer.from(key!.publicKey, "base64"), format: "der", type: "spki" });
      expect(edVerify(null, message, publicKey, Buffer.from(verify.signature, "base64"))).toBe(true);
      // Un bulletin falsifié (hash modifié) ne vérifie pas.
      const forged = Buffer.concat([Buffer.from("ed-rc/v1"), Buffer.from([0]), Buffer.from("0".repeat(64)), Buffer.from([0]), Buffer.from(c.verificationCode), Buffer.from([0]), Buffer.from(new Date(c.issuedAt).toISOString())]);
      expect(edVerify(null, forged, publicKey, Buffer.from(verify.signature, "base64"))).toBe(false);
    });
  });

  // ===========================================================================================================
  describe("(10) diplôme et attestation de réussite (higher) : octroi, documents officiels émis, numérotés, publiés (scellement, PDF et vérification publique)", () => {
    const dir = (): Actor => W.directeur as Actor;
    let diplomaId: string;
    let awardId: string;
    const docs: { diploma?: { id: string; verificationCode: string }; attestation?: { id: string; verificationCode: string }; diplomaPdf?: Buffer } = {};

    it("le programme devient un cycle ; le diplôme (LICENCE) est dérivé du curriculum : exigences = les UE du cycle, par lignée", async () => {
      await own().patch(`/api/v1/academic/programs/${W.programId}`, { isCycle: true });
      const d = await dir().post("/api/v1/higher/diplomas/from-curriculum", { curriculumNodeId: W.programId, gradeCode: "LICENCE", code: "LIC-INFO", label: "Licence d'Informatique" }, 201);
      diplomaId = d.body.id ?? d.body.diploma?.id;
      W.ids.diploma = diplomaId;
      const reqs = await dir().get(`/api/v1/higher/diplomas/${diplomaId}/requirements`);
      expect((reqs.body.items as Array<{ ueNodeId: string }>).map((r) => r.ueNodeId).sort()).toEqual([W.ue[0]!.lineageId, W.ue[1]!.lineageId].sort());
      expect(Number(reqs.body.requirementsCredits)).toBe(12);
    });

    it("l'étudiant 1 (12 crédits capitalisés) reçoit le diplôme ; l'étudiant 2 (UE2 non validée) est REFUSÉ sans octroi forcé", async () => {
      const ok = await dir().post(`/api/v1/higher/diplomas/${diplomaId}/awards`, { studentId: W.students[0]!.id }, 201);
      awardId = ok.body.award.id;
      W.ids.award = awardId;
      expect(ok.body.award.status).toBe("OBTAINED");
      const refused = await dir().raw("POST", `/api/v1/higher/diplomas/${diplomaId}/awards`, { studentId: W.students[1]!.id });
      expect(refused.status, JSON.stringify(refused.body)).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
      const progress = await dir().get(`/api/v1/higher/diplomas/${diplomaId}/students/${W.students[1]!.id}/progress`);
      expect(JSON.stringify(progress.body)).toContain(W.ue[1]!.lineageId); // l'UE manquante est désignée
    });

    it("signataires datés des documents, puis diplôme émis (numéroté, snapshot immuable) ; le rejeu ne crée pas de second diplôme", async () => {
      const from = addDays(iso(new Date()), -1);
      for (const slotKey of ["DIPLOMA_LEFT", "DIPLOMA_RIGHT", "ATTESTATION_SUCCESS", "AUTHENTICITY"]) {
        await own().put("/api/v1/higher/document-slots", { slotKey, signatoryId: W.signatoryId, validFrom: from });
      }
      const dip = await dir().post(`/api/v1/higher/awards/${awardId}/documents`, { kind: "DIPLOMA" }, [200, 201]);
      docs.diploma = { id: dip.body.document.id, verificationCode: dip.body.document.verificationCode };
      W.ids.document = dip.body.document.id;
      expect(dip.body.document.reference).toMatch(/\d/);
      expect(dip.body.document.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      // rejeu : le même diplôme, pas de second numéro
      const again = await dir().post(`/api/v1/higher/awards/${awardId}/documents`, { kind: "DIPLOMA" }, [200, 201]);
      expect(again.body.document.id).toBe(docs.diploma.id);
      expect(again.body.created).toBe(false);
    });

    it("attestation de réussite du cycle (feature higher.attestations) puis publication ; vérification PUBLIQUE de l'authenticité", async () => {
      const roster = await dir().get(`/api/v1/higher/attestations/roster?programNodeId=${W.programId}`);
      const row = (roster.body.items as Array<{ studentId: string; eligible: boolean }>).find((r) => r.studentId === W.students[0]!.id);
      expect(row?.eligible, JSON.stringify(roster.body)).toBe(true);
      const att = await dir().post("/api/v1/higher/attestations", { studentId: W.students[0]!.id, programNodeId: W.programId }, [200, 201]);
      docs.attestation = { id: att.body.document.id, verificationCode: att.body.document.verificationCode };
      for (const d of [docs.diploma!, docs.attestation]) {
        const pub = await dir().post(`/api/v1/higher/documents/${d.id}/publish`, {});
        expect(pub.body.publishedAt).toBeTruthy();
      }
      // Le worker SCELLE (signature Ed25519 de l'empreinte) puis RAND chaque document (événement higher.document.issued).
      for (const d of [docs.diploma!, docs.attestation]) {
        await waitFor(async () => {
          const doc = (await dir().get(`/api/v1/higher/documents/${d.id}`)).body;
          return doc.sealed === true && doc.renderStatus === "RENDERED";
        }, { label: `scellement et PDF du document ${d.id}`, timeoutMs: 90_000 });
      }
      // Numérotation sans trou et snapshots immuables : une référence par document, distinctes.
      const list = await dir().get("/api/v1/higher/documents");
      const refs = (list.body.items as Array<{ reference: string }>).map((d) => d.reference);
      expect(new Set(refs).size).toBe(refs.length);
    });

    it("l'étudiant lit SON diplôme publié (jamais celui d'un autre) ; la révocation d'un document est un acte sensible et distinct", async () => {
      const revoked = await dir().post(`/api/v1/higher/documents/${docs.attestation!.id}/revoke`, { reason: "Erreur de saisie constatée au contrôle" });
      expect(revoked.body.revokedAt).toBeTruthy();
      const again = await dir().raw("POST", `/api/v1/higher/documents/${docs.attestation!.id}/revoke`, { reason: "Seconde révocation du même document" });
      expect(again.status).toBe(409);
      // Le diplôme, lui, reste valable.
      const diploma = await dir().get(`/api/v1/higher/documents/${docs.diploma!.id}`);
      expect(diploma.body.status).toBe("ISSUED");
    });

    it("le PDF du diplôme : URL signée à durée courte, octets %PDF-, accès réservé (étudiant tiers : refus) ; l'URL n'expose aucun chemin de stockage", async () => {
      const dl = await dir().get(`/api/v1/higher/documents/${docs.diploma!.id}/pdf`);
      expect(dl.body).toMatchObject({ status: "READY", contentType: "application/pdf", expiresInSec: 120 });
      expect(dl.body.pdfHash).toMatch(/^[0-9a-f]{64}$/);
      expect(dl.body.url).not.toContain("tenants/");
      const u = new URL(dl.body.url);
      const file = await p.app.inject({ method: "GET", url: `${u.pathname}${u.search}` });
      expect(file.statusCode).toBe(200);
      expect(file.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      docs.diplomaPdf = file.rawPayload;
      // Sans authentification : refus.
      expect((await p.http("GET", `/api/v1/higher/documents/${docs.diploma!.id}/pdf`)).status).toBe(401);
    });

    it("vérification PUBLIQUE du diplôme (code de higher) : AUTHENTIQUE, signature relue, aucune donnée personnelle ; fichier téléversé reconnu, fichier modifié non", async () => {
      const res = await p.http("GET", `/api/v1/public/verify/${docs.diploma!.verificationCode}`);
      expectStatus(res, 200);
      expect(res.body).toMatchObject({ status: "AUTHENTIC", documentKind: "DIPLOMA", institutionName: "Université Horizon", keyId: p.signingKeyId });
      expect(res.body.title).toContain("Licence d'Informatique");
      const dump = JSON.stringify(res.body);
      expect(dump).not.toContain("ETUDIANT");
      expect(dump).not.toContain("2005-");
      // La signature est vérifiable HORS LIGNE avec la clé publique publiée, comme celle d'un bulletin.
      const wk = await p.http("GET", "/.well-known/ecoledigitale-keys.json");
      const key = (wk.body.keys as Array<{ keyId: string; publicKey: string }>).find((k) => k.keyId === p.signingKeyId)!;
      const issuedAt = new Date(res.body.issuedAt).toISOString();
      const message = Buffer.concat([Buffer.from("ed-rc/v1"), Buffer.from([0]), Buffer.from(res.body.snapshotHash), Buffer.from([0]), Buffer.from(docs.diploma!.verificationCode), Buffer.from([0]), Buffer.from(issuedAt)]);
      expect(edVerify(null, message, createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(res.body.signature, "base64"))).toBe(true);
      // Fichier téléversé : le PDF émis est reconnu ; une copie modifiée ne l'est pas.
      const upload = (bytes: Buffer) => p.app.inject({ method: "POST", url: "/api/v1/public/verify/upload", headers: { "content-type": "application/pdf" }, payload: bytes });
      const same = await upload(docs.diplomaPdf!);
      expect(same.statusCode).toBe(200);
      expect(same.json()).toMatchObject({ match: true, status: "AUTHENTIC" });
      expect((await upload(Buffer.concat([docs.diplomaPdf!, Buffer.from(" ")]))).json()).toMatchObject({ match: false });
    });

    it("l'attestation révoquée est RÉVOQUÉE pour le public (et son PDF n'est plus servi) ; un duplicata du diplôme remplace l'original (REMPLACÉ), les deux restent vérifiables", async () => {
      const att = await p.http("GET", `/api/v1/public/verify/${docs.attestation!.verificationCode}`);
      expectStatus(att, 200);
      expect(att.body.status).toBe("REVOKED");
      expect(att.body.revokedAt).toBeTruthy();
      const gone = await dir().raw("GET", `/api/v1/higher/documents/${docs.attestation!.id}/pdf`);
      expect(gone.status).toBe(409);
      expect(gone.body.code).toBe("higher.document_revoked");

      const dup = await dir().post(`/api/v1/higher/awards/${awardId}/documents`, { kind: "DIPLOMA", duplicate: true }, [200, 201]);
      const duplicate = { id: dup.body.document.id as string, code: dup.body.document.verificationCode as string };
      expect(dup.body.created).toBe(true);
      await waitFor(async () => (await dir().get(`/api/v1/higher/documents/${duplicate.id}`)).body.renderStatus === "RENDERED", { label: "PDF du duplicata", timeoutMs: 90_000 });
      expect((await p.http("GET", `/api/v1/public/verify/${docs.diploma!.verificationCode}`)).body.status).toBe("SUPERSEDED");
      expect((await p.http("GET", `/api/v1/public/verify/${duplicate.code}`)).body.status).toBe("AUTHENTIC");
      // Les codes fournis par higher sont ceux de la vérification publique : jamais deux codes pour un document.
      expect(docs.diploma!.verificationCode).toMatch(/^[A-Z2-7]{26}$/);
    });
  });

  // ===========================================================================================================
  describe("(11) paie de l'enseignant : heures réalisées et validées -> bulletin calculé, approuvé, payé (séparation des tâches)", () => {
    const dir = (): Actor => W.directeur as Actor;
    const teacher = (): Actor => W.teacher as Actor;
    let periodId: string;
    let payslipId: string;
    const today = iso(new Date());

    it("la direction valide les séances réalisées (constatées par l'appel) : elles deviennent payables", async () => {
      for (const o of W.occ.slice(0, 2)) {
        const held = await own().get(`/api/v1/scheduling/occurrences/${o.id}`);
        expect(held.body.status, JSON.stringify(held.body)).toBe("HELD");
        const v = await dir().post(`/api/v1/scheduling/occurrences/${o.id}/validate`, {});
        expect(v.body).toMatchObject({ occurrenceId: o.id, alreadyValidated: false });
      }
    });

    it("configuration de paie (horaire, 5 000 XOF/h) et période de paie de l'année", async () => {
      // Séparation des tâches activée par le propriétaire (réglage du tenant) : qui calcule n'arrête pas le bulletin.
      const settings = await own().put("/api/v1/payroll/settings", { requireSeparateApprover: true });
      expect(settings.body.requireSeparateApprover).toBe(true);
      await own().post("/api/v1/payroll/configs", { staffId: W.teacherStaffId, type: "HOURLY", defaultHourlyRate: 5000, effectiveFrom: W.year.startsOn }, 201);
      const per = await own().post("/api/v1/payroll/periods", { name: "Première période", startDate: W.year.startsOn, endDate: today, academicYearId: W.year.id }, 201);
      periodId = per.body.id;
    });

    it("calcul : 2 séances × 2 h × 5 000 = 20 000 XOF, calculé par les heures de scheduling (jamais saisi à la main)", async () => {
      const run = await own().post(`/api/v1/payroll/periods/${periodId}/calculate`, {}, [200, 201]);
      expect(run.body).toMatchObject({ calculated: 1, failed: 0 });
      expect(run.body.items[0].minutesBySource).toEqual({ SESSION: 240, ATTENDANCE: 0 });
      const list = await own().get(`/api/v1/payroll/payslips?periodId=${periodId}`);
      const slips = (list.body.items ?? list.body.payslips) as Array<{ id: string; staffId: string; status: string }>;
      expect(slips).toHaveLength(1);
      payslipId = slips[0]!.id;
      W.ids.payslip = payslipId;
      expect(slips[0]).toMatchObject({ status: "CALCULATED", staffId: W.teacherStaffId });
      const detail = await own().get(`/api/v1/payroll/payslips/${payslipId}`);
      expect(detail.body.payslip).toMatchObject({ totalAmount: 20000, baseAmount: 20000, regularMinutes: 240, overtimeAmount: 0 });
    });

    it("séparation des tâches : celui qui a calculé ne peut pas arrêter le bulletin ; l'enseignant ne peut ni calculer, ni approuver, ni payer", async () => {
      const self = await own().raw("POST", "/api/v1/payroll/payslips/approve", { payslipIds: [payslipId] });
      expect(self.body.done ?? [], JSON.stringify(self.body)).toEqual([]);
      expect(JSON.stringify(self.body)).toMatch(/separate|approver|calcul/i);
      expect((await teacher().raw("POST", "/api/v1/payroll/payslips/approve", { payslipIds: [payslipId] })).status).toBe(403);
      expect((await teacher().raw("POST", `/api/v1/payroll/periods/${periodId}/calculate`, {})).status).toBe(403);
      // Avant l'arrêt du montant, l'enseignant ne lit pas un brouillon.
      const draft = await teacher().raw("GET", `/api/v1/payroll/my/payslips`);
      expect(JSON.stringify(draft.body)).not.toContain(payslipId);
    });

    it("la direction (autre personne) APPROUVE puis PAIE : bulletin PAID, heures gelées à la source", async () => {
      const approved = await dir().post("/api/v1/payroll/payslips/approve", { payslipIds: [payslipId] });
      expect(approved.body.done).toEqual([payslipId]);
      const paid = await dir().post("/api/v1/payroll/payslips/pay", { payslipIds: [payslipId], method: "BANK_TRANSFER", reference: "VIR-PAIE-0001" });
      expect(paid.body.done, JSON.stringify(paid.body)).toEqual([payslipId]);
      const detail = await own().get(`/api/v1/payroll/payslips/${payslipId}`);
      expect(JSON.stringify(detail.body)).toContain("PAID");
      // Les heures payées sont gelées : la direction ne peut plus dévalider une séance payée.
      const unvalidate = await dir().raw("POST", `/api/v1/scheduling/occurrences/${W.occ[0]!.id}/unvalidate`, { reason: "Tentative après paiement" });
      expect(unvalidate.status, JSON.stringify(unvalidate.body)).toBeGreaterThanOrEqual(400);
      // Un second calcul ne repaie pas les mêmes heures.
      await own().post(`/api/v1/payroll/periods/${periodId}/calculate`, { recalculate: true }, [200, 201]);
      const after = await own().get(`/api/v1/payroll/payslips?periodId=${periodId}`);
      expect(((after.body.items ?? after.body.payslips) as unknown[]).length).toBe(1);
      expect((await own().get(`/api/v1/payroll/payslips/${payslipId}`)).body.payslip).toMatchObject({ status: "PAID", totalAmount: 20000 });
      const claims = await p.db.admin.query("SELECT count(*)::int AS n FROM payroll.hour_claims WHERE tenant_id = $1", [T().tenantId]);
      expect(claims.rows[0].n).toBe(2); // une heure ne se paie qu'une fois : 2 séances, 2 réclamations
    });

    it("l'enseignant lit SON bulletin versé (et lui seul) ", async () => {
      const mine = await teacher().get("/api/v1/payroll/my/payslips");
      expect(JSON.stringify(mine.body)).toContain(payslipId);
      expect((await teacher().get(`/api/v1/payroll/my/payslips/${payslipId}`)).status).toBe(200);
    });
  });

  // ===========================================================================================================
  describe("(12) audit : chaîne HMAC valide, chaque module a journalisé ses actes sensibles", () => {
    it("le journal du tenant (lu par le propriétaire) contient des actes de CHAQUE module, avec les bons acteurs", async () => {
      const prefixes = ["tenancy.", "academic.", "people.", "finance.", "assess.", "attendance.", "scheduling.", "results.", "reportcards.", "higher.", "payroll."];
      const entries = await waitFor(
        async () => {
          const all = await readAuditLog(p, own().token);
          const actions = all.map((e) => String(e.action));
          return prefixes.every((pre) => actions.some((a) => a.startsWith(pre))) ? all : false;
        },
        { label: "actes de tous les modules dans le journal d'audit", timeoutMs: 45_000 },
      );
      const actions = [...new Set(entries.map((e) => String(e.action)))].sort();
      // Acteurs : des utilisateurs réels (identité IAM), et l'opérateur de la plateforme pour le provisionnement.
      const byAction = (a: string) => entries.find((e) => e.action === a);
      expect(byAction("tenancy.tenant.provision")?.actorType).toBe("superAdmin");
      const actorIds = new Set(entries.filter((e) => e.actorType === "user").map((e) => e.actorId));
      for (const a of [own(), W.directeur as Actor, W.pedago as Actor, W.teacher as Actor]) expect(actorIds.has(a.identityId), `acteur ${a.label}`).toBe(true);
      // Aucun secret n'est journalisé.
      const dump = JSON.stringify(entries);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toMatch(/otpauth:\/\//);
      expect(dump).not.toContain("REPORTCARDS_SIGNING_KEY");
      expect(dump).not.toMatch(/BEGIN PRIVATE KEY/);
    });

    it("GET /audit/verify : chaîne valide (HMAC), aucun trou ; journal de plateforme valide ; append-only pour l'application", async () => {
      await waitFor(
        async () => {
          const r = await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND published_at IS NULL", [T().tenantId]);
          return r.rows[0].n === 0;
        },
        { label: "outbox entièrement publiée avant la vérification de la chaîne", timeoutMs: 60_000 },
      );
      // laisse les abonnés d'audit absorber les derniers événements
      await new Promise((r) => setTimeout(r, 1500));
      const res = await own().get("/api/v1/audit/verify");
      expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
      expect(res.body.checked).toBeGreaterThan(50);
      const head = await p.db.admin.query("SELECT last_seq FROM audit.chain_heads WHERE tenant_id = $1", [T().tenantId]);
      expect(Number(head.rows[0].last_seq)).toBeGreaterThanOrEqual(res.body.checked);
      const alg = await p.db.admin.query("SELECT DISTINCT hash_alg FROM audit.audit_log WHERE tenant_id = $1", [T().tenantId]);
      expect(alg.rows.map((r) => r.hash_alg)).toEqual(["hmac-sha256"]);
      const verification = await p.app.v2.systemDb.run("p2-verify-platform-chain", (tx) => audit.verifyPlatformChain(tx));
      expect(verification.ok, JSON.stringify(verification)).toBe(true);
      await expect(
        p.app.v2.tenantDb.run({ tenantId: T().tenantId, userId: own().identityId, roles: [], requestId: "p2-tamper", actor: "user", mfa: false } as never, (tx) =>
          tx.query("UPDATE audit.audit_log SET action = 'x.y' WHERE tenant_id = $1", [T().tenantId]),
        ),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================================================
  describe("(13) second tenant : isolation prouvée par des appels CROISÉS refusés", () => {
    let U: ProvisionedOwner;
    let ownerU: Actor;

    it("un second établissement (mêmes droits : PROFESSIONAL + HIGHER) est provisionné par la console ; son propriétaire s'authentifie avec MFA", async () => {
      U = await provisionByConsole(p, { name: "Institut Delta", slug: "delta", packs: ["HIGHER"], ownerEmail: "owner@delta.test" });
      expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${U.tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["HIGHER"], status: "ACTIVE" } }), 200);
      await redeemInvitation(p, U.ownerEmail);
      ownerU = actorFrom(p.http, "owner-delta", U.ownerEmail, await loginWithMfaEnrollment(p, U.ownerEmail, U.slug));
      expect(U.tenantId).not.toBe(T().tenantId);
    });

    it("LECTURE croisée : le propriétaire de B n'obtient AUCUNE ressource de A par son identifiant (ni 200, ni donnée)", async () => {
      const probes: Array<[string, string]> = [
        ["année", `/api/v1/academic/years/${W.year.id}`],
        ["programme", `/api/v1/academic/programs/${W.programId}`],
        ["classe", `/api/v1/academic/classrooms/${W.classroomId}`],
        ["effectif de la classe", `/api/v1/academic/classrooms/${W.classroomId}/roster`],
        ["curriculum", `/api/v1/academic/curriculum-versions/${W.versionId}`],
        ["inscription", `/api/v1/academic/enrollments/${W.students[0]!.enrollmentId}`],
        ["étudiant", `/api/v1/people/students/${W.students[0]!.id}`],
        ["tuteur", `/api/v1/people/guardians/${W.guardianId}`],
        ["enseignant", `/api/v1/people/staff/${W.teacherStaffId}`],
        ["facture", `/api/v1/finance/invoices/${W.ids.invoice}`],
        ["paiement", `/api/v1/finance/payments/${W.ids.payment}`],
        ["évaluation", `/api/v1/assess/assessments/${W.ids.assessment}`],
        ["appel", `/api/v1/attendance/sessions/${W.ids.attendanceSession}`],
        ["séance", `/api/v1/scheduling/occurrences/${W.occ[0]!.id}`],
        ["résultats de classe", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`],
        ["résultat d'un étudiant", `/api/v1/results/enrollments/${W.students[0]!.enrollmentId}/periods/${W.periodIds[0]}`],
        ["bulletin", `/api/v1/reportcards/report-cards/${W.ids.reportCard}`],
        ["diplôme", `/api/v1/higher/diplomas/${W.ids.diploma}`],
        ["octroi", `/api/v1/higher/awards/${W.ids.award}`],
        ["document officiel", `/api/v1/higher/documents/${W.ids.document}`],
        ["bulletin de paie", `/api/v1/payroll/payslips/${W.ids.payslip}`],
      ];
      for (const [what, url] of probes) {
        const res = await ownerU.raw("GET", url);
        expect([403, 404], `${what} : ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        expect(JSON.stringify(res.body), what).not.toContain("ETUDIANT");
      }
      // Les listes de B sont vides : rien de A n'y fuit.
      for (const url of ["/api/v1/people/students", "/api/v1/academic/years", "/api/v1/academic/classrooms", "/api/v1/finance/invoices", "/api/v1/payroll/payslips", "/api/v1/higher/diplomas"]) {
        const res = await ownerU.get(url);
        const dump = JSON.stringify(res.body);
        expect(dump, url).not.toContain(W.students[0]!.id);
        expect(dump, url).not.toContain("ETUDIANT");
      }
    });

    it("ÉCRITURE croisée : B ne modifie, n'inscrit, ne note, ne paie ni ne publie rien chez A", async () => {
      const writes: Array<[string, string, unknown]> = [
        ["PATCH", `/api/v1/people/students/${W.students[0]!.id}`, { person: { firstName: "Piraté" } }],
        ["POST", "/api/v1/academic/enrollments", { studentId: W.students[0]!.id, classroomId: W.classroomId }],
        ["POST", `/api/v1/academic/classrooms/${W.classroomId}/cancel`, { reason: "Tentative de piratage inter-tenant" }],
        ["PUT", `/api/v1/assess/assessments/${W.ids.assessment}/grades`, { entries: [{ enrollmentId: W.students[0]!.enrollmentId, score: "20" }] }],
        ["POST", `/api/v1/attendance/sessions/${W.ids.attendanceSession}/cancel`, { reason: "Tentative de piratage inter-tenant" }],
        ["POST", `/api/v1/finance/payments`, { learnerId: W.students[0]!.id, amount: 1000, method: "TRANSFER", reference: "X", allocation: { mode: "NONE" } }],
        ["POST", `/api/v1/finance/invoices/${W.ids.invoice}/cancel`, { reason: "Tentative de piratage inter-tenant" }],
        ["POST", `/api/v1/reportcards/report-cards/${W.ids.reportCard}/revoke`, { reason: "Tentative de piratage inter-tenant" }],
        ["POST", `/api/v1/higher/awards/${W.ids.award}/revoke`, { reason: "Tentative de piratage inter-tenant" }],
        ["POST", `/api/v1/payroll/payslips/${W.ids.payslip}/cancel`, { reason: "Tentative de piratage inter-tenant" }],
        ["POST", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}/reopen`, { reason: "Tentative de piratage inter-tenant" }],
      ];
      for (const [method, url, body] of writes) {
        const res = await ownerU.raw(method, url, body);
        expect(res.status, `${method} ${url} : ${JSON.stringify(res.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      // Les données de A n'ont pas bougé.
      const student = await p.db.admin.query("SELECT p.first_name FROM people.students s JOIN people.persons p ON p.id = s.person_id WHERE s.id = $1", [W.students[0]!.id]);
      expect(student.rows[0].first_name).toBe("Awa");
      const room = await own().get(`/api/v1/academic/classrooms/${W.classroomId}`);
      expect(room.body.status).toBe("ACTIVE");
      expect((await own().get(`/api/v1/payroll/payslips/${W.ids.payslip}`)).body.payslip.status).toBe("PAID");
      expect((await own().get(`/api/v1/reportcards/report-cards/${W.ids.reportCard}`)).body.status).not.toBe("REVOKED");
    });

    it("base de données : sous l'identité de B, aucune ligne de A n'est visible dans les tables métier (RLS forcée)", async () => {
      const tables = ["academic.academic_years", "academic.enrollments", "people.students", "finance.invoices", "assess.assessments", "attendance.sessions", "scheduling.session_occurrences", "results.period_results", "reportcards.report_cards", "higher.credit_ledger", "payroll.payslips"];
      for (const t of tables) {
        const seen = await p.app.v2.tenantDb.run({ tenantId: U.tenantId, userId: ownerU.identityId, roles: [], requestId: `p2-rls-${t}`, actor: "user", mfa: false } as never, (tx) =>
          tx.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]),
        );
        expect(seen.rows[0]?.n, t).toBe(0);
        const visible = await p.db.admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]);
        expect(visible.rows[0].n, `${t} (visible par l'administrateur)`).toBeGreaterThan(0);
      }
    });

    it("l'abonnement gouverne les fonctions : B rétrogradé (STARTER, sans pack) perd higher, la paie par séances, la génération, le paiement en ligne ; le socle reste ; A n'est pas touché", async () => {
      const set = (body: Record<string, unknown>) => p.http("PUT", `/api/v1/platform/tenants/${U.tenantId}/subscription`, { token: p.operatorToken, body });
      expectStatus(await set({ planKey: "STARTER", packs: [], status: "ACTIVE" }), 200);
      const anyId = "0192f0a4-7b1e-7c3a-8d2e-00000000dead";
      const denied: Array<[string, string, unknown]> = [
        ["GET", "/api/v1/higher/diplomas", undefined],
        ["POST", `/api/v1/scheduling/timetables/${anyId}/generate`, { from: "2026-01-01", to: "2026-02-01" }],
        ["POST", "/api/v1/finance/payments/online", { learnerId: anyId, amount: 1000, provider: "sandbox" }],
        ["POST", "/api/v1/higher/resit-windows", { classroomId: anyId, academicPeriodId: anyId, opensOn: "2026-01-01", closesOn: "2026-01-02" }],
      ];
      for (const [method, url, body] of denied) {
        const res = await ownerU.raw(method, url, body);
        expect(res.status, `${method} ${url}`).toBe(403);
        expect(res.body.code, `${method} ${url}`).toBe("entitlements.feature_not_available");
      }
      // Le socle (annuaire, référentiels académiques) reste ouvert.
      expect((await ownerU.raw("GET", "/api/v1/academic/years")).status).toBe(200);
      expect((await ownerU.raw("GET", "/api/v1/people/students")).status).toBe(200);
      // A, avec son propre abonnement, garde tout.
      expect((await own().raw("GET", "/api/v1/higher/diplomas")).status).toBe(200);
      expectStatus(await set({ planKey: "PROFESSIONAL", packs: ["HIGHER"], status: "ACTIVE" }), 200);
    });

    it("la vérification publique d'un bulletin de A ne dévoile rien de personnel, même à un client de B", async () => {
      const c = (await own().get(`/api/v1/reportcards/report-cards/${W.ids.reportCard}`)).body;
      const res = await p.http("GET", `/api/v1/public/verify/${c.verificationCode}`, { token: ownerU.token });
      expect(res.body.status).toBe("AUTHENTIC");
      expect(JSON.stringify(res.body)).not.toContain("ETUDIANT");
    });
  });

  // ===========================================================================================================
  describe("(14) accès parent : limité à SON enfant, jamais à l'administration", () => {
    const parent = (): Actor => W.parent as Actor;
    const mine = (): string => W.students[1]!.id; // l'étudiant lié au tuteur
    const other = (): string => W.students[0]!.id;

    it("le tuteur voit son enfant (dossier, inscription, présences, emploi du temps, notes, résultats, bulletin publié, crédits)", async () => {
      const kids = await parent().get("/api/v1/people/children");
      expect((kids.body.items ?? kids.body.children ?? kids.body) as unknown[]).toHaveLength(1);
      expect(JSON.stringify(kids.body)).toContain(mine());
      await parent().get(`/api/v1/people/children/${mine()}`);
      const enr = await parent().get(`/api/v1/academic/children/${mine()}/enrollments`);
      expect(JSON.stringify(enr.body)).toContain(W.students[1]!.enrollmentId);
      await parent().get(`/api/v1/attendance/children/${mine()}/attendance`);
      const from = W.year.startsOn;
      await parent().get(`/api/v1/scheduling/children/${mine()}/timetable?from=${from}&to=${addDays(iso(new Date()), 14)}`);
      const grades = await parent().get(`/api/v1/assess/children/${mine()}/grades`);
      expect((grades.body.items as unknown[]).length, JSON.stringify(grades.body).slice(0, 300)).toBeGreaterThanOrEqual(8); // 4 ECUE × (devoir, examen) publiés, ceux de SON enfant seulement
      await parent().get(`/api/v1/higher/children/${mine()}/credits`);
      const cards = await parent().get(`/api/v1/reportcards/children/${mine()}/report-cards`);
      expect((cards.body.items as unknown[]).length).toBe(1);
      const pdf = await parent().get(`/api/v1/reportcards/report-cards/${W.ids.reportCard}/pdf`);
      expect(pdf.body.contentType).toBe("application/pdf");
    });

    it("résultats de l'enfant : FINAL seulement, sans trace ni entrées de calcul (visibilité activée par la feature du pack)", async () => {
      const res = await parent().raw("GET", `/api/v1/results/children/${mine()}/results`);
      expect([200, 403], JSON.stringify(res.body)).toContain(res.status);
      if (res.status === 200) {
        const dump = JSON.stringify(res.body);
        expect(dump).not.toMatch(/inputsHash|outputs"|explain|trace/);
      }
    });

    it("JAMAIS l'enfant d'un autre : dossier, inscription, présences, notes, crédits, bulletin → refusés", async () => {
      for (const url of [
        `/api/v1/people/children/${other()}`,
        `/api/v1/academic/children/${other()}/enrollments`,
        `/api/v1/attendance/children/${other()}/attendance`,
        `/api/v1/assess/children/${other()}/grades`,
        `/api/v1/higher/children/${other()}/credits`,
        `/api/v1/reportcards/children/${other()}/report-cards`,
        `/api/v1/scheduling/children/${other()}/timetable?from=${W.year.startsOn}&to=${addDays(iso(new Date()), 14)}`,
      ]) {
        const res = await parent().raw("GET", url);
        expect([403, 404], `${url} : ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
      }
      // Le bulletin d'un autre élève : même réponse qu'un bulletin inexistant (404).
      const otherCard = (await own().get(`/api/v1/reportcards/report-cards?studentId=${other()}&live=true`)).body.items[0] as { id: string };
      expect((await parent().raw("GET", `/api/v1/reportcards/report-cards/${otherCard.id}/pdf`)).status).toBe(404);
    });

    it("le tuteur n'a aucun accès d'administration : élèves, inscriptions, finance, paie, audit, notes de la classe, rôles", async () => {
      for (const url of [
        "/api/v1/people/students",
        "/api/v1/academic/enrollments",
        `/api/v1/academic/classrooms/${W.classroomId}/roster`,
        "/api/v1/finance/invoices",
        "/api/v1/payroll/payslips",
        "/api/v1/audit/logs",
        "/api/v1/rbac/roles",
        `/api/v1/assess/assessments/${W.ids.assessment}/grades`,
        `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`,
        "/api/v1/higher/diplomas",
        "/api/v1/reportcards/report-cards",
      ]) {
        const res = await parent().raw("GET", url);
        expect(res.status, `${url} : ${JSON.stringify(res.body).slice(0, 200)}`).toBe(403);
      }
      expect((await parent().raw("POST", "/api/v1/academic/enrollments", { studentId: mine(), classroomId: W.classroomId })).status).toBe(403);
      // Un bulletin RETIRÉ de la publication disparaît de la vue du tuteur, puis revient une fois republié.
      await own().post(`/api/v1/reportcards/report-cards/${W.ids.reportCard}/withdraw`, {});
      expect(((await parent().get(`/api/v1/reportcards/children/${mine()}/report-cards`)).body.items as unknown[]).length).toBe(0);
      await own().post(`/api/v1/reportcards/report-cards/${W.ids.reportCard}/publish`, {});
      expect(((await parent().get(`/api/v1/reportcards/children/${mine()}/report-cards`)).body.items as unknown[]).length).toBe(1);
    });
  });

  // ===========================================================================================================
  describe("(14a) portail étudiant et périmètre de l'enseignant : chacun ne voit que ce qui le concerne", () => {
    let student: Actor;
    const mine = (): string => W.students[0]!.id;
    const otherId = (): string => W.students[1]!.id;

    it("l'étudiant 1 reçoit son accès de portail (rôle système eleve) : ses données, jamais celles de ses camarades", async () => {
      await own().patch(`/api/v1/people/students/${mine()}`, { person: { email: "etudiant1@horizon.test" } });
      const person = await own().get(`/api/v1/people/students/${mine()}`);
      const inv = await own().post(`/api/v1/people/persons/${person.body.personId}/portal-invitation`, { quality: "STUDENT" }, [200, 201]);
      expect(inv.body.invited).toBe(true);
      student = await activatePortalAccount(p, T().slug, "etudiant1@horizon.test", "eleve");
      const me = await student.get("/api/v1/people/me/student");
      expect(me.body.id ?? me.body.student?.id).toBe(mine());
      const enr = await student.get("/api/v1/academic/me/enrollments");
      expect(JSON.stringify(enr.body)).toContain(W.students[0]!.enrollmentId);
      expect(JSON.stringify(enr.body)).not.toContain(W.students[1]!.enrollmentId);
      const grades = await student.get("/api/v1/assess/me/grades");
      expect((grades.body.items as unknown[]).length).toBeGreaterThanOrEqual(8);
      const cards = await student.get("/api/v1/reportcards/me/report-cards");
      expect((cards.body.items as Array<{ studentId: string }>).every((c) => c.studentId === mine())).toBe(true);
      expect((cards.body.items as unknown[]).length).toBe(1);
      await student.get("/api/v1/higher/me/credits");
      const docs = await student.get("/api/v1/higher/me/documents");
      expect(JSON.stringify(docs.body)).toContain(W.ids.document); // son diplôme publié
      await student.get("/api/v1/attendance/me/attendance");
      const res = await student.raw("GET", "/api/v1/results/me/results");
      expect([200, 403]).toContain(res.status);
    });

    it("l'étudiant n'accède ni aux autres étudiants, ni à l'administration, ni aux espaces parent", async () => {
      for (const url of [
        `/api/v1/people/students/${otherId()}`,
        "/api/v1/people/students",
        "/api/v1/people/children",
        `/api/v1/higher/children/${otherId()}/credits`,
        `/api/v1/assess/children/${otherId()}/grades`,
        "/api/v1/academic/enrollments",
        "/api/v1/finance/invoices",
        "/api/v1/payroll/payslips",
      ]) {
        const res = await student.raw("GET", url);
        expect([403, 404], `${url} : ${res.status}`).toContain(res.status);
      }
      // Le bulletin d'un camarade : même réponse qu'un bulletin inexistant.
      const card = (await own().get(`/api/v1/reportcards/report-cards?studentId=${otherId()}&live=true`)).body.items[0] as { id: string };
      expect((await student.raw("GET", `/api/v1/reportcards/report-cards/${card.id}/pdf`)).status).toBe(404);
    });

    it("l'enseignant voit les étudiants de SA classe (fiche réduite), pas un étudiant hors de ses classes ; aucun droit de gestion", async () => {
      const teacher = W.teacher as Actor;
      const list = await teacher.get("/api/v1/people/students");
      expect(JSON.stringify(list.body)).toContain(mine());
      const outsider = await own().post("/api/v1/people/students", { person: { lastName: "HORSCLASSE", firstName: "Zoe", sex: "F", birthDate: "2005-05-15" } }, 201);
      const outsiderId = outsider.body.student.id as string;
      expect((await teacher.raw("GET", `/api/v1/people/students/${outsiderId}`)).status).toBe(404);
      expect(JSON.stringify((await teacher.get("/api/v1/people/students")).body)).not.toContain(outsiderId);
      for (const [method, url, body] of [
        ["POST", "/api/v1/academic/enrollments", { studentId: mine(), classroomId: W.classroomId }],
        ["POST", "/api/v1/people/students", { person: { lastName: "X", firstName: "Y", sex: "M" } }],
        ["GET", "/api/v1/finance/invoices", undefined],
        ["GET", "/api/v1/payroll/payslips", undefined],
        ["GET", "/api/v1/audit/logs", undefined],
      ] as Array<[string, string, unknown]>) {
        expect((await teacher.raw(method, url, body)).status, `${method} ${url}`).toBe(403);
      }
    });

    it("le bulletin de l'étudiant 2 porte son assiduité réelle (adaptateur attendance -> reportcards) : 1 séance d'absence", async () => {
      const detail = await own().get(`/api/v1/reportcards/report-cards/${W.ids.reportCard}`);
      const att = detail.body.snapshot.attendance;
      expect(att, "l'assiduité doit figurer au bulletin").not.toBeNull();
      expect(att).toEqual({ lateCount: 0, justifiedMinutes: 0, unjustifiedMinutes: 120 }); // 1 séance de 2 h manquée, aucun justificatif
    });
  });

  // ===========================================================================================================
  describe("(14a2) congé de l'enseignant : la séance à venir est signalée « à remplacer » par l'événement, puis un remplaçant est désigné", () => {
    const today = iso(new Date());
    const dir = (): Actor => W.directeur as Actor;
    let leaveId: string;
    let substituteStaffId: string;
    let futureOccId: string;

    it("l'enseignant demande un congé annuel (rôle système : sa propre demande), la direction l'approuve", async () => {
      const req = await (W.teacher as Actor).post("/api/v1/attendance/staff/leaves", { leaveTypeCode: "ANNUAL", startsOn: addDays(today, 1), endsOn: addDays(today, 10), reason: "Congé annuel" }, 201);
      leaveId = req.body.id;
      expect(req.body.status).toBe("REQUESTED");
      // Il ne peut pas décider de son propre congé.
      const self = await (W.teacher as Actor).raw("POST", `/api/v1/attendance/staff/leaves/${leaveId}/approve`, {});
      expect(self.status).toBe(403);
      const ok = await dir().post(`/api/v1/attendance/staff/leaves/${leaveId}/approve`, { note: "Accordé" });
      expect(ok.body.status).toBe("APPROVED");
    });

    it("événement attendance.staff_leave.approved -> scheduling : les séances PLANIFIÉES du congé sont signalées à remplacer", async () => {
      const pending = await waitFor(
        async () => {
          const r = await dir().get(`/api/v1/scheduling/occurrences/pending-replacements?from=${addDays(today, 1)}&to=${addDays(today, 10)}`);
          return (r.body.items as unknown[]).length > 0 ? (r.body.items as Array<{ id: string; startsAt: string; staff: Array<{ staffId: string }> }>) : false;
        },
        { label: "séances à remplacer signalées après l'approbation du congé", timeoutMs: 45_000 },
      );
      futureOccId = pending[0]!.id;
      expect(pending.every((o) => Date.parse(o.startsAt) > Date.now())).toBe(true);
    });

    it("un remplaçant (autre fiche de personnel) est désigné : la séance n'est plus à remplacer ; l'enseignant d'origine reste tracé", async () => {
      const cats = await own().get("/api/v1/people/reference/staff-categories");
      const cat = (cats.body.items as Array<{ code: string; canTeach: boolean }>).find((c) => c.canTeach)!;
      const sub = await own().post("/api/v1/people/staff", { person: { lastName: "REMPLACANT", firstName: "Eli", sex: "M", birthDate: "1990-01-01" }, categoryCode: cat.code, hiredOn: "2024-01-01" }, 201);
      substituteStaffId = sub.body.staff?.id ?? sub.body.id;
      const res = await dir().post(`/api/v1/scheduling/occurrences/${futureOccId}/substitute`, { originalStaffId: W.teacherStaffId, substituteStaffId, reason: "Congé annuel de l'enseignant titulaire" }, [200, 201]);
      expect(JSON.stringify(res.body)).toContain(substituteStaffId);
      const after = await dir().get(`/api/v1/scheduling/occurrences/pending-replacements?from=${addDays(today, 1)}&to=${addDays(today, 10)}`);
      expect((after.body.items as Array<{ id: string }>).some((o) => o.id === futureOccId)).toBe(false);
      const history = await dir().get(`/api/v1/scheduling/occurrences/${futureOccId}/history`);
      expect(JSON.stringify(history.body)).toContain(W.teacherStaffId);
    });
  });

  // ===========================================================================================================
  describe("(14a3) départ d'un membre : la suspension de son accès le coupe sur TOUS les modules, immédiatement", () => {
    it("le propriétaire suspend l'accès de l'enseignant : ses jetons sont refusés partout et définitivement ; la réactivation exige une NOUVELLE connexion", async () => {
      const teacher = W.teacher as Actor;
      const members = await own().get("/api/v1/iam/admin/members");
      const m = (members.body.members as Array<{ membershipId: string; identityId: string }>).find((x) => x.identityId === teacher.identityId)!;
      const probes = ["/api/v1/people/me/staff", "/api/v1/attendance/sessions", "/api/v1/assess/assessments", "/api/v1/scheduling/me/today", "/api/v1/payroll/my/payslips"];
      for (const url of probes) expect((await teacher.raw("GET", url)).status, url).toBe(200);
      await own().patch(`/api/v1/iam/admin/members/${m.membershipId}`, { status: "suspended" });
      for (const url of probes) expect([401, 403], url).toContain((await teacher.raw("GET", url)).status);
      await own().patch(`/api/v1/iam/admin/members/${m.membershipId}`, { status: "active" });
      // Les sessions révoquées par la suspension ne ressuscitent pas : l'ancien jeton reste refusé...
      for (const url of probes) expect([401, 403], `${url} (ancien jeton)`).toContain((await teacher.raw("GET", url)).status);
      // ... une nouvelle connexion rétablit l'accès.
      W.teacher = actorFrom(p.http, "enseignant", "enseignant@horizon.test", await loginPlain(p, "enseignant@horizon.test", T().slug));
      for (const url of probes) expect((await (W.teacher as Actor).raw("GET", url)).status, `${url} après reconnexion`).toBe(200);
    });
  });

  // ===========================================================================================================
  describe("(14a4) jobs planifiés : chacun s'exécute sur les données réelles de l'année, avec les ports branchés du worker", () => {
    it("TOUS les jobs découverts (modules + socle) se terminent sans erreur lorsqu'on les déclenche à la main", async () => {
      const scheduler = p.worker.scheduler!;
      const names = scheduler.jobNames;
      // Un job par module au moins : si un module perdait ses jobs (découverte, bundle), ce test le dirait.
      for (const expected of [
        "academic.expire-holds",
        "attendance.recompute-summaries",
        "finance.mark-overdue-invoices",
        "higher.expire-credits",
        "payroll.fail-stale-runs",
        "people.emit-expiring-qualifications",
        "reportcards.integrity-check",
        "results.process-recomputes",
        "rules.replay-reproducibility",
        "scheduling.generate-occurrences",
      ]) {
        expect(names, `job ${expected} découvert`).toContain(expected);
      }
      const failures: string[] = [];
      for (const name of names) {
        try {
          const outcome = await scheduler.run(name, `p2-${name}`.slice(0, 80));
          if (outcome.status !== "completed") failures.push(`${name} : ${JSON.stringify(outcome)}`);
        } catch (e) {
          failures.push(`${name} : ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("la génération glissante est idempotente : relancée, elle ne crée aucune séance de plus ; la reproductibilité des règles n'a trouvé AUCUN écart", async () => {
      const count = async (): Promise<number> => (await p.db.admin.query("SELECT count(*)::int AS n FROM scheduling.session_occurrences WHERE tenant_id = $1", [T().tenantId])).rows[0].n;
      const before = await count();
      await p.worker.scheduler!.run("scheduling.generate-occurrences", "p2-gen-2");
      expect(await count()).toBe(before);
      const mismatches = await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'rules.replay.mismatch'", [T().tenantId]);
      expect(mismatches.rows[0].n).toBe(0);
    });
  });

  // ===========================================================================================================
  describe("(14b) un étudiant quitte l'établissement : son inscription est CLOSE par l événement de statut (people -> academic)", () => {
    it("inscrit et confirmé (frais d'inscription payés), puis déclaré « transféré » : l inscription passe à TRANSFERRED_OUT sans intervention", async () => {
      const created = await own().post("/api/v1/people/students", { person: { lastName: "ETUDIANT4", firstName: "Salif", sex: "M", birthDate: "2005-04-14", birthPlace: "Bouaké" } }, 201);
      const studentId = created.body.student.id as string;
      const enrollment = await own().post("/api/v1/academic/enrollments", { studentId, classroomId: W.classroomId }, 201);
      const enrollmentId = enrollment.body.id as string;
      expect(enrollment.body.status).toBe("PENDING");
      const inv = await own().post(
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: studentId, enrollmentId, academicYear: W.year.code, items: [{ feeCode: "INSC" }], issue: true },
        [200, 201],
        { "idempotency-key": "p2-inv-etu4" },
      );
      await own().post(
        "/api/v1/finance/payments",
        { learnerId: studentId, enrollmentId, amount: 50000, method: "TRANSFER", reference: "VIR-4", allocation: { mode: "AUTO", invoiceIds: [inv.body.invoices[0].id] } },
        [200, 201],
        { "idempotency-key": "p2-vir-etu4" },
      );
      const status = async (): Promise<string> => (await own().get(`/api/v1/academic/enrollments/${enrollmentId}`)).body.enrollment.status as string;
      await waitFor(async () => (await status()) === "ACTIVE", { label: "inscription de l'étudiant 4 confirmée", timeoutMs: 45_000 });

      await own().post(`/api/v1/people/students/${studentId}/status`, { status: "TRANSFERRED_OUT", reasonText: "Transfert vers un autre établissement" });
      await waitFor(async () => (await status()) === "TRANSFERRED_OUT", { label: "inscription passée à TRANSFERRED_OUT par l événement people.student.status_changed", timeoutMs: 45_000 });
      // L'historique de l'inscription garde la trace (motif automatique).
      const history = await own().get(`/api/v1/academic/enrollments/${enrollmentId}/history`);
      expect(JSON.stringify(history.body)).toMatch(/TRANSFERRED_OUT/);
      // Les résultats de la période close (3 étudiants) n'ont pas bougé.
      const results = await p.db.admin.query("SELECT count(*)::int AS n FROM results.period_results WHERE tenant_id = $1 AND status = 'FINAL' AND academic_period_id = $2", [T().tenantId, W.periodIds[0]]);
      expect(results.rows[0].n).toBe(3);
    });
  });

  // ===========================================================================================================
  describe("(14c) clôture de l'ANNÉE : les abonnés archivent l'emploi du temps, closent les affectations et les périodes de paie", () => {
    const dir = (): Actor => W.directeur as Actor;

    it("l'année ne se clôt pas tant qu'une période reste ouverte ; le second semestre est ouvert puis clos, puis l'année", async () => {
      const refused = await dir().raw("POST", `/api/v1/academic/years/${W.year.id}/close`, { reason: "Fin d'année" });
      expect([409, 422], JSON.stringify(refused.body)).toContain(refused.status);
      const s2 = W.periodIds[1];
      await dir().post(`/api/v1/academic/periods/${s2}/open`, {});
      await dir().post(`/api/v1/academic/periods/${s2}/close-grading`, {});
      await dir().post(`/api/v1/academic/periods/${s2}/close`, {});
      const closed = await dir().post(`/api/v1/academic/years/${W.year.id}/close`, { reason: "Fin de l'année simulée" });
      expect(closed.body.status).toBe("CLOSED");
    });

    it("effets par événements : emploi du temps ARCHIVÉ (scheduling), affectation de l'enseignant TERMINÉE (people), période de paie CLOSE (payroll)", async () => {
      await waitFor(async () => (await own().get(`/api/v1/scheduling/timetables?academicYearId=${W.year.id}`)).body.items?.every((t: { status: string }) => t.status === "ARCHIVED"), { label: "emploi du temps archivé", timeoutMs: 45_000 });
      await waitFor(
        async () => {
          const r = await own().get(`/api/v1/people/staff/${W.teacherStaffId}/assignments`);
          const items = (r.body.items ?? r.body.assignments ?? []) as Array<{ status: string }>;
          return items.length > 0 && items.every((a) => a.status === "ENDED");
        },
        { label: "affectations terminées", timeoutMs: 45_000 },
      );
      await waitFor(async () => ((await own().get(`/api/v1/payroll/periods`)).body.items as Array<{ status: string }>).every((x) => x.status === "CLOSED"), { label: "périodes de paie closes", timeoutMs: 45_000 });
      // Le curriculum publié est verrouillé : plus d'amendement structurel silencieux.
      const version = await own().get(`/api/v1/academic/curriculum-versions/${W.versionId}`);
      expect(JSON.stringify(version.body)).toMatch(/LOCKED/);
    });
  });

  // ===========================================================================================================
  describe("(15) santé asynchrone : outbox publiée, aucune lettre morte, aucun abonné en échec", () => {
    it("tous les événements de l'année ont été relayés ; la file de lettres mortes est vide", async () => {
      await waitFor(
        async () => (await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE published_at IS NULL")).rows[0].n === 0,
        { label: "plus aucun événement en attente de relais", timeoutMs: 60_000 },
      );
      const failed = await p.db.admin.query("SELECT type, last_error FROM kernel.domain_events WHERE last_error IS NOT NULL LIMIT 5");
      expect(failed.rows, JSON.stringify(failed.rows)).toEqual([]);
      const redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
      try {
        const dlq = new DeadLetterAdmin(redis, p.queuePrefix);
        expect(await dlq.count(), JSON.stringify(await dlq.list(10))).toBe(0);
      } finally {
        await redis.quit().catch(() => undefined);
      }
    });

    it("en fin d'année, le journal d'audit contient la clôture de l'année et sa CHAÎNE reste valide malgré les écritures concurrentes (directes et par événements)", async () => {
      await new Promise((r) => setTimeout(r, 1500)); // derniers événements d'audit relayés
      const all = await readAuditLog(p, own().token);
      const actions = new Set(all.map((e) => String(e.action)));
      for (const a of ["academic.year.closed", "payroll.payslip.paid", "results.period.closed", "higher.award.created", "reportcards.report_cards.published", "people.person.account_invited"]) {
        expect(actions.has(a), `action d'audit ${a}`).toBe(true);
      }
      const res = await own().get("/api/v1/audit/verify");
      expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
      expect(res.body.checked).toBeGreaterThanOrEqual(all.length);
      // Même chose pour le second établissement : sa chaîne est indépendante de celle de A.
      const sec = await p.db.admin.query("SELECT DISTINCT tenant_id FROM audit.audit_log");
      expect(sec.rows.length).toBeGreaterThanOrEqual(2);
    });

    it("les abonnés qui portent le scénario ont TOUS réellement traité des événements (aucun nom d'événement qui ne correspond à rien)", async () => {
      const rows = await p.db.admin.query("SELECT subscriber, count(*)::int AS n FROM kernel.processed_events GROUP BY subscriber ORDER BY subscriber");
      const done = new Map<string, number>(rows.rows.map((r) => [r.subscriber as string, r.n as number]));
      // Abonnés qui tiennent leur idempotence dans `kernel.processed_events`. Les autres (audit, scheduling, payroll, reportcards,
      // entitlements) sont idempotents par construction : leur effet est prouvé par les étapes précédentes (séance « réalisée »,
      // emploi du temps archivé, période de paie close, PDF rendu, essai ouvert).
      const mustHaveFired = [
        "academic.instantiate-reference-data",
        "academic.confirm-on-invoice-paid",
        "academic.withdraw-on-student-status",
        "assess.seed-assessment-types",
        "attendance.seed-reference-data",
        "attendance.refresh-summaries-on-period-change.closed",
        "attendance.refresh-summaries-on-enrollment-change.withdrawn",
        "higher.capitalize-on-period-closed",
        "higher.evaluate-diplomas-on-capitalized",
        "people.instantiate-reference-data",
        "people.project-enrollment",
        "people.end-assignments-on-year-closed",
        "rbac.instantiate-system-roles",
        "results.recompute-on-grade-published",
        "results.recompute-on-enrollment-created",
        "results.recompute-on-enrollment-withdrawn",
      ];
      for (const name of mustHaveFired) expect(done.get(name), `abonné ${name} jamais exécuté`).toBeGreaterThan(0);
    });

    it("le journal du worker ne contient AUCUN échec d'abonné ou de job (« job en échec », dead-letter, erreur)", () => {
      const lines = p.workerLog.map((l) => {
        try {
          return JSON.parse(l) as { level?: string; msg?: string; err?: string; worker?: string };
        } catch {
          return { level: "raw", msg: l };
        }
      });
      const bad = lines.filter((l) => l.level === "error" || /échec|dead-letter|port_unavailable/i.test(`${l.msg ?? ""} ${l.err ?? ""}`));
      expect(bad.map((l) => `${l.worker ?? ""} ${l.msg ?? ""} ${l.err ?? ""}`), p.workerLog.join("\n").slice(0, 3000)).toEqual([]);
    });
  });
});
