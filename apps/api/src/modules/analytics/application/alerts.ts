/**
 * Alertes configurables de direction (spec v2/025, partie B).
 *
 *  - CONFIGURATION par établissement : règles (indicateur du catalogue, deux seuils, périmètre, RÔLES destinataires, fréquence) ;
 *  - ÉVALUATION par le job du worker (`analytics.evaluate-alerts`) : lit les read-models, jamais une source ; ne décide rien sur
 *    une donnée absente, périmée ou en échec (`SOURCE_UNAVAILABLE`) et ne transforme jamais « non mesuré » en zéro ;
 *  - LIVRAISON : un événement `analytics.alert.raised` (outbox, même transaction) que `notifications` consomme. `analytics`
 *    n'envoie RIEN lui-même : les préférences, consentements, heures calmes et plafonds restent ceux de `notifications` ;
 *  - ANTI-DOUBLON : une seule alerte active par règle (index unique partiel) et une notification par (alerte, gravité, créneau
 *    de fréquence, PAR RÈGLE : une alerte qui oscille ne re-notifie pas dans le créneau) — clé UNIQUE en base, insertion AVANT l'événement dans la même transaction ;
 *  - HISTORIQUE : les alertes résolues restent consultables ; accusé de réception tracé (qui, quand, note) et audité.
 *
 * Visibilité : une alerte n'existe pour l'appelant que si son indicateur lui est permis ET si son périmètre est dans le sien ;
 * sinon la réponse est un 404 UNIFORME (inexistant, hors périmètre ou non permis : indiscernables).
 */
import { PgOutboxWriter, type SystemDb, type Tx } from "@ecoledigitale/database";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, createDomainEvent, createSystemContext, err, newId, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AnalyticsAlert,
  AnalyticsAlertAcknowledgeBody,
  AnalyticsAlertDetail,
  AnalyticsAlertMetricsData,
  AnalyticsAlertRaisedPayload,
  AnalyticsAlertRule,
  AnalyticsAlertRuleCreate,
  AnalyticsAlertRuleUpdate,
  AnalyticsAlertsData,
  AnalyticsAlertsQuery,
} from "@ecoledigitale/contracts/src/v2/analytics";
import { ALERT_METRICS, alertMetricDef, type AlertMetricDef } from "../domain/alert-metrics";
import { frequencyBucket, notificationKey, reasonOf, severityOf, thresholdIssues, SEVERITY_RANK } from "../domain/alerts";
import { AnalyticsEvents } from "../domain/events";
import { selectScopes } from "../infrastructure/dims-repository";
import * as repo from "../infrastructure/alerts-repository";
import { listStates } from "../infrastructure/requests-repository";
import { readMetric } from "./alert-values";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import { buildMetaFromStates, loadDims, loadThresholds, resolveScope } from "./scope";

const uniform404 = (): AppError => new NotFoundError("Alerte introuvable.", { code: "analytics.alert_not_found" });
const ruleNotFound = (): AppError => new NotFoundError("Règle d'alerte introuvable.", { code: "analytics.alert_rule_not_found" });

/** Visibilité d'un appelant : indicateurs permis (calculés par le plugin avec `requirePermission`) et périmètre du contexte. */
export function visibilityOf(ctx: RequestContext, allowedMetrics: readonly string[]): repo.Visibility {
  return { metrics: allowedMetrics, institutionId: ctx.institutionId ?? null, campusId: ctx.campusId ?? null };
}
const SYSTEM_VISIBILITY: repo.Visibility = { metrics: null, institutionId: null, campusId: null };

