/**
 * Paiement en ligne de bout en bout avec CHAQUE adaptateur réel (serveurs HTTP simulés, Postgres réel) :
 * initiation, idempotence, confirmation par webhook authentifié / vérification active, rejeu, montant divergent,
 * signature invalide, concurrence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { getInvoiceById } from "../../application/invoices";
import { handleProviderWebhook, initiateOnlinePayment, verifyPendingPayment, type HandleWebhookInput } from "../../application/online-payments";
import { getPaymentView } from "../../application/payments";
import { registerPaymentProviders } from "../../infrastructure/providers/definitions";
import { createProviderRegistry, StaticProviderConfigSource } from "../../infrastructure/providers/registry";
import { encodePaymentReference, webhookUrlToken } from "../../infrastructure/providers/common";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { createHarnesses, xof, type ProviderHarness } from "../support/harness";
import { CinetPayMock, MtnMock, OrangeMock, TresorPayMock, WaveMock } from "../support/mock-providers";
import { PHONE, SECRETS, testRuntime } from "../support/adapters";
import { learnerId, nextKey, seedCatalog, simpleInvoice } from "../support/scenario";

const AMOUNT = 25_000;

type Hook = Pick<HandleWebhookInput, "rawBody" | "headers" | "query">;

interface Flow {
  readonly name: string;
  /** Webhook de SUCCÈS authentique pour ce paiement (après règlement chez le fournisseur). */
  success(h: ProviderHarness, tenantId: string, p: { id: string; providerRef: string }, n: number): Hook;
  /** Webhook portant un montant (ou un état fournisseur) divergent : doit être enregistré FAILED, paiement inchangé. */
  divergent(h: ProviderHarness, tenantId: string, p: { id: string; providerRef: string }): Hook | null;
  /** Même contenu mais authenticité fausse. */
  forged(h: ProviderHarness, tenantId: string, p: { id: string; providerRef: string }): Hook;
  /** Nombre d'appels de CRÉATION reçus par le serveur simulé. */
  creations(h: ProviderHarness): number;
  /** Règle la transaction en échec définitif chez le fournisseur. */
  settleFailure(h: ProviderHarness, p: { id: string; providerRef: string }): void;
  /** Fait diverger le montant côté fournisseur (la vérification active verra un autre montant). */
  skewAmount?(h: ProviderHarness, p: { id: string; providerRef: string }): void;
}

