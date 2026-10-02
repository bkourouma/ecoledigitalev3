/**
 * Assemblage : la SAGA d'inscription d'admissions avec les VRAIS modules `people`, `academic`, `finance` branchés par les VRAIS
 * adaptateurs (`platform/adapters/admissions-*.ts`) — aucun port en mémoire entre modules. Une candidature acceptée devient, en UNE
 * transaction, un élève INACTIF (matricule de people, tuteurs liés), une inscription PENDING (academic) et la facture des frais
 * d'inscription (finance) ; le paiement de cette facture fait CONFIRMER l'inscription par academic (décision métier du 2026-10-01) ;
 * `academic.enrollment.confirmed` fait passer le dossier à ENROLLED et l'élève à ACTIVE. Une panne à une étape annule tout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap } from "@ecoledigitale/kernel";
import { academicConsumedInvoicePaidSchema } from "@ecoledigitale/contracts/src/v2/academic";
import { getEnrollment, handleInvoicePaid } from "../../src/modules/academic";
import { acceptOffer, createAdmissionsDeps, createApplication, createCampaign, ensureInstitutionDefaults, getApplication, handleEnrollmentConfirmed, issueOffer, listWorkflows, openCampaign, publishConsentText, recordConsent, recordDecision, RecordingAudit, transitionApplication, updateSettings, upsertCapacities, type AdmissionsDeps, type AdmissionsPorts } from "../../src/modules/admissions";
import { createFee, createFeeSchedule, createFinanceDeps, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { getStudent } from "../../src/modules/people";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");

describeIntegration("admissions assemblées : people + academic + finance réels (saga d'inscription)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let deps: AdmissionsDeps;
  let institution: { id: string; name: string };
  let campaignId: string;
  let workflowId: string;
  let yearCode: string;
  const audit = new RecordingAudit();

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 0 });
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
    const fee = unwrap(await createFee(fin, w.director, { code: "INSC", name: "Frais d'inscription", category: "REGISTRATION" }));
    const day = (n: number): string => new Date(w.clock.now().getTime() + n * 86_400_000).toISOString().slice(0, 10);
    unwrap(await createFeeSchedule(fin, w.director, { feeId: fee.id, academicYear: yearCode, amount: xof(25_000), effectiveFrom: day(-200), scope: { levelKey: "L1", trackKey: "INFO" } }));

    institution = { id: (await adminRows<{ institution_id: string }>(w, "SELECT institution_id FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.institution_id, name: "Université d'assemblage" };
    const adm = w.ports.admissions as AdmissionsPorts;
    // L'établissement de l'assemblage n'est pas dans tenancy : seul l'annuaire des établissements est substitué, tout le reste est réel.
    deps = createAdmissionsDeps({
      db: w.tenantDb,
      systemDb: w.systemDb,
      clock: w.clock,
      audit,
      ports: { ...adm, catalog: { ...adm.catalog, listInstitutions: async () => [institution], getInstitution: async (_c, id) => (id === institution.id ? institution : null) } },
    });
    const init = unwrap(await ensureInstitutionDefaults(deps, w.director, institution.id));
    workflowId = init.workflowId;
    unwrap(await publishConsentText(deps, w.director, { institutionId: institution.id, kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "Je consens au traitement des données de mon enfant." }, { designate: true }));
    unwrap(await updateSettings(deps, w.director, { institutionId: institution.id, duplicatePolicy: "WARN" }));
    const campaign = unwrap(
      await createCampaign(deps, w.director, { institutionId: institution.id, academicYearId: school.seed.yearId, code: "RENTREE", label: "Rentrée", workflowId, opensAt: new Date(Date.now() - 86_400_000).toISOString(), closesAt: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
    );
    unwrap(await upsertCapacities(deps, w.director, campaign.id, { capacities: [{ gradeLevelCode: "L1", seats: 5 }] }));
    unwrap(await openCampaign(deps, w.director, campaign.id));
    campaignId = campaign.id;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  async function accepted(lastName: string): Promise<{ appId: string; offerId: string }> {
    const created = unwrap(
      await createApplication(deps, w.director, {
        campaignId,
        applicantFirstName: "Aminata",
        applicantLastName: lastName,
        applicantBirthDate: "2006-03-14",
        applicantGender: "FEMALE",
        isRepeating: false,
        desiredGradeLevelCode: "L1",
        fundingTypeRequested: "PRIVATE",
        sourceChannel: "WALK_IN",
        guardians: [{ relationshipCode: "MOTHER", firstName: "Salimata", lastName: lastName, phone: "+22507010101", email: `${lastName.toLowerCase()}@example.test`, isPrimary: true, isFinancialResponsible: true, canConsent: true }],
        extra: {},
      }),
    );
    let d = unwrap(await getApplication(deps, w.director, created.id));
    d = unwrap(await recordConsent(deps, w.director, created.id, { guardianId: d.guardians[0]!.id, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "PAPER", evidenceRef: "papier-assemblage" }));
    d = unwrap(await transitionApplication(deps, w.director, created.id, { toStageId: d.allowedTransitions.find((t) => t.toStageCode === "SUBMITTED")!.toStageId }));
    d = unwrap(await transitionApplication(deps, w.director, created.id, { toStageId: d.allowedTransitions.find((t) => t.toStageCode === "UNDER_REVIEW")!.toStageId }));
    d = unwrap(await recordDecision(deps, w.director, created.id, { toStageId: d.allowedTransitions.find((t) => t.toStageCode === "ACCEPTED")!.toStageId, kind: "ACCEPT", overrideCapacity: false }));
    expect(d.status).toBe("ACCEPTED");
    const offer = unwrap(await issueOffer(deps, w.director, created.id, { classroomId: school.seed.classroomId }));
    return { appId: created.id, offerId: offer.offer.id };
  }

  it("catalogue réel : niveaux et classes d'academic, liens de parenté de people", async () => {
    const catalog = w.ports.admissions!.catalog!;
    expect((await catalog.gradeLevels(w.director, institution.id)).map((g) => g.code)).toContain("L1");
    const room = await catalog.classroom(w.director, school.seed.classroomId);
    expect(room).toMatchObject({ id: school.seed.classroomId, gradeLevelCode: "L1", institutionId: institution.id, open: true });
    expect((await catalog.classroomsOf(w.director, { institutionId: institution.id, academicYearId: school.seed.yearId, gradeLevelCode: "L1" })).map((r) => r.id)).toEqual([school.seed.classroomId]);
    expect((await catalog.relationshipTypes(w.director)).map((r) => r.code)).toEqual(expect.arrayContaining(["FATHER", "MOTHER"]));
    expect(await catalog.classroom(w.director, newId())).toBeNull();
  });

  it("acceptation : élève INACTIF avec matricule de people, tuteurs liés, inscription PENDING, facture d'inscription — puis paiement -> confirmation -> ENROLLED", async () => {
    const { appId, offerId } = await accepted("TRAORE");
    const out = unwrap(await acceptOffer(deps, w.director, { offerId, via: "GUARDIAN_LINK" }));
    expect(out.invoiceId).not.toBeNull();
    // people : fiche INACTIVE, matricule gapless attribué par people, tuteur lié (principal, répondant financier).
    const student = unwrap(await getStudent(w.kit.people, w.director, out.studentId));
    expect(student.status).toBe("INACTIVE");
    expect(student.studentNumber).toMatch(/\d/);
    expect(student.primaryGuardian).toMatchObject({ relationshipCode: "MOTHER" });
    const links = await adminRows<{ is_primary_contact: boolean; is_financial_responsible: boolean }>(w, "SELECT is_primary_contact, is_financial_responsible FROM people.student_guardians WHERE student_id = $1", [out.studentId]);
    expect(links).toEqual([{ is_primary_contact: true, is_financial_responsible: true }]);
    // academic : inscription PENDING (politique ON_REGISTRATION_FEE_PAID), source ADMISSION tracée vers la candidature.
    const enrollment = unwrap(await getEnrollment(w.academic.deps, w.director, out.enrollmentId));
    expect(enrollment.status).toBe("PENDING");
    expect(enrollment).toMatchObject({ studentId: out.studentId, classroomId: school.seed.classroomId, sourceKind: "ADMISSION", sourceRef: appId });
    // finance : facture ÉMISE portant les frais d'inscription de l'inscription, jamais payée.
    const invoice = (await adminRows<{ status: string; enrollment_id: string; learner_id: string }>(w, "SELECT status, enrollment_id, learner_id FROM finance.invoices WHERE id = $1", [out.invoiceId]))[0]!;
    expect(invoice).toMatchObject({ enrollment_id: out.enrollmentId, learner_id: out.studentId });
    expect(invoice.status).not.toBe("PAID");
    const lines = await adminRows<{ category: string }>(w, "SELECT category FROM finance.invoice_lines WHERE invoice_id = $1", [out.invoiceId]);
    expect(lines.map((l) => l.category)).toEqual(["REGISTRATION"]);
    // Dossier d'admissions : étape qui crée l'inscription, références posées, pas encore ENROLLED.
    const detail = unwrap(await getApplication(deps, w.director, appId));
    expect(detail).toMatchObject({ stageCode: "AWAITING_PAYMENT", status: "ACCEPTED", studentId: out.studentId, enrollmentId: out.enrollmentId, invoiceId: out.invoiceId });

    // Paiement des frais d'inscription -> academic CONFIRME (décision métier) -> événement consommé par admissions.
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: out.studentId, amount: xof(25_000), method: "TRANSFER", reference: "VIR-ADM-1", allocation: { mode: "AUTO", invoiceIds: [out.invoiceId!] } }));
    const paid = await adminRows<{ payload: Record<string, unknown> }>(w, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'finance.invoice.paid' AND aggregate_id = $2", [w.tenantId, out.invoiceId]);
    expect(paid).toHaveLength(1);
    const confirmed = unwrap(await handleInvoicePaid(w.academic.deps, w.director, academicConsumedInvoicePaidSchema.parse(paid[0]!.payload)));
    expect(confirmed.enrollmentConfirmed).toBe(out.enrollmentId);
    const events = await adminRows<{ payload: { enrollmentId: string; studentId: string } }>(w, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'academic.enrollment.confirmed' AND aggregate_id = $2", [w.tenantId, out.enrollmentId]);
    expect(events).toHaveLength(1);
    // Consommateur d'admissions : ENROLLED dérivé, élève ACTIF, une seule fois (événement rejoué).
    const first = unwrap(await handleEnrollmentConfirmed(deps, w.director, events[0]!.payload));
    expect(first).toMatchObject({ ignored: false, alreadyEnrolled: false, applicationId: appId });
    const replay = unwrap(await handleEnrollmentConfirmed(deps, w.director, events[0]!.payload));
    expect(replay.alreadyEnrolled).toBe(true);
    expect(unwrap(await getApplication(deps, w.director, appId)).status).toBe("ENROLLED");
    expect(unwrap(await getStudent(w.kit.people, w.director, out.studentId)).status).toBe("ACTIVE");
    expect(unwrap(await getEnrollment(w.academic.deps, w.director, out.enrollmentId)).status).toBe("ACTIVE");
    const enrolledEvents = await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'admissions.application.enrolled' AND aggregate_id = $2", [w.tenantId, appId]);
    expect(Number(enrolledEvents[0]!.n)).toBe(1);
  });

  it("ATOMICITÉ réelle : une facture impossible (barème retiré) annule élève, tuteurs et inscription ; l'offre reste en attente et le rejeu aboutit", async () => {
    const { appId, offerId } = await accepted("DIARRA");
    const before = {
      students: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM people.students"))[0]!.n),
      guardians: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM people.guardians"))[0]!.n),
      enrollments: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM academic.enrollments"))[0]!.n),
      invoices: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM finance.invoices"))[0]!.n),
    };
    // Panne simulée côté finance : le port de facturation lève après la création de l'élève, des tuteurs et de l'inscription.
    const real = w.ports.admissions as AdmissionsPorts;
    const failing = createAdmissionsDeps({
      db: w.tenantDb,
      systemDb: w.systemDb,
      clock: w.clock,
      audit,
      ports: { ...real, catalog: deps.ports.catalog, fees: { ...real.fees, issueRegistrationInvoice: async () => { throw Object.assign(new Error("finance indisponible"), { code: "finance.down" }); } } },
    });
    await expect(acceptOffer(failing, w.director, { offerId, via: "GUARDIAN_LINK" })).rejects.toThrow(/finance indisponible/);
    const after = {
      students: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM people.students"))[0]!.n),
      guardians: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM people.guardians"))[0]!.n),
      enrollments: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM academic.enrollments"))[0]!.n),
      invoices: Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM finance.invoices"))[0]!.n),
    };
    expect(after).toEqual(before); // AUCUN élève, tuteur, inscription ni facture : tout est annulé ensemble
    const detail = unwrap(await getApplication(deps, w.director, appId));
    expect(detail).toMatchObject({ stageCode: "ACCEPTED", studentId: null, enrollmentId: null });
    expect(detail.offers[0]!.status).toBe("PENDING");
    // Rejouable : l'acceptation aboutit une fois la panne levée, avec un seul élève.
    const retry = unwrap(await acceptOffer(deps, w.director, { offerId, via: "GUARDIAN_LINK" }));
    expect(retry.replayed).toBe(false);
    expect(Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM people.students"))[0]!.n)).toBe(before.students + 1);
    // Rejeu après succès : même résultat, rien de recréé (idempotent par offre, y compris côté facture).
    const again = unwrap(await acceptOffer(deps, w.director, { offerId, via: "GUARDIAN_LINK" }));
    expect(again).toMatchObject({ replayed: true, studentId: retry.studentId, enrollmentId: retry.enrollmentId, invoiceId: retry.invoiceId });
    expect(Number((await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM finance.invoices"))[0]!.n)).toBe(before.invoices + 1);
  });

  it("sans barème d'inscription applicable : aucune facture, academic confirme l'inscription d'emblée et admissions passe à ENROLLED", async () => {
    // Un niveau/parcours sans barème : on retire le barème en le désactivant pour CE test (cas « aucun frais dû »).
    await w.db.admin.query("UPDATE finance.fee_schedules SET active = false");
    try {
      const { appId, offerId } = await accepted("KEITA");
      const out = unwrap(await acceptOffer(deps, w.director, { offerId, via: "GUARDIAN_LINK" }));
      expect(out.invoiceId).toBeNull();
      expect(unwrap(await getEnrollment(w.academic.deps, w.director, out.enrollmentId)).status).toBe("ACTIVE");
      const events = await adminRows<{ payload: { enrollmentId: string } }>(w, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'academic.enrollment.confirmed' AND aggregate_id = $2", [w.tenantId, out.enrollmentId]);
      expect(events).toHaveLength(1);
      unwrap(await handleEnrollmentConfirmed(deps, w.director, events[0]!.payload));
      expect(unwrap(await getApplication(deps, w.director, appId)).status).toBe("ENROLLED");
      expect(unwrap(await getStudent(w.kit.people, w.director, out.studentId)).status).toBe("ACTIVE");
    } finally {
      await w.db.admin.query("UPDATE finance.fee_schedules SET active = true");
    }
  });

  it("listWorkflows : le modèle livré est instancié pour l'établissement et publié", async () => {
    const all = unwrap(await listWorkflows(deps, w.director, institution.id));
    expect(all.some((x) => x.status === "PUBLISHED" && x.code === "STANDARD")).toBe(true);
  });
});
