import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InMemoryEventBus,
  createDomainEvent,
  createRequestContext,
  getRequestContext,
  newId,
  noopLogger,
  type RequestContext,
} from "@ecoledigitale/kernel";
import {
  PgOutboxWriter,
  SystemDb,
  TenantDb,
  fetchPendingEvents,
  isRlsViolation,
  isUniqueViolation,
  markEventFailed,
  markEventsPublished,
} from "../src";
import { applyBaseline, createTestDb, describeIntegration, type TestDb } from "./helpers";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctx = (tenantId: string): RequestContext => createRequestContext({ tenantId, userId: USER });

describeIntegration("TenantDb / SystemDb / outbox sur Postgres réel", () => {
  let db: TestDb;
  let tdb: TenantDb;
  let sys: SystemDb;
  let appUrl: string;

  beforeAll(async () => {
    db = await createTestDb();
    await applyBaseline(db);
    await db.admin.query(`INSERT INTO kernel.tenants (id, slug, name) VALUES ($1,'ecole-a','A'), ($2,'ecole-b','B')`, [A, B]);
    await db.admin.query(`
      SET ROLE migrator;
      CREATE TABLE kernel.notes (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        body text NOT NULL UNIQUE
      );
      SELECT kernel.enable_tenant_rls('kernel.notes');
      RESET ROLE;
    `);
    appUrl = (await db.createLogin("it_app", "app_user")).url;
    tdb = new TenantDb(db.pool(appUrl, 5));
    sys = new SystemDb(tdb, { logger: noopLogger });
  });

  afterAll(async () => {
    await db?.drop();
  });

  const insertNote = (tx: { query: Function }, tenantId: string, body: string) =>
    tx.query("INSERT INTO kernel.notes (id, tenant_id, body) VALUES ($1,$2,$3)", [newId(), tenantId, body]);

  describe("transactions", () => {
    it("commit : les données sont visibles après run", async () => {
      await tdb.run(ctx(A), (tx) => insertNote(tx, A, "committed"));
      const rows = await tdb.run(ctx(A), (tx) => tx.many("SELECT body FROM kernel.notes WHERE body = 'committed'"));
      expect(rows).toHaveLength(1);
    });

    it("rollback : une exception annule tout", async () => {
      await expect(
        tdb.run(ctx(A), async (tx) => {
          await insertNote(tx, A, "doomed");
          throw new Error("échec métier");
        }),
      ).rejects.toThrow("échec métier");
      const rows = await tdb.run(ctx(A), (tx) => tx.many("SELECT 1 FROM kernel.notes WHERE body = 'doomed'"));
      expect(rows).toEqual([]);
    });

    it("une erreur SQL est relancée telle quelle (code SQLSTATE exploitable)", async () => {
      await tdb.run(ctx(A), (tx) => insertNote(tx, A, "unique-1"));
      const err = await tdb.run(ctx(A), (tx) => insertNote(tx, A, "unique-1")).catch((e: unknown) => e);
      expect(isUniqueViolation(err)).toBe(true);
    });

    it("savepoint : l'échec interne est annulé, la transaction externe continue et commit", async () => {
      await tdb.run(ctx(A), async (tx) => {
        await insertNote(tx, A, "sp-outer");
        await tx
          .transaction(async (t) => {
            await insertNote(t, A, "sp-inner");
            throw new Error("annule l'interne");
          })
          .catch(() => undefined);
        await tx.transaction((t) => insertNote(t, A, "sp-inner-ok"));
      });
      const bodies = (await tdb.run(ctx(A), (tx) => tx.many("SELECT body FROM kernel.notes WHERE body LIKE 'sp-%' ORDER BY body"))).map(
        (r) => r.body,
      );
      expect(bodies).toEqual(["sp-inner-ok", "sp-outer"]);
    });

    it("run imbriqué (même contexte) = savepoint sur LA MÊME connexion ; autre tenant = refusé", async () => {
      await tdb.run(ctx(A), async (outer) => {
        const pidOuter = (await outer.queryOne<{ pid: number }>("SELECT pg_backend_pid() AS pid"))?.pid;
        await tdb.run(ctx(A), async (inner) => {
          expect((await inner.queryOne<{ pid: number }>("SELECT pg_backend_pid() AS pid"))?.pid).toBe(pidOuter);
        });
        await expect(tdb.run(ctx(B), async () => 1)).rejects.toMatchObject({ code: "TX_IDENTITY_SWITCH" });
      });
    });

    it("readOnly refuse les écritures", async () => {
      await expect(tdb.run(ctx(A), (tx) => insertNote(tx, A, "ro"), { readOnly: true })).rejects.toMatchObject({
        code: "25006",
      });
    });

    it("statementTimeoutMs interrompt une requête trop longue", async () => {
      const slow = new TenantDb(db.pool(appUrl, 1), { statementTimeoutMs: 150 });
      await expect(slow.run(ctx(A), (tx) => tx.query("SELECT pg_sleep(2)"))).rejects.toMatchObject({ code: "57014" });
      // La connexion est réutilisable et le délai ne fuit pas hors de la transaction.
      const v = await slow.run(ctx(A), (tx) => tx.queryOne<{ n: number }>("SELECT 1 AS n"));
      expect(v?.n).toBe(1);
    });
  });

  describe("posture du contexte", () => {
    it("pose app.tenant_id / app.user_id / app.actor / app.request_id et les fonctions kernel les lisent", async () => {
      const c = createRequestContext({ tenantId: A, userId: USER, requestId: "req-xyz" });
      const row = await tdb.run(c, (tx) =>
        tx.queryOne<Record<string, string | null>>(
          `SELECT kernel.current_tenant_id()::text AS tenant, kernel.current_user_id()::text AS usr,
                  kernel.current_actor() AS actor, current_setting('app.request_id') AS req`,
        ),
      );
      expect(row).toEqual({ tenant: A, usr: USER, actor: "user", req: "req-xyz" });
    });

    it("le contexte disparaît à la fin de la transaction : aucune fuite vers la requête suivante", async () => {
      const single = new TenantDb(db.pool(appUrl, 1));
      await single.run(ctx(A), (tx) => tx.query("SELECT 1"));
      const pool = db.pool(appUrl, 1);
      // Même connexion physique que ci-dessus n'est pas garantie : on contrôle donc sur CHAQUE sortie.
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
        await c.query("COMMIT");
        const leaked = (await c.query("SELECT current_setting('app.tenant_id', true) AS v")).rows[0].v;
        expect(leaked === null || leaked === "").toBe(true);
      } finally {
        c.release();
      }
      const leakedViaTdb = await single.run(ctx(B), (tx) => tx.queryOne<{ t: string }>("SELECT current_setting('app.tenant_id') AS t"));
      expect(leakedViaTdb?.t).toBe(B);
    });

    it("isolation sous charge : 60 runs concurrents entrecroisés sur 5 connexions", async () => {
      await tdb.run(ctx(A), (tx) => insertNote(tx, A, "load-a"));
      await tdb.run(ctx(B), (tx) => insertNote(tx, B, "load-b"));
      const jobs = Array.from({ length: 60 }, (_, i) => {
        const mine = i % 2 === 0 ? A : B;
        return tdb.run(ctx(mine), async (tx) => {
          await new Promise((r) => setTimeout(r, Math.random() * 15));
          const seen = await tx.many<{ tenant_id: string }>("SELECT DISTINCT tenant_id FROM kernel.notes");
          const setting = (await tx.queryOne<{ t: string }>("SELECT current_setting('app.tenant_id') AS t"))?.t;
          return { mine, tenants: seen.map((s) => s.tenant_id), setting, alsCtx: getRequestContext()?.tenantId };
        });
      });
      for (const r of await Promise.all(jobs)) {
        expect(r.tenants).toEqual([r.mine]);
        expect(r.setting).toBe(r.mine);
        expect(r.alsCtx).toBe(r.mine);
      }
    });
  });

  describe("SystemDb", () => {
    it("run (sans tenant) voit les tables globales mais AUCUNE ligne de tenant ; pose actor=system et la raison", async () => {
      const out = await sys.run("verification-systeme", async (tx) => ({
        tenants: (await tx.many("SELECT slug FROM kernel.tenants ORDER BY slug")).map((r) => r.slug),
        notes: (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM kernel.notes"))?.n,
        actor: (await tx.queryOne<{ a: string }>("SELECT kernel.current_actor() AS a"))?.a,
        reason: (await tx.queryOne<{ r: string }>("SELECT current_setting('app.reason') AS r"))?.r,
      }));
      expect(out.tenants).toEqual(["ecole-a", "ecole-b"]);
      expect(out.notes).toBe(0); // PAS de repli en super-admin
      expect(out.actor).toBe("system");
      expect(out.reason).toBe("verification-systeme");
    });

    it("run ne peut pas écrire dans une table de tenant (pas de tenant ⇒ WITH CHECK échoue)", async () => {
      const err = await sys
        .run("ecriture-sans-tenant", (tx) => insertNote(tx, A, "sys-no-tenant"))
        .catch((e: unknown) => e);
      expect(isRlsViolation(err)).toBe(true);
    });

    it("runForTenant : RLS limitée à CE tenant", async () => {
      const bodies = await sys.runForTenant("lecture-par-tenant", B, (tx) =>
        tx.many("SELECT DISTINCT tenant_id FROM kernel.notes"),
      );
      expect(bodies.map((r) => r.tenant_id)).toEqual([B]);
    });

    it("forEachTenant : une transaction par tenant, isolation préservée, échec d'un tenant n'arrête pas l'autre", async () => {
      const report = await sys.forEachTenant("comptage-par-tenant", async (tx, tenant) => {
        if (tenant.slug === "ecole-a") throw new Error("échec simulé sur A");
        const rows = await tx.many<{ tenant_id: string }>("SELECT DISTINCT tenant_id FROM kernel.notes");
        return rows.map((r) => r.tenant_id);
      });
      expect(report.succeeded).toHaveLength(1);
      expect(report.succeeded[0]?.result).toEqual([B]);
      expect(report.failed.map((f) => f.slug)).toEqual(["ecole-a"]);
    });

    it("un tenant suspendu n'est pas parcouru", async () => {
      await db.admin.query("UPDATE kernel.tenants SET status = 'suspended' WHERE id = $1", [B]);
      try {
        const report = await sys.forEachTenant("tenants-actifs", async (_tx, t) => t.slug);
        expect(report.succeeded.map((s) => s.result)).toEqual(["ecole-a"]);
      } finally {
        await db.admin.query("UPDATE kernel.tenants SET status = 'active' WHERE id = $1", [B]);
      }
    });

    it("app_user ne peut pas supprimer un tenant", async () => {
      await expect(sys.run("suppression-interdite", (tx) => tx.query("DELETE FROM kernel.tenants WHERE slug = 'ecole-b'"))).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  describe("outbox transactionnelle", () => {
    const evt = (c: RequestContext, type = "student.enrolled", payload: unknown = { studentId: "s1" }) =>
      createDomainEvent({ type, payload, ctx: c, aggregateType: "student", aggregateId: "s1" });

    it("l'événement est validé avec la donnée, et annulé avec elle", async () => {
      const c = ctx(A);
      const kept = evt(c);
      await tdb.run(c, async (tx) => {
        await insertNote(tx, A, "outbox-kept");
        await new PgOutboxWriter(tx).append([kept]);
      });
      const doomed = evt(c, "student.left");
      await tdb
        .run(c, async (tx) => {
          await insertNote(tx, A, "outbox-doomed");
          await new PgOutboxWriter(tx).append([doomed]);
          throw new Error("annulation");
        })
        .catch(() => undefined);

      const ids = (await tdb.run(c, (tx) => tx.many("SELECT id FROM kernel.domain_events"))).map((r) => r.id);
      expect(ids).toContain(kept.id);
      expect(ids).not.toContain(doomed.id);
      const row = await tdb.run(c, (tx) => tx.queryOne("SELECT * FROM kernel.domain_events WHERE id = $1", [kept.id]));
      expect(row).toMatchObject({
        type: "student.enrolled",
        tenant_id: A,
        actor_id: USER,
        aggregate_id: "s1",
        payload: { studentId: "s1" },
        published_at: null,
        attempts: 0,
      });
    });

    it("le tenant B ne voit pas les événements de A, et ne peut pas en écrire au nom de A", async () => {
      const cA = ctx(A);
      const cB = ctx(B);
      const e = evt(cA, "invoice.paid", { invoiceId: "i1" });
      await tdb.run(cA, (tx) => new PgOutboxWriter(tx).append([e]));

      const seenByB = await tdb.run(cB, (tx) => tx.many("SELECT id FROM kernel.domain_events WHERE id = $1", [e.id]));
      expect(seenByB).toEqual([]);

      const forged = evt(cA, "invoice.forged"); // événement au tenant A…
      const err = await tdb.run(cB, (tx) => new PgOutboxWriter(tx).append([forged])).catch((x: unknown) => x); // …écrit depuis B
      expect(isRlsViolation(err)).toBe(true);
    });

    it("le contenu d'un événement est immuable pour l'application ; l'état de livraison, non", async () => {
      const c = ctx(A);
      const e = evt(c, "student.moved");
      await tdb.run(c, (tx) => new PgOutboxWriter(tx).append([e]));
      await expect(
        tdb.run(c, (tx) => tx.query("UPDATE kernel.domain_events SET payload = '{}'::jsonb WHERE id = $1", [e.id])),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        tdb.run(c, (tx) => tx.query("UPDATE kernel.domain_events SET type = 'x.y' WHERE id = $1", [e.id])),
      ).rejects.toMatchObject({ code: "42501" });

      const published = await tdb.run(c, (tx) => markEventsPublished(tx, [e.id]));
      expect(published).toBe(1);
      expect(await tdb.run(c, (tx) => markEventsPublished(tx, [e.id]))).toBe(0); // idempotent
    });

    it("le relais lit par tenant (forEachTenant), réserve en SKIP LOCKED, marque publié / échec", async () => {
      await db.admin.query("DELETE FROM kernel.domain_events");
      const bus = new InMemoryEventBus();
      const delivered: string[] = [];
      bus.subscribeAll((e) => void delivered.push(`${e.tenantId.slice(0, 1)}:${e.type}`));

      await tdb.run(ctx(A), (tx) => new PgOutboxWriter(tx).append([evt(ctx(A), "a.first"), evt(ctx(A), "a.second")]));
      await tdb.run(ctx(B), (tx) => new PgOutboxWriter(tx).append([evt(ctx(B), "b.first")]));

      const report = await sys.forEachTenant("relais-outbox", async (tx) => {
        const pending = await fetchPendingEvents(tx, 10);
        const done: string[] = [];
        for (const row of pending) {
          if (row.type === "a.second") {
            await markEventFailed(tx, row.id, "broker indisponible", 60_000);
            continue;
          }
          await bus.publish(createDomainEvent({ type: row.type, payload: row.payload, ctx: createRequestContext({ tenantId: row.tenant_id, userId: USER }) }));
          done.push(row.id);
        }
        await markEventsPublished(tx, done);
        return pending.length;
      });
      expect(report.failed).toEqual([]);
      expect(delivered.sort()).toEqual(["a:a.first", "b:b.first"]);

      const left = await sys.runForTenant("controle-relais", A, (tx) =>
        tx.many("SELECT type, attempts, last_error, published_at FROM kernel.domain_events"),
      );
      const second = left.find((r) => r.type === "a.second");
      expect(second).toMatchObject({ attempts: 1, last_error: "broker indisponible", published_at: null });
      // Retardé : n'est plus réservable avant l'échéance.
      expect(await sys.runForTenant("controle-relais", A, (tx) => fetchPendingEvents(tx))).toEqual([]);
    });

    it("refuse un type d'événement mal formé au niveau SQL", async () => {
      const c = ctx(A);
      const bad = { ...evt(c), type: "MauvaisType" };
      await expect(tdb.run(c, (tx) => new PgOutboxWriter(tx).append([bad]))).rejects.toMatchObject({ code: "23514" });
    });
  });
});
