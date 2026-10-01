import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { closeCashSession, getCashSessionSummary, openCashSession } from "../../application/cash";
import { getInvoiceById, issueCreditNote, cancelInvoice } from "../../application/invoices";
import { getPaymentView } from "../../application/payments";
import { approveRefund, completeRefund, rejectRefund, requestRefund } from "../../application/refunds";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, openCashier, pay, seedCatalog, simpleInvoice, tuitionInvoice, xof } from "../support/scenario";

describeIntegration("remboursements, avoirs et caisses (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let accountant: ReturnType<typeof ctxFor>;
  let director: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    accountant = ctxFor(tenantId);
    director = ctxFor(tenantId);
    await seedCatalog(world.deps, accountant);
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("remboursements", () => {
    it("partiel puis total : écritures inverses, statuts, événements — le paiement confirmé n'est jamais modifié", async () => {
      const learner = learnerId();
      const inv = await tuitionInvoice(world.deps, accountant, learner);
      const view = unwrap(await pay(world.deps, accountant, learner, 300_000));
      expect(view.allocations.map((a) => a.amount.amount)).toEqual([100_000, 150_000, 50_000]);

      const req = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(120_000), reason: "Erreur de saisie" }));
      expect(req.status).toBe("REQUESTED");

      // quatre yeux : le demandeur ne s'approuve pas
      const self = await approveRefund(world.deps, accountant, { refundId: req.id });
      expect(self.ok).toBe(false);
      if (!self.ok) expect(self.error.code).toBe("finance.refund_self_approval");

      const done = unwrap(await approveRefund(world.deps, director, { refundId: req.id }));
      expect(done.status).toBe("COMPLETED");
      expect(done.approvedBy).toBe(director.userId);

      const afterPartial = unwrap(await getPaymentView(world.deps, accountant, view.payment.id));
      expect(afterPartial.payment.status).toBe("CONFIRMED");
      expect(afterPartial.payment.refunded.amount).toBe(120_000);
      expect(afterPartial.payment.allocated.amount).toBe(180_000);
      expect(afterPartial.payment.amount.amount).toBe(300_000); // immuable
      // reprise : la dernière échéance payée d'abord (50 000), puis 70 000 sur la précédente
      expect(afterPartial.allocations.map((a) => [a.amount.amount, a.reversed.amount, a.net.amount])).toEqual([
        [100_000, 0, 100_000],
        [150_000, 70_000, 80_000],
        [50_000, 50_000, 0],
      ]);
      const invAfter = unwrap(await getInvoiceById(world.deps, accountant, inv.invoice.id));
      expect(invAfter.invoice.paid.amount).toBe(180_000);
      expect(invAfter.installments.map((i) => i.paid.amount)).toEqual([100_000, 80_000, 0, 0]);
      expect(invAfter.invoice.status).toBe("PARTIALLY_PAID");

      // remboursement du reste
      const rest = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(180_000), reason: "Retrait de l'élève" }));
      unwrap(await approveRefund(world.deps, director, { refundId: rest.id }));
      const refunded = unwrap(await getPaymentView(world.deps, accountant, view.payment.id));
      expect(refunded.payment.status).toBe("REFUNDED");
      expect(refunded.payment.allocated.amount).toBe(0);
      expect(refunded.payment.refunded.amount).toBe(300_000);
      expect(unwrap(await getInvoiceById(world.deps, accountant, inv.invoice.id)).invoice.status).toBe("ISSUED");

      const types = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE payload->>'paymentId' = $1 AND type LIKE 'finance.refund.%' ORDER BY id", [view.payment.id]);
      expect(types.map((t) => t.type)).toEqual(["finance.refund.requested", "finance.refund.completed", "finance.refund.requested", "finance.refund.completed"]);

      // un paiement remboursé est terminal
      const again = await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(1), reason: "encore ?" });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("finance.payment_not_confirmed");
    });

    it("le remboursable tient compte des demandes ouvertes ; les rejets libèrent le montant", async () => {
      const learner = learnerId();
      await simpleInvoice(world.deps, accountant, learner, 100_000);
      const view = unwrap(await pay(world.deps, accountant, learner, 100_000));
      const a = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(70_000), reason: "Premier motif" }));
      const tooMuch = await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(30_001), reason: "Second motif" });
      expect(tooMuch.ok).toBe(false);
      if (!tooMuch.ok) expect(tooMuch.error.code).toBe("finance.refund_exceeds_refundable");
      const b = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(30_000), reason: "Second motif" }));

      const rejected = unwrap(await rejectRefund(world.deps, director, { refundId: a.id, reason: "Justificatif absent" }));
      expect(rejected.status).toBe("REJECTED");
      const noApprove = await approveRefund(world.deps, director, { refundId: a.id });
      expect(noApprove.ok).toBe(false);
      // 70 000 libérés par le rejet
      expect((await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(70_000), reason: "Nouvelle demande" })).ok).toBe(true);
      void b;
    });

    it("demande idempotente par clé ; motif obligatoire ; paiement inconnu", async () => {
      const learner = learnerId();
      await simpleInvoice(world.deps, accountant, learner, 50_000);
      const view = unwrap(await pay(world.deps, accountant, learner, 50_000));
      const key = nextKey("refund");
      const first = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(10_000), reason: "Trop perçu", idempotencyKey: key }));
      const replay = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(10_000), reason: "Trop perçu", idempotencyKey: key }));
      expect(replay.id).toBe(first.id);
      const conflict = await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(11_000), reason: "Trop perçu", idempotencyKey: key });
      expect(conflict.ok).toBe(false);
      expect((await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(1_000), reason: "  " })).ok).toBe(false);
      const unknown = await requestRefund(world.deps, accountant, { paymentId: newId(), amount: xof(1_000), reason: "Motif valable" });
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.error.code).toBe("finance.payment_not_found");
    });

    it("le non-imputé est remboursé d'abord : aucune reprise sur les factures", async () => {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, accountant, learner, 100_000);
      const view = unwrap(await pay(world.deps, accountant, learner, 130_000));
      const r = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(20_000), reason: "Surplus rendu" }));
      unwrap(await approveRefund(world.deps, director, { refundId: r.id }));
      const after = unwrap(await getPaymentView(world.deps, accountant, view.payment.id));
      expect(after.payment.allocated.amount).toBe(100_000);
      expect(after.payment.refunded.amount).toBe(20_000);
      expect(after.unallocated.amount).toBe(10_000);
      expect(after.allocations.every((a) => a.reversed.amount === 0)).toBe(true);
      expect(unwrap(await getInvoiceById(world.deps, accountant, inv.invoice.id)).invoice.status).toBe("PAID");
    });

    it("approbation sans exécution, puis exécution séparée", async () => {
      const learner = learnerId();
      await simpleInvoice(world.deps, accountant, learner, 80_000);
      const view = unwrap(await pay(world.deps, accountant, learner, 80_000));
      const r = unwrap(await requestRefund(world.deps, accountant, { paymentId: view.payment.id, amount: xof(30_000), reason: "Geste commercial" }));
      const approved = unwrap(await approveRefund(world.deps, director, { refundId: r.id, complete: false }));
      expect(approved.status).toBe("APPROVED");
      expect(unwrap(await getPaymentView(world.deps, accountant, view.payment.id)).payment.refunded.amount).toBe(0);
      const completed = unwrap(await completeRefund(world.deps, director, { refundId: r.id }));
      expect(completed.status).toBe("COMPLETED");
      expect(unwrap(await getPaymentView(world.deps, accountant, view.payment.id)).payment.refunded.amount).toBe(30_000);
    });

    it("un remboursement espèces sort de la session de caisse de l'exécutant et compte dans l'attendu", async () => {
      const cashier = ctxFor(tenantId);
      const boss = ctxFor(tenantId);
      const { session } = await openCashier(world.deps, cashier, 10_000, "C-REMB");
      const learner = learnerId();
      await simpleInvoice(world.deps, cashier, learner, 100_000);
      const view = unwrap(await pay(world.deps, cashier, learner, 60_000, { method: "CASH", reference: undefined }));
      const r = unwrap(await requestRefund(world.deps, cashier, { paymentId: view.payment.id, amount: xof(15_000), reason: "Double encaissement" }));

      // l'approbateur n'a pas de session ouverte : l'exécution est refusée (et rien n'est écrit)
      const noSession = await approveRefund(world.deps, boss, { refundId: r.id });
      expect(noSession.ok).toBe(false);
      if (!noSession.ok) expect(noSession.error.code).toBe("finance.cash_session_required");
      expect(unwrap(await getPaymentView(world.deps, cashier, view.payment.id)).payment.refunded.amount).toBe(0);

      await openCashier(world.deps, boss, 0, "C-REMB2");
      const done = unwrap(await approveRefund(world.deps, boss, { refundId: r.id }));
      expect(done.cashSessionId).not.toBeNull();
      expect(done.cashSessionId).not.toBe(session.id);

      // clôture de la session d'encaissement : attendu = fonds + encaissé (le remboursement est sur l'autre session)
      const summary = unwrap(await getCashSessionSummary(world.deps, cashier, session.id));
      expect(summary.movements.received.amount).toBe(60_000);
      expect(summary.movements.refunded.amount).toBe(0);
    });
  });

  describe("avoirs", () => {
    it("avoir partiel puis total : répartition sur les dernières échéances, statuts, numérotation AV-", async () => {
      const learner = learnerId();
      const inv = await tuitionInvoice(world.deps, accountant, learner);
      unwrap(await pay(world.deps, accountant, learner, 100_000)); // solde l'inscription

      const c1 = unwrap(await issueCreditNote(world.deps, director, { invoiceId: inv.invoice.id, amount: xof(120_000), reason: "Bourse accordée en cours d'année" }));
      expect(c1.creditNote.number).toBe("AV-2025-000001");
      expect(c1.creditNote.applications).toEqual([
        { installmentId: inv.installments[3]!.id, amount: 100_000 },
        { installmentId: inv.installments[2]!.id, amount: 20_000 },
      ]);
      expect(c1.invoice.invoice.credited.amount).toBe(120_000);
      expect(c1.invoice.balance.amount).toBe(280_000);
      expect(c1.invoice.invoice.status).toBe("PARTIALLY_PAID");

      // au-delà du reste dû : refusé (le déjà encaissé se rembourse d'abord)
      const beyond = await issueCreditNote(world.deps, director, { invoiceId: inv.invoice.id, amount: xof(280_001), reason: "Trop grand" });
      expect(beyond.ok).toBe(false);
      if (!beyond.ok) expect(beyond.error.code).toBe("finance.credit_exceeds_balance");

      // paiement du reste dû (280 000) ⇒ PAID malgré l'avoir
      unwrap(await pay(world.deps, accountant, learner, 280_000));
      expect(unwrap(await getInvoiceById(world.deps, accountant, inv.invoice.id)).invoice.status).toBe("PAID");
    });

    it("avoir total sur une facture sans encaissement ⇒ CREDITED, terminal ; annulation interdite avec avoir", async () => {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, accountant, learner, 90_000);
      const c = unwrap(await issueCreditNote(world.deps, director, { invoiceId: inv.invoice.id, amount: xof(90_000), reason: "Facture émise par erreur" }));
      expect(c.invoice.invoice.status).toBe("CREDITED");
      const cancel = await cancelInvoice(world.deps, director, { invoiceId: inv.invoice.id, reason: "Annulation tardive" });
      expect(cancel.ok).toBe(false);
      const more = await issueCreditNote(world.deps, director, { invoiceId: inv.invoice.id, amount: xof(1), reason: "Encore un avoir" });
      expect(more.ok).toBe(false);
    });

    it("annulation : seulement sans encaissement ni avoir ; le numéro émis est conservé", async () => {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, accountant, learner, 40_000);
      unwrap(await pay(world.deps, accountant, learner, 10_000));
      const refused = await cancelInvoice(world.deps, director, { invoiceId: inv.invoice.id, reason: "Doublon de facture" });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("finance.invoice_has_payments");

      const other = await simpleInvoice(world.deps, accountant, learnerId(), 40_000);
      const cancelled = unwrap(await cancelInvoice(world.deps, director, { invoiceId: other.invoice.id, reason: "Doublon de facture" }));
      expect(cancelled.invoice.status).toBe("CANCELLED");
      expect(cancelled.invoice.number).toBe(other.invoice.number);
      const again = await cancelInvoice(world.deps, director, { invoiceId: other.invoice.id, reason: "Doublon de facture" });
      expect(again.ok).toBe(false);
    });
  });

  describe("sessions de caisse", () => {
    it("ouverture unique par caissier et par caisse ; clôture avec écart justifié ; session close immuable", async () => {
      const t = await db.createTenant();
      const w = makeWorld(db);
      const boss = ctxFor(t);
      const c1 = ctxFor(t);
      const c2 = ctxFor(t);
      await seedCatalog(w.deps, boss);
      const { register, session } = await openCashier(w.deps, c1, 50_000, "PRINC");

      // un caissier = une session ; une caisse = une session
      const twice = await openCashSession(w.deps, c1, { registerId: register.id, openingFloat: xof(0) });
      expect(twice.ok).toBe(false);
      if (!twice.ok) expect(twice.error.code).toBe("finance.cash_session_already_open");
      const busy = await openCashSession(w.deps, c2, { registerId: register.id, openingFloat: xof(0) });
      expect(busy.ok).toBe(false);
      if (!busy.ok) expect(busy.error.code).toBe("finance.cash_session_already_open");

      const learner = learnerId();
      await simpleInvoice(w.deps, c1, learner, 300_000);
      unwrap(await pay(w.deps, c1, learner, 100_000, { method: "CASH", reference: undefined }));
      unwrap(await pay(w.deps, c1, learner, 50_000, { method: "CASH", reference: undefined }));
      unwrap(await pay(w.deps, c1, learner, 30_000, { method: "TRANSFER" })); // hors caisse

      // attendu = 50 000 + 150 000 = 200 000
      const short = await closeCashSession(w.deps, c1, { sessionId: session.id, countedAmount: xof(199_000) });
      expect(short.ok).toBe(false); // écart -1 000 sans justification
      if (!short.ok) expect(short.error.code).toBe("finance.invalid_input");
      const closed = unwrap(await closeCashSession(w.deps, c1, { sessionId: session.id, countedAmount: xof(199_000), note: "Billet de 1 000 manquant" }));
      expect(closed.session.status).toBe("CLOSED");
      expect(closed.session.expected?.amount).toBe(200_000);
      expect(closed.session.counted?.amount).toBe(199_000);
      expect(closed.session.variance?.amount).toBe(-1_000);
      expect(closed.movements.paymentCount).toBe(2);

      // clôturée : plus d'encaissement espèces sans nouvelle session, plus de double clôture
      const afterClose = await pay(w.deps, c1, learner, 5_000, { method: "CASH", reference: undefined });
      expect(afterClose.ok).toBe(false);
      if (!afterClose.ok) expect(afterClose.error.code).toBe("finance.cash_session_required");
      const dbl = await closeCashSession(w.deps, c1, { sessionId: session.id, countedAmount: xof(0) });
      expect(dbl.ok).toBe(false);

      // base : la session close est figée même pour un superuser
      await expect(db.admin.query("UPDATE finance.cash_sessions SET counted_amount = 1, variance_amount = 1 - expected_amount WHERE id = $1", [session.id])).rejects.toMatchObject({ code: "23001" });

      // une nouvelle session peut s'ouvrir sur la même caisse
      const reopened = await openCashSession(w.deps, c2, { registerId: register.id, openingFloat: xof(10_000) });
      expect(reopened.ok).toBe(true);
    });

    it("écart nul : aucune justification requise ; excédent signalé en positif", async () => {
      const t = await db.createTenant();
      const w = makeWorld(db);
      const c1 = ctxFor(t);
      const { session } = await openCashier(w.deps, c1, 0, "EXACT");
      const closed = unwrap(await closeCashSession(w.deps, c1, { sessionId: session.id, countedAmount: xof(0) }));
      expect(closed.session.variance?.amount).toBe(0);

      const c2 = ctxFor(t);
      const second = await openCashier(w.deps, c2, 5_000, "SURPLUS");
      const over = unwrap(await closeCashSession(w.deps, c2, { sessionId: second.session.id, countedAmount: xof(5_200), note: "Pourboire laissé en caisse" }));
      expect(over.session.variance?.amount).toBe(200);
    });

    it("la tolérance configurée dispense de justification", async () => {
      const t = await db.createTenant();
      const w = makeWorld(db, { config: { cashVarianceTolerance: 500 } });
      const c = ctxFor(t);
      const { session } = await openCashier(w.deps, c, 1_000, "TOL");
      const closed = unwrap(await closeCashSession(w.deps, c, { sessionId: session.id, countedAmount: xof(700) }));
      expect(closed.session.variance?.amount).toBe(-300);
    });

    it("clôture concurrente d'encaissements : l'attendu inclut tous les paiements validés", async () => {
      const t = await db.createTenant();
      const w = makeWorld(db);
      const c = ctxFor(t);
      await seedCatalog(w.deps, c);
      const { session } = await openCashier(w.deps, c, 0, "CONC");
      const learners = Array.from({ length: 10 }, () => learnerId());
      for (const l of learners) await simpleInvoice(w.deps, c, l, 50_000);
      const results = await Promise.all(learners.map((l) => pay(w.deps, c, l, 10_000, { method: "CASH", reference: undefined })));
      const okCount = results.filter((r) => r.ok).length;
      expect(okCount).toBe(10);
      const summary = unwrap(await getCashSessionSummary(w.deps, c, session.id));
      expect(summary.movements.received.amount).toBe(100_000);
    });
  });
});
