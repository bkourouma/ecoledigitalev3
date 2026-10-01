/**
 * Tests unitaires du service avec une transaction FACTICE : vérifient l'ordre des énoncés
 * (verrou -> lecture de la tête -> insertion), le remplissage automatique du contexte, le
 * masquage avant écriture et le chaînage, sans base de données.
 */
import { describe, expect, it } from "vitest";
import { ManualClock, createRequestContext, runWithContext } from "@ecoledigitale/kernel";
import type { QueryResult, Tx } from "@ecoledigitale/database";
import { AuditService } from "../application/audit-service";
import { runWithAuditRequestMeta } from "../application/request-meta";
import { verifyChainOn } from "../application/verify-chain";
import { MASK } from "../domain/masking";
import { GENESIS_HASH } from "../domain/hash";
import type { StoredAuditEntry } from "../domain/types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";

interface Call {
  sql: string;
  params: readonly unknown[];
}

/** Mémoire minimale de tête/lignes, juste assez pour enchaîner plusieurs `record`. */
function fakeTx() {
  const calls: Call[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  let head: { last_seq: string; last_hash: string } | null = null;
  const run = async (sql: string, params: readonly unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (/FROM audit\.chain_heads/.test(sql)) return { rows: head ? [head] : [], rowCount: head ? 1 : 0 };
    if (/INSERT INTO audit\.audit_log/.test(sql)) {
      // Colonnes dans l'ordre : tenant_id, id, seq, occurred_at, actor_type, actor_id, impersonated_by, action, entity, entity_id,
      // before, after, diff, metadata, ip, user_agent, device, request_id, reason, severity, hash_alg, key_id, prev_hash, hash
      const p = params;
      const row = {
        tenant_id: p[0], id: p[1], seq: p[2], occurred_at: p[3], actor_type: p[4], actor_id: p[5], impersonated_by: p[6],
        action: p[7], entity: p[8], entity_id: p[9], before: p[10], after: p[11], diff: p[12], metadata: p[13],
        ip: p[14], user_agent: p[15], device: p[16], request_id: p[17], reason: p[18], severity: p[19],
        hash_alg: p[20], key_id: p[21], prev_hash: p[22], hash: p[23],
      };
      inserts.push(row);
      head = { last_seq: String(row.seq), last_hash: String(row.hash) };
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const tx: Tx = {
    query: (async (sql: string, params?: readonly unknown[]) => run(sql, params)) as Tx["query"],
    queryOne: (async (sql: string, params?: readonly unknown[]) => (await run(sql, params)).rows[0] ?? null) as Tx["queryOne"],
    many: (async (sql: string, params?: readonly unknown[]) => (await run(sql, params)).rows) as Tx["many"],
    transaction: (async (fn: (t: Tx) => Promise<unknown>) => fn(tx)) as Tx["transaction"],
  };
  return { tx, calls, inserts };
}

const clock = new ManualClock("2026-10-01T10:00:00.000Z");
const ctx = createRequestContext({ tenantId: TENANT, userId: USER, requestId: "req-7", roles: ["admin"] });
const inCtx = <T>(fn: () => Promise<T>): Promise<T> => runWithContext(ctx, fn);

describe("AuditService.record (transaction factice)", () => {
  it("verrou de chaîne, PUIS lecture de la tête, PUIS insertion (énoncés séparés)", async () => {
    const { tx, calls } = fakeTx();
    const audit = new AuditService({ clock });
    await inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", entityId: "g1" }));
    const idx = (re: RegExp): number => calls.findIndex((c) => re.test(c.sql));
    const lock = idx(/pg_advisory_xact_lock/);
    const head = idx(/FROM audit\.chain_heads/);
    const insert = idx(/INSERT INTO audit\.audit_log/);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(head);
    expect(head).toBeLessThan(insert);
    expect(calls[lock]!.sql).not.toMatch(/chain_heads/); // jamais dans le même énoncé que la lecture
    expect(calls[lock]!.params).toEqual([TENANT]);
  });

  it("remplit tenant, acteur, requestId depuis le contexte et ip/user-agent/device depuis la portée HTTP", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    await inCtx(() =>
      runWithAuditRequestMeta(
        { ip: "10.1.2.3", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" },
        () => audit.record(tx, { action: "grade.published", entity: "grade" }),
      ),
    );
    expect(inserts[0]).toMatchObject({
      tenant_id: TENANT,
      actor_type: "user",
      actor_id: USER,
      request_id: "req-7",
      ip: "10.1.2.3",
      device: "Chrome / Windows (poste)",
      seq: 1,
      prev_hash: GENESIS_HASH,
      occurred_at: "2026-10-01T10:00:00.000Z",
    });
  });

  it("ip absente hors requête HTTP : NULL", async () => {
    const { tx, inserts } = fakeTx();
    await inCtx(() => new AuditService({ clock }).record(tx, { action: "grade.published", entity: "grade" }));
    expect(inserts[0]).toMatchObject({ ip: null, user_agent: null, device: null });
  });

  it("masque before/after/diff/metadata AVANT écriture (rien de secret dans les paramètres SQL)", async () => {
    const { tx, calls, inserts } = fakeTx();
    await inCtx(() =>
      new AuditService({ clock }).record(tx, {
        action: "user.updated",
        entity: "user",
        before: { email: "a@b.ci", password: "ancien-mdp", totpSecret: "JBSWY3DPEHPK3PXP" },
        after: { email: "c@d.ci", password: "nouveau-mdp", totpSecret: "JBSWY3DPEHPK3PXP" },
        metadata: { token: "abc", note: "ok" },
      }),
    );
    const everything = JSON.stringify(calls.map((c) => c.params));
    for (const secret of ["ancien-mdp", "nouveau-mdp", "JBSWY3DPEHPK3PXP", '"token":"abc"']) expect(everything).not.toContain(secret);
    const row = inserts[0]!;
    expect(JSON.parse(row.before as string)).toEqual({ email: "a@b.ci", password: MASK, totpSecret: MASK });
    expect(JSON.parse(row.diff as string)).toEqual({ email: { from: "a@b.ci", to: "c@d.ci" }, password: { from: MASK, to: MASK } });
    expect(JSON.parse(row.metadata as string)).toEqual({ token: MASK, note: "ok" });
  });

  it("chaîne : seq 1,2,3 ; prev_hash = hash précédent ; verifyChain valide", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    for (let i = 0; i < 3; i++) await inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", entityId: String(i), after: { i } }));
    expect(inserts.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(inserts[1]!.prev_hash).toBe(inserts[0]!.hash);
    expect(inserts[2]!.prev_hash).toBe(inserts[1]!.hash);
    expect(new Set(inserts.map((r) => r.hash)).size).toBe(3);
  });

  it("acteur explicite : impersonation exige impersonatedBy ; non-système exige un id", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    await inCtx(() =>
      audit.record(tx, { action: "grade.published", entity: "grade", actor: { type: "impersonation", id: USER, impersonatedBy: ADMIN } }),
    );
    expect(inserts[0]).toMatchObject({ actor_type: "impersonation", actor_id: USER, impersonated_by: ADMIN });
    await expect(inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", actor: { type: "impersonation", id: USER } }))).rejects.toMatchObject({ code: "AUDIT_ACTOR_INVALID" });
    await expect(inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", actor: { type: "user", id: null } }))).rejects.toMatchObject({ code: "AUDIT_ACTOR_INVALID" });
  });

  it("erreurs de câblage explicites : pas de contexte, tenant différent, action invalide", async () => {
    const { tx } = fakeTx();
    const audit = new AuditService({ clock });
    await expect(audit.record(tx, { action: "grade.published", entity: "grade" })).rejects.toMatchObject({ code: "AUDIT_TENANT_MISSING" });
    await expect(
      inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", tenantId: "99999999-9999-4999-8999-999999999999" })),
    ).rejects.toMatchObject({ code: "AUDIT_TENANT_MISMATCH" });
    for (const action of ["publish", "Grade.Published", "grade.published!", ""]) {
      await expect(inCtx(() => audit.record(tx, { action, entity: "grade" }))).rejects.toMatchObject({ code: "AUDIT_ACTION_INVALID" });
    }
    await expect(inCtx(() => audit.record(tx, { action: "grade.published", entity: "Grade" }))).rejects.toMatchObject({ code: "AUDIT_ENTITY_INVALID" });
  });

  it("champ trop volumineux : remplacé par une empreinte, pas perdu en silence", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock, maxFieldBytes: 200 });
    await inCtx(() => audit.record(tx, { action: "import.completed", entity: "import", after: { blob: "x".repeat(5000) } }));
    const after = JSON.parse(inserts[0]!.after as string);
    expect(after).toMatchObject({ _truncated: true });
    expect(after._sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after._bytes).toBeGreaterThan(5000);
  });

  it("HMAC : hash_alg/key_id renseignés ; clé trop courte refusée", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock, hmac: { activeKeyId: "k1", keys: { k1: "une-cle-de-test-assez-longue" } } });
    await inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade" }));
    expect(inserts[0]).toMatchObject({ hash_alg: "hmac-sha256", key_id: "k1" });
    expect(() => new AuditService({ hmac: { activeKeyId: "k", keys: { k: "court" } } })).toThrow(/Clé HMAC/);
  });

  it("withAudit : snapshot avant/après autour de la mutation, audit enregistré APRÈS fn", async () => {
    const { tx, calls, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    let state = { name: "avant", role: "teacher" };
    const order: string[] = [];
    const result = await inCtx(() =>
      audit.withAudit(
        tx,
        {
          action: "user.updated",
          entity: "user",
          entityId: (r: { id: string }) => r.id,
          snapshot: async () => {
            order.push("snapshot");
            return { ...state };
          },
        },
        async () => {
          order.push("mutation");
          state = { name: "après", role: "teacher" };
          return { id: "u1" };
        },
      ),
    );
    expect(result).toEqual({ id: "u1" });
    expect(order).toEqual(["snapshot", "mutation", "snapshot"]);
    expect(JSON.parse(inserts[0]!.diff as string)).toEqual({ name: { from: "avant", to: "après" } });
    expect(inserts[0]!.entity_id).toBe("u1");
    expect(calls.findIndex((c) => /advisory/.test(c.sql))).toBeGreaterThan(-1);
  });

  it("withAudit : si la mutation lève, rien n'est journalisé", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    await expect(
      inCtx(() => audit.withAudit(tx, { action: "user.deleted", entity: "user" }, async () => {
        throw new Error("échec métier");
      })),
    ).rejects.toThrow("échec métier");
    expect(inserts).toHaveLength(0);
  });

  it("méthodes liées : destructurables", async () => {
    const { tx, inserts } = fakeTx();
    const { record } = new AuditService({ clock });
    await inCtx(() => record(tx, { action: "grade.published", entity: "grade" }));
    expect(inserts).toHaveLength(1);
  });
});

