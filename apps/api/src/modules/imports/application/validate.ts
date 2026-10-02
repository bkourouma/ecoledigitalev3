/**
 * Étapes 3 à 5 — VALIDATION, ERREURS, PREVIEW.
 *
 * `requestImportValidation` (API) passe l'import en `VALIDATING` et publie `imports.job.validation_requested` ; le worker
 * appelle `processValidation` qui, en trois passes REPRENABLES et par lots (mémoire bornée), calcule pour chaque ligne :
 *   1. lecture : mapping + coercion + schéma + règles métier + clé naturelle ;
 *   2. doublons dans le fichier (SQL, une requête) ;
 *   3. plan : ce que le module cible ferait de la ligne (créer / mettre à jour / ignorer / refuser) — LECTURE SEULE
 *      (exécuté dans une transaction TOUJOURS annulée : rien ne peut subsister, même par effet de bord).
 * Aucune écriture dans les modules cibles n'a lieu ici.
 */
import { createSystemContext, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { IMPORT_EVENTS, type ImportJobDto, type ImportPreview } from "@ecoledigitale/contracts/src/v2/imports";
import { conflict } from "../domain/errors";
import { cellsFor } from "../domain/mapping";
import type { JobRecord } from "../domain/records";
import { ACTIVE_STATUSES } from "../domain/records";
import { hasErrors, issue, type ImportIssue, type ImportOptions } from "../domain/types";
import { validateRow } from "../domain/validation";
import { getImporter } from "../importers/registry";
import { claimJob, getJob, getRefs, getSettings, releaseLease, updateJob } from "../infrastructure/jobs-repository";
import { fetchPending, fetchValidAfter, markDuplicates, resetValidation, samples, savePlan, saveValidation, stats, topIssues, validKeys, type PlanWrite, type ValidationWrite } from "../infrastructure/rows-repository";
import type { PlanItem } from "./ports";
import { actorContext, EventBuffer, inTx, snapshotOf, type ImportsDeps } from "./deps";
import { LeaseLostError, startHeartbeat } from "./heartbeat";
import { loadVisibleJob, type Viewer } from "./jobs";
import { toJobDto, toRowDto } from "./views";

export async function requestImportValidation(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer): Promise<Result<ImportJobDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleJob(tx, ctx, id, viewer, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const job = loaded.value;
    if (job.status !== "MAPPED" && job.status !== "VALIDATED") {
      return err(conflict("imports.invalid_state", job.status === "UPLOADED" ? "Associez d'abord les colonnes (étape « Mapping »)." : `L'import ne peut pas être validé dans l'état ${job.status}.`, { status: job.status }));
    }
    if (!job.mapping) return err(conflict("imports.mapping_incomplete", "Associez d'abord les colonnes (étape « Mapping »)."));
    const now = deps.clock.now();
    if (job.status === "VALIDATED") await resetValidation(tx, id);
    const actor = snapshotOf(ctx);
    await updateJob(
      tx,
      id,
      {
        status: "VALIDATING",
        validRows: 0,
        invalidRows: 0,
        plannedCreate: 0,
        plannedUpdate: 0,
        plannedSkip: 0,
        validationProgress: 0,
        validatedAt: null,
        errorCode: null,
        errorMessage: null,
        runRequestedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        actorUserId: actor.userId,
        actorRoles: [...actor.roles],
        actorMfa: actor.mfa,
        actorInstitutionId: actor.institutionId,
        actorCampusId: actor.campusId,
      },
      now,
    );
    const events = new EventBuffer(deps, ctx);
    events.add(IMPORT_EVENTS.validationRequested, { v: 1, jobId: id, importerKey: job.importerKey, totalRows: job.totalRows }, { type: "import_job", id });
    events.audit({ action: "imports.job.validate", entity: "import_job", entityId: id, metadata: { importerKey: job.importerKey, totalRows: job.totalRows } });
    await events.flush(tx);
    return ok(toJobDto((await getJob(tx, id)) as JobRecord));
  });
}

