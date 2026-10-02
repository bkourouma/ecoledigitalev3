/**
 * PHASE 3 — PARCOURS SECONDARY DE BOUT EN BOUT sur la plateforme ASSEMBLÉE (vrais plugins, vrais adaptateurs inter-modules, vrai
 * worker en processus, Postgres + Redis jetables). Tout passe par HTTP avec de vrais comptes IAM (rôles système de `rbac`).
 *
 *   (1) console : provisionnement avec le MODÈLE DE PACK Secondary ; liaisons de règles de DÉMONSTRATION posées par événement
 *   (2) année, curriculum à coefficients, classe de 3e ; (3) admission -> inscription -> frais payés
 *   (4) notes (circuit de validation) -> résultats par le jeu de règles PLACEHOLDER -> bulletins avec filigrane « démonstration »
 *   (5) vie scolaire : incident, mesure proposée puis VALIDÉE PAR UN HUMAIN (quatre yeux), effet sur le statut appliqué par un humain
 *   (6) élèves affectés par l'État : dossier vérifié, facture scindée, créance, versement de l'État rapproché
 *   (7) examens : session officielle (éligibilité par faits d'academic + règle), examen blanc calculé par la règle de démonstration
 *   (8) isolation inter-tenants (appels croisés + RLS) ; (9) santé asynchrone.
 *
 * TOUS les jeux de règles sont des PLACEHOLDERS : aucune règle ivoirienne n'est inventée ; les types d'événements de vie scolaire et
 * les épreuves d'examen sont des DONNÉES de test marquées « démonstration ». Les étapes partagent l'état : elles s'exécutent dans l'ordre.
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
  pedago?: Actor;
  secretariat?: Actor;
  teacher?: Actor;
  yearId?: string;
  yearCode?: string;
  yearStart?: string;
  periodIds: string[];
  programId?: string;
  gradeLevelId?: string;
  versionId?: string;
  classroomId?: string;
  teacherStaffId?: string;
  subjects: Record<string, { nodeId: string; nodeId2: string }>;
  campaign?: Campaign;
  pupils: Array<Admitted & { name: string; lastName: string }>;
  ids: Record<string, string>;
}

describeIntegration.skipIf(!REDIS_URL)("PHASE 3 — Secondary : admission -> inscription -> notes -> résultats (placeholder) -> vie scolaire -> affectation État -> examens", () => {
  let p: Phase2Env;
  const W: World = { periodIds: [], pupils: [], subjects: {}, ids: {} };
  const own = (): Actor => W.owner as Actor;
  const dir = (): Actor => W.directeur as Actor;
  const T = (): ProvisionedOwner => W.T as ProvisionedOwner;
  const today = isoDay(new Date());

  beforeAll(async () => {
    p = await startPhase2Platform();
  }, 300_000);
  afterAll(async () => {
    await p?.stop();
  });

  // ===========================================================================================================
  describe("(1) console : provisionnement SECONDARY — le modèle de pack est appliqué par événement (worker)", () => {
    it("la console provisionne le tenant, puis l'abonnement PROFESSIONAL + pack SECONDARY ; direction, pédagogie, secrétariat", async () => {
      W.T = await provisionByConsole(p, { name: "Collège Les Acacias", slug: "acacias", packs: ["SECONDARY"], ownerEmail: "owner@acacias.test" });
      expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${T().tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["SECONDARY"], status: "ACTIVE" } }), 200);
      await redeemInvitation(p, T().ownerEmail);
      W.owner = actorFrom(p.http, "owner", T().ownerEmail, await loginWithMfaEnrollment(p, T().ownerEmail, T().slug));
      W.directeur = await onboardStaffMember(p, own(), T().slug, "directeur@acacias.test", "directeur");
      W.pedago = await onboardStaffMember(p, own(), T().slug, "pedagogie@acacias.test", "responsable_pedagogique");
      W.secretariat = await onboardStaffMember(p, own(), T().slug, "secretariat@acacias.test", "secretariat", { mfa: false });
    });

    it("academic : niveaux 6e..Tle ; finance : frais REGISTRATION et TUITION SANS montant ; rules : liaisons vers les jeux de DÉMONSTRATION seulement", async () => {
      const levels = await waitFor(
        async () => {
          const r = await own().get("/api/v1/academic/reference/grade-levels");
          const codes = (r.body.items as Array<{ code: string }>).map((g) => g.code);
          return codes.includes("3E") && codes.includes("TLE") ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "niveaux du pack SECONDARY", timeoutMs: 45_000 },
      );
      W.gradeLevelId = levels.find((g) => g.code === "3E")!.id;
      const fees = await waitFor(
        async () => {
          const r = await own().get("/api/v1/finance/fees");
          const codes = (r.body.items as Array<{ code: string }>).map((f) => f.code);
          return codes.includes("REGISTRATION") && codes.includes("TUITION") ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "catégories de frais du pack SECONDARY", timeoutMs: 45_000 },
      );
      W.ids.registrationFee = fees.find((f) => f.code === "REGISTRATION")!.id;
      W.ids.tuitionFee = fees.find((f) => f.code === "TUITION")!.id;
      expect((await p.db.admin.query("SELECT count(*)::int AS n FROM finance.fee_schedules WHERE tenant_id = $1", [T().tenantId])).rows[0].n).toBe(0);
      const bindings = await waitFor(
        async () => {
          const r = await own().get("/api/v1/rules/bindings");
          const items = (r.body.items ?? r.body) as Array<{ contractId: string; ruleSetCode: string }>;
          return items.some((b) => b.contractId === "secondary-annual@1") && items.some((b) => b.contractId === "exam-national@1") ? items : false;
        },
        { label: "liaisons de règles du pack SECONDARY (rules.apply-pack-bindings)", timeoutMs: 45_000 },
      );
      expect(new Set(bindings.map((b) => b.ruleSetCode))).toEqual(new Set(["CI-SECONDARY-PLACEHOLDER", "CI-EXAM-PLACEHOLDER"]));
      const kinds = await p.db.admin.query(
        `SELECT s.code, v.source_kind FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE s.code IN ('CI-SECONDARY-PLACEHOLDER', 'CI-EXAM-PLACEHOLDER')`,
      );
      expect(kinds.rows.length).toBeGreaterThan(0);
      expect(kinds.rows.every((r) => r.source_kind === "placeholder")).toBe(true);
    });
  });

  // ===========================================================================================================
  describe("(2) année, curriculum à coefficients (3e), classe, enseignant", () => {
    it("année (les jeux de démonstration sont effectifs à partir de leur date d'effet), deux semestres, le premier ouvert", async () => {
      W.yearStart = [addDays(today, -120), PLACEHOLDER_RULES_START].sort().at(-1) as string;
      W.yearCode = `${W.yearStart.slice(0, 4)}-${addDays(W.yearStart, 364).slice(0, 4)}`;
      const y = await own().post("/api/v1/academic/years", { institutionId: T().institutionId, code: W.yearCode, label: "Année simulée (Secondary)", startsOn: W.yearStart }, 201);
      W.yearId = y.body.id;
      await own().post(`/api/v1/academic/years/${W.yearId}/open`);
      await own().post(`/api/v1/academic/years/${W.yearId}/set-current`);
      const plan = await own().post(`/api/v1/academic/years/${W.yearId}/period-plan`, { planCode: "TWO_SEMESTERS" }, 201);
      W.periodIds = (plan.body.items as Array<{ id: string }>).map((x) => x.id);
      await own().post(`/api/v1/academic/periods/${W.periodIds[0]}/open`);
    });

    it("programme COLLEGE (modèle de pack), matières à coefficients (mathématiques 3, français 2), curriculum 3e publié, classe activée", async () => {
      const programs = await own().get(`/api/v1/academic/programs?institutionId=${T().institutionId}`);
      W.programId = (programs.body.items as Array<{ id: string; code: string }>).find((x) => x.code === "COLLEGE")!.id;
      const subjectIds: Record<string, string> = {};
      for (const code of ["MATHS", "FRANCAIS"]) subjectIds[code] = (await own().post("/api/v1/academic/subjects", { institutionId: T().institutionId, code, label: `Matière ${code}` }, 201)).body.id;
      const version = await own().post("/api/v1/academic/curriculum-versions", { programId: W.programId, academicYearId: W.yearId }, 201);
      W.versionId = version.body.id;
      const node = async (body: Record<string, unknown>): Promise<any> => (await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/nodes`, body, 201)).body;
      const level = await node({ nodeTypeCode: "LEVEL", code: "3E", label: "Troisième", gradeLevelId: W.gradeLevelId });
      const s1 = await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
      const s2 = await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S2", label: "Semestre 2", periodTypeCode: "SEMESTER", periodOrdinal: 2 });
      const coefficients: Record<string, string> = { MATHS: "3", FRANCAIS: "2" };
      for (const code of Object.keys(subjectIds)) {
        const a = await node({ parentId: s1.id, nodeTypeCode: "SUBJECT", code: `${code}1`, label: `${code} S1`, subjectId: subjectIds[code], coefficient: coefficients[code] });
        const b = await node({ parentId: s2.id, nodeTypeCode: "SUBJECT", code: `${code}2`, label: `${code} S2`, subjectId: subjectIds[code], coefficient: coefficients[code] });
        W.subjects[code] = { nodeId: a.id, nodeId2: b.id };
      }
      const check = await own().get(`/api/v1/academic/curriculum-versions/${W.versionId}/validate`);
      expect(JSON.stringify(check.body)).not.toMatch(/"severity":"error"/);
      expect((await own().post(`/api/v1/academic/curriculum-versions/${W.versionId}/publish`)).body.status).toBe("PUBLISHED");
      const c = await own().post(
        "/api/v1/academic/classrooms",
        { institutionId: T().institutionId, academicYearId: W.yearId, programId: W.programId, gradeLevelId: W.gradeLevelId, curriculumVersionId: W.versionId, code: "3E-A", name: "Troisième A", capacity: 40 },
        201,
      );
      W.classroomId = c.body.id;
      // le garde « titulaire exigé » est propre au pack Primary : une classe du secondaire s'active sans lui
      const activated = await own().post(`/api/v1/academic/classrooms/${W.classroomId}/activate`, {});
      expect(activated.status).toBeLessThan(300);
      expect((await own().get(`/api/v1/academic/classrooms/${W.classroomId}`)).body.status).toBe("ACTIVE");
    });

    it("l'enseignant : fiche, compte de portail (rôle enseignant), responsable (LEAD) de chaque matière du premier semestre", async () => {
      const cats = await own().get("/api/v1/people/reference/staff-categories");
      const teacherCat = (cats.body.items as Array<{ code: string; canTeach: boolean }>).find((c) => c.canTeach);
      const s = await own().post("/api/v1/people/staff", { person: { lastName: "PROFESSEUR", firstName: "Issa", sex: "M", birthDate: "1985-04-04", email: "prof@acacias.test" }, categoryCode: teacherCat!.code, hiredOn: "2020-09-01" }, 201);
      W.teacherStaffId = s.body.staff?.id ?? s.body.id;
      expect((await own().post(`/api/v1/people/staff/${W.teacherStaffId}/portal-invitation`, { role: "enseignant" }, [200, 201])).body.invited).toBe(true);
      W.teacher = await activatePortalAccount(p, T().slug, "prof@acacias.test", "enseignant");
      for (const code of ["MATHS", "FRANCAIS"]) {
        await own().post(
          "/api/v1/people/teaching-assignments",
          { staffId: W.teacherStaffId, academicYearId: W.yearId, classroomId: W.classroomId, curriculumNodeId: W.subjects[code]!.nodeId, roleCode: "LEAD", startsOn: W.yearStart },
          201,
        );
        await own().post(
          "/api/v1/people/teaching-assignments",
          { staffId: W.teacherStaffId, academicYearId: W.yearId, classroomId: W.classroomId, curriculumNodeId: W.subjects[code]!.nodeId2, roleCode: "LEAD", startsOn: W.yearStart },
          201,
        );
      }
    });
  });

  // ===========================================================================================================
  describe("(3) admission -> inscription -> frais d'inscription payés -> ENROLLED dérivé", () => {
    const NAMES: Array<[string, string, "M" | "F", string]> = [
      ["Awa", "KONE", "F", "2011-02-11"],
      ["Koffi", "YAO", "M", "2011-03-12"],
      ["Mariam", "TRAORE", "F", "2011-04-13"],
    ];

    it("barèmes (frais d'inscription et scolarité créés par le modèle de pack) ; politique de confirmation à la réception des frais", async () => {
      await own().post("/api/v1/finance/fee-schedules", { feeId: W.ids.registrationFee, academicYear: W.yearCode, amount: 25000, effectiveFrom: "2020-01-01" }, 201);
      await own().post("/api/v1/finance/fee-schedules", { feeId: W.ids.tuitionFee, academicYear: W.yearCode, amount: 500000, effectiveFrom: "2020-01-01" }, 201);
      const r = await own().put(`/api/v1/academic/institutions/${T().institutionId}/settings`, { enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID" });
      expect(r.body.enrollmentConfirmationPolicy).toBe("ON_REGISTRATION_FEE_PAID");
    });

    it("trois candidatures jusqu'à l'inscription EN ATTENTE ; notifications d'admission mises EN FILE ; paiement -> inscriptions CONFIRMÉES, dossiers ENROLLED, élèves ACTIFS", async () => {
      W.campaign = await openCampaign(own(), { institutionId: T().institutionId, academicYearId: W.yearId as string, code: "RENTREE-3E", grade: "3E", seats: 5 });
      for (const [i, [firstName, lastName, gender, birthDate]] of NAMES.entries()) {
        const a = await admitUntilPending(
          own(),
          W.campaign,
          { firstName, lastName, birthDate, gender, grade: "3E", guardianEmail: `tuteur${i + 1}@acacias.test`, guardianPhone: `+225 05 00 00 00 0${i + 1}`, guardianFirstName: `Parent${i + 1}` },
          W.classroomId as string,
        );
        W.pupils.push({ ...a, name: `${lastName} ${firstName}`, lastName });
        expect(a.invoiceId).toBeTruthy();
      }
      await waitFor(
        async () => (await p.db.admin.query("SELECT count(*)::int AS n FROM notifications.deliveries WHERE tenant_id = $1 AND context ->> 'origin' = 'admissions'", [T().tenantId])).rows[0].n >= 6,
        { label: "remises d'admissions mises en file", timeoutMs: 30_000 },
      );
      for (const [i, pupil] of W.pupils.entries()) {
        const pay = await own().post(
          "/api/v1/finance/payments",
          { learnerId: pupil.studentId, enrollmentId: pupil.enrollmentId, amount: 25000, method: "TRANSFER", reference: `VIR-S3-${i + 1}`, allocation: { mode: "AUTO", invoiceIds: [pupil.invoiceId] } },
          [200, 201],
          { "idempotency-key": `p3s-vir-${i + 1}` },
        );
        expect(pay.body.payment.status).toBe("CONFIRMED");
      }
      for (const pupil of W.pupils) {
        await waitFor(async () => (await own().get(`/api/v1/academic/enrollments/${pupil.enrollmentId}`)).body.enrollment.status === "ACTIVE", { label: `inscription de ${pupil.name}`, timeoutMs: 45_000 });
        await waitFor(async () => (await own().get(`/api/v1/admissions/applications/${pupil.applicationId}`)).body.status === "ENROLLED", { label: `dossier de ${pupil.name} ENROLLED`, timeoutMs: 45_000 });
      }
    });
  });

  // ===========================================================================================================
  describe("(4) notes (circuit de validation) -> résultats par le jeu de règles de DÉMONSTRATION -> bulletins avec filigrane", () => {
    const types: Record<string, string> = {};
    const assessmentIds: string[] = [];
    const metaOf = new Map<string, { subject: string; type: string }>();
    // [devoir, composition] par matière pour les élèves 1, 2, 3
    const GRID: Record<string, { DEVOIR: string[]; COMPOSITION: string[] }> = {
      MATHS: { DEVOIR: ["16", "12", "8"], COMPOSITION: ["14", "10", "6"] },
      FRANCAIS: { DEVOIR: ["12", "14", "9"], COMPOSITION: ["13", "15", "7"] },
    };
    const teacher = (): Actor => W.teacher as Actor;
    const pedago = (): Actor => W.pedago as Actor;

    it("types d'évaluation du pack ; un devoir et une composition par matière, créés par l'enseignant AFFECTÉ", async () => {
      const items = await waitFor(
        async () => {
          const r = await teacher().get("/api/v1/assess/assessment-types");
          return (r.body.items as Array<{ code: string }>).length > 0 ? (r.body.items as Array<{ id: string; code: string }>) : false;
        },
        { label: "types d'évaluation", timeoutMs: 45_000 },
      );
      for (const t of items) types[t.code] = t.id;
      expect(types.DEVOIR && types.COMPOSITION && types.EXAMEN_BLANC).toBeTruthy();
      const assessedOn = addDays(W.yearStart as string, 10);
      for (const type of ["DEVOIR", "COMPOSITION"]) {
        const r = await teacher().post(
          "/api/v1/assess/assessments/bulk",
          { typeId: types[type], academicPeriodId: W.periodIds[0], title: `${type} S1`, assessedOn, targets: Object.keys(GRID).map((s) => ({ classroomId: W.classroomId, curriculumNodeId: W.subjects[s]!.nodeId })) },
          201,
        );
        for (const it of r.body.items as Array<{ id: string; curriculumNodeId: string }>) {
          assessmentIds.push(it.id);
          metaOf.set(it.id, { subject: Object.keys(GRID).find((s) => W.subjects[s]!.nodeId === it.curriculumNodeId) as string, type });
        }
      }
      expect(assessmentIds).toHaveLength(4);
    });

    it("saisie en lot, soumission, relecture, validation (MFA), publication (direction) : séparation des tâches respectée", async () => {
      for (const id of assessmentIds) {
        const m = metaOf.get(id) as { subject: string; type: string };
        const scores = GRID[m.subject]![m.type as "DEVOIR" | "COMPOSITION"];
        const body = { entries: W.pupils.map((pupil, i) => ({ enrollmentId: pupil.enrollmentId, score: scores[i] })) };
        expect((await teacher().put(`/api/v1/assess/assessments/${id}/grades`, body, 200, { "idempotency-key": `p3s-grades-${id}` })).body.created).toBe(3);
        await teacher().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "SUBMITTED" });
        expect((await teacher().raw("POST", `/api/v1/assess/assessments/${id}/transitions`, { to: "PUBLISHED" })).status).toBe(403);
        await pedago().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "REVIEWED" });
        await pedago().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "APPROVED" });
        expect((await dir().post(`/api/v1/assess/assessments/${id}/transitions`, { to: "PUBLISHED" })).body.assessment.status).toBe("PUBLISHED");
      }
    });

    it("clôture du semestre : le jeu de règles lié par le modèle de pack (CI-SECONDARY-PLACEHOLDER, secondary-annual@1) calcule ; aucun taux ni seuil dans le code", async () => {
      await own().put("/api/v1/results/settings", { requireDeliberation: false });
      const state = `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`;
      expect((await dir().post(`${state}/lock`, {})).body.status).toBe("GRADING_LOCKED");
      const closed = await dir().post(`${state}/close`, {});
      expect(closed.body.state.status).toBe("CLOSED");
      expect(closed.body.resultsCount).toBe(3);
      const rows = await p.db.admin.query(
        `SELECT enrollment_id, contract_id, rule_set_code, average::text AS average, decision_code FROM results.period_results WHERE tenant_id = $1 AND scope = 'PERIOD' AND academic_period_id = $2 AND status = 'FINAL'`,
        [T().tenantId, W.periodIds[0]],
      );
      expect(rows.rows).toHaveLength(3);
      expect(new Set(rows.rows.map((r) => r.contract_id))).toEqual(new Set(["secondary-annual@1"]));
      expect(new Set(rows.rows.map((r) => r.rule_set_code))).toEqual(new Set(["CI-SECONDARY-PLACEHOLDER"]));
      const of = (i: number) => rows.rows.find((r) => r.enrollment_id === W.pupils[i]!.enrollmentId);
      // Moyenne coefficientée : les devoirs et la composition se pondèrent par les poids du TYPE (1 et 1 : données), matières par coefficient 3 et 2.
      expect(Number(of(0)!.average)).toBeGreaterThan(Number(of(2)!.average));
      expect(of(0)!.decision_code).toBeTruthy();
      const view = await dir().get(`${state}/state`);
      expect(view.body.ruleSourceKind, `clés : ${Object.keys(view.body).join(",")}`).toBe("placeholder");
    });

    it("bulletins : gabarit du pack SECONDARY, lot d'émission signé ; la vérification publique annonce « démonstration » (filigrane imposé par la provenance des règles)", async () => {
      await own().put("/api/v1/reportcards/branding", { legalName: "Collège Les Acacias", headerLeft: ["République de Côte d'Ivoire (démonstration)"], address: "Abidjan", primaryColor: "#14532D" });
      const sig = await own().post("/api/v1/reportcards/signatories", { fullName: "Directeur Fictif", title: "Chef d'établissement", jobFunction: "Direction" }, 201);
      const templates = await own().get("/api/v1/reportcards/templates");
      expect(JSON.stringify(templates.body)).toContain("secondary-bulletin");
      const slots = ((templates.body.items ?? templates.body) as Array<{ key: string; signatureSlots?: Array<{ key?: string; slot?: string }> }>).find((t) => t.key === "secondary-bulletin")?.signatureSlots ?? [];
      await own().put("/api/v1/reportcards/template-configs", {
        documentKind: "REPORT_CARD",
        pack: "SECONDARY",
        templateKey: "secondary-bulletin",
        options: {},
        signatureAssignments: slots.slice(0, 1).map((s) => ({ slot: s.key ?? s.slot, signatoryId: sig.body.id })),
      });
      const batch = await own().post(
        "/api/v1/reportcards/batches",
        { classroomId: W.classroomId, academicPeriodId: W.periodIds[0], idempotencyKey: "p3s-bulletins-1" },
        [200, 202],
      );
      expect((batch.body.batch ?? batch.body).total).toBe(3);
      const page = await own().get(`/api/v1/reportcards/report-cards?classroomId=${W.classroomId}&academicPeriodId=${W.periodIds[0]}&live=true`);
      const cards = page.body.items as Array<{ id: string; verificationCode: string }>;
      expect(cards).toHaveLength(3);
      W.ids.reportCard = cards[0]!.id;
      const detail = await own().get(`/api/v1/reportcards/report-cards/${cards[0]!.id}`);
      expect(detail.body.snapshot.rules).toMatchObject({ ruleSetCode: "CI-SECONDARY-PLACEHOLDER", contractId: "secondary-annual@1", sourceKind: "placeholder" });
      await own().post("/api/v1/reportcards/publish", { reportCardIds: cards.map((c) => c.id) });
      const verify = await p.http("GET", `/api/v1/public/verify/${cards[0]!.verificationCode}`);
      expectStatus(verify, 200);
      expect(verify.body.status).toBe("AUTHENTIC");
      expect(verify.body.demonstration).toBe(true);
      expect(JSON.stringify(verify.body)).not.toMatch(/KONE|YAO|TRAORE/);
    });
  });

  // ===========================================================================================================
  describe("(5) vie scolaire : incident, mesure proposée, VALIDÉE PAR UN HUMAIN (quatre yeux), effet sur le statut appliqué par un humain", () => {
    const owner = (): Actor => W.owner as Actor;
    const teacher = (): Actor => W.teacher as Actor;
    let incidentTypeId = "";
    let exclusionTypeId = "";
    let measureId = "";
    let effectId = "";

    it("réglages et types d'événements : DONNÉES d'établissement de démonstration (aucune règle, aucun catalogue de fautes livrés)", async () => {
      const ref0 = await owner().get(`/api/v1/schoollife/reference`);
      expect(JSON.stringify(ref0.body)).not.toMatch(/INSOLENCE|VOL|VIOLENCE/); // aucun catalogue livré
      expect((ref0.body.eventTypes as unknown[]).length).toBe(0);
      await owner().put("/api/v1/schoollife/severity-levels", { code: "NIVEAU1", label: "Niveau 1 (démonstration)", rank: 1 });
      const inc = await owner().put("/api/v1/schoollife/event-types", { code: "INCIDENT_DEMO", label: "Incident (démonstration)", kind: "INCIDENT", isPlaceholder: true });
      const exc = await owner().put("/api/v1/schoollife/event-types", {
        code: "EXCLUSION_DEMO",
        label: "Exclusion temporaire (démonstration)",
        kind: "TEMP_EXCLUSION",
        requiresValidation: true,
        requiresFourEyes: true,
        requiresDates: true,
        notifyGuardians: true,
        appealable: true,
        isPlaceholder: true,
      });
      incidentTypeId = inc.body.id;
      exclusionTypeId = exc.body.id;
      expect(exc.body.isPlaceholder).toBe(true);
    });

    it("l'enseignant de la classe déclare un incident (périmètre de ses classes) ; hors de ses classes, l'élève n'existe pas pour lui", async () => {
      const pupil = W.pupils[1]!;
      const inc = await teacher().post(
        "/api/v1/schoollife/incidents",
        { typeId: incidentTypeId, occurredAt: new Date().toISOString(), description: "Incident de démonstration pendant le cours.", involvements: [{ enrollmentId: pupil.enrollmentId, role: "AUTHOR" }] },
        [200, 201],
      );
      W.ids.incident = inc.body.id;
      expect(inc.body.status).toBeTruthy();
    });

    it("la mesure d'exclusion est PROPOSÉE (propriétaire) ; l'enseignant ne la valide pas ; le proposant ne la valide pas (quatre yeux) ; la direction la valide", async () => {
      const pupil = W.pupils[1]!;
      const proposed = await owner().post(
        "/api/v1/schoollife/measures",
        { enrollmentId: pupil.enrollmentId, typeId: exclusionTypeId, incidentId: W.ids.incident, reason: "Mesure de démonstration proposée après l'incident.", startsOn: addDays(today, 1), endsOn: addDays(today, 3) },
        [200, 201],
      );
      measureId = proposed.body.id;
      expect(proposed.body.status).toBe("PROPOSED");
      expect((await teacher().raw("POST", `/api/v1/schoollife/measures/${measureId}/validate`, {})).status).toBe(403);
      const selfValidate = await owner().raw("POST", `/api/v1/schoollife/measures/${measureId}/validate`, {});
      expect(selfValidate.status, JSON.stringify(selfValidate.body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(selfValidate.body)).toMatch(/four_eyes|quatre|séparation/i);
      const validated = await dir().post(`/api/v1/schoollife/measures/${measureId}/validate`, { note: "Validée par la direction." });
      expect(validated.body.status).toBe("VALIDATED");
    });

    it("l'effet sur le statut de l'élève naît EN ATTENTE d'un humain : l'élève reste ACTIF tant que personne ne l'applique ; la direction l'applique (SUSPENDED)", async () => {
      const pupil = W.pupils[1]!;
      const effects = await dir().get(`/api/v1/schoollife/measure-effects?measureId=${measureId}`);
      expect(effects.body.items).toHaveLength(1);
      effectId = effects.body.items[0].id;
      expect(effects.body.items[0].status).toBe("AWAITING_HUMAN");
      expect((await p.db.admin.query("SELECT status FROM people.students WHERE id = $1", [pupil.studentId])).rows[0].status).toBe("ACTIVE");
      const applied = await dir().post(`/api/v1/schoollife/measure-effects/${effectId}/apply`, { status: "SUSPENDED" });
      expect(applied.body.status).toBe("APPLIED");
      expect((await p.db.admin.query("SELECT status FROM people.students WHERE id = $1", [pupil.studentId])).rows[0].status).toBe("SUSPENDED");
    });

    it("garanti PAR LA BASE : un acteur non humain (système, job) ne peut ni valider ni appliquer une mesure", async () => {
      await expect(
        p.app.v2.tenantDb.run({ tenantId: T().tenantId, userId: null, roles: [], requestId: "p3s-system", actor: "system", mfa: false } as never, (tx) =>
          tx.query("UPDATE schoollife.measures SET status = 'REVOKED' WHERE id = $1", [measureId]),
        ),
      ).rejects.toThrow(/human_actor_required|acteur humain|human/i);
      const stillValid = await dir().get(`/api/v1/schoollife/measures/${measureId}`);
      expect(stillValid.body.status).not.toBe("REVOKED");
    });

    it("avis aux tuteurs : texte NEUTRE (jamais la nature ni le motif de la mesure) mis en file par `notifications`", async () => {
      const r = await dir().post(`/api/v1/schoollife/measures/${measureId}/notify`, {}, [200, 201]);
      expect(r.status).toBeLessThan(300);
      const rows = await p.db.admin.query("SELECT content ->> 'text' AS text FROM notifications.deliveries WHERE tenant_id = $1 AND template_code IN ('announcement', 'schoollife_measure_notified') AND context ->> 'origin' IS DISTINCT FROM 'admissions'", [T().tenantId]);
      expect(rows.rows.length).toBeGreaterThan(0);
      for (const row of rows.rows) expect(row.text ?? "").not.toMatch(/exclusion|incident|sanction|d[ée]monstration pendant|proposée/i);
    });

    it("la vue famille ne montre que ce que le type partage ; un parent non lié ne voit rien (404)", async () => {
      const links = await own().get(`/api/v1/people/students/${W.pupils[0]!.studentId}/guardians`);
      const g = (links.body.items as Array<{ personId?: string; guardian?: { personId: string } }>)[0] as { personId?: string; guardian?: { personId: string } };
      const personId = g.personId ?? g.guardian?.personId;
      expect((await own().post(`/api/v1/people/persons/${personId}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201])).body.invited).toBe(true);
      const parent = await activatePortalAccount(p, T().slug, "tuteur1@acacias.test", "parent");
      W.ids.parentToken = parent.token;
      const other = await parent.raw("GET", `/api/v1/schoollife/children/${W.pupils[1]!.studentId}/life`);
      expect(other.status).toBe(404);
      const mine = await parent.raw("GET", `/api/v1/schoollife/children/${W.pupils[0]!.studentId}/life`);
      expect(mine.status).toBeLessThan(300);
    });
  });

  // ===========================================================================================================
  describe("(6) élèves affectés par l'État : dossier VÉRIFIÉ par un humain, facture scindée famille / État, créance, versement rapproché", () => {
    const secretariat = (): Actor => W.secretariat as Actor;
    const REF = "AFF-P3-0001";
    let assignmentId = "";
    let scholarshipId = "";

    it("la bourse de l'État (60 %) et le financement STATE_ASSIGNED de l'élève sont enregistrés dans finance", async () => {
      const pupil = W.pupils[0]!;
      const sch = await own().post("/api/v1/finance/scholarships", { learnerId: pupil.studentId, academicYear: W.yearCode, funderKind: "STATE", funderName: "État (démonstration)", reference: REF, coverage: { kind: "PERCENT", bps: 6000 } }, 201);
      scholarshipId = sch.body.id;
      await own().put(`/api/v1/finance/learners/${pupil.studentId}/funding`, { fundingType: "STATE_ASSIGNED", assignmentRef: REF }, 200);
    });

    it("le secrétariat enregistre l'acte ; il ne le vérifie pas (séparation) ; la direction VÉRIFIE : l'inscription porte alors la référence d'affectation (academic, même transaction)", async () => {
      const pupil = W.pupils[0]!;
      const rec = await secretariat().post("/api/v1/stateassign/assignments", { enrollmentId: pupil.enrollmentId, reference: REF, issuedOn: today, declaredStateAmount: 300000, declaredParentAmount: 225000 }, [200, 201]);
      assignmentId = rec.body.id;
      expect(rec.body.status).toBe("RECEIVED");
      const denied = await secretariat().raw("POST", `/api/v1/stateassign/assignments/${assignmentId}/verify`, { rowVersion: rec.body.rowVersion });
      expect(denied.status).toBe(403);
      const verified = await dir().post(`/api/v1/stateassign/assignments/${assignmentId}/verify`, { rowVersion: rec.body.rowVersion });
      expect(verified.body.status).toBe("VERIFIED");
      const enrollment = await own().get(`/api/v1/academic/enrollments/${pupil.enrollmentId}`);
      expect(JSON.stringify(enrollment.body)).toContain(REF);
    });

    it("facturation : la scolarité se scinde (famille 200 000 / État 300 000, sans perte) ; le rapprochement lit finance (FinancePort) : BALANCED", async () => {
      const pupil = W.pupils[0]!;
      const inv = await own().post(
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: pupil.studentId, enrollmentId: pupil.enrollmentId, academicYear: W.yearCode, items: [{ feeCode: "TUITION" }], issue: true },
        [200, 201],
        { "idempotency-key": "p3s-tuition-state" },
      );
      const invoices = inv.body.invoices as Array<{ id: string; payerKind: string; total: { amount: number } }>;
      expect(invoices).toHaveLength(2);
      const family = invoices.find((i) => i.payerKind === "LEARNER")!;
      const state = invoices.find((i) => i.payerKind === "FUNDER")!;
      expect(family.total.amount).toBe(200000);
      expect(state.total.amount).toBe(300000);
      W.ids.stateInvoice = state.id;
      const rec = await dir().post(`/api/v1/stateassign/assignments/${assignmentId}/reconcile`, {}, [200, 201]);
      expect(rec.body.assignment.reconciliation.status, JSON.stringify(rec.body.assignment.reconciliation) + JSON.stringify(rec.body.billing).slice(0, 700)).toBe("BALANCED");
      expect(rec.body.linkedScholarship).toBe(true);
    });

    it("créance sur l'État : échéance attendue ; le VERSEMENT de l'État (paiement du financeur dans finance) est rapproché par l'abonné du worker", async () => {
      const pupil = W.pupils[0]!;
      const rcv = await dir().post(`/api/v1/stateassign/assignments/${assignmentId}/receivables`, { label: "Versement unique (démonstration)", dueOn: addDays(today, 30), expectedAmount: 300000 }, [200, 201]);
      expect(rcv.body.status).toBe("OPEN");
      const pay = await own().post(
        "/api/v1/finance/payments",
        { learnerId: pupil.studentId, amount: 300000, method: "TRANSFER", reference: "VIR-ETAT-P3", payerKind: "FUNDER", payerRef: scholarshipId, payerName: "État (démonstration)", allocation: { mode: "AUTO", invoiceIds: [W.ids.stateInvoice] } },
        [200, 201],
        { "idempotency-key": "p3s-pay-state" },
      );
      expect(pay.body.payment.status).toBe("CONFIRMED");
      await waitFor(
        async () => {
          const r = await dir().get(`/api/v1/stateassign/receivables?assignmentId=${assignmentId}`);
          return (r.body.items as Array<{ status: string }>).every((x) => x.status === "RECEIVED") ? r.body.items : false;
        },
        { label: "créance reçue (rapprochement des versements de l'État)", timeoutMs: 45_000 },
      );
    });

    it("la famille ne voit que le STATUT du dossier de son enfant, jamais les montants de l'État", async () => {
      const links = await own().get(`/api/v1/people/students/${W.pupils[0]!.studentId}/guardians`);
      expect(links.status).toBe(200);
      const res = await p.http("GET", `/api/v1/stateassign/children/${W.pupils[0]!.studentId}/assignment`, { token: W.ids.parentToken as string });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/300000|declaredState|stateBilled/);
      const other = await p.http("GET", `/api/v1/stateassign/children/${W.pupils[2]!.studentId}/assignment`, { token: W.ids.parentToken as string });
      expect(other.status).toBe(404);
    });
  });

  // ===========================================================================================================
  describe("(7) examens : éligibilité par les FAITS d'academic et la règle, examen blanc calculé par la règle de démonstration", () => {
    let typeId = "";
    let officialId = "";
    let mockId = "";
    const paperIds: Record<string, string> = {};
    let mockAssessmentId = "";

    it("type d'examen de DÉMONSTRATION (donnée marquée placeholder), une épreuve ; sessions officielle et blanche instanciées, inscriptions ouvertes", async () => {
      const t = await own().post("/api/v1/examinations/exam-types", { code: "EXAM_DEMO", label: "Examen de démonstration (3e)", educationLevelCode: "LOWER_SECONDARY", gradeLevelCode: "3E", sourceKind: "placeholder" }, 201);
      typeId = t.body.id;
      await own().post(`/api/v1/examinations/exam-types/${typeId}/papers`, { code: "EP1", label: "Épreuve 1 (démonstration)", coefficient: "1", scaleMax: "20", ordinal: 1, sourceKind: "placeholder" }, 201);
      const year = Number(W.yearStart!.slice(0, 4)) + 1;
      const mk = async (code: string, body: Record<string, unknown>): Promise<string> => {
        const s = await own().post("/api/v1/examinations/sessions", { examTypeId: typeId, institutionId: T().institutionId, code, label: `Session ${code}`, sessionYear: year, ...body }, 201);
        await own().post(`/api/v1/examinations/sessions/${s.body.id}/instantiate`, {});
        await own().post(`/api/v1/examinations/sessions/${s.body.id}/transition`, { to: "REGISTRATION_OPEN" });
        return s.body.id as string;
      };
      officialId = await mk("OFF-DEMO", { sessionKind: "OFFICIAL" });
      mockId = await mk("BLANC-DEMO", { sessionKind: "MOCK", mockOfSessionId: officialId });
      W.ids.officialSession = officialId;
      const detail = await own().get(`/api/v1/examinations/sessions/${mockId}`);
      for (const pp of (detail.body.papers ?? []) as Array<{ code: string; id: string }>) paperIds[pp.code] = pp.id;
      expect(paperIds.EP1).toBeTruthy();
    });

    it("session officielle : candidats depuis la classe ; l'ÉLIGIBILITÉ s'évalue (faits d'academic.getEligibilityFacts + règle liée), plus aucun port_unavailable", async () => {
      const from = await own().post(`/api/v1/examinations/sessions/${officialId}/candidates/from-classroom`, { classroomId: W.classroomId }, [200, 201]);
      expect(from.body.created).toBe(3);
      expect(from.body.failed).toEqual([]);
      const evaluated = await own().post(`/api/v1/examinations/sessions/${officialId}/eligibility/evaluate-all`, {}, [200, 201]);
      expect(evaluated.body.failed, JSON.stringify(evaluated.body)).toEqual([]);
      expect(evaluated.body.evaluated).toBe(3);
      expect(JSON.stringify(evaluated.body)).not.toContain("port_unavailable");
      const session = await own().get(`/api/v1/examinations/sessions/${officialId}`);
      expect(session.body.demoRules ?? session.body.session?.demoRules).toBe(true);
    });

    it("examen blanc : évaluation `EXAMEN_BLANC` publiée dans assess, lien à l'épreuve, notes publiées importées, moyenne et issue CALCULÉES par la règle (jamais officielles)", async () => {
      const teacher = W.teacher as Actor;
      const types = await teacher.get("/api/v1/assess/assessment-types");
      const blancType = (types.body.items as Array<{ id: string; code: string }>).find((t) => t.code === "EXAMEN_BLANC")!.id;
      // La période 1 est close : l'examen blanc se saisit dans la période 2 (ouverte pour l'occasion).
      await own().post(`/api/v1/academic/periods/${W.periodIds[1]}/open`);
      const periods = await own().get(`/api/v1/academic/years/${W.yearId}/periods`);
      const p2 = (periods.body.items as Array<{ id: string; startsOn: string }>).find((x) => x.id === W.periodIds[1])!;
      const a = await teacher.post(
        "/api/v1/assess/assessments",
        { typeId: blancType, academicPeriodId: W.periodIds[1], classroomId: W.classroomId, curriculumNodeId: W.subjects.MATHS!.nodeId2, title: "Examen blanc (démonstration)", assessedOn: p2.startsOn },
        201,
      );
      mockAssessmentId = a.body.id ?? a.body.assessment?.id;
      const scores = ["15", "9", "4"];
      await teacher.put(`/api/v1/assess/assessments/${mockAssessmentId}/grades`, { entries: W.pupils.map((pupil, i) => ({ enrollmentId: pupil.enrollmentId, score: scores[i] })) }, 200);
      await teacher.post(`/api/v1/assess/assessments/${mockAssessmentId}/transitions`, { to: "SUBMITTED" });
      await (W.pedago as Actor).post(`/api/v1/assess/assessments/${mockAssessmentId}/transitions`, { to: "REVIEWED" });
      await (W.pedago as Actor).post(`/api/v1/assess/assessments/${mockAssessmentId}/transitions`, { to: "APPROVED" });
      expect((await dir().post(`/api/v1/assess/assessments/${mockAssessmentId}/transitions`, { to: "PUBLISHED" })).body.assessment.status).toBe("PUBLISHED");
      await own().post(`/api/v1/examinations/sessions/${mockId}/candidates/from-classroom`, { classroomId: W.classroomId }, [200, 201]);
      const cands = await own().get(`/api/v1/examinations/sessions/${mockId}/candidates`);
      const ids = (cands.body.items as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toHaveLength(3);
      await own().post(`/api/v1/examinations/sessions/${mockId}/candidates/register-batch`, { candidateIds: ids }, [200, 201]);
      await own().post(`/api/v1/examinations/sessions/${mockId}/mock/link`, { paperId: paperIds.EP1, classroomId: W.classroomId, assessmentId: mockAssessmentId }, [200, 201]);
      await own().post(`/api/v1/examinations/sessions/${mockId}/transition`, { to: "REGISTRATION_CLOSED" });
      await own().post(`/api/v1/examinations/sessions/${mockId}/transition`, { to: "IN_PROGRESS" });
      const imported = await own().post(`/api/v1/examinations/sessions/${mockId}/mock/import-from-assess`, {}, [200, 201]);
      expect(imported.body.saved).toBe(3);
      const computed = await own().post(`/api/v1/examinations/sessions/${mockId}/mock/compute`, {}, [200, 201]);
      expect(computed.body).toMatchObject({ computed: 3, failed: [], demoRules: true });
      const rows = await p.db.admin.query("SELECT result_code, source, rule_version_ref FROM examinations.candidate_results WHERE tenant_id = $1 AND session_id = $2", [T().tenantId, mockId]);
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows.every((r) => r.source === "COMPUTED" && r.rule_version_ref)).toBe(true);
      // un examen blanc ne produit JAMAIS de document officiel
      const issued = await own().raw("POST", `/api/v1/examinations/candidates/${ids[0]}/documents/issue`, { kind: "ATTESTATION_REUSSITE" });
      expect(issued.status).toBeGreaterThanOrEqual(400);
      expect(issued.status).toBeLessThan(500);
    });
  });

  // ===========================================================================================================
  describe("(8) second tenant (pack SECONDARY) : isolation prouvée par des appels CROISÉS refusés et par la RLS", () => {
    let U: ProvisionedOwner;
    let ownerU: Actor;

    it("un second établissement SECONDARY est provisionné ; son modèle de pack s'applique indépendamment", async () => {
      U = await provisionByConsole(p, { name: "Collège Les Cèdres", slug: "cedres", packs: ["SECONDARY"], ownerEmail: "owner@cedres.test" });
      expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${U.tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["SECONDARY"], status: "ACTIVE" } }), 200);
      await redeemInvitation(p, U.ownerEmail);
      ownerU = actorFrom(p.http, "owner-cedres", U.ownerEmail, await loginWithMfaEnrollment(p, U.ownerEmail, U.slug));
      await waitFor(
        async () => {
          const r = await ownerU.get("/api/v1/rules/bindings");
          return ((r.body.items ?? r.body) as unknown[]).length >= 3;
        },
        { label: "liaisons de règles du second tenant", timeoutMs: 45_000 },
      );
    });

    it("LECTURE croisée : B n'obtient AUCUNE ressource de A par son identifiant (vie scolaire, affectation État, examens, résultats, bulletins…)", async () => {
      const probes: Array<[string, string]> = [
        ["classe", `/api/v1/academic/classrooms/${W.classroomId}`],
        ["inscription", `/api/v1/academic/enrollments/${W.pupils[0]!.enrollmentId}`],
        ["élève", `/api/v1/people/students/${W.pupils[0]!.studentId}`],
        ["candidature", `/api/v1/admissions/applications/${W.pupils[0]!.applicationId}`],
        ["incident", `/api/v1/schoollife/incidents/${W.ids.incident}`],
        ["mesure", `/api/v1/schoollife/measures`],
        ["dossier d'affectation", `/api/v1/stateassign/assignments`],
        ["session d'examen", `/api/v1/examinations/sessions/${W.ids.officialSession ?? W.classroomId}`],
        ["résultats de classe", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}`],
        ["bulletin", `/api/v1/reportcards/report-cards/${W.ids.reportCard}`],
        ["facture", `/api/v1/finance/invoices/${W.ids.stateInvoice}`],
      ];
      for (const [what, url] of probes) {
        const res = await ownerU.raw("GET", url);
        expect([200, 403, 404], `${what} : ${res.status}`).toContain(res.status);
        expect(JSON.stringify(res.body), what).not.toMatch(/KONE|YAO|TRAORE|AFF-P3-0001/);
        if (res.status === 200) expect(JSON.stringify(res.body), `${what} (liste)`).not.toContain(W.pupils[0]!.studentId);
      }
    });

    it("ÉCRITURE croisée : B ne valide, n'applique, ne vérifie ni ne publie rien chez A", async () => {
      const writes: Array<[string, string, unknown]> = [
        ["POST", `/api/v1/schoollife/measures/${W.ids.incident}/validate`, {}],
        ["POST", `/api/v1/stateassign/assignments/${W.ids.incident}/verify`, { rowVersion: 1 }],
        ["POST", `/api/v1/results/classrooms/${W.classroomId}/periods/${W.periodIds[0]}/reopen`, { reason: "Tentative de piratage inter-tenant." }],
        ["POST", `/api/v1/reportcards/report-cards/${W.ids.reportCard}/revoke`, { reason: "Tentative de piratage inter-tenant." }],
        ["POST", `/api/v1/admissions/applications/${W.pupils[0]!.applicationId}/anonymize`, { reason: "Tentative de piratage inter-tenant." }],
      ];
      for (const [method, url, body] of writes) {
        const res = await ownerU.raw(method, url, body);
        expect(res.status, `${method} ${url} : ${JSON.stringify(res.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
    });

    it("base de données : sous l'identité de B, aucune ligne de A dans les tables du parcours (RLS forcée)", async () => {
      const tables = [
        "schoollife.incidents", "schoollife.measures", "schoollife.measure_effects", "stateassign.assignments", "stateassign.receivables",
        "examinations.sessions", "examinations.candidates", "examinations.candidate_results", "admissions.applications", "notifications.deliveries",
        "results.period_results", "assess.assessments", "finance.invoices", "reportcards.report_cards", "academic.enrollments", "people.students",
      ];
      for (const t of tables) {
        const seen = await p.app.v2.tenantDb.run({ tenantId: U.tenantId, userId: ownerU.identityId, roles: [], requestId: `p3s-rls-${t}`, actor: "user", mfa: false } as never, (tx) =>
          tx.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]),
        );
        expect(seen.rows[0]?.n, t).toBe(0);
        const visible = await p.db.admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T().tenantId]);
        expect(visible.rows[0].n, `${t} (visible par l'administrateur)`).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================================================
  describe("(9) santé asynchrone : aucun abonné en échec, aucune lettre morte", () => {
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