const FLOWS: Flow[] = [
  {
    name: "orange_money",
    success: (h, _t, p) => {
      const n = (h.mock as OrangeMock).notification(p.providerRef);
      return { rawBody: n.rawBody, headers: {}, query: Object.fromEntries(n.url.searchParams) };
    },
    divergent: () => null, // Orange ne renvoie pas le montant : l'écho est celui de la requête de statut
    forged: (h, _t, p) => {
      const n = (h.mock as OrangeMock).notification(p.providerRef);
      return { rawBody: n.rawBody, headers: {}, query: { ...Object.fromEntries(n.url.searchParams), t: "0".repeat(64) } };
    },
    creations: (h) => h.mock.calls("webpayment", "POST").length,
    settleFailure: (h, p) => void (h.mock as OrangeMock).settle(p.providerRef, "FAILED"),
  },
  {
    name: "mtn_momo",
    success: (h, tenantId, p) => ({
      rawBody: (h.mock as MtnMock).callbackBody(p.providerRef),
      headers: {},
      query: { t: webhookUrlToken(SECRETS.webhookSecret, tenantId, "mtn_momo") },
    }),
    divergent: (h, tenantId, p) => ({
      rawBody: (h.mock as MtnMock).callbackBody(p.providerRef),
      headers: {},
      query: { t: webhookUrlToken(SECRETS.webhookSecret, tenantId, "mtn_momo") },
    }),
    forged: (h, _t, p) => ({ rawBody: (h.mock as MtnMock).callbackBody(p.providerRef), headers: {}, query: { t: "f".repeat(64) } }),
    creations: (h) => h.mock.calls("requesttopay", "POST").length,
    settleFailure: (h, p) => void (h.mock as MtnMock).settle(p.providerRef, "FAILED", "NOT_ENOUGH_FUNDS"),
    skewAmount: (h, p) => {
      (h.mock as MtnMock).transactions.get(p.providerRef)!.amount = "24000";
    },
  },
  {
    name: "wave",
    success: (h, _t, p, n) =>
      WaveMock.webhook(SECRETS.waveWebhookSecret, {
        id: `EV_ok_${n}`,
        type: "checkout.session.completed",
        data: { id: p.providerRef, amount: String(AMOUNT), currency: "XOF", client_reference: p.id, payment_status: "succeeded", checkout_status: "complete" },
      }),
    divergent: (_h, _t, p) =>
      WaveMock.webhook(SECRETS.waveWebhookSecret, {
        id: "EV_bad_amount",
        type: "checkout.session.completed",
        data: { id: p.providerRef, amount: "24000", currency: "XOF", client_reference: p.id, payment_status: "succeeded", checkout_status: "complete" },
      }),
    forged: (_h, _t, p) =>
      WaveMock.webhook("pas-le-secret", {
        id: "EV_forged",
        type: "checkout.session.completed",
        data: { id: p.providerRef, amount: String(AMOUNT), currency: "XOF", client_reference: p.id, payment_status: "succeeded", checkout_status: "complete" },
      }),
    creations: (h) => (h.mock as WaveMock).creations,
    settleFailure: (h, p) => (h.mock as WaveMock).expire(p.providerRef),
  },
  {
    name: "cinetpay",
    success: (_h, _t, p, n) =>
      CinetPayMock.notification(SECRETS.cinetSecretKey, {
        cpm_site_id: "105899",
        cpm_trans_id: encodePaymentReference(p.id),
        cpm_trans_date: `2025-09-01 08:0${n % 10}:00`,
        cpm_amount: String(AMOUNT),
        cpm_currency: "XOF",
        signature: "s",
        payment_method: "OM",
        cel_phone_num: "0701020304",
        cpm_phone_prefixe: "225",
        cpm_error_message: "SUCCES",
      }),
    divergent: (_h, _t, p) =>
      CinetPayMock.notification(SECRETS.cinetSecretKey, {
        cpm_site_id: "105899",
        cpm_trans_id: encodePaymentReference(p.id),
        cpm_trans_date: "2025-09-01 08:09:00",
        cpm_amount: String(AMOUNT),
        cpm_currency: "XOF",
        cpm_error_message: "SUCCES",
      }),
    forged: (_h, _t, p) =>
      CinetPayMock.notification(SECRETS.cinetSecretKey, { cpm_site_id: "105899", cpm_trans_id: encodePaymentReference(p.id), cpm_amount: String(AMOUNT), cpm_error_message: "SUCCES" }, { tokenOverride: "0".repeat(64) }),
    creations: (h) => (h.mock as CinetPayMock).transactions.size,
    settleFailure: (h, p) => (h.mock as CinetPayMock).settle(encodePaymentReference(p.id), "REFUSED"),
    skewAmount: (h, p) => {
      (h.mock as CinetPayMock).transactions.get(encodePaymentReference(p.id))!.amount = 24_000;
    },
  },
  {
    name: "tresorpay",
    success: (_h, _t, p, n) => TresorPayMock.webhook(SECRETS.tresorWebhookSecret, { transaction_id: p.providerRef, status: "success", amount: AMOUNT, currency: "XOF", seq: n }),
    divergent: (_h, _t, p) => TresorPayMock.webhook(SECRETS.tresorWebhookSecret, { transaction_id: p.providerRef, status: "success", amount: 24_000, currency: "XOF" }),
    forged: (_h, _t, p) => TresorPayMock.webhook("pas-le-secret", { transaction_id: p.providerRef, status: "success", amount: AMOUNT, currency: "XOF" }),
    creations: (h) => h.mock.calls("initialize", "POST").length,
    settleFailure: (h, p) => {
      (h.mock as TresorPayMock).payments.get(p.providerRef)!.status = "failed";
    },
  },
];

const SETTLE = (h: ProviderHarness, id: string, ref: string | null): void => h.settleSuccess(id, ref);