/** Signal : porte le résultat d'un plan hors de sa transaction, qui est ainsi TOUJOURS annulée. */
class PlanRollback<T> extends Error {
  constructor(readonly value: T) {
    super("plan-rollback");
  }
}

/**
 * Exécute `plan` dans une transaction qui est TOUJOURS annulée : le plan ne peut rien écrire, même par un effet de bord
 * d'une lecture (amorçage paresseux de référentiels, verrous consultatifs...). Garantie plus forte qu'un `READ ONLY` qui
 * ferait échouer ces lectures légitimes.
 */
async function planRolledBack<T>(deps: ImportsDeps, ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  try {
    await deps.db.run(ctx, async () => {
      throw new PlanRollback(await fn());
    });
  } catch (e) {
    if (e instanceof PlanRollback) return e.value as T;
    throw e;
  }
  throw new Error("plan : transaction terminée sans résultat");
}

export interface ProcessOutcome {
  claimed: boolean;
  status?: JobRecord["status"];
  error?: string;
}

const messageOf = (e: unknown): string => (e instanceof Error && "code" in e ? e.message : "Erreur interne pendant la validation.");
const codeOf = (e: unknown): string => (e instanceof Error && typeof (e as { code?: unknown }).code === "string" ? ((e as unknown as { code: string }).code) : "imports.write_failed");

