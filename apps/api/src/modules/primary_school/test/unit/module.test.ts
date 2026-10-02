/**
 * Unitaires : manifeste, conformité des migrations avec le DDL testé de la spec, absence de constante réglementaire,
 * contrats Zod, et chargement du plugin PAR LE REGISTRE (signature (app, runtime), préfixe, gardes, échec fermé des ports).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import {
  PRIMARY_BULK_MAX_LINES,
  PRIMARY_EVENT_TYPES,
  primaryBulkRecordBodySchema,
  primaryCreateScaleBodySchema,
  primaryPutAttendanceBodySchema,
  primaryReviseBodySchema,
  primaryReissueBodySchema,
  primarySummaryQuerySchema,
} from "@ecoledigitale/contracts/src/v2/primary_school";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import { rbacManifest } from "../../../rbac";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { ALL_PRIMARY_EVENT_TYPES, ConsumedEvents } from "../../domain/events";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { SENSITIVE_PERMISSIONS } from "../support/permissions";

const MODULE_DIR = resolve(__dirname, "../..");
const U = "0192f0a4-7b1e-7c3a-8d2e-000000000001";

describe("manifeste", () => {
  it("est valide : clé = dossier, permissions bien formées et uniques, menus et features rattachés au module", () => {
    expect(manifest.key).toBe("primary_school");
    expect(manifest.packs).toEqual(["PRIMARY"]);
    const order = resolveModuleOrder([rbacManifest, manifest]).map((m) => m.key);
    expect(order.indexOf("rbac")).toBeLessThan(order.indexOf("primary_school"));
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of manifest.menus) {
      expect(keys, m.key).toContain(m.permission);
      if (m.feature) expect(manifest.features.map((f) => f.key), m.key).toContain(m.feature);
    }
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["primary.annual-review", "primary.competencies", "primary.council", "primary.reports", "primary.year-archive"]);
  });

  it("marque SENSIBLES la révision, le scellement, la réémission, le gel et l'application du modèle (MFA + audit)", () => {
    expect([...SENSITIVE_PERMISSIONS].sort()).toEqual(["primary.archive.freeze", "primary.bilan.reissue", "primary.bilan.seal", "primary.competency.revise", "primary.template.apply"]);
  });

  it("publie des événements <module>.<entité>.<verbe> alignés sur les contrats ; consomme ceux des autres modules", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^primary_school\.[a-z_]+\.[a-z_]+$/);
    expect([...ALL_PRIMARY_EVENT_TYPES].sort()).toEqual([...PRIMARY_EVENT_TYPES].sort());
    expect([...manifest.events.publishes].sort()).toEqual([...PRIMARY_EVENT_TYPES].sort());
    expect(manifest.events.consumes).toEqual(expect.arrayContaining([ConsumedEvents.INSTITUTION_CREATED, ConsumedEvents.DECISION_CONFIRMED, ConsumedEvents.CLASSROOM_PERIOD_CLOSED]));
  });

  it("ses fichiers conventionnels existent ; abonnés et jobs ont des noms stables et préfixés", () => {
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md", "templates/CI/primary.json"]) {
      expect(existsSync(resolve(MODULE_DIR, file)), file).toBe(true);
    }
    const names = subscribers.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^primary_school\./);
    expect(names).toEqual(expect.arrayContaining(["primary_school.instantiate-reference-data", "primary_school.on-decision-confirmed", "primary_school.request-review-document", "primary_school.on-document-rendered"]));
    expect(jobs.map((j) => j.name)).toEqual(["primary_school.purge-draft-reviews"]);
  });
});

describe("migrations", () => {
  const specDir = resolve(MODULE_DIR, "../../../../../specs/v2/005-primary/ddl/migrations");
  const files = readdirSync(resolve(MODULE_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();

  it("sont dans la plage 1800-1899 réservée au module, nommées et ordonnées", () => {
    expect(files).toEqual(["1800_primary_school_reference.sql", "1801_primary_school_competency_assessments.sql", "1802_primary_school_council_bilan.sql", "1803_primary_school_council_minutes.sql"]);
    for (const f of files) {
      const n = Number(f.slice(0, 4));
      expect(n).toBeGreaterThanOrEqual(1800);
      expect(n).toBeLessThanOrEqual(1899);
    }
  });

  it("sont IDENTIQUES au DDL de référence testé de la spec 005 (104 + 14 tests de comportement)", () => {
    const norm = (s: string): string => s.replace(/\r\n/g, "\n");
    for (const f of files) expect(norm(readFileSync(resolve(MODULE_DIR, "migrations", f), "utf8")), f).toBe(norm(readFileSync(resolve(specDir, f), "utf8")));
  });

  it("respectent les règles de plateforme : RLS forcée sur chaque table, aucune clé étrangère hors kernel.tenants", () => {
    const sql = files.map((f) => readFileSync(resolve(MODULE_DIR, "migrations", f), "utf8")).join("\n");
    const tables = [...sql.matchAll(/CREATE TABLE primary_school\.(\w+)/g)].map((m) => m[1] as string);
    expect(tables.length).toBe(17);
    for (const t of tables) expect(sql, t).toContain(`kernel.enable_tenant_rls('primary_school.${t}')`);
    const references = [...sql.matchAll(/REFERENCES\s+([\w.]+)/g)].map((m) => m[1] as string);
    for (const r of references) expect(r === "kernel.tenants" || r.startsWith("primary_school."), r).toBe(true);
    expect(sql).not.toMatch(/\bBEGIN;|\bCOMMIT;/);
  });
});

describe("aucune constante réglementaire dans le module (lint R2)", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      if (d.isDirectory()) return ["test", "migrations"].includes(d.name) ? [] : sources(resolve(dir, d.name));
      return d.name.endsWith(".ts") ? [resolve(dir, d.name)] : [];
    });
  /** Retire commentaires et chaînes : on ne contrôle que le CODE. */
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/"(?:\\.|[^"\\\n])*"/g, '""').replace(/'(?:\\.|[^'\\\n])*'/g, "''");

  it("ni moyenne, ni seuil de passage, ni coefficient, ni calcul de rang : le module compte et transporte", () => {
    const offenders: string[] = [];
    for (const file of sources(MODULE_DIR)) {
      const text = code(readFileSync(file, "utf8"));
      // identifiants de calcul réglementaire
      if (/\b\w*(average|moyenne|passMark|passingScore|passThreshold|seuil|coefficient|ranking)\w*\b\s*(=|:|\()/i.test(text)) offenders.push(`${file} : identifiant de calcul`);
      // comparaison d'une note ou d'une moyenne à un nombre littéral
      if (/\b(score|grade|note|mga|mark)\w*\s*[<>]=?\s*\d/i.test(text)) offenders.push(`${file} : seuil littéral`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("contrats Zod", () => {
  const line = { enrollmentId: U, competencyId: U, ratingLevelId: U };
  it("saisie en lot : 1 à 500 lignes, identifiants et date valides", () => {
    const body = { classroomId: U, periodId: U, frameworkId: U };
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: [line] }).success).toBe(true);
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: [] }).success).toBe(false);
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: Array.from({ length: PRIMARY_BULK_MAX_LINES + 1 }, () => line) }).success).toBe(false);
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: [{ ...line, observedOn: "2026-02-30" }] }).success).toBe(false);
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: [{ ...line, ratingLevelId: "pas-un-uuid" }] }).success).toBe(false);
    expect(primaryBulkRecordBodySchema.safeParse({ ...body, lines: [line], extra: 1 }).success).toBe(false);
  });

  it("motifs de révision et de réémission : 10 caractères au moins", () => {
    expect(primaryReviseBodySchema.safeParse({ toRatingLevelId: U, reason: "court" }).success).toBe(false);
    expect(primaryReviseBodySchema.safeParse({ toRatingLevelId: U, reason: "Erreur de saisie." }).success).toBe(true);
    expect(primaryReissueBodySchema.safeParse({ reason: "         x" }).success).toBe(false);
  });

  it("échelle : deux niveaux au moins ; `regulation` exige sa référence", () => {
    const level = (code: string, ordinal: number) => ({ code, label: code, ordinal, meetsExpectation: false });
    const base = { code: "ECH_1", label: "Échelle", levels: [level("N1", 1), level("N2", 2)] };
    expect(primaryCreateScaleBodySchema.safeParse(base).success).toBe(true);
    expect(primaryCreateScaleBodySchema.safeParse({ ...base, levels: [level("N1", 1)] }).success).toBe(false);
    expect(primaryCreateScaleBodySchema.safeParse({ ...base, sourceKind: "regulation" }).success).toBe(false);
    expect(primaryCreateScaleBodySchema.safeParse({ ...base, sourceKind: "regulation", sourceReference: "Texte officiel (à fournir)" }).success).toBe(true);
    expect(primaryCreateScaleBodySchema.safeParse({ ...base, code: "minuscule" }).success).toBe(false);
  });

  it("présence : un président et un secrétaire au plus, pas de doublon", () => {
    const p = (staffId: string, roleCode: string) => ({ staffId, roleCode, convened: true, present: true });
    const A = "0192f0a4-7b1e-7c3a-8d2e-00000000000a";
    const B = "0192f0a4-7b1e-7c3a-8d2e-00000000000b";
    expect(primaryPutAttendanceBodySchema.safeParse({ participants: [p(A, "CHAIR"), p(B, "SECRETARY")] }).success).toBe(true);
    expect(primaryPutAttendanceBodySchema.safeParse({ participants: [p(A, "CHAIR"), p(B, "CHAIR")] }).success).toBe(false);
    expect(primaryPutAttendanceBodySchema.safeParse({ participants: [p(A, "SECRETARY"), p(B, "SECRETARY")] }).success).toBe(false);
    expect(primaryPutAttendanceBodySchema.safeParse({ participants: [p(A, "CHAIR"), p(A, "TEACHER")] }).success).toBe(false);
  });

  it("liste de périodes de la synthèse : identifiants séparés par des virgules", () => {
    expect(primarySummaryQuerySchema.parse({ periodIds: `${U},${U}` }).periodIds).toEqual([U, U]);
    expect(primarySummaryQuerySchema.parse({}).periodIds).toBeUndefined();
    expect(primarySummaryQuerySchema.safeParse({ periodIds: "x" }).success).toBe(false);
  });
});

