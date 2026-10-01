/**
 * Le WORKER assemblé avec les modules : découverte des `subscribers.ts` / `jobs.ts` sans fichier central,
 * abonnés idempotents, cohérence des caches de l'API par diffusion Redis, jobs planifiés.
 * (Le bundle de production est éprouvé dans `worker-bundle.integration.test.ts`.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createRequestContext, createSystemContext, noopLogger, systemClock, type DomainEvent } from "@ecoledigitale/kernel";
import { scopeDb } from "../../../worker/src/scoped-db";
import { noopAudit, revokeAssignmentUseCase } from "../../src/modules/rbac";
import { provisionTenant } from "../../src/modules/tenancy";
import { setSubscription } from "../../src/modules/entitlements";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, waitFor, type Phase1Env } from "./support/harness";
import { PASSWORD, loginPlain, loginWithMfaEnrollment, provisionByConsole, redeemInvitation, type ProvisionedOwner, type Session } from "./support/scenario";

const EXPECTED_SUBSCRIBERS = [
  "audit.iam-impersonation-started",
  "audit.iam-login-failed",
  "audit.iam-session-revoked",
  "audit.rbac-role-changed",
  "audit.rbac-assignment-changed",
  "audit.tenancy",
  "audit.entitlements",
  "audit.iam-mfa",
  "audit.iam-password",
  "audit.iam-membership",
  "rbac.instantiate-system-roles",
  "rbac.reconcile-roles-on-reactivation",
  "rbac.invalidate-permission-cache.role-changed",
  "rbac.invalidate-permission-cache.assignment-changed",
  "rbac.invalidate-permission-cache.tenant-status-changed",
  "entitlements.start-trial",
  "entitlements.invalidate-cache.subscription-changed",
  "entitlements.invalidate-cache.override-changed",
  "entitlements.invalidate-cache.tenant-status-changed",
  "entitlements.invalidate-cache.tenant-provisioned",
];
const EXPECTED_JOBS = ["audit.ensure-partitions", "audit.detach-expired-partitions", "finance.mark-overdue-invoices", "iam.purge-expired-data"];

describeIntegration.skipIf(!REDIS_URL)("worker assemblé avec les modules (abonnés, diffusion Redis, jobs)", () => {
  let p: Phase1Env;
  let T: ProvisionedOwner;
  let owner: Session;

  beforeAll(async () => {
    p = await startPhase1Platform();
    T = await provisionByConsole(p, { name: "Tenant Worker", slug: "workerco", packs: ["HIGHER"], ownerEmail: "owner@workerco.test" });
    await redeemInvitation(p, T.ownerEmail);
    owner = await loginWithMfaEnrollment(p, T.ownerEmail, T.slug);
  }, 240_000);
  afterAll(async () => {
    await p?.stop();
  });

  it("[W1] découvre abonnés et jobs de tous les modules (aucun fichier central) en plus des jobs du socle", () => {
    const subscribers = p.worker.registry.all().map((s) => s.name);
    expect(subscribers).toEqual(expect.arrayContaining(EXPECTED_SUBSCRIBERS));
    const jobs = p.worker.scheduler?.jobNames ?? [];
    expect(jobs).toEqual(expect.arrayContaining([...EXPECTED_JOBS, "outbox-cleanup", "ensure-partitions"]));
    // Les motifs « préfixe » du module audit sont traduits dans la syntaxe du worker (`tenancy.**`).
    const audit = p.worker.registry.all().find((s) => s.name === "audit.tenancy");
    expect(String(audit?.pattern)).toBe("tenancy.**");
    expect(audit?.matches("tenancy.tenant.provisioned")).toBe(true);
    expect(audit?.matches("finance.payment.completed")).toBe(false);
  });

  it("[W2] un tenant provisionné SANS la console reçoit ses rôles système et son essai par les abonnés", async () => {
    const r = await provisionTenant(
      { db: p.app.v2.tenantDb, systemDb: p.app.v2.systemDb },
      { name: "Provisionné Direct", slug: "direct", countryCode: "CI", packs: ["PRIMARY", "SECONDARY"], adminContact: { name: "Aya Koné", email: "aya@direct.test" } },
      { requestedBy: p.operatorId },
    );
    expect(r.ok).toBe(true);
    const tenantId = (r as { ok: true; value: { tenantId: string } }).value.tenantId;
    await waitFor(
      async () => {
        const roles = await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [tenantId]);
        const sub = await p.db.admin.query("SELECT plan_key, status, packs FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [tenantId]);
        return roles.rows[0].n === 11 && sub.rows.length === 1 ? sub.rows[0] : false;
      },
      { label: "rôles système + abonnement d'essai créés par le worker", timeoutMs: 45_000 },
    ).then((sub) => {
      expect(sub).toMatchObject({ plan_key: "STARTER", status: "TRIALING" });
      expect([...sub.packs].sort()).toEqual(["PRIMARY", "SECONDARY"]);
    });
  });

  it("[W3] les abonnés sont IDEMPOTENTS : rejouer un événement ne crée ni doublon de rôle, d'abonnement ou d'audit", async () => {
    const row = await p.db.admin.query("SELECT * FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.tenant.provisioned'", [T.tenantId]);
    const e = row.rows[0];
    const event: DomainEvent = {
      id: e.id,
      type: e.type,
      version: e.version,
      tenantId: e.tenant_id,
      occurredAt: new Date(e.occurred_at).toISOString(),
      payload: e.payload,
      requestId: e.request_id ?? undefined,
    } as DomainEvent;
    const ctx = {
      tenantId: T.tenantId,
      db: scopeDb(p.app.v2.tenantDb, T.tenantId, "replay-0001"),
      systemDb: p.app.v2.systemDb,
      tenantDb: p.app.v2.tenantDb,
      logger: noopLogger,
      attempt: 1,
      jobId: "replay",
    };
    for (const name of ["rbac.instantiate-system-roles", "entitlements.start-trial", "audit.tenancy"]) {
      const sub = p.worker.registry.all().find((s) => s.name === name)!;
      await sub.handler(event, { ...ctx, subscriber: name });
      await sub.handler(event, { ...ctx, subscriber: name });
    }
    const roles = await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1", [T.tenantId]);
    expect(roles.rows[0].n).toBe(11);
    const subs = await p.db.admin.query("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [T.tenantId]);
    expect(subs.rows[0].n).toBe(1);
    const audits = await p.db.admin.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE tenant_id = $1 AND id = $2", [T.tenantId, e.id]);
    expect(audits.rows[0].n).toBe(1);
    const marks = await p.db.admin.query("SELECT subscriber FROM kernel.processed_events WHERE event_id = $1 ORDER BY subscriber", [e.id]);
    expect(marks.rows.map((r) => r.subscriber)).toEqual(expect.arrayContaining(["rbac.instantiate-system-roles"]));
  });

  const pay = (token: string, key: string) =>
    p.http("POST", "/api/v1/finance/payments/online", {
      token,
      headers: { "idempotency-key": key },
      body: { learnerId: "0192f0a4-7b1e-7c3a-8d2e-00000000a001", amount: 50000, provider: "sandbox" },
    });

  it("[W4] diffusion Redis : un abonnement modifié HORS du processus de l'API invalide son cache de droits en quelques secondes (pas 30 s)", async () => {
    expect((await pay(owner.accessToken, "fan-0001")).status).toBe(201); // droits calculés puis mis en cache

    // Modification par un autre « processus » : le use case est appelé sans l'invalidateur du cache de l'API.
    const ctx = createRequestContext({ tenantId: T.tenantId, userId: p.operatorId, actor: "superAdmin" });
    const downgrade = await setSubscription({ db: p.app.v2.tenantDb, systemDb: p.app.v2.systemDb }, ctx, { planKey: "STARTER", packs: [], status: "ACTIVE" });
    expect(downgrade.ok).toBe(true);

    const started = Date.now();
    let n = 0;
    await waitFor(async () => (await pay(owner.accessToken, `fan-d-${n++}`)).status === 403, { label: "la rétrogradation est vue par l'API", timeoutMs: 15_000, intervalMs: 150 });
    expect(Date.now() - started).toBeLessThan(15_000); // bien en deçà du TTL de 30 s du cache

    const restore = await setSubscription({ db: p.app.v2.tenantDb, systemDb: p.app.v2.systemDb }, ctx, { planKey: "STARTER", packs: ["HIGHER"], status: "ACTIVE" });
    expect(restore.ok).toBe(true);
    await waitFor(async () => (await pay(owner.accessToken, `fan-u-${n++}`)).status === 201, { label: "le rétablissement est vu par l'API", timeoutMs: 15_000, intervalMs: 150 });
  });

  it("[W5] diffusion Redis : une assignation révoquée hors de l'API retire l'accès (cache RBAC invalidé par événement)", async () => {
    const member = "compta@workerco.test";
    const role = await p.http("POST", "/api/v1/rbac/roles", { token: owner.accessToken, body: { label: "Lecteur rapports", permissions: ["finance.report.read"] } });
    expect(role.status).toBe(201);
    await p.http("POST", "/api/v1/iam/admin/members", { token: owner.accessToken, body: { email: member, roles: ["comptable_junior"], sendInvitation: true } });
    await redeemInvitation(p, member, PASSWORD);
    const user = await loginPlain(p, member, T.slug);
    const grant = await p.http("POST", "/api/v1/rbac/assignments", {
      token: owner.accessToken,
      body: { userId: user.identityId, roleId: role.body.id, scope: { type: "tenant" } },
    });
    expect(grant.status).toBe(201);
    expect((await p.http("GET", "/api/v1/finance/reports/summary", { token: user.accessToken })).status).toBe(200); // mis en cache

    const sys = createSystemContext(T.tenantId);
    const revoked = await p.app.v2.tenantDb.run(sys, (tx) =>
      revokeAssignmentUseCase({ tx, clock: systemClock, outbox: new PgOutboxWriter(tx), audit: noopAudit, logger: noopLogger }, sys, grant.body.id),
    );
    expect(revoked.ok).toBe(true);
    await waitFor(async () => (await p.http("GET", "/api/v1/finance/reports/summary", { token: user.accessToken })).status === 403, {
      label: "l'API ne sert plus le droit révoqué",
      timeoutMs: 15_000,
      intervalMs: 150,
    });
  });

  it("[W6] job finance.mark-overdue-invoices : une facture échue passe en retard UNE seule fois (événement unique)", async () => {
    const fee = await p.http("POST", "/api/v1/finance/fees", { token: owner.accessToken, body: { code: "FRAIS-RETARD", name: "Frais échu", category: "OTHER" } });
    await p.http("POST", "/api/v1/finance/fee-schedules", { token: owner.accessToken, body: { feeId: fee.body.id, academicYear: "2019-2020", amount: 80000, effectiveFrom: "2018-01-01" } });
    const inv = await p.http("POST", "/api/v1/finance/invoices/from-schedule", {
      token: owner.accessToken,
      headers: { "idempotency-key": "inv-late-0001" },
      body: { learnerId: "0192f0a4-7b1e-7c3a-8d2e-00000000a222", academicYear: "2019-2020", items: [{ feeCode: "FRAIS-RETARD" }], dueDate: "2999-01-31", issue: true },
    });
    expect(inv.status, JSON.stringify(inv.body)).toBeLessThan(300);
    const invoiceId = inv.body.invoices[0].id as string;
    expect(inv.body.invoices[0].status).toBe("ISSUED");
    // Le temps passe (échéance dépassée) sans qu'aucune requête ne le constate : c'est le job qui le fait.
    await p.db.admin.query("UPDATE finance.installments SET due_date = '2020-01-31' WHERE tenant_id = $1 AND invoice_id = $2", [T.tenantId, invoiceId]);
    await p.db.admin.query("UPDATE finance.invoices SET due_date = '2020-01-31' WHERE tenant_id = $1 AND id = $2", [T.tenantId, invoiceId]);

    const first = await p.worker.scheduler!.run("finance.mark-overdue-invoices", "t-1");
    expect(first.status).toBe("completed");
    const after = await p.http("GET", `/api/v1/finance/invoices/${invoiceId}`, { token: owner.accessToken });
    expect(after.body.status).toBe("OVERDUE");
    const count = async () =>
      (await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'finance.invoice.overdue' AND aggregate_id = $2", [T.tenantId, invoiceId])).rows[0].n;
    expect(await count()).toBe(1);
    await p.worker.scheduler!.run("finance.mark-overdue-invoices", "t-2");
    expect(await count()).toBe(1);
  });

  it("[W7] jobs audit et iam : partitions créées à l'avance, détachement en SIMULATION, purge des sessions", async () => {
    expect((await p.worker.scheduler!.run("audit.ensure-partitions", "t-3")).status).toBe("completed");
    const parts = await p.db.admin.query("SELECT count(*)::int AS n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhparent WHERE c.relname = 'audit_log'");
    expect(parts.rows[0].n).toBeGreaterThanOrEqual(12);
    const before = parts.rows[0].n;
    expect((await p.worker.scheduler!.run("audit.detach-expired-partitions", "t-4")).status).toBe("completed");
    const afterDetach = await p.db.admin.query("SELECT count(*)::int AS n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhparent WHERE c.relname = 'audit_log'");
    expect(afterDetach.rows[0].n).toBe(before); // simulation : rien n'est détaché sans AUDIT_DETACH_MODE=apply
    expect((await p.worker.scheduler!.run("iam.purge-expired-data", "t-5")).status).toBe("completed");
  });
});
