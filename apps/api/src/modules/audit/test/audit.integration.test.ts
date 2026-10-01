/**
 * Tests d'intégration sur un Postgres RÉEL (TEST_DATABASE_URL ; sinon ignorés).
 *   node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/audit/vitest.config.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDomainEvent, createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb, assertTenantIsolation } from "@ecoledigitale/database";
import { AuditService } from "../application/audit-service";
import { consumeAuditEvent } from "../application/event-consumer";
import { ensureAuditPartitions, listAuditPartitions } from "../application/partitions";
import { computeEntryHash } from "../domain/hash";
import { MASK } from "../domain/masking";
import { toHashable } from "../application/verify-chain";
import { mapRow, ROW_COLUMNS_TENANT } from "../infrastructure/chain-repository";
import { auditIsolationAllowlist, auditIsolationFixtures } from "../../isolation-allowlist.audit";
import { applyAuditSchema, createTestDb, describeIntegration, newTenant, tamper, type TestDb } from "./helpers";

const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ctxOf = (tenantId: string, userId: string = USER): RequestContext => createRequestContext({ tenantId, userId, requestId: `req-${newId().slice(-8)}` });

describeIntegration("module audit sur Postgres réel", () => {
  let db: TestDb;
  let tdb: TenantDb;
  let sys: SystemDb;
  let audit: AuditService;
  let appUrl: string;
  let A: string;
  let B: string;

  beforeAll(async () => {
    db = await createTestDb();
    await applyAuditSchema(db);
    appUrl = (await db.createLogin("it_audit_app", "app_user")).url;
    const pool = db.pool(appUrl, 10);
    tdb = new TenantDb(pool);
    sys = new SystemDb(tdb, { logger: noopLogger });
    audit = new AuditService();
    A = await newTenant(db, "a");
    B = await newTenant(db, "b");
  });

  afterAll(async () => {
    await db?.drop();
  });

  const rowsOf = async (tenantId: string) =>
    (await db.admin.query(`SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE tenant_id = $1 ORDER BY seq`, [tenantId])).rows.map((r) => mapRow(r));

  describe("structure", () => {
    it("table partitionnée par mois, partitions créées à l'avance (>= 14), migrations idempotentes", async () => {
      const kind = (await db.admin.query("SELECT relkind FROM pg_class WHERE oid = 'audit.audit_log'::regclass")).rows[0].relkind;
      expect(kind).toBe("p");
      const parts = await tdb.run(ctxOf(A), (tx) => listAuditPartitions(tx));
      expect(parts.length).toBeGreaterThanOrEqual(14);
      const now = new Date();
      const current = `audit_log_y${now.getUTCFullYear()}m${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      expect(parts.map((p) => p.name)).toContain(current);
      for (const p of parts) expect(new Date(p.to as string).getTime()).toBeGreaterThan(new Date(p.from as string).getTime());
      const again = await applyAuditSchema(db);
      expect(again.applied).toEqual([]);
    });

    it("RLS activée ET forcée avec la policy tenant_isolation sur le parent ET sur chaque partition", async () => {
      const { rows } = await db.admin.query(`
        SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
          FROM pg_class c
         WHERE c.oid = 'audit.audit_log'::regclass
            OR c.oid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = 'audit.audit_log'::regclass)`);
      expect(rows.length).toBeGreaterThanOrEqual(15);
      for (const r of rows) expect({ name: r.relname, rls: r.rls, forced: r.forced, policies: Number(r.policies) }).toEqual({ name: r.relname, rls: true, forced: true, policies: 1 });
    });
  });

  describe("record", () => {
    it("écrit dans la même transaction, remplit le contexte, masque, calcule le diff et chaîne", async () => {
      const ctx = ctxOf(A);
      await tdb.run(ctx, async (tx) => {
        await audit.record(tx, {
          action: "user.updated",
          entity: "user",
          entityId: "u-1",
          before: { email: "a@b.ci", password: "ancien-secret", role: "teacher" },
          after: { email: "c@d.ci", password: "nouveau-secret", role: "teacher" },
          reason: "demande de l'utilisateur",
          severity: "notice",
          request: { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/124.0 Mobile Safari/537.36" },
        });
      });
      const [row] = (await rowsOf(A)).slice(-1);
      expect(row).toMatchObject({
        tenantId: A,
        actorType: "user",
        actorId: USER,
        requestId: ctx.requestId,
        action: "user.updated",
        entity: "user",
        entityId: "u-1",
        severity: "notice",
        ip: "203.0.113.7",
        device: "Chrome / Android (mobile)",
        reason: "demande de l'utilisateur",
        hashAlg: "sha256",
      });
      expect(row!.before).toEqual({ email: "a@b.ci", password: MASK, role: "teacher" });
      expect(row!.after).toEqual({ email: "c@d.ci", password: MASK, role: "teacher" });
      expect(row!.diff).toEqual({ email: { from: "a@b.ci", to: "c@d.ci" }, password: { from: MASK, to: MASK } });
      // Aucune trace du secret nulle part dans la ligne.
      const raw = (await db.admin.query("SELECT row_to_json(l)::text AS j FROM audit.audit_log l WHERE tenant_id = $1 AND seq = $2", [A, row!.seq])).rows[0].j;
      expect(raw).not.toContain("ancien-secret");
      expect(raw).not.toContain("nouveau-secret");
      // Le hash stocké est celui que l'on recalcule depuis les valeurs relues en base.
      expect(computeEntryHash(toHashable(row!)).hash).toBe(row!.hash);
    });

    it("est atomique avec l'opération : annulée avec la transaction, validée avec elle", async () => {
      const before = (await rowsOf(A)).length;
      await expect(
        tdb.run(ctxOf(A), async (tx) => {
          await audit.record(tx, { action: "grade.published", entity: "grade", entityId: "g-rollback" });
          throw new Error("échec après audit");
        }),
      ).rejects.toThrow("échec après audit");
      expect((await rowsOf(A)).length).toBe(before);
      // La tête n'a pas bougé non plus : le chaînage reste continu.
      await tdb.run(ctxOf(A), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", entityId: "g-commit" }));
      expect((await rowsOf(A)).length).toBe(before + 1);
      expect(await tdb.run(ctxOf(A), (tx) => audit.verifyChain(tx, A))).toMatchObject({ ok: true });
    });

    it("withAudit : capture avant/après autour de la mutation", async () => {
      await db.admin.query("CREATE TABLE IF NOT EXISTS public.zz_audit_probe (id text PRIMARY KEY, name text)");
      await db.admin.query("GRANT SELECT, INSERT, UPDATE ON public.zz_audit_probe TO app_user");
      await db.admin.query("INSERT INTO public.zz_audit_probe VALUES ('p1', 'avant')");
      await tdb.run(ctxOf(A), (tx) =>
        audit.withAudit(
          tx,
          { action: "probe.renamed", entity: "probe", entityId: "p1", snapshot: (t) => t.queryOne("SELECT id, name FROM public.zz_audit_probe WHERE id = 'p1'") },
          () => tx.query("UPDATE public.zz_audit_probe SET name = 'après' WHERE id = 'p1'"),
        ),
      );
      const row = (await rowsOf(A)).filter((r) => r.action === "probe.renamed")[0]!;
      expect(row.before).toEqual({ id: "p1", name: "avant" });
      expect(row.after).toEqual({ id: "p1", name: "après" });
      expect(row.diff).toEqual({ name: { from: "avant", to: "après" } });
    });

    it("refuse un tenant différent de celui de la transaction (message clair) ; la RLS refuse aussi l'insertion directe", async () => {
      await expect(
        tdb.run(ctxOf(B), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", tenantId: A })),
      ).rejects.toMatchObject({ code: "AUDIT_TENANT_MISMATCH" });
      // Sans passer par le service : INSERT forgé portant le tenant A depuis une transaction du tenant B.
      await expect(
        tdb.run(ctxOf(B), (tx) =>
          tx.query(
            `INSERT INTO audit.audit_log (id, tenant_id, seq, occurred_at, actor_type, action, entity, hash_alg, prev_hash, hash)
             VALUES ($1, $2, 1, now(), 'system', 'x.y', 'x', 'sha256', $3, $4)`,
            [newId(), A, "0".repeat(64), "1".repeat(64)],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("append-only effectif", () => {
    it("app_user : UPDATE, DELETE et TRUNCATE refusés par les droits", async () => {
      for (const sql of ["UPDATE audit.audit_log SET reason = 'x'", "DELETE FROM audit.audit_log", "TRUNCATE audit.audit_log"]) {
        await expect(tdb.run(ctxOf(A), (tx) => tx.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
      }
    });

    it("le PROPRIÉTAIRE de la table (migrator) est aussi bloqué, par le trigger (SQLSTATE AU001)", async () => {
      const asOwner = async (sql: string): Promise<unknown> => {
        await db.admin.query("BEGIN");
        try {
          await db.admin.query("SET LOCAL ROLE migrator");
          await db.admin.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
          await db.admin.query(sql);
          return null;
        } catch (e) {
          return e;
        } finally {
          await db.admin.query("ROLLBACK");
        }
      };
      for (const sql of [
        "UPDATE audit.audit_log SET reason = 'réécrit'",
        "DELETE FROM audit.audit_log",
        "TRUNCATE audit.audit_log",
        // Troncature directe d'une partition (le trigger d'instruction n'est pas hérité : posé par partition).
        `TRUNCATE audit.audit_log_y${new Date().getUTCFullYear()}m${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
      ]) {
        const err = await asOwner(sql);
        expect(err, sql).toMatchObject({ code: "AU001" });
      }
    });

    it("un superuser est bloqué lui aussi par le trigger (sauf à le désactiver explicitement, ce que le chaînage détecte)", async () => {
      await expect(db.admin.query("UPDATE audit.audit_log SET reason = 'x' WHERE tenant_id = $1", [A])).rejects.toMatchObject({ code: "AU001" });
      await expect(db.admin.query("DELETE FROM audit.audit_log WHERE tenant_id = $1", [A])).rejects.toMatchObject({ code: "AU001" });
    });

    it("la tête de chaîne ne peut qu'avancer de 1 et ne se supprime pas ; app_user ne l'écrit pas", async () => {
      await expect(tdb.run(ctxOf(A), (tx) => tx.query("UPDATE audit.chain_heads SET last_seq = 99"))).rejects.toMatchObject({ code: "42501" });
      await expect(tdb.run(ctxOf(A), (tx) => tx.query("DELETE FROM audit.chain_heads"))).rejects.toMatchObject({ code: "42501" });
      await expect(db.admin.query("UPDATE audit.chain_heads SET last_seq = last_seq + 5 WHERE tenant_id = $1", [A])).rejects.toMatchObject({ code: "AU003" });
      await expect(db.admin.query("DELETE FROM audit.chain_heads WHERE tenant_id = $1", [A])).rejects.toMatchObject({ code: "AU001" });
    });

    it("le trigger de garde refuse une chaîne incohérente même insérée à la main (seq/prev_hash)", async () => {
      const head = (await db.admin.query("SELECT last_seq, last_hash FROM audit.chain_heads WHERE tenant_id = $1", [A])).rows[0];
      const insert = (seq: number, prev: string) =>
        tdb.run(ctxOf(A), (tx) =>
          tx.query(
            `INSERT INTO audit.audit_log (id, tenant_id, seq, occurred_at, actor_type, action, entity, hash_alg, prev_hash, hash)
             VALUES ($1, $2, $3, now(), 'system', 'x.y', 'x', 'sha256', $4, $5)`,
            [newId(), A, seq, prev, "2".repeat(64)],
          ),
        );
      await expect(insert(Number(head.last_seq) + 2, head.last_hash)).rejects.toMatchObject({ code: "AU002" });
      await expect(insert(Number(head.last_seq) + 1, "9".repeat(64))).rejects.toMatchObject({ code: "AU002" });
    });
  });

  describe("isolation tenant sur partitions", () => {
    it("un tenant ne voit que ses lignes, via le parent comme en accès direct à une partition", async () => {
      await tdb.run(ctxOf(B), (tx) => audit.record(tx, { action: "course.created", entity: "course", entityId: "c-b" }));
      const seenByB = await tdb.run(ctxOf(B), (tx) => tx.many("SELECT DISTINCT tenant_id FROM audit.audit_log"));
      expect(seenByB).toEqual([{ tenant_id: B }]);
      const seenByA = await tdb.run(ctxOf(A), (tx) => tx.many("SELECT DISTINCT tenant_id FROM audit.audit_log"));
      expect(seenByA).toEqual([{ tenant_id: A }]);

      // Accès direct à une partition : refusé faute de droits...
      const now = new Date();
      const part = `audit.audit_log_y${now.getUTCFullYear()}m${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      await expect(tdb.run(ctxOf(A), (tx) => tx.query(`SELECT * FROM ${part}`))).rejects.toMatchObject({ code: "42501" });
      // ... et, même si on accordait le droit, la RLS posée SUR la partition filtre encore par tenant.
      await db.admin.query(`GRANT SELECT ON ${part} TO app_user`);
      try {
        const direct = await tdb.run(ctxOf(B), (tx) => tx.many(`SELECT DISTINCT tenant_id FROM ${part}`));
        expect(direct).toEqual([{ tenant_id: B }]);
        const none = await tdb.run(ctxOf(await newTenant(db, "empty")), (tx) => tx.many(`SELECT 1 FROM ${part}`));
        expect(none).toEqual([]);
      } finally {
        await db.admin.query(`REVOKE SELECT ON ${part} FROM app_user`);
      }
    });

    it("sans contexte tenant (SystemDb.run) : aucune ligne visible, aucune écriture possible", async () => {
      expect(await sys.run("audit-it-no-tenant", (tx) => tx.many("SELECT 1 FROM audit.audit_log"))).toEqual([]);
      await expect(
        sys.run("audit-it-no-tenant", (tx) => audit.record(tx, { action: "x.y", entity: "x", tenantId: A, actor: { type: "system", id: null } })),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("le test d'isolation générique passe sur le schéma audit (allowlist = journal de plateforme)", async () => {
      const report = await assertTenantIsolation({
        pool: db.pool(appUrl, 2),
        schemas: ["audit"],
        allowlist: auditIsolationAllowlist,
        fixtures: auditIsolationFixtures,
      });
      expect(report.violations).toEqual([]);
      // Comportement prouvé sur le parent partitionné et sur retention_policies ; les partitions
      // (accès direct) et chain_heads (écrite par trigger seulement) n'ont, PAR CONCEPTION, aucun
      // droit d'insertion pour app_user : structure vérifiée, insertion non fabricable.
      expect(report.behavioural).toEqual(expect.arrayContaining(["audit.audit_log", "audit.retention_policies"]));
      expect(report.structuralOnly.every((t) => /permission denied/.test(t.reason))).toBe(true);
      expect(report.structuralOnly.filter((t) => /^audit\.audit_log_y\d{4}m\d{2}$/.test(t.table)).length).toBeGreaterThanOrEqual(14);
      expect(report.allowlisted.sort()).toEqual(["audit.platform_audit_log", "audit.platform_chain_head"]);
    });
  });

  describe("concurrence", () => {
    it("50 insertions parallèles gardent une chaîne valide, sans trou ni doublon", async () => {
      const T = await newTenant(db, "conc");
      const N = 50;
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", entityId: `g-${i}`, after: { i } })),
        ),
      );
      const rows = await rowsOf(T);
      expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      expect(new Set(rows.map((r) => r.entityId)).size).toBe(N);
      const v = await tdb.run(ctxOf(T), (tx) => audit.verifyChain(tx, T));
      expect(v).toMatchObject({ ok: true, checked: N, firstSeq: 1, lastSeq: N, headSeq: N, anchor: "genesis", issues: [] });
    });

    it("des tenants différents n'attendent pas la chaîne les uns des autres", async () => {
      const T1 = await newTenant(db, "lock1");
      const T2 = await newTenant(db, "lock2");
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let holding!: () => void;
      const holdingLock = new Promise<void>((r) => (holding = r));

      // T1 : écrit puis garde sa transaction ouverte (donc son verrou de chaîne) tant qu'on ne la relâche pas.
      const t1 = tdb.run(ctxOf(T1), async (tx) => {
        await audit.record(tx, { action: "grade.published", entity: "grade" });
        holding();
        await gate;
      });
      await holdingLock;

      // T2 n'est pas bloqué...
      await expect(
        Promise.race([
          tdb.run(ctxOf(T2), (tx) => audit.record(tx, { action: "grade.published", entity: "grade" })),
          new Promise((_, rej) => setTimeout(() => rej(new Error("T2 bloqué par la chaîne de T1")), 3000)),
        ]),
      ).resolves.toMatchObject({ seq: 1 });

      // ... alors qu'un second écrivain de T1 attend bien le verrou.
      let secondDone = false;
      const t1b = tdb.run(ctxOf(T1), (tx) => audit.record(tx, { action: "grade.published", entity: "grade" })).then(() => (secondDone = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(secondDone).toBe(false);
      release();
      await Promise.all([t1, t1b]);
      expect((await rowsOf(T1)).map((r) => r.seq)).toEqual([1, 2]);
    });
  });

  describe("verifyChain face à un administrateur qui falsifie", () => {
    const fresh = async (n = 5): Promise<string> => {
      const T = await newTenant(db, "tamper");
      for (let i = 0; i < n; i++) await tdb.run(ctxOf(T), (tx) => audit.record(tx, { action: "grade.published", entity: "grade", entityId: `g-${i}`, after: { note: 10 + i } }));
      return T;
    };
    const verify = (T: string, range = {}) => tdb.run(ctxOf(T), (tx) => audit.verifyChain(tx, T, range));

    it("contenu modifié -> hash_mismatch sur la ligne exacte", async () => {
      const T = await fresh();
      expect(await verify(T)).toMatchObject({ ok: true });
      await tamper(db, `UPDATE audit.audit_log SET after = '{"note": 20}'::jsonb WHERE tenant_id = $1 AND seq = 3`, [T]);
      const v = await verify(T);
      expect(v.ok).toBe(false);
      expect(v.issues).toEqual([expect.objectContaining({ kind: "hash_mismatch", seq: 3 })]);
    });

    it("ligne supprimée au milieu -> seq_gap ; dernière ligne supprimée -> head_mismatch", async () => {
      const T = await fresh();
      await tamper(db, "DELETE FROM audit.audit_log WHERE tenant_id = $1 AND seq = 3", [T]);
      expect((await verify(T)).issues.map((i) => i.kind)).toContain("seq_gap");

      const T2 = await fresh();
      await tamper(db, "DELETE FROM audit.audit_log WHERE tenant_id = $1 AND seq = 5", [T2]);
      expect((await verify(T2)).issues.map((i) => i.kind)).toEqual(["head_mismatch"]);
    });

    it("lien cassé et début de chaîne falsifié", async () => {
      const T = await fresh();
      await tamper(db, `UPDATE audit.audit_log SET prev_hash = $2 WHERE tenant_id = $1 AND seq = 4`, [T, "a".repeat(64)]);
      expect((await verify(T)).issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["prev_hash_mismatch", "hash_mismatch"]));

      const T2 = await fresh();
      await tamper(db, `UPDATE audit.audit_log SET prev_hash = $2 WHERE tenant_id = $1 AND seq = 1`, [T2, "b".repeat(64)]);
      expect((await verify(T2)).issues.map((i) => i.kind)).toContain("genesis_mismatch");
    });

    it("vérification d'une plage (par seq et par période)", async () => {
      const T = await fresh(8);
      await tamper(db, `UPDATE audit.audit_log SET reason = 'oups' WHERE tenant_id = $1 AND seq = 7`, [T]);
      expect(await verify(T, { fromSeq: 1, toSeq: 5 })).toMatchObject({ ok: true, checked: 5 });
      expect((await verify(T, { fromSeq: 6, toSeq: 8 })).issues).toEqual([expect.objectContaining({ kind: "hash_mismatch", seq: 7 })]);
      const now = Date.now();
      expect(await verify(T, { from: new Date(now - 3_600_000), to: new Date(now + 3_600_000) })).toMatchObject({ checked: 8 });
      expect(await verify(T, { from: new Date(now + 3_600_000) })).toMatchObject({ checked: 0, anchor: "empty" });
    });

    it("limite documentée : SHA-256 simple se réécrit en entier avec l'accès en écriture ; HMAC non", async () => {
      // 1. Chaîne SHA-256 : un administrateur réécrit TOUTE la chaîne (contenu, hash, liens, tête) -> valide.
      const T = await fresh(4);
      const rewrite = async (alg: "sha256", mutate: (n: number) => Record<string, unknown>) => {
        const rows = await rowsOf(T);
        let prev = "0".repeat(64);
        await db.admin.query("BEGIN");
        await db.admin.query("SET LOCAL session_replication_role = replica");
        for (const r of rows) {
          const changed = { ...r, ...mutate(r.seq), prevHash: prev, hashAlg: alg, keyId: null };
          const { hash } = computeEntryHash(toHashable(changed));
          await db.admin.query(
            "UPDATE audit.audit_log SET after = $3::jsonb, prev_hash = $4, hash = $5, hash_alg = 'sha256', key_id = NULL WHERE tenant_id = $1 AND seq = $2",
            [T, r.seq, JSON.stringify(changed.after), prev, hash],
          );
          prev = hash;
        }
        await db.admin.query("UPDATE audit.chain_heads SET last_hash = $2 WHERE tenant_id = $1", [T, prev]);
        await db.admin.query("COMMIT");
      };
      await rewrite("sha256", (seq) => (seq === 2 ? { after: { note: 999 } } : {}));
      expect(await verify(T)).toMatchObject({ ok: true }); // NON détecté : c'est la limite, d'où HMAC / ancrage externe.

      // 2. Chaîne HMAC : sans la clé, la réécriture « SHA-256 » est détectée dès qu'on exige HMAC.
      const hmac = new AuditService({ hmac: { activeKeyId: "k1", keys: { k1: "cle-hmac-de-test-0123456789" } } });
      const H = await newTenant(db, "hmac");
      for (let i = 0; i < 3; i++) await tdb.run(ctxOf(H), (tx) => hmac.record(tx, { action: "grade.published", entity: "grade", after: { note: i } }));
      const hv = (service: AuditService, range = {}) => tdb.run(ctxOf(H), (tx) => service.verifyChain(tx, H, range));
      expect(await hv(hmac)).toMatchObject({ ok: true, checked: 3 });
      // Sans la clé : contenu invérifiable, signalé (jamais « valide » par défaut).
      expect((await hv(new AuditService())).issues.map((i) => i.kind)).toEqual(["key_unavailable", "key_unavailable", "key_unavailable"]);
      // Falsification d'une ligne HMAC sans connaître la clé -> hash_mismatch.
      await tamper(db, `UPDATE audit.audit_log SET after = '{"note": 42}'::jsonb WHERE tenant_id = $1 AND seq = 2`, [H]);
      expect((await hv(hmac)).issues).toEqual([expect.objectContaining({ kind: "hash_mismatch", seq: 2 })]);
      // Réécriture complète en SHA-256 par un attaquant sans clé : détectée avec requireHmac.
      const rows = await rowsOf(H);
      let prev = "0".repeat(64);
      await db.admin.query("BEGIN");
      await db.admin.query("SET LOCAL session_replication_role = replica");
      for (const r of rows) {
        const { hash } = computeEntryHash(toHashable({ ...r, prevHash: prev, hashAlg: "sha256", keyId: null }));
        await db.admin.query("UPDATE audit.audit_log SET prev_hash = $3, hash = $4, hash_alg = 'sha256', key_id = NULL WHERE tenant_id = $1 AND seq = $2", [H, r.seq, prev, hash]);
        prev = hash;
      }
      await db.admin.query("UPDATE audit.chain_heads SET last_hash = $2 WHERE tenant_id = $1", [H, prev]);
      await db.admin.query("COMMIT");
      expect((await hv(hmac)).ok).toBe(true);
      const strict = await hv(hmac, { requireHmac: true });
      expect(strict.ok).toBe(false);
      expect(strict.issues.every((i) => i.kind === "weak_hash")).toBe(true);
    });
  });

  describe("partitions", () => {
    it("ensureAuditPartitions est idempotent et sûr en parallèle", async () => {
      const count = async () => Number((await db.admin.query("SELECT count(*) FROM pg_inherits WHERE inhparent = 'audit.audit_log'::regclass")).rows[0].count);
      const before = await count();
      const first = await ensureAuditPartitions(sys, 16, 2);
      expect(first.length).toBeGreaterThan(0); // mois 13..16 et 2 mois en arrière
      expect(await count()).toBe(before + first.length);
      expect(await ensureAuditPartitions(sys, 16, 2)).toEqual([]);
      const parallel = await Promise.all(Array.from({ length: 5 }, () => ensureAuditPartitions(sys, 20, 0)));
      const created = parallel.flat();
      expect(new Set(created).size).toBe(created.length); // chaque partition créée une seule fois
      expect(await count()).toBe(before + first.length + created.length);
      expect(await ensureAuditPartitions(sys, 20, 0)).toEqual([]);
    });

    it("bornes de la fonction SQL : mois hors plage refusés, non-superuser sans DDL direct", async () => {
      await expect(sys.run("audit-it-bounds", (tx) => tx.query("SELECT audit.ensure_partitions(100, 0)"))).rejects.toThrow(/bornes/);
      await expect(sys.run("audit-it-bounds", (tx) => tx.query("SELECT audit.create_partition(DATE '2026-01-01')"))).rejects.toMatchObject({ code: "42501" });
      await expect(sys.run("audit-it-bounds", (tx) => tx.query("CREATE TABLE audit.evil (id int)"))).rejects.toMatchObject({ code: "42501" });
    });

    it("repli : un événement daté d'un mois sans partition crée la partition au lieu d'échouer", async () => {
      const exists = async (name: string) => (await db.admin.query("SELECT to_regclass($1) AS r", [`audit.${name}`])).rows[0].r !== null;
      expect(await exists("audit_log_y2021m03")).toBe(false);
      await tdb.run(ctxOf(A), (tx) => audit.record(tx, { action: "legacy.imported", entity: "legacy", occurredAt: "2021-03-15T08:00:00.000Z" }));
      expect(await exists("audit_log_y2021m03")).toBe(true);
      const row = (await rowsOf(A)).find((r) => r.action === "legacy.imported")!;
      expect(row.occurredAt).toBe("2021-03-15T08:00:00.000Z");
      // Une date absurde est refusée plutôt que de créer des partitions à l'infini.
      await expect(tdb.run(ctxOf(A), (tx) => audit.record(tx, { action: "legacy.imported", entity: "legacy", occurredAt: "1990-01-01T00:00:00.000Z" }))).rejects.toThrow(/hors plage/);
    });
  });

  describe("consommation d'événements", () => {
    const deps = () => ({ systemDb: sys, audit });
    const ctx = () => ctxOf(A);

    it("événement de tenant : écrit une fois, rejeu = doublon sans effet", async () => {
      const event = createDomainEvent({ type: "rbac.role.changed", ctx: ctx(), payload: { roleId: "r1", before: { perms: ["a"] }, after: { perms: ["a", "b"] }, change: "updated" } });
      const before = (await rowsOf(A)).length;
      const first = await consumeAuditEvent(deps(), event);
      expect(first).toMatchObject({ status: "recorded", scope: "tenant" });
      const again = await consumeAuditEvent(deps(), event);
      expect(again).toMatchObject({ status: "duplicate", scope: "tenant" });
      const rows = (await rowsOf(A)).slice(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: event.id,
        action: "role.changed",
        entity: "role",
        entityId: "r1",
        actorType: "user",
        actorId: USER,
        severity: "warning",
      });
      expect(rows[0]!.occurredAt).toBe(event.occurredAt);
      expect(rows[0]!.diff).toEqual({ perms: { from: ["a"], to: ["a", "b"] } });
      expect(await tdb.run(ctxOf(A), (tx) => audit.verifyChain(tx, A))).toMatchObject({ ok: true });
    });

    it("rejeu simultané du même événement : une seule ligne", async () => {
      const event = createDomainEvent({ type: "tenancy.tenant.suspended", ctx: ctx(), payload: { tenantId: A, reason: "impayé" } });
      const before = (await rowsOf(A)).length;
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => consumeAuditEvent(deps(), event)));
      expect(outcomes.filter((o) => o.status === "recorded")).toHaveLength(1);
      expect((await rowsOf(A)).length).toBe(before + 1);
    });

    it("événement iam sans tenant : journal de plateforme (SystemDb), chaîné et vérifiable", async () => {
      const nilTenant = "00000000-0000-0000-0000-000000000000";
      const mk = (email: string) => ({
        ...createDomainEvent({ type: "iam.login.failed", ctx: ctx(), payload: { email, cause: "unknown_account", ip: "198.51.100.4", userAgent: "curl/8" } }),
        tenantId: nilTenant,
      });
      const e1 = mk("inconnu@x.ci");
      const e2 = mk("autre@x.ci");
      expect(await consumeAuditEvent(deps(), e1)).toMatchObject({ status: "recorded", scope: "platform" });
      expect(await consumeAuditEvent(deps(), e1)).toMatchObject({ status: "duplicate", scope: "platform" });
      await consumeAuditEvent(deps(), e2);
      const rows = (await db.admin.query("SELECT seq, action, actor_type, ip, metadata FROM audit.platform_audit_log ORDER BY seq")).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ seq: "1", action: "login.failed", actor_type: "system", ip: "198.51.100.4" });
      expect(rows[0].metadata).toMatchObject({ identifier: "inconnu@x.ci", cause: "unknown_account" });
      const v = await sys.run("audit-it-verify-platform", (tx) => audit.verifyPlatformChain(tx), { readOnly: true });
      expect(v).toMatchObject({ ok: true, checked: 2, anchor: "genesis" });
      // Append-only aussi pour la plateforme.
      await expect(db.admin.query("DELETE FROM audit.platform_audit_log")).rejects.toMatchObject({ code: "AU001" });
      await expect(sys.run("audit-it-nodelete", (tx) => tx.query("DELETE FROM audit.platform_audit_log"))).rejects.toMatchObject({ code: "42501" });
    });

    it("événement non abonné : ignoré", async () => {
      const event = createDomainEvent({ type: "finance.payment.completed", ctx: ctx(), payload: {} });
      expect(await consumeAuditEvent(deps(), event)).toEqual({ status: "ignored", reason: "no_handler" });
    });
  });
});
