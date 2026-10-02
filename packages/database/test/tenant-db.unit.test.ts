import { describe, expect, it } from "vitest";
import {
  createRequestContext,
  createSystemContext,
  getRequestContext,
  noopLogger,
  ValidationError,
  type Logger,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, SystemDb, TenantDb, type PgPoolLike, type PoolClientLike } from "../src";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";

interface Call {
  sql: string;
  params?: unknown[];
}

function fakePool(options: { failOn?: RegExp; failRollback?: boolean; rows?: Record<string, any[]> } = {}) {
  const calls: Call[] = [];
  const released: Array<Error | boolean | undefined> = [];
  let connects = 0;
  const client: PoolClientLike = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql: sql.trim().replace(/\s+/g, " "), ...(params ? { params } : {}) });
      if (options.failRollback && /^ROLLBACK$/.test(sql)) throw new Error("connexion perdue");
      if (options.failOn?.test(sql)) throw Object.assign(new Error("boom"), { code: "XX000" });
      for (const [pattern, rows] of Object.entries(options.rows ?? {})) {
        if (new RegExp(pattern).test(sql)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      released.push(err);
    },
  };
  const pool: PgPoolLike = {
    async connect() {
      connects += 1;
      return client;
    },
  };
  return { pool, calls, released, connects: () => connects, sqls: () => calls.map((c) => c.sql) };
}

const userCtx = (tenantId = A): RequestContext =>
  createRequestContext({ tenantId, userId: U, roles: ["admin"], requestId: "req-1" });

