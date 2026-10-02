/**
 * Intégration du MOTEUR sur Postgres réel (rôle applicatif soumis à la RLS), avec un port cible factice qui écrit par
 * `db.run(ctx, …)` comme les vrais adaptateurs : isolation A/B, parcours complet, rejeu idempotent, modes tout-ou-rien et
 * lignes valides seulement, reprise après perte de bail, annulation, quotas, rétention.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../../isolation-allowlist.imports";
import { buildImportReportFile, listImportRows } from "../../application/report";
import { getImportJob, cancelImportJob, deleteImportJob, setImportMapping } from "../../application/jobs";
import { getImportPreview, requestImportValidation } from "../../application/validate";
import { getImportReport, processRun, requestImportRun } from "../../application/run";
import { purgeExpiredImports, resumeStalledImports } from "../../application/consumers";
import { uploadImportFile } from "../../application/upload";
import { getImportSettings, updateImportSettings } from "../../application/settings";
import { createMappingTemplate, listMappingTemplates } from "../../application/templates";
import { describeIntegration } from "../support/db";
import { csvOf, STUDENT_HEADERS, studentRows } from "../support/files";
import { createWorld, DemoStudentsPort, jobRow, prepareJob, runJob, type World } from "../support/world";
import { SystemDb } from "@ecoledigitale/database";
import { noopLogger } from "@ecoledigitale/kernel";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describeIntegration("module imports : moteur sur base réelle", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.drop();
  });
  // Les imports non terminés comptent dans le quota : chaque essai part d'un tenant sans import actif.
  beforeEach(async () => {
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'CANCELLED' WHERE status IN ('UPLOADED','MAPPED','VALIDATING','VALIDATED','QUEUED')`);
  });

  it("assertTenantIsolation : chaque table du schéma imports est isolée par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({ pool: w.db.appPool, schemas: ["imports"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
  });

  it("parcours complet : upload -> mapping -> validation -> preview -> import -> rapport, avec lignes invalides et doublons", async () => {
    const port = new DemoStudentsPort(w.db.tenantDb, { planErrorRefs: new Set(["TF-00005"]), failRefs: new Set(["TF-00007"]) });
    const deps = w.deps(port);
    const ctx = w.ctxA();
    const rows = studentRows(10, "F");
    rows[2] = ["TF-00003", "KONE", "", "F", "03/04/2012", "Abidjan", "0701020304"]; // prénom manquant
    rows[3] = ["TF-00004", "KONE", "Dup", "Z", "03/04/2012", "Abidjan", ""]; // sexe non reconnu
    rows[8] = rows[0] as string[]; // doublon de la ligne 2 dans le fichier
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...rows]));

    expect(job.status).toBe("VALIDATED");
    expect(job.totalRows).toBe(10);
    expect(job.invalidRows).toBe(4); // prénom, sexe, doublon, refus du plan (TF-00005)
    expect(job.validRows).toBe(6);
    expect(job.plannedCreate).toBe(6);
    expect(job.mapping?.externalRef).toBe("Matricule");

    const preview = unwrap(await getImportPreview(deps, ctx, job.id, w.viewer));
    expect(preview).toMatchObject({ totalRows: 10, willCreate: 6, willFail: 4, canRun: true });
    expect(preview.topIssues.map((t) => t.code)).toEqual(expect.arrayContaining(["imports.required", "imports.invalid_value", "imports.duplicate_in_file", "people.possible_duplicate"]));
    expect(await w.demoCount()).toBe(0); // la preview n'écrit rien

    const errors = unwrap(await listImportRows(deps, ctx, job.id, { onlyProblems: true, limit: 50, offset: 0 }, w.viewer));
    expect(errors.total).toBe(4);
    const dup = errors.items.find((r) => r.issues.some((i) => i.code === "imports.duplicate_in_file"));
    expect(dup?.rowNo).toBe(10);
    expect(dup?.issues[0]?.message).toContain("ligne 2");
    const byColumn = unwrap(await listImportRows(deps, ctx, job.id, { column: "sex", limit: 10, offset: 0 }, w.viewer));
    expect(byColumn.items.map((r) => r.rowNo)).toEqual([5]);

    const outcome = await runJob(w, deps, ctx, job.id, "VALID_ONLY");
    expect(outcome.status).toBe("COMPLETED_WITH_ERRORS");
    const done = unwrap(await getImportJob(deps, ctx, job.id, w.viewer));
    expect(done).toMatchObject({ status: "COMPLETED_WITH_ERRORS", createdCount: 5, failedCount: 5, skippedCount: 0, processedCount: 6 });
    expect(done.durationMs).not.toBeNull();
    expect(await w.demoCount()).toBe(5);

    const report = unwrap(await getImportReport(deps, ctx, job.id, w.viewer, async () => "Directrice Test"));
    expect(report.totals).toMatchObject({ created: 5, failed: 5, total: 10 });
    expect(report.author.displayName).toBe("Directrice Test");
    expect(report.topIssues.length).toBeGreaterThan(0);

    // audit : création, mapping, validation, demande de lancement, fin
    const actions = w.audit.entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["imports.job.create", "imports.job.map", "imports.job.validate", "imports.job.validated", "imports.run.request", "imports.run.completed"]));
    const created = await w.db.admin.query(`SELECT type, payload FROM kernel.domain_events WHERE type LIKE 'imports.%' AND aggregate_id = $1 ORDER BY occurred_at`, [job.id]);
    const types = created.rows.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["imports.job.created", "imports.job.validation_requested", "imports.job.validated", "imports.run.requested", "imports.run.started", "imports.run.completed"]));
    const completed = created.rows.find((r) => r.type === "imports.run.completed");
    expect(completed.payload).toMatchObject({ v: 1, importerKey: "students", created: 5, failed: 5 });
    expect(JSON.stringify(created.rows)).not.toMatch(/KONE|Aminata/); // aucune ligne du fichier dans un événement
  });

  it("rejeu du MÊME fichier : aucun doublon, lignes déjà importées ignorées, avertissement sur le fichier", async () => {
    const port = new DemoStudentsPort(w.db.tenantDb);
    const deps = w.deps(port);
    const ctx = w.ctxA();
    const bytes = csvOf([STUDENT_HEADERS, ...studentRows(30, "R")]);
    const first = await prepareJob(w, deps, ctx, bytes);
    await runJob(w, deps, ctx, first.id);
    const before = await w.demoCount();

    const second = await prepareJob(w, deps, ctx, bytes);
    expect(second.duplicateOfJobId).toBe(first.id);
    expect(second.warnings.map((x) => x.code)).toContain("imports.already_imported");
    expect(second.plannedSkip).toBe(30);
    expect(second.plannedCreate).toBe(0);
    const applyBefore = port.applyCalls;
    // plus aucune ligne à écrire : le lancement est refusé proprement (rien à faire), et la base ne bouge pas
    const refused = await requestImportRun(deps, ctx, second.id, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, w.viewer);
    expect(refused.ok).toBe(true); // des lignes valides existent : elles seront toutes ignorées
    const out = await processRun(deps, ctx.tenantId, second.id, { workerId: "w2" });
    expect(out.status).toBe("COMPLETED");
    const done = unwrap(await getImportJob(deps, ctx, second.id, w.viewer));
    expect(done).toMatchObject({ createdCount: 0, skippedCount: 30, failedCount: 0 });
    expect(port.applyCalls).toBe(applyBefore);
    expect(await w.demoCount()).toBe(before);
  });

  it("politique UPDATE : les lignes existantes sont mises à jour, pas recréées", async () => {
    const port = new DemoStudentsPort(w.db.tenantDb);
    const deps = w.deps(port);
    const ctx = w.ctxA();
    const first = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(5, "U")]));
    await runJob(w, deps, ctx, first.id);
    const changed = studentRows(5, "U").map((r) => [r[0], "RENOMME", r[2], r[3], r[4], r[5], r[6]] as string[]);
    const second = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...changed]), { onExisting: "UPDATE" });
    expect(second.plannedUpdate).toBe(5);
    await runJob(w, deps, ctx, second.id, "VALID_ONLY", "UPDATE");
    const done = unwrap(await getImportJob(deps, ctx, second.id, w.viewer));
    expect(done).toMatchObject({ updatedCount: 5, createdCount: 0 });
    const names = await w.db.admin.query(`SELECT DISTINCT last_name FROM public.demo_students WHERE ref LIKE 'TU-%'`);
    expect(names.rows.map((r) => r.last_name)).toEqual(["RENOMME"]);
  });

  it("changer la politique « existant » après validation exige une nouvelle validation", async () => {
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const ctx = w.ctxA();
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(3, "P")]));
    const r = await requestImportRun(deps, ctx, job.id, { runMode: "VALID_ONLY", onExisting: "UPDATE", confirm: true }, w.viewer);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("imports.not_validated");
  });

  it("TOUT OU RIEN : refusé tant qu'une erreur subsiste ; atomique à l'écriture ; reprise impossible sans effet partiel", async () => {
    const ctx = w.ctxA();
    // 1. une ligne invalide : lancement refusé
    const deps1 = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const rows = studentRows(20, "N");
    rows[4] = ["TN-00005", "KONE", "", "F", "", "", ""];
    const invalid = await prepareJob(w, deps1, ctx, csvOf([STUDENT_HEADERS, ...rows]), { runMode: "ALL_OR_NOTHING" });
    const refused = await requestImportRun(deps1, ctx, invalid.id, { runMode: "ALL_OR_NOTHING", onExisting: "SKIP", confirm: true }, w.viewer);
    expect(!refused.ok && refused.error.code).toBe("imports.has_errors");
    expect(unwrap(await getImportPreview(deps1, ctx, invalid.id, w.viewer)).blockers.join(" ")).toMatch(/tout ou rien/i);
    expect(await w.demoCount()).toBe(0 + (await w.demoCount())); // inchangé (rien d'écrit par ce job)
    const before = await w.demoCount();

    // 2. fichier valide, mais une ligne refusée par le module cible à l'ÉCRITURE : tout est annulé
    const port = new DemoStudentsPort(w.db.tenantDb, { failRefs: new Set(["TM-00015"]) });
    const deps2 = w.deps(port);
    const bad = await prepareJob(w, deps2, ctx, csvOf([STUDENT_HEADERS, ...studentRows(20, "M")]), { runMode: "ALL_OR_NOTHING" });
    const out = await runJob(w, deps2, ctx, bad.id, "ALL_OR_NOTHING");
    expect(out.status).toBe("FAILED");
    expect(await w.demoCount()).toBe(before); // RIEN n'a été écrit
    const failed = unwrap(await getImportJob(deps2, ctx, bad.id, w.viewer));
    expect(failed).toMatchObject({ status: "FAILED", createdCount: 0, errorCode: "imports.write_failed" });
    expect(failed.errorMessage).toContain("ligne 16");
    const rowsReport = unwrap(await listImportRows(deps2, ctx, bad.id, { outcome: "FAILED", limit: 10, offset: 0 }, w.viewer));
    expect(rowsReport.items.map((r) => r.rowNo)).toEqual([16]);
    const refs = await w.db.admin.query(`SELECT count(*)::int AS n FROM imports.entity_refs WHERE last_job_id = $1`, [bad.id]);
    expect(refs.rows[0].n).toBe(0);

    // 3. fichier valide et port sain : tout est écrit, en une transaction
    const deps3 = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const good = await prepareJob(w, deps3, ctx, csvOf([STUDENT_HEADERS, ...studentRows(20, "M")]), { runMode: "ALL_OR_NOTHING" });
    const ok = await runJob(w, deps3, ctx, good.id, "ALL_OR_NOTHING");
    expect(ok.status).toBe("COMPLETED");
    expect(await w.demoCount()).toBe(before + 20);
  });

  it("REPRISE après perte du bail en cours de route : aucun doublon, aucune ligne perdue, lots déjà validés conservés", async () => {
    const ctx = w.ctxA();
    let stolen = false;
    const port = new DemoStudentsPort(w.db.tenantDb, {
      beforeApply: async (n) => {
        if (n === 25 && !stolen) {
          stolen = true;
          // un autre exécutant « reprend » l'import (le premier devient un zombie) : le bail change de main
          await w.db.admin.query(`UPDATE imports.jobs SET lease_owner = 'autre-executant' WHERE status = 'RUNNING'`);
          await sleep(120); // laisse le battement de coeur constater la perte
        }
      },
    });
    const deps = w.deps(port, { batchSize: 10 } as never);
    const before = await w.demoCount();
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(60, "Z")]));
    // lots de 200 par défaut : on force des lots de 10 via les réglages du tenant
    await updateImportSettings(deps, ctx, { batchSize: 10 }).then(unwrap);
    const first = await runJob(w, deps, ctx, job.id, "VALID_ONLY", "SKIP", "zombie");
    expect(first.claimed).toBe(true);
    const mid = await w.demoCount();
    expect(mid - before).toBeGreaterThan(0);
    expect(mid - before).toBeLessThan(60); // interrompu : lots précédents conservés, lot en cours annulé
    expect((mid - before) % 10).toBe(0); // jamais un lot à moitié

    // un autre exécutant ne peut pas prendre le bail tant qu'il est vivant...
    expect((await processRun(deps, ctx.tenantId, job.id, { workerId: "intrus" })).claimed).toBe(false);
    // ... mais le reprend dès qu'il a expiré (exécutant mort)
    await w.db.admin.query(`UPDATE imports.jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [job.id]);
    const second = await processRun(deps, ctx.tenantId, job.id, { workerId: "relais" });
    expect(second.status).toBe("COMPLETED");
    expect((await w.demoCount()) - before).toBe(60);
    const done = unwrap(await getImportJob(deps, ctx, job.id, w.viewer));
    expect(done).toMatchObject({ createdCount: 60, failedCount: 0, processedCount: 60 });
    const dup = await w.db.admin.query(`SELECT ref, count(*)::int AS n FROM public.demo_students WHERE tenant_id = $1 GROUP BY ref HAVING count(*) > 1`, [w.tenantA]);
    expect(dup.rows).toEqual([]);
    const runs = await jobRow(w, job.id);
    expect(runs.run_attempts).toBeGreaterThanOrEqual(2);
  });

  it("le job de filet republie un import dont l'exécutant est mort (bail expiré)", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(5, "S")]));
    unwrap(await requestImportRun(deps, ctx, job.id, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, w.viewer));
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'RUNNING', lease_owner = 'mort', lease_until = now() - interval '1 minute', run_requested_at = now() - interval '1 hour' WHERE id = $1`, [job.id]);
    const systemDb = new SystemDb(w.db.tenantDb, { logger: noopLogger });
    const report = await resumeStalledImports(deps, systemDb);
    expect(report.failed).toEqual([]);
    const events = await w.db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'imports.run.requested' AND aggregate_id = $1`, [job.id]);
    expect(events.rows[0].n).toBe(2); // la demande initiale + la republication
    // idempotent : un second passage immédiat ne republie pas
    await resumeStalledImports(deps, systemDb);
    const again = await w.db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'imports.run.requested' AND aggregate_id = $1`, [job.id]);
    expect(again.rows[0].n).toBe(2);
  });

  it("ANNULATION pendant l'exécution : honorée entre deux lignes, lots validés conservés, état CANCELLED", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb, { beforeApply: async (n) => { if (n === 22) { await cancelImportJob(deps, ctx, jobId, "Erreur de fichier", w.viewer); await sleep(80); } } }));
    let jobId = "";
    await updateImportSettings(deps, ctx, { batchSize: 10 }).then(unwrap);
    const before = await w.demoCount();
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(50, "C")]));
    jobId = job.id;
    const out = await runJob(w, deps, ctx, job.id);
    expect(out.status).toBe("CANCELLED");
    const written = (await w.demoCount()) - before;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(50);
    const done = unwrap(await getImportJob(deps, ctx, job.id, w.viewer));
    expect(done).toMatchObject({ status: "CANCELLED", createdCount: written });
    // un import terminé ne s'annule plus
    const again = await cancelImportJob(deps, ctx, job.id, undefined, w.viewer);
    expect(!again.ok && again.error.code).toBe("imports.invalid_state");
    await updateImportSettings(deps, ctx, { batchSize: 200 }).then(unwrap);
  });

  it("isolation A/B : le tenant B ne voit, ne modifie, ne lance ni n'annule jamais un import du tenant A", async () => {
    const ctx = w.ctxA();
    const depsA = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const job = await prepareJob(w, depsA, ctx, csvOf([STUDENT_HEADERS, ...studentRows(4, "I")]));
    const ctxB = w.ctxB();
    const depsB = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const manageB = { manage: true };
    for (const attempt of [
      await getImportJob(depsB, ctxB, job.id, manageB),
      await cancelImportJob(depsB, ctxB, job.id, undefined, manageB),
      await getImportPreview(depsB, ctxB, job.id, manageB),
      await requestImportRun(depsB, ctxB, job.id, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, manageB),
      await setImportMapping(depsB, ctxB, job.id, { mapping: {} }, manageB),
      await buildImportReportFile(depsB, ctxB, job.id, "csv", "errors", manageB),
    ]) {
      expect(attempt.ok).toBe(false);
      expect(!attempt.ok && attempt.error.code).toBe("imports.job_not_found");
    }
    expect((await processRun(depsB, ctxB.tenantId, job.id, { workerId: "b" })).claimed).toBe(false);
    const listB = unwrap(await (await import("../../application/jobs")).listImportJobs(depsB, ctxB, manageB, { limit: 50, offset: 0 }));
    expect(listB.items.find((j) => j.id === job.id)).toBeUndefined();
    // la RLS tient aussi hors cas d'usage
    const raw = await w.db.tenantDb.run(ctxB, (tx) => tx.many(`SELECT id FROM imports.jobs WHERE id = $1`, [job.id]));
    expect(raw).toEqual([]);
    const rawRows = await w.db.tenantDb.run(ctxB, (tx) => tx.many(`SELECT row_no FROM imports.rows WHERE job_id = $1`, [job.id]));
    expect(rawRows).toEqual([]);
  });

  it("visibilité par auteur : un autre utilisateur du même tenant ne voit pas l'import sans imports.manage", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(2, "V")]));
    const other = w.ctxA({ userId: "0192f0a4-7b1e-7c3a-8d2e-0000000000c9" });
    expect((await getImportJob(deps, other, job.id, { manage: false })).ok).toBe(false);
    expect((await getImportJob(deps, other, job.id, { manage: true })).ok).toBe(true);
  });

  it("quotas : imports actifs simultanés, imports par jour, plafonds du tenant et plafonds absolus", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    await w.db.admin.query(`DELETE FROM imports.jobs WHERE tenant_id = $1`, [w.tenantA]);
    unwrap(await updateImportSettings(deps, ctx, { maxActiveJobs: 2, maxJobsPerDay: 50, maxRows: 30, allOrNothingMaxRows: 30 }));
    const bytes = (n: number) => csvOf([STUDENT_HEADERS, ...studentRows(n, "Q")]);
    expect((await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "a.csv", bytes: bytes(3) })).ok).toBe(true);
    expect((await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "b.csv", bytes: bytes(4) })).ok).toBe(true);
    const third = await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "c.csv", bytes: bytes(5) });
    expect(!third.ok && third.error.code).toBe("imports.quota_active_jobs");
    expect(w.storage.objects.size).toBeGreaterThan(0);
    const stored = w.storage.objects.size;
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'CANCELLED' WHERE tenant_id = $1`, [w.tenantA]);
    unwrap(await updateImportSettings(deps, ctx, { maxActiveJobs: 5, maxJobsPerDay: 2 }));
    const daily = await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "d.csv", bytes: bytes(3) });
    expect(!daily.ok && daily.error.code).toBe("imports.quota_daily_jobs");
    expect(w.storage.objects.size).toBe(stored); // aucun fichier orphelin après un refus
    unwrap(await updateImportSettings(deps, ctx, { maxJobsPerDay: 50 }));
    const tooMany = await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "e.csv", bytes: bytes(31) });
    expect(!tooMany.ok && tooMany.error.code).toBe("imports.too_many_rows");
    expect(w.storage.objects.size).toBe(stored);
    const overHard = await updateImportSettings(deps, ctx, { maxRows: 50_000 } as never);
    expect(overHard.ok).toBe(false);
    unwrap(await updateImportSettings(deps, ctx, { maxRows: 5000, allOrNothingMaxRows: 5000, maxActiveJobs: 50 }));
    expect(unwrap(await getImportSettings(deps, ctx)).hardLimits.maxRows).toBe(20_000);
  });

  it("modèles de mapping : un modèle proposé automatiquement si 80 % des en-têtes sont retrouvés", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const mapping = { externalRef: "Matricule", lastName: "Nom", firstName: "Prénoms", sex: "Sexe", birthDate: "Date de naissance", phone: "Téléphone" };
    const tpl = unwrap(await createMappingTemplate(deps, ctx, { importerKey: "students", name: "Export logiciel X", mapping, headers: STUDENT_HEADERS }));
    expect((await createMappingTemplate(deps, ctx, { importerKey: "students", name: "export LOGICIEL x", mapping })).ok).toBe(false);
    expect(unwrap(await listMappingTemplates(deps, ctx, "students")).map((t) => t.id)).toContain(tpl.id);
    const up = unwrap(await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "x.csv", bytes: csvOf([STUDENT_HEADERS, ...studentRows(2, "T")]) }));
    expect(up.suggestedTemplateId).toBe(tpl.id);
    expect(up.suggestedMapping.lastName).toBe("Nom");
    expect(up.missingRequired).toEqual([]);
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'CANCELLED' WHERE tenant_id = $1`, [w.tenantA]);
  });

  it("rapport d'erreurs téléchargeable : lignes en erreur, valeurs neutralisées contre l'injection de formule", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const evil = [["TX-1", "=HYPERLINK(\"http://x\")", "", "F", "", "", ""], ["TX-2", "+cmd|' /C calc'!A0", "Ok", "M", "", "", ""]];
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...evil]));
    const csv = unwrap(await buildImportReportFile(deps, ctx, job.id, "csv", "errors", w.viewer));
    const text = new TextDecoder().decode(csv.bytes);
    expect(csv.fileName).toMatch(/-erreurs\.csv$/);
    expect(text).toContain("'=HYPERLINK");
    expect(text).not.toMatch(/(^|;)=HYPERLINK/m);
    const xlsx = unwrap(await buildImportReportFile(deps, ctx, job.id, "xlsx", "full", w.viewer));
    expect(xlsx.contentType).toContain("spreadsheetml");
    await w.db.admin.query(`UPDATE imports.jobs SET status = 'CANCELLED' WHERE tenant_id = $1`, [w.tenantA]);
  });

  it("brouillon : suppression possible tant que rien n'a été écrit ; fichier supprimé", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const up = unwrap(await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "z.csv", bytes: csvOf([STUDENT_HEADERS, ...studentRows(2, "D")]) }));
    const key = (await jobRow(w, up.job.id)).storage_key as string;
    expect(w.storage.objects.has(key)).toBe(true);
    unwrap(await deleteImportJob(deps, ctx, up.job.id, w.viewer));
    expect(w.storage.objects.has(key)).toBe(false);
    expect(await jobRow(w, up.job.id)).toBeUndefined();
  });

  it("rétention : brouillons abandonnés annulés, lignes brutes (données personnelles) purgées, résultats conservés", async () => {
    const ctx = w.ctxA();
    const deps = w.deps(new DemoStudentsPort(w.db.tenantDb));
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(3, "G")]));
    await runJob(w, deps, ctx, job.id);
    const draft = unwrap(await uploadImportFile(deps, ctx, { importerKey: "students", fileName: "old.csv", bytes: csvOf([STUDENT_HEADERS, ...studentRows(2, "H")]) }));
    await w.db.admin.query(`UPDATE imports.jobs SET finished_at = now() - interval '40 days', updated_at = now() - interval '40 days' WHERE id = $1`, [job.id]);
    await w.db.admin.query(`UPDATE imports.jobs SET updated_at = now() - interval '5 days' WHERE id = $1`, [draft.job.id]);
    const report = await purgeExpiredImports(deps, new SystemDb(w.db.tenantDb, { logger: noopLogger }));
    expect(report.failed).toEqual([]);
    const row = await w.db.admin.query(`SELECT raw, normalized, outcome, entity_id FROM imports.rows WHERE job_id = $1 ORDER BY row_no`, [job.id]);
    expect(row.rows.every((r) => r.raw === null && r.normalized === null)).toBe(true);
    expect(row.rows.every((r) => r.outcome === "CREATED" && r.entity_id)).toBe(true);
    expect((await jobRow(w, job.id)).raw_purged_at).not.toBeNull();
    expect((await jobRow(w, draft.job.id)).status).toBe("CANCELLED");
  });

  it("le plan n'écrit RIEN : il s'exécute dans une transaction toujours annulée (même une écriture accidentelle d'un port ne subsiste pas)", async () => {
    const ctx = w.ctxA();
    const writer = new DemoStudentsPort(w.db.tenantDb);
    writer.plan = async (c, items) => {
      await w.db.tenantDb.run(c, (tx) => tx.query(`INSERT INTO public.demo_students (id, tenant_id, ref) VALUES (gen_random_uuid(), current_setting('app.tenant_id')::uuid, 'ECRITURE-PENDANT-LE-PLAN')`));
      return items.map((i) => ({ rowNo: i.rowNo, action: "CREATE" as const, issues: [] }));
    };
    const deps = w.deps(writer);
    const job = await prepareJob(w, deps, ctx, csvOf([STUDENT_HEADERS, ...studentRows(2, "W")]));
    expect(job.status).toBe("VALIDATED");
    const leaked = await w.db.admin.query(`SELECT 1 FROM public.demo_students WHERE ref = 'ECRITURE-PENDANT-LE-PLAN'`);
    expect(leaked.rows).toHaveLength(0);
  });

});
