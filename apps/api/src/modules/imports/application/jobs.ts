/**
 * Étape 2 — MAPPING et cycle de vie d'un import : lecture, liste, mapping et options, annulation, suppression, valeurs
 * proposées pour les options. La visibilité est celle de l'AUTEUR : un import n'est lisible que par celui qui l'a créé ou
 * par un gestionnaire (`imports.manage`) ; les autres reçoivent « introuvable » (aucune fuite d'existence).
 */
import { ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { IMPORT_EVENTS, type ImportChoice, type ImportJobDto, type ImportJobPage, type ImportMappingBody, type ImporterKey, type ImportJobStatus } from "@ecoledigitale/contracts/src/v2/imports";
import { conflict, notFound, validation } from "../domain/errors";
import { validateMapping } from "../domain/mapping";
import { hasErrors } from "../domain/types";
import type { JobRecord } from "../domain/records";
import { findImporter } from "../importers/registry";
import { deleteJob, getJob, getTemplate, listJobs, updateJob, releaseLease } from "../infrastructure/jobs-repository";
import { resetValidation } from "../infrastructure/rows-repository";
import { EventBuffer, inTx, type ImportsDeps } from "./deps";
import { toJobDto } from "./views";

/** Qui regarde : l'identité vient du contexte ; `manage` = `imports.manage` (voit et agit sur les imports des autres). */
export interface Viewer {
  readonly manage: boolean;
}

export const canSee = (job: JobRecord, ctx: RequestContext, viewer: Viewer): boolean => viewer.manage || job.createdBy === ctx.userId;

export async function loadVisibleJob(tx: import("@ecoledigitale/database").Tx, ctx: RequestContext, id: string, viewer: Viewer, options: { forUpdate?: boolean } = {}): Promise<Result<JobRecord, AppError>> {
  const job = await getJob(tx, id, options);
  if (!job || !canSee(job, ctx, viewer)) return err(notFound("imports.job_not_found", "Import", id));
  return ok(job);
}

/** Enregistrement complet d'un import visible (décisions d'accès de la couche HTTP : importeur, mapping, politique). */
export async function loadImportJobRecord(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer): Promise<Result<JobRecord, AppError>> {
  return inTx(deps, ctx, (tx) => loadVisibleJob(tx, ctx, id, viewer), { readOnly: true });
}

export async function getImportJob(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer): Promise<Result<ImportJobDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const job = await loadVisibleJob(tx, ctx, id, viewer);
      return job.ok ? ok(toJobDto(job.value)) : job;
    },
    { readOnly: true },
  );
}

export async function listImportJobs(
  deps: ImportsDeps,
  ctx: RequestContext,
  viewer: Viewer,
  filter: { importerKey?: ImporterKey | undefined; status?: ImportJobStatus | undefined; mine?: boolean | undefined; limit: number; offset: number },
): Promise<Result<ImportJobPage, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const onlyMine = !viewer.manage || filter.mine === true;
      const page = await listJobs(tx, { importerKey: filter.importerKey, status: filter.status, createdBy: onlyMine ? (ctx.userId ?? undefined) : undefined, limit: filter.limit, offset: filter.offset });
      return ok({ items: page.items.map((j) => toJobDto(j)), total: page.total, limit: filter.limit, offset: filter.offset });
    },
    { readOnly: true },
  );
}

const MAPPABLE: readonly ImportJobStatus[] = ["UPLOADED", "MAPPED", "VALIDATED"];

export async function setImportMapping(deps: ImportsDeps, ctx: RequestContext, id: string, body: ImportMappingBody, viewer: Viewer): Promise<Result<ImportJobDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleJob(tx, ctx, id, viewer, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const job = loaded.value;
    if (!MAPPABLE.includes(job.status)) return err(conflict("imports.invalid_state", `Le mapping ne peut plus être modifié (état : ${job.status}).`, { status: job.status }));
    const importer = findImporter(job.importerKey);
    if (!importer) return err(validation("imports.importer_unknown", "Importeur inconnu.", "importerKey"));

    const problems = validateMapping(importer.columns, job.headers, body.mapping);
    if (problems.length > 0) {
      const code = problems.some((p) => p.code === "imports.mapping_invalid") ? "imports.mapping_invalid" : "imports.mapping_incomplete";
      return err(new ValidationError("Le mapping des colonnes est invalide ou incomplet.", problems.map((p) => ({ path: ["mapping", ...(p.field ? [p.field] : [])], message: p.message, code: p.code })), { code }));
    }
    const options = { ...(body.options ?? job.options) } as Record<string, string | number | boolean>;
    const runMode = body.runMode ?? job.runMode;
    const onExisting = body.onExisting ?? job.onExisting;
    if (onExisting === "UPDATE" && !importer.supportsUpdate) {
      return err(validation("imports.options_invalid", "Cet importeur ne met jamais à jour l'existant (documents financiers immuables) : choisissez « ignorer ».", "onExisting"));
    }
    const optionIssues = importer.validateOptions(options).filter((i) => i.severity === "ERROR");
    if (optionIssues.length > 0) {
      return err(new ValidationError("Options invalides.", optionIssues.map((i) => ({ path: ["options", i.column ?? "options"], message: i.message, code: i.code })), { code: "imports.options_invalid" }));
    }
    // Les objets désignés par les options existent-ils (année, évaluation, version...) ? Lecture par le module cible.
    const target = deps.ports.target(job.importerKey);
    if (target.checkOptions) {
      const issues = await target.checkOptions(ctx, options);
      if (hasErrors(issues)) {
        return err(new ValidationError("Options invalides.", issues.filter((i) => i.severity === "ERROR").map((i) => ({ path: ["options", i.column ?? "options"], message: i.message, code: i.code })), { code: "imports.options_invalid" }));
      }
    }
    if (body.templateId) {
      const tpl = await getTemplate(tx, body.templateId);
      if (!tpl || tpl.importerKey !== job.importerKey) return err(notFound("imports.template_not_found", "Modèle de mapping", body.templateId));
    }

    const mapping = Object.fromEntries(importer.columns.map((c) => [c.key, body.mapping[c.key] ?? null]));
    const now = deps.clock.now();
    await resetValidation(tx, id);
    await updateJob(
      tx,
      id,
      {
        status: "MAPPED",
        mapping,
        mappingTemplateId: body.templateId ?? null,
        options,
        runMode,
        onExisting,
        validRows: 0,
        invalidRows: 0,
        plannedCreate: 0,
        plannedUpdate: 0,
        plannedSkip: 0,
        validationProgress: 0,
        validatedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      now,
    );
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.job.map", entity: "import_job", entityId: id, metadata: { importerKey: job.importerKey, mappedColumns: Object.entries(mapping).filter(([, v]) => v !== null).map(([k]) => k), runMode, onExisting, templateId: body.templateId ?? null } });
    await events.flush(tx);
    const updated = await getJob(tx, id);
    return ok(toJobDto(updated as JobRecord));
  });
}

