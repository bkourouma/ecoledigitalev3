/**
 * Tests unitaires du MODULE (sans base) : manifeste, contrats partagés, aucune règle d'examen en code (lint R2), cohérence du modèle de pack
 * (aucun nombre sans origine), échec fermé des ports, plugin chargé PAR LE REGISTRE.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { EXAMINATIONS_ERROR_CODES, examinationsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/examinations";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { createExaminationsDeps } from "../../application/deps";
import { ALL_EXAMINATIONS_EVENT_TYPES } from "../../domain/events";
import { ExamCode } from "../../domain/errors";
import { PACK_TEMPLATES, PRIMARY_PACK } from "../../domain/pack-template";
import { validateExportColumns, validateImportColumns, validateImportValueMap } from "../../domain/export-spec";
import { unavailablePorts } from "../../infrastructure/in-memory-ports";
import manifest from "../../manifest";

const moduleDir = resolve(__dirname, "../..");
const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module examinations : manifeste", () => {
  it("déclare un manifeste valide, des permissions `exam.*` et des événements <module>.<entité>.<verbe>", () => {
    expect(manifest.key).toBe("examinations");
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
    for (const p of manifest.permissions) expect(p.key).toMatch(/^exam(\.[a-z_]+){2,3}$/);
    for (const type of manifest.events.publishes) expect(type).toMatch(/^examinations\.[a-z_]+\.[a-z_]+$/);
    expect(manifest.events.consumes).toEqual(["academic.enrollment.withdrawn"]);
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(moduleDir, file)), file).toBe(true);
  });
  it("marque SENSIBLES la publication, l'application d'un import, la révision et la dérogation ; les menus visent des permissions et features du module", () => {
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["exam.eligibility.override", "exam.result.publish", "exam.result.release", "exam.result.revise"]);
    const perms = new Set(manifest.permissions.map((p) => p.key));
    const features = new Set(manifest.features.map((f) => f.key));
    expect([...features].sort()).toEqual(["examinations.core", "examinations.exports", "examinations.mock"]);
    for (const m of manifest.menus) {
      expect(perms.has(m.permission), m.key).toBe(true);
      if (m.feature) expect(features.has(m.feature), m.key).toBe(true);
      expect(m.href.startsWith("/v2/examinations")).toBe(true);
    }
  });
});

describe("module examinations : contrats partagés", () => {
  it("les codes d'erreur des contrats sont EXACTEMENT ceux du module", () => {
    expect([...EXAMINATIONS_ERROR_CODES].sort()).toEqual(Object.values(ExamCode).sort());
  });
  it("chaque événement publié a un schéma de charge ; aucun schéma n'admet une note, une moyenne ou une identité", () => {
    expect(Object.keys(examinationsEventPayloadSchemas).sort()).toEqual([...ALL_EXAMINATIONS_EVENT_TYPES].sort());
    for (const [type, schema] of Object.entries(examinationsEventPayloadSchemas)) {
      const keys = Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape);
      for (const forbidden of ["lastName", "firstName", "birthDate", "average", "score", "totalPoints", "rank", "mention", "name"]) expect(keys, `${type}.${forbidden}`).not.toContain(forbidden);
    }
  });
});

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!["test", "migrations", "node_modules"].includes(entry)) listSources(p, out);
    } else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Retire commentaires et littéraux de chaîne : ne reste que le code (ce que la règle R2 interdit de contaminer). */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("module examinations : aucune règle d'examen dans le code (R-EXA-01, lint R2)", () => {
  const files = listSources(moduleDir).filter((f) => !f.endsWith("pack-template.ts"));
  it("aucun code d'examen, aucun seuil, aucune épreuve ni coefficient en dehors du modèle de pack (données)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = codeOnly(readFileSync(f, "utf8"));
      for (const re of [/\b(CEPE|BEPC|BAC|BTS)\b/, /\bseuil\w*/i, /\bthreshold\b/i, /\bEP[123]\b/, /\bcoefficient\s*[=:]\s*\d/, /\b(admis|admitted)\s*>=?\s*\d/i]) {
        const m = re.exec(code);
        if (m) offenders.push(`${relative(moduleDir, f)} : « ${m[0]} »`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("les textes littéraux d'un examen précis n'apparaissent que dans le modèle de pack et ses formats fictifs", () => {
    const literal = /["'`](CEPE|BEPC|BAC|BTS)["'`]/;
    const offenders = files.filter((f) => literal.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))).map((f) => relative(moduleDir, f));
    expect(offenders).toEqual([]);
  });
});

describe("module examinations : modèle de pack (CEPE FICTIF)", () => {
  it("chaque valeur numérique ou de liste porte son origine `placeholder` : aucune épreuve, aucun coefficient officiel", () => {
    expect(Object.keys(PACK_TEMPLATES)).toEqual(["PRIMARY"]);
    expect(PRIMARY_PACK.examTypes).toHaveLength(1);
    const cepe = PRIMARY_PACK.examTypes[0]!;
    expect(cepe).toMatchObject({ code: "CEPE", sourceKind: "placeholder", resultContractId: "exam-national@1" });
    expect(cepe.label).toMatch(/fictives?/);
    expect(cepe.papers.map((p) => p.code)).toEqual(["EP1", "EP2", "EP3"]);
    for (const p of cepe.papers) {
      expect(p.sourceKind, p.code).toBe("placeholder");
      expect(p.label).toMatch(/fictive/);
    }
    for (const r of cepe.requirements) expect(r.sourceKind).toBe("placeholder");
    for (const f of PRIMARY_PACK.exportFormats) {
      expect(f.sourceKind).toBe("placeholder");
      expect(f.label).toMatch(/fictif/);
      expect(validateExportColumns(f.columns, f.kind, f.fileFormat), f.code).toEqual([]);
    }
    for (const f of PRIMARY_PACK.importFormats) {
      expect(f.sourceKind).toBe("placeholder");
      expect(f.label).toMatch(/fictif/);
      expect([...validateImportColumns(f.columns, f.kind), ...validateImportValueMap(f.valueMap)], f.code).toEqual([]);
    }
  });
});

describe("module examinations : ports et échec fermé", () => {
  it("sans adaptateur, chaque port échoue FERMÉ (`examinations.port_unavailable`), jamais « autorisé » par défaut", async () => {
    const deps = createExaminationsDeps({ db: {} as never });
    const p = deps.ports;
    await expect(p.students.getIdentity(ctx, "x")).rejects.toMatchObject({ code: ExamCode.PORT_UNAVAILABLE });
    await expect(p.institutions.exists(ctx, "x")).rejects.toMatchObject({ code: ExamCode.PORT_UNAVAILABLE });
    await expect(p.assess.getAssessment(ctx, "x")).rejects.toMatchObject({ code: ExamCode.PORT_UNAVAILABLE });
    await expect(p.pieces.verify(ctx, { documentId: "d", studentId: "s" })).rejects.toMatchObject({ code: ExamCode.PORT_UNAVAILABLE });
    await expect(p.storage.put("k", new Uint8Array(), { contentType: "x" })).rejects.toMatchObject({ code: ExamCode.PORT_UNAVAILABLE });
    for (const r of [
      await p.eligibility.getEligibilityFacts(ctx, { enrollmentId: "e", studentId: "s", examGradeLevelCode: null, referenceDate: null }),
      await p.rules.resolve(ctx, { contractId: "exam-national@1", institutionId: "i", levelCode: null, date: "2027-01-01" }),
      await p.rules.open(ctx, "v"),
      await p.officialDocuments.request(ctx, { kind: "EXAM_CONVOCATION", sourceId: "s", title: "t", issuedAt: new Date(), institutionId: "i", content: {}, context: {} }),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(ExamCode.PORT_UNAVAILABLE);
    }
    // aucune famille « par défaut » : sans lien, aucun accès
    expect(await p.family.isGuardianOf(ctx, "u", "s")).toBe(false);
    expect(await p.family.childrenOf(ctx, "u")).toEqual([]);
    expect(unavailablePorts().family.studentIdForUser).toBeTypeOf("function");
  });
});

describe("module examinations : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const features: string[] = [];
    const runtime = {
      tenantDb: { run: async () => { throw new Error("pas de base dans ce test"); } },
      clock: systemClock,
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      rateLimiter: { hit: async () => ({ allowed: true, count: 1, retryAfterMs: 0 }) },
      entitlements: { requireFeature: (feature: string) => async () => { features.push(feature); } },
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
    const dir = moduleDir;
    const discovered: DiscoveredModule = { key: "examinations", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, features, loaded };
  }

  it("monte les routes sous /api/v1/examinations, refuse sans contexte (401) et sans permission (403), exige la feature du module", async () => {
    const { app: instance, guarded, features, loaded } = await boot(["exam.session.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/examinations"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/examinations/sessions" })).statusCode).toBe(401);
    expect((await instance.inject({ method: "POST", url: "/api/v1/examinations/sessions", headers: { "x-tenant": TENANT }, payload: {} })).statusCode).toBe(403);
    expect(guarded).toContain("exam.session.manage");
    for (const p of guarded) expect(manifest.permissions.map((x) => x.key)).toContain(p);
    // route à permission accordée : la garde de feature est évaluée, la base absente donne une erreur de service (pas un contournement)
    const res = await instance.inject({ method: "GET", url: "/api/v1/examinations/sessions/not-a-uuid", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(400);
    expect(features).toContain("examinations.core");
    expect((await instance.inject({ method: "GET", url: "/sessions", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("le registre de ports est posé à la racine (setup) et lu à la requête", async () => {
    const { app: instance } = await boot();
    expect(instance.hasDecorator("examinationsPorts")).toBe(true);
    instance.examinationsPorts.register({ family: { studentIdForUser: async () => null, childrenOf: async () => [], isGuardianOf: async () => true } });
    expect(await instance.examinationsPorts.current.family?.isGuardianOf(ctx, "u", "s")).toBe(true);
    void dirname;
  });
});