describe("TenantDb.run — séquence SQL", () => {
  it("BEGIN, set_config en portée transaction (paramétré), fn, COMMIT, release", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    const out = await db.run(userCtx(), async (tx) => {
      await tx.query("SELECT 1");
      return 42;
    });
    expect(out).toBe(42);

    const s = f.sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toMatch(/set_config\('app\.tenant_id', \$1, true\)/);
    expect(s[1]).toMatch(/set_config\('app\.user_id', \$2, true\)/);
    expect(s[1]).toMatch(/set_config\('app\.actor', \$3, true\)/);
    expect(s[2]).toBe("SELECT 1");
    expect(s[3]).toBe("COMMIT");
    expect(f.calls[1]?.params).toEqual([A, U, "user", "req-1", ""]);
    // Aucun SET LOCAL avec valeur interpolée
    expect(s.join(" ")).not.toContain(A);
    expect(f.released).toEqual([undefined]);
  });

  it("ROLLBACK si fn lève, erreur d'origine relancée, connexion remise au pool", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    await expect(
      db.run(userCtx(), async () => {
        throw new Error("métier");
      }),
    ).rejects.toThrow("métier");
    expect(f.sqls().at(-1)).toBe("ROLLBACK");
    expect(f.sqls()).not.toContain("COMMIT");
    expect(f.released).toEqual([undefined]);
  });

  it("ROLLBACK aussi si COMMIT échoue", async () => {
    const f = fakePool({ failOn: /^COMMIT$/ });
    await expect(new TenantDb(f.pool).run(userCtx(), async () => 1)).rejects.toThrow("boom");
    expect(f.sqls().slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });

  it("détruit la connexion si le ROLLBACK échoue", async () => {
    const f = fakePool({ failRollback: true });
    await expect(
      new TenantDb(f.pool).run(userCtx(), async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(f.released).toHaveLength(1);
    expect(f.released[0]).toBeInstanceOf(Error);
  });

  it("annule et libère si set_config échoue", async () => {
    const f = fakePool({ failOn: /set_config/ });
    await expect(new TenantDb(f.pool).run(userCtx(), async () => 1)).rejects.toThrow("boom");
    expect(f.sqls().at(-1)).toBe("ROLLBACK");
    expect(f.released).toEqual([undefined]);
  });

  it("readOnly → BEGIN READ ONLY ; statementTimeoutMs → set_config('statement_timeout')", async () => {
    const f = fakePool();
    await new TenantDb(f.pool, { statementTimeoutMs: 1500 }).run(userCtx(), async () => 1, { readOnly: true });
    expect(f.sqls()[0]).toBe("BEGIN READ ONLY");
    // fusionné avec les variables de session : une seule instruction entre BEGIN et la requête
    expect(f.sqls()[1]).toMatch(/set_config\('app\.tenant_id'.*set_config\('statement_timeout', \$6, true\)/);
    expect(f.calls[1]?.params?.[5]).toBe("1500");
    expect(f.sqls()).toEqual(["BEGIN READ ONLY", f.sqls()[1], "COMMIT"]);
    expect(() => new TenantDb(f.pool, { statementTimeoutMs: -1 })).toThrow();
  });

  it("expose le contexte via AsyncLocalStorage pendant fn seulement", async () => {
    const f = fakePool();
    const ctx = userCtx();
    expect(getRequestContext()).toBeUndefined();
    await new TenantDb(f.pool).run(ctx, async () => {
      await Promise.resolve();
      expect(getRequestContext()).toBe(ctx);
    });
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("TenantDb.run — validation du contexte", () => {
  it.each([
    ["chaîne vide", ""],
    ["texte", "tenant-1"],
    ["injection", `${A}'; DROP TABLE users; --`],
    ["UUID tronqué", A.slice(0, -1)],
  ])("refuse un tenantId invalide (%s) SANS ouvrir de connexion", async (_label, bad) => {
    const f = fakePool();
    const forged = { ...userCtx(), tenantId: bad } as RequestContext;
    await expect(new TenantDb(f.pool).run(forged, async () => 1)).rejects.toBeInstanceOf(ValidationError);
    expect(f.connects()).toBe(0);
  });

  it("refuse un acteur inconnu, un userId invalide, un user sans userId", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    const base = userCtx();
    await expect(db.run({ ...base, actor: "root" } as unknown as RequestContext, async () => 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(db.run({ ...base, userId: "x" } as RequestContext, async () => 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(db.run({ ...base, userId: null } as RequestContext, async () => 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(db.run(undefined as unknown as RequestContext, async () => 1)).rejects.toBeInstanceOf(ValidationError);
    expect(f.connects()).toBe(0);
  });

  it("normalise le tenantId en minuscules", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run({ ...userCtx(), tenantId: A.toUpperCase() } as RequestContext, async () => 1);
    expect(f.calls[1]?.params?.[0]).toBe(A);
  });

  it("accepte un acteur system sans userId", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run(createSystemContext(A, "job-1"), async () => 1);
    expect(f.calls[1]?.params).toEqual([A, "", "system", "job-1", ""]);
  });
});

describe("Tx", () => {
  it("query / many / queryOne", async () => {
    const f = fakePool({ rows: { "FROM one": [{ id: 1 }], "FROM two": [{ id: 1 }, { id: 2 }] } });
    await new TenantDb(f.pool).run(userCtx(), async (tx) => {
      expect(await tx.queryOne("SELECT * FROM one")).toEqual({ id: 1 });
      expect(await tx.queryOne("SELECT * FROM none")).toBeNull();
      expect(await tx.many("SELECT * FROM two")).toHaveLength(2);
      expect((await tx.query("SELECT * FROM two")).rowCount).toBe(2);
      await expect(tx.queryOne("SELECT * FROM two")).rejects.toMatchObject({ code: "DB_TOO_MANY_ROWS" });
    });
  });

  it("passe les paramètres tels quels", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run(userCtx(), (tx) => tx.query("SELECT $1, $2", ["a", 2]));
    expect(f.calls[2]?.params).toEqual(["a", 2]);
  });

  it("est inutilisable une fois la transaction terminée", async () => {
    const f = fakePool();
    let leaked: any;
    await new TenantDb(f.pool).run(userCtx(), async (tx) => {
      leaked = tx;
    });
    await expect(leaked.query("SELECT 1")).rejects.toMatchObject({ code: "TX_CLOSED" });
    await expect(leaked.transaction(async () => 1)).rejects.toMatchObject({ code: "TX_CLOSED" });
  });

  it("savepoint : RELEASE au succès ; ROLLBACK TO + RELEASE à l'échec, l'erreur est relancée", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run(userCtx(), async (tx) => {
      await tx.transaction(async (t) => void (await t.query("SELECT 'ok'")));
      await expect(
        tx.transaction(async () => {
          throw new Error("interne");
        }),
      ).rejects.toThrow("interne");
      await tx.query("SELECT 'suite'");
    });
    expect(f.sqls().slice(2, -1)).toEqual([
      "SAVEPOINT ed_sp_1",
      "SELECT 'ok'",
      "RELEASE SAVEPOINT ed_sp_1",
      "SAVEPOINT ed_sp_2",
      "ROLLBACK TO SAVEPOINT ed_sp_2",
      "RELEASE SAVEPOINT ed_sp_2",
      "SELECT 'suite'",
    ]);
    expect(f.sqls().at(-1)).toBe("COMMIT");
  });

  it("savepoints imbriqués", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run(userCtx(), (tx) =>
      tx.transaction((t1) => t1.transaction((t2) => t2.query("SELECT 1"))),
    );
    expect(f.sqls().filter((s) => s.startsWith("SAVEPOINT"))).toEqual(["SAVEPOINT ed_sp_1", "SAVEPOINT ed_sp_2"]);
  });
});

describe("TenantDb.run — imbrication", () => {
  it("un run imbriqué du même contexte réutilise la transaction via SAVEPOINT", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    const ctx = userCtx();
    await db.run(ctx, async () => {
      await db.run(ctx, async (tx) => void (await tx.query("SELECT 'inner'")));
    });
    expect(f.connects()).toBe(1);
    expect(f.sqls().filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(f.sqls()).toContain("SAVEPOINT ed_sp_1");
  });

  it("refuse de changer de tenant à l'intérieur d'une transaction", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    await expect(
      db.run(userCtx(A), async () => {
        await db.run(userCtx(B), async () => 1);
      }),
    ).rejects.toMatchObject({ code: "TX_IDENTITY_SWITCH" });
    expect(f.connects()).toBe(1);
    expect(f.sqls().at(-1)).toBe("ROLLBACK");
  });

  it("refuse de changer d'acteur ou d'utilisateur", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    await expect(
      db.run(userCtx(A), () => db.run(createSystemContext(A), async () => 1)),
    ).rejects.toMatchObject({ code: "TX_IDENTITY_SWITCH" });
  });

  it("deux runs concurrents de tenants différents utilisent deux connexions distinctes", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    const seen: string[] = [];
    await Promise.all([
      db.run(userCtx(A), async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(getRequestContext()?.tenantId ?? "");
      }),
      db.run(userCtx(B), async () => {
        seen.push(getRequestContext()?.tenantId ?? "");
      }),
    ]);
    expect(f.connects()).toBe(2);
    expect(seen).toEqual([B, A]);
  });
});

describe("SystemDb", () => {
  function logCapture() {
    const entries: Array<{ level: string; obj: Record<string, unknown>; msg?: string }> = [];
    const logger: Logger = {
      debug: (obj, msg) => void entries.push({ level: "debug", obj, ...(msg ? { msg } : {}) }),
      info: (obj, msg) => void entries.push({ level: "info", obj, ...(msg ? { msg } : {}) }),
      warn: (obj, msg) => void entries.push({ level: "warn", obj, ...(msg ? { msg } : {}) }),
      error: (obj, msg) => void entries.push({ level: "error", obj, ...(msg ? { msg } : {}) }),
    };
    return { entries, logger };
  }

  it("run : acteur system, AUCUN tenant, raison posée et journalisée", async () => {
    const f = fakePool();
    const { entries, logger } = logCapture();
    const sys = new SystemDb(new TenantDb(f.pool), { logger });
    await sys.run("purge-sessions-expirees", async (tx) => void (await tx.query("SELECT 1")));

    const params = f.calls[1]?.params as string[];
    expect(params[0]).toBe(""); // tenant vide
    expect(params[2]).toBe("system");
    expect(params[4]).toBe("purge-sessions-expirees");
    expect(entries.map((e) => e.obj.phase)).toEqual(["start", "end"]);
    expect(entries[0]?.obj.reason).toBe("purge-sessions-expirees");
    expect(entries[1]?.obj).toMatchObject({ outcome: "committed" });
  });

  it("journalise aussi l'annulation", async () => {
    const f = fakePool();
    const { entries, logger } = logCapture();
    const sys = new SystemDb(new TenantDb(f.pool), { logger });
    await expect(
      sys.run("job-qui-echoue", async () => {
        throw new Error("zut");
      }),
    ).rejects.toThrow("zut");
    expect(entries.at(-1)).toMatchObject({ level: "warn", obj: { outcome: "rolled_back", error: "zut" } });
  });

  it.each([undefined, null, "", "   ", "abc", "x".repeat(201), "raison\navec saut"])(
    "refuse la raison invalide %j",
    async (reason) => {
      const f = fakePool();
      const sys = new SystemDb(new TenantDb(f.pool), { logger: noopLogger });
      await expect(sys.run(reason as never, async () => 1)).rejects.toBeInstanceOf(ValidationError);
      await expect(sys.runForTenant(reason as never, A, async () => 1)).rejects.toBeInstanceOf(ValidationError);
      expect(f.connects()).toBe(0);
    },
  );

  it("runForTenant : tenant posé, acteur system, contexte propagé ; refuse un tenant invalide", async () => {
    const f = fakePool();
    const sys = new SystemDb(new TenantDb(f.pool), { logger: noopLogger });
    await sys.runForTenant("relais-outbox", A, async () => {
      expect(getRequestContext()).toMatchObject({ tenantId: A, actor: "system", userId: null });
    });
    expect((f.calls[1]?.params as string[]).slice(0, 3)).toEqual([A, "", "system"]);
    await expect(sys.runForTenant("relais-outbox", "nope", async () => 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("forEachTenant : une transaction par tenant actif, échecs rapportés sans arrêter les autres", async () => {
    const f = fakePool({ rows: { "FROM kernel.tenants": [{ id: A, slug: "a" }, { id: B, slug: "b" }] } });
    const { entries, logger } = logCapture();
    const sys = new SystemDb(new TenantDb(f.pool), { logger });
    const seen: string[] = [];
    const report = await sys.forEachTenant("recalcul-nocturne", async (_tx, tenant) => {
      seen.push(tenant.slug);
      if (tenant.slug === "a") throw new Error("échec A");
      return tenant.slug.toUpperCase();
    });
    expect(seen).toEqual(["a", "b"]);
    expect(report.succeeded).toEqual([{ tenantId: B, slug: "b", result: "B" }]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ tenantId: A, slug: "a" });
    expect(entries.filter((e) => e.obj.outcome === "rolled_back")).toHaveLength(1);
  });

  it("forEachTenant continueOnError:false s'arrête au premier échec", async () => {
    const f = fakePool({ rows: { "FROM kernel.tenants": [{ id: A, slug: "a" }, { id: B, slug: "b" }] } });
    const sys = new SystemDb(new TenantDb(f.pool), { logger: noopLogger });
    const seen: string[] = [];
    await expect(
      sys.forEachTenant(
        "recalcul-nocturne",
        async (_tx, t) => {
          seen.push(t.slug);
          throw new Error("stop");
        },
        { continueOnError: false },
      ),
    ).rejects.toThrow("stop");
    expect(seen).toEqual(["a"]);
  });

  it("un TenantDb.run utilisateur imbriqué dans un runForTenant system est refusé", async () => {
    const f = fakePool();
    const db = new TenantDb(f.pool);
    const sys = new SystemDb(db, { logger: noopLogger });
    await expect(sys.runForTenant("job-de-test", A, () => db.run(userCtx(A), async () => 1))).rejects.toMatchObject({
      code: "TX_IDENTITY_SWITCH",
    });
  });
});

describe("PgOutboxWriter (SQL émis)", () => {
  it("insère les événements en une requête paramétrée, payload en jsonb", async () => {
    const f = fakePool();
    await new TenantDb(f.pool).run(userCtx(), async (tx) => {
      await new PgOutboxWriter(tx).append([
        {
          id: "44444444-4444-4444-8444-444444444444",
          type: "student.enrolled",
          version: 1,
          tenantId: A,
          occurredAt: "2026-10-01T00:00:00.000Z",
          payload: { studentId: "s1" },
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          type: "invoice.paid",
          version: 2,
          tenantId: A,
          occurredAt: "2026-10-01T00:00:00.000Z",
          payload: { invoiceId: "i1" },
          aggregateType: "invoice",
          aggregateId: "i1",
          actorId: U,
          requestId: "r",
        },
      ]);
      await new PgOutboxWriter(tx).append([]);
    });
    const insert = f.calls.find((c) => c.sql.startsWith("INSERT INTO kernel.domain_events"));
    expect(insert?.sql).toContain("$9::jsonb");
    expect(insert?.sql).toContain("$19::jsonb");
    expect(insert?.params).toHaveLength(20);
    expect(insert?.params?.[8]).toBe('{"studentId":"s1"}');
    expect(f.calls.filter((c) => c.sql.startsWith("INSERT")).length).toBe(1);
  });
});

