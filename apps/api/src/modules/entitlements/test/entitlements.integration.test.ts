/**
 * Intégration (vrai Postgres) : catalogue, abonnements, surcharges, droits effectifs
 * calculés depuis la base, suspension, usage, isolation entre deux tenants provisionnés.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import {
  InMemoryEventBus,
  ManualClock,
  createDomainEvent,
  createRequestContext,
  createSystemContext,
  defineModule,
  newId,
  type DomainEvent,
  type RequestContext,
} from "@ecoledigitale/kernel";
import {
  EntitlementsOverrideChangedPayloadSchema,
  EntitlementsSubscriptionChangedPayloadSchema,
} from "@ecoledigitale/contracts/src/v2/entitlements";
import { provisionTenant, setTenantStatus } from "../../tenancy";
import {
  CachedEntitlementsReader,
  PgEntitlementsReader,
  getCatalog,
  getSubscription,
  getUsage,
  hasFeature,
  listFeatureOverrides,
  onTenantProvisioned,
  recordUsage,
  removeFeatureOverride,
  resolveEntitlements,
  setFeatureOverride,
  setPlanFeatures,
  setSubscription,
  syncFeatureCatalog,
  upsertPlan,
  type EntitlementsDeps,
} from "../index";
import { ENTITLEMENTS_ISOLATION_ALLOWLIST } from "../../isolation-allowlist.entitlements";
import { TENANCY_ISOLATION_ALLOWLIST } from "../../isolation-allowlist.tenancy";
import { createTestDb, describeIntegration, type TestDb } from "./support/db";

/** Code de la première violation d'une ValidationError (undefined si succès ou autre erreur). */
const issue = (r: { ok: boolean; error?: unknown }): string | undefined =>
  r.ok ? undefined : (r.error as { issues?: Array<{ code?: string }> }).issues?.[0]?.code;

const clock = new ManualClock("2026-10-01T08:00:00.000Z");
const DAY = 86_400_000;

const MANIFESTS = [
  defineModule({
    key: "platformcore",
    title: "Noyau",
    packs: ["CORE"],
    features: [
      { key: "platformcore.dashboard", label: "Tableau de bord", packs: ["CORE"] },
      { key: "platformcore.profile", label: "Profil", packs: ["CORE"] },
    ],
  }),
  defineModule({
    key: "finance",
    title: "Finance",
    packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
    features: [
      { key: "finance.online-payment", label: "Paiement en ligne", packs: [] },
      { key: "finance.receipts", label: "Reçus PDF", packs: ["PRIMARY", "SECONDARY"] },
    ],
  }),
  defineModule({
    key: "academic",
    title: "Académique",
    packs: ["HIGHER"],
    features: [{ key: "academic.ue-ecue", label: "UE / ECUE", packs: ["HIGHER"] }],
  }),
];

const asTenant = (tenantId: string): RequestContext => createRequestContext({ tenantId, userId: newId(), roles: ["owner"] });
const operatorFor = (tenantId: string): RequestContext =>
  createRequestContext({ tenantId, userId: newId(), actor: "superAdmin" });

