/**
 * Module stateassign (sans base) : manifeste, événements alignés sur les contrats, fichiers conventionnels, garde-fous de contenu
 * (aucune horloge système, aucun flottant monétaire, aucune règle officielle) et chargement du plugin PAR LE REGISTRE.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, Money, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { STATEASSIGN_ERROR_CODES, stateassignEventPayloadSchemas, ASSIGNMENT_STATUSES } from "@ecoledigitale/contracts/src/v2/stateassign";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { ASSIGNMENT_TRANSITIONS } from "../../domain/assignment";
import { StateassignCode } from "../../domain/errors";
import { ALL_STATEASSIGN_EVENT_TYPES } from "../../domain/events";
import { assignmentPayload, receivablePayload } from "../../application/support";
import { PERMISSIONS } from "../../http/guards";
import manifest from "../../manifest";
import type { AssignmentRecord, ReceivableRecord } from "../../domain/types";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });
const dir = resolve(__dirname, "../..");

function sources(root: string, out: string[] = []): string[] {
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) {
      if (!["test", "migrations", "node_modules"].includes(name)) sources(p, out);
    } else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("module stateassign : manifeste", () => {
  it("manifeste valide : permissions préfixées par la clé, features, menus liés à une permission et une feature du module", () => {
    expect(manifest.key).toBe("stateassign");
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
    expect(manifest.packs).toEqual(["SECONDARY"]);
    for (const p of manifest.permissions) expect(p.key.startsWith("stateassign.")).toBe(true);
    const permissions = new Set(manifest.permissions.map((p) => p.key));
    const features = new Set(manifest.features.map((f) => f.key));
    expect(features).toEqual(new Set(["stateassign.core", "stateassign.gateway"]));
    for (const m of manifest.menus) {
      expect(permissions.has(m.permission), m.key).toBe(true);
      if (m.feature) expect(features.has(m.feature), m.key).toBe(true);
      expect(m.href.startsWith("/v2/stateassign")).toBe(true);
    }
    // la passerelle est RÉSERVÉE : aucun pack ne l'inclut en V1
    expect(manifest.features.find((f) => f.key === "stateassign.gateway")!.packs).toEqual([]);
  });

  it("les actes réglementaires sont des permissions SENSIBLES (MFA + audit) : vérifier, gérer, amender, réglages", () => {
    const sensitive = new Set(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key));
    expect(sensitive).toEqual(new Set(["stateassign.verify", "stateassign.manage", "stateassign.amend", "stateassign.settings.manage"]));
  });

  it("les gardes HTTP n'utilisent que des permissions du manifeste", () => {
    const declared = new Set(manifest.permissions.map((p) => p.key));
    for (const key of Object.values(PERMISSIONS)) expect(declared.has(key), key).toBe(true);
    expect(declared.size).toBe(Object.values(PERMISSIONS).length);
  });

  it("événements publiés = constantes du domaine = schémas de charge des contrats ; noms <module>.<entité>.<verbe>", () => {
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_STATEASSIGN_EVENT_TYPES].sort());
    expect(Object.keys(stateassignEventPayloadSchemas).sort()).toEqual([...ALL_STATEASSIGN_EVENT_TYPES].sort());
    for (const type of manifest.events.publishes) expect(type).toMatch(/^stateassign\.[a-z_]+\.[a-z_]+$/);
    expect([...manifest.events.consumes].sort()).toEqual(["finance.invoice.issued", "finance.payment.completed"]);
  });

  it("les charges réellement construites par le module respectent leur schéma de contrat (aucun nom, aucune référence d'acte)", () => {
    const now = new Date("2026-10-15T09:00:00Z");
    const a: AssignmentRecord = {
      id: "0192f0a4-7b1e-7c3a-8d2e-000000000001", institutionId: "0192f0a4-7b1e-7c3a-8d2e-000000000002", academicYearId: "0192f0a4-7b1e-7c3a-8d2e-000000000003",
      enrollmentId: "0192f0a4-7b1e-7c3a-8d2e-000000000004", studentId: "0192f0a4-7b1e-7c3a-8d2e-000000000005", version: 2, supersedesId: null, reference: "AFF-SECRET-1",
      issuedOn: null, issuingAuthority: null, source: "MANUAL", externalRef: null, externalPayloadHash: null, declaredState: Money.of(1, "XOF"), declaredParent: null, currency: "XOF",
      status: "VERIFIED", receivedBy: null, receivedAt: now, verifiedBy: null, verifiedAt: now, verificationNote: null, activatedAt: null, suspendedAt: null, suspensionReason: null,
      endedOn: null, endReason: null, rejectionReason: null, scholarshipId: null, stateInvoiceId: null, parentInvoiceId: null, reconciliationStatus: "NEVER", lastReconciledAt: null,
      stateDelta: null, parentDelta: null, notes: null, rowVersion: 1, createdAt: now,
    };
    const payload = assignmentPayload(a, "RECEIVED");
    expect(stateassignEventPayloadSchemas["stateassign.assignment.verified"].parse(payload)).toMatchObject({ status: "VERIFIED", previousStatus: "RECEIVED" });
    expect(JSON.stringify(payload)).not.toContain("AFF-SECRET-1");
    const r: ReceivableRecord = {
      id: a.id, assignmentId: a.id, institutionId: a.institutionId, academicYearId: a.academicYearId, enrollmentId: a.enrollmentId, studentId: a.studentId, seq: 1, label: "Libellé secret",
      dueOn: "2026-11-01", expected: Money.of(100, "XOF"), received: Money.of(10, "XOF"), status: "PARTIALLY_RECEIVED", lastReconciledAt: null, overdueFlaggedAt: null, cancelReason: null, rowVersion: 1, createdAt: now,
    };
    const rp = receivablePayload(r, 12);
    expect(stateassignEventPayloadSchemas["stateassign.receivable.overdue"].parse(rp)).toMatchObject({ daysOverdue: 12, expected: { amount: 100, currency: "XOF" } });
    expect(JSON.stringify(rp)).not.toContain("Libellé secret");
  });

  it("les codes d'erreur du module sont ceux des contrats (une seule liste), les statuts du domaine ceux des contrats", () => {
    expect(new Set(Object.values(StateassignCode))).toEqual(new Set(STATEASSIGN_ERROR_CODES));
    expect(Object.keys(ASSIGNMENT_TRANSITIONS).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
  });

  it("fichiers conventionnels présents ; migrations dans la plage 2300-2399 uniquement", () => {
    for (const f of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(join(dir, f)), f).toBe(true);
    const migrations = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    for (const m of migrations) {
      const n = Number(m.slice(0, 4));
      expect(n >= 2300 && n <= 2399, m).toBe(true);
    }
  });
});

describe("module stateassign : garde-fous de contenu", () => {
  const files = sources(dir);

  it("aucune horloge système (Date.now / new Date() sans argument) : l'horloge est injectée", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/Date\.now\(\)|new Date\(\s*\)/.test(text)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("aucun flottant monétaire : ni parseFloat, ni toFixed ; les montants passent par Money", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/parseFloat|toFixed\(/.test(text)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("aucune règle officielle ni liste réglementaire dans le code : pas de série, de plafond de revenus, de barème ou de taux livrés", () => {
    const banned = /\b(barème|plafond de ressources|quota national|taux de prise en charge|BEPC|BAC|série [A-Z]\d?)\b/i;
    const hits: string[] = [];
    for (const f of files.filter((x) => !x.endsWith("manifest.ts") && !x.endsWith("export.ts"))) {
      for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
        // les commentaires qui DISENT qu'aucun barème n'est livré sont permis
        if (banned.test(line) && !/aucun|jamais|sans|pas de|non |ni /i.test(line)) hits.push(`${f}:${i + 1}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("aucun SQL hors de infrastructure/ (le domaine et l'application n'écrivent aucune requête)", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /[\\/](domain|application|http)[\\/]/.test(x))) {
      if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[\s\S]{0,40}\b(FROM|SET|VALUES|stateassign\.)/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});

describe("module stateassign : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[], features: string[] = ["stateassign.core"]) {
    const guarded: string[] = [];
    const runtime = {
      tenantDb: { run: async () => { throw new Error("la base ne doit pas être touchée dans ce test"); } },
      clock: systemClock,
      env: {},
      logger: quiet,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      entitlements: {
        requireFeature: (key: string) => async () => {
          if (!features.includes(key)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature: key } });
        },
        isFeatureEnabled: async (_c: RequestContext, key: string) => features.includes(key),
      },
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const discovered: DiscoveredModule = {
      key: "stateassign",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, loaded };
  }

  it("monte les routes sous /api/v1/stateassign avec la signature (app, runtime) et le registre de ports sur la racine", async () => {
    const { app: instance, loaded } = await boot(["stateassign.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/stateassign"]);
    expect(instance.hasDecorator("stateassignPorts")).toBe(true);
    const res = await instance.inject({ method: "GET", url: "/api/v1/stateassign/gateway/status", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, adapter: "NotConfigured" });
    expect((await instance.inject({ method: "GET", url: "/gateway/status", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401), sans permission (403) et sans la feature stateassign.core (403 entitlements), avec les permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot(["stateassign.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/stateassign/assignments" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "POST", url: "/api/v1/stateassign/assignments", headers: { "x-tenant": TENANT }, payload: { enrollmentId: USER, reference: "x" } });
    expect(denied.statusCode).toBe(403);
    for (const p of guarded) expect(manifest.permissions.map((m) => m.key)).toContain(p);
    resetRegistryForTests();
    await instance.close();
    const off = await boot(["stateassign.read"], []);
    const res = await off.app.inject({ method: "GET", url: "/api/v1/stateassign/gateway/status", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("entitlements.feature_not_available");
  });
});
