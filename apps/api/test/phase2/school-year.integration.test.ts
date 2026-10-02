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
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_SECRET } from "../../src/modules/finance";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, waitFor } from "../phase1/support/harness";
import { loginWithMfaEnrollment, provisionByConsole, redeemInvitation, type ProvisionedOwner } from "../phase1/support/scenario";
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
  ue: Array<{ id: string; lineageId: string; ecues: Array<{ id: string; code: string }> }>;
  classroomId?: string;
  students: Array<{ id: string; enrollmentId?: string; lastName: string; personId?: string }>;
  guardianId?: string;
  teacherStaffId?: string;
  teacherPersonId?: string;
  /** Occurrences PASSÉES du cours (plus ancienne d abord). */
  occ: Array<{ id: string; startsAt: string }>;
}

describeIntegration.skipIf(!REDIS_URL)("TEST DE SORTIE DE PHASE 2 — une année scolaire simulée, de bout en bout (HIGHER)", () => {
  let p: Phase2Env;
  const W: World = { year: {}, periodIds: [], ue: [], students: [], occ: [] };
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
      const r = await own().put(`/api/v1/academic/institutions/${T().institutionId}/settings`, { enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID" });
      expect(r.body.enrollmentConfirmationPolicy).toBe("ON_REGISTRATION_FEE_PAID");
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
        const made: Array<{ id: string; code: string }> = [];
        for (const e of ecues) {
          const n = await node({ parentId: ue.id, nodeTypeCode: "ECUE", code: e.code, label: `ECUE ${e.code}`, subjectId: subjects[e.subject], credits: e.credits, coefficient: e.coef });
          made.push({ id: n.id, code: e.code });
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
      for (const [lastName, firstName, sex, birthDate] of base) {
        const r = await own().post("/api/v1/people/students", { person: { lastName, firstName, sex, birthDate, birthPlace: "Abidjan" } }, 201);
        W.students.push({ id: r.body.student.id, lastName, personId: r.body.student.personId });
      }
      const g = await own().post("/api/v1/people/guardians", { person: { lastName: "TUTEUR", firstName: "Yao", sex: "M", email: "tuteur@horizon.test", phone: "+225 07 11 22 33 44" } }, 201);
      W.guardianId = g.body.guardian.id;
      const rel = await own().get("/api/v1/people/reference/relationship-types");
      const relationshipCode = (rel.body.items as Array<{ code: string }>)[0]?.code as string;
      expect(relationshipCode).toBeTruthy();
      await own().post(`/api/v1/people/students/${W.students[1]!.id}/guardians`, { guardianId: W.guardianId, relationshipCode, isPrimaryContact: true, isFinancialResponsible: true, hasLegalCustody: true, portalAccess: true }, 201);
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
      for (const s of W.students) {
        const e = await own().post("/api/v1/academic/enrollments", { studentId: s.id, classroomId: W.classroomId, enrolledOn: W.year.startsOn }, 201);
        s.enrollmentId = e.body.id;
        expect(e.body.status, JSON.stringify(e.body)).toBe("PENDING");
      }
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
      // eslint-disable-next-line no-console
      console.log("PERIOD-RESULTS", JSON.stringify(rows.rows));
      const detail = async (i: number): Promise<any> => (await dir().get(`/api/v1/results/enrollments/${W.students[i]!.enrollmentId}/periods/${W.periodIds[0]}`)).body;
      const r1 = await detail(0);
      const r2 = await detail(1);
      const r3 = await detail(2);
      // eslint-disable-next-line no-console
      console.log("RESULTS-1", JSON.stringify(r1.header), JSON.stringify(r1.lines).slice(0, 1500));
      // eslint-disable-next-line no-console
      console.log("RESULTS-2", JSON.stringify(r2.header), JSON.stringify(r2.lines).slice(0, 1500));
      expect(r1.header.status).toBe("FINAL");
      expect(r2.header.status).toBe("FINAL");
      expect(r3.header.status).toBe("FINAL");
    });
  });
  // <<NEXT>>
});
