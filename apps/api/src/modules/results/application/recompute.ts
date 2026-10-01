/**
 * Recalcul COALESCÉ par classe × période.
 *
 *   assess.grade.published/revised, results.override.*, academic.enrollment.*, rules.binding.changed, POST /recompute
 *        │  requestRecompute : UNE demande PENDING par (classe, période), `not_before` = dernier événement + temporisation
 *        ▼  (40 publications en rafale ⇒ UN calcul)
 *   processDueRecomputes (job du worker, SKIP LOCKED, une seule RUNNING par clé)
 *        │  période clôturée ⇒ BLOCKED + alerte `results.recompute.blocked`, rien n'est modifié
 *        ▼  sinon `computePeriod` (nouvelle version DRAFT seulement si `inputs_hash`/version de règle ont changé)
 *
 * Jamais de calcul dans la requête HTTP qui publie une note (le legacy recalculait de façon synchrone).
 */
import { createSystemContext, err, ok, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb, Tx } from "@ecoledigitale/database";
import { ResultsCode, forbidden } from "../domain/errors";
import { ResultsEvents } from "../domain/events";
import type { RecomputeRequest } from "../domain/records";
import { claimDueRequests, finishRequest, listRequests, purgeFinishedRequests, upsertPendingRequest } from "../infrastructure/governance-repository";
import { purgeStaleDrafts } from "../infrastructure/results-repository";
import { getSettingsRow, listStatesOfClassroom } from "../infrastructure/states-repository";
import { computePeriod } from "./compute";
import { EventBuffer, inTx, type ResultsCaps, type ResultsDeps } from "./deps";

export interface RequestRecomputeInput {
  classroomId: string;
  academicPeriodId: string;
  enrollmentIds?: readonly string[] | undefined;
  cause: { event: string; id: string | null };
  /** Délai immédiat (recalcul manuel) : la demande est échue tout de suite. */
  immediate?: boolean | undefined;
  tx?: Tx | undefined;
}

export async function requestRecompute(deps: ResultsDeps, ctx: RequestContext, input: RequestRecomputeInput): Promise<Result<RecomputeRequest, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await getSettingsRow(tx);
      const now = deps.clock.now();
      const notBefore = new Date(now.getTime() + (input.immediate ? 0 : settings.recomputeDelaySeconds * 1000));
      const request = await upsertPendingRequest(tx, {
        id: deps.newId(),
        tenantId: ctx.tenantId,
        classroomId: input.classroomId,
        periodId: input.academicPeriodId,
        scopeEnrollments: input.enrollmentIds ?? null,
        cause: { event: input.cause.event, id: input.cause.id, at: now.toISOString() },
        notBefore,
        maxCauses: deps.config.maxCauses,
        now,
      });
      return ok(request);
    },
    { tx: input.tx },
  );
}

/** Recalcul manuel (`POST /recompute`) : met la demande en file, échue immédiatement, puis la traite. */
export async function recomputeNow(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; enrollmentIds?: readonly string[] | undefined; caps?: ResultsCaps | undefined }) {
  if (!input.caps?.recompute) return err(forbidden(ResultsCode.FORBIDDEN, "Vous n'avez pas le droit de relancer un calcul."));
  const queued = await requestRecompute(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, enrollmentIds: input.enrollmentIds, cause: { event: "manual", id: ctx.userId }, immediate: true });
  if (!queued.ok) return queued;
  const report = await computePeriod(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
  if (!report.ok) return report;
  // la demande manuelle est servie : elle ne doit pas relancer un second calcul
  await inTx(deps, ctx, async (tx) => {
    await finishRequest(tx, queued.value.id, "DONE", deps.clock.now());
    return ok(undefined);
  });
  return ok({ request: queued.value, report: report.value });
}

export interface ProcessReport {
  claimed: number;
  done: number;
  blocked: number;
  failed: number;
  retried: number;
}

const STALE_RUNNING_MS = 10 * 60_000;