// ------------------------------------------------------------------------------------------------------------------
// Représentations
// ------------------------------------------------------------------------------------------------------------------

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function ruleDto(r: repo.RuleRow): AnalyticsAlertRule {
  const def = alertMetricDef(r.metric);
  return {
    id: r.id,
    label: r.label,
    metric: r.metric as AnalyticsAlertRule["metric"],
    comparator: def?.comparator ?? "BELOW",
    unit: def?.unit ?? "COUNT",
    warningValue: r.warningValue,
    criticalValue: r.criticalValue,
    windowDays: r.windowDays,
    institutionId: r.institutionId,
    campusId: r.campusId,
    recipientRoles: r.recipientRoles,
    frequency: r.frequency,
    enabled: r.enabled,
    rowVersion: r.rowVersion,
    lastEvaluatedAt: iso(r.lastEvaluatedAt),
    lastOutcome: r.lastOutcome,
    lastValue: r.lastValue,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function eventDto(e: repo.EventRow): AnalyticsAlert {
  const def = alertMetricDef(e.metric);
  return {
    id: e.id,
    ruleId: e.ruleId,
    ruleLabel: e.ruleLabel,
    metric: e.metric as AnalyticsAlert["metric"],
    unit: def?.unit ?? "COUNT",
    comparator: def?.comparator ?? "BELOW",
    severity: e.severity,
    status: e.status,
    value: e.value,
    threshold: e.threshold,
    currency: e.currency,
    institutionId: e.institutionId,
    campusId: e.campusId,
    raisedAt: e.raisedAt.toISOString(),
    lastSeenAt: e.lastSeenAt.toISOString(),
    asOf: iso(e.asOf),
    notifyCount: e.notifyCount,
    lastNotifiedAt: iso(e.lastNotifiedAt),
    acknowledgedAt: iso(e.acknowledgedAt),
    acknowledgementNote: e.acknowledgementNote,
    resolvedAt: iso(e.resolvedAt),
    resolvedValue: e.resolvedValue,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Catalogue et règles
// ------------------------------------------------------------------------------------------------------------------

/** Indicateurs que l'appelant peut surveiller (ceux dont il détient la permission de données). */
export function listMetrics(allowedMetrics: readonly string[]): AnalyticsAlertMetricsData {
  return {
    metrics: ALERT_METRICS.filter((m) => allowedMetrics.includes(m.metric)).map((m) => ({
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      comparator: m.comparator,
      permission: m.permission,
      windowed: m.windowed,
      defaultWindowDays: m.defaultWindowDays,
      campusScoped: m.campusScoped,
    })),
  };
}

export async function listRules(deps: AnalyticsDeps, ctx: RequestContext, allowedMetrics: readonly string[]): Promise<Result<{ rules: AnalyticsAlertRule[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ rules: (await repo.listRules(tx, visibilityOf(ctx, allowedMetrics))).map(ruleDto) }), { readOnly: true });
}

interface NormalizedRule extends repo.RuleWrite {}

/** Valide et normalise une règle (périmètre, fenêtre, seuils, rôles) ; le périmètre d'un utilisateur limité est imposé. */
async function normalize(tx: Tx, ctx: RequestContext, input: AnalyticsAlertRuleCreate, allowedMetrics: readonly string[]): Promise<Result<NormalizedRule, AppError>> {
  const def = alertMetricDef(input.metric);
  if (!def || !allowedMetrics.includes(def.metric)) return err(new ForbiddenError("Cet indicateur est hors de vos droits.", { code: "analytics.alert_metric_forbidden" }));
  const bad = (path: string, message: string, code: string): Result<never, AppError> => err(new ValidationError(message, [{ path: [path], message, code }]));

  const issues = thresholdIssues(def, input.warningValue ?? null, input.criticalValue ?? null);
  if (issues.length > 0) return err(new ValidationError("Seuils invalides.", issues.map((message) => ({ path: ["warningValue"], message, code: "thresholds_invalid" }))));

  // Périmètre : celui de la règle, borné à celui de l'utilisateur ; un utilisateur limité ne crée pas de règle sur tout le tenant.
  const scopes = await selectScopes(tx);
  let institutionId = input.institutionId ?? null;
  let campusId = input.campusId ?? null;
  if (campusId) {
    const campus = scopes.find((s) => s.kind === "CAMPUS" && s.id === campusId);
    if (!campus) return bad("campusId", "Campus inconnu.", "unknown_campus");
    if (institutionId && campus.parentId !== institutionId) return bad("campusId", "Ce campus n'appartient pas à cet établissement.", "campus_institution_mismatch");
    institutionId = campus.parentId;
  } else if (institutionId && !scopes.some((s) => s.kind === "INSTITUTION" && s.id === institutionId)) {
    return bad("institutionId", "Établissement inconnu.", "unknown_institution");
  }
  if (ctx.campusId) {
    if (campusId && campusId !== ctx.campusId) return err(new ForbiddenError("Ce campus est hors de votre périmètre.", { code: "analytics.scope_forbidden" }));
    campusId = ctx.campusId;
    institutionId = institutionId ?? scopes.find((s) => s.kind === "CAMPUS" && s.id === ctx.campusId)?.parentId ?? ctx.institutionId ?? null;
  }
  if (ctx.institutionId) {
    if (institutionId && institutionId !== ctx.institutionId) return err(new ForbiddenError("Cet établissement est hors de votre périmètre.", { code: "analytics.scope_forbidden" }));
    institutionId = ctx.institutionId;
  }
  if (def.campusScoped && !campusId && institutionId) {
    const campuses = scopes.filter((s) => s.kind === "CAMPUS" && s.parentId === institutionId);
    if (campuses.length > 1) return bad("campusId", "Sélectionnez un campus : la facturation est suivie par campus.", "campus_required");
  }

  const windowDays = def.windowed ? (input.windowDays ?? def.defaultWindowDays) : null;
  if (!def.windowed && input.windowDays != null) return bad("windowDays", "Cet indicateur n'a pas de fenêtre.", "window_not_applicable");
  const roles = [...new Set(input.recipientRoles)];
  return ok({
    label: input.label,
    metric: def.metric,
    warningValue: input.warningValue ?? null,
    criticalValue: input.criticalValue ?? null,
    windowDays,
    institutionId,
    campusId,
    recipientRoles: roles,
    frequency: input.frequency ?? "DAILY",
    enabled: input.enabled ?? true,
  });
}

export async function createRule(deps: AnalyticsDeps, ctx: RequestContext, input: AnalyticsAlertRuleCreate, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlertRule, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const normalized = await normalize(tx, ctx, input, allowedMetrics);
    if (!normalized.ok) return normalized;
    const row = await repo.insertRule(tx, { tenantId: ctx.tenantId, id: newId(), userId: ctx.userId, now: deps.clock.now(), rule: normalized.value });
    await deps.audit.record(tx, { action: "analytics.alert_rule.create", entity: "alert_rule", entityId: row.id, after: ruleAudit(row), severity: "notice" });
    return ok(ruleDto(row));
  });
}

