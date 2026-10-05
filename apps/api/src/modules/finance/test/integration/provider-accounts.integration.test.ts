/**
 * Q-PAY-30 — compte fournisseur de paiement PAR ÉCOLE, repli sur le compte de la PLATEFORME, rapprochement et rapports
 * séparés par école (migration 0509). Faux fournisseur (aucun appel réseau), Postgres réel, aucun secret réel : les
 * « clés » des comptes sont des étiquettes de test.
 *
 * Ce que l'on prouve :
 *   - une école avec sa configuration paie sur SON compte (`TENANT`) ; une école sans configuration retombe sur le compte
 *     plateforme (`PLATFORM`) ; une école qui a DÉSACTIVÉ le fournisseur n'y retombe pas ; repli coupé => non configuré ;
 *   - le compte est enregistré à l'initiation et figé (déclencheur) : vérification et rapprochement l'interrogent TOUJOURS,
 *     même si l'école configure son compte ensuite ;
 *   - le rapprochement d'une école n'interroge jamais le compte ni les paiements d'une autre (A/B) ;
 *   - webhooks : signature du compte d'origine acceptée, signature d'un autre compte refusée sans effet ;
 *   - rapport par compte et liste des fournisseurs : propres à l'école (RLS).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { getProviderAccountsReport } from "../../application/reports";
import { handleProviderWebhook, initiateOnlinePayment, verifyPendingPayment } from "../../application/online-payments";
import { DEFAULT_RECONCILIATION_CONFIG } from "../../application/deps";
import { listProviders } from "../../application/provider-admin";
import { reconcileTenant } from "../../application/reconciliation";
import { CompositeConfigSource } from "../../infrastructure/provider-config-source";
import { createProviderRegistry, StaticProviderConfigSource, type ProviderConfigSource, type ProviderSettings } from "../../infrastructure/providers/registry";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb } from "../support/db";
import { fakeDefinition, type FakeRealProvider } from "../support/fake-provider";
import { xof } from "../support/harness";
import { FAST_RECONCILIATION } from "../support/recon-env";
import { learnerId, nextKey, simpleInvoice } from "../support/scenario";

const PLATFORM_KEY = "test-platform-account";
const PLATFORM: ProviderSettings = { apiKey: PLATFORM_KEY, webhookSecret: "test-platform-webhook" };
const OWN = (label: string): ProviderSettings => ({ apiKey: `test-own-${label}`, webhookSecret: `test-own-webhook-${label}` });

/** Compte de la plateforme : mêmes réglages pour toutes les écoles (comme `EnvProviderConfigSource`). */
class PlatformSource implements ProviderConfigSource {
  async get(_tenantId: string, provider: string): Promise<ProviderSettings | null> {
    return provider === "fakepay" ? PLATFORM : null;
  }
}

