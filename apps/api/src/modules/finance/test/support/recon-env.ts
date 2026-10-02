/**
 * Environnement des tests de rapprochement et de remboursement réel : Postgres réel, serveurs HTTP simulés des cinq
 * fournisseurs (délai court pour provoquer des « délais dépassés »), un registre de fournisseurs configuré PAR TENANT,
 * des dépendances de finance avec horloge manuelle, audit enregistré, alertes et compteurs capturés.
 */
import { ManualClock, newId, unwrap } from "@ecoledigitale/kernel";
import { createFinanceDeps, type FinanceConfig, type FinanceDeps, type ReconciliationConfig } from "../../application/deps";
import type { FinanceAlert, FinanceAlertPort, FinanceMetricsPort } from "../../application/ports/operations";
import { RecordingAudit, type AuditPort } from "../../application/ports/audit";
import { InMemoryEnrollmentDirectory } from "../../application/ports/directories";
import { initiateOnlinePayment } from "../../application/online-payments";
import { registerPaymentProviders } from "../../infrastructure/providers/definitions";
import { createProviderRegistry, StaticProviderConfigSource, type ProviderRegistry } from "../../infrastructure/providers/registry";
import { PHONE, testRuntime } from "./adapters";
import { adminRows, AUDIT_MIGRATIONS_DIR, createFinanceTestDb, ctxFor, type FinanceTestDb } from "./db";
import { createHarnesses, xof, type ProviderHarness } from "./harness";
import type { MtnMock, OrangeMock, TresorPayMock, WaveMock } from "./mock-providers";
import { learnerId, nextKey, seedCatalog, simpleInvoice } from "./scenario";

export const FAST_RECONCILIATION: Partial<ReconciliationConfig> = {
  minAgeMs: 60_000,
  maxAttempts: 4,
  backoffBaseMs: 60_000,
  backoffMaxMs: 600_000,
  leaseMs: 120_000,
  batchSize: 20,
};

export interface ReconEnv {
  readonly db: FinanceTestDb;
  readonly harnesses: ProviderHarness[];
  readonly source: StaticProviderConfigSource;
  readonly providers: ProviderRegistry;
  harness(name: string): ProviderHarness;
  readonly wave: WaveMock;
  readonly mtn: MtnMock;
  readonly orange: OrangeMock;
  readonly tresor: TresorPayMock;
  /** Nouveau tenant avec les cinq fournisseurs activés et le catalogue de test. */
  newTenant(): Promise<string>;
  /** Dépendances neuves (horloge manuelle propre, audit enregistré, alertes et compteurs capturés). */
  makeDeps(options?: { reconciliation?: Partial<ReconciliationConfig>; config?: Partial<Omit<FinanceConfig, "reconciliation">>; audit?: AuditPort; providers?: ProviderRegistry }): TestDeps;
  stop(): Promise<void>;
}

export interface TestDeps {
  readonly deps: FinanceDeps;
  readonly clock: ManualClock;
  readonly audit: RecordingAudit;
  readonly alerts: FinanceAlert[];
  readonly counters: Array<{ name: string; value: number; labels: Record<string, string> }>;
}

export async function createReconEnv(options: { timeoutMs?: number; withAudit?: boolean } = {}): Promise<ReconEnv> {
  const db = await createFinanceTestDb(16, options.withAudit ? [AUDIT_MIGRATIONS_DIR] : []);
  const harnesses = await createHarnesses();
  const source = new StaticProviderConfigSource();
  const endpoints: Record<string, { production: string; sandbox: string }> = {};
  for (const h of harnesses) {
    const url = h.name === "tresorpay" ? `${h.mock.url}/v1` : h.mock.url;
    endpoints[h.name] = { production: url, sandbox: url };
  }
  const providers = createProviderRegistry({ environment: "test", configSource: source });
  // Délai court : un « délai dépassé » coûte 300 ms, pas 15 s.
  registerPaymentProviders(providers, testRuntime(endpoints, { timeoutMs: options.timeoutMs ?? 300 }));
  const harness = (name: string): ProviderHarness => harnesses.find((h) => h.name === name)!;

  return {
    db,
    harnesses,
    source,
    providers,
    harness,
    wave: harness("wave").mock as WaveMock,
    mtn: harness("mtn_momo").mock as MtnMock,
    orange: harness("orange_money").mock as OrangeMock,
    tresor: harness("tresorpay").mock as TresorPayMock,
    async newTenant() {
      const tenantId = await db.createTenant();
      for (const h of harnesses) source.set(tenantId, h.name, { ...h.settings, enabled: "true" });
      const t = makeDepsOn(db, providers, {});
      await seedCatalog(t.deps, ctxFor(tenantId));
      return tenantId;
    },
    makeDeps: (o = {}) => makeDepsOn(db, o.providers ?? providers, o),
    async stop() {
      await Promise.all(harnesses.map((h) => h.stop()));
      await db.drop();
    },
  };
}

