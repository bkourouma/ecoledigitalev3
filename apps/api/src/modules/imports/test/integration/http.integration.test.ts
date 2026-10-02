/**
 * HTTP sur base réelle : le parcours complet par les routes `/api/v1/imports/*`, les permissions (module imports ET module
 * cible), les fichiers hostiles reçus en corps brut, l'isolation entre tenants, le limiteur de débit, les téléchargements.
 * Le garde `requirePermission` est simulé par l'en-tête `x-grants` ; le worker est simulé en appelant les fonctions de
 * traitement (le vrai worker est éprouvé par `apps/api/test/imports/worker.integration.test.ts`).
 */
import Fastify, { type FastifyInstance } from "fastify";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { importsPlugin } from "../../http/plugin";
import { processRun } from "../../application/run";
import { processValidation } from "../../application/validate";
import { describeIntegration } from "../support/db";
import { csvOf, enc, STUDENT_HEADERS, studentRows, handmadeXlsx, xlsxOf } from "../support/files";
import { createWorld, DemoStudentsPort, MemoryStorage, type World } from "../support/world";

const FULL = ["imports.read", "imports.create", "imports.cancel", "imports.template.manage", "imports.import.students", "student.create"];

describeIntegration("module imports : HTTP sur base réelle", () => {
  let w: World;
  let app: FastifyInstance;
  let rate = { remaining: 1_000_000 };
  const port = (): DemoStudentsPort => new DemoStudentsPort(w.db.tenantDb);

  function build(hardMax?: number): FastifyInstance {
    const deps = w.deps(port(), hardMax ? { hardMaxFileBytes: hardMax } : {});
    const instance = Fastify({ logger: false });
    instance.register(importsPlugin, {
      deps,
      resolveContext: (request) => {
        const c = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!c) throw new UnauthorizedError();
        return c;
      },
      requirePermission: (permission) => async (request) => {
        const grants = String(request.headers["x-grants"] ?? "").split(",");
        if (!grants.includes(permission) && !grants.includes("*")) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      rateLimiter: {
        hit: async () => {
          rate.remaining -= 1;
          return { allowed: rate.remaining >= 0, count: 1, retryAfterMs: 4200 };
        },
      },
    });
    instance.decorateRequest("ctx", null as never);
    instance.addHook("onRequest", async (request) => {
      const tenant = request.headers["x-tenant"];
      if (typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: String(request.headers["x-user"] ?? w.userA), roles: ["directeur"], mfa: true });
    });
    return instance;
  }
  const headers = (grants: readonly string[] = FULL, extra: Record<string, string> = {}, tenant?: string) => ({ "x-tenant": tenant ?? w.tenantA, "x-grants": grants.join(","), ...extra });
  const upload = (bytes: Uint8Array, name = "eleves.csv", contentType = "text/csv", grants: readonly string[] = FULL, importer = "students") =>
    app.inject({ method: "POST", url: `/jobs?importer=${importer}&fileName=${encodeURIComponent(name)}`, headers: { ...headers(grants), "content-type": contentType }, payload: Buffer.from(bytes) });

  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await app?.close();
    await w?.drop();
  });
  beforeEach(async () => {
    await app?.close();
    app = build();
    await app.ready();
    rate = { remaining: 1_000_000 };
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'CANCELLED' WHERE status IN ('UPLOADED','MAPPED','VALIDATING','VALIDATED','QUEUED')`);
    await w.db.admin.query(`DELETE FROM imports.settings`);
  });

  it("parcours complet par HTTP : upload -> mapping -> validation -> preview -> import -> rapport -> téléchargements", async () => {
    const rows = studentRows(12, "H");
    rows[3] = ["TH-00004", "KONE", "", "F", "", "", ""];
    const up = await upload(csvOf([STUDENT_HEADERS, ...rows]));
    expect(up.statusCode).toBe(201);
    const uploaded = up.json();
    expect(uploaded.job).toMatchObject({ status: "UPLOADED", totalRows: 12, importerKey: "students", fileKind: "CSV" });
    expect(uploaded.suggestedMapping.lastName).toBe("Nom");
    expect(uploaded.missingRequired).toEqual([]);
    expect(uploaded.sample).toHaveLength(5);
    expect(up.headers["cache-control"]).toBe("no-store");
    const id = uploaded.job.id as string;

    const mapped = await app.inject({ method: "PUT", url: `/jobs/${id}/mapping`, headers: headers(), payload: { mapping: uploaded.suggestedMapping, runMode: "VALID_ONLY", onExisting: "SKIP" } });
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json().status).toBe("MAPPED");
    const validate = await app.inject({ method: "POST", url: `/jobs/${id}/validate`, headers: headers() });
    expect(validate.statusCode).toBe(202);
    expect(validate.json().status).toBe("VALIDATING");
    await processValidation(w.deps(port()), w.tenantA, id, { workerId: "http-test" });

    const preview = await app.inject({ method: "GET", url: `/jobs/${id}/preview`, headers: headers(["imports.read"]) });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ validRows: 11, invalidRows: 1, willCreate: 11, canRun: true });
    const problems = await app.inject({ method: "GET", url: `/jobs/${id}/rows?onlyProblems=true&column=firstName`, headers: headers(["imports.read"]) });
    expect(problems.json().total).toBe(1);
    expect(problems.json().items[0]).toMatchObject({ rowNo: 5, validation: "INVALID" });

    const noConfirm = await app.inject({ method: "POST", url: `/jobs/${id}/run`, headers: headers(), payload: { runMode: "VALID_ONLY", onExisting: "SKIP" } });
    expect(noConfirm.statusCode).toBe(400); // `confirm: true` obligatoire : jamais de lancement à l'aveugle
    const run = await app.inject({ method: "POST", url: `/jobs/${id}/run`, headers: headers(), payload: { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true } });
    expect(run.statusCode).toBe(202);
    expect(run.json().status).toBe("QUEUED");
    const dup = await app.inject({ method: "POST", url: `/jobs/${id}/run`, headers: headers(), payload: { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("imports.run_already_started");
    await processRun(w.deps(port()), w.tenantA, id, { workerId: "http-test-run" });

    const done = await app.inject({ method: "GET", url: `/jobs/${id}`, headers: headers(["imports.read"]) });
    expect(done.json()).toMatchObject({ status: "COMPLETED_WITH_ERRORS", createdCount: 11, failedCount: 1 });
    const summary = await app.inject({ method: "GET", url: `/jobs/${id}/summary`, headers: headers(["imports.read"]) });
    expect(summary.json().totals).toMatchObject({ created: 11, failed: 1, total: 12 });

    const csv = await app.inject({ method: "GET", url: `/jobs/${id}/report?format=csv&kind=errors`, headers: headers(["imports.read"]) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body).toContain("imports.required");
    const xlsx = await app.inject({ method: "GET", url: `/jobs/${id}/report?format=xlsx&kind=full`, headers: headers(["imports.read"]) });
    expect(xlsx.statusCode).toBe(200);
    expect((await JSZip.loadAsync(xlsx.rawPayload)).file("xl/worksheets/sheet1.xml")).not.toBeNull();

    const list = await app.inject({ method: "GET", url: `/jobs?importer=students&limit=5`, headers: headers(["imports.read"]) });
    expect(list.json().items[0].id).toBe(id);
    expect(list.json().total).toBeGreaterThanOrEqual(1);
  });

  it("permissions : lancer exige imports.import.<clé> ET le droit du module cible ; une colonne « Classe » exige enrollment.create ; UPDATE exige student.update", async () => {
    const up = (await upload(csvOf([[...STUDENT_HEADERS, "Classe"], ...studentRows(2, "G").map((r) => [...r, "6EME"])]))).json();
    const id = up.job.id as string;
    // mapping incluant « Classe » : enrollment.create requis
    const noEnroll = await app.inject({ method: "PUT", url: `/jobs/${id}/mapping`, headers: headers(), payload: { mapping: up.suggestedMapping } });
    expect(noEnroll.statusCode).toBe(403);
    expect(noEnroll.json().details.permission).toBe("enrollment.create");
    const withEnroll = await app.inject({ method: "PUT", url: `/jobs/${id}/mapping`, headers: headers([...FULL, "enrollment.create"]), payload: { mapping: up.suggestedMapping } });
    expect(withEnroll.statusCode).toBe(200);
    const upd = await app.inject({ method: "PUT", url: `/jobs/${id}/mapping`, headers: headers([...FULL, "enrollment.create"]), payload: { mapping: up.suggestedMapping, onExisting: "UPDATE" } });
    expect(upd.statusCode).toBe(403);
    expect(upd.json().details.permission).toBe("student.update");
    // sans la permission de lancement
    await app.inject({ method: "PUT", url: `/jobs/${id}/mapping`, headers: headers([...FULL, "enrollment.create"]), payload: { mapping: { ...up.suggestedMapping, classCode: null } } });
    await app.inject({ method: "POST", url: `/jobs/${id}/validate`, headers: headers() });
    await processValidation(w.deps(port()), w.tenantA, id, { workerId: "perm" });
    const noImport = await app.inject({ method: "POST", url: `/jobs/${id}/run`, headers: headers(FULL.filter((p) => p !== "imports.import.students")), payload: { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true } });
    expect(noImport.statusCode).toBe(403);
    expect(noImport.json().details.permission).toBe("imports.import.students");
    const noTarget = await app.inject({ method: "POST", url: `/jobs/${id}/run`, headers: headers(FULL.filter((p) => p !== "student.create")), payload: { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true } });
    expect(noTarget.statusCode).toBe(403);
    expect(noTarget.json().details.permission).toBe("student.create");
    const noCancel = await app.inject({ method: "POST", url: `/jobs/${id}/cancel`, headers: headers(["imports.read", "imports.create"]), payload: {} });
    expect(noCancel.statusCode).toBe(403);
  });

  it("fichiers hostiles reçus en corps brut : refus 400 avec un code précis, jamais une 500 ni une écriture", async () => {
    const jobsBefore = Number((await w.db.admin.query(`SELECT count(*)::int AS n FROM imports.jobs`)).rows[0].n);
    const cases: Array<[string, Uint8Array, string, string]> = [
      ["PDF déguisé en CSV", enc("%PDF-1.7\n1 0 obj\n"), "notes.csv", "imports.file_type_unsupported"],
      ["classeur .xls ancien", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "eleves.xlsx", "imports.file_type_unsupported"],
      ["texte nommé .xlsx", enc("a;b\n1;2\n"), "eleves.xlsx", "imports.file_type_mismatch"],
      ["extension .exe", enc("a;b\n1;2\n"), "setup.exe", "imports.file_type_unsupported"],
      ["fichier vide", new Uint8Array(0), "vide.csv", "imports.file_empty"],
      ["archive ZIP corrompue", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "x.xlsx", "imports.file_corrupt"],
      ["CSV sans ligne de données", enc("Nom;Prénoms\n"), "x.csv", "imports.no_header"],
    ];
    for (const [label, bytes, name, code] of cases) {
      const r = await upload(bytes, name, "application/octet-stream");
      expect(r.statusCode, label).toBe(400);
      expect(r.json().code, label).toBe(code);
      expect(r.json().kind).toBe("validation");
    }
    // zip-bomb : refus 400 file_unsafe
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", "0".repeat(80 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const bombRes = await upload(bomb, "bombe.xlsx", "application/octet-stream");
    expect(bombRes.statusCode).toBe(400);
    expect(bombRes.json().code).toBe("imports.file_unsafe");
    // DOCTYPE
    const evil = await handmadeXlsx({ rows: [], sheetXml: `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><worksheet/>` });
    expect((await upload(evil, "evil.xlsx", "application/octet-stream")).json().code).toBe("imports.file_unsafe");
    expect(Number((await w.db.admin.query(`SELECT count(*)::int AS n FROM imports.jobs`)).rows[0].n)).toBe(jobsBefore); // aucun import créé
    expect(w.storage instanceof MemoryStorage && [...w.storage.objects.keys()].filter((k) => k.includes("bombe")).length).toBe(0);
  });

  it("taille : plafond du tenant (400) et plafond de transport (413 -> code stable) ; plafond de lignes", async () => {
    await w.db.admin.query(`INSERT INTO imports.settings (tenant_id, max_file_bytes, max_rows, all_or_nothing_max_rows) VALUES ($1, 1024, 5, 5)`, [w.tenantA]);
    const tooBig = await upload(csvOf([STUDENT_HEADERS, ...studentRows(40, "B")]));
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json().code).toBe("imports.file_too_large");
    await w.db.admin.query(`UPDATE imports.settings SET max_file_bytes = 1048576 WHERE tenant_id = $1`, [w.tenantA]);
    const tooMany = await upload(csvOf([STUDENT_HEADERS, ...studentRows(6, "B")]));
    expect(tooMany.json().code).toBe("imports.too_many_rows");
    await app.close();
    app = build(4096);
    await app.ready();
    const transport = await upload(new Uint8Array(200_000).fill(65), "gros.csv");
    expect(transport.statusCode).toBe(400);
    expect(transport.json().code).toBe("imports.file_too_large");
  });

  it("limiteur de débit : 429 avec Retry-After au-delà du seuil par utilisateur", async () => {
    rate = { remaining: 1 };
    const ok = await upload(csvOf([STUDENT_HEADERS, ...studentRows(1, "L")]));
    expect(ok.statusCode).toBe(201);
    const limited = await upload(csvOf([STUDENT_HEADERS, ...studentRows(1, "L")]));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("5");
  });

  it("isolation : un autre tenant (ou un autre utilisateur sans imports.manage) reçoit 404 partout", async () => {
    const up = (await upload(csvOf([STUDENT_HEADERS, ...studentRows(2, "X")]))).json();
    const id = up.job.id as string;
    for (const [method, url] of [["GET", `/jobs/${id}`], ["GET", `/jobs/${id}/preview`], ["GET", `/jobs/${id}/rows`], ["GET", `/jobs/${id}/report`], ["POST", `/jobs/${id}/cancel`], ["DELETE", `/jobs/${id}`]] as const) {
      const other = await app.inject({ method, url, headers: headers(["*"], {}, w.tenantB), payload: method === "POST" ? {} : undefined });
      expect(other.statusCode, `${method} ${url} (autre tenant)`).toBe(404);
      const colleague = await app.inject({ method, url, headers: headers(["imports.read", "imports.create", "imports.cancel"], { "x-user": "0192f0a4-7b1e-7c3a-8d2e-0000000000c9" }), payload: method === "POST" ? {} : undefined });
      expect(colleague.statusCode, `${method} ${url} (collègue)`).toBe(404);
    }
    const manager = await app.inject({ method: "GET", url: `/jobs/${id}`, headers: headers(["imports.read", "imports.manage"], { "x-user": "0192f0a4-7b1e-7c3a-8d2e-0000000000c9" }) });
    expect(manager.statusCode).toBe(200);
    // l'autre tenant ne voit aucun import dans sa liste
    const list = await app.inject({ method: "GET", url: `/jobs`, headers: headers(["*"], {}, w.tenantB) });
    expect(list.json().items).toEqual([]);
  });

  it("modèles de mapping et paramètres : permissions dédiées, validation des plafonds absolus", async () => {
    const read = await app.inject({ method: "POST", url: `/templates`, headers: headers(["imports.read"]), payload: { importerKey: "students", name: "X", mapping: { lastName: "Nom" } } });
    expect(read.statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: `/templates`, headers: headers(), payload: { importerKey: "students", name: "Logiciel Y", mapping: { lastName: "Nom", firstName: "Prénoms" }, headers: ["Nom", "Prénoms"] } });
    expect(created.statusCode).toBe(201);
    const dupe = await app.inject({ method: "POST", url: `/templates`, headers: headers(), payload: { importerKey: "students", name: "logiciel y", mapping: { lastName: "Nom" } } });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().code).toBe("imports.template_exists");
    const listed = await app.inject({ method: "GET", url: `/templates?importer=students`, headers: headers(["imports.read"]) });
    expect(listed.json().items).toHaveLength(1);
    const removed = await app.inject({ method: "DELETE", url: `/templates/${created.json().id}`, headers: headers() });
    expect(removed.statusCode).toBe(204);

    const settings = await app.inject({ method: "GET", url: `/settings`, headers: headers(["imports.read"]) });
    expect(settings.json()).toMatchObject({ maxRows: 5000, batchSize: 200, hardLimits: { maxRows: 20000 } });
    expect((await app.inject({ method: "PUT", url: `/settings`, headers: headers(["imports.read"]), payload: { maxRows: 100 } })).statusCode).toBe(403);
    const over = await app.inject({ method: "PUT", url: `/settings`, headers: headers(["imports.manage", "imports.read"]), payload: { maxRows: 50000 } });
    expect(over.statusCode).toBe(400);
    const okSettings = await app.inject({ method: "PUT", url: `/settings`, headers: headers(["imports.manage", "imports.read"]), payload: { maxRows: 1000, allOrNothingMaxRows: 500 } });
    expect(okSettings.statusCode).toBe(200);
    expect(okSettings.json()).toMatchObject({ maxRows: 1000, allOrNothingMaxRows: 500 });
  });

  it("classeur XLSX téléversé : feuille choisie, avertissement de formules, mapping proposé", async () => {
    const bytes = await handmadeXlsx({
      rows: [
        { r: 1, cells: [{ r: "A1", t: "inlineStr", is: "Matricule" }, { r: "B1", t: "inlineStr", is: "Nom" }, { r: "C1", t: "inlineStr", is: "Prénoms" }, { r: "D1", t: "inlineStr", is: "Sexe" }] },
        { r: 2, cells: [{ r: "A2", t: "inlineStr", is: "XL-1" }, { r: "B2", t: "str", f: "UPPER(&quot;kone&quot;)", v: "KONE" }, { r: "C2", t: "inlineStr", is: "Awa" }, { r: "D2", t: "inlineStr", is: "F" }] },
      ],
    });
    const up = await upload(bytes, "eleves.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(up.statusCode).toBe(201);
    expect(up.json().job).toMatchObject({ fileKind: "XLSX", sheetName: "Feuil1", totalRows: 1 });
    expect(up.json().job.warnings.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(["imports.formulas_ignored"]));
    expect(up.json().missingRequired).toEqual([]);
    expect((await xlsxOf([["a"]])).length).toBeGreaterThan(0);
  });
});
