/**
 * Tables d'alertes (`analytics.alert_rules`, `alert_events`, `alert_notifications`). SQL du seul schéma `analytics`, RLS du
 * tenant. Les filtres de visibilité (indicateurs permis, périmètre établissement / campus de l'utilisateur) sont appliqués
 * ICI, dans la requête : une alerte hors périmètre ou d'un indicateur non permis n'existe pas pour l'appelant (404 uniforme).
 */
import type { Tx } from "@ecoledigitale/database";
import type { AlertSeverity, AlertFrequency, NotificationReason } from "../domain/alerts";
import { big, num, numOrNull } from "./sql";

export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type EvaluationOutcome = "OK" | "WARNING" | "CRITICAL" | "NOT_MEASURED" | "SOURCE_UNAVAILABLE";

/** Ce que l'appelant a le droit de voir : indicateurs permis et périmètre. `metrics: null` = tous (job système). */
export interface Visibility {
  metrics: readonly string[] | null;
  institutionId: string | null;
  campusId: string | null;
}

export interface RuleRow {
  id: string;
  label: string;
  metric: string;
  warningValue: number | null;
  criticalValue: number | null;
  windowDays: number | null;
  institutionId: string | null;
  campusId: string | null;
  recipientRoles: string[];
  frequency: AlertFrequency;
  enabled: boolean;
  rowVersion: number;
  lastEvaluatedAt: Date | null;
  lastOutcome: EvaluationOutcome | null;
  lastValue: number | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRow {
  id: string;
  ruleId: string;
  ruleLabel: string;
  metric: string;
  severity: AlertSeverity;
  status: AlertStatus;
  value: number;
  threshold: number;
  currency: string | null;
  institutionId: string | null;
  campusId: string | null;
  yearId: string | null;
  periodId: string | null;
  raisedAt: Date;
  lastSeenAt: Date;
  asOf: Date | null;
  notifyCount: number;
  lastNotifiedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  acknowledgementNote: string | null;
  resolvedAt: Date | null;
  resolvedValue: number | null;
}

export interface NotificationRow {
  id: string;
  alertId: string;
  dedupeKey: string;
  reason: NotificationReason;
  severity: AlertSeverity;
  value: number;
  recipientRoles: string[];
  emittedAt: Date;
}

const RULE_COLUMNS = `id, label, metric, warning_value::text AS warning_value, critical_value::text AS critical_value, window_days, institution_id, campus_id,
  recipient_roles, frequency, enabled, row_version, last_evaluated_at, last_outcome, last_value::text AS last_value, created_by, created_at, updated_at`;

const toRule = (r: Record<string, any>): RuleRow => ({
  id: r.id,
  label: r.label,
  metric: r.metric,
  warningValue: numOrNull(r.warning_value),
  criticalValue: numOrNull(r.critical_value),
  windowDays: r.window_days,
  institutionId: r.institution_id,
  campusId: r.campus_id,
  recipientRoles: r.recipient_roles,
  frequency: r.frequency,
  enabled: r.enabled,
  rowVersion: r.row_version,
  lastEvaluatedAt: r.last_evaluated_at,
  lastOutcome: r.last_outcome,
  lastValue: numOrNull(r.last_value),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Fragment SQL de visibilité sur `metric`, `institution_id`, `campus_id` d'un alias ; ajoute ses paramètres à `params`. */
function visibilityClause(alias: string, v: Visibility, params: unknown[]): string {
  const parts: string[] = [];
  if (v.metrics !== null) {
    params.push([...v.metrics]);
    parts.push(`${alias}.metric = ANY($${params.length}::text[])`);
  }
  if (v.campusId) {
    params.push(v.campusId);
    parts.push(`${alias}.campus_id = $${params.length}`);
  } else if (v.institutionId) {
    params.push(v.institutionId);
    parts.push(`${alias}.institution_id = $${params.length}`);
  }
  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

// ------------------------------------------------------------------------------------------------------------------
// Règles
// ------------------------------------------------------------------------------------------------------------------

export async function listRules(tx: Tx, v: Visibility): Promise<RuleRow[]> {
  const params: unknown[] = [];
  const where = visibilityClause("r", v, params);
  const rows = await tx.many<Record<string, any>>(`SELECT ${RULE_COLUMNS} FROM analytics.alert_rules r WHERE ${where} ORDER BY r.created_at, r.id`, params);
  return rows.map(toRule);
}

export async function listEnabledRuleIds(tx: Tx): Promise<string[]> {
  return (await tx.many<{ id: string }>(`SELECT id FROM analytics.alert_rules WHERE enabled ORDER BY created_at, id`)).map((r) => r.id);
}

export async function getRule(tx: Tx, id: string, v: Visibility, options: { lock?: boolean } = {}): Promise<RuleRow | null> {
  const params: unknown[] = [id];
  const where = visibilityClause("r", v, params);
  const row = await tx.queryOne<Record<string, any>>(`SELECT ${RULE_COLUMNS} FROM analytics.alert_rules r WHERE r.id = $1 AND ${where}${options.lock ? " FOR UPDATE" : ""}`, params);
  return row ? toRule(row) : null;
}

export interface RuleWrite {
  label: string;
  metric: string;
  warningValue: number | null;
  criticalValue: number | null;
  windowDays: number | null;
  institutionId: string | null;
  campusId: string | null;
  recipientRoles: readonly string[];
  frequency: AlertFrequency;
  enabled: boolean;
}

export async function insertRule(tx: Tx, input: { tenantId: string; id: string; userId: string | null; now: Date; rule: RuleWrite }): Promise<RuleRow> {
  const r = input.rule;
  const row = await tx.queryOne<Record<string, any>>(
    `INSERT INTO analytics.alert_rules (tenant_id, id, label, metric, warning_value, critical_value, window_days, institution_id, campus_id, recipient_roles, frequency, enabled, created_by, created_at, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13, $14) RETURNING ${RULE_COLUMNS}`,
    [input.tenantId, input.id, r.label, r.metric, big(r.warningValue), big(r.criticalValue), r.windowDays, r.institutionId, r.campusId, [...r.recipientRoles], r.frequency, r.enabled, input.userId, input.now],
  );
  return toRule(row as Record<string, any>);
}

/** Met à jour sous contrôle de version ; `null` si la version a changé (conflit). */
export async function updateRule(tx: Tx, input: { id: string; rowVersion: number; userId: string | null; now: Date; rule: RuleWrite }): Promise<RuleRow | null> {
  const r = input.rule;
  const row = await tx.queryOne<Record<string, any>>(
    `UPDATE analytics.alert_rules SET label = $3, metric = $4, warning_value = $5, critical_value = $6, window_days = $7, institution_id = $8, campus_id = $9,
            recipient_roles = $10, frequency = $11, enabled = $12, row_version = row_version + 1, updated_by = $13, updated_at = $14
      WHERE id = $1 AND row_version = $2 RETURNING ${RULE_COLUMNS}`,
    [input.id, input.rowVersion, r.label, r.metric, big(r.warningValue), big(r.criticalValue), r.windowDays, r.institutionId, r.campusId, [...r.recipientRoles], r.frequency, r.enabled, input.userId, input.now],
  );
  return row ? toRule(row) : null;
}

export async function recordEvaluation(tx: Tx, input: { id: string; at: Date; outcome: EvaluationOutcome; value: number | null }): Promise<void> {
  await tx.query(`UPDATE analytics.alert_rules SET last_evaluated_at = $2, last_outcome = $3, last_value = $4 WHERE id = $1`, [input.id, input.at, input.outcome, big(input.value)]);
}

// ------------------------------------------------------------------------------------------------------------------
// Alertes (épisodes)
// ------------------------------------------------------------------------------------------------------------------

const EVENT_COLUMNS = `e.id, e.rule_id, r.label AS rule_label, e.metric, e.severity, e.status, e.value::text AS value, e.threshold::text AS threshold, e.currency,
  e.institution_id, e.campus_id, e.year_id, e.period_id, e.raised_at, e.last_seen_at, e.as_of, e.notify_count, e.last_notified_at,
  e.acknowledged_by, e.acknowledged_at, e.acknowledgement_note, e.resolved_at, e.resolved_value::text AS resolved_value`;
const EVENT_FROM = `analytics.alert_events e JOIN analytics.alert_rules r ON r.tenant_id = e.tenant_id AND r.id = e.rule_id`;

const toEvent = (r: Record<string, any>): EventRow => ({
  id: r.id,
  ruleId: r.rule_id,
  ruleLabel: r.rule_label,
  metric: r.metric,
  severity: r.severity,
  status: r.status,
  value: num(r.value),
  threshold: num(r.threshold),
  currency: r.currency,
  institutionId: r.institution_id,
  campusId: r.campus_id,
  yearId: r.year_id,
  periodId: r.period_id,
  raisedAt: r.raised_at,
  lastSeenAt: r.last_seen_at,
  asOf: r.as_of,
  notifyCount: r.notify_count,
  lastNotifiedAt: r.last_notified_at,
  acknowledgedBy: r.acknowledged_by,
  acknowledgedAt: r.acknowledged_at,
  acknowledgementNote: r.acknowledgement_note,
  resolvedAt: r.resolved_at,
  resolvedValue: numOrNull(r.resolved_value),
});

export async function findActiveEvent(tx: Tx, ruleId: string): Promise<EventRow | null> {
  const row = await tx.queryOne<Record<string, any>>(`SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM} WHERE e.rule_id = $1 AND e.status IN ('OPEN','ACKNOWLEDGED') FOR UPDATE OF e`, [ruleId]);
  return row ? toEvent(row) : null;
}

export async function getEvent(tx: Tx, id: string, v: Visibility): Promise<EventRow | null> {
  const params: unknown[] = [id];
  const where = visibilityClause("e", v, params);
  const row = await tx.queryOne<Record<string, any>>(`SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM} WHERE e.id = $1 AND ${where}`, params);
  return row ? toEvent(row) : null;
}

export async function insertEvent(
  tx: Tx,
  input: {
    tenantId: string;
    id: string;
    ruleId: string;
    metric: string;
    severity: AlertSeverity;
    value: number;
    threshold: number;
    currency: string | null;
    institutionId: string | null;
    campusId: string | null;
    yearId: string | null;
    periodId: string | null;
    now: Date;
    asOf: Date | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO analytics.alert_events (tenant_id, id, rule_id, metric, severity, status, value, threshold, currency, institution_id, campus_id, year_id, period_id, raised_at, last_seen_at, as_of)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)`,
    [input.tenantId, input.id, input.ruleId, input.metric, input.severity, big(input.value), big(input.threshold), input.currency, input.institutionId, input.campusId, input.yearId, input.periodId, input.now, input.asOf],
  );
}

/** Nouvelle lecture d'une alerte active : valeur, seuil franchi, gravité (une montée en gravité rouvre une alerte acquittée). */
export async function touchEvent(tx: Tx, input: { id: string; severity: AlertSeverity; value: number; threshold: number; now: Date; asOf: Date | null; reopen: boolean }): Promise<void> {
  await tx.query(
    `UPDATE analytics.alert_events
        SET severity = $2, value = $3, threshold = $4, last_seen_at = $5, as_of = $6,
            status = CASE WHEN $7::boolean THEN 'OPEN' ELSE status END,
            acknowledged_at = CASE WHEN $7::boolean THEN NULL ELSE acknowledged_at END,
            acknowledged_by = CASE WHEN $7::boolean THEN NULL ELSE acknowledged_by END,
            acknowledgement_note = CASE WHEN $7::boolean THEN NULL ELSE acknowledgement_note END
      WHERE id = $1`,
    [input.id, input.severity, big(input.value), big(input.threshold), input.now, input.asOf, input.reopen],
  );
}

export async function markNotified(tx: Tx, id: string, now: Date): Promise<void> {
  await tx.query(`UPDATE analytics.alert_events SET notify_count = notify_count + 1, last_notified_at = $2 WHERE id = $1`, [id, now]);
}

export async function resolveEvent(tx: Tx, input: { id: string; now: Date; value: number | null }): Promise<void> {
  await tx.query(`UPDATE analytics.alert_events SET status = 'RESOLVED', resolved_at = $2, resolved_value = $3 WHERE id = $1 AND status IN ('OPEN','ACKNOWLEDGED')`, [input.id, input.now, big(input.value)]);
}

/** Accuse réception d'une alerte OUVERTE ; `false` si elle n'est plus ouverte (déjà acquittée ou résolue). */
export async function acknowledgeEvent(tx: Tx, input: { id: string; userId: string | null; now: Date; note: string | null }): Promise<boolean> {
  const r = await tx.query(
    `UPDATE analytics.alert_events SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = $3, acknowledgement_note = $4 WHERE id = $1 AND status = 'OPEN'`,
    [input.id, input.userId, input.now, input.note],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface EventFilters {
  status?: AlertStatus | undefined;
  severity?: AlertSeverity | undefined;
  metric?: string | undefined;
  ruleId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function filterClause(f: EventFilters, v: Visibility, params: unknown[]): string {
  const parts = [visibilityClause("e", v, params)];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    parts.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("e.status = ?", f.status);
  if (f.severity) add("e.severity = ?", f.severity);
  if (f.metric) add("e.metric = ?", f.metric);
  if (f.ruleId) add("e.rule_id = ?", f.ruleId);
  if (f.from) add("e.raised_at >= ?::date", f.from);
  if (f.to) add("e.raised_at < (?::date + 1)", f.to);
  return parts.join(" AND ");
}

export async function listEvents(tx: Tx, f: EventFilters, v: Visibility, page: { limit: number; offset: number }): Promise<{ rows: EventRow[]; total: number; counts: { open: number; acknowledged: number; resolved: number } }> {
  const params: unknown[] = [];
  const where = filterClause(f, v, params);
  const rows = await tx.many<Record<string, any>>(
    `SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM} WHERE ${where}
      ORDER BY CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END, CASE e.severity WHEN 'CRITICAL' THEN 0 ELSE 1 END, e.raised_at DESC, e.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page.limit, page.offset],
  );
  const cp: unknown[] = [];
  const cw = filterClause({ ...f, status: undefined }, v, cp);
  const counts = await tx.queryOne<Record<string, any>>(
    `SELECT count(*) FILTER (WHERE e.status = 'OPEN')::text AS open, count(*) FILTER (WHERE e.status = 'ACKNOWLEDGED')::text AS acknowledged, count(*) FILTER (WHERE e.status = 'RESOLVED')::text AS resolved
       FROM analytics.alert_events e WHERE ${cw}`,
    cp,
  );
  const total = f.status ? Number(counts?.[f.status.toLowerCase()] ?? 0) : Number(counts?.open ?? 0) + Number(counts?.acknowledged ?? 0) + Number(counts?.resolved ?? 0);
  return { rows: rows.map(toEvent), total, counts: { open: Number(counts?.open ?? 0), acknowledged: Number(counts?.acknowledged ?? 0), resolved: Number(counts?.resolved ?? 0) } };
}

// ------------------------------------------------------------------------------------------------------------------
// Notifications émises (historique + anti-doublon)
// ------------------------------------------------------------------------------------------------------------------

/** Enregistre la notification ; `false` si la clé de dédoublonnage existe déjà (créneau déjà notifié) : rien ne doit alors partir. */
export async function insertNotification(
  tx: Tx,
  input: { tenantId: string; id: string; alertId: string; dedupeKey: string; reason: NotificationReason; severity: AlertSeverity; value: number; recipientRoles: readonly string[]; now: Date },
): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO analytics.alert_notifications (tenant_id, id, alert_id, dedupe_key, reason, severity, value, recipient_roles, emitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [input.tenantId, input.id, input.alertId, input.dedupeKey, input.reason, input.severity, big(input.value), [...input.recipientRoles], input.now],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function highestNotifiedSeverity(tx: Tx, alertId: string): Promise<AlertSeverity | null> {
  const r = await tx.queryOne<{ s: string | null }>(`SELECT CASE max(CASE severity WHEN 'CRITICAL' THEN 2 ELSE 1 END) WHEN 2 THEN 'CRITICAL' WHEN 1 THEN 'WARNING' END AS s FROM analytics.alert_notifications WHERE alert_id = $1`, [alertId]);
  return (r?.s as AlertSeverity | null) ?? null;
}

export async function listNotifications(tx: Tx, alertId: string): Promise<NotificationRow[]> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT id, alert_id, dedupe_key, reason, severity, value::text AS value, recipient_roles, emitted_at FROM analytics.alert_notifications WHERE alert_id = $1 ORDER BY emitted_at, id`,
    [alertId],
  );
  return rows.map((r) => ({ id: r.id, alertId: r.alert_id, dedupeKey: r.dedupe_key, reason: r.reason, severity: r.severity, value: num(r.value), recipientRoles: r.recipient_roles, emittedAt: r.emitted_at }));
}
