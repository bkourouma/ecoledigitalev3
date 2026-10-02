import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { assertTenantIsolation, migrate } from "@ecoledigitale/database";
import { noopLogger, newId } from "@ecoledigitale/kernel";
import { BASELINE_DIR, WORKER_MIGRATIONS_DIR, createTestEnv, describeIntegration, writeEvents, sleep, type TestEnv } from "./helpers";

describeIntegration("migrations du worker (runner de @ecoledigitale/database)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv(2);
  });
  afterAll(async () => {
    await env.drop();
  });

  it("sont idempotentes, dans la plage 0600-0699, et suivies dans la table partagée (checksum)", async () => {
    const again = await migrate({
      client: env.admin,
      dirs: [BASELINE_DIR, WORKER_MIGRATIONS_DIR],
      role: "migrator",
      logger: noopLogger,
    });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toHaveLength(7); // 3 de la baseline + 4 du worker
    const rows = await env.admin.query("SELECT version, name FROM schema_migrations WHERE version >= '0600' ORDER BY version");
    expect(rows.rows).toEqual([
      { version: "0601", name: "processed_events" },
      { version: "0602", name: "domain_events_notify" },
      { version: "0603", name: "domain_events_published_idx" },
      { version: "0604", name: "domain_events_traceparent" },
    ]);
  });

  it("kernel.processed_events : RLS forcée, test d'isolation générique au vert (domain_events inclus)", async () => {
    // Lève TenantIsolationError au moindre écart (structure + comportement A/B).
    await assertTenantIsolation({ pool: env.appPool, schemas: ["kernel"], allowlist: ["kernel.tenants"] });
    const flags = await env.admin.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'kernel.processed_events'::regclass",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("processed_events : un tenant ne voit ni ne réserve rien pour un autre ; pas d'UPDATE pour app_user", async () => {
    const [a, b] = env.tenants as [(typeof env.tenants)[0], (typeof env.tenants)[0]];
    const eventId = newId();
    await env.systemDb.runForTenant("test-processed", a.id, (tx) =>
      tx.query("INSERT INTO kernel.processed_events (tenant_id, subscriber, event_id) VALUES ($1, 'x.sub', $2)", [a.id, eventId]),
    );
    const seenByB = await env.systemDb.runForTenant("test-processed", b.id, (tx) => tx.many("SELECT * FROM kernel.processed_events"));
    expect(seenByB).toEqual([]);
    await expect(
      env.systemDb.runForTenant("test-processed", b.id, (tx) =>
        tx.query("INSERT INTO kernel.processed_events (tenant_id, subscriber, event_id) VALUES ($1, 'x.sub', $2)", [a.id, newId()]),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      env.systemDb.runForTenant("test-processed", a.id, (tx) => tx.query("UPDATE kernel.processed_events SET subscriber = 'y.sub'")),
    ).rejects.toThrow(/permission denied/i);
    // la clé (subscriber, event_id) est unique
    await expect(
      env.systemDb.runForTenant("test-processed", a.id, (tx) =>
        tx.query("INSERT INTO kernel.processed_events (tenant_id, subscriber, event_id) VALUES ($1, 'x.sub', $2)", [a.id, eventId]),
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("trigger NOTIFY : une notification par tenant du lot inséré, seulement au COMMIT", async () => {
    const listener = new Client({ connectionString: env.appUrl });
    await listener.connect();
    const received: string[] = [];
    listener.on("notification", (m) => m.payload && received.push(m.payload));
    await listener.query("LISTEN ed_domain_events");
    const [a, b] = env.tenants as [(typeof env.tenants)[0], (typeof env.tenants)[0]];

    await writeEvents(env, a, 5); // 5 événements, une instruction : UNE notification
    await writeEvents(env, b, 1);
    await sleep(300);
    expect(received.sort()).toEqual([a.id, b.id].sort());

    // Transaction annulée : aucune notification (pas d'événement fantôme).
    received.length = 0;
    const tx = new Client({ connectionString: env.appUrl });
    await tx.connect();
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [a.id]);
    await tx.query(
      "INSERT INTO kernel.domain_events (id, tenant_id, type, occurred_at) VALUES ($1, $2, 'test.thing.happened', now())",
      [newId(), a.id],
    );
    await tx.query("ROLLBACK");
    await tx.end();
    await sleep(300);
    expect(received).toEqual([]);
    await listener.end();
  });
});