/** Exécutée par le worker (ou un test) : valide un import `VALIDATING`. Idempotente et reprenable. */
export async function processValidation(deps: ImportsDeps, tenantId: string, jobId: string, options: { workerId: string }): Promise<ProcessOutcome> {
  const sys = createSystemContext(tenantId, `imports:validation:${jobId}`);
  const claimed = await deps.db.run(sys, (tx) => claimJob(tx, jobId, ["VALIDATING"], options.workerId, deps.config.leaseSeconds));
  if (!claimed) return { claimed: false };
  const job = claimed;
  const importer = getImporter(job.importerKey);
  const settings = await deps.db.run(sys, (tx) => getSettings(tx), { readOnly: true });
  const batch = Math.max(1, Math.min(settings.batchSize, 500));
  const heartbeat = startHeartbeat(deps, tenantId, jobId, options.workerId, "validation");
  const mapping = (job.mapping ?? {}) as Record<string, string | null>;
  const jobOptions = job.options as ImportOptions;
  const env = { today: deps.clock.now().toISOString().slice(0, 10) };
  try {
    if (!job.actorUserId) throw new Error("Import sans acteur : validation impossible.");
    const ctx = actorContext(tenantId, jobId, { userId: job.actorUserId, roles: job.actorRoles, mfa: job.actorMfa, institutionId: job.actorInstitutionId, campusId: job.actorCampusId }, "validation");
    const target = deps.ports.target(job.importerKey);

    // --- Passe 1 : lecture, coercion, schéma, règles, clé naturelle -----------------------------------------------------
    let done = 0;
    for (;;) {
      heartbeat.assertHeld();
      const pending = await deps.db.run(sys, (tx) => fetchPending(tx, jobId, batch), { readOnly: true });
      if (pending.length === 0) break;
      const writes: ValidationWrite[] = pending.map((row) => {
        const cells = cellsFor(mapping, job.headers, row.raw ?? []);
        const r = validateRow(importer, cells, jobOptions, env);
        const withHeaders = r.issues.map((i) => ({ ...i, header: i.column ? (mapping[i.column] ?? null) : null }));
        return { rowNo: row.rowNo, normalized: r.values, naturalKey: r.naturalKey, validation: hasErrors(r.issues) ? "INVALID" : "VALID", issues: withHeaders };
      });
      await deps.db.run(sys, (tx) => saveValidation(tx, jobId, writes));
      done += writes.length;
      heartbeat.state.progress = Math.floor(done / 2);
    }

    // --- Passe 2 : doublons dans le fichier -----------------------------------------------------------------------------
    await deps.db.run(sys, (tx) => markDuplicates(tx, jobId));

    // --- Passe 3 : plan contre l'existant (transaction toujours annulée : aucune écriture ne subsiste) ---------------------------------------------------------------
    const keyRows = await deps.db.run(sys, (tx) => validKeys(tx, jobId), { readOnly: true });
    const run = { jobId, options: jobOptions, onExisting: job.onExisting, mode: job.runMode } as const;
    let after = 0;
    let planned = 0;
    const total = Math.max(1, job.totalRows);
    for (;;) {
      heartbeat.assertHeld();
      const rows = await deps.db.run(sys, (tx) => fetchValidAfter(tx, jobId, after, batch), { readOnly: true });
      if (rows.length === 0) break;
      after = rows[rows.length - 1]?.rowNo ?? after;
      const wanted: string[] = [];
      for (const r of rows) {
        if (r.naturalKey) wanted.push(r.naturalKey);
        wanted.push(...(importer.relatedKeys?.(r.normalized, jobOptions) ?? []));
      }
      const refs = await deps.db.run(sys, (tx) => getRefs(tx, job.importerKey, wanted), { readOnly: true });
      const writes: PlanWrite[] = [];
      const toPlan: Array<PlanItem> = [];
      for (const r of rows) {
        const known = r.naturalKey ? (refs.get(r.naturalKey) ?? null) : null;
        if (known && (job.onExisting === "SKIP" || !importer.supportsUpdate)) {
          writes.push({ rowNo: r.rowNo, action: "SKIP", entityId: known, validation: "VALID", issues: [...r.issues, issue(null, "imports.already_imported", "Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon).", "WARNING")] });
          continue;
        }
        const relatedKeys = importer.relatedKeys?.(r.normalized, jobOptions) ?? [];
        const related = Object.fromEntries(relatedKeys.filter((k) => refs.has(k)).map((k) => [k, refs.get(k) as string]));
        const inFile = new Set((importer.dependsOnKeys?.(r.normalized, jobOptions) ?? []).filter((k) => (keyRows.get(k) ?? Number.MAX_SAFE_INTEGER) < r.rowNo));
        toPlan.push({ rowNo: r.rowNo, key: r.naturalKey, row: r.normalized, knownEntityId: known, related, inFileDependencies: inFile });
      }
      if (toPlan.length > 0) {
        const results = await planRolledBack(deps, ctx, () => target.plan(ctx, toPlan, run));
        const byRow = new Map(results.map((p) => [p.rowNo, p]));
        for (const item of toPlan) {
          const base = rows.find((x) => x.rowNo === item.rowNo)?.issues ?? [];
          const p = byRow.get(item.rowNo);
          if (!p) {
            writes.push({ rowNo: item.rowNo, action: "ERROR", entityId: null, validation: "INVALID", issues: [...base, issue(null, "imports.reference_unknown", "Le module cible n'a pas pu évaluer cette ligne.")] });
            continue;
          }
          const all: ImportIssue[] = [...base, ...p.issues];
          const failed = p.action === "ERROR" || hasErrors(p.issues);
          writes.push({ rowNo: item.rowNo, action: failed ? "ERROR" : p.action, entityId: p.entityId ?? null, validation: failed ? "INVALID" : "VALID", issues: all });
        }
      }
      await deps.db.run(sys, (tx) => savePlan(tx, jobId, writes));
      planned += rows.length;
      heartbeat.state.progress = Math.floor(job.totalRows / 2 + (planned / total) * (job.totalRows / 2));
    }

    // --- Fin : décomptes, état, événement, audit ------------------------------------------------------------------------
    await heartbeat.stop();
    return await deps.db.run(sys, async (tx) => {
      const s = await stats(tx, jobId);
      const now = deps.clock.now();
      const current = await getJob(tx, jobId, { forUpdate: true });
      if (!current || current.status !== "VALIDATING" || current.leaseOwner !== options.workerId) throw new LeaseLostError();
      await updateJob(
        tx,
        jobId,
        { status: "VALIDATED", validRows: s.valid, invalidRows: s.invalid, plannedCreate: s.plannedCreate, plannedUpdate: s.plannedUpdate, plannedSkip: s.plannedSkip, validationProgress: current.totalRows, validatedAt: now, leaseOwner: null, leaseUntil: null },
        now,
      );
      const events = new EventBuffer(deps, sys);
      events.add(IMPORT_EVENTS.jobValidated, { v: 1, jobId, importerKey: job.importerKey, valid: s.valid, invalid: s.invalid }, { type: "import_job", id: jobId });
      events.audit({ action: "imports.job.validated", entity: "import_job", entityId: jobId, metadata: { importerKey: job.importerKey, valid: s.valid, invalid: s.invalid, create: s.plannedCreate, update: s.plannedUpdate, skip: s.plannedSkip } });
      await events.flush(tx);
      return { claimed: true, status: "VALIDATED" as const };
    });
  } catch (e) {
    await heartbeat.stop();
    if (e instanceof LeaseLostError) return { claimed: true };
    const message = messageOf(e);
    deps.logger.error({ jobId, err: e instanceof Error ? e.message : String(e) }, "imports : validation en échec");
    await deps.db.run(sys, async (tx) => {
      const current = await getJob(tx, jobId, { forUpdate: true });
      if (current && current.status === "VALIDATING" && current.leaseOwner === options.workerId) {
        await updateJob(tx, jobId, { status: "MAPPED", errorCode: codeOf(e), errorMessage: message, leaseOwner: null, leaseUntil: null }, deps.clock.now());
      } else if (current) await releaseLease(tx, jobId, options.workerId);
    });
    return { claimed: true, status: "MAPPED", error: message };
  }
}