describeIntegration("paiement en ligne avec les adaptateurs réels (serveurs simulés, Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let harnesses: ProviderHarness[];
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;
  let seq = 0;

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
    harnesses = await createHarnesses();
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    const source = new StaticProviderConfigSource();
    const endpoints: Record<string, { production: string; sandbox: string }> = {};
    for (const h of harnesses) {
      source.set(tenantId, h.name, { ...h.settings, enabled: "true" });
      const url = h.name === "tresorpay" ? `${h.mock.url}/v1` : h.mock.url;
      endpoints[h.name] = { production: url, sandbox: url };
    }
    const providers = createProviderRegistry({ environment: "test", configSource: source });
    registerPaymentProviders(providers, testRuntime(endpoints));
    world = makeWorld(db, { providers, config: { environment: "test", webhookBaseUrl: "https://api.test.local" } });
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    await db.drop();
  });

  const harness = (name: string): ProviderHarness => harnesses.find((h) => h.name === name)!;

  async function start(name: string, amount = AMOUNT) {
    const learner = learnerId();
    const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey(`real-${name}`);
    const input = {
      idempotencyKey: key,
      learnerId: learner,
      amount: xof(amount),
      provider: name,
      invoiceId: inv.invoice.id,
      payer: { name: "Awa Koné", email: "awa@example.test", phoneNumber: PHONE },
      returnUrl: "https://app.example.test/retour",
    };
    const r = unwrap(await initiateOnlinePayment(world.deps, ctx, input));
    return { learner, invoice: inv.invoice, key, input, view: r, id: r.payment.id, providerRef: r.payment.providerRef! };
  }

  const deliver = (name: string, hook: Hook) =>
    handleProviderWebhook(world.deps, { tenantId, provider: name, rawBody: hook.rawBody, headers: hook.headers, ...(hook.query ? { query: hook.query } : {}) });

  const paymentRow = async (id: string) => (await adminRows<{ status: string; provider_ref: string | null; simulated: boolean; allocated_amount: string }>(db, "SELECT status, provider_ref, simulated, allocated_amount::text FROM finance.payments WHERE id = $1", [id]))[0]!;
  const webhookRows = (id: string) => adminRows<{ status: string; error: string | null; attempts: number; event_id: string }>(db, "SELECT status, error, attempts, event_id FROM finance.webhook_events WHERE payment_id = $1 OR payload::text LIKE $2 ORDER BY received_at", [id, `%${id}%`]);

  describe.each(FLOWS)("$name", (flow) => {
    it("initiation : paiement EN ATTENTE (jamais simulé), référence fournisseur, consigne de paiement ; une seule transaction chez le fournisseur", async () => {
      const h = harness(flow.name);
      const before = flow.creations(h);
      const s = await start(flow.name);
      expect(s.view.payment.status).toBe("PENDING");
      expect(s.view.payment.simulated).toBe(false);
      expect(s.view.payment.provider).toBe(flow.name);
      expect(s.providerRef).toBeTruthy();
      expect(s.view.instructions?.redirectUrl ?? s.view.instructions?.instructions).toBeTruthy();
      expect(flow.creations(h)).toBe(before + 1);
      const row = await paymentRow(s.id);
      expect(row.provider_ref).toBe(s.providerRef);
    });

    it("idempotence : même clé => même paiement et AUCUNE seconde transaction chez le fournisseur", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      const after = flow.creations(h);
      const again = unwrap(await initiateOnlinePayment(world.deps, ctx, s.input));
      expect(again.payment.id).toBe(s.id);
      expect(again.replayed).toBe(true);
      expect(flow.creations(h)).toBe(after);
      const conflict = await initiateOnlinePayment(world.deps, ctx, { ...s.input, amount: xof(AMOUNT + 5) });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("finance.idempotency_key_reused");
      expect(await adminRows(db, "SELECT 1 FROM finance.payments WHERE idempotency_key = $1", [s.key])).toHaveLength(1);
    });

    it("webhook authentique : paiement CONFIRMÉ, reçu, imputation à la facture visée ; rejeu => aucun retraitement", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      SETTLE(h, s.id, s.providerRef);
      const hook = flow.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq);
      const first = unwrap(await deliver(flow.name, hook));
      expect(first).toMatchObject({ status: "PROCESSED", replayed: false, paymentId: s.id, paymentStatus: "CONFIRMED" });
      const view = unwrap(await getPaymentView(world.deps, ctx, s.id));
      expect(view.payment.status).toBe("CONFIRMED");
      expect(view.receipt?.number).toMatch(/^REC-2025-/);
      expect(view.allocations.map((a) => a.invoiceId)).toEqual([s.invoice.id]);
      expect(unwrap(await getInvoiceById(world.deps, ctx, s.invoice.id)).invoice.paid.amount).toBe(AMOUNT);

      const replay = unwrap(await deliver(flow.name, hook));
      expect(replay).toMatchObject({ status: "PROCESSED", replayed: true });
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [s.id])).toHaveLength(1);
      expect(unwrap(await getInvoiceById(world.deps, ctx, s.invoice.id)).invoice.paid.amount).toBe(AMOUNT);
      const events = await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.payment.completed' AND payload->>'paymentId' = $1", [s.id]);
      expect(events).toHaveLength(1);
    });

    it("webhooks CONCURRENTS identiques : un seul traitement, un seul reçu", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      SETTLE(h, s.id, s.providerRef);
      const hook = flow.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq);
      const results = await Promise.all(Array.from({ length: 6 }, () => deliver(flow.name, hook)));
      expect(results.every((r) => r.ok)).toBe(true);
      const ok = results.filter((r) => r.ok).map((r) => (r.ok ? r.value : null)!);
      expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [s.id])).toHaveLength(1);
      expect((await paymentRow(s.id)).status).toBe("CONFIRMED");
    });

    it("signature / jeton INVALIDE : 401, rien n'est enregistré, le paiement reste en attente", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      SETTLE(h, s.id, s.providerRef);
      const r = await deliver(flow.name, flow.forged(h, tenantId, { id: s.id, providerRef: s.providerRef }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.webhook_signature_invalid");
      expect((await paymentRow(s.id)).status).toBe("PENDING");
      expect(await webhookRows(s.id)).toHaveLength(0);
    });

    it("webhook du MAUVAIS tenant : refusé (signature liée / paiement introuvable), aucun effet sur le paiement", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      SETTLE(h, s.id, s.providerRef);
      const other = await db.createTenant();
      const hook = flow.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq);
      const r = await handleProviderWebhook(world.deps, { tenantId: other, provider: flow.name, rawBody: hook.rawBody, headers: hook.headers, ...(hook.query ? { query: hook.query } : {}) });
      // Pas de configuration pour cet autre tenant : le registre refuse (jamais d'encaissement croisé).
      expect(r.ok).toBe(false);
      expect((await paymentRow(s.id)).status).toBe("PENDING");
    });

    it("montant divergent : événement FAILED (rapprochement manuel), paiement inchangé, audit sensible", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      SETTLE(h, s.id, s.providerRef);
      flow.skewAmount?.(h, { id: s.id, providerRef: s.providerRef });
      const hook = flow.divergent(h, tenantId, { id: s.id, providerRef: s.providerRef });
      if (!hook) return; // Orange : voir la vérification active ci-dessous
      const r = unwrap(await deliver(flow.name, hook));
      expect(r).toMatchObject({ status: "FAILED", paymentId: s.id, paymentStatus: "PENDING" });
      expect((await paymentRow(s.id)).status).toBe("PENDING");
      const rows = await webhookRows(s.id);
      expect(rows[0]).toMatchObject({ status: "FAILED", error: "finance.provider_amount_mismatch" });
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [s.id])).toHaveLength(0);
      expect(world.audit.actions()).toContain("finance.webhook.rejected");
    });

    it("vérification active (route /verify) : en attente => reste en attente ; réglé chez le fournisseur => CONFIRMÉ, une seule fois", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      const pending = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: s.id }));
      expect(pending.payment.status).toBe("PENDING");
      SETTLE(h, s.id, s.providerRef);
      const done = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: s.id }));
      expect(done.payment.status).toBe("CONFIRMED");
      const again = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: s.id }));
      expect(again.payment.status).toBe("CONFIRMED");
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [s.id])).toHaveLength(1);
    });

    it("échec définitif chez le fournisseur : paiement FAILED ; un succès tardif signalé n'encaisse JAMAIS", async () => {
      const h = harness(flow.name);
      const s = await start(flow.name);
      flow.settleFailure(h, { id: s.id, providerRef: s.providerRef });
      const failed = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: s.id }));
      expect(failed.payment.status).toBe("FAILED");
      // Le fournisseur « se ravise » : webhook de succès authentique => rapprochement manuel, rien d'encaissé.
      SETTLE(h, s.id, s.providerRef);
      const hook = flow.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq);
      const late = await deliver(flow.name, hook);
      if (late.ok) expect(late.value).toMatchObject({ status: "FAILED", paymentStatus: "FAILED" });
      expect((await paymentRow(s.id)).status).toBe("FAILED");
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [s.id])).toHaveLength(0);
    });
  });

  describe("webhooks-indices (Orange, MTN, CinetPay) : la PREUVE est l'API de statut du fournisseur", () => {
    it("Orange : un webhook SUCCESS authentique en apparence mais NON confirmé par transactionstatus => 409, rien d'enregistré", async () => {
      const h = harness("orange_money");
      const s = await start("orange_money");
      const n = (h.mock as OrangeMock).notification(s.providerRef);
      const forgedHint = { rawBody: JSON.stringify({ status: "SUCCESS", notif_token: "x", txnid: "MP1" }), headers: {}, query: Object.fromEntries(n.url.searchParams) };
      const r = await deliver("orange_money", forgedHint);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.webhook_unverified");
      expect((await paymentRow(s.id)).status).toBe("PENDING");
      expect(await webhookRows(s.id)).toHaveLength(0);
    });

    it("MTN : un rappel SUCCESSFUL non confirmé par GET requesttopay => 409 ; confirmé => encaissé avec le montant DU FOURNISSEUR", async () => {
      const h = harness("mtn_momo");
      const s = await start("mtn_momo");
      const mtn = h.mock as MtnMock;
      const hook = { rawBody: JSON.stringify({ externalId: s.id, status: "SUCCESSFUL", amount: "25000", currency: "XOF" }), headers: {}, query: { t: webhookUrlToken(SECRETS.webhookSecret, tenantId, "mtn_momo") } };
      const r = await deliver("mtn_momo", hook);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.webhook_unverified");
      expect((await paymentRow(s.id)).status).toBe("PENDING");
      mtn.settle(s.providerRef, "SUCCESSFUL");
      expect(unwrap(await deliver("mtn_momo", hook))).toMatchObject({ status: "PROCESSED", paymentStatus: "CONFIRMED" });
    });

    it("CinetPay : l'indice annonce SUCCES mais le fournisseur dit REFUSED => paiement ÉCHOUÉ, pas encaissé", async () => {
      const h = harness("cinetpay");
      const s = await start("cinetpay");
      (h.mock as CinetPayMock).settle(encodePaymentReference(s.id), "REFUSED");
      const hook = FLOWS.find((f) => f.name === "cinetpay")!.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq);
      const r = unwrap(await deliver("cinetpay", hook));
      expect(r.paymentStatus).toBe("FAILED");
      expect((await paymentRow(s.id)).status).toBe("FAILED");
    });

    it("webhook d'un paiement INCONNU : aucun appel au fournisseur (pas d'amplification), événement ignoré", async () => {
      const h = harness("cinetpay");
      const callsBefore = h.mock.requests.length;
      const ghost = "0192a3b4-1111-7000-8000-00000000abcd";
      const hook = CinetPayMock.notification(SECRETS.cinetSecretKey, { cpm_site_id: "105899", cpm_trans_id: encodePaymentReference(ghost), cpm_amount: "100", cpm_error_message: "SUCCES" });
      const r = unwrap(await deliver("cinetpay", hook));
      expect(r).toMatchObject({ status: "IGNORED", paymentId: null });
      expect(h.mock.requests.length).toBe(callsBefore);
    });
  });

  it("le contenu stocké des webhooks est expurgé : ni numéro complet ni jeton de notification", async () => {
    const h = harness("cinetpay");
    const s = await start("cinetpay");
    SETTLE(h, s.id, s.providerRef);
    unwrap(await deliver("cinetpay", FLOWS.find((f) => f.name === "cinetpay")!.success(h, tenantId, { id: s.id, providerRef: s.providerRef }, ++seq)));
    const rows = await adminRows<{ payload: unknown }>(db, "SELECT payload FROM finance.webhook_events WHERE payment_id = $1", [s.id]);
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]!.payload);
    expect(text).not.toContain("0701020304");
    expect(text).not.toContain("2250701020304");
    expect(text).toContain("225");

    const o = harness("orange_money");
    const so = await start("orange_money");
    SETTLE(o, so.id, so.providerRef);
    unwrap(await deliver("orange_money", FLOWS[0]!.success(o, tenantId, { id: so.id, providerRef: so.providerRef }, ++seq)));
    const orows = await adminRows<{ payload: unknown }>(db, "SELECT payload FROM finance.webhook_events WHERE payment_id = $1", [so.id]);
    expect(JSON.stringify(orows[0]!.payload)).not.toContain("nt_");
  });

  it("un fournisseur sans configuration pour ce tenant est refusé, jamais simulé (production)", async () => {
    const strictProviders = createProviderRegistry({ environment: "production" });
    registerPaymentProviders(strictProviders, testRuntime({}));
    const strict = makeWorld(db, { providers: strictProviders, config: { environment: "production" } });
    const r = await initiateOnlinePayment(strict.deps, ctx, { idempotencyKey: nextKey("strict"), learnerId: learnerId(), amount: xof(AMOUNT), provider: "wave" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.provider_not_configured");
    expect(await adminRows(db, "SELECT 1 FROM finance.payments WHERE provider = 'wave' AND idempotency_key LIKE 'strict-%'")).toHaveLength(0);
  });
});