function makeDepsOn(
  db: FinanceTestDb,
  providers: ProviderRegistry,
  o: { reconciliation?: Partial<ReconciliationConfig>; config?: Partial<Omit<FinanceConfig, "reconciliation">>; audit?: AuditPort },
): TestDeps {
  const clock = new ManualClock("2025-09-01T08:00:00.000Z");
  const audit = new RecordingAudit();
  const alerts: FinanceAlert[] = [];
  const counters: TestDeps["counters"] = [];
  const alertPort: FinanceAlertPort = { raise: (a) => void alerts.push(a) };
  const metrics: FinanceMetricsPort = { count: (name, value = 1, labels = {}) => void counters.push({ name, value, labels: { ...labels } }) };
  const deps = createFinanceDeps({
    db: db.tenantDb,
    clock,
    audit: o.audit ?? audit,
    providers,
    enrollments: new InMemoryEnrollmentDirectory(),
    alerts: alertPort,
    metrics,
    config: { environment: "test", webhookBaseUrl: "https://api.test.local", reconciliation: { ...FAST_RECONCILIATION, ...o.reconciliation }, ...o.config },
  });
  return { deps, clock, audit, alerts, counters };
}

/** Démarre un paiement en ligne chez `provider` (facture simple de 100 000, paiement de `amount`). */
export async function startOnline(t: TestDeps, tenantId: string, provider: string, amount = 25_000) {
  const ctx = ctxFor(tenantId);
  const learner = learnerId();
  const invoice = await simpleInvoice(t.deps, ctx, learner, 100_000);
  const key = nextKey(`rec-${provider}`);
  const result = await initiateOnlinePayment(t.deps, ctx, {
    idempotencyKey: key,
    learnerId: learner,
    amount: xof(amount),
    provider,
    invoiceId: invoice.invoice.id,
    payer: { name: "Awa Koné", email: "awa@example.test", phoneNumber: PHONE },
    returnUrl: "https://app.example.test/retour",
  });
  return { ctx, learner, invoice: invoice.invoice, key, result };
}

/** Identifiant et état d'un paiement lu hors RLS (superuser). */
export async function paymentByKey(db: FinanceTestDb, key: string) {
  const [row] = await adminRows<{ id: string; status: string; provider_ref: string | null; provider_status: string | null; failure_reason: string | null }>(
    db,
    "SELECT id, status, provider_ref, provider_status, failure_reason FROM finance.payments WHERE idempotency_key = $1",
    [key],
  );
  return row!;
}

export const paymentRow = async (db: FinanceTestDb, id: string) =>
  (await adminRows<{ status: string; provider_ref: string | null; refunded_amount: string; allocated_amount: string }>(db, "SELECT status, provider_ref, refunded_amount::text, allocated_amount::text FROM finance.payments WHERE id = $1", [id]))[0]!;

export const stateRow = async (db: FinanceTestDb, paymentId: string) =>
  (await adminRows<{ attempts: number; flagged_at: Date | null; flag_reason: string | null; resolved_at: Date | null; last_outcome: string | null; last_error_code: string | null; next_attempt_at: Date }>(
    db,
    "SELECT attempts, flagged_at, flag_reason, resolved_at, last_outcome, last_error_code, next_attempt_at FROM finance.reconciliation_state WHERE payment_id = $1",
    [paymentId],
  ))[0];

export const refundStateRow = async (db: FinanceTestDb, refundId: string) =>
  (await adminRows<{ attempts: number; flagged_at: Date | null; flag_reason: string | null; resolved_at: Date | null; last_outcome: string | null }>(
    db,
    "SELECT attempts, flagged_at, flag_reason, resolved_at, last_outcome FROM finance.reconciliation_state WHERE refund_id = $1",
    [refundId],
  ))[0];

export const eventsOf = (db: FinanceTestDb, type: string, key: "paymentId" | "refundId", id: string) =>
  adminRows<{ payload: Record<string, unknown> }>(db, `SELECT payload FROM kernel.domain_events WHERE type = $1 AND payload->>'${key}' = $2`, [type, id]);

export const receiptsOf = (db: FinanceTestDb, paymentId: string) => adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [paymentId]);

export { newId, unwrap };