/** Étape 5 — PREVIEW : décomptes et échantillons par action, erreurs les plus fréquentes, verdict de lancement. Aucune écriture. */
export async function getImportPreview(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer): Promise<Result<ImportPreview, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadVisibleJob(tx, ctx, id, viewer);
      if (!loaded.ok) return loaded;
      const job = loaded.value;
      const settings = await getSettings(tx);
      const s = await stats(tx, id);
      const [create, update, skip, error, top] = [await samples(tx, id, "CREATE"), await samples(tx, id, "UPDATE"), await samples(tx, id, "SKIP"), await samples(tx, id, "ERROR"), await topIssues(tx, id, "issues")];
      const blockers: string[] = [];
      const validated = job.status === "VALIDATED" || (["QUEUED", "RUNNING", "COMPLETED", "COMPLETED_WITH_ERRORS"] as string[]).includes(job.status);
      if (!validated) blockers.push("La validation n'est pas terminée.");
      if (s.valid - s.plannedSkip <= 0 && validated) blockers.push("Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées.");
      if (job.runMode === "ALL_OR_NOTHING" && s.invalid > 0) blockers.push("Mode « tout ou rien » : corrigez les erreurs ou choisissez « lignes valides seulement ».");
      if (job.runMode === "ALL_OR_NOTHING" && job.totalRows > settings.allOrNothingMaxRows) blockers.push(`Mode « tout ou rien » limité à ${settings.allOrNothingMaxRows} lignes.`);
      return ok<ImportPreview>({
        jobId: id,
        totalRows: s.total,
        validRows: s.valid,
        invalidRows: s.invalid,
        willCreate: s.plannedCreate,
        willUpdate: s.plannedUpdate,
        willSkip: s.plannedSkip,
        willFail: s.invalid,
        warnings: s.withWarnings,
        topIssues: top,
        samples: { create: create.map(toRowDto), update: update.map(toRowDto), skip: skip.map(toRowDto), error: error.map(toRowDto) },
        canRun: blockers.length === 0 && job.status === "VALIDATED",
        blockers,
      });
    },
    { readOnly: true },
  );
}

export { ACTIVE_STATUSES };
