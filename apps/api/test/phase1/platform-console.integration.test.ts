/**
 * Console plateforme sur la VRAIE plateforme (vrais plugins legacy, vrai registre, Postgres et Redis réels) :
 *
 *  1. `GET /api/v1/platform/audit/logs` : journal de plateforme, authentifié par le `SuperAdminAuthorizer` (JWT
 *     super-admin legacy), jeton de tenant refusé, pagination par curseur COMPLÈTE (ni doublon ni trou, comparée à la
 *     base), filtres, chaîne de hachage non exposée au-delà de `seq` et `hash`.
 *  2. Contrats Zod de `POST /platform/tenants`, `PATCH /platform/tenants/:id/status` et `GET /platform/tenants`
 *     validés contre les RÉPONSES HTTP RÉELLES (et inversement : aucune clé réelle absente du contrat).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformProvisionTenantResponseSchema,
  PlatformSetTenantStatusResponseSchema,
  PlatformTenantListResponseSchema,
  auditLogListResponseSchema,
  platformAuditLogListResponseSchema,
} from "@ecoledigitale/contracts/v2";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, type HttpResult, type Phase1Env } from "./support/harness";
import { loginWithMfaEnrollment, provisionByConsole, readAuditLog, redeemInvitation, type ProvisionedOwner, type Session } from "./support/scenario";

const AUDIT = "/api/v1/platform/audit/logs";
const LIST_KEYS = ["id", "tenantId", "seq", "occurredAt", "recordedAt", "actorType", "actorId", "impersonatedBy", "action", "entity", "entityId", "diff", "ip", "device", "requestId", "reason", "severity", "hash"].sort();
const keysOf = (o: object): string[] => Object.keys(o).sort();

describeIntegration.skipIf(!REDIS_URL)("console plateforme : journal d'audit de plateforme et contrats de réponse", () => {
  let p: Phase1Env;
  let owner: ProvisionedOwner;
  let ownerSession: Session;
  let provisioned: HttpResult;
  let statusResponses: HttpResult[] = [];

  const op = (url: string, token: string | undefined = p?.operatorToken) => p.http("GET", url, token ? { token } : {});
  /** Toutes les pages (curseur) pour une requête donnée ; vérifie au passage que chaque page respecte la taille demandée. */
  async function allPages(query: string, limit: number): Promise<any[]> {
    const items: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const res: HttpResult = await op(`${AUDIT}?limit=${limit}${query ? `&${query}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(limit);
      items.push(...res.body.items);
      cursor = res.body.nextCursor;
      if (!cursor) return items;
      expect(res.body.items.length, "une page non finale est pleine").toBe(limit);
    }
    throw new Error("pagination sans fin");
  }
  const dbPlatformIds = async (where = "TRUE", params: unknown[] = []): Promise<string[]> =>
    (await p.db.admin.query(`SELECT id FROM audit.platform_audit_log WHERE ${where} ORDER BY seq DESC`, params)).rows.map((r: { id: string }) => r.id);

  beforeAll(async () => {
    p = await startPhase1Platform({ startWorker: false });
    // Le POST réel : on garde la réponse brute pour la valider contre le contrat.
    provisioned = await p.http("POST", "/api/v1/platform/tenants", {
      token: p.operatorToken,
      body: { name: "Tenant Console", slug: "console-ci", countryCode: "CI", packs: ["HIGHER", "PRIMARY"], adminContact: { name: "Responsable Console", email: "owner@console.test", phone: "+225 07 00 00 00 00" } },
    });
    owner = await provisionByConsole(p, { name: "Tenant Console Bis", slug: "console-bis", packs: ["HIGHER"], ownerEmail: "bis@console.test" });
    await redeemInvitation(p, owner.ownerEmail);
    ownerSession = await loginWithMfaEnrollment(p, owner.ownerEmail, owner.slug);
    // 14 changements de statut : de quoi remplir plusieurs pages (suspension = `warning`, réactivation = `notice`)
    for (let i = 0; i < 7; i += 1) {
      statusResponses.push(await p.http("PATCH", `/api/v1/platform/tenants/${owner.tenantId}/status`, { token: p.operatorToken, body: { status: "suspended", reason: `Impayé n°${i + 1}` } }));
      statusResponses.push(await p.http("PATCH", `/api/v1/platform/tenants/${owner.tenantId}/status`, { token: p.operatorToken, body: { status: "active" } }));
    }
  }, 300_000);
  afterAll(async () => {
    await p?.stop();
  });

  // ------------------------------------------------------------------------------------------------ contrats
  it("POST /platform/tenants : la réponse réelle (201) respecte PlatformProvisionTenantResponseSchema, sans clé hors contrat ni secret", () => {
    expect(provisioned.status, provisioned.raw).toBe(201);
    const parsed = PlatformProvisionTenantResponseSchema.safeParse(provisioned.body);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    // inversement : tout ce que l'API renvoie est décrit par le contrat (les objets Zod ignorent les clés inconnues)
    const shape = PlatformProvisionTenantResponseSchema.shape;
    expect(keysOf(provisioned.body)).toEqual(Object.keys(shape).sort());
    expect(keysOf(provisioned.body.owner)).toEqual(Object.keys(shape.owner.shape).sort());
    expect(keysOf(provisioned.body.subscription)).toEqual(Object.keys(shape.subscription.shape).sort());
    for (const inst of provisioned.body.institutions) expect(keysOf(inst)).toEqual(Object.keys(shape.institutions.element.shape).sort());
    expect(provisioned.body.institutions.map((i: { pack: string }) => i.pack).sort()).toEqual(["HIGHER", "PRIMARY"]);
    expect(provisioned.body.subscription).toMatchObject({ status: "TRIALING" });
    expect(provisioned.raw).not.toMatch(/token|password|secret/i);
    expect(provisioned.body).not.toHaveProperty("onboarding");
  });

  it("PATCH /platform/tenants/:id/status : suspension et réactivation respectent PlatformSetTenantStatusResponseSchema", () => {
    expect(statusResponses).toHaveLength(14);
    statusResponses.forEach((r, i) => {
      expect(r.status, r.raw).toBe(200);
      const parsed = PlatformSetTenantStatusResponseSchema.safeParse(r.body);
      expect(parsed.success, r.raw).toBe(true);
      expect(keysOf(r.body)).toEqual(Object.keys(PlatformSetTenantStatusResponseSchema.shape).sort());
      expect(r.body).toEqual({ tenantId: owner.tenantId, previous: i % 2 === 0 ? "active" : "suspended", current: i % 2 === 0 ? "suspended" : "active" });
    });
  });

  it("PATCH …/status : erreurs normalisées (déjà au statut : 409 ; inconnu : 404 ; corps invalide : 400)", async () => {
    const same = await p.http("PATCH", `/api/v1/platform/tenants/${owner.tenantId}/status`, { token: p.operatorToken, body: { status: "active" } });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe("tenancy.tenant_status_unchanged");
    const unknown = await p.http("PATCH", `/api/v1/platform/tenants/0192f0a4-7b1e-7c3a-8d2e-00000000dead/status`, { token: p.operatorToken, body: { status: "suspended" } });
    expect(unknown.status).toBe(404);
    expect((await p.http("PATCH", `/api/v1/platform/tenants/${owner.tenantId}/status`, { token: p.operatorToken, body: { status: "detruit" } })).status).toBe(400);
    expect((await p.http("PATCH", `/api/v1/platform/tenants/${owner.tenantId}/status`, { token: p.operatorToken, body: { status: "suspended", reason: "x" } })).status).toBe(400);
  });

  it("GET /platform/tenants : la liste réelle respecte PlatformTenantListResponseSchema", async () => {
    const res = await op("/api/v1/platform/tenants?limit=50");
    expect(res.status).toBe(200);
    expect(PlatformTenantListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.items.map((t: { slug: string }) => t.slug)).toEqual(expect.arrayContaining(["console-ci", "console-bis"]));
  });

  // ------------------------------------------------------------------------------------------------ authentification
  it("GET /platform/audit/logs : opérateur super-admin accepté ; sans jeton, jeton de tenant (IAM ou legacy) et jeton forgé refusés", async () => {
    const ok = await op(AUDIT);
    expect(ok.status, ok.raw).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect((await p.http("GET", AUDIT)).status).toBe(401);
    expect((await op(AUDIT, ownerSession.accessToken)).status).toBe(401);
    const legacyToken = p.generateLegacyToken({ id: "0192f0a4-7b1e-7c3a-8d2e-0000000000a2", tenantId: owner.tenantId, tenantSlug: owner.slug, role: "admin" });
    expect((await op(AUDIT, legacyToken)).status).toBe(401);
    expect((await op(AUDIT, "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.AAAA")).status).toBe(401);
    // opérateur désactivé : refusé (403), puis rétabli
    p.legacy.superAdmins.set(p.operatorId, { active: false });
    expect((await op(AUDIT)).status).toBe(403);
    p.legacy.superAdmins.set(p.operatorId, { active: true });
    expect((await op(AUDIT)).status).toBe(200);
  });

  it("lecture seule : aucune route d'écriture sur le journal de plateforme", async () => {
    const count = async () => (await p.db.admin.query("SELECT count(*)::int AS n FROM audit.platform_audit_log")).rows[0].n as number;
    const before = await count();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await p.http(method, AUDIT, { token: p.operatorToken, body: {} });
      expect(res.status, method).toBeGreaterThanOrEqual(400);
      expect(res.status, method).toBeLessThan(500);
    }
    expect(p.app.hasRoute({ method: "GET", url: AUDIT })).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) expect(p.app.hasRoute({ method, url: AUDIT }), method).toBe(false);
    expect(await count()).toBe(before);
  });

  // ------------------------------------------------------------------------------------------------ contenu
  it("même enveloppe que l'audit d'un tenant : { items, nextCursor }, conforme aux contrats plateforme ET tenant, plus récent d'abord", async () => {
    const res = await op(`${AUDIT}?limit=200`);
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(["items", "nextCursor"]);
    expect(platformAuditLogListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(auditLogListResponseSchema.safeParse(res.body).success, "l'écran web valide avec le schéma d'audit des tenants").toBe(true);
    const seqs = res.body.items.map((i: { seq: number }) => i.seq);
    expect(seqs).toEqual([...seqs].sort((a: number, b: number) => b - a));
    expect(new Set(seqs).size).toBe(seqs.length);
    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.tenant.provisioned", "platform.tenant.status_changed"]));
    const changed = res.body.items.find((i: { action: string }) => i.action === "platform.tenant.status_changed");
    expect(changed).toMatchObject({ tenantId: null, actorType: "superAdmin", actorId: p.operatorId, entity: "tenant" });
  });

  it("chaîne de hachage : seuls `seq` et `hash` sortent ; ni maillon précédent, ni algorithme, ni clé, ni avant/après/metadata/user-agent", async () => {
    const res = await op(`${AUDIT}?limit=200`);
    for (const item of res.body.items) {
      expect(keysOf(item)).toEqual(LIST_KEYS);
      expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const forbidden of ["prevHash", "prev_hash", "keyId", "key_id", "hashAlg", "hash_alg", "before", "after", "metadata", "userAgent", "user_agent"]) {
      expect(res.raw, forbidden).not.toContain(`"${forbidden}"`);
    }
    // le `hash` exposé est bien celui de la ligne (pas d'autre valeur dérivée) ; aucune ligne de tenant ne fuit dans ce journal
    const rows = (await p.db.admin.query("SELECT id, seq, hash FROM audit.platform_audit_log ORDER BY seq DESC LIMIT 5")).rows;
    for (const r of rows) {
      const item = res.body.items.find((i: { id: string }) => i.id === r.id);
      expect(item).toMatchObject({ seq: Number(r.seq), hash: r.hash });
    }
  });

  it("le journal d'un tenant ne contient aucune entrée de plateforme (journaux séparés)", async () => {
    const tenantLog = await readAuditLog(p, ownerSession.accessToken);
    expect(tenantLog.length).toBeGreaterThan(0);
    expect(tenantLog.filter((e) => String(e.action).startsWith("platform."))).toEqual([]);
    expect(tenantLog.every((e) => e.tenantId === owner.tenantId)).toBe(true);
  });

  // ------------------------------------------------------------------------------------------------ pagination
  it("pagination par curseur : COMPLÈTE (ni doublon ni trou) pour plusieurs tailles de page, identique au contenu de la base", async () => {
    const expected = await dbPlatformIds();
    expect(expected.length).toBeGreaterThanOrEqual(16);
    for (const limit of [1, 3, 5, 7, expected.length, expected.length + 10 > 200 ? 200 : expected.length + 10]) {
      const items = await allPages("", limit);
      expect(items.map((i) => i.id), `limit=${limit}`).toEqual(expected);
    }
  });

  it("curseur : invalide → 400 ; limites de taille → 400 ; au-delà de la fin → page vide ; une page exacte ne promet pas de page suivante vide", async () => {
    for (const bad of ["pas-un-curseur", "e30", Buffer.from(JSON.stringify({ s: -4 })).toString("base64url"), Buffer.from(JSON.stringify({ s: "1; DROP TABLE x" })).toString("base64url")]) {
      const r = await op(`${AUDIT}?cursor=${encodeURIComponent(bad)}`);
      expect(r.status, bad).toBe(400);
    }
    expect((await op(`${AUDIT}?limit=0`)).status).toBe(400);
    expect((await op(`${AUDIT}?limit=201`)).status).toBe(400);
    expect((await op(`${AUDIT}?limit=abc`)).status).toBe(400);
    const first = await op(`${AUDIT}?limit=1`);
    const lastSeq = (await p.db.admin.query("SELECT min(seq) AS m FROM audit.platform_audit_log")).rows[0].m;
    const beyond = Buffer.from(JSON.stringify({ s: Number(lastSeq) })).toString("base64url"); // seq < min : rien
    const empty = await op(`${AUDIT}?cursor=${beyond}`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], nextCursor: null });
    const total = (await dbPlatformIds()).length;
    const exact = await op(`${AUDIT}?limit=${total}`);
    expect(exact.body.items).toHaveLength(total);
    expect(exact.body.nextCursor).toBeNull();
    expect(first.body.nextCursor).not.toBeNull();
  });

  // ------------------------------------------------------------------------------------------------ filtres
  it("filtre `action` : exact, préfixe `x.*` ; pagination complète sous filtre ; format invalide → 400", async () => {
    const exactIds = await dbPlatformIds("action = $1", ["platform.tenant.status_changed"]);
    expect(exactIds).toHaveLength(14);
    expect((await allPages("action=platform.tenant.status_changed", 4)).map((i) => i.id)).toEqual(exactIds);
    const prefixIds = await dbPlatformIds("action LIKE 'platform.tenant.%'");
    expect(prefixIds.length).toBeGreaterThan(exactIds.length);
    expect((await allPages("action=platform.tenant.*", 6)).map((i) => i.id)).toEqual(prefixIds);
    expect((await allPages("action=platform.*", 50)).map((i) => i.id)).toEqual(await dbPlatformIds("action LIKE 'platform.%'"));
    expect((await allPages("action=platform.inconnue", 10))).toEqual([]);
    expect((await op(`${AUDIT}?action=${encodeURIComponent("Platform;DROP")}`)).status).toBe(400);
    // `%` et `_` du LIKE sont neutralisés
    expect((await op(`${AUDIT}?action=${encodeURIComponent("platform.%")}`)).status).toBe(400);
  });

  it("filtres `severity`, `actorId`, `entity` / `entityId`", async () => {
    const warn = await allPages("severity=warning", 3);
    expect(warn.map((i) => i.id)).toEqual(await dbPlatformIds("severity = 'warning'"));
    expect(warn.length).toBeGreaterThanOrEqual(7);
    expect(warn.every((i) => i.severity === "warning")).toBe(true);
    const both = await allPages("severity=warning,notice", 50);
    expect(both.map((i) => i.id)).toEqual(await dbPlatformIds("severity IN ('warning','notice')"));
    expect((await op(`${AUDIT}?severity=urgent`)).status).toBe(400);

    const mine = await allPages(`actorId=${p.operatorId}`, 50);
    expect(mine.map((i) => i.id)).toEqual(await dbPlatformIds("actor_id = $1 OR impersonated_by = $1", [p.operatorId]));
    expect(mine.length).toBeGreaterThan(0);
    expect(await allPages("actorId=0192f0a4-7b1e-7c3a-8d2e-00000000beef", 10)).toEqual([]);
    expect((await op(`${AUDIT}?actorId=pas-un-uuid`)).status).toBe(400);

    const ofTenant = await allPages(`entity=tenant&entityId=${owner.tenantId}`, 5);
    expect(ofTenant.map((i) => i.id)).toEqual(await dbPlatformIds("entity = 'tenant' AND entity_id = $1", [owner.tenantId]));
    expect(ofTenant.length).toBeGreaterThanOrEqual(15); // provisionnement + 14 changements de statut
    expect(ofTenant.every((i) => i.entityId === owner.tenantId)).toBe(true);
  });

  it("filtres `from` / `to` : bornes inclusives sur occurredAt, combinables avec les autres filtres ; date invalide → 400", async () => {
    const rows = (await p.db.admin.query("SELECT id, occurred_at FROM audit.platform_audit_log ORDER BY seq ASC")).rows as Array<{ id: string; occurred_at: Date }>;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    expect((await allPages(`from=${last.occurred_at.toISOString()}`, 10)).map((i) => i.id)).toContain(last.id);
    expect(await allPages("from=2999-01-01T00:00:00.000Z", 10)).toEqual([]);
    expect(await allPages("to=2000-01-01T00:00:00.000Z", 10)).toEqual([]);
    const window = await allPages(`from=${first.occurred_at.toISOString()}&to=${last.occurred_at.toISOString()}`, 7);
    expect(window.map((i) => i.id)).toEqual(await dbPlatformIds("occurred_at >= $1 AND occurred_at <= $2", [first.occurred_at, last.occurred_at]));
    const combined = await allPages(`action=platform.tenant.status_changed&severity=warning&from=${first.occurred_at.toISOString()}`, 2);
    expect(combined.map((i) => i.id)).toEqual(await dbPlatformIds("action = 'platform.tenant.status_changed' AND severity = 'warning'"));
    expect((await op(`${AUDIT}?from=hier`)).status).toBe(400);
  });

  it("lire le journal n'écrit rien : aucun nouveau maillon dans la chaîne de plateforme", async () => {
    const before = (await p.db.admin.query("SELECT count(*)::int AS n, max(seq)::int AS head FROM audit.platform_audit_log")).rows[0];
    await allPages("", 5);
    await op(`${AUDIT}?action=platform.*`);
    const after = (await p.db.admin.query("SELECT count(*)::int AS n, max(seq)::int AS head FROM audit.platform_audit_log")).rows[0];
    expect(after).toEqual(before);
  });
});