/** Traite les demandes échues d'un tenant (appelé par le job du worker, idempotent, reprenable après un crash). */
export async function processDueRecomputes(deps: ResultsDeps, ctx: RequestContext, options: { limit?: number } = {}): Promise<Result<ProcessReport, AppError>> {
  const now = deps.clock.now();
  const claimed = await inTx(deps, ctx, async (tx) => {
    // reprise : une demande RUNNING depuis trop longtemps (worker interrompu) redevient PENDING
    await tx.query(
      "UPDATE results.recompute_requests SET status = 'PENDING', started_at = NULL WHERE status = 'RUNNING' AND started_at < $1 AND NOT EXISTS (SELECT 1 FROM results.recompute_requests p WHERE p.status = 'PENDING' AND p.classroom_id = results.recompute_requests.classroom_id AND p.academic_period_id = results.recompute_requests.academic_period_id)",
      [new Date(now.getTime() - STALE_RUNNING_MS)],
    );
    return ok(await claimDueRequests(tx, now, options.limit ?? 20));
  });
  if (!claimed.ok) return claimed;
  const report: ProcessReport = { claimed: claimed.value.length, done: 0, blocked: 0, failed: 0, retried: 0 };

  for (const req of claimed.value) {
    const result = await computePeriod(deps, ctx, { classroomId: req.classroomId, academicPeriodId: req.academicPeriodId });
    await inTx(deps, ctx, async (tx) => {
      const at = deps.clock.now();
      if (result.ok) {
        await finishRequest(tx, req.id, "DONE", at);
        report.done += 1;
        return ok(undefined);
      }
      const code = result.error.code;
      const permanent = code === ResultsCode.STATE_CLOSED || code === ResultsCode.NO_ACTIVE_RULESET || code === ResultsCode.CURRICULUM_INCOMPLETE || code === ResultsCode.CURRICULUM_UNAVAILABLE;
      if (permanent) {
        await finishRequest(tx, req.id, "BLOCKED", at, { blockedReason: code, lastError: result.error.message });
        const events = new EventBuffer(deps, ctx);
        events.add(ResultsEvents.RECOMPUTE_BLOCKED, { v: 1, classroomId: req.classroomId, academicPeriodId: req.academicPeriodId, reason: code }, { type: "recompute_request", id: req.id });
        events.audit({ action: "results.recompute.blocked", entity: "recompute_request", entityId: req.id, metadata: { classroomId: req.classroomId, academicPeriodId: req.academicPeriodId, reason: code }, severity: "warning" });
        await events.flush(tx);
        report.blocked += 1;
      } else if (req.attempts >= deps.config.maxRecomputeAttempts) {
        await finishRequest(tx, req.id, "FAILED", at, { lastError: result.error.message });
        report.failed += 1;
      } else {
        await finishRequest(tx, req.id, "PENDING", at, { lastError: result.error.message, notBefore: new Date(at.getTime() + Math.min(300, 5 * 2 ** req.attempts) * 1000) });
        report.retried += 1;
      }
      return ok(undefined);
    });
  }
  return ok(report);
}

export async function processAllTenants(deps: ResultsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<ProcessReport>> {
  return systemDb.forEachTenant("results-process-recomputes", async (_tx, tenant) => unwrap(await processDueRecomputes(deps, createSystemContext(tenant.id))));
}

/** Un événement qui touche une classe sans nommer la période (inscription créée / mutée / retirée) : toutes ses périodes non clôturées. */
export async function requestRecomputeForClassroom(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; enrollmentId?: string | undefined; cause: { event: string; id: string | null } }): Promise<Result<number, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const states = (await listStatesOfClassroom(tx, input.classroomId)).filter((s) => s.scope === "PERIOD" && s.status !== "CLOSED" && s.academicPeriodId);
    for (const s of states) {
      await requestRecompute(deps, ctx, { classroomId: input.classroomId, academicPeriodId: s.academicPeriodId as string, enrollmentIds: input.enrollmentId ? [input.enrollmentId] : undefined, cause: input.cause, tx });
    }
    return ok(states.length);
  });
}

export async function listRecomputeRequests(deps: ResultsDeps, ctx: RequestContext, input: { classroomId?: string | undefined; academicPeriodId?: string | undefined; status?: string | undefined }) {
  return inTx(deps, ctx, async (tx) => ok(await listRequests(tx, { classroomId: input.classroomId, periodId: input.academicPeriodId, status: input.status })), { readOnly: true });
}

/** Purge : demandes terminées > 30 j ; brouillons remplacés > 90 j (jamais un FINAL ni sa clôture). */
export async function purgeOld(deps: ResultsDeps, ctx: RequestContext): Promise<Result<{ requests: number; drafts: number }, AppError>> {
  const now = deps.clock.now();
  return inTx(deps, ctx, async (tx) =>
    ok({
      requests: await purgeFinishedRequests(tx, new Date(now.getTime() - 30 * 86_400_000)),
      drafts: await purgeStaleDrafts(tx, new Date(now.getTime() - 90 * 86_400_000)),
    }),
  );
}

export async function purgeAllTenants(deps: ResultsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<{ requests: number; drafts: number }>> {
  return systemDb.forEachTenant("results-purge", async (_tx, tenant) => unwrap(await purgeOld(deps, createSystemContext(tenant.id))));
}