const ruleAudit = (r: repo.RuleRow): Record<string, unknown> => ({ metric: r.metric, warningValue: r.warningValue, criticalValue: r.criticalValue, windowDays: r.windowDays, institutionId: r.institutionId, campusId: r.campusId, recipientRoles: r.recipientRoles, frequency: r.frequency, enabled: r.enabled });

export async function updateRule(deps: AnalyticsDeps, ctx: RequestContext, id: string, input: AnalyticsAlertRuleUpdate, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlertRule, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getRule(tx, id, visibilityOf(ctx, allowedMetrics), { lock: true });
    if (!current) return err(ruleNotFound());
    if (current.rowVersion !== input.rowVersion) return err(new ConflictError("La règle a été modifiée entre-temps.", { code: "analytics.alert_rule_conflict" }));
    const { rowVersion: _rowVersion, ...body } = input;
    void _rowVersion;
    const normalized = await normalize(tx, ctx, body, allowedMetrics);
    if (!normalized.ok) return normalized;
    const now = deps.clock.now();
    const updated = await repo.updateRule(tx, { id, rowVersion: input.rowVersion, userId: ctx.userId, now, rule: normalized.value });
    if (!updated) return err(new ConflictError("La règle a été modifiée entre-temps.", { code: "analytics.alert_rule_conflict" }));
    // Une règle désactivée, ou dont le périmètre / l'indicateur / la fenêtre a changé, ne garde pas une alerte née d'un autre contexte.
    const contextChanged = !updated.enabled || current.metric !== updated.metric || current.institutionId !== updated.institutionId || current.campusId !== updated.campusId || current.windowDays !== updated.windowDays;
    if (contextChanged) await closeActive(deps, ctx, tx, id, now, current.lastValue);
    await deps.audit.record(tx, { action: "analytics.alert_rule.update", entity: "alert_rule", entityId: id, before: ruleAudit(current), after: ruleAudit(updated), severity: "notice" });
    return ok(ruleDto(updated));
  });
}

