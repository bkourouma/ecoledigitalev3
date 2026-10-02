/**
 * Étape 1 — UPLOAD. Contrôle le fichier (type réel, taille, structure, plafonds), le range dans le stockage d'objets,
 * met ses lignes brutes en table (par lots, en flux : la mémoire reste bornée) et propose le mapping de colonnes.
 *
 * Ordre : quotas -> ouverture sûre du fichier -> stockage -> transaction (import, lignes, événement, audit). Si la
 * transaction échoue (plafond de lignes dépassé en cours de lecture...), l'objet stocké est supprimé.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { IMPORT_EVENTS, type ImportUploadResult, type ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import { FileRejectedError, conflict, validation } from "../domain/errors";
import { detectMapping, matchTemplate } from "../domain/mapping";
import { findImporter } from "../importers/registry";
import { countActiveJobs, countJobsSince, findPreviousImportOfFile, getSettings, insertJob, listTemplates, lockTenantQuota, updateJob } from "../infrastructure/jobs-repository";
import { insertRawRows } from "../infrastructure/rows-repository";
import { openUploadedFile } from "../infrastructure/files/read";
import { MIB, type FileLimits } from "../infrastructure/files/types";
import { getJob } from "../infrastructure/jobs-repository";
import { EventBuffer, inTx, type ImportsDeps } from "./deps";
import { toJobDto } from "./views";

export interface UploadInput {
  importerKey: ImporterKey;
  fileName: string;
  contentType?: string | undefined;
  sheet?: string | undefined;
  bytes: Uint8Array;
}

const ROW_BATCH = 500;
const EXT_OF: Record<string, string> = { XLSX: "xlsx", CSV: "csv" };

export async function uploadImportFile(deps: ImportsDeps, ctx: RequestContext, input: UploadInput): Promise<Result<ImportUploadResult, AppError>> {
  const importer = findImporter(input.importerKey);
  if (!importer) return err(validation("imports.importer_unknown", "Importeur inconnu.", "importer"));
  if (ctx.userId === null) return err(validation("imports.invalid_state", "Un import est lancé par un utilisateur.", "userId"));

  // 1. Réglages et quotas (verrou : deux téléversements simultanés ne dépassent pas le quota).
  const pre = await deps.db.run(ctx, async (tx) => ({ settings: await getSettings(tx), active: await countActiveJobs(tx) }), { readOnly: true });
  const settings = pre.settings;
  if (pre.active >= settings.maxActiveJobs) {
    return err(conflict("imports.quota_active_jobs", `Trop d'imports en cours (${settings.maxActiveJobs} au plus) : terminez ou annulez un import avant d'en commencer un autre.`, { limit: settings.maxActiveJobs }));
  }
  const limits: FileLimits = {
    maxBytes: Math.min(settings.maxFileBytes, deps.config.hardMaxFileBytes),
    maxRows: Math.min(settings.maxRows, deps.config.hardMaxRows),
    maxColumns: Math.min(settings.maxColumns, deps.config.hardMaxColumns),
    maxCellChars: 2000,
    maxZipEntries: 500,
    maxZipUncompressedBytes: 50 * MIB,
    maxZipRatio: 100,
  };

  // 2. Ouverture sûre : type réel, taille, annuaire du ZIP, en-têtes. Lève FileRejectedError (400) sinon.
  let opened: Awaited<ReturnType<typeof openUploadedFile>>;
  try {
    opened = await openUploadedFile(input.bytes, { fileName: input.fileName, contentType: input.contentType, sheet: input.sheet }, limits);
  } catch (e) {
    if (e instanceof FileRejectedError) return err(e);
    throw e;
  }
  const { reader } = opened;

  // 3. Stockage de l'original (preuve, rejeu, audit). Aucun fichier n'est conservé sans import en base.
  const jobId = deps.newId();
  const storageKey = `imports/${ctx.tenantId}/${jobId}.${EXT_OF[reader.kind]}`;
  await deps.ports.storage.put(storageKey, input.bytes, { contentType: reader.kind === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });

  let result: Result<ImportUploadResult, AppError>;
  try {
    result = await inTx(deps, ctx, async (tx) => {
      await lockTenantQuota(tx);
      const active = await countActiveJobs(tx);
      if (active >= settings.maxActiveJobs) {
        return err(conflict("imports.quota_active_jobs", `Trop d'imports en cours (${settings.maxActiveJobs} au plus) : terminez ou annulez un import avant d'en commencer un autre.`, { limit: settings.maxActiveJobs }));
      }
      const today = await countJobsSince(tx, new Date(deps.clock.now().getTime() - 24 * 3600_000));
      if (today >= settings.maxJobsPerDay) {
        return err(conflict("imports.quota_daily_jobs", `Quota journalier atteint (${settings.maxJobsPerDay} imports par 24 h).`, { limit: settings.maxJobsPerDay }));
      }
      const previous = await findPreviousImportOfFile(tx, input.importerKey, opened.sha256);
      const now = deps.clock.now();
      await insertJob(
        tx,
        {
          id: jobId,
          tenantId: ctx.tenantId,
          importerKey: input.importerKey,
          fileName: opened.fileName,
          fileKind: reader.kind,
          fileSize: opened.size,
          fileSha256: opened.sha256,
          storageKey,
          sheetName: reader.sheetName,
          headers: reader.headers,
          warnings: [],
          duplicateOfJobId: previous?.id ?? null,
          createdBy: ctx.userId as string,
        },
        now,
      );

      // Lignes brutes, par lots (le lecteur est un générateur : jamais tout le fichier en mémoire).
      let batch: Array<{ rowNo: number; cells: string[] }> = [];
      let total = 0;
      for await (const row of reader.rows()) {
        batch.push(row);
        total += 1;
        if (batch.length >= ROW_BATCH) {
          await insertRawRows(tx, ctx.tenantId, jobId, batch);
          batch = [];
        }
      }
      if (batch.length > 0) await insertRawRows(tx, ctx.tenantId, jobId, batch);
      if (total === 0) return err(new FileRejectedError("imports.no_header", "Le fichier ne contient aucune ligne de données sous les en-têtes."));

      const warnings = [...reader.warnings];
      if (previous) warnings.push({ code: "imports.already_imported", message: "Ce fichier (même contenu) a déjà été importé : les lignes déjà importées seront ignorées, sans doublon." });
      await updateJob(tx, jobId, { totalRows: total, warnings }, now);

      const events = new EventBuffer(deps, ctx);
      events.add(IMPORT_EVENTS.jobCreated, { v: 1, jobId, importerKey: input.importerKey, totalRows: total }, { type: "import_job", id: jobId });
      events.audit({
        action: "imports.job.create",
        entity: "import_job",
        entityId: jobId,
        metadata: { importerKey: input.importerKey, fileKind: reader.kind, fileSize: opened.size, fileSha256: opened.sha256, totalRows: total, columns: reader.headers.length, warnings: warnings.map((w) => w.code) },
      });
      await events.flush(tx);

      // Mapping proposé : modèle enregistré (>= 80 % des en-têtes) sinon détection par en-têtes.
      const templates = await listTemplates(tx, input.importerKey);
      const matched = matchTemplate(
        templates.map((t) => ({ id: t.id, mapping: t.mapping, headers: t.headers, updatedAt: t.updatedAt.toISOString() })),
        reader.headers,
        importer.columns,
      );
      const detection = detectMapping(importer.columns, reader.headers);
      const suggestedMapping = matched ? matched.mapping : detection.mapping;
      const used = new Set(Object.values(suggestedMapping).filter((v): v is string => v !== null));
      const job = await getJob(tx, jobId);
      if (!job) throw new Error("Import introuvable après création.");
      const sample = (await tx.many<{ raw: string[] }>(`SELECT raw FROM imports.rows WHERE job_id = $1 ORDER BY row_no LIMIT 5`, [jobId])).map((r) => r.raw);
      return ok<ImportUploadResult>({
        job: toJobDto(job, { sheetNames: reader.sheetNames }),
        suggestedMapping,
        suggestedTemplateId: matched?.template.id ?? null,
        missingRequired: importer.columns.filter((c) => c.required && suggestedMapping[c.key] === null).map((c) => c.key),
        unmappedHeaders: reader.headers.filter((h) => !used.has(h)),
        sample,
      });
    });
  } catch (e) {
    await deps.ports.storage.delete(storageKey).catch(() => undefined);
    throw e;
  }
  // Un refus métier (quota, fichier sans ligne) ne laisse aucun objet orphelin.
  if (!result.ok) await deps.ports.storage.delete(storageKey).catch(() => undefined);
  return result;
}