/**
 * Annulation : avant l'exécution, immédiate ; pendant l'exécution, demandée (honorée entre deux lignes par l'exécutant,
 * qui finalise l'état). Un import terminé ne s'annule pas.
 */
export async function cancelImportJob(deps: ImportsDeps, ctx: RequestContext, id: string, reason: string | undefined, viewer: Viewer): Promise<Result<ImportJobDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleJob(tx, ctx, id, viewer, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const job = loaded.value;
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    if (job.status === "RUNNING") {
      if (!job.cancelRequested) {
        await updateJob(tx, id, { cancelRequested: true }, now);
        events.audit({ action: "imports.run.cancel_requested", entity: "import_job", entityId: id, reason: reason ?? null, metadata: { importerKey: job.importerKey }, severity: "notice" });
      }
    } else if (["UPLOADED", "MAPPED", "VALIDATING", "VALIDATED", "QUEUED"].includes(job.status)) {
      await updateJob(tx, id, { status: "CANCELLED", finishedAt: now, cancelRequested: true, leaseOwner: null, leaseUntil: null }, now);
      events.add(IMPORT_EVENTS.runCancelled, { v: 1, jobId: id, importerKey: job.importerKey, processed: job.processedCount }, { type: "import_job", id });
      events.audit({ action: "imports.job.cancel", entity: "import_job", entityId: id, reason: reason ?? null, metadata: { importerKey: job.importerKey, previousStatus: job.status }, severity: "notice" });
    } else {
      return err(conflict("imports.invalid_state", `Cet import est déjà terminé (${job.status}) : il ne peut plus être annulé.`, { status: job.status }));
    }
    await events.flush(tx);
    const updated = await getJob(tx, id);
    return ok(toJobDto(updated as JobRecord));
  });
}

/** Supprime un import qui n'a rien écrit (brouillon, annulé sans ligne traitée, échoué) : lignes en cascade, fichier supprimé. */
export async function deleteImportJob(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer): Promise<Result<{ id: string }, AppError>> {
  const result = await inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleJob(tx, ctx, id, viewer, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const job = loaded.value;
    if (["VALIDATING", "QUEUED", "RUNNING"].includes(job.status)) return err(conflict("imports.invalid_state", "Cet import est en cours : annulez-le d'abord.", { status: job.status }));
    if (job.processedCount > 0 || job.status === "COMPLETED" || job.status === "COMPLETED_WITH_ERRORS") {
      return err(conflict("imports.invalid_state", "Cet import a écrit des données : il reste dans l'historique.", { status: job.status }));
    }
    await releaseLease(tx, id, job.leaseOwner ?? "");
    await deleteJob(tx, id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.job.delete", entity: "import_job", entityId: id, metadata: { importerKey: job.importerKey, status: job.status } });
    await events.flush(tx);
    return ok({ id, storageKey: job.storageKey });
  });
  if (!result.ok) return result;
  if (result.value.storageKey) await deps.ports.storage.delete(result.value.storageKey).catch(() => undefined);
  return ok({ id });
}

/** Valeurs proposées pour une option : fixes (déclarées par l'importeur) sinon fournies par le module cible. */
export async function listOptionChoices(deps: ImportsDeps, ctx: RequestContext, importerKey: ImporterKey, optionKey: string, query?: string): Promise<Result<ImportChoice[], AppError>> {
  const importer = findImporter(importerKey);
  if (!importer) return err(validation("imports.importer_unknown", "Importeur inconnu.", "importer"));
  const option = importer.options.find((o) => o.key === optionKey);
  if (!option) return err(validation("imports.options_invalid", "Option inconnue.", "option"));
  if (option.choices) return ok([...option.choices]);
  if (option.kind !== "choice") return ok([]);
  const target = deps.ports.target(importerKey);
  return ok(target.choices ? await target.choices(ctx, optionKey, query) : []);
}
