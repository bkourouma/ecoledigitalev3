/**
 * SQL des règles de notification : surcharges des règles livrées + règles personnalisées d'un établissement.
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifAudience, NotifChannel, NotifRuleConditions, NotifRuleKind, NotifStrategy, NotifTemplateCode } from "@ecoledigitale/contracts/src/v2/notifications";
import type { RuleDef } from "../domain/types";

export interface StoredRule extends RuleDef {
  readonly updatedAt: Date;
}

interface Row {
  key: string;
  label: string | null;
  kind: NotifRuleKind;
  trigger: string;
  custom: boolean;
  enabled: boolean;
  templateCode: NotifTemplateCode;
  audience: NotifAudience;
  channels: NotifChannel[];
  strategy: NotifStrategy;
  urgent: boolean;
  conditions: NotifRuleConditions;
  updatedAt: Date;
}

const COLS = `key, label, kind, trigger_type AS "trigger", custom, enabled, template_code AS "templateCode", audience, channels,
  strategy, urgent, conditions, updated_at AS "updatedAt"`;

const toStored = (r: Row): StoredRule => ({
  key: r.key,
  label: r.label ?? r.key,
  kind: r.kind,
  trigger: r.trigger,
  custom: r.custom,
  enabled: r.enabled,
  templateCode: r.templateCode,
  audience: r.audience,
  channels: r.channels,
  strategy: r.strategy,
  urgent: r.urgent,
  conditions: r.conditions,
  updatedAt: r.updatedAt,
});

export async function listRules(tx: Tx, tenantId: string): Promise<StoredRule[]> {
  return (await tx.many<Row>(`SELECT ${COLS} FROM notifications.rules WHERE tenant_id = $1 ORDER BY key`, [tenantId])).map(toStored);
}

export async function getRule(tx: Tx, tenantId: string, key: string): Promise<StoredRule | null> {
  const row = await tx.queryOne<Row>(`SELECT ${COLS} FROM notifications.rules WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
  return row ? toStored(row) : null;
}

export async function putRule(tx: Tx, tenantId: string, rule: RuleDef, actor: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.rules (tenant_id, key, label, kind, trigger_type, custom, enabled, template_code, audience, channels, strategy, urgent, conditions, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::text[],$11,$12,$13::jsonb,$14,$15,$15)
     ON CONFLICT (tenant_id, key) DO UPDATE SET label = EXCLUDED.label, enabled = EXCLUDED.enabled, template_code = EXCLUDED.template_code,
       audience = EXCLUDED.audience, channels = EXCLUDED.channels, strategy = EXCLUDED.strategy, urgent = EXCLUDED.urgent,
       conditions = EXCLUDED.conditions, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      tenantId,
      rule.key,
      rule.label,
      rule.kind,
      rule.trigger,
      rule.custom,
      rule.enabled,
      rule.templateCode,
      JSON.stringify(rule.audience),
      [...rule.channels],
      rule.strategy,
      rule.urgent,
      JSON.stringify(rule.conditions),
      actor,
      now,
    ],
  );
}

export async function deleteRule(tx: Tx, tenantId: string, key: string): Promise<boolean> {
  const r = await tx.query(`DELETE FROM notifications.rules WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
  return (r.rowCount ?? 0) > 0;
}
