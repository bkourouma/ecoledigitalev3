/**
 * PHASE 3 — PARCOURS PRIMARY DE BOUT EN BOUT sur la plateforme ASSEMBLÉE (vrais plugins, vrais adaptateurs inter-modules, vrai
 * worker en processus, Postgres + Redis jetables). Tout passe par HTTP avec de vrais comptes IAM (rôles système de `rbac`).
 *
 *   (1) console : provisionnement avec le MODÈLE DE PACK Primary (abonnement PROFESSIONAL + PRIMARY) ; modèle appliqué par événement :
 *       référentiels (academic, primary_school), catégories de frais (finance), liaisons de règles de DÉMONSTRATION (rules)
 *   (2) année, programme maternelle, classe : l'activation exige un TITULAIRE (garde de primary_school branchée sur academic)
 *   (3) admissions : candidature -> offre -> inscription -> frais d'inscription payés -> ENROLLED dérivé ; notifications mises en file
 *   (4) appel journalier ; (5) compétences ; (6) résultats (compteurs de compétences) ; (7) conseil des maîtres ; (8) bilan annuel SCELLÉ
 *   (9) archive d'année gelée ; (10) bandeau « démonstration » et aucune règle officielle inventée ; (11) isolation inter-tenants.
 *
 * TOUS les jeux de règles sont des PLACEHOLDERS (`source_kind = placeholder`) : aucune règle ivoirienne n'est inventée ; chaque
 * document dérivé porte le filigrane « règles de démonstration ». Les étapes partagent l'état : elles s'exécutent dans l'ordre.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, waitFor } from "../phase1/support/harness";
import { loginWithMfaEnrollment, provisionByConsole, redeemInvitation, type ProvisionedOwner } from "../phase1/support/scenario";
import { activatePortalAccount, actorFrom, expectStatus, onboardStaffMember, type Actor } from "../phase2/support/actors";
import { startPhase2Platform, type Phase2Env } from "../phase2/support/platform";
import { PLACEHOLDER_EFFECTIVE_FROM as PLACEHOLDER_RULES_START } from "../../src/modules/rules/seed/rulesets";
import { addDays, admitUntilPending, isoDay, openCampaign, type Admitted, type Campaign } from "./support/admissions";

interface World {
  T?: ProvisionedOwner;
  owner?: Actor;
  directeur?: Actor;
  instituteur?: Actor;
  yearId?: string;
  yearCode?: string;
  yearStart?: string;
  periodIds: string[];
  programId?: string;
  gradeLevelId?: string;
  versionId?: string;
  classroomId?: string;
  staffId?: string;
  campaign?: Campaign;
  pupils: Array<Admitted & { name: string; lastName: string }>;
  ids: Record<string, string>;
}

describeIntegration.skipIf(!REDIS_URL)("PHASE 3 — Primary : provisionnement avec modèle de pack -> admission -> inscription -> classe -> appel -> compétences -> conseil -> bilan scellé -> archive", () => {
  let p: Phase2Env;
  const W: World = { periodIds: [], pupils: [], ids: {} };
  const own = (): Actor => W.owner as Actor;
  const dir = (): Actor => W.directeur as Actor;
  const inst = (): Actor => W.instituteur as Actor;
  const T = (): ProvisionedOwner => W.T as ProvisionedOwner;

  beforeAll(async () => {
    p = await startPhase2Platform();
  }, 300_000);
  afterAll(async () => {
    await p?.stop();
  });

  // ===========================================================================================================
  describe("(1) console : provisionnement PRIMARY — le modèle de pack est appliqué par événement (worker)", () => {
    it("la console provisionne le tenant, puis l'abonnement PROFESSIONAL + pack PRIMARY ; propriétaire (MFA) et direction", async () => {
      W.T = await provisionByConsole(p, { name: "École Les Palmiers", slug: "palmiers", packs: ["PRIMARY"], ownerEmail: "owner@palmiers.test" });
      expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${T().tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE" } }), 200);
      await redeemInvitation(p, T().ownerEmail);
      W.owner = actorFrom(p.http, "owner", T().ownerEmail, await loginWithMfaEnrollment(p, T().ownerEmail, T().slug));
      W.directeur = await onboardStaffMember(p, own(), T().slug, "directeur@palmiers.test", "directeur");
      expect((await own().get("/api/v1/entitlements/me")).body.tenantId).toBe(T().tenantId);
    });

    it("academic : niveaux PS..CM2 et programmes du modèle de pack (événement tenancy.institution.created)", async () => {
      const levels = await waitFor(
        async () => {
          const r = await own().get("/api/v1/academic/reference/grade-levels");
          const codes = (r.body.items as Array<{ code: string }>).map((g) => g.code);
          return codes.includes("GS") && codes.includes("CM2") ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "niveaux du pack PRIMARY", timeoutMs: 45_000 },
      );
      W.gradeLevelId = levels.find((g) => g.code === "GS")!.id;
    });

    it("finance : catégories de frais REGISTRATION et TUITION créées par le modèle de pack, SANS aucun montant ni barème", async () => {
      const fees = await waitFor(
        async () => {
          const r = await own().get("/api/v1/finance/fees");
          const codes = (r.body.items as Array<{ code: string }>).map((f) => f.code);
          return codes.includes("REGISTRATION") && codes.includes("TUITION") ? (r.body.items as Array<{ id: string; code: string; category: string }>) : false;
        },
        { label: "catégories de frais du pack PRIMARY (finance.instantiate-pack)", timeoutMs: 45_000 },
      );
      expect(fees.find((f) => f.code === "REGISTRATION")?.category).toBe("REGISTRATION");
      W.ids.registrationFee = fees.find((f) => f.code === "REGISTRATION")!.id;
      const schedules = await p.db.admin.query("SELECT count(*)::int AS n FROM finance.fee_schedules WHERE tenant_id = $1", [T().tenantId]);
      expect(schedules.rows[0].n).toBe(0);
    });

    it("rules : liaisons par défaut vers les jeux de DÉMONSTRATION (CI-PRIMARY-PLACEHOLDER) posées par le modèle de pack ; aucun jeu officiel", async () => {
      const bindings = await waitFor(
        async () => {
          const r = await own().get("/api/v1/rules/bindings");
          const items = (r.body.items ?? r.body) as Array<{ contractId: string; ruleSetCode: string; levelCode?: string | null }>;
          return items.some((b) => b.contractId === "coef-period@1") && items.some((b) => b.contractId === "competency-period@1") ? items : false;
        },
        { label: "liaisons de règles du pack PRIMARY (rules.apply-pack-bindings)", timeoutMs: 45_000 },
      );
      expect(new Set(bindings.map((b) => b.ruleSetCode))).toEqual(new Set(["CI-PRIMARY-PLACEHOLDER"]));
      const kinds = await p.db.admin.query(
        `SELECT DISTINCT v.source_kind AS kind FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE s.code = 'CI-PRIMARY-PLACEHOLDER'`,
      );
      expect(kinds.rows.map((r) => r.kind)).toEqual(["placeholder"]);
    });

    it("primary_school : échelle et référentiels de démonstration instanciés et PUBLIÉS ; attendance : politique d'appel journalier du pack", async () => {
      const frameworks = await waitFor(
        async () => {
          const r = await own().get("/api/v1/primary_school/frameworks");
          const items = (r.body.items ?? r.body) as Array<{ code: string; status: string; sourceKind?: string }>;
          return items.some((f) => f.code === "PRESCHOOL_DEMO") ? items : false;
        },
        { label: "référentiels du pack PRIMARY (primary_school.instantiate-reference-data)", timeoutMs: 45_000 },
      );
      expect(frameworks.find((f) => f.code === "PRESCHOOL_DEMO")?.status).toBe("PUBLISHED");
      const policies = await p.db.admin.query("SELECT education_level_code FROM attendance.call_policies WHERE tenant_id = $1 AND call_scope = 'DAILY' ORDER BY 1", [T().tenantId]);
      expect(policies.rows.map((r) => r.education_level_code)).toEqual(["PRESCHOOL", "PRIMARY"]);
    });
  });

  // ===========================================================================================================
  describe("(2) année, programme maternelle, classe : l'activation exige un TITULAIRE (garde de primary_school branchée sur academic)", () => {
    it("année contenant aujourd'hui, ouverte et courante ; deux semestres (le premier ouvert)", async () => {
      W.yearStart = [addDays(isoDay(new Date()), -120), PLACEHOLDER_RULES_START].sort().at(-1) as string; // les jeux de démonstration ne sont effectifs qu'à partir de cette date
      W.yearCode = `${W.yearStart.slice(0, 4)}-${addDays(W.yearStart, 364).slice(0, 4)}`;
      const y = await own().post("/api/v1/academic/years", { institutionId: T().institutionId, code: W.yearCode, label: "Année simulée (Primary)", startsOn: W.yearStart }, 201);
      W.yearId = y.body.id;
      await own().post(`/api/v1/academic/years/${W.yearId}/open`);
      await own().post(`/api/v1/academic/years/${W.yearId}/set-current`);
      const plan = await own().post(`/api/v1/academic/years/${W.yearId}/period-plan`, { planCode: "TWO_SEMESTERS" }, 201);
      W.periodIds = (plan.body.items as Array<{ id: string }>).map((x) => x.id);
      expect(W.periodIds).toHaveLength(2);
      await own().post(`/api/v1/academic/periods/${W.periodIds[0]}/open`);
    });

    it("programme MATERNELLE (modèle de pack) ; curriculum GS > S1 + S2, publié", async () => {
      const programs = await own().get(`/api/v1/academic/programs?institutionId=${T().institutionId}`);
      const maternelle = (programs.body.items as Array<{ id: string; code: string }>).find((x) => x.code === "MATERNELLE");
      expect(maternelle, JSON.stringify(programs.body)).toBeDefined();
      W.programId = maternelle!.id;
      const version = await own().post("/api/v1/academic/curriculum-versions", { programId: W.programId, academicYearId: W.yearId }, 201);
      W.versionId = version.body.id;
      const node = async (body: Record<string, unknown>): Promise<any> => (await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/nodes`, body, 201)).body;
      const level = await node({ nodeTypeCode: "LEVEL", code: "GS", label: "Grande Section", gradeLevelId: W.gradeLevelId });
      await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
      await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S2", label: "Semestre 2", periodTypeCode: "SEMESTER", periodOrdinal: 2 });
      const check = await own().get(`/api/v1/academic/curriculum-versions/${W.versionId}/validate`);
      expect(JSON.stringify(check.body)).not.toMatch(/"severity":"error"/);
      expect((await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/publish`)).body.status).toBe("PUBLISHED");
    });

    it("ACTIVATION REFUSÉE sans titulaire : 409 `primary_school.homeroom_required` (garde de pack appelée par academic)", async () => {
      const c = await own().post(
        "/api/v1/academic/classrooms",
        { institutionId: T().institutionId, academicYearId: W.yearId, programId: W.programId, gradeLevelId: W.gradeLevelId, curriculumVersionId: W.versionId, code: "GS-A", name: "Grande Section A", capacity: 25 },
        201,
      );
      W.classroomId = c.body.id;
      const refused = await own().raw("POST", `/api/v1/academic/classrooms/${W.classroomId}/activate`, {});
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(JSON.stringify(refused.body)).toContain("primary_school.homeroom_required");
      expect((await own().get(`/api/v1/academic/classrooms/${W.classroomId}`)).body.status).toBe("DRAFT");
    });

    it("l'instituteur : fiche de personnel, compte de portail (rôle système `instituteur`), affecté TITULAIRE généraliste (HOMEROOM) ; la classe s'active", async () => {
      const cats = await own().get("/api/v1/people/reference/staff-categories");
      const teacherCat = (cats.body.items as Array<{ code: string; canTeach: boolean }>).find((c) => c.canTeach);
      expect(teacherCat, "catégorie de personnel enseignant").toBeDefined();
      const s = await own().post("/api/v1/people/staff", { person: { lastName: "INSTITUTEUR", firstName: "Issa", sex: "M", birthDate: "1988-04-04", email: "instituteur@palmiers.test" }, categoryCode: teacherCat!.code, hiredOn: "2020-09-01" }, 201);
      W.staffId = s.body.staff?.id ?? s.body.id;
      const inv = await own().post(`/api/v1/people/staff/${W.staffId}/portal-invitation`, { role: "instituteur" }, [200, 201]);
      expect(inv.body.invited).toBe(true);
      W.instituteur = await activatePortalAccount(p, T().slug, "instituteur@palmiers.test", "instituteur");
      await own().post(
        "/api/v1/people/teaching-assignments",
        { staffId: W.staffId, academicYearId: W.yearId, classroomId: W.classroomId, roleCode: "HOMEROOM", coversAllSubjects: true, startsOn: W.yearStart },
        201,
      );
      const activated = await own().post(`/api/v1/academic/classrooms/${W.classroomId}/activate`, {});
      expect(activated.status).toBeLessThan(300);
      expect((await own().get(`/api/v1/academic/classrooms/${W.classroomId}`)).body.status).toBe("ACTIVE");
    });

    it("dérogation d'établissement : sans titulaire, une classe s'active si la règle est désactivée — et la dérogation est AUDITÉE", async () => {
      const programId = W.programId as string;
      const c = await own().post(
        "/api/v1/academic/classrooms",
        { institutionId: T().institutionId, academicYearId: W.yearId, programId, gradeLevelId: W.gradeLevelId, curriculumVersionId: W.versionId, code: "GS-B", name: "Grande Section B", capacity: 25 },
        201,
      );
      expect((await own().raw("POST", `/api/v1/academic/classrooms/${c.body.id}/activate`, {})).status).toBe(409);
      await own().put("/api/v1/primary_school/settings", { institutionId: T().institutionId, requireHomeroomForActivation: false });
      const ok = await own().post(`/api/v1/academic/classrooms/${c.body.id}/activate`, {});
      expect(ok.status).toBeLessThan(300);
      await own().put("/api/v1/primary_school/settings", { institutionId: T().institutionId, requireHomeroomForActivation: true });
      const waived = await p.db.admin.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE tenant_id = $1 AND action = 'primary_school.activation.homeroom_waived'", [T().tenantId]);
      expect(waived.rows[0].n).toBe(1);
    });
  });

  // ===========================================================================================================
  describe("(3) admissions : candidature -> offre -> inscription -> frais payés -> ENROLLED dérivé ; notifications mises en file", () => {
    const NAMES: Array<[string, string, "M" | "F", string]> = [
      ["Awa", "KONE", "F", "2020-02-11"],
      ["Koffi", "YAO", "M", "2020-03-12"],
      ["Mariam", "TRAORE", "F", "2020-04-13"],
    ];

    it("barème des frais d'inscription (frais REGISTRATION créé par le modèle de pack) ; politique : confirmation à la réception des frais", async () => {
      await own().post("/api/v1/finance/fee-schedules", { feeId: W.ids.registrationFee, academicYear: W.yearCode, amount: 25000, effectiveFrom: "2020-01-01" }, 201);
      const r = await own().put(`/api/v1/academic/institutions/${T().institutionId}/settings`, { enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID" });
      expect(r.body.enrollmentConfirmationPolicy).toBe("ON_REGISTRATION_FEE_PAID");
    });

    it("campagne ouverte sur le workflow publié ; trois candidatures menées jusqu'à l'inscription EN ATTENTE (élève INACTIF, facture des frais)", async () => {
      W.campaign = await openCampaign(own(), { institutionId: T().institutionId, academicYearId: W.yearId as string, code: "RENTREE", grade: "GS", seats: 5 });
      for (const [i, [firstName, lastName, gender, birthDate]] of NAMES.entries()) {
        const a = await admitUntilPending(
          own(),
          W.campaign,
          { firstName, lastName, birthDate, gender, grade: "GS", guardianEmail: `tuteur${i + 1}@palmiers.test`, guardianPhone: `+225 07 00 00 00 0${i + 1}`, guardianFirstName: `Parent${i + 1}` },
          W.classroomId as string,
        );
        W.pupils.push({ ...a, name: `${lastName} ${firstName}`, lastName });
        expect(a.invoiceId, "facture des frais d'inscription").toBeTruthy();
        const student = await p.db.admin.query("SELECT status FROM people.students WHERE id = $1", [a.studentId]);
        expect(student.rows[0].status).toBe("INACTIVE");
        expect((await own().get(`/api/v1/academic/enrollments/${a.enrollmentId}`)).body.enrollment.status).toBe("PENDING");
      }
      expect(new Set(W.pupils.map((x) => x.studentId)).size).toBe(3);
    });

    it("notifications : la candidature reçue et l'offre sont mises EN FILE par `notifications` (plus d'échec fermé « canal indisponible »)", async () => {
      const queued = await waitFor(
        async () => {
          const r = await p.db.admin.query(
            "SELECT count(*)::int AS n FROM notifications.deliveries WHERE tenant_id = $1 AND context ->> 'origin' = 'admissions'",
            [T().tenantId],
          );
          return r.rows[0].n >= 6 ? r.rows[0].n : false;
        },
        { label: "remises d'admissions dans le journal de notifications", timeoutMs: 30_000 },
      );
      expect(queued).toBeGreaterThanOrEqual(6);
      const log = await p.db.admin.query("SELECT status, error_code FROM admissions.notification_log WHERE tenant_id = $1 AND dedupe_key NOT LIKE 'contact:%'", [T().tenantId]);
      expect(log.rows.length).toBeGreaterThanOrEqual(6);
      expect(log.rows.filter((r) => r.error_code === "CHANNEL_UNAVAILABLE")).toHaveLength(0);
    });

    it("paiement des frais d'inscription (virement) : inscription CONFIRMÉE par événement, élève ACTIF, dossier ENROLLED (dérivé, jamais posé à la main)", async () => {
      for (const [i, pupil] of W.pupils.entries()) {
        const pay = await own().post(
          "/api/v1/finance/payments",
          { learnerId: pupil.studentId, enrollmentId: pupil.enrollmentId, amount: 25000, method: "TRANSFER", reference: `VIR-P3-${i + 1}`, allocation: { mode: "AUTO", invoiceIds: [pupil.invoiceId] } },
          [200, 201],
          { "idempotency-key": `p3-vir-${i + 1}` },
        );
        expect(pay.body.payment.status).toBe("CONFIRMED");
      }
      for (const pupil of W.pupils) {
        await waitFor(async () => (await own().get(`/api/v1/academic/enrollments/${pupil.enrollmentId}`)).body.enrollment.status === "ACTIVE", { label: `inscription de ${pupil.name} confirmée`, timeoutMs: 45_000 });
        await waitFor(async () => (await own().get(`/api/v1/admissions/applications/${pupil.applicationId}`)).body.status === "ENROLLED", { label: `dossier de ${pupil.name} ENROLLED`, timeoutMs: 45_000 });
        const student = await p.db.admin.query("SELECT status FROM people.students WHERE id = $1", [pupil.studentId]);
        expect(student.rows[0].status).toBe("ACTIVE");
      }
    });
  });

  // ===========================================================================================================
  describe("(4) appel JOURNALIER (politique PRIMARY_DAILY du modèle de pack) par l'instituteur titulaire", () => {
    const days: string[] = [];
    it("l'instituteur ouvre l'appel du jour (présent / absent / en retard), le soumet ; la direction le valide", async () => {
      // Les élèves sont inscrits AUJOURD'HUI (par l'admission) : leur liste d'appel n'existe qu'à partir de cette date.
      days.push(isoDay(new Date()));
      for (const [k, day] of days.entries()) {
        const opened = await inst().post("/api/v1/attendance/sessions", { scope: "DAILY", classroomId: W.classroomId, date: day }, [200, 201]);
        const sessionId = opened.body.session.id as string;
        expect(opened.body.session.status).toBe("OPEN");
        const entries = W.pupils.map((pupil, i) => ({
          studentId: pupil.studentId,
          statusCode: i === 1 ? "ABSENT" : i === 2 ? "LATE" : "PRESENT",
          ...(i === 2 ? { minutesLate: 10 } : {}),
        }));
        const marked = await inst().put(`/api/v1/attendance/sessions/${sessionId}/records`, { entries });
        expect(marked.body.created).toBe(3);
        const submitted = await inst().post(`/api/v1/attendance/sessions/${sessionId}/submit`, {});
        expect(submitted.body.session.status).toBe("SUBMITTED");
        expect((await inst().raw("POST", `/api/v1/attendance/sessions/${sessionId}/validate`, {})).status).toBe(403); // séparation des tâches
        expect((await dir().post(`/api/v1/attendance/sessions/${sessionId}/validate`, {})).body.status).toBe("VALIDATED");
        W.ids[`attendance${k}`] = sessionId;
      }
    });

    it("rejouer l'ouverture d'un jour ne crée aucun second appel ; le registre d'appel mensuel du pack compte les absences en journées", async () => {
      const again = await inst().post("/api/v1/attendance/sessions", { scope: "DAILY", classroomId: W.classroomId, date: days[0] }, [200, 201]);
      expect(again.body.created).toBe(false);
      expect(again.body.session.id).toBe(W.ids.attendance0);
      const list = await dir().get(`/api/v1/attendance/sessions?classroomId=${W.classroomId}`);
      expect(list.body.items).toHaveLength(1);
      const month = days[0]!.slice(0, 7);
      const register = await dir().get(`/api/v1/primary_school/reports/attendance-register?classroomId=${W.classroomId}&month=${month}`);
      expect(JSON.stringify(register.body), JSON.stringify(register.body).slice(0, 900)).toContain(W.pupils[1]!.name.split(" ")[0] as string);
    });
  });

  // ===========================================================================================================
  describe("(5) compétences (maternelle, SANS note) : grille, saisie en lot idempotente, validation", () => {
    let frameworkId = "";
    let levels: Record<string, string> = {};
    let competencyIds: string[] = [];

    it("l'instituteur ne voit que SA classe ; la grille porte le référentiel PUBLIÉ de démonstration et l'échelle", async () => {
      const mine = await inst().get("/api/v1/primary_school/my-classrooms");
      const classes = mine.body.items as Array<{ classroomId: string; isHomeroom: boolean }>;
      expect(classes.map((c) => c.classroomId)).toContain(W.classroomId);
      expect(classes.find((c) => c.classroomId === W.classroomId)?.isHomeroom).toBe(true);
      const sheet = await inst().get(`/api/v1/primary_school/classrooms/${W.classroomId}/competency-sheet?periodId=${W.periodIds[0]}`);
      expect(sheet.body.framework.code).toBe("PRESCHOOL_DEMO");
      frameworkId = sheet.body.framework.id;
      competencyIds = (sheet.body.framework.domains as Array<{ competencies: Array<{ id: string }> }>).flatMap((d) => d.competencies.map((c) => c.id));
      expect(competencyIds).toHaveLength(3);
      levels = Object.fromEntries((sheet.body.framework.scale.levels as Array<{ code: string; id: string }>).map((l) => [l.code, l.id]));
      expect(Object.keys(levels)).toEqual(expect.arrayContaining(["N1", "N2", "N3", "N4"]));
      expect(sheet.body.students).toHaveLength(3);
      // aucune note, aucune moyenne : la grille ne porte que des niveaux de maîtrise
      expect(JSON.stringify(sheet.body)).not.toMatch(/"average"|"score"|"grade"/);
    });

    const linesFor = () =>
      W.pupils.flatMap((pupil, i) =>
        competencyIds
          // l'élève 3 n'est pas évalué sur la dernière compétence : « non évaluée » reste non évaluée (jamais zéro)
          .filter((_, c) => !(i === 2 && c === 2))
          .map((competencyId, c) => ({ enrollmentId: pupil.enrollmentId, competencyId, ratingLevelId: levels[i === 2 ? "N2" : c === 0 ? "N4" : "N3"] as string })),
      );

    it("saisie en lot de la période 1, REJEU identique = `unchanged` (convergence), puis validation de la période", async () => {
      const body = { classroomId: W.classroomId, periodId: W.periodIds[0], frameworkId, lines: linesFor() };
      const first = await inst().put("/api/v1/primary_school/competency-assessments/bulk", body);
      expect(first.body.created).toBe(8);
      const replay = await inst().put("/api/v1/primary_school/competency-assessments/bulk", body);
      expect(replay.body).toMatchObject({ created: 0, updated: 0, unchanged: 8 });
      const validated = await dir().post(`/api/v1/primary_school/classrooms/${W.classroomId}/periods/${W.periodIds[0]}/competencies/validate`, { frameworkId });
      expect(validated.body.validated).toBe(8);
      expect(validated.body.missing).toBe(1);
      // une ligne VALIDÉE ne se corrige plus par saisie : seule une révision tracée le permet
      const tamper = await inst().raw("PUT", "/api/v1/primary_school/competency-assessments/bulk", {
        ...body,
        lines: [{ ...linesFor()[0]!, ratingLevelId: levels.N1 }],
      });
      expect(JSON.stringify(tamper.body), String(tamper.status)).toMatch(/frozen|valid|révision|revision/i);
    });

    it("période 2 ouverte : saisie puis validation (mêmes compétences) ; la synthèse d'un élève est un COMPTAGE de niveaux, jamais une moyenne", async () => {
      await own().post(`/api/v1/academic/periods/${W.periodIds[1]}/open`);
      const body = { classroomId: W.classroomId, periodId: W.periodIds[1], frameworkId, lines: linesFor() };
      expect((await inst().put("/api/v1/primary_school/competency-assessments/bulk", body)).body.created).toBe(8);
      await dir().post(`/api/v1/primary_school/classrooms/${W.classroomId}/periods/${W.periodIds[1]}/competencies/validate`, { frameworkId });
      const summary = await inst().get(`/api/v1/primary_school/enrollments/${W.pupils[0]!.enrollmentId}/competency-summary`);
      expect(JSON.stringify(summary.body)).not.toMatch(/"average"|"mean"|"score"/);
      expect(summary.body.counts ?? summary.body.summary ?? summary.body).toBeTruthy();
    });
  });

  // ===========================================================================================================
  describe("(6) résultats : la maternelle n'a ni note ni moyenne ; la décision de fin d'année part des COMPTEURS de compétences (primary_school -> results)", () => {
    const state = (idx: number): string => `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[idx]}`;

    it("réglage du tenant : pas de délibération exigée pour une période intermédiaire (conseil tenu à la fin de l'année)", async () => {
      const r = await own().put("/api/v1/results/settings", { requireDeliberation: false });
      expect(r.status).toBe(200);
    });

    it("période 1 : verrouillage puis CLÔTURE (aucune décision à ce stade : seule la dernière période décide)", async () => {
      expect((await dir().post(`${state(0)}/lock`, {})).body.status).toBe("GRADING_LOCKED");
      const closed = await dir().post(`${state(0)}/close`, {});
      expect(closed.body.state.status).toBe("CLOSED");
      expect(closed.body.resultsCount).toBe(3);
    });

    it("dernière période : verrouillage = calcul des propositions À PARTIR DES COMPTEURS (évaluées / attendues), PENDING ou COUNCIL_REVIEW, jamais une décision", async () => {
      const locked = await dir().post(`${state(1)}/lock`, {});
      expect(locked.body.status).toBe("GRADING_LOCKED");
      W.ids.stateP2 = locked.body.id;
      const decisions = await dir().get(`/api/v1/results/decisions?stateId=${W.ids.stateP2}`);
      const items = decisions.body.items as Array<{ enrollmentId: string; kind: string; status: string; proposedCode: string | null }>;
      expect(items).toHaveLength(3);
      for (const d of items) {
        expect(d.kind).toBe("YEAR_END");
        expect(d.status).toBe("PROPOSED");
        expect(["PENDING", "COUNCIL_REVIEW"]).toContain(d.proposedCode);
      }
      // La preuve du branchement : les compteurs sont ceux de primary_school (3 attendues ; 3, 3 puis 2 évaluées).
      const rows = await p.db.admin.query(
        `SELECT h.enrollment_id, l.outputs FROM results.line_results l JOIN results.period_results h ON h.id = l.period_result_id
          WHERE l.tenant_id = $1 AND l.level = 'YEAR' AND h.academic_period_id = $2 AND h.status = 'DRAFT'`,
        [T().tenantId, W.periodIds[1]],
      );
      expect(rows.rows).toHaveLength(3);
      const of = (i: number) => rows.rows.find((r) => r.enrollment_id === W.pupils[i]!.enrollmentId)?.outputs;
      expect(of(0)).toMatchObject({ competencesEvaluated: 3, competencesExpected: 3 });
      expect(of(2)).toMatchObject({ competencesEvaluated: 2, competencesExpected: 3 });
    });
  });

  // ===========================================================================================================
  describe("(7) conseil des maîtres : dossiers, présence signée, décisions HUMAINES (la règle ne tranche jamais), procès-verbal", () => {
    let deliberationId = "";
    const caseOf: Record<string, string> = {};
    const today = isoDay(new Date());

    it("identité de l'établissement (exigée pour tout document officiel) ; fiches de personnel du président (direction) et du secrétaire du conseil", async () => {
      await own().put("/api/v1/reportcards/branding", { legalName: "École Les Palmiers", headerLeft: ["République de Côte d'Ivoire (démonstration)"], address: "Abidjan", primaryColor: "#14532D" });
      const cats = await own().get("/api/v1/people/reference/staff-categories");
      const any = (cats.body.items as Array<{ code: string }>)[0]?.code as string;
      for (const [key, last, mail] of [["chair", "DIRECTEUR", "chair@palmiers.test"], ["secretary", "SECRETAIRE", "secretaire@palmiers.test"]] as const) {
        const s = await own().post("/api/v1/people/staff", { person: { lastName: last, firstName: "Conseil", sex: "F", birthDate: "1980-01-01", email: mail }, categoryCode: any, hiredOn: "2019-09-01" }, 201);
        W.ids[key] = s.body.staff?.id ?? s.body.id;
      }
    });

    it("préparation par l'instituteur : un dossier par élève ; le jeu de règles de DÉMONSTRATION est signalé (bandeau)", async () => {
      const prep = await inst().post("/api/v1/primary_school/councils/prepare", { classroomId: W.classroomId, periodId: W.periodIds[1], heldOn: today }, [200, 201]);
      deliberationId = prep.body.deliberationId;
      W.ids.deliberation = deliberationId;
      expect(prep.body.counts).toMatchObject({ total: 3, open: 3, decided: 0 });
      expect(prep.body.ruleSourceKind).toBe("placeholder");
      for (const c of prep.body.cases as Array<{ id: string; enrollmentId: string; ruleProposalCode: string | null }>) {
        caseOf[c.enrollmentId] = c.id;
        expect(["PENDING", "COUNCIL_REVIEW"]).toContain(c.ruleProposalCode);
      }
      // rejouer ne crée rien
      const again = await inst().post("/api/v1/primary_school/councils/prepare", { classroomId: W.classroomId, periodId: W.periodIds[1], heldOn: today }, [200, 201]);
      expect(again.body.deliberationId).toBe(deliberationId);
      expect(again.body.cases).toHaveLength(3);
    });

    it("l'instituteur propose et note, mais ne préside pas : confirmer une décision lui est refusé (403)", async () => {
      const first = Object.values(caseOf)[0] as string;
      const note = await inst().patch(`/api/v1/primary_school/councils/${deliberationId}/cases/${first}`, { proposalCode: "PROMOTED", discussionNote: "À examiner en séance." });
      expect(note.body.status).toBe("OPEN");
      const denied = await inst().raw("POST", `/api/v1/primary_school/councils/${deliberationId}/cases/${first}/decide`, { finalCode: "PROMOTED", justification: "Décision tentée sans le droit de présider le conseil." });
      expect(denied.status).toBe(403);
    });

    it("feuille de présence : président et secrétaire, signée par le titulaire ; le quorum n'est JAMAIS une constante (aucune règle de quorum dans le jeu fictif : présence comptée, non bloquante)", async () => {
      const o = await dir().put(`/api/v1/primary_school/councils/${deliberationId}/attendance`, {
        participants: [
          { staffId: W.staffId, roleCode: "HOMEROOM", convened: true, present: true },
          { staffId: W.ids.chair, roleCode: "CHAIR", convened: true, present: true },
          { staffId: W.ids.secretary, roleCode: "SECRETARY", convened: true, present: true },
        ],
        signedStaffIds: [W.staffId],
      });
      expect(o.body.quorum).toMatchObject({ convened: 3, present: 3 });
      expect(["rule", "none"]).toContain(o.body.quorum.source);
    });

    it("décisions du conseil : la règle propose (PENDING / COUNCIL_REVIEW), le conseil décide ; un écart exige une justification ; l'issue d'inscription de fin d'année est enregistrée", async () => {
      const [p0, p1, p2] = W.pupils as [(typeof W.pupils)[number], (typeof W.pupils)[number], (typeof W.pupils)[number]];
      // sans justification : refusé
      const noWhy = await dir().raw("POST", `/api/v1/primary_school/councils/${deliberationId}/cases/${caseOf[p0.enrollmentId]}/decide`, { finalCode: "PROMOTED" });
      expect(noWhy.status, JSON.stringify(noWhy.body)).toBeGreaterThanOrEqual(400);
      expect(noWhy.status).toBeLessThan(500);
      const d0 = await dir().post(`/api/v1/primary_school/councils/${deliberationId}/cases/${caseOf[p0.enrollmentId]}/decide`, { finalCode: "PROMOTED", justification: "Compétences acquises sur l'ensemble de l'année (décision de démonstration)." });
      expect(d0.body).toMatchObject({ finalCode: "PROMOTED", outcomeRecorded: "PROMOTED", status: "DECIDED" });
      const d1 = await dir().post(`/api/v1/primary_school/councils/${deliberationId}/cases/${caseOf[p1.enrollmentId]}/decide`, { finalCode: "PROMOTED", justification: "Progrès constants relevés par l'équipe (décision de démonstration)." });
      expect(d1.body.status).toBe("DECIDED");
      const d2 = await dir().post(`/api/v1/primary_school/councils/${deliberationId}/cases/${caseOf[p2.enrollmentId]}/decide`, { finalCode: "REPEAT", justification: "Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration)." });
      expect(d2.body).toMatchObject({ finalCode: "REPEAT", outcomeRecorded: "REPEATED" });
      // un dossier décidé ne se redécide pas
      const twice = await dir().raw("POST", `/api/v1/primary_school/councils/${deliberationId}/cases/${caseOf[p0.enrollmentId]}/decide`, { finalCode: "REPEAT", justification: "Tentative de décider une seconde fois le même dossier." });
      expect(twice.status).toBe(409);
      const overview = await dir().get(`/api/v1/primary_school/councils/${deliberationId}`);
      expect(overview.body.counts).toMatchObject({ total: 3, open: 0, decided: 3 });
    });

    it("procès-verbal : figé et demandé à reportcards (nature COUNCIL_MINUTES) ; le worker rend le PDF ; le document porte l'origine « démonstration »", async () => {
      const r = await dir().post(`/api/v1/primary_school/councils/${deliberationId}/minutes`, { heldOn: today }, 201);
      expect(r.status).toBe(201);
      await waitFor(async () => (await dir().get(`/api/v1/primary_school/councils/${deliberationId}`)).body.minutesDocumentId, { label: "procès-verbal du conseil émis", timeoutMs: 60_000 });
      const docs = await p.db.admin.query("SELECT render_status, snapshot ->> 'ruleSourceKind' AS kind FROM reportcards.official_documents WHERE tenant_id = $1 AND document_kind = 'COUNCIL_MINUTES'", [T().tenantId]);
      expect(docs.rows).toHaveLength(1);
      expect(docs.rows[0].kind).toBe("placeholder");
    });

    it("délibération TENUE (results) puis période close : résultats FINAL de fin d'année, décisions confirmées", async () => {
      const state = `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[1]}`;
      await dir().patch(`/api/v1/results/deliberations/${deliberationId}`, { status: "HELD", heldOn: isoDay(new Date()) });
      const closed = await dir().post(`${state}/close`, {});
      expect(closed.body.state.status).toBe("CLOSED");
      expect(closed.body.resultsCount).toBe(3);
      const year = await dir().get(`/api/v1/results/enrollments/${W.pupils[0]!.enrollmentId}/years/${W.yearId}`);
      expect(year.body.complete).toBe(true);
    });

    it("clôture académique des deux périodes de la classe (condition du scellement des bilans) ; le verrou de saisie est reflété dans primary_school", async () => {
      for (const periodId of W.periodIds) {
        const base = `/api/v1/academic/classrooms/${W.classroomId}/periods/${periodId}`;
        await dir().post(`${base}/close-grading`, {}, [200, 201, 409]);
        const closed = await dir().post(`${base}/close`, {}, [200, 201]);
        expect(closed.status).toBeLessThan(300);
      }
      await waitFor(
        async () => (await p.db.admin.query("SELECT count(*)::int AS n FROM primary_school.period_locks WHERE tenant_id = $1 AND classroom_id = $2 AND status = 'LOCKED'", [T().tenantId, W.classroomId])).rows[0].n === 2,
        { label: "miroir du verrou de période (événements academic.classroom_period.*)", timeoutMs: 30_000 },
      );
    });
  });

  // ===========================================================================================================
  describe("(8) bilan annuel SCELLÉ : préparation, scellement (sensible), PDF par reportcards avec filigrane « démonstration », immuabilité", () => {
    it("identité de l'établissement ; préparation d'un bilan par inscription", async () => {
      const prep = await dir().post("/api/v1/primary_school/annual-reviews/prepare", { classroomId: W.classroomId, academicYearId: W.yearId }, [200, 201]);
      expect(prep.body.created).toBe(3);
      const items = prep.body.reviews as Array<{ id: string; enrollmentId: string; status: string }>;
      // toutes les conditions étant réunies (périodes closes, résultat d'année, décision du conseil) : les bilans sont prêts à sceller
      expect(items.every((r) => r.status === "READY")).toBe(true);
      for (const r of items) W.ids[`review:${r.enrollmentId}`] = r.id;
    });

    it("l'instituteur ne scelle pas (droit sensible) ; la direction scelle chaque bilan : version vivante unique, empreinte, origine « placeholder »", async () => {
      const first = W.ids[`review:${W.pupils[0]!.enrollmentId}`] as string;
      expect((await inst().raw("POST", `/api/v1/primary_school/annual-reviews/${first}/seal`, {})).status).toBe(403);
      for (const pupil of W.pupils) {
        const sealed = await dir().post(`/api/v1/primary_school/annual-reviews/${W.ids[`review:${pupil.enrollmentId}`]}/seal`, {});
        expect(sealed.body.status).toBe("SEALED");
        expect(sealed.body.ruleSourceKind).toBe("placeholder");
        expect(sealed.body.contentHash ?? sealed.body.hash ?? sealed.body.sealedHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("événement `annual_review.sealed` -> reportcards : PDF rendu par le worker (nature ANNUAL_REVIEW), identifiant du document renseigné sur le bilan", async () => {
      for (const pupil of W.pupils) {
        const id = W.ids[`review:${pupil.enrollmentId}`];
        await waitFor(async () => (await dir().get(`/api/v1/primary_school/annual-reviews/${id}`)).body.reportcardId, { label: `PDF du bilan de ${pupil.name}`, timeoutMs: 90_000 });
      }
      const docs = await p.db.admin.query("SELECT render_status, snapshot ->> 'ruleSourceKind' AS kind FROM reportcards.official_documents WHERE tenant_id = $1 AND document_kind = 'ANNUAL_REVIEW'", [T().tenantId]);
      expect(docs.rows).toHaveLength(3);
      expect(docs.rows.every((r) => r.render_status === "RENDERED" && r.kind === "placeholder")).toBe(true);
    });

    it("FILIGRANE : la vérification publique du bilan annonce « démonstration » et ne dévoile aucune donnée personnelle", async () => {
      const row = await p.db.admin.query("SELECT verification_code FROM reportcards.official_documents WHERE tenant_id = $1 AND document_kind = 'ANNUAL_REVIEW' LIMIT 1", [T().tenantId]);
      const res = await p.http("GET", `/api/v1/public/verify/${row.rows[0].verification_code}`);
      expectStatus(res, 200);
      expect(res.body.status).toBe("AUTHENTIC");
      expect(res.body.demonstration).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/KONE|YAO|TRAORE/);
    });

    it("un bilan SCELLÉ est immuable : ni la base, ni un nouveau scellement ne le modifient", async () => {
      const id = W.ids[`review:${W.pupils[0]!.enrollmentId}`] as string;
      await expect(
        p.app.v2.tenantDb.run({ tenantId: T().tenantId, userId: dir().identityId, roles: [], requestId: "p3-tamper", actor: "user", mfa: false } as never, (tx) =>
          tx.query("UPDATE primary_school.annual_reviews SET status = 'DRAFT' WHERE id = $1", [id]),
        ),
      ).rejects.toThrow();
      const again = await dir().raw("POST", `/api/v1/primary_school/annual-reviews/${id}/seal`, {});
      expect([200, 409]).toContain(again.status);
    });
  });

  // ===========================================================================================================
  describe("(9) archive d'année : prête quand tous les bilans sont scellés et émis, puis GELÉE", () => {
    it("préparation -> READY ; gel (sensible) -> FROZEN ; plus aucun bilan ne s'écrit ni ne se réémet", async () => {
      // L'archive exige l'année académique CLÔTURÉE (périodes closes, issues d'inscription enregistrées par le conseil).
      for (const periodId of W.periodIds) {
        await dir().post(`/api/v1/academic/periods/${periodId}/close-grading`, {}, [200, 201, 409]);
        await dir().post(`/api/v1/academic/periods/${periodId}/close`, {}, [200, 201]);
      }
      const yearClosed = await own().post(`/api/v1/academic/years/${W.yearId}/close`, {}, [200, 201]);
      expect(yearClosed.status).toBeLessThan(300);
      let last: Record<string, unknown> = {};
      const archive = await waitFor(
        async () => {
          const r = await dir().post("/api/v1/primary_school/year-archives/prepare", { academicYearId: W.yearId, institutionId: T().institutionId }, [200, 201]);
          last = r.body;
          return r.body.status === "READY" ? r.body : false;
        },
        { label: `archive d'année READY (dernier état : ${JSON.stringify(last).slice(0, 400)})`, timeoutMs: 45_000 },
      ).catch((e: Error) => {
        throw new Error(`${e.message} :: ${JSON.stringify(last).slice(0, 600)}`);
      });
      expect(archive.reviewsTotal).toBe(3);
      expect(archive.reviewsSealed).toBe(3);
      expect(archive.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      const frozen = await dir().post(`/api/v1/primary_school/year-archives/${archive.id}/freeze`, {});
      expect(frozen.body.status).toBe("FROZEN");
      const reissue = await dir().raw("POST", `/api/v1/primary_school/annual-reviews/${W.ids[`review:${W.pupils[0]!.enrollmentId}`]}/reissue`, { reason: "Tentative de réémission après le gel de l'archive." });
      expect(reissue.status, JSON.stringify(reissue.body)).toBeGreaterThanOrEqual(400);
      expect(reissue.status).toBeLessThan(500);
    });
  });

  // ===========================================================================================================
  describe("(10) aucune règle officielle inventée : tout vient de jeux de DÉMONSTRATION, partout", () => {
    it("liaisons, versions épinglées et résultats : jeu fictif uniquement ; bandeau actif ; aucune liaison « regulation »", async () => {
      const banner = await dir().get(`/api/v1/primary_school/rule-banner?classroomId=${W.classroomId}`);
      expect(banner.body).toMatchObject({ ruleSourceKind: "placeholder", isPlaceholder: true });
      const pinned = await p.db.admin.query("SELECT DISTINCT rule_set_code, rule_version_kind FROM results.period_results WHERE tenant_id = $1", [T().tenantId]);
      expect(pinned.rows.map((r) => r.rule_set_code)).toEqual(["CI-PRIMARY-PLACEHOLDER"]);
      const bindings = await own().get("/api/v1/rules/bindings");
      expect(((bindings.body.items ?? bindings.body) as Array<{ ruleSetCode: string }>).every((b) => /PLACEHOLDER$/.test(b.ruleSetCode))).toBe(true);
      const nonPlaceholder = await p.db.admin.query(
        `SELECT DISTINCT s.code FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE v.source_kind = 'placeholder'`,
      );
      expect(nonPlaceholder.rows.map((r) => r.code)).toEqual(expect.arrayContaining(["CI-PRIMARY-PLACEHOLDER"]));
      const templates = await p.db.admin.query("SELECT count(*)::int AS n FROM primary_school.rating_scales WHERE tenant_id = $1 AND source_kind <> 'placeholder'", [T().tenantId]);
      expect(templates.rows[0].n).toBe(0);
    });
  });

  // ===========================================================================================================
  describe("(11) accès famille : un parent ne voit que les bilans scellés et émis de SON enfant", () => {
    it("le tuteur de l'élève 1 (compte de portail) lit le bilan de son enfant ; celui d'un autre élève est introuvable (404)", async () => {
      const links = await own().get(`/api/v1/people/students/${W.pupils[0]!.studentId}/guardians`);
      const g = (links.body.items as Array<{ guardianId?: string; personId?: string; guardian?: { id: string; personId: string } }>)[0] as { guardianId?: string; personId?: string; guardian?: { id: string; personId: string } };
      const personId = g.personId ?? g.guardian?.personId;
      expect(personId, JSON.stringify(links.body)).toBeTruthy();
      const inv = await own().post(`/api/v1/people/persons/${personId}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201]);
      expect(inv.body.invited).toBe(true);
      const parent = await activatePortalAccount(p, T().slug, "tuteur1@palmiers.test", "parent");
      const mine = await parent.get(`/api/v1/primary_school/children/${W.pupils[0]!.studentId}/annual-reviews`);
      expect((mine.body.items as unknown[]).length).toBe(1);
      const other = await parent.raw("GET", `/api/v1/primary_school/children/${W.pupils[1]!.studentId}/annual-reviews`);
      expect(other.status).toBe(404);
      const admin = await parent.raw("GET", `/api/v1/primary_school/annual-reviews`);
      expect(admin.status).toBe(403);
    });
  });

  // ===========================================================================================================
  describe("(12) second tenant (pack PRIMARY) : isolation prouvée par des appels CROISÉS refusés et par la RLS", () => {
    let U: ProvisionedOwner;
    let ownerU: Actor;

    it("un second établissement PRIMARY est provisionné ; son modèle de pack s'applique INDÉPENDAMMENT (mêmes codes, autres identifiants)", async () => {
      U = await provisionByConsole(p, { name: "École Les Baobabs", slug: "baobabs", packs: ["PRIMARY"], ownerEmail: "owner@baobabs.test" });
      expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${U.tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE" } }), 200);
      await redeemInvitation(p, U.ownerEmail);
      ownerU = actorFrom(p.http, "owner-baobabs", U.ownerEmail, await loginWithMfaEnrollment(p, U.ownerEmail, U.slug));
      const fw = await waitFor(
        async () => {
          const r = await ownerU.get("/api/v1/primary_school/frameworks");
          return (r.body.items as Array<{ id: string; code: string }>).some((f) => f.code === "PRESCHOOL_DEMO") ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "référentiels du pack PRIMARY du second tenant", timeoutMs: 45_000 },
      );
      const mine = await own().get("/api/v1/primary_school/frameworks");
      const ids = new Set((mine.body.items as Array<{ id: string }>).map((f) => f.id));
      expect(fw.every((f) => !ids.has(f.id))).toBe(true);
    });

    it("LECTURE croisée : le propriétaire de B n'obtient AUCUNE ressource de A par son identifiant", async () => {
      const review = W.ids[`review:${W.pupils[0]!.enrollmentId}`];
      const probes: Array<[string, string]> = [
        ["classe", `/api/v1/academic/classrooms/${W.classroomId}`],
        ["inscription", `/api/v1/academic/enrollments/${W.pupils[0]!.enrollmentId}`],
        ["élève", `/api/v1/people/students/${W.pupils[0]!.studentId}`],
        ["candidature", `/api/v1/admissions/applications/${W.pupils[0]!.applicationId}`],
        ["facture", `/api/v1/finance/invoices/${W.pupils[0]!.invoiceId}`],
        ["grille de compétences", `/api/v1/primary_school/classrooms/${W.classroomId}/competency-sheet?periodId=${W.periodIds[0]}`],
        ["bilan annuel", `/api/v1/primary_school/annual-reviews/${review}`],
        ["conseil", `/api/v1/primary_school/councils/${W.ids.deliberation}`],
        ["résultats de classe", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[1]}`],
        ["appel", `/api/v1/attendance/sessions/${W.ids.attendance0}`],
      ];
      for (const [what, url] of probes) {
        const res = await ownerU.raw("GET", url);
        expect([403, 404], `${what} : ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        expect(JSON.stringify(res.body), what).not.toMatch(/KONE|YAO|TRAORE/);
      }
      for (const url of ["/api/v1/people/students", "/api/v1/admissions/applications", "/api/v1/primary_school/annual-reviews", "/api/v1/primary_school/councils", "/api/v1/finance/invoices"]) {
        const res = await ownerU.get(url);
        expect(JSON.stringify(res.body), url).not.toMatch(/KONE|YAO|TRAORE/);
        expect(JSON.stringify(res.body), url).not.toContain(W.pupils[0]!.studentId);
      }
    });

    it("ÉCRITURE croisée : B ne scelle, ne décide, ne valide ni n'appelle rien chez A", async () => {
      const review = W.ids[`review:${W.pupils[0]!.enrollmentId}`];
      const writes: Array<[string, string, unknown]> = [
        ["POST", `/api/v1/primary_school/annual-reviews/${review}/seal`, {}],
        ["POST", `/api/v1/primary_school/annual-reviews/${review}/reissue`, { reason: "Tentative de piratage inter-tenant." }],
        ["POST", `/api/v1/primary_school/classrooms/${W.classroomId}/periods/${W.periodIds[0]}/competencies/validate`, {}],
        ["POST", "/api/v1/attendance/sessions", { scope: "DAILY", classroomId: W.classroomId, date: isoDay(new Date()) }],
        ["POST", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[1]}/reopen`, { reason: "Tentative de piratage inter-tenant." }],
        ["POST", `/api/v1/admissions/applications/${W.pupils[0]!.applicationId}/anonymize`, { reason: "Tentative de piratage inter-tenant." }],
      ];
      for (const [method, url, body] of writes) {
        const res = await ownerU.raw(method, url, body);
        expect(res.status, `${method} ${url} : ${JSON.stringify(res.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      expect((await dir().get(`/api/v1/primary_school/annual-reviews/${review}`)).body.status).toBe("SEALED");
    });

    it("base de données : sous l'identité de B, aucune ligne de A dans les tables du parcours (RLS forcée)", async () => {
      const tables = [
        "primary_school.annual_reviews", "primary_school.council_cases", "primary_school.competency_assessments", "primary_school.year_archives", "primary_school.settings",
        "admissions.applications", "notifications.deliveries", "results.period_results", "finance.invoices", "attendance.sessions", "academic.enrollments", "people.students", "reportcards.official_documents",
      ];
      for (const t of tables) {
        const seen = await p.app.v2.tenantDb.run({ tenantId: U.tenantId, userId: ownerU.identityId, roles: [], requestId: `p3-rls-${t}`, actor: "user", mfa: false } as never, (tx) =>
          tx.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]),
        );
        expect(seen.rows[0]?.n, t).toBe(0);
        const visible = await p.db.admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]);
        expect(visible.rows[0].n, `${t} (visible par l'administrateur)`).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================================================
  describe("(13) santé asynchrone : aucun abonné en échec, aucune lettre morte", () => {
    it("l'outbox est entièrement publiée et le journal du worker ne contient aucun échec d'abonné ou de job", async () => {
      await waitFor(
        async () => (await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND published_at IS NULL", [T().tenantId])).rows[0].n === 0,
        { label: "outbox entièrement publiée", timeoutMs: 60_000 },
      );
      const lines = p.workerLog.map((l) => {
        try {
          return JSON.parse(l) as { level?: string; msg?: string; worker?: string; err?: string };
        } catch {
          return { level: "warn", msg: l };
        }
      });
      const bad = lines.filter((l) => l.level === "error" || /échec|dead-letter|job en échec/i.test(`${l.msg ?? ""}`)).filter((l) => !/repli DISQUE/.test(l.msg ?? ""));
      expect(bad.map((l) => `${l.worker ?? ""} ${l.msg ?? ""} ${l.err ?? ""}`), `journal du worker : ${JSON.stringify(bad).slice(0, 900)}`).toEqual([]);
    });
  });
});