describeIntegration("entitlements — intégration", () => {
  let db: TestDb;
  let deps: EntitlementsDeps;
  let A: { tenantId: string; payload: unknown };
  let B: { tenantId: string; payload: unknown };

  const raw = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
  const count = async (sql: string, params: unknown[] = []) => Number((await raw(sql, params))[0].n);

  async function provision(slug: string, packs: Array<"PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL">) {
    const r = await provisionTenant(
      { db: db.tenantDb, clock },
      { name: `Org ${slug}`, slug, countryCode: "CI", packs, adminContact: { name: "Awa Koné", email: `a@${slug}.ci` } },
    );
    if (!r.ok) throw r.error;
    const ev = (
      await raw("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.tenant.provisioned'", [r.value.tenantId])
    )[0];
    return { tenantId: r.value.tenantId, payload: ev.payload };
  }

  const entitlementsOf = (tenantId: string) =>
    db.tenantDb.run(createSystemContext(tenantId), (tx) => resolveEntitlements(tx, tenantId, clock), { readOnly: true });

  beforeAll(async () => {
    db = await createTestDb();
    deps = { db: db.tenantDb, systemDb: db.systemDb, clock };
    const sync = await syncFeatureCatalog(deps, MANIFESTS);
    if (!sync.ok) throw sync.error;
    A = await provision("lauriers", ["PRIMARY", "SECONDARY"]);
    B = await provision("palmiers", ["HIGHER"]);
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe("catalogue global", () => {
    it("seed : 3 plans (STARTER, PROFESSIONAL, ENTERPRISE) et 4 packs", async () => {
      const cat = await getCatalog(deps);
      expect(cat.ok).toBe(true);
      if (!cat.ok) return;
      expect(cat.value.plans.map((p) => p.key)).toEqual(["STARTER", "PROFESSIONAL", "ENTERPRISE"]);
      expect(cat.value.packs.map((p) => p.key)).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    });

    it("syncFeatureCatalog : alimente `features` depuis les manifestes passés en paramètre", async () => {
      const cat = await getCatalog(deps);
      expect(cat.ok && cat.value.features.map((f) => [f.key, f.moduleKey, f.packs, f.retired])).toEqual([
        ["academic.ue-ecue", "academic", ["HIGHER"], false],
        ["finance.online-payment", "finance", [], false],
        ["finance.receipts", "finance", ["PRIMARY", "SECONDARY"], false],
        ["platformcore.dashboard", "platformcore", ["CORE"], false],
        ["platformcore.profile", "platformcore", ["CORE"], false],
      ]);
    });

    it("syncFeatureCatalog est idempotent, met à jour, retire ce qui disparaît d'un module, réactive", async () => {
      const again = await syncFeatureCatalog(deps, MANIFESTS);
      expect(again.ok && again.value).toMatchObject({ created: 0, updated: 0, retired: 0, unchanged: 5, total: 5 });

      // Libellé modifié + une feature du module `finance` disparaît + une nouvelle apparaît.
      const v2 = [
        MANIFESTS[0]!,
        defineModule({
          key: "finance",
          title: "Finance",
          packs: ["PRIMARY"],
          features: [
            { key: "finance.online-payment", label: "Paiement en ligne (v2)", packs: [] },
            { key: "finance.refunds", label: "Remboursements", packs: [] },
          ],
        }),
        MANIFESTS[2]!,
      ];
      const r = await syncFeatureCatalog(deps, v2);
      expect(r.ok && r.value).toMatchObject({ created: 1, updated: 1, retired: 1, unchanged: 3 });
      let cat = await getCatalog(deps);
      const receipts = cat.ok && cat.value.features.find((f) => f.key === "finance.receipts");
      expect(receipts && receipts.retired).toBe(true);

      // La feature revient : réactivée (et non recréée).
      const back = await syncFeatureCatalog(deps, MANIFESTS);
      expect(back.ok && back.value).toMatchObject({ restored: 1, retired: 1 });
      cat = await getCatalog(deps);
      expect(cat.ok && cat.value.features.find((f) => f.key === "finance.receipts")?.retired).toBe(false);
      // finance.refunds (absente de MANIFESTS) est maintenant retirée.
      expect(cat.ok && cat.value.features.find((f) => f.key === "finance.refunds")?.retired).toBe(true);
    });

    it("un appel PARTIEL ne retire pas les features des autres modules ; fullSync si", async () => {
      const partial = await syncFeatureCatalog(deps, [MANIFESTS[2]!]);
      expect(partial.ok && partial.value.retired).toBe(0);
      let cat = await getCatalog(deps);
      expect(cat.ok && cat.value.features.find((f) => f.key === "platformcore.dashboard")?.retired).toBe(false);

      const full = await syncFeatureCatalog(deps, [MANIFESTS[0]!, MANIFESTS[2]!], { fullSync: true });
      expect(full.ok && full.value.retired).toBe(2); // finance.online-payment, finance.receipts
      cat = await getCatalog(deps);
      expect(cat.ok && cat.value.features.find((f) => f.key === "finance.receipts")?.retired).toBe(true);

      await syncFeatureCatalog(deps, MANIFESTS); // remet le catalogue complet pour la suite
      cat = await getCatalog(deps);
      expect(cat.ok && cat.value.features.filter((f) => !f.retired).map((f) => f.key)).toEqual([
        "academic.ue-ecue",
        "finance.online-payment",
        "finance.receipts",
        "platformcore.dashboard",
        "platformcore.profile",
      ]);
    });

    it("liste de manifestes vide : refusée (elle retirerait tout le catalogue)", async () => {
      const r = await syncFeatureCatalog(deps, []);
      expect(issue(r)).toBe("entitlements.manifests_empty");
    });

    it("manifestes en doublon : refusés, rien n'est écrit", async () => {
      const before = await count("SELECT count(*)::int AS n FROM entitlements.features");
      const dup = defineModule({ key: "other", title: "x", packs: ["CORE"], features: [{ key: "finance.receipts", label: "x", packs: [] }] });
      const r = await syncFeatureCatalog(deps, [...MANIFESTS, dup]);
      expect(issue(r)).toBe("entitlements.feature_duplicate");
      expect(await count("SELECT count(*)::int AS n FROM entitlements.features")).toBe(before);
    });

    it("plans : création, mise à jour partielle, features du plan (clés inconnues refusées)", async () => {
      const created = await upsertPlan(deps, "PREMIUM", { label: "Premium", description: "Le haut de gamme", sortOrder: 40 });
      expect(created.ok && created.value).toMatchObject({ key: "PREMIUM", label: "Premium", sortOrder: 40, active: true, featureKeys: [] });

      const renamed = await upsertPlan(deps, "PREMIUM", { label: "Premium+" });
      expect(renamed.ok && renamed.value).toMatchObject({ label: "Premium+", description: "Le haut de gamme", sortOrder: 40 });

      const bad = await setPlanFeatures(deps, "PREMIUM", { featureKeys: ["finance.online-payment", "ghost.feature"] });
      expect(issue(bad)).toBe("entitlements.feature_not_found");
      expect(await count("SELECT count(*)::int AS n FROM entitlements.plan_features WHERE plan_key = 'PREMIUM'")).toBe(0);

      const ok = await setPlanFeatures(deps, "PREMIUM", { featureKeys: ["finance.online-payment", "finance.receipts"] });
      expect(ok.ok && ok.value.featureKeys).toEqual(["finance.online-payment", "finance.receipts"]);
      const replaced = await setPlanFeatures(deps, "PREMIUM", { featureKeys: ["finance.receipts"] });
      expect(replaced.ok && replaced.value.featureKeys).toEqual(["finance.receipts"]);

      const missing = await setPlanFeatures(deps, "NOPE", { featureKeys: [] });
      expect(!missing.ok && missing.error.code).toBe("entitlements.plan_not_found");
      const invalidKey = await upsertPlan(deps, "minuscules", { label: "x1" });
      expect(issue(invalidKey)).toBe("entitlements.plan_key_invalid");
    });

    it("les plans de démonstration de la suite", async () => {
      expect((await setPlanFeatures(deps, "PROFESSIONAL", { featureKeys: ["finance.online-payment"] })).ok).toBe(true);
      expect((await setPlanFeatures(deps, "STARTER", { featureKeys: [] })).ok).toBe(true);
    });
  });

  describe("abonnement d'essai à la création du tenant (consommateur de tenancy.tenant.provisioned)", () => {
    it("sans consommateur : un tenant neuf n'a que les features CORE (comportement sûr par défaut)", async () => {
      const e = await entitlementsOf(A.tenantId);
      expect(e.reason).toBe("NO_SUBSCRIPTION");
      expect(e.features).toEqual(["platformcore.dashboard", "platformcore.profile"]);
    });

    it("crée un essai STARTER de 30 jours avec les packs du provisioning ; invalide le cache ; publie l'événement", async () => {
      const bus = new InMemoryEventBus();
      const cache = new CachedEntitlementsReader(new PgEntitlementsReader(db.tenantDb, clock), { clock });
      cache.bindToBus(bus);
      await cache.getEntitlements(A.tenantId); // peuple le cache (NO_SUBSCRIPTION)

      const event = { type: "tenancy.tenant.provisioned", tenantId: A.tenantId, payload: A.payload };
      const r = await onTenantProvisioned({ ...deps, cache }, event);
      expect(r.ok && r.value.created).toBe(true);
      expect(r.ok && r.value.subscription).toMatchObject({ planKey: "STARTER", status: "TRIALING", packs: ["PRIMARY", "SECONDARY"] });
      expect(r.ok && r.value.subscription?.endsAt?.getTime()).toBe(clock.now().getTime() + 30 * DAY);

      // Le cache a été invalidé dans le process : droits à jour immédiatement.
      const e = await cache.getEntitlements(A.tenantId);
      expect(e.reason).toBe("OK");
      expect(e.features).toContain("finance.receipts"); // pack PRIMARY/SECONDARY

      const ev = (await raw("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'entitlements.subscription.changed'", [A.tenantId]))[0];
      const p = EntitlementsSubscriptionChangedPayloadSchema.parse(ev.payload);
      expect(p.previous).toBeNull();
      expect(p.current).toMatchObject({ planKey: "STARTER", status: "TRIALING" });
    });

    it("idempotent : une seconde livraison de l'événement ne crée rien", async () => {
      const event = { type: "tenancy.tenant.provisioned", tenantId: A.tenantId, payload: A.payload };
      const r = await onTenantProvisioned(deps, event);
      expect(r.ok && r.value.created).toBe(false);
      expect(await count("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [A.tenantId])).toBe(1);
      expect(await count("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'entitlements.subscription.changed'", [A.tenantId])).toBe(1);
    });

    it("refuse un événement d'un autre type ou un payload invalide", async () => {
      const wrongType = await onTenantProvisioned(deps, { type: "tenancy.institution.created", tenantId: A.tenantId, payload: A.payload });
      expect(wrongType.ok).toBe(false);
      const badPayload = await onTenantProvisioned(deps, { type: "tenancy.tenant.provisioned", tenantId: B.tenantId, payload: { v: 2 } });
      expect(!badPayload.ok && badPayload.error.code).toBe("VALIDATION_FAILED");
      expect(await count("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [B.tenantId])).toBe(0);
    });

    it("le tenant B reçoit son propre essai (packs HIGHER)", async () => {
      const r = await onTenantProvisioned(deps, { type: "tenancy.tenant.provisioned", tenantId: B.tenantId, payload: B.payload });
      expect(r.ok && r.value.subscription?.packs).toEqual(["HIGHER"]);
    });
  });

  describe("abonnement", () => {
    it("changement de plan : mise à jour en place, ancien état dans l'événement", async () => {
      const op = operatorFor(A.tenantId);
      const r = await setSubscription(deps, op, { planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE", learnerTierMax: 500 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toMatchObject({ planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE", learnerTierMax: 500 });
      expect(await count("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [A.tenantId])).toBe(1);

      const ev = (
        await raw("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'entitlements.subscription.changed' ORDER BY id DESC LIMIT 1", [A.tenantId])
      )[0];
      const p = EntitlementsSubscriptionChangedPayloadSchema.parse(ev.payload);
      expect(p.previous).toMatchObject({ planKey: "STARTER", status: "TRIALING", packs: ["PRIMARY", "SECONDARY"] });
      expect(p.current).toMatchObject({ planKey: "PROFESSIONAL", status: "ACTIVE", packs: ["PRIMARY"] });
      expect(p.subscriptionId).toBe(r.value.id);
    });

    it("droits effectifs = plan + packs : PROFESSIONAL (paiement en ligne) + PRIMARY (reçus)", async () => {
      const e = await entitlementsOf(A.tenantId);
      expect(e).toMatchObject({ reason: "OK", planKey: "PROFESSIONAL", packs: ["PRIMARY"] });
      expect(e.features).toEqual(["finance.online-payment", "finance.receipts", "platformcore.dashboard", "platformcore.profile"]);
      expect(e.sources).toEqual({
        "finance.online-payment": "PLAN",
        "finance.receipts": "PACK",
        "platformcore.dashboard": "CORE",
        "platformcore.profile": "CORE",
      });
      expect(e.limits.learnerTierMax).toBe(500);
    });

    it("les champs optionnels absents sont conservés lors d'une mise à jour", async () => {
      const r = await setSubscription(deps, operatorFor(A.tenantId), { planKey: "PROFESSIONAL", packs: ["PRIMARY", "SECONDARY"], status: "ACTIVE" });
      expect(r.ok && r.value.learnerTierMax).toBe(500);
    });

    it("validations : plan inconnu, pack inconnu, période incohérente, statut terminal sans abonnement", async () => {
      const op = operatorFor(A.tenantId);
      const noPlan = await setSubscription(deps, op, { planKey: "GHOST", packs: [], status: "ACTIVE" });
      expect(!noPlan.ok && noPlan.error.code).toBe("entitlements.plan_not_found");

      const noPack = await setSubscription(deps, op, { planKey: "STARTER", packs: ["MATERNELLE"], status: "ACTIVE" });
      expect(!noPack.ok && noPack.error.code).toBe("VALIDATION_FAILED");

      const period = await setSubscription(deps, op, { planKey: "STARTER", packs: [], status: "ACTIVE", endsAt: "2020-01-01T00:00:00.000Z" });
      expect(issue(period)).toBe("entitlements.period_invalid");

      const unknownTenant = await setSubscription(deps, operatorFor(newId()), { planKey: "STARTER", packs: [], status: "ACTIVE" });
      expect(!unknownTenant.ok && unknownTenant.error.code).toBe("entitlements.tenant_not_found");

      const cancelNothing = await setSubscription(deps, operatorFor(B.tenantId), { planKey: "STARTER", packs: [], status: "CANCELED" });
      expect(cancelNothing.ok).toBe(true); // B a un essai vivant : on peut le résilier
      const cancelAgain = await setSubscription(deps, operatorFor(B.tenantId), { planKey: "STARTER", packs: [], status: "EXPIRED" });
      expect(!cancelAgain.ok && cancelAgain.error.code).toBe("entitlements.no_live_subscription");
    });

    it("résiliation : CORE seulement ; une nouvelle souscription crée un nouvel abonnement (historique conservé)", async () => {
      const e = await entitlementsOf(B.tenantId);
      expect(e).toMatchObject({ reason: "SUBSCRIPTION_INACTIVE", subscriptionStatus: "CANCELED" });
      expect(e.features).toEqual(["platformcore.dashboard", "platformcore.profile"]);

      const resub = await setSubscription(deps, operatorFor(B.tenantId), { planKey: "STARTER", packs: ["HIGHER"], status: "ACTIVE" });
      expect(resub.ok).toBe(true);
      expect(await count("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [B.tenantId])).toBe(2);
      expect(await count("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1 AND status IN ('TRIALING','ACTIVE','PAST_DUE')", [B.tenantId])).toBe(1);

      const current = await getSubscription(deps, asTenant(B.tenantId));
      expect(current.ok && current.value).toMatchObject({ status: "ACTIVE", packs: ["HIGHER"] });
    });

    it("la base refuse deux abonnements vivants pour un tenant (index unique partiel)", async () => {
      await expect(
        db.tenantDb.run(createSystemContext(A.tenantId), (tx) =>
          tx.query(
            "INSERT INTO entitlements.tenant_subscriptions (tenant_id, plan_key, status) VALUES ($1, 'STARTER', 'ACTIVE')",
            [A.tenantId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("abonnement échu (date) bien que statut ACTIVE : CORE seulement, sans écriture", async () => {
      const later = new ManualClock(clock.now());
      later.advance(400 * DAY);
      const reader = new PgEntitlementsReader(db.tenantDb, later);
      // Aucun ends_at pour A (illimité) : toujours actif ; pour B non plus -> on pose une échéance courte.
      const t = await provision("echeance", ["PRIMARY"]);
      await setSubscription(deps, operatorFor(t.tenantId), {
        planKey: "STARTER",
        packs: ["PRIMARY"],
        status: "ACTIVE",
        endsAt: new Date(clock.now().getTime() + 10 * DAY).toISOString(),
      });
      expect((await new PgEntitlementsReader(db.tenantDb, clock).getEntitlements(t.tenantId)).reason).toBe("OK");
      const expired = await reader.getEntitlements(t.tenantId);
      expect(expired.reason).toBe("SUBSCRIPTION_INACTIVE");
      expect(expired.features).toEqual(["platformcore.dashboard", "platformcore.profile"]);
    });
  });

  describe("surcharges", () => {
    it("GRANT avec motif et expiration : feature accordée, puis retirée à l'expiration (horloge)", async () => {
      const op = operatorFor(A.tenantId);
      const expiresAt = new Date(clock.now().getTime() + 7 * DAY).toISOString();
      const r = await setFeatureOverride(deps, op, "academic.ue-ecue", { effect: "GRANT", reason: "Pilote offert 7 jours", expiresAt });
      expect(r.ok && r.value).toMatchObject({ effect: "GRANT", reason: "Pilote offert 7 jours", createdBy: op.userId });

      let e = await entitlementsOf(A.tenantId);
      expect(e.features).toContain("academic.ue-ecue");
      expect(e.sources["academic.ue-ecue"]).toBe("OVERRIDE");
      expect(e.validUntil?.toISOString()).toBe(expiresAt);

      const later = new ManualClock(clock.now());
      later.advance(7 * DAY);
      e = await new PgEntitlementsReader(db.tenantDb, later).getEntitlements(A.tenantId);
      expect(e.features).not.toContain("academic.ue-ecue");

      expect((await removeFeatureOverride(deps, op, "academic.ue-ecue")).ok).toBe(true);
    });

    it("DENY retire une feature du plan ; supprimer la surcharge la rétablit ; événements dans les deux cas", async () => {
      const op = operatorFor(A.tenantId);
      await setFeatureOverride(deps, op, "finance.online-payment", { effect: "DENY", reason: "Suspension du paiement en ligne" });
      expect((await entitlementsOf(A.tenantId)).features).not.toContain("finance.online-payment");

      const removed = await removeFeatureOverride(deps, op, "finance.online-payment");
      expect(removed.ok).toBe(true);
      expect((await entitlementsOf(A.tenantId)).features).toContain("finance.online-payment");

      const events = (
        await raw("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'entitlements.override.changed' ORDER BY id", [A.tenantId])
      ).map((r) => EntitlementsOverrideChangedPayloadSchema.parse(r.payload));
      const last2 = events.slice(-2);
      expect(last2.map((p) => [p.featureKey, p.effect, p.previousEffect])).toEqual([
        ["finance.online-payment", "DENY", null],
        ["finance.online-payment", null, "DENY"],
      ]);
    });

    it("une seule surcharge par (tenant, feature) : la seconde remplace la première", async () => {
      const op = operatorFor(A.tenantId);
      await setFeatureOverride(deps, op, "finance.receipts", { effect: "DENY", reason: "Premier motif" });
      await setFeatureOverride(deps, op, "finance.receipts", { effect: "GRANT", reason: "Second motif" });
      const list = await listFeatureOverrides(deps, op);
      const mine = list.ok ? list.value.filter((o) => o.featureKey === "finance.receipts") : [];
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ effect: "GRANT", reason: "Second motif" });
      await removeFeatureOverride(deps, op, "finance.receipts");
    });

    it("validations : motif trop court, expiration passée, feature inconnue ou retirée, suppression d'une surcharge inexistante", async () => {
      const op = operatorFor(A.tenantId);
      const short = await setFeatureOverride(deps, op, "academic.ue-ecue", { effect: "GRANT", reason: "ok" });
      expect(!short.ok && short.error.code).toBe("VALIDATION_FAILED");

      const past = await setFeatureOverride(deps, op, "academic.ue-ecue", { effect: "GRANT", reason: "Expiration déjà passée", expiresAt: "2020-01-01T00:00:00.000Z" });
      expect(issue(past)).toBe("entitlements.override_expiry_past");

      const unknown = await setFeatureOverride(deps, op, "ghost.feature", { effect: "GRANT", reason: "Feature inexistante" });
      expect(!unknown.ok && unknown.error.code).toBe("entitlements.feature_not_found");

      const bad = await setFeatureOverride(deps, op, "PasUneCle", { effect: "GRANT", reason: "Clé invalide ici" });
      expect(!bad.ok && bad.error.code).toBe("VALIDATION_FAILED");

      const nothing = await removeFeatureOverride(deps, op, "finance.receipts");
      expect(!nothing.ok && nothing.error.code).toBe("entitlements.override_not_found");
    });

    it("la base impose un motif d'au moins 5 caractères et un effet GRANT/DENY", async () => {
      const ctx = createSystemContext(A.tenantId);
      await expect(
        db.tenantDb.run(ctx, (tx) =>
          tx.query("INSERT INTO entitlements.tenant_feature_overrides (tenant_id, feature_key, effect, reason) VALUES ($1, 'academic.ue-ecue', 'GRANT', 'x')", [A.tenantId]),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.tenantDb.run(ctx, (tx) =>
          tx.query("INSERT INTO entitlements.tenant_feature_overrides (tenant_id, feature_key, effect, reason) VALUES ($1, 'academic.ue-ecue', 'MAYBE', 'motif valide')", [A.tenantId]),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("suspension : un tenant suspendu n'a que les features CORE", () => {
    it("suspendre via tenancy coupe tout (abonnement actif, plan, packs, GRANT) ; réactiver rétablit", async () => {
      const t = await provision("suspendu", ["PRIMARY"]);
      const op = operatorFor(t.tenantId);
      await setSubscription(deps, op, { planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE" });
      await setFeatureOverride(deps, op, "academic.ue-ecue", { effect: "GRANT", reason: "Pilote accordé" });
      const before = await entitlementsOf(t.tenantId);
      expect(before.features).toEqual(
        ["academic.ue-ecue", "finance.online-payment", "finance.receipts", "platformcore.dashboard", "platformcore.profile"],
      );

      const s = await setTenantStatus({ db: db.tenantDb, clock }, op, { status: "suspended", reason: "Impayé" });
      expect(s.ok).toBe(true);
      const suspended = await entitlementsOf(t.tenantId);
      expect(suspended.reason).toBe("TENANT_SUSPENDED");
      expect(suspended.features).toEqual(["platformcore.dashboard", "platformcore.profile"]);

      await setTenantStatus({ db: db.tenantDb, clock }, op, { status: "active" });
      expect((await entitlementsOf(t.tenantId)).features).toEqual(before.features);
    });

    it("l'événement tenancy.tenant.status_changed invalide le cache d'un autre process", async () => {
      const t = await provision("suspendu-cache", ["PRIMARY"]);
      const op = operatorFor(t.tenantId);
      await setSubscription(deps, op, { planKey: "STARTER", packs: ["PRIMARY"], status: "ACTIVE" });
      const cache = new CachedEntitlementsReader(new PgEntitlementsReader(db.tenantDb, clock), { clock, ttlMs: 600_000 });

      expect((await cache.getEntitlements(t.tenantId)).reason).toBe("OK");
      await setTenantStatus({ db: db.tenantDb, clock }, op, { status: "suspended" });
      // Sans événement : le cache (TTL long) sert encore l'ancien état...
      expect((await cache.getEntitlements(t.tenantId)).reason).toBe("OK");
      // ... l'événement relayé par l'outbox l'invalide.
      const event = (
        await raw("SELECT id, type, tenant_id, payload, version, occurred_at FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.tenant.status_changed'", [t.tenantId])
      )[0];
      const bus = new InMemoryEventBus();
      cache.bindToBus(bus);
      await bus.publish({
        id: event.id, type: event.type, version: event.version, tenantId: event.tenant_id,
        occurredAt: event.occurred_at.toISOString(), payload: event.payload,
      } as DomainEvent);
      expect((await cache.getEntitlements(t.tenantId)).reason).toBe("TENANT_SUSPENDED");
    });

    it("tenant inconnu : NotFound (pas de droits fabriqués)", async () => {
      const ghost = newId();
      await expect(
        db.tenantDb.run(createSystemContext(ghost), (tx) => resolveEntitlements(tx, ghost, clock)),
      ).rejects.toMatchObject({ code: "entitlements.tenant_not_found" });
    });

    it("transaction ouverte pour un autre tenant : refus explicite", async () => {
      await expect(
        db.tenantDb.run(createSystemContext(A.tenantId), (tx) => resolveEntitlements(tx, B.tenantId, clock)),
      ).rejects.toMatchObject({ code: "entitlements.tenant_mismatch" });
    });

    it("hasFeature (API publique)", async () => {
      const ctx = createSystemContext(A.tenantId);
      expect(await db.tenantDb.run(ctx, (tx) => hasFeature(tx, A.tenantId, "finance.online-payment", clock))).toBe(true);
      expect(await db.tenantDb.run(ctx, (tx) => hasFeature(tx, A.tenantId, "academic.ue-ecue", clock))).toBe(false);
    });
  });

  describe("usage", () => {
    it("modes d'agrégation par défaut : pic d'apprenants, jauge de stockage, cumul de SMS", async () => {
      const ctx = asTenant(A.tenantId);
      for (const amount of [120, 150, 90]) await recordUsage(deps, ctx, { metric: "ACTIVE_LEARNERS", amount });
      for (const amount of [1000, 4000, 2500]) await recordUsage(deps, ctx, { metric: "STORAGE_BYTES", amount });
      for (const amount of [10, 5, 7]) await recordUsage(deps, ctx, { metric: "SMS_SENT", amount });

      const usage = await getUsage(deps, ctx, { from: "2026-10", to: "2026-10" });
      expect(usage.ok && usage.value.map((u) => [u.metric, u.period, u.value])).toEqual([
        ["ACTIVE_LEARNERS", "2026-10-01", 150],
        ["SMS_SENT", "2026-10-01", 22],
        ["STORAGE_BYTES", "2026-10-01", 2500],
      ]);
    });

    it("mode explicite et changement de mois (UTC) : une nouvelle ligne par période", async () => {
      const ctx = asTenant(A.tenantId);
      const nextMonth = new ManualClock("2026-11-01T00:00:00.000Z");
      const dep2 = { ...deps, clock: nextMonth };
      await recordUsage(dep2, ctx, { metric: "SMS_SENT", amount: 3 });
      await recordUsage(dep2, ctx, { metric: "SMS_SENT", amount: 100, mode: "SET" });

      const all = await getUsage(deps, ctx, { from: "2026-10", to: "2026-11", metric: "SMS_SENT" });
      expect(all.ok && all.value.map((u) => [u.period, u.value])).toEqual([
        ["2026-10-01", 22],
        ["2026-11-01", 100],
      ]);
      // Par défaut : 12 mois glissants jusqu'au mois courant (octobre 2026 pour `clock`).
      const dflt = await getUsage(deps, ctx);
      expect(dflt.ok && dflt.value.every((u) => u.period <= "2026-10-01")).toBe(true);
    });

    it("le compteur ne dépasse pas les entiers sûrs et refuse les montants négatifs ou fractionnaires", async () => {
      const ctx = asTenant(A.tenantId);
      for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"]) {
        const r = await recordUsage(deps, ctx, { metric: "SMS_SENT", amount });
        expect(r.ok, String(amount)).toBe(false);
      }
      const unknownMetric = await recordUsage(deps, ctx, { metric: "COFFEES", amount: 1 });
      expect(unknownMetric.ok).toBe(false);
      const badPeriod = await getUsage(deps, ctx, { from: "2026-13" });
      expect(badPeriod.ok).toBe(false);
      const inverted = await getUsage(deps, ctx, { from: "2026-10", to: "2026-01" });
      expect(issue(inverted)).toBe("entitlements.period_invalid");
    });

    it("l'usage de A est invisible de B", async () => {
      const usageB = await getUsage(deps, asTenant(B.tenantId), { from: "2026-01", to: "2026-12" });
      expect(usageB.ok && usageB.value).toEqual([]);
    });
  });

  describe("isolation entre les deux tenants provisionnés", () => {
    it("abonnements, surcharges et usage : chacun ne voit que les siens", async () => {
      const subA = await getSubscription(deps, asTenant(A.tenantId));
      const subB = await getSubscription(deps, asTenant(B.tenantId));
      expect(subA.ok && subA.value?.tenantId).toBe(A.tenantId);
      expect(subB.ok && subB.value?.tenantId).toBe(B.tenantId);
      expect(subA.ok && subB.ok && subA.value?.id).not.toBe(subB.ok && subB.value?.id);

      // Pose une surcharge pour A et vérifie que B n'en voit aucune.
      await setFeatureOverride(deps, operatorFor(A.tenantId), "academic.ue-ecue", { effect: "GRANT", reason: "Réservé à A" });
      const listB = await listFeatureOverrides(deps, asTenant(B.tenantId));
      expect(listB.ok && listB.value).toEqual([]);
      const eB = await entitlementsOf(B.tenantId);
      expect(eB.sources["academic.ue-ecue"]).toBe("PACK"); // B a HIGHER : par son pack, pas par la surcharge de A
      await removeFeatureOverride(deps, operatorFor(A.tenantId), "academic.ue-ecue");
    });

    it("SQL direct : B ne peut ni lire, ni modifier, ni supprimer les lignes de A, ni écrire au nom de A", async () => {
      const b = asTenant(B.tenantId);
      for (const table of ["tenant_subscriptions", "tenant_feature_overrides", "usage_counters"]) {
        const seen = await db.tenantDb.run(b, (tx) => tx.many(`SELECT tenant_id FROM entitlements.${table} WHERE tenant_id = $1`, [A.tenantId]));
        expect(seen, table).toEqual([]);
      }
      const upd = await db.tenantDb.run(b, (tx) => tx.query("UPDATE entitlements.tenant_subscriptions SET status = 'CANCELED' WHERE tenant_id = $1", [A.tenantId]));
      expect(upd.rowCount).toBe(0);
      const del = await db.tenantDb.run(b, (tx) => tx.query("DELETE FROM entitlements.tenant_feature_overrides WHERE tenant_id = $1", [A.tenantId]));
      expect(del.rowCount).toBe(0);
      await expect(
        db.tenantDb.run(b, (tx) =>
          tx.query("INSERT INTO entitlements.tenant_subscriptions (tenant_id, plan_key, status) VALUES ($1, 'ENTERPRISE', 'ACTIVE')", [A.tenantId]),
        ),
      ).rejects.toThrow(/row-level security|sécurité au niveau ligne/i);
      // A est intact.
      const subA = await getSubscription(deps, asTenant(A.tenantId));
      expect(subA.ok && subA.value?.planKey).toBe("PROFESSIONAL");
    });

    it("une opération super-admin sur le tenant X n'agit que sur X", async () => {
      const before = await getSubscription(deps, asTenant(B.tenantId));
      await setSubscription(deps, operatorFor(A.tenantId), { planKey: "ENTERPRISE", packs: ["PRIMARY"], status: "ACTIVE" });
      const after = await getSubscription(deps, asTenant(B.tenantId));
      expect(after.ok && after.value).toEqual(before.ok && before.value);
      await setSubscription(deps, operatorFor(A.tenantId), { planKey: "PROFESSIONAL", packs: ["PRIMARY", "SECONDARY"], status: "ACTIVE" });
    });

    it("test d'isolation générique (assertTenantIsolation) sur entitlements ET tenancy", async () => {
      // Une feature existante sert de parent aux surcharges fabriquées par le test.
      const report = await assertTenantIsolation({
        pool: db.appPool,
        schemas: ["entitlements", "tenancy"],
        allowlist: [...ENTITLEMENTS_ISOLATION_ALLOWLIST, ...TENANCY_ISOLATION_ALLOWLIST].map((e) => e.key),
        fixtures: {
          "entitlements.tenant_subscriptions": { plan_key: "STARTER", status: "ACTIVE" },
          "entitlements.tenant_feature_overrides": { feature_key: "academic.ue-ecue", effect: "GRANT", reason: "Motif de test" },
          "entitlements.usage_counters": { metric: "SMS_SENT", period: "2026-10-01" },
          "tenancy.tenant_profiles": { country_code: "CI" },
          "tenancy.institutions": { code: (n: number) => `iso-${n}`, pack: "PRIMARY", country_code: "CI" },
          "tenancy.campuses": { code: (n: number) => `iso-${n}` },
          "tenancy.onboarding_steps": { step_key: "ACCOUNT" },
        },
      });
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      expect(report.allowlisted.sort()).toEqual(
        [
          "entitlements.features",
          "entitlements.packs",
          "entitlements.plan_features",
          "entitlements.plans",
          "tenancy.country_profiles",
        ].sort(),
      );
      expect(report.behavioural).toEqual(
        expect.arrayContaining([
          "entitlements.tenant_subscriptions",
          "entitlements.tenant_feature_overrides",
          "entitlements.usage_counters",
        ]),
      );
      expect(report.structuralOnly).toEqual([]);
    });

    it("sans liste blanche, les tables globales du catalogue sont signalées (le test d'isolation ne les laisse pas passer)", async () => {
      await expect(assertTenantIsolation({ pool: db.appPool, schemas: ["entitlements"] })).rejects.toThrow(/entitlements\.plans/);
    });
  });

  describe("droits SQL", () => {
    it("le rôle applicatif ne peut supprimer ni plan, ni feature, ni pack, ni abonnement, ni compteur", async () => {
      const ctx = createSystemContext(A.tenantId);
      for (const table of ["plans", "features", "packs", "tenant_subscriptions", "usage_counters"]) {
        await expect(db.tenantDb.run(ctx, (tx) => tx.query(`DELETE FROM entitlements.${table}`)), table).rejects.toMatchObject({ code: "42501" });
      }
    });

    it("contraintes : statut d'abonnement, packs hors liste, pack CORE interdit à l'abonnement, période hors mois", async () => {
      const ctx = createSystemContext(B.tenantId);
      const attempt = (sql: string, params: unknown[] = []) => db.tenantDb.run(ctx, (tx) => tx.query(sql, params));
      await expect(attempt("INSERT INTO entitlements.tenant_subscriptions (tenant_id, plan_key, status) VALUES ($1, 'STARTER', 'GRATUIT')", [B.tenantId])).rejects.toMatchObject({ code: "23514" });
      await expect(attempt("INSERT INTO entitlements.tenant_subscriptions (tenant_id, plan_key, status, packs) VALUES ($1, 'STARTER', 'CANCELED', ARRAY['CORE'])", [B.tenantId])).rejects.toMatchObject({ code: "23514" });
      await expect(attempt("INSERT INTO entitlements.usage_counters (tenant_id, metric, period, value) VALUES ($1, 'SMS_SENT', '2026-10-15', 1)", [B.tenantId])).rejects.toMatchObject({ code: "23514" });
      await expect(attempt("INSERT INTO entitlements.usage_counters (tenant_id, metric, period, value) VALUES ($1, 'SMS_SENT', '2026-10-01', -1)", [B.tenantId])).rejects.toMatchObject({ code: "23514" });
    });
  });
});
