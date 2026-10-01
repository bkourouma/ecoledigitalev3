/**
 * Intégration (Postgres réel) : HTTP en lecture seule, helpers de test d'architecture,
 * rétention et archivage par partition.
 */
import { AssertionError } from "node:assert";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import {
  auditChainVerificationSchema,
  auditLogEntrySchema,
  auditLogListResponseSchema,
} from "@ecoledigitale/contracts/src/v2";
import { AuditService } from "../application/audit-service";
import { listAuditPartitions } from "../application/partitions";
import {
  computeGlobalRetentionMonths,
  detachExpiredAuditPartitions,
  getRetentionMonths,
  setRetentionMonths,
} from "../application/retention";
import auditPlugin from "../http/plugin";
import auditRequestMetaPlugin from "../http/request-meta-plugin";
import { expectAudited, expectAuditRolledBack } from "../testing";
import { mapRow, ROW_COLUMNS_TENANT } from "../infrastructure/chain-repository";
import { applyAuditSchema, createTestDb, describeIntegration, newTenant, tamper, type TestDb } from "./helpers";

const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ctxOf = (tenantId: string, userId: string = USER): RequestContext => createRequestContext({ tenantId, userId, requestId: `req-${newId().slice(-8)}` });

describeIntegration("module audit : HTTP, helpers de test, rétention (Postgres réel)", () => {
  let db: TestDb;
  let tdb: TenantDb;
  let sys: SystemDb;
  let audit: AuditService;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDb();
    await applyAuditSchema(db);
    const pool = db.pool((await db.createLogin("it_audit_ops", "app_user")).url, 8);
    tdb = new TenantDb(pool);
    sys = new SystemDb(tdb, { logger: noopLogger });
    audit = new AuditService();

    app = Fastify();
    await app.register(auditRequestMetaPlugin);
    await app.register(auditPlugin, {
      prefix: "/api/v1/audit",
      tenantDb: tdb,
      audit,
      contextOf: (req) =>
        createRequestContext({
          tenantId: String(req.headers["x-tenant"]),
          userId: String(req.headers["x-user"] ?? USER),
          requestId: String(req.id),
        }),
      requirePermission: (permission) => async (req: FastifyRequest, reply: FastifyReply) => {
        const granted = String(req.headers["x-perms"] ?? "").split(",");
        if (!granted.includes(permission)) return reply.code(403).send({ code: "FORBIDDEN" });
      },
    });
    // Route d'exemple d'un module métier : capture ip/user-agent via la portée de requête.
    app.post("/probe", async (req) => {
      const ctx = createRequestContext({ tenantId: String(req.headers["x-tenant"]), userId: USER, requestId: String(req.id) });
      await tdb.run(ctx, (tx) => audit.record(tx, { action: "probe.touched", entity: "probe" }));
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const get = (url: string, tenantId: string, perms = "audit.read,audit.export") =>
    app.inject({ method: "GET", url: `/api/v1/audit${url}`, headers: { "x-tenant": tenantId, "x-perms": perms } });

  const rowsOf = async (tenantId: string) =>
    (await db.admin.query(`SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE tenant_id = $1 ORDER BY seq`, [tenantId])).rows.map((r) => mapRow(r));

  describe("HTTP (lecture seule)", () => {
    let H: string;
    let OTHER: string;
    let someId: string;

    beforeAll(async () => {
      H = await newTenant(db, "http");
      OTHER = await newTenant(db, "http-other");
      const seed: Array<[string, string, "info" | "notice" | "warning" | "critical", string, string]> = [
        ["role.created", "role", "info", USER, "r1"],
        ["role.changed", "role", "warning", USER, "r1"],
        ["grade.published", "grade", "notice", OTHER_USER, "g1"],
        ["role.changed", "role", "critical", OTHER_USER, "r2"],
        ["grade.published", "grade", "info", USER, "g2"],
        ["session.revoked", "session", "notice", USER, "s1"],
        ["role.deleted", "role", "warning", USER, "r2"],
      ];
      for (const [action, entity, severity, actor, entityId] of seed) {
        await tdb.run(ctxOf(H, actor), (tx) =>
          audit.record(tx, { action, entity, entityId, severity, after: { entityId, note: "=1+1" }, reason: action === "role.deleted" ? "=cmd|' /C calc'!A0" : null }),
        );
      }
      await tdb.run(ctxOf(OTHER), (tx) => audit.record(tx, { action: "role.changed", entity: "role", entityId: "secret-other" }));
      someId = (await rowsOf(H))[0]!.id;
    });

    it("n'expose AUCUNE route d'écriture ou de suppression", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        for (const url of ["/logs", `/logs/${someId}`, "/verify", "/logs/export"]) {
          const res = await app.inject({ method, url: `/api/v1/audit${url}`, headers: { "x-tenant": H, "x-perms": "audit.read,audit.export" }, payload: {} });
          expect(res.statusCode, `${method} ${url}`).toBe(404);
        }
      }
      const routes = app.printRoutes({ commonPrefix: false });
      expect(routes).not.toMatch(/POST.*audit\/logs|DELETE.*audit/);
    });

    it("exige les permissions déclarées (audit.read / audit.export)", async () => {
      expect((await get("/logs", H, "")).statusCode).toBe(403);
      expect((await get(`/logs/${someId}`, H, "")).statusCode).toBe(403);
      expect((await get("/verify", H, "")).statusCode).toBe(403);
      expect((await get("/logs/export?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z", H, "audit.read")).statusCode).toBe(403);
      expect((await get("/logs", H, "audit.export")).statusCode).toBe(403);
    });

    it("liste : tri décroissant, pagination par curseur sans doublon ni trou, schéma respecté", async () => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await get(`/logs?limit=3${cursor ? `&cursor=${cursor}` : ""}`, H);
        expect(res.statusCode).toBe(200);
        const body = auditLogListResponseSchema.parse(res.json());
        seen.push(...body.items.map((i) => i.seq));
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual([7, 6, 5, 4, 3, 2, 1]);
    });

    it("liste : isolation (jamais les lignes d'un autre tenant) et filtres", async () => {
      const all = auditLogListResponseSchema.parse((await get("/logs?limit=200", H)).json());
      expect(all.items).toHaveLength(7);
      expect(all.items.every((i) => i.tenantId === H)).toBe(true);
      expect(JSON.stringify(all)).not.toContain("secret-other");

      const q = async (qs: string) => auditLogListResponseSchema.parse((await get(`/logs?${qs}`, H)).json()).items;
      expect((await q("action=role.changed")).map((i) => i.seq)).toEqual([4, 2]);
      expect((await q("action=role.*")).map((i) => i.seq)).toEqual([7, 4, 2, 1]);
      expect((await q("severity=warning,critical")).map((i) => i.seq)).toEqual([7, 4, 2]);
      expect((await q(`actorId=${OTHER_USER}`)).map((i) => i.seq)).toEqual([4, 3]);
      expect((await q("entity=grade")).map((i) => i.seq)).toEqual([5, 3]);
      expect((await q("entity=role&entityId=r2")).map((i) => i.seq)).toEqual([7, 4]);
      const now = Date.now();
      expect(await q(`from=${new Date(now + 3_600_000).toISOString()}`)).toEqual([]);
      expect((await q(`from=${new Date(now - 3_600_000).toISOString()}&to=${new Date(now + 3_600_000).toISOString()}`)).length).toBe(7);
    });

    it("liste : paramètres invalides = 400 (curseur forgé, limite, filtre)", async () => {
      expect((await get("/logs?cursor=forge", H)).statusCode).toBe(400);
      expect((await get("/logs?limit=0", H)).statusCode).toBe(400);
      expect((await get("/logs?limit=500", H)).statusCode).toBe(400);
      expect((await get("/logs?severity=urgent", H)).statusCode).toBe(400);
      expect((await get("/logs?action=DROP%20TABLE", H)).statusCode).toBe(400);
      const res = await get("/logs?actorId=pas-un-uuid", H);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("détail : entrée complète ; entrée d'un autre tenant ou inexistante = 404 ; id invalide = 400", async () => {
      const res = await get(`/logs/${someId}`, H);
      expect(res.statusCode).toBe(200);
      const entry = auditLogEntrySchema.parse(res.json());
      expect(entry).toMatchObject({ id: someId, tenantId: H, seq: 1, action: "role.created" });
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);

      const otherId = (await rowsOf(OTHER))[0]!.id;
      expect((await get(`/logs/${otherId}`, H)).statusCode).toBe(404);
      expect((await get(`/logs/${newId()}`, H)).statusCode).toBe(404);
      expect((await get("/logs/pas-un-uuid", H)).statusCode).toBe(400);
    });

    it("verify : valide, puis détecte une falsification", async () => {
      const ok = auditChainVerificationSchema.parse((await get("/verify", H)).json());
      expect(ok).toMatchObject({ ok: true, checked: 7, anchor: "genesis" });
      await tamper(db, `UPDATE audit.audit_log SET reason = 'falsifié' WHERE tenant_id = $1 AND seq = 4`, [H]);
      const bad = auditChainVerificationSchema.parse((await get("/verify", H)).json());
      expect(bad.ok).toBe(false);
      expect(bad.issues).toEqual([expect.objectContaining({ kind: "hash_mismatch", seq: 4 })]);
      // Remise en état pour les tests suivants (toujours en superuser, trigger désactivé).
      await tamper(db, `UPDATE audit.audit_log SET reason = NULL WHERE tenant_id = $1 AND seq = 4`, [H]);
      expect(auditChainVerificationSchema.parse((await get("/verify?fromSeq=1&toSeq=7", H)).json()).ok).toBe(true);
    });

    it("export CSV : période obligatoire et bornée, neutralisation des formules, et l'export est lui-même journalisé", async () => {
      expect((await get("/logs/export", H)).statusCode).toBe(400);
      const from = new Date(Date.now() - 3_600_000).toISOString();
      const to = new Date(Date.now() + 3_600_000).toISOString();
      expect((await get(`/logs/export?from=${from}`, H)).statusCode).toBe(400);
      expect((await get(`/logs/export?from=${to}&to=${from}`, H)).statusCode).toBe(400);
      const tooLong = new Date(Date.now() + 40 * 86_400_000).toISOString();
      expect((await get(`/logs/export?from=${from}&to=${tooLong}`, H)).statusCode).toBe(400);
      expect((await get(`/logs/export?from=${from}&to=${to}&limit=10001`, H)).statusCode).toBe(400);

      const before = (await rowsOf(H)).length;
      const res = await get(`/logs/export?from=${from}&to=${to}`, H);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/);
      expect(res.headers["x-audit-export-rows"]).toBe("7");
      expect(res.headers["x-audit-export-truncated"]).toBe("false");
      const lines = res.body.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toBe("seq,id,occurred_at,severity,action,entity,entity_id,actor_type,actor_id,impersonated_by,ip,device,request_id,reason,diff,hash");
      expect(lines.length).toBeGreaterThanOrEqual(8);
      // La raison « =cmd|... » ne doit pas pouvoir s'exécuter dans un tableur.
      expect(res.body).toContain(",'=cmd|' /C calc'!A0,");
      expect(res.body).not.toMatch(/(^|,)=cmd/m);

      const rows = await rowsOf(H);
      expect(rows.length).toBe(before + 1);
      expect(rows[rows.length - 1]).toMatchObject({ action: "audit_log.exported", entity: "audit_log", severity: "notice", actorId: USER });
      expect(rows[rows.length - 1]!.metadata).toMatchObject({ rows: 7, truncated: false });

      const capped = await get(`/logs/export?from=${from}&to=${to}&limit=2`, H);
      expect(capped.headers["x-audit-export-rows"]).toBe("2");
      expect(capped.headers["x-audit-export-truncated"]).toBe("true");
    });

    it("ip et appareil capturés depuis la requête HTTP quand ils sont présents", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/probe",
        remoteAddress: "203.0.113.9",
        headers: { "x-tenant": H, "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0" },
      });
      expect(res.statusCode).toBe(200);
      const row = (await rowsOf(H)).filter((r) => r.action === "probe.touched").pop()!;
      expect(row).toMatchObject({ ip: "203.0.113.9", device: "Firefox / Linux (poste)" });
      expect(row.userAgent).toContain("Firefox/125.0");
      expect(row.requestId).toBeTruthy();
    });
  });

  describe("helpers de test d'architecture", () => {
    let T: string;
    beforeAll(async () => {
      T = await newTenant(db, "expect");
    });

    it("expectAudited : passe quand l'opération audite et renvoie les entrées", async () => {
      const { result, entries } = await expectAudited(
        db.pool(db.adminUrl, 2),
        T,
        "grade.published",
        async () => {
          await tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", entityId: "g1" }));
          return "fait";
        },
        { entityId: "g1", actorId: USER, times: 1 },
      );
      expect(result).toBe("fait");
      expect(entries).toHaveLength(1);
    });

    it("expectAudited : échoue, avec un message utile, quand l'opération n'audite pas", async () => {
      const pool = db.pool(db.adminUrl, 2);
      const err = await expectAudited(pool, T, "grade.published", async () => {
        await tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.viewed", entity: "grade" }));
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AssertionError);
      expect((err as Error).message).toMatch(/Opération non auditée.*grade\.published.*grade\.viewed/s);
      await expect(expectAudited(pool, T, "grade.published", async () => undefined)).rejects.toThrow(/\(aucune\)/);
      await expect(
        expectAudited(pool, T, "grade.published", () => tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.published", entity: "grade" })), { times: 2 }),
      ).rejects.toThrow(AssertionError);
    });

    it("expectAuditRolledBack : prouve l'atomicité (échec => aucune trace)", async () => {
      const pool = db.pool(db.adminUrl, 2);
      await expectAuditRolledBack(pool, T, "grade.published", () =>
        tdb.run(ctxOf(T), async (tx) => {
          await audit.record(tx, { action: "grade.published", entity: "grade" });
          throw new Error("échec métier");
        }),
      );
      // Un module qui audite HORS de la transaction métier est pris en défaut.
      await expect(
        expectAuditRolledBack(pool, T, "grade.published", async () => {
          await tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.published", entity: "grade" }));
          throw new Error("échec métier après un audit déjà validé");
        }),
      ).rejects.toThrow(/non atomique/);
    });
  });

  describe("rétention et archivage", () => {
    let C: string;
    let R2: string;
    const monthsAgo = (n: number): Date => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - n);
      return d;
    };
    const nameFor = (d: Date): string => `audit_log_y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    beforeAll(async () => {
      C = await newTenant(db, "ret-c");
      R2 = await newTenant(db, "ret-2");
      // La ligne la plus ancienne est écrite EN PREMIER (seq 1) : l'ordre de seq suit l'ordre du temps.
      await tdb.run(ctxOf(C), (tx) => audit.record(tx, { action: "legacy.imported", entity: "legacy", occurredAt: monthsAgo(96) }));
      for (let i = 0; i < 2; i++) await tdb.run(ctxOf(C), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", entityId: `g${i}` }));
    });

    it("rétention : défaut 60 mois, jamais moins de 12 (service ET base)", async () => {
      expect(await tdb.run(ctxOf(C), (tx) => getRetentionMonths(tx))).toBe(60);
      await expect(tdb.run(ctxOf(C), (tx) => setRetentionMonths(tx, audit, 6, { updatedBy: USER }))).rejects.toMatchObject({ issues: [{ code: "retention_out_of_range" }] });
      await expect(tdb.run(ctxOf(C), (tx) => setRetentionMonths(tx, audit, 12.5, { updatedBy: USER }))).rejects.toMatchObject({ issues: [{ code: "retention_out_of_range" }] });
      await expect(
        tdb.run(ctxOf(C), (tx) => tx.query("INSERT INTO audit.retention_policies (tenant_id, retention_months) VALUES (kernel.current_tenant_id(), 6)")),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(sys.run("audit-it-floor", (tx) => tx.query("SELECT * FROM audit.detach_expired_partitions(6, false)"))).rejects.toThrow(/12 mois/);

      await tdb.run(ctxOf(C), (tx) => setRetentionMonths(tx, audit, 24, { updatedBy: USER, reason: "politique de l'établissement" }));
      expect(await tdb.run(ctxOf(C), (tx) => getRetentionMonths(tx))).toBe(24);
      const changed = (await rowsOf(C)).find((r) => r.action === "retention.changed")!;
      expect(changed).toMatchObject({ severity: "critical", reason: "politique de l'établissement" });
      expect(changed.diff).toEqual({ retentionMonths: { from: 60, to: 24 } });
      // La politique d'un tenant n'est ni visible ni modifiable depuis un autre.
      expect(await tdb.run(ctxOf(R2), (tx) => getRetentionMonths(tx))).toBe(60);
    });

    it("la partition n'est détachée que lorsque la rétention la PLUS LONGUE de tous les tenants est échue", async () => {
      await tdb.run(ctxOf(R2), (tx) => setRetentionMonths(tx, audit, 120, { updatedBy: USER }));
      expect(await computeGlobalRetentionMonths(sys)).toBe(120);
      const dry = await detachExpiredAuditPartitions(sys, audit);
      expect(dry).toMatchObject({ dryRun: true, retentionMonths: 120, partitions: [] });
      await tdb.run(ctxOf(R2), (tx) => setRetentionMonths(tx, audit, 60, { updatedBy: USER }));
    });

    it("simulation (défaut) puis détachement réel, sans DELETE ligne à ligne", async () => {
      const old = nameFor(monthsAgo(96));
      const attached = async () => (await tdb.run(ctxOf(C), (tx) => listAuditPartitions(tx))).map((p) => p.name);
      expect(await attached()).toContain(old);

      const dry = await detachExpiredAuditPartitions(sys, audit);
      expect(dry.dryRun).toBe(true);
      expect(dry.retentionMonths).toBe(60);
      expect(dry.partitions).toEqual([expect.objectContaining({ name: old, detached: false })]);
      expect(await attached()).toContain(old);

      const real = await detachExpiredAuditPartitions(sys, audit, { dryRun: false });
      expect(real.partitions).toEqual([expect.objectContaining({ name: old, detached: true })]);
      expect(await attached()).not.toContain(old);

      // Les données sont conservées intactes dans le schéma d'archive (aucune ligne supprimée)...
      const archived = (await db.admin.query(`SELECT seq, action FROM audit_archive.${old}`)).rows;
      expect(archived).toEqual([{ seq: "1", action: "legacy.imported" }]);
      // ... toujours en ajout seul, et hors de portée de l'application.
      await expect(db.admin.query(`UPDATE audit_archive.${old} SET reason = 'x'`)).rejects.toMatchObject({ code: "AU001" });
      await expect(db.admin.query(`DELETE FROM audit_archive.${old}`)).rejects.toMatchObject({ code: "AU001" });
      await expect(db.admin.query(`TRUNCATE audit_archive.${old}`)).rejects.toMatchObject({ code: "AU001" });
      await expect(tdb.run(ctxOf(C), (tx) => tx.query(`SELECT * FROM audit_archive.${old}`))).rejects.toMatchObject({ code: "42501" });
      // ... et la requête applicative ne la voit plus.
      expect(await tdb.run(ctxOf(C), (tx) => tx.many("SELECT seq FROM audit.audit_log WHERE action = 'legacy.imported'"))).toEqual([]);

      // L'opération est tracée au journal de plateforme.
      const platform = (await db.admin.query("SELECT action, severity, metadata FROM audit.platform_audit_log WHERE action = 'retention.partitions_detached'")).rows;
      expect(platform).toHaveLength(1);
      expect(platform[0]).toMatchObject({ severity: "critical" });
      expect(platform[0].metadata.partitions).toEqual([old]);

      // Idempotent.
      expect((await detachExpiredAuditPartitions(sys, audit, { dryRun: false })).partitions).toEqual([]);
    });

    it("la chaîne reste vérifiable après archivage : ancre de confiance au premier maillon restant", async () => {
      const v = await tdb.run(ctxOf(C), (tx) => audit.verifyChain(tx, C));
      expect(v).toMatchObject({ ok: true, anchor: "trusted-anchor", firstSeq: 2 });
      // Les écritures suivantes continuent la chaîne (la tête n'a pas bougé).
      await tdb.run(ctxOf(C), (tx) => audit.record(tx, { action: "grade.published", entity: "grade" }));
      expect(await tdb.run(ctxOf(C), (tx) => audit.verifyChain(tx, C))).toMatchObject({ ok: true });
    });
  });
});