async function closeActive(deps: AnalyticsDeps, ctx: RequestContext, tx: Tx, ruleId: string, now: Date, value: number | null): Promise<void> {
  const active = await repo.findActiveEvent(tx, ruleId);
  if (!active) return;
  await repo.resolveEvent(tx, { id: active.id, now, value: value ?? active.value });
  await publish(deps, ctx, tx, AnalyticsEvents.ALERT_RESOLVED, active.id, { v: 1, alertId: active.id, ruleId, metric: active.metric, resolvedValue: value ?? active.value });
}

async function publish(deps: AnalyticsDeps, ctx: RequestContext, tx: Tx, type: string, aggregateId: string, payload: unknown): Promise<void> {
  await new PgOutboxWriter(tx).append([createDomainEvent({ type, ctx, clock: deps.clock, aggregateType: "analytics.alert", aggregateId, payload })]);
}

// ------------------------------------------------------------------------------------------------------------------
// Consultation, historique, accusé de réception
// ------------------------------------------------------------------------------------------------------------------

export async function listAlerts(deps: AnalyticsDeps, ctx: RequestContext, query: AnalyticsAlertsQuery, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlertsData, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const filters: repo.EventFilters = { status: query.status, severity: query.severity, metric: query.metric, ruleId: query.ruleId, from: query.from, to: query.to };
      const r = await repo.listEvents(tx, filters, visibilityOf(ctx, allowedMetrics), { limit: query.limit, offset: query.offset });
      return ok({ total: r.total, counts: r.counts, alerts: r.rows.map(eventDto) });
    },
    { readOnly: true },
  );
}

export async function getAlert(deps: AnalyticsDeps, ctx: RequestContext, id: string, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlertDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const e = await repo.getEvent(tx, id, visibilityOf(ctx, allowedMetrics));
      if (!e) return err(uniform404());
      const notifications = (await repo.listNotifications(tx, id)).map((n) => ({ id: n.id, reason: n.reason, severity: n.severity, value: n.value, recipientRoles: n.recipientRoles, emittedAt: n.emittedAt.toISOString() }));
      return ok({ ...eventDto(e), notifications });
    },
    { readOnly: true },
  );
}

