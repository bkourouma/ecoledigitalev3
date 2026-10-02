/**
 * Règles de notification d'un établissement : règles LIVRÉES (données du code) surchargées par ligne en base, plus règles
 * personnalisées (`custom.*`). La fusion est pure et testée ; une règle invalide (déclencheur, audience, gabarit dont une
 * variable obligatoire n'est pas fournie par le déclencheur) est refusée à l'enregistrement.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { NotifRuleView, NotifSaveRuleBody } from "@ecoledigitale/contracts/src/v2/notifications";
import { DEFAULT_RULES, findDefaultRule } from "../domain/default-rules";
import { NotifCode, notFound, validation } from "../domain/errors";
import { NotificationsEvents } from "../domain/events";
import { SUPPORTED_TRIGGERS, triggerDef, validateRuleDef } from "../domain/triggers";
import type { RuleDef } from "../domain/types";
import * as rulesRepo from "../infrastructure/rules-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";

export interface EffectiveRule extends RuleDef {
  readonly source: "SHIPPED" | "TENANT";
  readonly updatedAt: Date | null;
}

/** Règles effectives : livrées (surchargées par clé) + personnalisées. Pur. */
export function mergeRules(stored: readonly rulesRepo.StoredRule[]): EffectiveRule[] {
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const out: EffectiveRule[] = DEFAULT_RULES.map((d) => {
    const s = byKey.get(d.key);
    return s ? { ...s, label: s.label || d.label, custom: false, source: "TENANT" as const, updatedAt: s.updatedAt } : { ...d, source: "SHIPPED" as const, updatedAt: null };
  });
  for (const s of stored) {
    if (!findDefaultRule(s.key)) out.push({ ...s, source: "TENANT", updatedAt: s.updatedAt });
  }
  return out;
}

export async function loadEffectiveRules(tx: Parameters<typeof rulesRepo.listRules>[0], tenantId: string): Promise<EffectiveRule[]> {
  return mergeRules(await rulesRepo.listRules(tx, tenantId));
}

export const ruleView = (r: EffectiveRule): NotifRuleView => ({
  key: r.key,
  label: r.label,
  kind: r.kind,
  trigger: r.trigger,
  source: r.source,
  custom: r.custom,
  enabled: r.enabled,
  templateCode: r.templateCode,
  audience: r.audience,
  channels: [...r.channels],
  strategy: r.strategy,
  urgent: r.urgent,
  conditions: r.conditions,
  updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
});

export async function listRules(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<{ items: NotifRuleView[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ items: (await loadEffectiveRules(tx, ctx.tenantId)).map(ruleView) }), { readOnly: true });
}

export function listSupportedTriggers(): { items: Array<{ eventType: string; label: string; audiences: string[] }> } {
  return { items: SUPPORTED_TRIGGERS.map((t) => ({ eventType: t.trigger, label: t.label, audiences: [...t.audiences] })) };
}

/** Crée ou remplace une règle (surcharge d'une règle livrée, ou règle personnalisée `custom.*`). */
export async function saveRule(deps: NotificationsDeps, ctx: RequestContext, key: string, body: NotifSaveRuleBody): Promise<Result<NotifRuleView, AppError>> {
  const shipped = findDefaultRule(key);
  const isCustom = !shipped;
  if (isCustom && !key.startsWith("custom.")) return err(validation(NotifCode.RULE_INVALID, "Une règle personnalisée a une clé « custom.… ».", "key"));
  const trigger = shipped ? shipped.trigger : body.trigger;
  if (!trigger) return err(validation(NotifCode.RULE_INVALID, "Le déclencheur est obligatoire pour une règle personnalisée.", "trigger"));
  if (shipped && body.trigger && body.trigger !== shipped.trigger) return err(validation(NotifCode.RULE_INVALID, "Le déclencheur d'une règle livrée ne se change pas : créez une règle personnalisée.", "trigger"));
  const def = triggerDef(trigger);
  if (!def) return err(validation(NotifCode.RULE_INVALID, `Déclencheur inconnu : « ${trigger} ».`, "trigger"));
  const rule: RuleDef = {
    key,
    label: body.label ?? shipped?.label ?? key,
    kind: def.kind,
    trigger,
    enabled: body.enabled,
    templateCode: body.templateCode,
    audience: body.audience,
    channels: body.channels,
    strategy: body.strategy,
    urgent: body.urgent,
    conditions: body.conditions,
    custom: isCustom,
  };
  const issues = validateRuleDef(rule);
  if (issues.length > 0) return err(validation(NotifCode.RULE_INVALID, issues[0]!, "rule", { issues }));
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    const before = await rulesRepo.getRule(tx, ctx.tenantId, key);
    await rulesRepo.putRule(tx, ctx.tenantId, rule, ctx.userId, now);
    events.add(NotificationsEvents.RULE_UPDATED, { v: 1, ruleKey: key, enabled: rule.enabled, updatedBy: ctx.userId }, { type: "rule", id: key });
    events.audit({ action: "notifications.rule.update", entity: "rule", entityId: key, before: before ? { enabled: before.enabled, channels: before.channels, conditions: before.conditions } : (shipped ? { enabled: shipped.enabled, channels: shipped.channels, conditions: shipped.conditions } : null), after: { enabled: rule.enabled, channels: rule.channels, conditions: rule.conditions, urgent: rule.urgent } });
    await events.flush(tx);
    return ok(ruleView({ ...rule, source: "TENANT", updatedAt: now }));
  });
}

/** Supprime la surcharge (règle livrée : retour aux valeurs livrées) ou la règle personnalisée. */
export async function resetRule(deps: NotificationsDeps, ctx: RequestContext, key: string): Promise<Result<NotifRuleView | null, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const removed = await rulesRepo.deleteRule(tx, ctx.tenantId, key);
    const shipped = findDefaultRule(key);
    if (!removed && !shipped) return err(notFound(NotifCode.RULE_NOT_FOUND, "Règle", key));
    events.audit({ action: "notifications.rule.reset", entity: "rule", entityId: key });
    await events.flush(tx);
    return ok(shipped ? ruleView({ ...shipped, source: "SHIPPED", updatedAt: null }) : null);
  });
}
