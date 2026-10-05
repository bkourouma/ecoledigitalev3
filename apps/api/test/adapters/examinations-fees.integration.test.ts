/**
 * Frais d'examen (Q-E13) sur le VRAI module `finance` (catalogue, barèmes, factures, paiements) via l'adaptateur de plateforme
 * `examinations-finance.ts` : catalogue EXAMS, facture d'un élève inscrit à l'examen (idempotente, périmètre fixé par l'inscription),
 * statut de paiement relu en direct, désinscription (annulation d'une facture non encaissée ; facture encaissée -> remboursement
 * manuel), candidat libre sans compte famille (facture à établir, aucune donnée personnelle transmise). Montants FICTIFS de test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap } from "@ecoledigitale/kernel";
import { createExaminationsDeps } from "../../src/modules/examinations/application/deps";
import { createFromClassroom, listCandidates, registerCandidate, withdrawCandidate } from "../../src/modules/examinations/application/candidates";
import { createExternalCandidate } from "../../src/modules/examinations/application/external-candidates";
import { evaluateEligibility } from "../../src/modules/examinations/application/eligibility";
import { confirmRefund, getCandidateFee, setFeeItems } from "../../src/modules/examinations/application/fees";
import { noopAudit } from "../../src/modules/examinations/application/ports";
import { createExamType, createPaper } from "../../src/modules/examinations/application/reference";
import { createSession, instantiateSession, transitionSession } from "../../src/modules/examinations/application/sessions";
import { createFee, createFeeSchedule, createFinanceDeps, getInvoiceById, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { getAcademicYear } from "../../src/modules/academic";
import { describeIntegration } from "../../src/modules/examinations/test/support/db";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");

describeIntegration("frais d'examen sur le vrai module finance (adaptateur examinations-finance)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let feeId: string;
  let sessionId: string;
  let typeId: string;

  const deps = () => createExaminationsDeps({ db: w.tenantDb, audit: noopAudit, ports: w.ports.examinations });

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 3 });
    await w.db.admin.query("INSERT INTO tenancy.institutions (id, tenant_id, code, name, pack, education_system, country_code) VALUES ($1, $2, 'ecole-frais', 'École frais', 'HIGHER', 'CI', 'CI')", [w.academic.institutionId, w.tenantId]);
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    const yearCode = unwrap(await getAcademicYear(w.academic.deps, w.director, school.seed.yearId)).code;
    // Barème de la comptabilité (catégorie EXAMS) : montant FICTIF de test, fixé dans `finance`, jamais dans `examinations`.
    feeId = unwrap(await createFee(fin, w.director, { code: "EXAM-TEST", name: "Frais d'examen (fictif)", category: "EXAMS" })).id;
    unwrap(await createFeeSchedule(fin, w.director, { feeId, academicYear: yearCode, amount: xof(7_500), effectiveFrom: "2000-01-01", scope: {} }));
    // Un frais d'une autre catégorie ne figure jamais au catalogue d'examen.
    unwrap(await createFee(fin, w.director, { code: "SCOL-TEST", name: "Scolarité (fictive)", category: "TUITION" }));

    const d = deps();
    const grade = (await w.ports.examinations.students!.getClassroomRoster(w.director, school.seed.classroomId))!.gradeLevelCode as string;
    const type = unwrap(await createExamType(d, w.director, { code: "FRAISX", label: "Examen d'essai (fictif)", educationLevelCode: "HIGHER", gradeLevelCode: grade, sourceKind: "placeholder" }));
    typeId = type.id;
    unwrap(await createPaper(d, w.director, type.id, { code: "P1", label: "Épreuve (fictive)", coefficient: "1", scaleMax: "20", isOptional: false, ordinal: 1, sourceKind: "placeholder" }));
    const session = unwrap(await createSession(d, w.director, { examTypeId: type.id, institutionId: w.academic.institutionId, code: "FRAISX-1", label: "Session d'essai", sessionKind: "OFFICIAL", attemptKind: "NORMAL", sessionYear: 2027, sourceKind: "placeholder" }));
    sessionId = session.id;
    unwrap(await instantiateSession(d, w.director, session.id));
    unwrap(await transitionSession(d, w.director, session.id, "REGISTRATION_OPEN"));
    unwrap(await createFromClassroom(d, w.director, session.id, { classroomId: school.seed.classroomId }));
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  const register = async (candidateId: string) => {
    unwrap(await evaluateEligibility(deps(), w.director, candidateId, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] }));
    return unwrap(await registerCandidate(deps(), w.director, candidateId));
  };

  it("le port `fees` est branché sur finance ; le catalogue ne propose que la catégorie EXAMS active", async () => {
    expect(Object.keys(w.ports.examinations)).toContain("fees");
    const catalog = unwrap(await w.ports.examinations.fees!.listCatalog(w.director));
    expect(catalog.map((c) => [c.code, c.label, c.currency])).toEqual([["EXAM-TEST", "Frais d'examen (fictif)", "XOF"]]);
  });

  it("barème VIDE : l'inscription n'émet aucune facture (aucun montant inventé)", async () => {
    const list = unwrap(await listCandidates(deps(), w.director, sessionId, { page: 1, pageSize: 20 }));
    const first = list.items[0]!;
    const before = await adminRows(w, "SELECT count(*)::int AS n FROM finance.invoices");
    await register(first.id);
    const after = await adminRows(w, "SELECT count(*)::int AS n FROM finance.invoices");
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(unwrap(await getCandidateFee(deps(), w.director, first.id))).toMatchObject({ status: "NOT_APPLICABLE", payment: { status: "NONE" } });
  });

  it("barème défini : l'inscription d'un élève émet UNE facture réelle (montant du barème de finance), le paiement est relu en direct", async () => {
    unwrap(await setFeeItems(deps(), w.director, typeId, { items: [{ feeId, appliesTo: "ALL", active: true }] }));
    const list = unwrap(await listCandidates(deps(), w.director, sessionId, { page: 1, pageSize: 20 }));
    const second = list.items.find((c) => c.registrationStatus === "DRAFT")!;
    await register(second.id);
    const fee = unwrap(await getCandidateFee(deps(), w.director, second.id));
    expect(fee).toMatchObject({ status: "INVOICED", totalMinor: 7_500, currency: "XOF", payment: { status: "UNPAID", paidMinor: 0 } });
    expect(fee.invoiceNumber).toMatch(/^FAC-/);
    // la facture existe réellement dans finance, au nom de l'élève, avec la clé d'idempotence du candidat
    const invoice = unwrap(await getInvoiceById(fin, w.director, fee.invoiceId as string));
    expect(invoice.invoice).toMatchObject({ status: "ISSUED", idempotencyKey: `exam-fee-${second.id}` });
    expect(invoice.invoice.total.amount).toBe(7_500);
    expect(invoice.lines.map((l) => l.category)).toEqual(["EXAMS"]);
    // un rejeu du port avec la même clé ne crée pas de seconde facture
    const replay = unwrap(await w.ports.examinations.fees!.issueInvoice(w.director, { candidateId: second.id, payer: { kind: "STUDENT", studentId: second.studentId as string, enrollmentId: second.enrollmentId }, feeIds: [feeId], idempotencyKey: `exam-fee-${second.id}` }));
    expect(replay).toMatchObject({ mode: "INVOICED", invoiceId: fee.invoiceId });
    expect((await adminRows(w, "SELECT count(*)::int AS n FROM finance.invoices WHERE idempotency_key = $1", [`exam-fee-${second.id}`]))[0]!.n).toBe(1);
    // paiement partiel puis complet, relus en direct
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: second.studentId as string, amount: xof(2_500), method: "TRANSFER", reference: "VIR-EXAM-1", allocation: { mode: "AUTO", invoiceIds: [fee.invoiceId as string] } }));
    expect(unwrap(await getCandidateFee(deps(), w.director, second.id)).payment).toMatchObject({ status: "PARTIAL", paidMinor: 2_500 });
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: second.studentId as string, amount: xof(5_000), method: "TRANSFER", reference: "VIR-EXAM-2", allocation: { mode: "AUTO", invoiceIds: [fee.invoiceId as string] } }));
    expect(unwrap(await getCandidateFee(deps(), w.director, second.id)).payment).toMatchObject({ status: "PAID", paidMinor: 7_500 });
    // désinscription d'un élève qui a PAYÉ : la facture n'est pas annulée, remboursement manuel signalé puis confirmé
    unwrap(await withdrawCandidate(deps(), w.director, second.id, "Départ de l'établissement"));
    const due = unwrap(await getCandidateFee(deps(), w.director, second.id));
    expect(due.status).toBe("REFUND_DUE");
    expect(unwrap(await getInvoiceById(fin, w.director, fee.invoiceId as string)).invoice.status).toBe("PAID");
    expect(unwrap(await confirmRefund(deps(), w.director, second.id, "Remboursé par virement (comptabilité)")).status).toBe("REFUND_DONE");
  });

  it("désinscription d'un élève qui n'a PAS payé : la facture réelle est annulée", async () => {
    const list = unwrap(await listCandidates(deps(), w.director, sessionId, { page: 1, pageSize: 20 }));
    const third = list.items.find((c) => c.registrationStatus === "DRAFT")!;
    await register(third.id);
    const fee = unwrap(await getCandidateFee(deps(), w.director, third.id));
    expect(fee.status).toBe("INVOICED");
    unwrap(await withdrawCandidate(deps(), w.director, third.id, "Désistement de la famille"));
    expect(unwrap(await getCandidateFee(deps(), w.director, third.id))).toMatchObject({ status: "CANCELLED", payment: { status: "CANCELLED" } });
    expect(unwrap(await getInvoiceById(fin, w.director, fee.invoiceId as string)).invoice.status).toBe("CANCELLED");
  });

  it("candidat LIBRE sans compte famille : aucune facture créée dans finance, facture à établir par la comptabilité", async () => {
    const free = unwrap(await createExternalCandidate(deps(), w.director, sessionId, {
      identity: { lastName: "LIBREFRAIS", firstName: "Candidat", birthDate: "2005-05-05", birthPlace: "Daloa", sex: "M" },
      profile: { contactPhone: "+2250700099999", guardianName: "Tuteur Fictif", declaredInExamGrade: true, declaredPriorAttempts: 0 },
    }));
    const before = (await adminRows(w, "SELECT count(*)::int AS n FROM finance.invoices"))[0]!.n;
    unwrap(await evaluateEligibility(deps(), w.director, free.id, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] }));
    unwrap(await registerCandidate(deps(), w.director, free.id));
    expect((await adminRows(w, "SELECT count(*)::int AS n FROM finance.invoices"))[0]!.n).toBe(before);
    expect(unwrap(await getCandidateFee(deps(), w.director, free.id))).toMatchObject({ status: "AWAITING_MANUAL_INVOICE", payerKind: "EXTERNAL", invoiceId: null, payment: { status: "NONE" } });
  });

  it("finance indisponible (port non branché) : l'inscription est maintenue, l'obligation reste à facturer avec le code stable", async () => {
    const d = createExaminationsDeps({ db: w.tenantDb, audit: noopAudit, ports: { ...w.ports.examinations, fees: undefined as never } });
    const free = unwrap(await createExternalCandidate(d, w.director, sessionId, {
      identity: { lastName: "SANSFINANCE", firstName: "Candidat", birthDate: "2005-05-06", birthPlace: "Daloa", sex: "F" },
      profile: { contactPhone: "+2250700088888", declaredInExamGrade: true, declaredPriorAttempts: 0 },
    }));
    unwrap(await evaluateEligibility(d, w.director, free.id, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] }));
    expect(unwrap(await registerCandidate(d, w.director, free.id)).registrationStatus).toBe("REGISTERED");
    const row = (await adminRows(w, "SELECT status, last_error_code FROM examinations.candidate_fees WHERE candidate_id = $1", [free.id]))[0]!;
    expect(row).toEqual({ status: "PENDING_INVOICE", last_error_code: "examinations.port_unavailable" });
  });
});
