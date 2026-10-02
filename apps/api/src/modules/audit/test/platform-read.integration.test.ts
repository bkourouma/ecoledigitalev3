/**
 * Lecture du journal de PLATEFORME par l'API publique du module (`listPlatformAuditLogs`) sur un Postgres réel :
 * curseur complet sans doublon ni trou, filtres, bornes de taille, curseur invalide, lecture seule, étanchéité avec
 * le journal des tenants, projection publique sans maillon précédent de la chaîne.
 *
 *   node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/audit/vitest.config.ts
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createRequestContext, noopLogger, newId } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { AuditService, listAuditLogs, listPlatformAuditLogs, toAuditSummaryDto, type LogPage } from "../index";
import { applyAuditSchema, createTestDb, describeIntegration, newTenant, type TestDb } from "./helpers";

const OP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

describeIntegration("lecture du journal de plateforme (module audit, Postgres réel)", () => {
  let db: TestDb;
  let tdb: TenantDb;
  let sys: SystemDb;
  let audit: AuditService;
  let tenant: string;
  const TOTAL = 23;

  beforeAll(async () => {
    db = await createTestDb();
    await applyAuditSchema(db);
    const appUrl = (await db.createLogin("it_audit_platform_read", "app_user")).url;
    tdb = new TenantDb(db.pool(appUrl, 10));
    sys = new SystemDb(tdb, { logger: noopLogger });
    audit = new AuditService();
    tenant = await newTenant(db, "p");
    // 23 entrées de plateforme : 3 actions, 2 opérateurs, 2 niveaux de sévérité, 2 entités
    for (let i = 0; i < TOTAL; i += 1) {
      await sys.run("audit-it-seed-platform", (tx) =>
        audit.recordPlatform(tx, {
          action: i % 3 === 0 ? "platform.tenant.provisioned" : i % 3 === 1 ? "platform.tenant.status_changed" : "platform.plan.upserted",
          entity: i % 3 === 2 ? "plan" : "tenant",
          entityId: i % 3 === 2 ? "STARTER" : `tenant-${i % 2}`,
          severity: i % 2 === 0 ? "notice" : "warning",
          actor: { type: "superAdmin", id: i < 10 ? OP_A : OP_B },
          reason: `motif ${i}`,
          before: { secret: `avant-${i}` },
          after: { secret: `apres-${i}` },
          metadata: { n: i },
        }),
      );
    }
    // une entrée de TENANT : ne doit jamais apparaître dans le journal de plateforme
    await tdb.run(createRequestContext({ tenantId: tenant, userId: OP_A }), (tx) => audit.record(tx, { action: "tenant.chose.faite", entity: "chose" }));
  });
  afterAll(async () => {
    await db?.drop();
  });

  const read = (filter = {}, options: { cursor?: string; limit?: number } = {}): Promise<LogPage> =>
    sys.run("audit-it-read-platform", (tx) => listPlatformAuditLogs(tx, filter, options), { readOnly: true });
  async function all(filter = {}, limit = 5) {
    const items = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i += 1) {
      const page = await read(filter, { limit, ...(cursor ? { cursor } : {}) });
      items.push(...page.items);
      if (!page.nextCursor) return items;
      expect(page.items).toHaveLength(limit);
      cursor = page.nextCursor;
    }
    throw new Error("pagination sans fin");
  }
  const dbIds = async (where = "TRUE", params: unknown[] = []) => (await db.admin.query(`SELECT id FROM audit.platform_audit_log WHERE ${where} ORDER BY seq DESC`, params)).rows.map((r) => r.id as string);

  it("pagination complète : pour toute taille de page, la concaténation des pages = la table, sans doublon ni trou, plus récent d'abord", async () => {
    const expected = await dbIds();
    expect(expected).toHaveLength(TOTAL);
    for (const limit of [1, 2, 5, 22, 23, 24, 200]) {
      const items = await all({}, limit);
      expect(items.map((i) => i.id), `limit=${limit}`).toEqual(expected);
      expect(items.map((i) => i.seq)).toEqual([...items.map((i) => i.seq)].sort((a, b) => b - a));
    }
  });

  it("une page exacte n'annonce pas de page suivante ; limite hors bornes ramenée à [1, 200] ; curseur invalide refusé", async () => {
    expect((await read({}, { limit: TOTAL })).nextCursor).toBeNull();
    expect((await read({}, { limit: TOTAL - 1 })).nextCursor).not.toBeNull();
    expect((await read({}, { limit: 0 })).items).toHaveLength(1);
    expect((await read({}, { limit: 100_000 })).items).toHaveLength(TOTAL);
    for (const bad of ["x", "e30", Buffer.from('{"s":0}').toString("base64url"), Buffer.from('{"s":"1"}').toString("base64url")]) {
      await expect(read({}, { cursor: bad })).rejects.toMatchObject({ httpStatus: 400 });
    }
    const first = await read({}, { limit: TOTAL });
    const lastSeq = first.items[first.items.length - 1]!.seq;
    expect(await read({}, { cursor: Buffer.from(JSON.stringify({ s: lastSeq })).toString("base64url") })).toEqual({ items: [], nextCursor: null });
  });

  it("filtres : action exacte et préfixe, acteur, entité, sévérité, période ; combinaison ; `%` et `_` traités littéralement", async () => {
    expect((await all({ action: "platform.tenant.status_changed" })).map((i) => i.id)).toEqual(await dbIds("action = 'platform.tenant.status_changed'"));
    expect((await all({ action: "platform.tenant.*" }, 4)).map((i) => i.id)).toEqual(await dbIds("action LIKE 'platform.tenant.%'"));
    expect((await all({ action: "platform.*" })).map((i) => i.id)).toEqual(await dbIds());
    expect((await all({ action: "platform.%.*" }))).toEqual([]); // `%` échappé : pas un joker
    expect((await all({ action: "platform_tenant.*" }))).toEqual([]); // `_` échappé : pas un joker
    expect((await all({ actorId: OP_A }, 3)).map((i) => i.id)).toEqual(await dbIds("actor_id = $1", [OP_A]));
    expect((await all({ actorId: OP_B })).length).toBe(TOTAL - 10);
    expect((await all({ entity: "plan" })).map((i) => i.id)).toEqual(await dbIds("entity = 'plan'"));
    expect((await all({ entity: "tenant", entityId: "tenant-1" })).map((i) => i.id)).toEqual(await dbIds("entity = 'tenant' AND entity_id = 'tenant-1'"));
    expect((await all({ severity: ["warning"] })).every((i) => i.severity === "warning")).toBe(true);
    expect((await all({ severity: ["warning", "notice"] })).length).toBe(TOTAL);
    expect((await all({ severity: ["critical"] }))).toEqual([]);
    const rows = (await db.admin.query("SELECT occurred_at FROM audit.platform_audit_log ORDER BY seq")).rows;
    const mid = (rows[11]!.occurred_at as Date).toISOString();
    expect((await all({ from: mid })).map((i) => i.id)).toEqual(await dbIds("occurred_at >= $1", [mid]));
    expect((await all({ to: mid })).map((i) => i.id)).toEqual(await dbIds("occurred_at <= $1", [mid]));
    const combined = await all({ action: "platform.tenant.*", actorId: OP_A, severity: ["warning"], from: mid }, 2);
    expect(combined.map((i) => i.id)).toEqual(await dbIds("action LIKE 'platform.tenant.%' AND actor_id = $1 AND severity = 'warning' AND occurred_at >= $2", [OP_A, mid]));
  });

  it("étanche : le journal de plateforme ne montre aucune entrée de tenant, et inversement", async () => {
    const platform = await all({}, 50);
    expect(platform.every((i) => i.tenantId === null)).toBe(true);
    expect(platform.some((i) => i.action === "tenant.chose.faite")).toBe(false);
    const tenantPage = await tdb.run(createRequestContext({ tenantId: tenant, userId: OP_A }), (tx) => listAuditLogs(tx, tenant, {}, {}), { readOnly: true });
    expect(tenantPage.items.map((i) => i.action)).toEqual(["tenant.chose.faite"]);
  });

  it("projection publique : ni avant/après/metadata, ni maillon précédent, algorithme ou clé ; `hash` et `seq` seuls", async () => {
    const [item] = (await read({}, { limit: 1 })).items;
    const dto = toAuditSummaryDto(item!);
    expect(Object.keys(dto).sort()).toEqual(["action", "actorId", "actorType", "device", "diff", "entity", "entityId", "hash", "id", "impersonatedBy", "ip", "occurredAt", "reason", "recordedAt", "requestId", "seq", "severity", "tenantId"]);
    expect(dto.tenantId).toBeNull();
    expect(dto.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(dto)).not.toMatch(/avant-|apres-|prevHash|keyId|hashAlg/);
  });

  it("lecture seule : la transaction refuse toute écriture et la lecture n'ajoute aucun maillon", async () => {
    const before = (await db.admin.query("SELECT count(*)::int AS n, max(seq)::int AS head FROM audit.platform_audit_log")).rows[0];
    await read({}, { limit: 3 });
    await expect(sys.run("audit-it-ro-check", (tx) => tx.query("INSERT INTO audit.platform_audit_log (id) VALUES ($1)", [newId()]), { readOnly: true })).rejects.toBeTruthy();
    expect((await db.admin.query("SELECT count(*)::int AS n, max(seq)::int AS head FROM audit.platform_audit_log")).rows[0]).toEqual(before);
  });
});
