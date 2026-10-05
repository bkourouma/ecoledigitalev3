/**
 * Rapprochement planifié des paiements restés EN ATTENTE (spec 015 §US6) : webhook jamais reçu, délai dépassé puis succès
 * tardif, panne du fournisseur, plafond de tentatives, Orange sans `pay_token`, montant divergent, plantage au milieu,
 * deux instances en concurrence, isolation entre tenants, résolution manuelle par une seule personne (MFA récente). Serveurs HTTP simulés des
 * fournisseurs (aucun appel réseau réel), Postgres réel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { getInvoiceById } from "../../application/invoices";
import { verifyPendingPayment } from "../../application/online-payments";
import { backoffDelayMs, reconcileAllTenants, reconcileTenant } from "../../application/reconciliation";
import { approveManualResolution, listManualResolutions, listPendingReconciliations, rejectManualResolution, requestManualResolution, resolveManually } from "../../application/manual-resolution";
import { getPaymentView } from "../../application/payments";
import { RecordingAudit } from "../../application/ports/audit";
import { claimDuePayments } from "../../infrastructure/reconciliation-repository";
import { adminRows, ctxFor, ctxStepUp, describeIntegration } from "../support/db";
import { ledgerViolations } from "../support/invariants";
import { createReconEnv, eventsOf, paymentByKey, paymentRow, receiptsOf, startOnline, stateRow, type ReconEnv } from "../support/recon-env";

const AMOUNT = 25_000;
const MINUTE = 60_000;

describeIntegration("rapprochement des paiements en attente (job finance.reconcile-pending-payments)", () => {
  let env: ReconEnv;

  beforeAll(async () => {
    env = await createReconEnv();
  });
  afterAll(async () => {
    await env.stop();
  });

  describe("délai, reprise, plafond", () => {
    it("backoff exponentiel plafonné : base × 2^(tentatives − 1)", () => {
      const cfg = { backoffBaseMs: 10 * MINUTE, backoffMaxMs: 4 * 60 * MINUTE };
      expect([1, 2, 3, 4, 5, 6, 7, 40].map((n) => backoffDelayMs(cfg, n) / MINUTE)).toEqual([10, 20, 40, 80, 160, 240, 240, 240]);
    });

    it("webhook jamais reçu : le job CONFIRME après le délai minimal — pas avant, une seule fois, avec reçu, imputation, événement, audit", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      expect(p.status).toBe("PENDING");
      env.wave.complete(p.provider_ref!);

      // Trop tôt : le webhook a encore sa chance, le fournisseur n'est PAS interrogé.
      const before = env.wave.calls(`/v1/checkout/sessions/${p.provider_ref}`, "GET").length;
      const early = await reconcileTenant(t.deps, tenantId);
      expect(early.payments.examined).toBe(0);
      expect(env.wave.calls(`/v1/checkout/sessions/${p.provider_ref}`, "GET").length).toBe(before);

      t.clock.advance(61_000);
      const first = await reconcileTenant(t.deps, tenantId);
      expect(first.payments).toMatchObject({ examined: 1, confirmed: 1, failed: 0, deferred: 0, flagged: 0 });
      const view = unwrap(await getPaymentView(t.deps, s.ctx, p.id));
      expect(view.payment.status).toBe("CONFIRMED");
      expect(view.receipt?.number).toMatch(/^REC-2025-/);
      expect(view.allocations.map((a) => a.invoiceId)).toEqual([s.invoice.id]);
      expect(unwrap(await getInvoiceById(t.deps, s.ctx, s.invoice.id)).invoice.paid.amount).toBe(AMOUNT);
      expect(await eventsOf(env.db, "finance.payment.completed", "paymentId", p.id)).toHaveLength(1);
      expect(t.audit.actions()).toContain("finance.payment.completed");
      expect((await stateRow(env.db, p.id))?.resolved_at).not.toBeNull();
      expect(t.counters.some((c) => c.name === "finance_reconciliation_total" && c.labels.outcome === "confirmed" && c.labels.subject === "payment")).toBe(true);

      // IDEMPOTENT : un second passage ne retouche rien (ni reçu, ni événement, ni appel au fournisseur).
      const calls = env.wave.requests.length;
      t.clock.advance(10 * MINUTE);
      const second = await reconcileTenant(t.deps, tenantId);
      expect(second.payments.examined).toBe(0);
      expect(env.wave.requests.length).toBe(calls);
      expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
      expect(await eventsOf(env.db, "finance.payment.completed", "paymentId", p.id)).toHaveLength(1);
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("délai dépassé puis succès tardif : tentative comptée, réessayée plus tard avec backoff, puis confirmée", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      // Les 3 tentatives de la lecture (reprises du client HTTP) dépassent le délai : le fournisseur « ne répond pas ».
      env.wave.overrideNext({ status: 200, json: {}, delayMs: 1_500 }, { status: 200, json: {}, delayMs: 1_500 }, { status: 200, json: {}, delayMs: 1_500 });
      t.clock.advance(61_000);
      const first = await reconcileTenant(t.deps, tenantId);
      expect(first.payments).toMatchObject({ examined: 1, deferred: 1, confirmed: 0, flagged: 0 });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      const st1 = await stateRow(env.db, p.id);
      expect(st1).toMatchObject({ attempts: 1, last_outcome: "provider_error", flagged_at: null });
      // Prochaine échéance = maintenant + base du backoff (60 s) : pas avant.
      expect(st1!.next_attempt_at.getTime()).toBe(t.clock.now().getTime() + 60_000);

      env.wave.complete(p.provider_ref!); // le paiement a en réalité abouti
      t.clock.advance(30_000);
      expect((await reconcileTenant(t.deps, tenantId)).payments.examined).toBe(0);
      t.clock.advance(31_000);
      const second = await reconcileTenant(t.deps, tenantId);
      expect(second.payments).toMatchObject({ examined: 1, confirmed: 1 });
      expect((await paymentRow(env.db, p.id)).status).toBe("CONFIRMED");
      expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
    });

    it("panne du fournisseur (5xx) : paiement intact, tentative comptée avec le code d'erreur ; rétabli => confirmé", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "mtn_momo");
      const p = await paymentByKey(env.db, s.key);
      env.mtn.settle(p.provider_ref!, "SUCCESSFUL");
      env.mtn.overrideNext({ status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} });
      t.clock.advance(61_000);
      const down = await reconcileTenant(t.deps, tenantId);
      expect(down.payments).toMatchObject({ examined: 1, deferred: 1 });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      expect(await stateRow(env.db, p.id)).toMatchObject({ attempts: 1, last_error_code: "upstream_5xx" });
      t.clock.advance(61_000);
      const up = await reconcileTenant(t.deps, tenantId);
      expect(up.payments).toMatchObject({ examined: 1, confirmed: 1 });
      expect((await paymentRow(env.db, p.id)).status).toBe("CONFIRMED");
    });

    it("échec chez le fournisseur (session expirée) : paiement ÉCHOUÉ avec motif, événement, aucun reçu", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      env.wave.expire(p.provider_ref!);
      t.clock.advance(61_000);
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.payments).toMatchObject({ examined: 1, failed: 1, confirmed: 0 });
      const row = await paymentByKey(env.db, s.key);
      expect(row.status).toBe("FAILED");
      expect(row.failure_reason).toBe("expired");
      expect(await receiptsOf(env.db, p.id)).toHaveLength(0);
      expect(await eventsOf(env.db, "finance.payment.failed", "paymentId", p.id)).toHaveLength(1);
      expect(t.audit.actions()).toContain("finance.payment.failed");
    });

    it("toujours en attente : tentatives PLAFONNÉES puis signalement (événement + audit sensible + alerte), plus aucun appel ensuite", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps({ reconciliation: { maxAttempts: 3 } });
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      const verifyCalls = () => env.wave.calls(`/v1/checkout/sessions/${p.provider_ref}`, "GET").length;
      const base = verifyCalls();
      const outcomes: string[] = [];
      for (let i = 0; i < 3; i++) {
        t.clock.advance(i === 0 ? 61_000 : 10 * MINUTE);
        const r = await reconcileTenant(t.deps, tenantId);
        outcomes.push(r.payments.flagged ? "flagged" : r.payments.deferred ? "deferred" : "none");
      }
      expect(outcomes).toEqual(["deferred", "deferred", "flagged"]);
      expect(verifyCalls() - base).toBe(3);
      const st = await stateRow(env.db, p.id);
      expect(st).toMatchObject({ attempts: 3, flag_reason: "attempts_exhausted" });
      expect(st!.flagged_at).not.toBeNull();
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING"); // jamais présumé réussi NI échoué
      const events = await eventsOf(env.db, "finance.payment.reconciliation_needed", "paymentId", p.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ v: 1, subject: "PAYMENT", reason: "attempts_exhausted", attempts: 3, provider: "wave", amount: { amount: AMOUNT, currency: "XOF" } });
      expect(t.alerts).toHaveLength(1);
      expect(t.alerts[0]).toMatchObject({ code: "finance.payment.reconciliation_needed", severity: "critical", tenantId, reason: "attempts_exhausted", provider: "wave", subject: { type: "payment", id: p.id } });
      expect(t.audit.entries.find((e) => e.entry.action === "finance.payment.reconciliation_needed")?.entry.sensitive).toBe(true);

      // Signalé : le job n'y touche plus (plus d'appel, pas de second événement).
      t.clock.advance(24 * 60 * MINUTE);
      const after = await reconcileTenant(t.deps, tenantId);
      expect(after.payments.examined).toBe(0);
      expect(verifyCalls() - base).toBe(3);
      expect(await eventsOf(env.db, "finance.payment.reconciliation_needed", "paymentId", p.id)).toHaveLength(1);
      // La vérification manuelle (« Vérifier ») reste possible et conclut si le fournisseur a fini.
      env.wave.complete(p.provider_ref!);
      expect(unwrap(await verifyPendingPayment(t.deps, s.ctx, { paymentId: p.id })).payment.status).toBe("CONFIRMED");
    });

    it("Orange Money sans pay_token (réponse d'initiation perdue) : signalé AUSSITÔT, jamais d'appel de vérification impossible", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      // L'initiation est traitée par Orange mais la réponse n'arrive pas : le paiement reste en attente SANS référence.
      env.orange.loseNextResponses(1, (r) => r.path.endsWith("/webpayment"));
      const s = await startOnline(t, tenantId, "orange_money");
      expect(s.result.ok).toBe(false);
      const p = await paymentByKey(env.db, s.key);
      expect(p).toMatchObject({ status: "PENDING", provider_ref: null });
      t.clock.advance(61_000);
      const statusCalls = env.orange.calls("transactionstatus").length;
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.payments).toMatchObject({ examined: 1, flagged: 1, confirmed: 0 });
      expect(env.orange.calls("transactionstatus").length).toBe(statusCalls);
      expect(await stateRow(env.db, p.id)).toMatchObject({ flag_reason: "unverifiable_no_provider_ref", attempts: 1 });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      const ev = await eventsOf(env.db, "finance.payment.reconciliation_needed", "paymentId", p.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ reason: "unverifiable_no_provider_ref" });
      expect(t.alerts.map((a) => a.reason)).toEqual(["unverifiable_no_provider_ref"]);
    });

    it("montant divergent chez le fournisseur : MÊMES contrôles que le webhook — rien d'encaissé, signalé « à rapprocher »", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "mtn_momo");
      const p = await paymentByKey(env.db, s.key);
      env.mtn.settle(p.provider_ref!, "SUCCESSFUL");
      env.mtn.transactions.get(p.provider_ref!)!.amount = "24000";
      t.clock.advance(61_000);
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.payments).toMatchObject({ examined: 1, flagged: 1, confirmed: 0 });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      expect(await receiptsOf(env.db, p.id)).toHaveLength(0);
      expect(await stateRow(env.db, p.id)).toMatchObject({ flag_reason: "provider_amount_mismatch", last_error_code: "finance.provider_amount_mismatch" });
      expect(t.alerts[0]).toMatchObject({ reason: "provider_amount_mismatch" });
      expect(unwrap(await getInvoiceById(t.deps, s.ctx, s.invoice.id)).invoice.paid.amount).toBe(0);
    });

    it("fournisseur désactivé / non configuré : tentative comptée sans appel, puis signalement", async () => {
      const tenantId = await env.newTenant();
      env.source.set(tenantId, "wave", { ...env.harness("wave").settings, enabled: "false" });
      const t = env.makeDeps({ reconciliation: { maxAttempts: 2 } });
      const s = await startOnline(t, tenantId, "wave");
      // Le paiement est créé AVANT la désactivation : on l'initie d'abord avec le fournisseur actif.
      expect(s.result.ok).toBe(false); // désactivé dès l'initiation : aucun paiement créé
      expect(await adminRows(env.db, "SELECT 1 FROM finance.payments WHERE idempotency_key = $1", [s.key])).toHaveLength(0);
      env.source.set(tenantId, "wave", { ...env.harness("wave").settings, enabled: "true" });
      const s2 = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s2.key);
      env.source.set(tenantId, "wave", { ...env.harness("wave").settings, enabled: "false" }); // désactivé pendant le paiement en attente
      const before = env.wave.requests.length;
      t.clock.advance(61_000);
      expect((await reconcileTenant(t.deps, tenantId)).payments).toMatchObject({ deferred: 1 });
      t.clock.advance(2 * MINUTE);
      expect((await reconcileTenant(t.deps, tenantId)).payments).toMatchObject({ flagged: 1 });
      expect(env.wave.requests.length).toBe(before); // aucun appel au fournisseur désactivé
      expect(await stateRow(env.db, p.id)).toMatchObject({ flag_reason: "provider_unavailable", last_error_code: "finance.provider_disabled" });
      env.source.set(tenantId, "wave", { ...env.harness("wave").settings, enabled: "true" });
    });
  });

  describe("plantage, concurrence, isolation", () => {
    it("plantage au milieu : la transaction d'application est annulée, le bail expire, le passage suivant conclut — jamais deux reçus", async () => {
      const tenantId = await env.newTenant();
      let crash = true;
      const audit = new RecordingAudit();
      const flaky = {
        async record(tx: Parameters<RecordingAudit["record"]>[0], ctx: Parameters<RecordingAudit["record"]>[1], entry: Parameters<RecordingAudit["record"]>[2]) {
          if (crash && entry.action === "finance.payment.completed") throw new Error("plantage simulé du worker");
          await audit.record(tx, ctx, entry);
        },
      };
      const t = env.makeDeps({ audit: flaky });
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      env.wave.complete(p.provider_ref!);
      t.clock.advance(61_000);
      const first = await reconcileTenant(t.deps, tenantId);
      expect(first.payments).toMatchObject({ examined: 1, confirmed: 0, deferred: 1 });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING"); // rien n'a été écrit
      expect(await receiptsOf(env.db, p.id)).toHaveLength(0);
      // Le bail (2 min) n'a pas expiré : un autre passage ne le reprend pas.
      crash = false;
      expect((await reconcileTenant(t.deps, tenantId)).payments.examined).toBe(0);
      t.clock.advance(121_000);
      const second = await reconcileTenant(t.deps, tenantId);
      expect(second.payments).toMatchObject({ examined: 1, confirmed: 1 });
      expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
      expect(await eventsOf(env.db, "finance.payment.completed", "paymentId", p.id)).toHaveLength(1);
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("deux instances du worker en concurrence : chaque paiement est pris par UNE seule, un seul reçu", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const started = await Promise.all(Array.from({ length: 6 }, () => startOnline(t, tenantId, "wave")));
      const ids: string[] = [];
      for (const s of started) {
        const p = await paymentByKey(env.db, s.key);
        env.wave.complete(p.provider_ref!);
        ids.push(p.id);
      }
      t.clock.advance(61_000);
      const reports = await Promise.all([reconcileTenant(t.deps, tenantId), reconcileTenant(t.deps, tenantId), reconcileTenant(t.deps, tenantId)]);
      expect(reports.reduce((n, r) => n + r.payments.examined, 0)).toBe(6);
      expect(reports.reduce((n, r) => n + r.payments.confirmed, 0)).toBe(6);
      for (const id of ids) {
        expect((await paymentRow(env.db, id)).status).toBe("CONFIRMED");
        expect(await receiptsOf(env.db, id)).toHaveLength(1);
      }
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("le bail est pris en base : un paiement déjà pris à bail n'est pas repris avant son expiration", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const s = await startOnline(t, tenantId, "wave");
      const p = await paymentByKey(env.db, s.key);
      env.wave.complete(p.provider_ref!);
      t.clock.advance(61_000);
      // Une autre instance a pris le bail (et planté) : on le simule avec la primitive de prise à bail.
      await t.deps.db.run(createSystemContext(tenantId), async (tx) => {
        await tx.query(
          "INSERT INTO finance.reconciliation_state (id, tenant_id, payment_id, next_attempt_at) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT DO NOTHING",
          [tenantId, p.id, new Date(t.clock.now().getTime() - 1_000)],
        );
        const claimed = await claimDuePayments(tx, t.clock.now(), 120_000, 10);
        expect(claimed.map((c) => c.paymentId)).toEqual([p.id]);
        expect(await claimDuePayments(tx, t.clock.now(), 120_000, 10)).toEqual([]);
      });
      expect((await reconcileTenant(t.deps, tenantId)).payments.examined).toBe(0);
      t.clock.advance(121_000);
      expect((await reconcileTenant(t.deps, tenantId)).payments).toMatchObject({ examined: 1, confirmed: 1 });
    });

    it("RLS A/B : le passage d'un tenant ne touche jamais les paiements d'un autre ; reconcileAllTenants traite chacun SOUS son tenant", async () => {
      const a = await env.newTenant();
      const b = await env.newTenant();
      const t = env.makeDeps();
      const sa = await startOnline(t, a, "wave");
      const sb = await startOnline(t, b, "wave");
      const pa = await paymentByKey(env.db, sa.key);
      const pb = await paymentByKey(env.db, sb.key);
      env.wave.complete(pa.provider_ref!);
      env.wave.complete(pb.provider_ref!);
      t.clock.advance(61_000);

      const onlyA = await reconcileTenant(t.deps, a);
      expect(onlyA.payments.confirmed).toBe(1);
      expect((await paymentRow(env.db, pa.id)).status).toBe("CONFIRMED");
      expect((await paymentRow(env.db, pb.id)).status).toBe("PENDING"); // B n'a pas été traité
      expect(await stateRow(env.db, pb.id)).toBeUndefined(); // ni même suivi

      // Un contexte du tenant A ne voit ni le suivi ni la liste « à rapprocher » de B.
      const pendingA = unwrap(await listPendingReconciliations(t.deps, ctxFor(a)));
      expect(pendingA.items.every((i) => i.payment.id !== pb.id)).toBe(true);
      const seenFromA = await t.deps.db.run(ctxFor(a), (tx) => tx.many("SELECT payment_id FROM finance.reconciliation_state"), { readOnly: true });
      expect((seenFromA as Array<{ payment_id: string }>).some((r) => r.payment_id === pb.id)).toBe(false);

      const all = await reconcileAllTenants(t.deps, env.db.systemDb);
      expect(all.failed).toEqual([]);
      expect((await paymentRow(env.db, pb.id)).status).toBe("CONFIRMED");
      expect(await receiptsOf(env.db, pb.id)).toHaveLength(1);
      expect(all.tenants).toBeGreaterThanOrEqual(2);
    });
  });

  describe("liste « paiements à rapprocher » et résolution manuelle par une seule personne (Q-PAY-38)", () => {
    async function flaggedOrangePayment() {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      env.orange.loseNextResponses(1, (r) => r.path.endsWith("/webpayment"));
      const s = await startOnline(t, tenantId, "orange_money");
      const p = await paymentByKey(env.db, s.key);
      t.clock.advance(61_000);
      await reconcileTenant(t.deps, tenantId);
      return { tenantId, t, s, p };
    }

    it("la liste met les signalés d'abord, avec l'état du rapprochement ; filtre signalé / fournisseur", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const wave = await startOnline(t, tenantId, "wave");
      const wp = await paymentByKey(env.db, wave.key);
      const list = unwrap(await listPendingReconciliations(t.deps, ctxFor(tenantId)));
      expect(list.total).toBe(2);
      expect(list.items.map((i) => i.payment.id)).toEqual([p.id, wp.id]);
      expect(list.items[0]!.reconciliation).toMatchObject({ attempts: 1, flagReason: "unverifiable_no_provider_ref" });
      expect(list.items[0]!.reconciliation!.flaggedAt).not.toBeNull();
      expect(list.items[1]!.reconciliation).toBeNull(); // pas encore pris par le job
      const flaggedOnly = unwrap(await listPendingReconciliations(t.deps, ctxFor(tenantId), { flagged: true }));
      expect(flaggedOnly.items.map((i) => i.payment.id)).toEqual([p.id]);
      const waveOnly = unwrap(await listPendingReconciliations(t.deps, ctxFor(tenantId), { provider: "wave" }));
      expect(waveOnly.items.map((i) => i.payment.id)).toEqual([wp.id]);
    });

    it("Q-PAY-38 — confirmer à la main : UNE personne, MFA récente, motif et preuve — reçu, imputation, audit renforcé avant/après", async () => {
      const { tenantId, t, s, p } = await flaggedOrangePayment();
      const resolver = ctxStepUp(tenantId);
      const body = { paymentId: p.id, outcome: "SUCCEEDED" as const, reason: "Relevé Orange du 01/09 montrant l'encaissement", evidenceRef: "MP250901.1234.A56789" };

      // MFA récente exigée : ni sans MFA, ni avec la seule MFA de connexion, ni avec un step-up expiré. Rien n'est écrit.
      const noMfa = await resolveManually(t.deps, ctxFor(tenantId), body);
      expect(noMfa.ok).toBe(false);
      if (!noMfa.ok) expect(noMfa.error.code).toBe("finance.mfa_required");
      const loginMfaOnly = await resolveManually(t.deps, createRequestContext({ tenantId, userId: newId(), roles: ["finance"], mfa: true }), body);
      expect(loginMfaOnly.ok).toBe(false);
      if (!loginMfaOnly.ok) expect(loginMfaOnly.error.code).toBe("finance.mfa_required");
      const expired = await resolveManually(t.deps, ctxStepUp(tenantId, newId(), new Date("2025-09-01T07:59:00.000Z")), body);
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(expired.error.code).toBe("finance.mfa_required");
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      expect(unwrap(await listManualResolutions(t.deps, ctxFor(tenantId), { paymentId: p.id }))).toEqual([]);

      // Motif et preuve obligatoires.
      expect((await resolveManually(t.deps, resolver, { ...body, evidenceRef: "x" })).ok).toBe(false);
      expect((await resolveManually(t.deps, resolver, { ...body, reason: "ok" })).ok).toBe(false);
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");

      // Une seule personne suffit : demandeur = décideur, résolution déjà APPROUVÉE, effets identiques au chemin fournisseur.
      const done = unwrap(await resolveManually(t.deps, resolver, body));
      expect(done).toMatchObject({ status: "APPROVED", outcome: "SUCCEEDED", requestedBy: resolver.userId, decidedBy: resolver.userId });
      const view = unwrap(await getPaymentView(t.deps, resolver, p.id));
      expect(view.payment.status).toBe("CONFIRMED");
      expect(view.receipt).not.toBeNull();
      expect(view.allocations.map((a) => a.invoiceId)).toEqual([s.invoice.id]);
      expect(await eventsOf(env.db, "finance.payment.completed", "paymentId", p.id)).toHaveLength(1);

      // Audit renforcé : sensible, acteur, motif, preuve, fenêtre MFA, état AVANT et APRÈS.
      const actions = t.audit.actions();
      expect(actions).toEqual(expect.arrayContaining(["finance.resolution.resolved", "finance.payment.completed"]));
      expect(actions).not.toContain("finance.resolution.requested");
      const audit = t.audit.entries.find((e) => e.entry.action === "finance.resolution.resolved")!;
      expect(audit.entry.sensitive).toBe(true);
      expect(audit.ctx.userId).toBe(resolver.userId);
      expect(audit.entry.before).toMatchObject({ kind: "payment", id: p.id, status: "PENDING" });
      expect(audit.entry.after).toMatchObject({ kind: "payment", id: p.id, status: "CONFIRMED", outcome: "SUCCEEDED" });
      expect(audit.entry.metadata).toMatchObject({
        actorId: resolver.userId,
        reason: body.reason,
        evidenceRef: body.evidenceRef,
        mode: "SINGLE_ACTOR",
        mfa: "step_up",
        mfaElevatedUntil: "2099-01-01T00:00:00.000Z",
      });

      // Rejeu / trop tard : plus de sujet à trancher, un seul reçu.
      const late = await resolveManually(t.deps, resolver, { ...body, outcome: "FAILED", reason: "Trop tard pour trancher", evidenceRef: "REL-3" });
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.error.code).toBe("finance.resolution_not_applicable");
      expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("Q-PAY-38 — marquer ÉCHOUÉ à la main : paiement FAILED, événement, aucun reçu, audit avant/après", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const resolver = ctxStepUp(tenantId);
      const done = unwrap(await resolveManually(t.deps, resolver, { paymentId: p.id, outcome: "FAILED", reason: "Relevé opérateur : aucune transaction", evidenceRef: "RELEVE-OM-0901" }));
      expect(done).toMatchObject({ status: "APPROVED", outcome: "FAILED" });
      const row = await paymentByKeyFromId(p.id);
      expect(row).toMatchObject({ status: "FAILED", failure_reason: "manual_not_received" });
      expect(await receiptsOf(env.db, p.id)).toHaveLength(0);
      expect(await eventsOf(env.db, "finance.payment.failed", "paymentId", p.id)).toHaveLength(1);
      const audit = t.audit.entries.find((e) => e.entry.action === "finance.resolution.resolved")!.entry;
      expect(audit.before).toMatchObject({ status: "PENDING" });
      expect(audit.after).toMatchObject({ status: "FAILED", outcome: "FAILED" });
      const all = unwrap(await listManualResolutions(t.deps, ctxFor(tenantId), { paymentId: p.id }));
      expect(all.map((x) => x.status)).toEqual(["APPROVED"]);
    });

    it("Q-PAY-38 — l'audit est atomique : un échec d'audit annule la résolution (paiement toujours en attente)", async () => {
      const { tenantId, p } = await flaggedOrangePayment();
      const failing = env.makeDeps({
        audit: {
          async record(_tx, _ctx, entry) {
            if (entry.action === "finance.resolution.resolved") throw new Error("audit indisponible");
          },
        },
      });
      await expect(resolveManually(failing.deps, ctxStepUp(tenantId), { paymentId: p.id, outcome: "SUCCEEDED", reason: "Relevé opérateur du jour : encaissé", evidenceRef: "REL-AUDIT" })).rejects.toThrow(/audit indisponible/);
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      expect(await receiptsOf(env.db, p.id)).toHaveLength(0);
      const ok = env.makeDeps();
      expect(unwrap(await listManualResolutions(ok.deps, ctxFor(tenantId), { paymentId: p.id }))).toEqual([]);
    });

    it("Q-PAY-38 — demandes ouvertes avant la décision : la même personne habilitée peut les clore, avec MFA récente (plus de refus d'auto-approbation)", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const me = ctxStepUp(tenantId);
      const req = unwrap(await requestManualResolution(t.deps, me, { paymentId: p.id, outcome: "FAILED", reason: "Mono-utilisateur : relevé consulté", evidenceRef: "REL-SOLO" }));
      expect(req.status).toBe("REQUESTED");
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING"); // demander n'écrit rien

      // Un nouveau règlement direct est refusé tant que la demande ouverte existe ; sans MFA récente rien n'est tranché.
      const dup = await resolveManually(t.deps, me, { paymentId: p.id, outcome: "SUCCEEDED", reason: "Demande concurrente sur le même sujet", evidenceRef: "REL-2" });
      expect(dup.ok).toBe(false);
      if (!dup.ok) expect(dup.error.code).toBe("finance.resolution_already_open");
      const noMfa = await approveManualResolution(t.deps, ctxFor(tenantId, me.userId!), { resolutionId: req.id });
      expect(noMfa.ok).toBe(false);
      if (!noMfa.ok) expect(noMfa.error.code).toBe("finance.mfa_required");
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");

      const done = unwrap(await approveManualResolution(t.deps, me, { resolutionId: req.id }));
      expect(done).toMatchObject({ status: "APPROVED", requestedBy: me.userId, decidedBy: me.userId });
      expect((await paymentRow(env.db, p.id)).status).toBe("FAILED");
    });

    it("Q-PAY-38 — refuser une demande ouverte exige aussi la MFA récente ; le refus laisse tout en l'état", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const me = ctxStepUp(tenantId);
      const req = unwrap(await requestManualResolution(t.deps, me, { paymentId: p.id, outcome: "FAILED", reason: "Le client affirme ne rien avoir payé", evidenceRef: "APPEL-0102" }));
      expect((await rejectManualResolution(t.deps, ctxFor(tenantId), { resolutionId: req.id })).ok).toBe(false);
      const r = unwrap(await rejectManualResolution(t.deps, me, { resolutionId: req.id, note: "Preuve insuffisante" }));
      expect(r).toMatchObject({ status: "REJECTED", decidedBy: me.userId });
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
      expect(t.audit.actions()).toContain("finance.resolution.rejected");
    });

    it("RLS A/B : un autre tenant ne voit pas la résolution et ne peut ni la trancher ni résoudre ce paiement, même avec une MFA récente", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const me = ctxStepUp(tenantId);
      const req = unwrap(await requestManualResolution(t.deps, me, { paymentId: p.id, outcome: "FAILED", reason: "Relevé : aucune transaction", evidenceRef: "REL-RLS" }));
      const other = await env.newTenant();
      expect(unwrap(await listManualResolutions(t.deps, ctxFor(other)))).toEqual([]);
      const crossApprove = await approveManualResolution(t.deps, ctxStepUp(other), { resolutionId: req.id });
      expect(crossApprove.ok).toBe(false);
      if (!crossApprove.ok) expect(crossApprove.error.code).toBe("finance.resolution_not_found");
      const crossResolve = await resolveManually(t.deps, ctxStepUp(other), { paymentId: p.id, outcome: "SUCCEEDED", reason: "Tentative d'un autre tenant", evidenceRef: "INTRUS-1" });
      expect(crossResolve.ok).toBe(false);
      if (!crossResolve.ok) expect(crossResolve.error.code).toBe("finance.payment_not_found");
      expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
    });

    it("l'écriture manuelle ne contourne pas la base : la ligne de résolution est immuable une fois tranchée", async () => {
      const { tenantId, t, p } = await flaggedOrangePayment();
      const req = unwrap(await resolveManually(t.deps, ctxStepUp(tenantId), { paymentId: p.id, outcome: "FAILED", reason: "Relevé : aucune transaction", evidenceRef: "REL-IMMUABLE" }));
      await expect(env.db.admin.query("UPDATE finance.manual_resolutions SET outcome = 'SUCCEEDED' WHERE id = $1", [req.id])).rejects.toThrow(/manual_resolution_immutable|manual_resolution_terminal/);
      await expect(env.db.admin.query("DELETE FROM finance.manual_resolutions WHERE id = $1", [req.id])).rejects.toThrow(/immuable/);
    });
  });

  async function paymentByKeyFromId(id: string) {
    const [row] = await adminRows<{ status: string; failure_reason: string | null }>(env.db, "SELECT status, failure_reason FROM finance.payments WHERE id = $1", [id]);
    return row!;
  }
});
