/**
 * Tests unitaires (sans base) : manifeste, importeurs <-> permissions, plugin chargé PAR LE REGISTRE (signature (app, runtime),
 * préfixe /api/v1/imports, 401 sans contexte, gardes de permission, descripteurs, fichiers modèles), neutralité des fichiers.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { IMPORT_ERROR_CODES, IMPORTER_KEYS } from "@ecoledigitale/contracts/src/v2/imports";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { IMPORTER_LIST } from "../../importers/registry";
import manifest from "../../manifest";
import { DEFAULT_IMPORTS_CONFIG, importsConfigFromEnv } from "../../application/deps";
import { buildTemplateFile } from "../../application/report";
import { openUploadedFile } from "../../infrastructure/files/read";
import { DEFAULT_FILE_LIMITS } from "../../infrastructure/files/types";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module imports : manifeste", () => {
  it("déclare un manifeste valide dont les permissions sont préfixées par la clé", () => {
    expect(manifest.key).toBe("imports");
    for (const permission of manifest.permissions) expect(permission.key.startsWith("imports.")).toBe(true);
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
  });

  it("une permission d'import par importeur ; seuls les soldes financiers sont sensibles (MFA)", () => {
    const keys = new Map(manifest.permissions.map((p) => [p.key, p]));
    for (const importer of IMPORTER_LIST) {
      const p = keys.get(importer.importPermission);
      expect(p, importer.importPermission).toBeDefined();
      expect(Boolean(p?.sensitive), importer.key).toBe(importer.sensitive);
    }
    expect(IMPORTER_LIST.map((i) => i.key).sort()).toEqual([...IMPORTER_KEYS].sort());
    for (const p of ["imports.read", "imports.create", "imports.cancel", "imports.template.manage", "imports.manage"]) expect(keys.has(p), p).toBe(true);
  });

  it("chaque importeur exige les permissions de son module cible (un importeur d'élèves exige student.create)", () => {
    const required = Object.fromEntries(IMPORTER_LIST.map((i) => [i.key, i.targetPermissions]));
    expect(required["students"]).toContain("student.create");
    expect(required["guardians"]).toContain("guardian.manage");
    expect(required["staff"]).toContain("staff.create");
    expect(required["classrooms"]).toContain("academic.classroom.manage");
    expect(required["curriculum"]).toContain("curriculum.manage");
    expect(required["grades"]).toContain("grade.enter");
    expect(required["grades_own"]).toEqual(["grade.enter"]); // O-02 : jamais assessment.manage
    expect(required["enrollments"]).toEqual(["enrollment.create"]); // O-13
    expect(required["opening_balances"]).toContain("finance.invoice.create");
    const students = IMPORTER_LIST.find((i) => i.key === "students")!;
    expect(students.extraPermissions({ mappedColumns: new Set(["classCode"]), onExisting: "SKIP", options: {} })).toEqual(["enrollment.create"]);
    expect(students.extraPermissions({ mappedColumns: new Set(), onExisting: "UPDATE", options: {} })).toEqual(["student.update"]);
  });

  it("publie des événements <module>.<entité>.<verbe> et ses fichiers conventionnels existent", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^imports\.[a-z_]+\.[a-z_]+$/);
    const dir = resolve(__dirname, "..", "..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(dir, file)), file).toBe(true);
  });

  it("les codes d'erreur du cadre sont uniques et tous préfixés", () => {
    expect(new Set(IMPORT_ERROR_CODES).size).toBe(IMPORT_ERROR_CODES.length);
    for (const c of IMPORT_ERROR_CODES) expect(c.startsWith("imports.")).toBe(true);
  });

  it("réglages d'exploitation par l'environnement : bornés, jamais d'échec", () => {
    expect(importsConfigFromEnv({})).toEqual({ leaseSeconds: DEFAULT_IMPORTS_CONFIG.leaseSeconds, heartbeatMs: DEFAULT_IMPORTS_CONFIG.heartbeatMs, maxRunAttempts: DEFAULT_IMPORTS_CONFIG.maxRunAttempts, staleAfterSeconds: DEFAULT_IMPORTS_CONFIG.staleAfterSeconds });
    expect(importsConfigFromEnv({ IMPORTS_LEASE_SECONDS: "8", IMPORTS_HEARTBEAT_MS: "400" })).toMatchObject({ leaseSeconds: 8, heartbeatMs: 400 });
    expect(importsConfigFromEnv({ IMPORTS_LEASE_SECONDS: "1", IMPORTS_HEARTBEAT_MS: "abc" })).toMatchObject({ leaseSeconds: DEFAULT_IMPORTS_CONFIG.leaseSeconds, heartbeatMs: DEFAULT_IMPORTS_CONFIG.heartbeatMs });
  });
});

describe("fichiers modèles", () => {
  it("chaque importeur fournit un modèle CSV et XLSX relisible par le lecteur sûr, avec ses colonnes et sa feuille d'aide", async () => {
    for (const importer of IMPORTER_LIST) {
      const csv = await buildTemplateFile(importer.key, "csv");
      expect(csv.ok).toBe(true);
      if (!csv.ok) continue;
      const opened = await openUploadedFile(csv.value.bytes, { fileName: csv.value.fileName }, DEFAULT_FILE_LIMITS);
      expect(opened.reader.headers).toEqual(importer.columns.map((c) => c.label));
      const rows = [];
      for await (const r of opened.reader.rows()) rows.push(r);
      expect(rows).toHaveLength(importer.sampleRows.length);

      const xlsx = await buildTemplateFile(importer.key, "xlsx");
      expect(xlsx.ok).toBe(true);
      if (!xlsx.ok) continue;
      const x = await openUploadedFile(xlsx.value.bytes, { fileName: xlsx.value.fileName }, DEFAULT_FILE_LIMITS);
      expect(x.reader.sheetNames).toEqual(["Données", "Aide"]);
      expect(x.reader.headers).toEqual(importer.columns.map((c) => c.label));
      const zip = await JSZip.loadAsync(xlsx.value.bytes);
      expect(Object.keys(zip.files)).toContain("xl/worksheets/sheet2.xml");
    }
  });

  it("le mapping automatique reconnaît TOUTES les colonnes du modèle de chaque importeur", async () => {
    const { detectMapping } = await import("../../domain/mapping");
    for (const importer of IMPORTER_LIST) {
      const d = detectMapping(importer.columns, importer.columns.map((c) => c.label));
      expect(d.missingRequired, importer.key).toEqual([]);
      for (const c of importer.columns) expect(d.mapping[c.key], `${importer.key}.${c.key}`).toBe(c.label);
    }
  });

  it("un modèle de fichier ne contient aucune donnée réelle (exemples fictifs, adresses de test)", () => {
    for (const importer of IMPORTER_LIST) for (const row of importer.sampleRows) for (const cell of row) expect(cell).not.toMatch(/@(gmail|yahoo|hotmail|orange|outlook)\./i);
  });
});

describe("module imports : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const runtime = {
      tenantDb: { run: async () => { throw new Error("pas de base dans ce test"); } },
      clock: systemClock,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      logger: quiet,
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      rateLimiter: { hit: async () => ({ allowed: true, count: 1, retryAfterMs: 0 }) },
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const dir = resolve(__dirname, "..", "..");
    const discovered: DiscoveredModule = { key: "imports", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, loaded };
  }
  const H = { "x-tenant": TENANT };

  it("monte les routes sous /api/v1/imports avec la signature (app, runtime), 401 sans contexte, aucun double préfixe", async () => {
    const { app: instance, loaded } = await boot(["imports.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/imports"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/imports/importers" })).statusCode).toBe(401);
    expect((await instance.inject({ method: "GET", url: "/importers", headers: H })).statusCode).toBe(404);
  });

  it("liste les importeurs avec ce que l'appelant peut faire (canUse / canRun) selon SES permissions", async () => {
    const { app: instance } = await boot(["imports.read", "imports.create", "student.create", "imports.import.students"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/imports/importers", headers: H });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ key: string; canUse: boolean; canRun: boolean; sensitive: boolean; columns: unknown[]; targetPermissions: string[] }>;
    expect(items.map((i) => i.key).sort()).toEqual([...IMPORTER_KEYS].sort());
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by["students"]).toMatchObject({ canUse: true, canRun: true });
    expect(by["guardians"]).toMatchObject({ canUse: false, canRun: false }); // manque guardian.manage
    expect(by["opening_balances"]).toMatchObject({ canUse: false, sensitive: true });
    expect(by["students"]!.columns.length).toBeGreaterThan(5);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("téléverser exige imports.create ET les permissions du module cible (403 nommant la permission manquante), avant tout traitement", async () => {
    const noCreate = await boot(["imports.read"]);
    const r1 = await noCreate.app.inject({ method: "POST", url: "/api/v1/imports/jobs?importer=students&fileName=e.csv", headers: { ...H, "content-type": "text/csv" }, payload: "a;b\n1;2" });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().details.permission).toBe("imports.create");
    await app?.close();
    resetRegistryForTests();
    const noTarget = await boot(["imports.create"]);
    const r2 = await noTarget.app.inject({ method: "POST", url: "/api/v1/imports/jobs?importer=students&fileName=e.csv", headers: { ...H, "content-type": "text/csv" }, payload: "a;b\n1;2" });
    expect(r2.statusCode).toBe(403);
    expect(r2.json().details.permission).toBe("student.create");
    expect(noTarget.guarded).toEqual(["imports.create", "imports.create", "student.create"]);
  });

  it("refuse un importeur inconnu et des paramètres invalides (400/404), jamais une 500", async () => {
    const { app: instance } = await boot(["imports.create", "student.create"]);
    const bad = await instance.inject({ method: "POST", url: "/api/v1/imports/jobs?importer=nimportequoi&fileName=e.csv", headers: { ...H, "content-type": "text/csv" }, payload: "x" });
    expect(bad.statusCode).toBe(400);
    const noName = await instance.inject({ method: "POST", url: "/api/v1/imports/jobs?importer=students", headers: { ...H, "content-type": "text/csv" }, payload: "x" });
    expect(noName.statusCode).toBe(400);
  });

  it("sert les modèles de fichier (CSV avec BOM, XLSX) en pièce jointe, sans mise en cache", async () => {
    const { app: instance } = await boot(["imports.read"]);
    const csv = await instance.inject({ method: "GET", url: "/api/v1/imports/importers/students/template?format=csv", headers: H });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-disposition"]).toContain("modele-import-students.csv");
    expect(csv.headers["x-content-type-options"]).toBe("nosniff");
    expect(csv.headers["cache-control"]).toBe("no-store");
    expect(csv.rawPayload[0]).toBe(0xef);
    const xlsx = await instance.inject({ method: "GET", url: "/api/v1/imports/importers/grades/template?format=xlsx", headers: H });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
    expect((await instance.inject({ method: "GET", url: "/api/v1/imports/importers/inconnu/template", headers: H })).statusCode).toBe(400);
  });
});
