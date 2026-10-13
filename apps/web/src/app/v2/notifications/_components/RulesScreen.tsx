"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { NOTIF_CHANNELS, NOTIF_STRATEGIES, type NotifRuleView } from "@ecoledigitale/contracts/v2/notifications";
import { usePermission } from "@/platform/access";
import { useNotifCatalog, useNotifRules, useNotifTriggers, useResetRule, useSaveRule } from "@/platform/v2/notifications";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField, AntSelect } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { RULES } from "./notifications-utils";
import { AUDIENCE_KINDS, buildRuleBody, CLASSROOM_INCLUDES, conditionFieldsOf, draftOf, PRIORITIES, RULE_KINDS, type ConditionField, type RuleDraft } from "./rules-utils";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const CONDITION_INPUT: Record<Exclude<ConditionField, "priorities">, { type: "text" | "number"; step?: string }> = {
  stages: { type: "text" },
  minDaysOverdue: { type: "number" },
  minDrop: { type: "number", step: "0.01" },
  maxHours: { type: "number" },
  minValue: { type: "number" },
  daysBefore: { type: "number" },
};

function Summary({ rule }: { rule: NotifRuleView }) {
  const t = useTranslations("v2NotificationsRules");
  const c = rule.conditions;
  const parts: string[] = [];
  if (c.stages) parts.push(t("summary.stages", { list: c.stages.map((s) => `J+${s}`).join(", ") }));
  if (c.minDaysOverdue !== undefined) parts.push(t("summary.minDaysOverdue", { n: c.minDaysOverdue }));
  if (c.minDrop !== undefined) parts.push(t("summary.minDrop", { n: c.minDrop }));
  if (c.maxHours !== undefined) parts.push(t("summary.maxHours", { n: c.maxHours }));
  if (c.minValue !== undefined) parts.push(t("summary.minValue", { n: c.minValue }));
  if (c.daysBefore !== undefined) parts.push(t("summary.daysBefore", { n: c.daysBefore }));
  if (c.priorities && c.priorities.length > 0) parts.push(t("summary.priorities", { list: c.priorities.map((p) => t(`priorities.${p}`)).join(", ") }));
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">{t("summary.audience")}</dt>
        <dd>{t(`audiences.${rule.audience.kind}`)}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">{t("summary.channels")}</dt>
        <dd>
          {rule.channels.map((ch) => t(`channels.${ch}`)).join(", ")} ({t(`strategies.${rule.strategy}`)})
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">{t("summary.template")}</dt>
        <dd className="font-mono text-xs">{rule.templateCode}</dd>
      </div>
      {parts.length > 0 ? (
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("summary.thresholds")}</dt>
          <dd>{parts.join(" · ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function RuleCard({ rule, triggerLabel, canEdit, onEdit }: { rule: NotifRuleView; triggerLabel: string | undefined; canEdit: boolean; onEdit: () => void }) {
  const t = useTranslations("v2NotificationsRules");
  return (
    <li className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{rule.label}</h3>
          <p className="text-xs text-muted-foreground">{t("trigger", { value: rule.kind === "EVENT" ? (triggerLabel ?? rule.trigger) : t(`alertTriggers.${rule.trigger}`) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={rule.enabled ? t("enabled") : t("disabled")} tone={rule.enabled ? "success" : "warning"} />
          {rule.urgent ? <StatusBadge label={t("urgent")} tone="danger" /> : null}
          <StatusBadge label={rule.custom ? t("custom") : rule.source === "TENANT" ? t("overridden") : t("shipped")} tone={rule.source === "TENANT" ? "info" : "neutral"} />
        </div>
      </div>
      <Summary rule={rule} />
      {canEdit ? (
        <div className="mt-3">
          <button type="button" className={buttonClass.secondary} onClick={onEdit} aria-label={t("editRule", { label: rule.label })}>
            {t("edit")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function RuleForm({ rule, templates, audiences, onDone }: { rule: NotifRuleView; templates: Array<{ code: string; label: string }>; audiences: readonly string[] | null; onDone: (message: string) => void }) {
  const t = useTranslations("v2NotificationsRules");
  const describe = useDescribeError();
  const save = useSaveRule();
  const reset = useResetRule();
  const [d, setD] = useState<RuleDraft>(() => draftOf(rule));
  const [label, setLabel] = useState(rule.label);
  const [error, setError] = useState<string | null>(null);
  const fields = conditionFieldsOf(rule);
  const allowedAudiences = AUDIENCE_KINDS.filter((k) => audiences === null || audiences.includes(k) || k === rule.audience.kind);

  function toggle<T>(list: T[], value: T, on: boolean): T[] {
    return on ? [...list, value] : list.filter((x) => x !== value);
  }

  function submit() {
    const built = buildRuleBody(rule, d);
    if (!built.ok) {
      return setError(built.issue === "number" ? t("errors.number", { field: t(`conditions.${built.field ?? "minValue"}`) }) : t(`errors.${built.issue}`));
    }
    setError(null);
    save.mutate(
      {
        key: rule.key,
        body: {
          ...(rule.custom ? { label: label.trim(), trigger: rule.trigger } : {}),
          enabled: d.enabled,
          templateCode: d.templateCode,
          audience: built.audience,
          channels: d.channels,
          strategy: d.strategy,
          urgent: d.urgent,
          conditions: built.conditions,
        },
      },
      { onSuccess: () => onDone(t("saved")) },
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={t("form")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {rule.custom ? (
        <FormField label={t("label")} required>
          {(c) => <input {...c} type="text" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />}
        </FormField>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /> {t("enabledField")}
      </label>
      <FormField label={t("templateField")}>
        {(c) => (
          <AntSelect {...c} value={d.templateCode} onChange={(e) => setD({ ...d, templateCode: e.target.value as RuleDraft["templateCode"] })} className={inputClass}>
            {templates.map((tpl) => (
              <option key={tpl.code} value={tpl.code}>
                {tpl.label}
              </option>
            ))}
          </AntSelect>
        )}
      </FormField>

      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">{t("audienceField")}</legend>
        <FormField label={t("audienceKind")}>
          {(c) => (
            <AntSelect {...c} value={d.audienceKind} onChange={(e) => setD({ ...d, audienceKind: e.target.value as RuleDraft["audienceKind"] })} className={inputClass}>
              {allowedAudiences.map((k) => (
                <option key={k} value={k}>
                  {t(`audiences.${k}`)}
                </option>
              ))}
            </AntSelect>
          )}
        </FormField>
        {d.audienceKind === "STUDENT_GUARDIANS" ? (
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.financialFirst} onChange={(e) => setD({ ...d, financialFirst: e.target.checked })} /> {t("financialFirst")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.fallbackToStudent} onChange={(e) => setD({ ...d, fallbackToStudent: e.target.checked })} /> {t("fallbackToStudent")}
            </label>
          </div>
        ) : null}
        {d.audienceKind === "ROLES" ? (
          <FormField label={t("roleKeys")} hint={t("roleKeysHint")}>
            {(c) => <input {...c} type="text" value={d.roleKeys} onChange={(e) => setD({ ...d, roleKeys: e.target.value })} className={inputClass} />}
          </FormField>
        ) : null}
        {d.audienceKind === "CLASSROOM" ? (
          <div className="flex flex-wrap gap-4 text-sm">
            {CLASSROOM_INCLUDES.map((inc) => (
              <label key={inc} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={d.include.includes(inc)} onChange={(e) => setD({ ...d, include: toggle(d.include, inc, e.target.checked) })} /> {t(`includes.${inc}`)}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">{t("channelsField")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {NOTIF_CHANNELS.map((ch) => (
            <label key={ch} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={d.channels.includes(ch)} onChange={(e) => setD({ ...d, channels: toggle(d.channels, ch, e.target.checked) })} /> {t(`channels.${ch}`)}
            </label>
          ))}
        </div>
        <FormField label={t("strategyField")} hint={t("strategyHint")}>
          {(c) => (
            <AntSelect {...c} value={d.strategy} onChange={(e) => setD({ ...d, strategy: e.target.value as RuleDraft["strategy"] })} className={inputClass}>
              {NOTIF_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {t(`strategies.${s}`)}
                </option>
              ))}
            </AntSelect>
          )}
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.urgent} onChange={(e) => setD({ ...d, urgent: e.target.checked })} /> {t("urgentField")}
        </label>
        <p className="text-xs text-muted-foreground">{t("urgentHint")}</p>
      </fieldset>

      {fields.length > 0 ? (
        <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">{t("thresholds")}</legend>
          {fields.map((f) =>
            f === "priorities" ? (
              <div key={f} className="space-y-1 text-sm sm:col-span-2">
                <p className="font-medium">{t("conditions.priorities")}</p>
                <div className="flex flex-wrap gap-4">
                  {PRIORITIES.map((p) => (
                    <label key={p} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={d.priorities.includes(p)} onChange={(e) => setD({ ...d, priorities: toggle(d.priorities, p, e.target.checked) })} /> {t(`priorities.${p}`)}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <FormField key={f} label={t(`conditions.${f}`)} hint={t(`conditionHints.${f}`)}>
                {(c) => (
                  <input
                    {...c}
                    type={CONDITION_INPUT[f].type}
                    step={CONDITION_INPUT[f].step}
                    inputMode={f === "stages" ? "text" : "decimal"}
                    value={d.values[f] ?? ""}
                    onChange={(e) => setD({ ...d, values: { ...d.values, [f]: e.target.value } })}
                    className={inputClass}
                  />
                )}
              </FormField>
            ),
          )}
        </fieldset>
      ) : null}

      {error ? <Notice kind="error">{error}</Notice> : null}
      {save.error ? <Notice kind="error">{describe(save.error)}</Notice> : null}
      {reset.error ? <Notice kind="error">{describe(reset.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
          {t("save")}
        </button>
        {rule.source === "TENANT" ? (
          <button type="button" className={buttonClass.secondary} disabled={reset.isPending} onClick={() => reset.mutate({ key: rule.key }, { onSuccess: () => onDone(rule.custom ? t("deleted") : t("restored")) })}>
            {rule.custom ? t("delete") : t("restore")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Règles : qui est notifié, par quel canal, avec quel gabarit et quels seuils (événements, relances, alertes). */
export function RulesScreen() {
  const t = useTranslations("v2NotificationsRules");
  const canEdit = usePermission(RULES).allowed;
  const rules = useNotifRules();
  const triggers = useNotifTriggers();
  const catalog = useNotifCatalog();
  const flash = useFlash();
  const [editing, setEditing] = useState<NotifRuleView | null>(null);

  const triggerOf = (trigger: string) => triggers.data?.items.find((x) => x.eventType === trigger);
  const templates = (catalog.data?.items ?? []).map((e) => ({ code: e.code, label: e.label }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      {rules.isPending ? (
        <LoadingBlock />
      ) : rules.isError ? (
        <ErrorBlock error={rules.error} onRetry={() => void rules.refetch()} />
      ) : rules.data.items.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        RULE_KINDS.map((kind) => {
          const items = rules.data.items.filter((r) => r.kind === kind);
          if (items.length === 0) return null;
          return (
            <section key={kind} aria-labelledby={`kind-${kind}`} className="space-y-3">
              <div>
                <h2 id={`kind-${kind}`} className="text-lg font-semibold">
                  {t(`kinds.${kind}`)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(`kindHints.${kind}`)}</p>
              </div>
              <ul className="space-y-3">
                {items.map((r) => (
                  <RuleCard key={r.key} rule={r} triggerLabel={triggerOf(r.trigger)?.label} canEdit={canEdit && !catalog.isPending} onEdit={() => setEditing(r)} />
                ))}
              </ul>
            </section>
          );
        })
      )}
      <ModalDialog open={editing !== null} onOpenChange={(o) => (!o ? setEditing(null) : undefined)} title={editing ? editing.label : ""} description={t("dialogHint")} className="sm:max-w-2xl">
        {editing ? (
          <RuleForm
            key={`${editing.key}-${editing.updatedAt ?? "shipped"}`}
            rule={editing}
            templates={templates}
            audiences={editing.kind === "EVENT" ? (triggerOf(editing.trigger)?.audiences ?? null) : null}
            onDone={(message) => {
              flash.show(message);
              setEditing(null);
            }}
          />
        ) : null}
      </ModalDialog>
    </div>
  );
}
