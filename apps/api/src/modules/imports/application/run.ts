/**
 * Étapes 6 et 7 — IMPORT et RAPPORT.
 *
 * `requestImportRun` (API) fige le contexte de l'auteur, passe l'import en `QUEUED` et publie `imports.run.requested` ;
 * le worker appelle `processRun`, qui écrit dans les modules cibles PAR LEURS PORTS, avec l'identité de l'auteur :
 *
 *  - `VALID_ONLY` : lots transactionnels. UN lot = UNE transaction qui contient les écritures des modules cibles (un
 *    SAVEPOINT par ligne : une ligne refusée n'annule pas les autres), les résultats par ligne, les références
 *    d'idempotence et les compteurs. Un arrêt brutal revient au dernier lot validé : rien n'est perdu ni dupliqué.
 *  - `ALL_OR_NOTHING` : le fichier doit être entièrement valide ; il est écrit dans UNE transaction. Le moindre refus (ou
 *    une annulation, ou un crash) n'écrit RIEN.
 *
 * Reprise : un bail (`lease_until`) désigne l'exécutant ; il est renouvelé par un battement de coeur hors transaction. Un
 * exécutant mort est remplacé après expiration. Les lignes ayant un résultat ne sont jamais rejouées.
 */
import { createSystemContext, err, isAppError, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { IMPORT_EVENTS, type ImportJobDto, type ImportReport, type ImportRunBody } from "@ecoledigitale/contracts/src/v2/imports";
import { conflict, forbidden, RollbackSignal } from "../domain/errors";
import { issue, type ImportIssue, type ImportOptions } from "../domain/types";
import type { JobRecord } from "../domain/records";
import { getImporter } from "../importers/registry";
import { claimJob, getJob, getRefs, getSettings, releaseLease, updateJob, upsertRefs, type RefWrite } from "../infrastructure/jobs-repository";
import { fetchRunnable, saveOutcomes, stats, topIssues, type OutcomeWrite } from "../infrastructure/rows-repository";
import type { ApplyItem, ApplyResult, ImportTargetPort, PlanRun } from "./ports";
import { actorContext, EventBuffer, inTx, snapshotOf, type ImportsDeps } from "./deps";
import { LeaseLostError, startHeartbeat, type Heartbeat } from "./heartbeat";
import { loadVisibleJob, type Viewer } from "./jobs";
import { toJobDto } from "./views";

export async function requestImportRun(deps: ImportsDeps, ctx: RequestContext, id: string, body: ImportRunBody, viewer: Viewer): Promise<Result<ImportJobDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisibleJob(tx, ctx, id, viewer, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const job = loaded.value;
    const importer = getImporter(job.importerKey);
    if (job.status === "QUEUED" || job.status === "RUNNING") return err(conflict("imports.run_already_started", "Cet import est déjà lancé.", { status: job.status }));
    if (job.status !== "VALIDATED") return err(conflict("imports.not_validated", "Validez l'import (et consultez l'aperçu) avant de le lancer.", { status: job.status }));
    if (importer.sensitive && !ctx.mfa) return err(forbidden("imports.mfa_required", "Cet import touche aux soldes financiers : confirmez votre identité par l'authentification renforcée (MFA)."));
    if (body.onExisting !== job.onExisting) return err(conflict("imports.not_validated", "La politique « données existantes » a changé depuis la validation : relancez la validation.", { validated: job.onExisting, requested: body.onExisting }));
    if (body.onExisting === "UPDATE" && !importer.supportsUpdate) return err(conflict("imports.options_invalid", "Cet importeur ne met jamais à jour l'existant.", { importerKey: job.importerKey }));
    const settings = await getSettings(tx);
    if (body.runMode === "ALL_OR_NOTHING") {
      if (job.invalidRows > 0) return err(conflict("imports.has_errors", `Mode « tout ou rien » : ${job.invalidRows} ligne(s) en erreur. Corrigez le fichier ou choisissez « lignes valides seulement ».`, { invalid: job.invalidRows }));
      if (job.totalRows > settings.allOrNothingMaxRows) return err(conflict("imports.too_many_rows_all_or_nothing", `Le mode « tout ou rien » est limité à ${settings.allOrNothingMaxRows} lignes (${job.totalRows} ici).`, { max: settings.allOrNothingMaxRows }));
    }
    if (job.validRows === 0) return err(conflict("imports.has_errors", "Aucune ligne valide à importer."));
    const now = deps.clock.now();
    const actor = snapshotOf(ctx);
    await updateJob(
      tx,
      id,
      {
        status: "QUEUED",
        runMode: body.runMode,
        onExisting: body.onExisting,
        runRequestedAt: now,
        runRequestedBy: ctx.userId,
        cancelRequested: false,
        errorCode: null,
        errorMessage: null,
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
    events.add(IMPORT_EVENTS.runRequested, { v: 1, jobId: id, importerKey: job.importerKey, mode: body.runMode }, { type: "import_job", id });
    events.audit({
      action: "imports.run.request",
      entity: "import_job",
      entityId: id,
      severity: importer.sensitive ? "warning" : "notice",
      metadata: { importerKey: job.importerKey, mode: body.runMode, onExisting: body.onExisting, totalRows: job.totalRows, valid: job.validRows, invalid: job.invalidRows, create: job.plannedCreate, update: job.plannedUpdate, skip: job.plannedSkip, mfa: ctx.mfa },
    });
    await events.flush(tx);
    return ok(toJobDto((await getJob(tx, id)) as JobRecord));
  });
}

// ---------------------------------------------------------------------------
// Exécution (worker)
// ---------------------------------------------------------------------------

export interface RunOutcome {
  claimed: boolean;
  status?: JobRecord["status"];
  error?: string;
}

/** Refus d'une ligne : porte le résultat pour annuler son SAVEPOINT sans perdre le motif. */
class RowFailure extends Error {
  constructor(readonly result: ApplyResult) {
    super("row failure");
  }
}

const failedResult = (rowNo: number, issues: ImportIssue[]): ApplyResult => ({ rowNo, outcome: "FAILED", entityId: null, issues });

function issuesOfError(e: unknown): ImportIssue[] {
  if (isAppError(e)) {
    if (e instanceof ValidationError && e.issues.length > 0) {
      return e.issues.map((i) => issue(typeof i.path[i.path.length - 1] === "string" ? String(i.path[i.path.length - 1]) : null, i.code ?? e.code, i.message));
    }
    return [issue(null, e.code, e.message)];
  }
  return [issue(null, "imports.write_failed", "L'écriture de cette ligne a échoué (erreur interne).")];
}

interface RowToRun {
  rowNo: number;
  normalized: Record<string, unknown>;
  naturalKey: string | null;
  plannedAction: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
  plannedEntityId: string | null;
  issues: ImportIssue[];
}

/**
 * Écrit les lignes d'un lot dans la transaction `tx` DÉJÀ ouverte (sous l'identité de l'auteur) : SKIP sans appel, sinon le
 * port cible, un SAVEPOINT par ligne. Renvoie les résultats et les références d'idempotence à enregistrer.
 */
async function applyRows(deps: ImportsDeps, ctx: RequestContext, tx: Tx, job: JobRecord, rows: readonly RowToRun[], hb: Heartbeat, mode: "ALL_OR_NOTHING" | "VALID_ONLY"): Promise<{ outcomes: OutcomeWrite[]; refs: RefWrite[] }> {
  const importer = getImporter(job.importerKey);
  const target: ImportTargetPort = deps.ports.target(job.importerKey);
  const options = job.options as ImportOptions;
  const run: PlanRun = { jobId: job.id, options, onExisting: job.onExisting, mode: job.runMode };

  const wanted: string[] = [];
  for (const r of rows) {
    if (r.naturalKey) wanted.push(r.naturalKey);
    wanted.push(...(importer.relatedKeys?.(r.normalized, options) ?? []));
  }
  const refs = await getRefs(tx, job.importerKey, wanted);

  const outcomes: OutcomeWrite[] = [];
  const refWrites: RefWrite[] = [];
  const record = (row: RowToRun, res: ApplyResult): void => {
    outcomes.push({ rowNo: row.rowNo, outcome: res.outcome, entityId: res.entityId ?? row.plannedEntityId ?? null, issues: res.issues });
    if ((res.outcome === "CREATED" || res.outcome === "UPDATED" || res.outcome === "SKIPPED") && res.entityId && row.naturalKey) refWrites.push({ key: row.naturalKey, entityType: importer.entityType, entityId: res.entityId });
    for (const r of res.refs ?? []) {
      refWrites.push({ key: r.key, entityType: r.entityType, entityId: r.entityId });
      refs.set(r.key, r.entityId);
    }
    if (res.entityId && row.naturalKey) refs.set(row.naturalKey, res.entityId);
  };
  const itemOf = (row: RowToRun): ApplyItem => {
    const relatedKeys = importer.relatedKeys?.(row.normalized, options) ?? [];
    return {
      rowNo: row.rowNo,
      key: row.naturalKey,
      row: row.normalized,
      action: row.plannedAction === "UPDATE" ? "UPDATE" : "CREATE",
      knownEntityId: row.naturalKey ? (refs.get(row.naturalKey) ?? row.plannedEntityId ?? null) : row.plannedEntityId,
      related: Object.fromEntries(relatedKeys.filter((k) => refs.has(k)).map((k) => [k, refs.get(k) as string])),
      inFileDependencies: new Set<string>(),
    };
  };
  const applyOne = async (row: RowToRun): Promise<ApplyResult> => {
    try {
      return await deps.db.run(ctx, async () => {
        const res = await target.apply(ctx, itemOf(row), run);
        if (res.outcome === "FAILED") throw new RowFailure(res);
        return res;
      });
    } catch (e) {
      if (e instanceof RowFailure) return e.result;
      if (e instanceof LeaseLostError || e instanceof RollbackSignal) throw e;
      deps.logger.warn({ jobId: job.id, rowNo: row.rowNo, err: e instanceof Error ? e.message : String(e) }, "imports : ligne refusée par le module cible");
      return failedResult(row.rowNo, issuesOfError(e));
    }
  };
  const checkpoint = (): void => {
    hb.assertHeld();
    if (hb.state.cancelRequested) throw new RollbackSignal("cancelled");
  };

  const toWrite: RowToRun[] = [];
  for (const row of rows) {
    if (row.plannedAction === "SKIP") record(row, { rowNo: row.rowNo, outcome: "SKIPPED", entityId: row.plannedEntityId, issues: row.issues.filter((i) => i.severity === "WARNING") });
    else toWrite.push(row);
  }

  if (target.applyBatch && toWrite.length > 0) {
    checkpoint();
    let results: ApplyResult[] | null = null;
    try {
      results = await deps.db.run(ctx, () => (target.applyBatch as NonNullable<typeof target.applyBatch>)(ctx, toWrite.map(itemOf), run));
    } catch (e) {
      if (e instanceof LeaseLostError || e instanceof RollbackSignal) throw e;
      results = null;
    }
    if (results) {
      const byRow = new Map(results.map((r) => [r.rowNo, r]));
      for (const row of toWrite) record(row, byRow.get(row.rowNo) ?? failedResult(row.rowNo, [issue(null, "imports.write_failed", "Le module cible n'a pas rendu de résultat pour cette ligne.")]));
      hb.state.progress += toWrite.length;
      return { outcomes, refs: refWrites };
    }
  }

  for (const row of toWrite) {
    checkpoint();
    const res = await applyOne(row);
    record(row, res);
    hb.state.progress += 1;
    if (mode === "ALL_OR_NOTHING" && res.outcome === "FAILED") throw new RollbackSignal("failed", { row, result: res });
  }
  return { outcomes, refs: refWrites };
}

async function finalizeJob(deps: ImportsDeps, tenantId: string, jobId: string, owner: string, tx: Tx, finalStatus: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "CANCELLED" | "FAILED", extra: { errorCode?: string; errorMessage?: string } = {}): Promise<JobRecord> {
  const sys = createSystemContext(tenantId, `imports:finalize:${jobId}`);
  const current = await getJob(tx, jobId, { forUpdate: true });
  if (!current || current.leaseOwner !== owner || !["RUNNING", "QUEUED"].includes(current.status)) throw new LeaseLostError();
  const s = await stats(tx, jobId);
  const now = deps.clock.now();
  const status = finalStatus === "COMPLETED" && s.failed > 0 ? "COMPLETED_WITH_ERRORS" : finalStatus;
  const startedAt = current.startedAt ?? now;
  await updateJob(
    tx,
    jobId,
    {
      status,
      processedCount: s.processed,
      createdCount: s.created,
      updatedCount: s.updated,
      skippedCount: s.skipped,
      failedCount: s.failed,
      finishedAt: now,
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      leaseOwner: null,
      leaseUntil: null,
      errorCode: extra.errorCode ?? null,
      errorMessage: extra.errorMessage ?? null,
    },
    now,
  );
  const events = new EventBuffer(deps, sys);
  const counts = { created: s.created, updated: s.updated, skipped: s.skipped, failed: s.failed };
  if (status === "COMPLETED" || status === "COMPLETED_WITH_ERRORS") events.add(IMPORT_EVENTS.runCompleted, { v: 1, jobId, importerKey: current.importerKey, ...counts, status }, { type: "import_job", id: jobId });
  else if (status === "CANCELLED") events.add(IMPORT_EVENTS.runCancelled, { v: 1, jobId, importerKey: current.importerKey, processed: s.processed }, { type: "import_job", id: jobId });
  else events.add(IMPORT_EVENTS.runFailed, { v: 1, jobId, importerKey: current.importerKey, code: extra.errorCode ?? "imports.write_failed" }, { type: "import_job", id: jobId });
  events.audit({
    action: `imports.run.${status === "CANCELLED" ? "cancelled" : status === "FAILED" ? "failed" : "completed"}`,
    entity: "import_job",
    entityId: jobId,
    severity: getImporter(current.importerKey).sensitive || status === "FAILED" ? "warning" : "notice",
    metadata: { importerKey: current.importerKey, mode: current.runMode, ...counts, processed: s.processed, durationMs: Math.max(0, now.getTime() - startedAt.getTime()), status },
  });
  await events.flush(tx);
  return current;
}

/**
 * Exécutée par le worker (ou un test) : écrit un import `QUEUED` / `RUNNING`. Idempotente : un second appel sur un import
 * déjà terminé, ou tenu par un exécutant vivant, ne fait rien. Reprenable après interruption.
 */
export async function processRun(deps: ImportsDeps, tenantId: string, jobId: string, options: { workerId: string }): Promise<RunOutcome> {
  const sys = createSystemContext(tenantId, `imports:run:${jobId}`);
  const claimed = await deps.db.run(sys, async (tx) => {
    const c = await claimJob(tx, jobId, ["QUEUED", "RUNNING"], options.workerId, deps.config.leaseSeconds);
    if (!c) return null;
    const first = c.status === "QUEUED";
    const now = deps.clock.now();
    await updateJob(tx, jobId, { status: "RUNNING", startedAt: c.startedAt ?? now }, now);
    await tx.query(`UPDATE imports.jobs SET run_attempts = run_attempts + 1 WHERE id = $1`, [jobId]);
    if (first) {
      const events = new EventBuffer(deps, sys);
      events.add(IMPORT_EVENTS.runStarted, { v: 1, jobId, importerKey: c.importerKey, totalRows: c.totalRows }, { type: "import_job", id: jobId });
      await events.flush(tx);
    }
    return { ...c, runAttempts: c.runAttempts + 1 };
  });
  if (!claimed) return { claimed: false };
  const job = claimed;

  if (job.runAttempts > deps.config.maxRunAttempts) {
    await deps.db.run(sys, (tx) => finalizeJob(deps, tenantId, jobId, options.workerId, tx, "FAILED", { errorCode: "imports.write_failed", errorMessage: "Trop de tentatives d'exécution interrompues : import abandonné." }));
    return { claimed: true, status: "FAILED", error: "Trop de tentatives." };
  }

  const hb = startHeartbeat(deps, tenantId, jobId, options.workerId, "run");
  try {
    if (!job.actorUserId) throw new Error("Import sans acteur : exécution impossible.");
    const ctx = actorContext(tenantId, jobId, { userId: job.actorUserId, roles: job.actorRoles, mfa: job.actorMfa, institutionId: job.actorInstitutionId, campusId: job.actorCampusId }, "run");
    const settings = await deps.db.run(sys, (tx) => getSettings(tx), { readOnly: true });
    const batch = Math.max(1, Math.min(settings.batchSize, 500));
    const done = await deps.db.run(sys, (tx) => stats(tx, jobId), { readOnly: true });
    hb.state.progress = done.processed;

    if (job.runMode === "ALL_OR_NOTHING") return await runAllOrNothing(deps, ctx, tenantId, job, options.workerId, hb);

    let after = 0;
    for (;;) {
      hb.assertHeld();
      if (hb.state.cancelRequested) {
        await hb.stop();
        await deps.db.run(sys, (tx) => finalizeJob(deps, tenantId, jobId, options.workerId, tx, "CANCELLED"));
        return { claimed: true, status: "CANCELLED" };
      }
      const rows = await deps.db.run(sys, (tx) => fetchRunnable(tx, jobId, after, batch), { readOnly: true });
      if (rows.length === 0) break;
      after = rows[rows.length - 1]?.rowNo ?? after;
      try {
        await deps.db.run(ctx, async (tx) => {
          const { outcomes, refs } = await applyRows(deps, ctx, tx, job, rows, hb, "VALID_ONLY");
          const now = deps.clock.now();
          await saveOutcomes(tx, jobId, outcomes, now);
          await upsertRefs(tx, tenantId, job.importerKey, jobId, refs);
          const s = await stats(tx, jobId);
          await updateJob(tx, jobId, { processedCount: s.processed, createdCount: s.created, updatedCount: s.updated, skippedCount: s.skipped, failedCount: s.failed }, now);
        });
      } catch (e) {
        if (e instanceof RollbackSignal && e.reason === "cancelled") {
          await hb.stop();
          await deps.db.run(sys, (tx) => finalizeJob(deps, tenantId, jobId, options.workerId, tx, "CANCELLED"));
          return { claimed: true, status: "CANCELLED" };
        }
        throw e;
      }
    }
    await hb.stop();
    const finished = await deps.db.run(sys, async (tx) => {
      await finalizeJob(deps, tenantId, jobId, options.workerId, tx, "COMPLETED");
      return (await getJob(tx, jobId)) as JobRecord;
    });
    return { claimed: true, status: finished.status };
  } catch (e) {
    await hb.stop();
    return await handleRunError(deps, tenantId, job, options.workerId, e);
  }
}

async function runAllOrNothing(deps: ImportsDeps, ctx: RequestContext, tenantId: string, job: JobRecord, workerId: string, hb: Heartbeat): Promise<RunOutcome> {
  const sys = createSystemContext(tenantId, `imports:run:${job.id}`);
  const settings = await deps.db.run(sys, (tx) => getSettings(tx), { readOnly: true });
  const batch = Math.max(1, Math.min(settings.batchSize, 500));
  try {
    await deps.db.run(ctx, async (tx) => {
      const outcomes: OutcomeWrite[] = [];
      const refs: RefWrite[] = [];
      let after = 0;
      for (;;) {
        const rows = await fetchRunnable(tx, job.id, after, batch);
        if (rows.length === 0) break;
        after = rows[rows.length - 1]?.rowNo ?? after;
        const r = await applyRows(deps, ctx, tx, job, rows, hb, "ALL_OR_NOTHING");
        outcomes.push(...r.outcomes);
        refs.push(...r.refs);
      }
      await hb.stop();
      const now = deps.clock.now();
      await saveOutcomes(tx, job.id, outcomes, now);
      await upsertRefs(tx, tenantId, job.importerKey, job.id, refs);
      await finalizeJob(deps, tenantId, job.id, workerId, tx, "COMPLETED");
    });
    const finished = await deps.db.run(sys, (tx) => getJob(tx, job.id), { readOnly: true });
    return { claimed: true, status: finished?.status ?? "COMPLETED" };
  } catch (e) {
    await hb.stop();
    if (e instanceof RollbackSignal && e.reason === "cancelled") {
      await deps.db.run(sys, (tx) => finalizeJob(deps, tenantId, job.id, workerId, tx, "CANCELLED"));
      return { claimed: true, status: "CANCELLED" };
    }
    if (e instanceof RollbackSignal && e.reason === "failed") {
      const detail = e.detail as { row: RowToRun; result: ApplyResult };
      // Tout a été annulé : on garde la trace de la ligne fautive pour le rapport, et l'import est en échec.
      await deps.db.run(sys, async (tx) => {
        await saveOutcomes(tx, job.id, [{ rowNo: detail.row.rowNo, outcome: "FAILED", entityId: null, issues: detail.result.issues }], deps.clock.now());
        await finalizeJob(deps, tenantId, job.id, workerId, tx, "FAILED", {
          errorCode: "imports.write_failed",
          errorMessage: `Mode « tout ou rien » : la ligne ${detail.row.rowNo} a été refusée par le module cible. Aucune donnée n'a été écrite.`,
        });
      });
      return { claimed: true, status: "FAILED", error: "Une ligne a été refusée : aucune donnée écrite." };
    }
    return await handleRunError(deps, tenantId, job, workerId, e);
  }
}

async function handleRunError(deps: ImportsDeps, tenantId: string, job: JobRecord, workerId: string, e: unknown): Promise<RunOutcome> {
  const sys = createSystemContext(tenantId, `imports:run:${job.id}`);
  if (e instanceof LeaseLostError) return { claimed: true };
  deps.logger.error({ jobId: job.id, err: e instanceof Error ? e.message : String(e) }, "imports : exécution interrompue par une erreur");
  const message = e instanceof Error && "code" in e ? e.message : "Erreur interne pendant l'import.";
  if (job.runAttempts >= deps.config.maxRunAttempts) {
    await deps.db.run(sys, (tx) => finalizeJob(deps, tenantId, job.id, workerId, tx, "FAILED", { errorCode: isAppError(e) ? e.code : "imports.write_failed", errorMessage: message })).catch(() => undefined);
    return { claimed: true, status: "FAILED", error: message };
  }
  // Libère le bail : l'exécution sera reprise (retry du worker ou job de filet) à partir du dernier lot validé.
  await deps.db.run(sys, (tx) => releaseLease(tx, job.id, workerId)).catch(() => undefined);
  throw e;
}

// ---------------------------------------------------------------------------
// Rapport (étape 7)
// ---------------------------------------------------------------------------

export async function getImportReport(deps: ImportsDeps, ctx: RequestContext, id: string, viewer: Viewer, resolveName: (userId: string) => Promise<string | null>): Promise<Result<ImportReport, AppError>> {
  const result = await inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadVisibleJob(tx, ctx, id, viewer);
      if (!loaded.ok) return loaded;
      const job = loaded.value;
      const s = await stats(tx, id);
      const top = [...(await topIssues(tx, id, "issues")), ...(await topIssues(tx, id, "outcome_issues"))];
      return ok({ job, s, top });
    },
    { readOnly: true },
  );
  if (!result.ok) return result;
  const { job, s, top } = result.value;
  const merged = new Map<string, { code: string; column: string | null; count: number; example: string }>();
  for (const t of top) {
    const k = `${t.code}|${t.column ?? ""}`;
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, count: prev.count + t.count } : t);
  }
  return ok({
    job: toJobDto(job),
    author: { userId: job.createdBy, displayName: await resolveName(job.createdBy).catch(() => null) },
    totals: { created: s.created, updated: s.updated, skipped: s.skipped, failed: s.failed, processed: s.processed, total: s.total },
    topIssues: [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 8),
  });
}
