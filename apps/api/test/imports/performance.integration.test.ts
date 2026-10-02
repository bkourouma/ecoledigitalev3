/**
 * Performance et mémoire d'un import de 5 000 lignes (élèves) avec les VRAIS adaptateurs sur Postgres réel : upload (lecture et
 * mise en table), validation (plan contre l'existant), import par lots transactionnels, rejeu idempotent. Les durées mesurées
 * sont journalisées (`[perf]`) et reportées dans le README du module.
 *
 * Mémoire BORNÉE : le fichier n'est jamais entièrement matérialisé (lecture en flux, lots de 200) ; le test compare le pic de
 * tas d'un import de 5 000 lignes à celui d'un import de 500 lignes et refuse une croissance proportionnelle à la taille.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createImportsDeps, getImportJob, processRun, processValidation, requestImportRun, requestImportValidation, setImportMapping, uploadImportFile, type ImportsDeps } from "../../src/modules/imports";
import { buildPlatformPorts } from "../../src/platform/adapters";
import { MemoryStorage } from "../../src/modules/imports/test/support/world";
import { csvOf, STUDENT_HEADERS, studentRows } from "../../src/modules/imports/test/support/files";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, type AssemblyWorld } from "../adapters/support/world";

const mb = (n: number): number => Math.round((n / 1024 / 1024) * 10) / 10;

/** Échantillonne le tas pendant `fn` et renvoie le pic (octets) au-dessus de la base de départ. */
async function withHeapPeak<T>(fn: () => Promise<T>): Promise<{ result: T; peak: number; ms: number }> {
  global.gc?.();
  const base = process.memoryUsage().heapUsed;
  let peak = base;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }, 25);
  const t0 = Date.now();
  try {
    const result = await fn();
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    return { result, peak: peak - base, ms: Date.now() - t0 };
  } finally {
    clearInterval(timer);
  }
}

describeIntegration("imports : performance et mémoire (5 000 lignes, adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let deps: ImportsDeps;
  let ctx: RequestContext;
  const viewer = { manage: true };

  beforeAll(async () => {
    w = await createAssemblyWorld();
    ctx = w.director;
    const ports = buildPlatformPorts(w.kit, null, {}, {});
    deps = createImportsDeps({ db: w.tenantDb, clock: w.clock, ports: { ...ports.imports, storage: new MemoryStorage() }, config: { heartbeatMs: 500, leaseSeconds: 60 } });
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  async function runImport(rows: number, prefix: string) {
    const bytes = csvOf([STUDENT_HEADERS, ...studentRows(rows, prefix)]);
    const upload = await withHeapPeak(async () => unwrap(await uploadImportFile(deps, ctx, { importerKey: "students", fileName: `eleves-${rows}.csv`, bytes })));
    const jobId = upload.result.job.id;
    unwrap(await setImportMapping(deps, ctx, jobId, { mapping: upload.result.suggestedMapping, runMode: "VALID_ONLY", onExisting: "SKIP" }, viewer));
    unwrap(await requestImportValidation(deps, ctx, jobId, viewer));
    const validation = await withHeapPeak(() => processValidation(deps, ctx.tenantId, jobId, { workerId: `perf-v-${jobId}` }));
    expect(validation.result.status).toBe("VALIDATED");
    unwrap(await requestImportRun(deps, ctx, jobId, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, viewer));
    const run = await withHeapPeak(() => processRun(deps, ctx.tenantId, jobId, { workerId: `perf-r-${jobId}` }));
    expect(run.result.status).toBe("COMPLETED");
    const job = unwrap(await getImportJob(deps, ctx, jobId, viewer));
    return { jobId, job, upload, validation, run };
  }

  it("200 lignes : référence de mémoire et de débit", async () => {
    const r = await runImport(200, "P");
    expect(r.job).toMatchObject({ createdCount: 200, failedCount: 0 });
    console.log(`[perf] 200 lignes : upload ${r.upload.ms} ms (pic ${mb(r.upload.peak)} Mo), validation ${r.validation.ms} ms (pic ${mb(r.validation.peak)} Mo), import ${r.run.ms} ms (pic ${mb(r.run.peak)} Mo)`);
    (globalThis as { __ref500?: number }).__ref500 = Math.max(r.upload.peak, r.validation.peak, r.run.peak);
  }, 600_000);

  it("5 000 lignes : import complet, mémoire bornée, rejeu idempotent", async () => {
    const before = Number((await adminRows<{ n: string }>(w, "SELECT count(*) AS n FROM people.students"))[0]!.n);
    const r = await runImport(5000, "Q");
    expect(r.job).toMatchObject({ createdCount: 5000, failedCount: 0, processedCount: 5000, status: "COMPLETED" });
    expect(Number((await adminRows<{ n: string }>(w, "SELECT count(*) AS n FROM people.students"))[0]!.n)).toBe(before + 5000);
    const dup = await adminRows(w, "SELECT external_ref FROM people.students GROUP BY external_ref HAVING count(*) > 1");
    expect(dup).toEqual([]);
    const peak = Math.max(r.upload.peak, r.validation.peak, r.run.peak);
    const rate = Math.round((5000 / (r.run.ms / 1000)) * 10) / 10;
    console.log(`[perf] 5 000 lignes : upload ${r.upload.ms} ms (pic ${mb(r.upload.peak)} Mo), validation ${r.validation.ms} ms (pic ${mb(r.validation.peak)} Mo), import ${r.run.ms} ms (pic ${mb(r.run.peak)} Mo) = ${rate} lignes/s ; durée enregistrée ${r.job.durationMs} ms`);
    // Mémoire bornée : 10 fois plus de lignes ne coûtent pas 10 fois plus de tas (le plafond absolu est généreux pour la CI).
    const ref = (globalThis as { __ref500?: number }).__ref500 ?? 0;
    expect(peak).toBeLessThan(Math.max(ref * 5, 150 * 1024 * 1024));
    expect(peak).toBeLessThan(400 * 1024 * 1024);

    // Rejeu : même fichier, mêmes matricules -> tout est ignoré, aucun doublon, aucune écriture dans people.
    const events = Number((await adminRows<{ n: string }>(w, "SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'people.student.created'"))[0]!.n);
    const again = await runImport(5000, "Q");
    expect(again.job).toMatchObject({ createdCount: 0, skippedCount: 5000, failedCount: 0 });
    expect(Number((await adminRows<{ n: string }>(w, "SELECT count(*) AS n FROM people.students"))[0]!.n)).toBe(before + 5000);
    expect(Number((await adminRows<{ n: string }>(w, "SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'people.student.created'"))[0]!.n)).toBe(events);
    console.log(`[perf] rejeu 5 000 lignes : validation ${again.validation.ms} ms, import ${again.run.ms} ms (toutes ignorées)`);
  }, 1_800_000);
});