describe("verifyChainOn sur lignes en mémoire", () => {
  it("rapporte hash_mismatch / seq_gap / prev_hash_mismatch / head_mismatch", async () => {
    const { tx, inserts } = fakeTx();
    const audit = new AuditService({ clock });
    for (let i = 0; i < 4; i++) await inCtx(() => audit.record(tx, { action: "grade.published", entity: "grade", after: { i } }));

    const toStored = (r: Record<string, unknown>): StoredAuditEntry => ({
      id: r.id as string,
      tenantId: TENANT,
      seq: r.seq as number,
      occurredAt: r.occurred_at as string,
      recordedAt: r.occurred_at as string,
      actorType: r.actor_type as StoredAuditEntry["actorType"],
      actorId: r.actor_id as string | null,
      impersonatedBy: null,
      action: r.action as string,
      entity: r.entity as string,
      entityId: (r.entity_id as string | null) ?? null,
      before: r.before ? JSON.parse(r.before as string) : null,
      after: r.after ? JSON.parse(r.after as string) : null,
      diff: r.diff ? JSON.parse(r.diff as string) : null,
      metadata: r.metadata ? JSON.parse(r.metadata as string) : null,
      ip: null, userAgent: null, device: null,
      requestId: r.request_id as string | null,
      reason: null,
      severity: r.severity as StoredAuditEntry["severity"],
      hashAlg: "sha256",
      keyId: null,
      prevHash: r.prev_hash as string,
      hash: r.hash as string,
    });

    const run = async (rows: StoredAuditEntry[], head: { seq: number; hash: string } | null) => {
      const reader: Tx = {
        query: async () => ({ rows: [], rowCount: 0 }),
        queryOne: async () => (head ? ({ last_seq: String(head.seq), last_hash: head.hash } as never) : null),
        many: async (_sql: string, params?: readonly unknown[]) => {
          const after = Number(params?.[1]);
          const upto = Number(params?.[2]);
          return rows
            .filter((r) => r.seq > after && r.seq <= upto)
            .map((r) => ({
              id: r.id, tenant_id: r.tenantId, seq: String(r.seq), occurred_at: new Date(r.occurredAt), recorded_at: new Date(r.recordedAt),
              actor_type: r.actorType, actor_id: r.actorId, impersonated_by: r.impersonatedBy, action: r.action, entity: r.entity,
              entity_id: r.entityId, before: r.before, after: r.after, diff: r.diff, metadata: r.metadata, ip: r.ip, user_agent: r.userAgent,
              device: r.device, request_id: r.requestId, reason: r.reason, severity: r.severity, hash_alg: r.hashAlg, key_id: r.keyId,
              prev_hash: r.prevHash, hash: r.hash,
            })) as never;
        },
        transaction: async (fn) => fn(reader),
      };
      return verifyChainOn(reader, { kind: "tenant", tenantId: TENANT }, {}, new Map());
    };

    const good = inserts.map(toStored);
    const last = good[good.length - 1]!;
    expect(await run(good, { seq: last.seq, hash: last.hash })).toMatchObject({ ok: true, checked: 4, anchor: "genesis", issues: [] });

    const tampered = good.map((r) => (r.seq === 2 ? { ...r, after: { i: 999 } } : r));
    expect((await run(tampered, { seq: last.seq, hash: last.hash })).issues.map((i) => i.kind)).toEqual(["hash_mismatch"]);

    const gap = good.filter((r) => r.seq !== 3);
    expect((await run(gap, { seq: last.seq, hash: last.hash })).issues.map((i) => i.kind)).toContain("seq_gap");

    const relinked = good.map((r) => (r.seq === 3 ? { ...r, prevHash: "f".repeat(64) } : r));
    const kinds = (await run(relinked, { seq: last.seq, hash: last.hash })).issues.map((i) => i.kind);
    expect(kinds).toContain("prev_hash_mismatch");

    const truncated = good.slice(0, 3);
    expect((await run(truncated, { seq: last.seq, hash: last.hash })).issues.map((i) => i.kind)).toEqual(["head_mismatch"]);

    // Début au milieu (partitions archivées) : ancre de confiance, pas d'anomalie.
    const archived = good.filter((r) => r.seq > 2);
    expect(await run(archived, { seq: last.seq, hash: last.hash })).toMatchObject({ ok: true, anchor: "trusted-anchor", firstSeq: 3 });
  });
});