describeIntegration("Q-PAY-30 — compte fournisseur par école, repli plateforme, séparation A/B", () => {
  let db: FinanceTestDb;

  beforeAll(async () => {
    db = await createFinanceTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  function setup(options: { fallback?: boolean } = {}) {
    const tenantSource = new StaticProviderConfigSource();
    const instances: FakeRealProvider[] = [];
    const providers = createProviderRegistry({
      environment: "test",
      configSource: new CompositeConfigSource(tenantSource, new PlatformSource(), { allowEnvFallback: options.fallback ?? true }),
    }).register(fakeDefinition("fakepay", instances));
    const world = makeWorld(db, { providers, config: { reconciliation: { ...DEFAULT_RECONCILIATION_CONFIG, ...FAST_RECONCILIATION } } });
    /** Instance du faux fournisseur créée pour (école, clé de compte). */
    const instanceOf = (tenantId: string, apiKey: string): FakeRealProvider | undefined => instances.find((i) => i.tenantId === tenantId && i.apiKey === apiKey);
    return { tenantSource, instances, world, instanceOf };
  }

  async function pay(world: ReturnType<typeof setup>["world"], tenantId: string, amount = 30_000) {
    const ctx = ctxFor(tenantId);
    const learner = learnerId();
    const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey("acc");
    const res = await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: key, learnerId: learner, amount: xof(amount), provider: "fakepay", invoiceId: inv.invoice.id });
    return { ctx, res, key, invoiceId: inv.invoice.id };
  }

  const paymentOf = async (key: string) =>
    (await adminRows<{ id: string; status: string; provider_account: string | null; provider_ref: string | null; tenant_id: string }>(
      db,
      "SELECT id, status, provider_account, provider_ref, tenant_id FROM finance.payments WHERE idempotency_key = $1",
      [key],
    ))[0]!;

  describe("résolution du compte et repli", () => {
    it("compte propre -> TENANT ; sans configuration -> PLATFORM ; fournisseur désactivé par l'école -> pas de repli", async () => {
      const { tenantSource, world, instanceOf } = setup();
      const a = await db.createTenant();
      const b = await db.createTenant();
      const c = await db.createTenant();
      tenantSource.set(a, "fakepay", OWN("a"));
      tenantSource.set(c, "fakepay", { ...OWN("c"), enabled: "false" });

      const pa = await pay(world, a);
      const pb = await pay(world, b);
      expect(pa.res.ok && pb.res.ok).toBe(true);
      expect((await paymentOf(pa.key)).provider_account).toBe("TENANT");
      expect((await paymentOf(pb.key)).provider_account).toBe("PLATFORM");
      // Le bon compte a été utilisé pour initier : A sur sa clé, B sur la clé plateforme.
      expect(instanceOf(a, OWN("a").apiKey!)!.initiations).toHaveLength(1);
      expect(instanceOf(b, PLATFORM_KEY)!.initiations).toHaveLength(1);
      expect(instanceOf(a, PLATFORM_KEY)).toBeUndefined();

      // Désactivé par l'école : refus explicite, jamais de repli plateforme.
      const pc = await pay(world, c);
      expect(pc.res.ok).toBe(false);
      if (!pc.res.ok) expect(pc.res.error.code).toBe("finance.provider_disabled");
      expect(instanceOf(c, PLATFORM_KEY)).toBeUndefined();
    });

    it("repli coupé (FINANCE_PROVIDER_ENV_FALLBACK=false) : une école sans configuration n'a pas de fournisseur", async () => {
      const { world } = setup({ fallback: false });
      const b = await db.createTenant();
      const r = await pay(world, b);
      expect(r.res.ok).toBe(false);
      if (!r.res.ok) expect(r.res.error.code).toBe("finance.provider_not_configured");
    });

    it("liste des fournisseurs : compte actif et disponibilité du repli, propres à l'école", async () => {
      const on = setup();
      const a = await db.createTenant();
      const b = await db.createTenant();
      on.tenantSource.set(a, "fakepay", OWN("a"));
      // Le catalogue d'administration ne connaît que les cinq fournisseurs réels : on vérifie la forme sur l'un d'eux sans
      // configuration plateforme (le repli n'y est pas disponible) puis la logique de `platformAccountReady` sur le faux.
      const listB = unwrap(await listProviders(on.world.deps, ctxFor(b)));
      expect(listB.items.every((i) => i.activeAccount === null && i.platformFallbackReady === false)).toBe(true);
      expect(await on.world.providers.platformAccountReady("fakepay")).toBe(true);
      const off = setup({ fallback: false });
      expect(await off.world.providers.platformAccountReady("fakepay")).toBe(false);
      expect(await on.world.providers.platformAccountReady("inconnu")).toBe(false);
    });
  });

  describe("compte figé, vérification et rapprochement séparés par école", () => {
    it("vérification et rapprochement interrogent le compte d'origine, même si l'école configure le sien ensuite", async () => {
      const { tenantSource, world, instanceOf } = setup();
      const b = await db.createTenant();
      const p = await pay(world, b);
      const row = await paymentOf(p.key);
      expect(row.provider_account).toBe("PLATFORM");

      // B configure SON compte après coup : le paiement en attente reste interrogé sur le compte plateforme.
      tenantSource.set(b, "fakepay", OWN("b"));
      const platform = instanceOf(b, PLATFORM_KEY)!;
      platform.verifyStatus = "SUCCEEDED";
      platform.verifyAmount = xof(30_000);
      world.clock.advance(61_000);
      const r = await reconcileTenant(world.deps, b);
      expect(r.payments).toMatchObject({ examined: 1, confirmed: 1 });
      expect(platform.verifyCalls).toEqual([row.provider_ref]);
      expect(instanceOf(b, OWN("b").apiKey!)).toBeUndefined(); // le compte propre n'a pas été interrogé pour ce paiement
      expect((await paymentOf(p.key)).status).toBe("CONFIRMED");

      // Un NOUVEAU paiement de B part, lui, sur son compte propre.
      const q = await pay(world, b);
      expect((await paymentOf(q.key)).provider_account).toBe("TENANT");
    });

    it("A/B sur le même compte plateforme : le rapprochement de A ne touche ni n'interroge le paiement de B", async () => {
      const { world, instanceOf } = setup();
      const a = await db.createTenant();
      const b = await db.createTenant();
      const pa = await pay(world, a);
      const pb = await pay(world, b);
      const rowA = await paymentOf(pa.key);
      const rowB = await paymentOf(pb.key);
      expect([rowA.provider_account, rowB.provider_account]).toEqual(["PLATFORM", "PLATFORM"]);
      // Même clé de compte, mais une instance PAR école : aucune confusion possible entre les deux écoles.
      const insA = instanceOf(a, PLATFORM_KEY)!;
      const insB = instanceOf(b, PLATFORM_KEY)!;
      expect(insA).not.toBe(insB);
      insA.verifyStatus = "SUCCEEDED";
      insA.verifyAmount = xof(30_000);
      insB.verifyStatus = "SUCCEEDED";
      insB.verifyAmount = xof(30_000);

      world.clock.advance(61_000);
      const onlyA = await reconcileTenant(world.deps, a);
      expect(onlyA.payments.confirmed).toBe(1);
      expect(insA.verifyCalls).toEqual([rowA.provider_ref]);
      expect(insB.verifyCalls).toEqual([]);
      expect((await paymentOf(pa.key)).status).toBe("CONFIRMED");
      expect((await paymentOf(pb.key)).status).toBe("PENDING");

      // Vérification manuelle depuis l'autre école : introuvable (RLS), aucune interrogation.
      const cross = await verifyPendingPayment(world.deps, ctxFor(a), { paymentId: rowB.id });
      expect(cross.ok).toBe(false);
      expect(insB.verifyCalls).toEqual([]);

      const onlyB = await reconcileTenant(world.deps, b);
      expect(onlyB.payments.confirmed).toBe(1);
      expect(insB.verifyCalls).toEqual([rowB.provider_ref]);
      expect(insA.verifyCalls).toEqual([rowA.provider_ref]); // inchangé
    });

    it("le compte d'un paiement est figé par la base (même pour un superutilisateur) et réservé aux paiements en ligne", async () => {
      const { world, tenantSource } = setup();
      const a = await db.createTenant();
      tenantSource.set(a, "fakepay", OWN("a"));
      const p = await pay(world, a);
      await expect(db.admin.query("UPDATE finance.payments SET provider_account = 'PLATFORM' WHERE idempotency_key = $1", [p.key])).rejects.toThrow(/payment_immutable/);
      await expect(db.admin.query("UPDATE finance.payments SET provider_account = 'AUTRE' WHERE idempotency_key = $1", [p.key])).rejects.toThrow();
      expect((await paymentOf(p.key)).provider_account).toBe("TENANT");
    });
  });

  describe("webhooks", () => {
    const hook = (provider: FakeRealProvider, o: { event: string; order: string; ref: string; amount: number; ok: boolean }) => {
      const rawBody = JSON.stringify({ event: o.event, kind: "payment", order: o.order, ref: o.ref, amount: o.amount, ok: o.ok });
      return { rawBody, headers: { "x-fake-signature": provider.sign(rawBody) } };
    };

    it("signature du compte d'origine acceptée (même après configuration du compte propre) ; signature d'un autre compte refusée sans effet", async () => {
      const { tenantSource, world, instanceOf } = setup();
      const b = await db.createTenant();
      const p = await pay(world, b);
      const row = await paymentOf(p.key);
      expect(row.provider_account).toBe("PLATFORM");

      // B configure son compte propre : ses futurs webhooks seront signés par SON secret, les anciens par celui de la plateforme.
      tenantSource.set(b, "fakepay", OWN("b"));
      // Instance du compte propre (créée à la demande par une résolution neuve).
      expect((await world.providers.resolve(b, "fakepay")).ok).toBe(true);
      const own = instanceOf(b, OWN("b").apiKey!)!;
      const platform = instanceOf(b, PLATFORM_KEY)!;

      // 1. Signé par le compte PROPRE alors que le paiement est sur le compte PLATEFORME : signature valide, compte différent => refus.
      const wrong = hook(own, { event: "evt-own-1", order: row.id, ref: row.provider_ref!, amount: 30_000, ok: true });
      const r1 = unwrap(await handleProviderWebhook(world.deps, { tenantId: b, provider: "fakepay", rawBody: wrong.rawBody, headers: wrong.headers }));
      expect(r1.status).toBe("FAILED");
      expect((await paymentOf(p.key)).status).toBe("PENDING");
      const events = await adminRows<{ error: string | null }>(db, "SELECT error FROM finance.webhook_events WHERE event_id = 'evt-own-1'");
      expect(events[0]!.error).toBe("finance.webhook_account_mismatch");
      expect(world.audit.actions()).toContain("finance.webhook.rejected");

      // 2. Signé par le compte PLATEFORME : accepté (repli sur le second compte), paiement confirmé.
      const good = hook(platform, { event: "evt-platform-1", order: row.id, ref: row.provider_ref!, amount: 30_000, ok: true });
      const r2 = unwrap(await handleProviderWebhook(world.deps, { tenantId: b, provider: "fakepay", rawBody: good.rawBody, headers: good.headers }));
      expect(r2).toMatchObject({ status: "PROCESSED", paymentId: row.id, paymentStatus: "CONFIRMED" });

      // 3. Une signature qui n'est celle d'aucun des deux comptes : 401.
      const forged = await handleProviderWebhook(world.deps, { tenantId: b, provider: "fakepay", rawBody: good.rawBody, headers: { "x-fake-signature": "0".repeat(64) } });
      expect(forged.ok).toBe(false);
    });

    it("A/B : un webhook valide adressé à l'URL d'une autre école n'atteint pas le paiement (RLS), rien n'est encaissé", async () => {
      const { world, instanceOf } = setup();
      const a = await db.createTenant();
      const b = await db.createTenant();
      const pa = await pay(world, a);
      const row = await paymentOf(pa.key);
      // Compte plateforme partagé : la signature d'un webhook est valable pour les deux écoles... mais le paiement n'existe que chez A.
      const viaB = instanceOf(b, PLATFORM_KEY) ?? (unwrap(await world.providers.resolve(b, "fakepay")) as FakeRealProvider);
      const wh = hook(viaB, { event: "evt-ab-1", order: row.id, ref: row.provider_ref!, amount: 30_000, ok: true });
      const r = unwrap(await handleProviderWebhook(world.deps, { tenantId: b, provider: "fakepay", rawBody: wh.rawBody, headers: wh.headers }));
      expect(r).toMatchObject({ status: "IGNORED", paymentId: null });
      expect((await paymentOf(pa.key)).status).toBe("PENDING");
    });
  });

  describe("rapports séparés par école", () => {
    it("rapport par compte : chaque école ne voit que ses paiements, répartis TENANT / PLATFORM, sans mélange", async () => {
      const { tenantSource, world, instanceOf } = setup();
      const a = await db.createTenant();
      const b = await db.createTenant();
      tenantSource.set(a, "fakepay", OWN("a"));
      const a1 = await pay(world, a, 30_000);
      const b1 = await pay(world, b, 20_000);
      const b2 = await pay(world, b, 10_000);
      // B1 confirmé via vérification manuelle, B2 reste en attente.
      const bi = instanceOf(b, PLATFORM_KEY)!;
      bi.verifyStatus = "SUCCEEDED";
      bi.verifyAmount = xof(20_000);
      const rowB1 = await paymentOf(b1.key);
      unwrap(await verifyPendingPayment(world.deps, b1.ctx, { paymentId: rowB1.id }));
      void b2;
      void a1;

      const repA = unwrap(await getProviderAccountsReport(world.deps, ctxFor(a)));
      expect(repA.items).toEqual([
        expect.objectContaining({ provider: "fakepay", account: "TENANT", pendingCount: 1, confirmedCount: 0 }),
      ]);
      expect(repA.items[0]!.pending.amount).toBe(30_000);

      const repB = unwrap(await getProviderAccountsReport(world.deps, ctxFor(b)));
      expect(repB.items).toHaveLength(1);
      expect(repB.items[0]).toMatchObject({ provider: "fakepay", account: "PLATFORM", confirmedCount: 1, pendingCount: 1 });
      expect(repB.items[0]!.confirmed.amount).toBe(20_000);
      expect(repB.items[0]!.pending.amount).toBe(10_000);

      // Filtres de période : hors période => vide ; période inversée / invalide => refus.
      expect(unwrap(await getProviderAccountsReport(world.deps, ctxFor(b), { from: "2030-01-01", to: "2030-12-31" })).items).toEqual([]);
      expect((await getProviderAccountsReport(world.deps, ctxFor(b), { from: "2025-12-31", to: "2025-01-01" })).ok).toBe(false);
      expect((await getProviderAccountsReport(world.deps, ctxFor(b), { from: "pas-une-date" as never })).ok).toBe(false);
      // Une école sans paiement en ligne : rapport vide (aucune fuite des autres).
      const empty = await db.createTenant();
      expect(unwrap(await getProviderAccountsReport(world.deps, ctxFor(empty))).items).toEqual([]);
    });
  });
});
