/**
 * Assemblage réel de stateassign : academic (inscription, financement), finance (bourse de l'État, factures séparées, versement
 * du financeur), attendance (faits de présence), documents, people — par les VRAIS adaptateurs de `platform/adapters`, sans port en
 * mémoire entre modules. Prouve la cohérence des parts État / parent avec les factures de `finance` (la facture de la famille ne
 * porte que la part parent), la référence d'affectation à une seule source, et les créances sur l'État rapprochées des paiements reçus.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { changeEnrollmentFunding, getEnrollment, listEnrollmentFundings } from "../../src/modules/academic";
import { createFinanceDeps, createInvoice, createScholarship, recordManualPayment, setLearnerFunding, type FinanceDeps } from "../../src/modules/finance";
import {
  actOnAssignment,
  completeControl,
  createStateassignDeps,
  getAssignmentDetail,
  planControl,
  reconcileAssignment,
  recordAssignment,
  scheduleReceivable,
  type StateassignDeps,
} from "../../src/modules/stateassign";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, ctxOf, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");
const dayOffset = (w: AssemblyWorld, days: number): string => new Date(w.clock.now().getTime() + days * 86_400_000).toISOString().slice(0, 10);
const human = (w: AssemblyWorld, roles: string[] = ["secretariat"]): RequestContext => ctxOf(w, newId(), roles, true);

describeIntegration("stateassign assemblé : academic + finance + attendance + documents + people (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let sa: StateassignDeps;
  let yearCode: string;
  const secretary = (): RequestContext => ctxOf(w, "0192f0a4-7b1e-7c3a-8d2e-0000000000c1", ["secretariat"], true);
  const bursar = (): RequestContext => ctxOf(w, "0192f0a4-7b1e-7c3a-8d2e-0000000000c2", ["econome"], true);

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 4 });
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    sa = createStateassignDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.stateassign });
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("tous les ports du module sont branchés par la plateforme, sauf la passerelle (NotConfigured)", () => {
    expect(Object.keys(w.ports.stateassign).sort()).toEqual(["attendance", "documents", "enrollments", "finance", "funding", "guardianship", "students"]);
    expect(sa.ports.gateway.adapter).toBe("NotConfigured");
    expect(sa.ports.gateway.status().configured).toBe(false);
  });

  describe("élève affecté : parts séparées par finance, vérification, rapprochement, créances", () => {
    const state: { studentId: string; enrollmentId: string; assignmentId: string; scholarshipId: string; stateInvoiceId: string; parentInvoiceId: string } = {} as never;

    it("finance sépare la part de l'État (80 %) de la part de la famille ; l'inscription ne porte pas encore de référence d'affectation", async () => {
      const pupil = school.pupils[0]!;
      state.studentId = pupil.studentId;
      state.enrollmentId = pupil.enrollmentId;
      unwrap(await setLearnerFunding(fin, w.director, { learnerId: pupil.studentId, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-REAL-1" }));
      const scholarship = unwrap(await createScholarship(fin, w.director, { learnerId: pupil.studentId, academicYear: yearCode, funderKind: "STATE", funderName: "État", reference: "AFF-REAL-1", coverage: { kind: "PERCENT", bps: 8000 } }));
      state.scholarshipId = scholarship.id;
      const created = unwrap(
        await createInvoice(fin, w.director, {
          learnerId: pupil.studentId,
          enrollmentId: pupil.enrollmentId,
          lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(500_000) }],
          dueDate: dayOffset(w, 60),
          applyFunding: true,
          issue: true,
        }),
      );
      const funder = created.invoices.find((i) => i.invoice.payerKind === "FUNDER")!.invoice;
      const parent = created.invoices.find((i) => i.invoice.payerKind === "LEARNER")!.invoice;
      expect(funder.total.amount).toBe(400_000);
      expect(parent.total.amount).toBe(100_000); // la facture de la famille ne porte QUE la part parent
      state.stateInvoiceId = funder.id;
      state.parentInvoiceId = parent.id;
      const enrollment = unwrap(await getEnrollment(w.kit.academic, w.director, pupil.enrollmentId));
      expect(enrollment.assignmentReference).toBeNull();
    });

    it("enregistrer puis VÉRIFIER (autre personne) : academic reçoit la référence d'affectation (une seule source), type STATE_ASSIGNED", async () => {
      const rec = unwrap(await recordAssignment(sa, secretary(), { enrollmentId: state.enrollmentId, reference: "AFF-REAL-1", issuingAuthority: "Direction régionale", issuedOn: "2026-09-15", declaredStateAmount: 400_000, declaredParentAmount: 100_000 }));
      state.assignmentId = rec.id;
      expect(rec).toMatchObject({ status: "RECEIVED", studentId: state.studentId });
      const refused = await actOnAssignment(sa, secretary(), rec.id, "verify", {});
      expect(refused.ok).toBe(false);
      const verified = unwrap(await actOnAssignment(sa, bursar(), rec.id, "verify", { note: "Conforme" }));
      expect(verified.status).toBe("VERIFIED");
      const enrollment = unwrap(await getEnrollment(w.kit.academic, w.director, state.enrollmentId));
      expect(enrollment).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-REAL-1", funderLabel: "Direction régionale", assignmentIssuedOn: "2026-09-15" });
      const events = await adminRows<{ type: string }>(w, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY occurred_at", [w.tenantId, state.enrollmentId]);
      expect(events.map((e) => e.type)).toContain("academic.enrollment.funding_changed");
      unwrap(await actOnAssignment(sa, bursar(), rec.id, "activate", {}));
    });

    it("rapprochement avec les VRAIES factures : BALANCED, liens (bourse, facture de l'État, facture de la famille) posés, noms lus chez people", async () => {
      const r = unwrap(await reconcileAssignment(sa, bursar(), state.assignmentId));
      expect(r.assignment.reconciliation).toMatchObject({ status: "BALANCED", stateDelta: { amount: 0 }, parentDelta: { amount: 0 }, stateBilled: { amount: 400_000 }, parentBilled: { amount: 100_000 } });
      expect(r.assignment.finance).toEqual({ scholarshipId: state.scholarshipId, stateInvoiceId: state.stateInvoiceId, parentInvoiceId: state.parentInvoiceId });
      expect(r.assignment.studentName).toContain("ETUDIANT1");
      expect(r.billing.scholarshipIds).toEqual([state.scholarshipId]);
      expect(r.warnings).toEqual([]);
    });

    it("créances : échéances planifiées, versement de l'État reçu chez finance affecté à la plus ancienne ; paiement visible en lecture", async () => {
      const a = unwrap(await scheduleReceivable(sa, bursar(), state.assignmentId, { label: "1er versement", dueOn: dayOffset(w, -10), expectedAmount: 150_000 }));
      const b = unwrap(await scheduleReceivable(sa, bursar(), state.assignmentId, { label: "2e versement", dueOn: dayOffset(w, 90), expectedAmount: 250_000 }));
      expect([a.status, b.status]).toEqual(["OPEN", "OPEN"]);
      // l'État verse 200 000 : paiement du FINANCEUR, imputé sur SA facture par finance
      unwrap(
        await recordManualPayment(fin, w.director, {
          idempotencyKey: `etat-${newId()}`,
          learnerId: state.studentId,
          enrollmentId: state.enrollmentId,
          amount: xof(200_000),
          method: "TRANSFER",
          reference: "VIR-ETAT-001",
          payerKind: "FUNDER",
          payerRef: state.scholarshipId,
          allocation: { mode: "AUTO", invoiceIds: [state.stateInvoiceId] },
        }),
      );
      const r = unwrap(await reconcileAssignment(sa, bursar(), state.assignmentId));
      expect(r.receivables.map((x) => [x.seq, x.status, x.received.amount, x.outstanding.amount])).toEqual([[1, "RECEIVED", 150_000, 0], [2, "PARTIALLY_RECEIVED", 50_000, 200_000]]);
      expect(r.unallocated.amount).toBe(0);
      expect(r.billing.statePayments).toHaveLength(1);
      expect(r.billing.statePayments[0]).toMatchObject({ amount: { amount: 200_000 }, reference: "VIR-ETAT-001" });
      const detail = unwrap(await getAssignmentDetail(sa, bursar(), state.assignmentId));
      expect(detail.enrollment).toMatchObject({ fundingType: "STATE_ASSIGNED", referenceMatchesAssignment: true });
      expect(detail.receivablesSummary).toMatchObject({ expected: { amount: 400_000 }, received: { amount: 200_000 }, outstanding: { amount: 200_000 } });
    });

    it("contrôle de présence : les faits viennent d'attendance (période réelle) et sont consignés tels quels", async () => {
      const period = school.ref.academicPeriodId;
      const facts = await w.ports.stateassign.attendance!.getFacts(bursar(), { enrollmentId: state.enrollmentId, periodId: period });
      expect(facts).toEqual({ absentMinutes: 0, excusedMinutes: 0, lateCount: 0, periodId: period });
      expect(await w.ports.stateassign.attendance!.getFacts(bursar(), { enrollmentId: state.enrollmentId, periodId: null })).toBeNull();
      const periods = await w.ports.stateassign.enrollments!.listPeriods(bursar(), school.seed.yearId);
      expect(periods.map((p) => p.id)).toContain(period);
      const control = unwrap(await planControl(sa, bursar(), state.assignmentId, { kind: "ATTENDANCE", academicPeriodId: period, dueOn: dayOffset(w, 5) }));
      const done = unwrap(await completeControl(sa, bursar(), control.id, { outcome: "OK" }));
      expect(done).toMatchObject({ status: "OK", evidence: { attendance: { available: true, source: "attendance", absentMinutes: 0, lateCount: 0, periodId: period } } });
    });
  });

  it("une facture de la famille qui porte AUSSI la part de l'État (financement non séparé) est signalée : écart + DISCREPANCY", async () => {
    const pupil = school.pupils[1]!;
    unwrap(
      await createInvoice(fin, w.director, {
        learnerId: pupil.studentId,
        enrollmentId: pupil.enrollmentId,
        lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(500_000) }],
        dueDate: dayOffset(w, 60),
        issue: true,
      }),
    );
    const rec = unwrap(await recordAssignment(sa, secretary(), { enrollmentId: pupil.enrollmentId, reference: "AFF-REAL-2", declaredStateAmount: 400_000, declaredParentAmount: 100_000 }));
    unwrap(await actOnAssignment(sa, bursar(), rec.id, "verify", {}));
    const r = unwrap(await reconcileAssignment(sa, bursar(), rec.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", stateDelta: { amount: -400_000 }, parentDelta: { amount: 400_000 }, parentBilled: { amount: 500_000 } });
    expect(r.warnings.join(" ")).toMatch(/Aucune facture de l'État/);
    const alerts = await adminRows<{ type: string }>(w, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2", [w.tenantId, rec.id]);
    expect(alerts.map((a) => a.type)).toContain("stateassign.reconciliation.discrepancy");
  });

  it("CUMUL (O-04) : bourse + État + famille avec les vrais adaptateurs — la vérification n'écrase pas la bourse, les parts sont facturées par financeur et rapprochées", async () => {
    const pupil = school.pupils[3]!;
    // Inscription déjà boursière (type principal historique) AVANT l'affectation de l'État.
    unwrap(await changeEnrollmentFunding(w.kit.academic, w.director, pupil.enrollmentId, { fundingType: "SCHOLARSHIP", funderLabel: "Fondation Espoir", reason: "Bourse accordée avant l'affectation" }));
    // finance : État 60 % + fondation 20 % du total net, famille 20 % ; type principal « affecté » + « boursier » cumulés.
    unwrap(await setLearnerFunding(fin, w.director, { learnerId: pupil.studentId, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-CUM-1", additionalFundingTypes: ["SCHOLARSHIP"] }));
    const stateSch = unwrap(await createScholarship(fin, w.director, { learnerId: pupil.studentId, academicYear: yearCode, funderKind: "STATE", funderName: "État", reference: "AFF-CUM-1", coverage: { kind: "PERCENT", bps: 6000 }, shareBasis: "TOTAL", priority: 1 }));
    const foundation = unwrap(await createScholarship(fin, w.director, { learnerId: pupil.studentId, academicYear: yearCode, funderKind: "FOUNDATION", funderName: "Fondation Espoir", coverage: { kind: "PERCENT", bps: 2000 }, shareBasis: "TOTAL", priority: 2 }));
    const created = unwrap(
      await createInvoice(fin, w.director, {
        learnerId: pupil.studentId,
        enrollmentId: pupil.enrollmentId,
        lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(500_000) }],
        dueDate: dayOffset(w, 60),
        applyFunding: true,
        issue: true,
      }),
    );
    expect(created.invoices.map((i) => `${i.invoice.payerRef ?? "FAMILLE"}:${i.invoice.total.amount}`).sort()).toEqual([`${stateSch.id}:300000`, `${foundation.id}:100000`, "FAMILLE:100000"].sort());
    // stateassign : l'acte déclare 300 000 pour l'État et 200 000 pour la famille (dont la bourse de 100 000).
    const rec = unwrap(await recordAssignment(sa, secretary(), { enrollmentId: pupil.enrollmentId, reference: "AFF-CUM-1", issuingAuthority: "Direction régionale", issuedOn: "2026-09-15", declaredStateAmount: 300_000, declaredParentAmount: 200_000 }));
    unwrap(await actOnAssignment(sa, bursar(), rec.id, "verify", {}));
    const enrollment = unwrap(await getEnrollment(w.kit.academic, w.director, pupil.enrollmentId));
    expect(enrollment.fundingType).toBe("SCHOLARSHIP"); // la bourse n'est pas écrasée : le cumul s'y ajoute
    const cumul = unwrap(await listEnrollmentFundings(w.kit.academic, w.director, pupil.enrollmentId));
    expect(cumul.fundings.map((f) => [f.fundingType, f.share, f.assignmentReference])).toEqual([["STATE_ASSIGNED", { kind: "AMOUNT", amount: 300_000, currency: "XOF" }, "AFF-CUM-1"]]);
    // rapprochement : la bourse est comptée avec la part de la famille déclarée.
    const r = unwrap(await reconcileAssignment(sa, bursar(), rec.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "BALANCED", stateBilled: { amount: 300_000 }, parentBilled: { amount: 200_000 } });
    expect(r.billing.otherFunderInvoices.map((i) => [i.scholarshipId, i.funderKind, i.total.amount])).toEqual([[foundation.id, "FOUNDATION", 100_000]]);
    // le versement de la fondation (payeur FUNDER rattaché à SA bourse) n'est jamais compté comme un versement de l'État
    unwrap(
      await recordManualPayment(fin, w.director, {
        idempotencyKey: `fond-${newId()}`,
        learnerId: pupil.studentId,
        enrollmentId: pupil.enrollmentId,
        amount: xof(100_000),
        method: "TRANSFER",
        reference: "VIR-FOND-001",
        payerKind: "FUNDER",
        payerRef: foundation.id,
        allocation: { mode: "AUTO", invoiceIds: [created.invoices.find((i) => i.invoice.payerRef === foundation.id)!.invoice.id] },
      }),
    );
    const after = unwrap(await reconcileAssignment(sa, bursar(), rec.id));
    expect(after.billing.statePayments).toEqual([]);
    expect(after.billing.otherFunderInvoices[0]).toMatchObject({ paid: { amount: 100_000 } });
    // le versement de l'État, lui, est bien rapproché
    unwrap(
      await recordManualPayment(fin, w.director, {
        idempotencyKey: `etat-${newId()}`,
        learnerId: pupil.studentId,
        enrollmentId: pupil.enrollmentId,
        amount: xof(300_000),
        method: "TRANSFER",
        reference: "VIR-ETAT-CUM",
        payerKind: "FUNDER",
        payerRef: stateSch.id,
        allocation: { mode: "AUTO", invoiceIds: [created.invoices.find((i) => i.invoice.payerRef === stateSch.id)!.invoice.id] },
      }),
    );
    const final = unwrap(await reconcileAssignment(sa, bursar(), rec.id));
    expect(final.billing.statePayments.map((p) => p.amount.amount)).toEqual([300_000]);
  });

  it("documents et tutelle : un document inconnu n'existe pas pour la GED réelle ; un compte sans fiche liée n'est tuteur de personne (échec fermé)", async () => {
    expect(await w.ports.stateassign.documents!.exists(bursar(), newId(), { read: true, readRestricted: true })).toBe(false);
    const stranger = ctxOf(w, newId(), ["parent"], false);
    expect(await w.ports.stateassign.guardianship!.isGuardianOf(stranger, stranger.userId!, school.pupils[0]!.studentId)).toBe(false);
    expect(await w.ports.stateassign.guardianship!.childrenOf(stranger, stranger.userId!)).toEqual([]);
    expect(await w.ports.stateassign.guardianship!.studentIdForUser(stranger, stranger.userId!)).toBeNull();
    const names = await w.ports.stateassign.students!.names(bursar(), [school.pupils[2]!.studentId, newId()]);
    expect([...names.values()]).toHaveLength(1);
    expect([...names.values()][0]).toContain("ETUDIANT3");
  });

  it("une inscription hors périmètre ou inconnue est absente (aucune fuite) ; le refus d'academic annule la vérification", async () => {
    expect(await w.ports.stateassign.enrollments!.getEnrollment(bursar(), newId())).toBeNull();
    const scoped = ctxOf(w, newId(), ["secretariat"], true);
    const other = { ...scoped, institutionId: newId() } as RequestContext;
    expect(await w.ports.stateassign.enrollments!.getEnrollment(other, school.pupils[2]!.enrollmentId)).toBeNull();
    const refused = await w.ports.stateassign.funding!.setStateAssignedFunding(bursar(), { enrollmentId: school.pupils[2]!.enrollmentId, reference: "", issuedOn: null, funderLabel: null, reason: "Test de refus" });
    expect(refused.ok).toBe(false);
  });
});
