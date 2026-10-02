/**
 * PDF des reçus (finance) et des bulletins de paie (payroll) par `reportcards`, avec les VRAIS adaptateurs sur une base migrée
 * par toutes les migrations v2 : annuaire d'apprenants réel (people), snapshot -> scellement -> rendu (worker simulé, moteur
 * factice) -> stockage -> téléchargement -> vérification publique (code ET fichier). Le rendu Chromium réel des gabarits est
 * couvert par `reportcards/test/integration/pdf-renderer.test.ts` (conditionnel : Chrome présent).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock, Money, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createFinanceDeps, createFee, createFeeSchedule, issueInvoiceFromSchedule, getReceiptById, getReceiptPdf, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { buildPayslipDocument, type PayslipPaymentFacts } from "../../src/modules/payroll";
import {
  FakePdfRenderer,
  InMemoryStorage,
  StaticKeyProvider,
  createReportcardsDeps,
  ensureBuiltinTemplates,
  generateSigningKeyPair,
  putBranding,
  renderOfficialDocument,
  requestOfficialDocument,
  verifyByCode,
  verifyByFile,
  type ReportcardsDeps,
} from "../../src/modules/reportcards";
import { createFinanceReceiptDocuments } from "../../src/platform/adapters/finance-reportcards";
import { createPayrollPayslipDocuments } from "../../src/platform/adapters/payroll-reportcards";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");

describeIntegration("documents officiels : reçu (finance) et bulletin de paie (payroll) -> reportcards, adaptateurs réels", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let rc: ReportcardsDeps; // API : scelle et lit (pas de moteur de rendu)
  let worker: ReportcardsDeps; // worker : rend (moteur factice) ; mêmes base et stockage
  let fin: FinanceDeps;
  let renderer: FakePdfRenderer;
  let storage: InMemoryStorage;
  let clock: ManualClock;
  let ctx: RequestContext;
  let studentName: string;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 1 });
    clock = new ManualClock("2026-02-03T10:00:00.000Z");
    storage = new InMemoryStorage(clock);
    renderer = new FakePdfRenderer();
    const keys = new StaticKeyProvider(generateSigningKeyPair().privateKey, "asm-key-2026");
    const base = { db: w.tenantDb, systemDb: w.systemDb, clock, config: { verificationBaseUrl: "https://verif.example.test" } };
    rc = createReportcardsDeps({ ...base, keys, ports: { storage } });
    worker = createReportcardsDeps({ ...base, ports: { storage, renderer } });
    ctx = w.director;
    unwrap(await ensureBuiltinTemplates(rc));
    unwrap(await putBranding(rc, ctx, { legalName: "École d'assemblage", headerLeft: ["Ministère exemple"], headerRight: [], address: "1 rue de l'Exemple", primaryColor: "#14532D" }));
    fin = createFinanceDeps({ db: w.tenantDb, clock, logger: w.kit.logger, portsProvider: () => ({ ...w.ports.finance, documents: createFinanceReceiptDocuments(rc) }) });
    const learner = await w.ports.finance.learners!.getLearner(ctx, school.pupils[0]!.studentId);
    studentName = learner!.displayName!;
    // lecture PAR LOT des noms (listes, exports) : une seule lecture, l'inconnu est absent
    const names = await w.ports.finance.learners!.getLearnerNames!(ctx, [school.pupils[0]!.studentId, newId()]);
    expect([...names.entries()]).toEqual([[school.pupils[0]!.studentId, studentName]]);
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  describe("reçu de paiement", () => {
    let receiptId: string;
    let code: string;

    beforeAll(async () => {
      const fee = unwrap(await createFee(fin, ctx, { code: "SCOL", name: "Scolarité", category: "TUITION" }));
      unwrap(await createFeeSchedule(fin, ctx, { feeId: fee.id, academicYear: "2025-2026", amount: xof(100_000), effectiveFrom: "2025-06-01" }));
      const inv = unwrap(await issueInvoiceFromSchedule(fin, ctx, { learnerId: school.pupils[0]!.studentId, academicYear: "2025-2026", items: [{ feeCode: "SCOL" }] }));
      const pay = unwrap(
        await recordManualPayment(fin, ctx, {
          idempotencyKey: `pay-${newId()}`,
          learnerId: school.pupils[0]!.studentId,
          amount: xof(40_000),
          method: "TRANSFER",
          reference: "VIR-77",
          payerName: "Parent Fictif",
          allocation: { mode: "AUTO", invoiceIds: [inv.invoices[0]!.invoice.id] },
        }),
      );
      receiptId = pay.receipt!.id;
    });

    it("1re demande : le reçu est scellé et le rendu est en cours (PENDING) ; l'événement de rendu est publié", async () => {
      const receipt = unwrap(await getReceiptById(fin, ctx, receiptId));
      const state = unwrap(await getReceiptPdf(fin, ctx, receipt, "STAFF"));
      expect(state.status).toBe("PENDING");
      expect(state.bytes).toBeNull();
      code = state.verificationCode;
      expect(code).toMatch(/^[A-Z2-7]{26}$/);
      const ev = await adminRows(w, "SELECT 1 FROM kernel.domain_events WHERE type = 'reportcards.official_document.render_requested' AND payload->>'sourceId' = $1", [receiptId]);
      expect(ev).toHaveLength(1);
    });

    it("le worker rend le PDF depuis le contenu scellé : nom RÉEL de l'apprenant (people), montants du reçu, imputation, QR de vérification", async () => {
      const docId = (await adminRows<{ id: string }>(w, "SELECT id FROM reportcards.official_documents WHERE source_id = $1", [receiptId]))[0]!.id;
      unwrap(await renderOfficialDocument(worker, ctx, { documentId: docId }));
      const html = renderer.renders[renderer.renders.length - 1]!.html;
      expect(html).toContain(studentName);
      expect(html).toContain("École d&#39;assemblage".toLocaleUpperCase("fr-FR").replace("&#39;", "&#39;"));
      expect(html).toMatch(/REC-\d{4}-\d{6}/);
      expect(html).toContain("Virement"); // libellé français du mode TRANSFER
      expect(html).toContain("VIR-77");
      expect(html).toContain("Parent Fictif");
      expect(html).toContain(Money.of(40_000, "XOF").format("fr-FR"));
      expect(html).toContain(Money.of(60_000, "XOF").format("fr-FR")); // reste dû après paiement
      expect(html).toContain(`https://verif.example.test/v/${code}`);
    });

    it("2e demande : le PDF est servi (octets %PDF) ; titulaire de la lecture = même document, même code ; téléchargement audité", async () => {
      const receipt = unwrap(await getReceiptById(fin, ctx, receiptId));
      const state = unwrap(await getReceiptPdf(fin, ctx, receipt, "GUARDIAN"));
      expect(state.status).toBe("RENDERED");
      expect(state.verificationCode).toBe(code);
      expect(Buffer.from(state.bytes!).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(state.fileName).toMatch(/^Reçu-de-paiement-REC-\d{4}-\d{6}\.pdf$/);
      const n = await adminRows(w, "SELECT 1 FROM reportcards.official_documents WHERE source_id = $1", [receiptId]);
      expect(n).toHaveLength(1); // un seul document par reçu
    });

    it("authenticité : la page publique reconnaît le code ET le fichier ; la réponse ne contient aucune donnée personnelle", async () => {
      const pub = unwrap(await verifyByCode(rc, { code }));
      expect(pub).toMatchObject({ status: "AUTHENTIC", documentKind: "RECEIPT", institutionName: "École d'assemblage" });
      expect(pub.title).toMatch(/^Reçu de paiement REC-/);
      for (const secret of [studentName, "VIR-77", "Parent Fictif"]) expect(JSON.stringify(pub)).not.toContain(secret);
      const receipt = unwrap(await getReceiptById(fin, ctx, receiptId));
      const state = unwrap(await getReceiptPdf(fin, ctx, receipt, "STAFF"));
      expect(unwrap(await verifyByFile(rc, { bytes: state.bytes! })).match).toBe(true);
    });

    it("reçu d'un autre tenant : le document et la lecture restent invisibles (RLS)", async () => {
      const otherTenant = newId();
      await w.db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [otherTenant, `o-${otherTenant.slice(-8)}`, "Autre école"]);
      const rows = await w.tenantDb.run({ ...ctx, tenantId: otherTenant } as RequestContext, (tx) => tx.many("SELECT id FROM reportcards.official_documents"), { readOnly: true });
      expect(rows).toHaveLength(0);
    });
  });

  describe("bulletin de paie : contenu produit par payroll, rendu par reportcards", () => {
    it("le contexte construit par payroll s'imprime correctement avec le gabarit livré et se vérifie publiquement", async () => {
      const sourceId = newId();
      const snapshot = {
        v: 1 as const,
        payslipId: sourceId,
        staff: { id: newId(), displayName: "TRAORE Moussa Fictif", matricule: "ENS-007" },
        period: { id: newId(), name: "Septembre 2025", startDate: "2025-09-01", endDate: "2025-09-30" },
        config: { id: newId(), type: "HOURLY", monthlySalary: null, annualSalary: null, defaultHourlyRate: 5000, overtimeThresholdMinutes: 2400, overtimeMultiplierPermille: 1500, effectiveFrom: "2025-01-01", effectiveTo: null },
        currency: "XOF",
        amounts: { salary: 0, regularHours: 265_000, overtime: 15_000, bonus: 5_000, deduction: 0, total: 285_000 },
        minutes: { regular: 3180, overtime: 120 },
        details: {} as never,
        lines: [
          { position: 1, source: "SESSION", sourceRefId: newId(), date: "2025-09-08", startTime: "08:00", minutes: 120, rate: 5000, multiplierPermille: 1000, amount: 10_000, isOvertime: false, rateOrigin: "NODE_STAFF", label: "Mathématiques", code: "MATH", classroomLabel: "6e A" },
        ],
        adjustments: [{ id: newId(), kind: "BONUS", amount: 5_000, label: "Prime d'assiduité", reason: null, createdByName: "Comptable", createdAt: "2025-10-01T08:00:00.000Z" }],
        calculatedAt: "2025-10-01T08:00:00.000Z",
        calculatedByName: "Comptable",
        approvedAt: "2025-10-02T08:00:00.000Z",
        approvedByName: "Direction",
      };
      const payment: PayslipPaymentFacts = { paidAt: "2025-10-05T09:00:00.000Z", method: "CASH", reference: null };
      const doc = buildPayslipDocument(snapshot as never, "b".repeat(64), payment);
      const port = createPayrollPayslipDocuments(rc);
      const first = unwrap(await port.fetchOrRequest(ctx, doc));
      expect(first.status).toBe("PENDING");
      const docId = (await adminRows<{ id: string }>(w, "SELECT id FROM reportcards.official_documents WHERE source_id = $1", [sourceId]))[0]!.id;
      unwrap(await renderOfficialDocument(worker, ctx, { documentId: docId }));
      const html = renderer.renders[renderer.renders.length - 1]!.html;
      for (const s of ["TRAORE Moussa Fictif", "ENS-007", "Septembre 2025", "Mathématiques — 6e A", "2 h", Money.of(285_000, "XOF").format("fr-FR"), "Net à payer"]) expect(html).toContain(s);
      expect(html).toContain("Prime d&#39;assiduité");
      const second = unwrap(await port.fetchOrRequest(ctx, doc));
      expect(second.status).toBe("RENDERED");
      expect(second.fileName).toBe("Bulletin-de-paie-Septembre-2025.pdf");
      const pub = unwrap(await verifyByCode(rc, { code: second.verificationCode }));
      expect(pub).toMatchObject({ status: "AUTHENTIC", documentKind: "PAYSLIP", title: "Bulletin de paie — Septembre 2025" });
      expect(JSON.stringify(pub)).not.toContain("TRAORE");
    });
  });

  it("le service de scellement refuse un document dont le contenu n'est pas canonisable (flottant) : aucune ligne écrite", async () => {
    const sourceId = newId();
    const r = await requestOfficialDocument(rc, ctx, { kind: "RECEIPT", sourceId, title: "Reçu de paiement TEST", issuedAt: new Date(), content: { amount: 12.5 }, context: {} });
    expect(r.ok).toBe(false);
    expect(await adminRows(w, "SELECT 1 FROM reportcards.official_documents WHERE source_id = $1", [sourceId])).toHaveLength(0);
  });
});