/** Toutes les alertes visibles (export CSV de l'historique), par pages de 200 et plafonnées à 5 000 lignes. */
export async function listAlertsForExport(deps: AnalyticsDeps, ctx: RequestContext, query: Partial<AnalyticsAlertsQuery>, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlert[], AppError>> {
  const out: AnalyticsAlert[] = [];
  for (let offset = 0; offset < 5_000; offset += 200) {
    const r = await listAlerts(deps, ctx, { ...query, limit: 200, offset }, allowedMetrics);
    if (!r.ok) return r;
    out.push(...r.value.alerts);
    if (r.value.alerts.length < 200) break;
  }
  return ok(out);
}

export async function acknowledgeAlert(deps: AnalyticsDeps, ctx: RequestContext, id: string, body: AnalyticsAlertAcknowledgeBody, allowedMetrics: readonly string[]): Promise<Result<AnalyticsAlertDetail, AppError>> {
  const done = await inTx(deps, ctx, async (tx) => {
    const e = await repo.getEvent(tx, id, visibilityOf(ctx, allowedMetrics));
    if (!e) return err(uniform404());
    if (e.status === "RESOLVED") return err(new ConflictError("Cette alerte est déjà résolue.", { code: "analytics.alert_already_resolved" }));
    if (e.status === "OPEN") {
      const now = deps.clock.now();
      const changed = await repo.acknowledgeEvent(tx, { id, userId: ctx.userId, now, note: body.note?.trim() || null });
      if (changed) {
        await publish(deps, ctx, tx, AnalyticsEvents.ALERT_ACKNOWLEDGED, id, { v: 1, alertId: id, ruleId: e.ruleId, acknowledgedBy: ctx.userId });
        await deps.audit.record(tx, { action: "analytics.alert.acknowledge", entity: "alert", entityId: id, metadata: { metric: e.metric, severity: e.severity }, severity: "notice" });
      }
    }
    return ok(true as const);
  });
  if (!done.ok) return done;
  return getAlert(deps, ctx, id, allowedMetrics);
}

// ------------------------------------------------------------------------------------------------------------------
// Évaluation (job du worker)
// ------------------------------------------------------------------------------------------------------------------

export interface RuleEvaluation {
  ruleId: string;
  outcome: repo.EvaluationOutcome | "SKIPPED";
  value: number | null;
  /** Notification émise (événement publié) lors de cette évaluation. */
  notified: boolean;
  raised: boolean;
  resolved: boolean;
}

/** Évalue UNE règle dans sa propre transaction (verrou sur la règle : deux évaluations simultanées se sérialisent). */
export async function evaluateRule(deps: AnalyticsDeps, tenantCtx: RequestContext, ruleId: string): Promise<RuleEvaluation> {
  const result: RuleEvaluation = { ruleId, outcome: "SKIPPED", value: null, notified: false, raised: false, resolved: false };
  await inTx(deps, tenantCtx, async (tx) => {
    const rule = await repo.getRule(tx, ruleId, SYSTEM_VISIBILITY, { lock: true });
    const def = rule ? alertMetricDef(rule.metric) : undefined;
    if (!rule || !rule.enabled || !def) return;
    const now = deps.clock.now();
    const today = now.toISOString().slice(0, 10);

    const dims = await loadDims(tx);
    const thresholds = await loadThresholds(tx);
    const scope = resolveScope(createSystemContext(tenantCtx.tenantId), { institutionId: rule.institutionId ?? undefined, campusId: rule.campusId ?? undefined }, dims);
    if (!scope.ok) {
      await repo.recordEvaluation(tx, { id: rule.id, at: now, outcome: "SOURCE_UNAVAILABLE", value: null });
      result.outcome = "SOURCE_UNAVAILABLE";
      return;
    }
    // Fraîcheur : ni alerte ni résolution sur une donnée jamais lue, périmée, non branchée ou dont la dernière lecture a échoué.
    const meta = buildMetaFromStates(await listStates(tx), def.kinds, scope.value, thresholds, now);
    if (meta.stale || meta.gaps.length > 0) {
      await repo.recordEvaluation(tx, { id: rule.id, at: now, outcome: "SOURCE_UNAVAILABLE", value: null });
      result.outcome = "SOURCE_UNAVAILABLE";
      return;
    }
    const reading = await readMetric(tx, def, rule, scope.value, today);
    if (reading.value === null) {
      await repo.recordEvaluation(tx, { id: rule.id, at: now, outcome: "NOT_MEASURED", value: null });
      result.outcome = "NOT_MEASURED";
      return;
    }
    const value = reading.value;
    result.value = value;
    const asOf = meta.asOf ? new Date(meta.asOf) : null;
    const breach = severityOf(def.comparator, value, { warning: rule.warningValue, critical: rule.criticalValue });
    const active = await repo.findActiveEvent(tx, rule.id);

    if (!breach) {
      if (active) {
        await repo.resolveEvent(tx, { id: active.id, now, value });
        await publish(deps, tenantCtx, tx, AnalyticsEvents.ALERT_RESOLVED, active.id, { v: 1, alertId: active.id, ruleId: rule.id, metric: rule.metric, resolvedValue: value });
        result.resolved = true;
      }
      await repo.recordEvaluation(tx, { id: rule.id, at: now, outcome: "OK", value });
      result.outcome = "OK";
      return;
    }

    let alertId: string;
    let reopen = false;
    if (!active) {
      alertId = newId();
      await repo.insertEvent(tx, {
        tenantId: tenantCtx.tenantId,
        id: alertId,
        ruleId: rule.id,
        metric: rule.metric,
        severity: breach.severity,
        value,
        threshold: breach.threshold,
        currency: reading.currency,
        institutionId: rule.institutionId,
        campusId: rule.campusId,
        yearId: reading.yearId,
        periodId: reading.periodId,
        now,
        asOf,
      });
      result.raised = true;
    } else {
      alertId = active.id;
      // Montée en gravité : une alerte acquittée est rouverte (le dépassement a changé de nature).
      reopen = active.status === "ACKNOWLEDGED" && SEVERITY_RANK[breach.severity] > SEVERITY_RANK[active.severity];
      await repo.touchEvent(tx, { id: alertId, severity: breach.severity, value, threshold: breach.threshold, now, asOf, reopen });
    }

    // Notification : alerte ouverte seulement (une alerte acquittée se tait, sauf montée en gravité), une fois par créneau.
    const status = reopen || !active ? "OPEN" : active.status;
    if (status === "OPEN") {
      const key = notificationKey(rule.id, breach.severity, frequencyBucket(rule.frequency, now));
      const reason = reasonOf(await repo.highestNotifiedSeverity(tx, alertId), breach.severity);
      const emitted = await repo.insertNotification(tx, { tenantId: tenantCtx.tenantId, id: newId(), alertId, dedupeKey: key, reason, severity: breach.severity, value, recipientRoles: rule.recipientRoles, now });
      if (emitted) {
        await repo.markNotified(tx, alertId, now);
        const payload: AnalyticsAlertRaisedPayload = {
          v: 1,
          alertId,
          ruleId: rule.id,
          metric: def.metric,
          metricLabel: def.label,
          severity: breach.severity,
          reason,
          unit: def.unit,
          comparator: def.comparator,
          value,
          threshold: breach.threshold,
          currency: reading.currency,
          recipientRoles: rule.recipientRoles,
          dedupeKey: key,
          institutionId: rule.institutionId,
          campusId: rule.campusId,
        };
        await publish(deps, tenantCtx, tx, AnalyticsEvents.ALERT_RAISED, alertId, payload);
        result.notified = true;
      }
    }
    await repo.recordEvaluation(tx, { id: rule.id, at: now, outcome: breach.severity, value });
    result.outcome = breach.severity;
  });
  return result;
}

export interface EvaluationReport {
  tenantId: string;
  rules: number;
  raised: number;
  notified: number;
  resolved: number;
  unavailable: number;
  notMeasured: number;
  failed: number;
}

/** Évalue toutes les règles actives d'un tenant. Une règle en échec n'empêche pas les autres. */
export async function evaluateTenant(deps: AnalyticsDeps, tenantCtx: RequestContext): Promise<EvaluationReport> {
  const ids = await inTx(deps, tenantCtx, (tx) => repo.listEnabledRuleIds(tx), { readOnly: true });
  const report: EvaluationReport = { tenantId: tenantCtx.tenantId, rules: ids.length, raised: 0, notified: 0, resolved: 0, unavailable: 0, notMeasured: 0, failed: 0 };
  // SÉQUENTIEL : une connexion par contexte (platform-assembly §11).
  for (const id of ids) {
    try {
      const r = await evaluateRule(deps, tenantCtx, id);
      if (r.raised) report.raised += 1;
      if (r.notified) report.notified += 1;
      if (r.resolved) report.resolved += 1;
      if (r.outcome === "SOURCE_UNAVAILABLE") report.unavailable += 1;
      if (r.outcome === "NOT_MEASURED") report.notMeasured += 1;
    } catch (e) {
      report.failed += 1;
      deps.logger.error({ err: e instanceof Error ? e.message : String(e), ruleId: id }, "analytics : évaluation d'une règle d'alerte en échec");
    }
  }
  return report;
}

export async function evaluateAllTenants(deps: AnalyticsDeps, systemDb: SystemDb) {
  return systemDb.forEachTenant("analytics-evaluate-alerts", async (_tx, tenant) => evaluateTenant(deps, createSystemContext(tenant.id)));
}

export type { AlertMetricDef };
