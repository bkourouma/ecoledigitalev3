/**
 * Le VRAI job du worker (`jobs.ts` : `finance.reconcile-pending-payments`) avec le vrai journal d'audit chaîné (migrations du
 * module `audit`), les ressources du processus (registre, alertes, compteurs) et des serveurs de fournisseurs simulés.
 * Prouve le câblage de bout en bout : définition du job, assemblage des dépendances, audit HMAC dans la transaction de
 * l'effet, idempotence d'un second passage, tenant en échec signalé sans arrêter les autres.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import type { GlobalScheduledJob } from "@ecoledigitale/worker/sdk";
import jobs from "../../jobs";
import { setFinanceWorkerResources, resetFinanceWorkerResources } from "../../application/worker-resources";
import type { FinanceAlert } from "../../application/ports/operations";
import { adminRows, describeIntegration } from "../support/db";
import { createReconEnv, paymentByKey, paymentRow, receiptsOf, startOnline, type ReconEnv } from "../support/recon-env";

const RECONCILE = "finance.reconcile-pending-payments";

describeIntegration("job du worker finance.reconcile-pending-payments (module jobs.ts, audit réel)", () => {
  let env: ReconEnv;
  const previousKey = process.env.AUDIT_HMAC_KEY;

  beforeAll(async () => {
    process.env.AUDIT_HMAC_KEY = randomBytes(24).toString("hex");
    env = await createReconEnv({ withAudit: true });
  });
  afterAll(async () => {
    await env.stop();
    if (previousKey === undefined) delete process.env.AUDIT_HMAC_KEY;
    else process.env.AUDIT_HMAC_KEY = previousKey;
  });
  afterEach(() => resetFinanceWorkerResources());

  const job = (): GlobalScheduledJob => {
    const def = (jobs as unknown as Array<{ name: string }>).find((j) => j.name === RECONCILE);
    expect(def, "job découvert").toBeDefined();
    return def as unknown as GlobalScheduledJob;
  };
  const run = () => job().handler({ name: RECONCILE, logger: noopLogger, systemDb: env.db.systemDb, tenantDb: env.db.tenantDb });

  it("déclaré avec les autres jobs du module : toutes les 2 minutes, global (il boucle lui-même sur les tenants), verrou borné", () => {
    const names = (jobs as unknown as Array<{ name: string }>).map((j) => j.name).sort();
    expect(names).toEqual(["finance.mark-overdue-invoices", RECONCILE]);
    expect(job().cron).toBe("*/2 * * * *");
    expect(job().perTenant).toBeFalsy();
    expect(job().lockTtlMs).toBeGreaterThanOrEqual(60_000);
  });

  it("le handler confirme un paiement perdu, écrit l'audit CHAÎNÉ (HMAC) dans la transaction, publie l'événement ; un second passage ne touche rien", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps(); // horloge de test en 2025 : le paiement est « ancien » pour l'horloge réelle du worker
    const s = await startOnline(t, tenantId, "wave");
    const p = await paymentByKey(env.db, s.key);
    env.wave.complete(p.provider_ref!);
    const alerts: FinanceAlert[] = [];
    const counters: string[] = [];
    setFinanceWorkerResources({ providers: env.providers, alerts: { raise: (a) => void alerts.push(a) }, metrics: { count: (name, _v, labels) => void counters.push(`${name}:${labels?.outcome}`) } });

    await run();
    expect((await paymentRow(env.db, p.id)).status).toBe("CONFIRMED");
    expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
    expect(counters).toContain("finance_reconciliation_total:confirmed");
    const audited = await adminRows<{ action: string; seq: string; hash: string; prev_hash: string; hash_alg: string }>(
      env.db,
      "SELECT action, seq::text, hash, prev_hash, hash_alg FROM audit.audit_log WHERE tenant_id = $1 ORDER BY seq",
      [tenantId],
    );
    expect(audited.map((a) => a.action)).toContain("finance.payment.completed");
    expect(audited.every((a, i) => Number(a.seq) === i + 1)).toBe(true); // chaîne sans trou
    expect(audited.every((a) => /^[0-9a-f]{64}$/.test(a.hash))).toBe(true);
    expect(audited.every((a, i) => i === 0 || a.prev_hash === audited[i - 1]!.hash)).toBe(true); // chaînée
    expect(audited.every((a) => a.hash_alg === "hmac-sha256")).toBe(true); // même clé HMAC que l'API
    const events = await adminRows(env.db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.payment.completed' AND payload->>'paymentId' = $1", [p.id]);
    expect(events).toHaveLength(1);

    const before = audited.length;
    await run();
    expect(await receiptsOf(env.db, p.id)).toHaveLength(1);
    const after = await adminRows(env.db, "SELECT 1 FROM audit.audit_log WHERE tenant_id = $1", [tenantId]);
    expect(after).toHaveLength(before);
    expect(alerts).toEqual([]);
  });

  it("un paiement indéterminé est signalé par le job : événement + audit sensible dans le journal réel + alerte ; le job réussit (rien à rejouer)", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps();
    env.orange.loseNextResponses(1, (r) => r.path.endsWith("/webpayment"));
    const s = await startOnline(t, tenantId, "orange_money");
    const p = await paymentByKey(env.db, s.key);
    const alerts: FinanceAlert[] = [];
    setFinanceWorkerResources({ providers: env.providers, alerts: { raise: (a) => void alerts.push(a) } });
    await run();
    expect((await paymentRow(env.db, p.id)).status).toBe("PENDING");
    expect(alerts.map((a) => [a.code, a.reason, a.tenantId])).toEqual([["finance.payment.reconciliation_needed", "unverifiable_no_provider_ref", tenantId]]);
    const audited = await adminRows<{ action: string; severity: string }>(env.db, "SELECT action, severity FROM audit.audit_log WHERE tenant_id = $1 AND action = 'finance.payment.reconciliation_needed'", [tenantId]);
    expect(audited).toHaveLength(1);
    expect(audited[0]!.severity).toBe("notice"); // sensible
    await run();
    expect(alerts).toHaveLength(1); // jamais deux alertes pour le même signalement
  });

  it("un tenant en échec ne bloque pas les autres : le job le signale (erreur) APRÈS avoir traité tous les tenants", async () => {
    const good = await env.newTenant();
    const broken = await env.newTenant();
    const t = env.makeDeps();
    const s = await startOnline(t, good, "wave");
    const p = await paymentByKey(env.db, s.key);
    env.wave.complete(p.provider_ref!);
    const bad = await startOnline(t, broken, "wave");
    const bp = await paymentByKey(env.db, bad.key);
    env.wave.complete(bp.provider_ref!);
    // Injection de panne : la base refuse toute prise à bail du tenant « cassé » (échec dur du passage de CE tenant seulement).
    await env.db.admin.query(`
      CREATE FUNCTION finance.test_fail_for_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.tenant_id = '${broken}'::uuid THEN RAISE EXCEPTION 'panne injectée pour le test'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_for_tenant BEFORE UPDATE ON finance.reconciliation_state
        FOR EACH ROW EXECUTE FUNCTION finance.test_fail_for_tenant();`);
    try {
      setFinanceWorkerResources({ providers: env.providers });
      await expect(run()).rejects.toThrow(/finance\.reconcile-pending-payments : 1 tenant\(s\) en échec/);
      expect((await paymentRow(env.db, p.id)).status).toBe("CONFIRMED"); // l'autre tenant a été traité malgré l'échec
      expect((await paymentRow(env.db, bp.id)).status).toBe("PENDING");
    } finally {
      await env.db.admin.query("DROP TRIGGER test_fail_for_tenant ON finance.reconciliation_state; DROP FUNCTION finance.test_fail_for_tenant();");
    }
    // Panne levée : le tenant est repris au passage suivant.
    await run();
    expect((await paymentRow(env.db, bp.id)).status).toBe("CONFIRMED");
  });
});