describe("chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const ctx: RequestContext = createRequestContext({ tenantId: "0192f0a4-7b1e-7c3a-8d2e-0000000000a1", userId: "0192f0a4-7b1e-7c3a-8d2e-0000000000b1" });

  async function boot(grant: string[] = [], opts: { ports?: boolean; deniedFeatures?: string[] } = {}) {
    const guarded: string[] = [];
    const runtime = {
      // Une base qui REFUSE toute requête : prouve que les routes testées s'arrêtent avant (garde, port) sans toucher aux données.
      tenantDb: { run: async () => { throw new Error("base interdite dans ce test"); } },
      clock: systemClock,
      logger: quiet,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      rateLimiter: { hit: async () => ({ allowed: true, retryAfterMs: 0 }) },
      entitlements: {
        requireFeature: (key: string) => async () => {
          if (opts.deniedFeatures?.includes(key)) throw new ForbiddenError("Fonctionnalité non accordée.", { code: "entitlements.feature_not_available", details: { feature: key } });
        },
      },
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const discovered: DiscoveredModule = {
      key: "primary_school",
      dir: MODULE_DIR,
      manifestPath: resolve(MODULE_DIR, "manifest.ts"),
      manifest,
      pluginPath: resolve(MODULE_DIR, "http", "plugin.ts"),
      migrationsDir: resolve(MODULE_DIR, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    if (opts.ports) (await import("../../http/plugin")).registerPrimarySchoolPorts(app, new InMemoryWorld().ports());
    return { app, guarded, loaded };
  }

  it("monte les routes sous /api/v1/primary_school avec la signature (app, runtime), sans double préfixe", async () => {
    const { app: instance, loaded } = await boot(["primary.settings.manage"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/primary_school"]);
    expect((await instance.inject({ method: "GET", url: "/settings", headers: { "x-tenant": "t" } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401) et sans permission (403), avec des permissions DU manifeste", async () => {
    const { app: instance, guarded } = await boot(["primary.settings.manage"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/primary_school/settings" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "PUT", url: "/api/v1/primary_school/competency-assessments/bulk", headers: { "x-tenant": "t" }, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["cache-control"]).toBe("no-store");
    const keys = new Set(manifest.permissions.map((p) => p.key));
    for (const g of guarded) expect(keys.has(g), g).toBe(true);
  });

  it("valide les entrées (400, détails) avant de toucher aux données", async () => {
    const { app: instance } = await boot(["primary.competency.record", "primary.competency.validate", "primary.competency.read"]);
    const bad = await instance.inject({ method: "PUT", url: "/api/v1/primary_school/competency-assessments/bulk", headers: { "x-tenant": "t" }, payload: { classroomId: "x" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    expect((await instance.inject({ method: "GET", url: "/api/v1/primary_school/classrooms/pas-un-uuid/competency-sheet?periodId=x", headers: { "x-tenant": "t" } })).statusCode).toBe(400);
  });

  it("sans port branché, le module ÉCHOUE FERMÉ (500 primary_school.port_unavailable), jamais en silence", async () => {
    const { app: instance } = await boot(["primary.settings.manage"]);
    // la lecture des paramètres résout l'établissement par le port « classes et inscriptions » : absent => refus explicite
    const res = await instance.inject({ method: "GET", url: "/api/v1/primary_school/settings", headers: { "x-tenant": "t" } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "primary_school.port_unavailable" });
  });

  it("les features vendables gardent leurs familles de routes (403 si non accordée au tenant), sans toucher aux paramètres", async () => {
    const all = manifest.permissions.map((p) => p.key);
    const { app: instance } = await boot(all, { ports: true, deniedFeatures: ["primary.council", "primary.annual-review", "primary.year-archive", "primary.reports", "primary.competencies"] });
    const denied = ["/councils", "/annual-reviews", "/year-archives", "/reports/class-list", "/progress", "/my-classrooms", "/phrases", "/rule-banner", "/me/annual-reviews"];
    for (const path of denied) {
      const res = await instance.inject({ method: "GET", url: `/api/v1/primary_school${path}`, headers: { "x-tenant": "t" } });
      expect(res.statusCode, path).toBe(403);
      expect(res.json().code, path).toBe("entitlements.feature_not_available");
    }
    // paramètres, échelles et référentiels ne sont pas vendus à part : jamais gardés par une feature
    for (const path of ["/settings", "/rating-scales", "/frameworks"]) {
      const res = await instance.inject({ method: "GET", url: `/api/v1/primary_school${path}`, headers: { "x-tenant": "t" } });
      expect(res.json().code, path).not.toBe("entitlements.feature_not_available");
    }
  });

  it("le registre de ports de l'application sert les routes (ports branchés : l'erreur devient celle de la base)", async () => {
    const { app: instance } = await boot(["primary.settings.manage"], { ports: true });
    const res = await instance.inject({ method: "GET", url: "/api/v1/primary_school/settings", headers: { "x-tenant": "t" } });
    // le port répond (un établissement) ; la base interdite du test lève ensuite : ce n'est plus port_unavailable
    expect(res.json().code).not.toBe("primary_school.port_unavailable");
  });
});
