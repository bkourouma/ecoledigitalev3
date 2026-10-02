"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ANALYTICS_ALERT_FREQUENCIES, ANALYTICS_ALERT_LIMITS, type AnalyticsAlertRule, type AnalyticsAlertRuleCreate } from "@ecoledigitale/contracts/v2/analytics";
import { useAnalyticsAlertMetrics, useAnalyticsAlertRules, useAnalyticsCreateAlertRule, useAnalyticsScopes, useAnalyticsUpdateAlertRule } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { FeatureGuard, Section } from "../../owner/_components/kit";
import { parseThreshold, thresholdToInput, useMeasure } from "./measure";

/** Rôles proposés (clés des modèles de rôles du système) ; d'autres clés de rôles personnalisés se saisissent à part. */
export const SUGGESTED_ROLES = ["owner", "directeur", "directeur_etudes", "econome", "secretariat", "responsable_pedagogique", "responsable_examens", "admissions_officer"] as const;
const ROLE_RE = /^[a-z][a-z0-9_]{1,59}$/;

interface Draft {
  id: string | null;
  rowVersion: number;
  label: string;
  metric: string;
  warning: string;
  critical: string;
  windowDays: string;
  institutionId: string;
  campusId: string;
  roles: string[];
  extraRoles: string;
  frequency: (typeof ANALYTICS_ALERT_FREQUENCIES)[number];
  enabled: boolean;
}

const EMPTY: Draft = { id: null, rowVersion: 1, label: "", metric: "", warning: "", critical: "", windowDays: "", institutionId: "", campusId: "", roles: ["directeur"], extraRoles: "", frequency: "DAILY", enabled: true };

export function AlertRulesScreen() {
  return (
    <FeatureGuard>
      <Rules />
    </FeatureGuard>
  );
}

/**
 * Règles d'alerte de l'établissement : indicateur, seuils (attention / critique), périmètre, rôles destinataires, fréquence.
 * Lecture seule sans `analytics.alerts.manage`. Les seuils sont ceux de l'établissement : aucune valeur n'est proposée par défaut
 * et aucun n'est une règle officielle.
 */
function Rules() {
  const t = useTranslations("v2Analytics.rules");
  const date = useDateFormat();
  const measure = useMeasure();
  const metrics = useAnalyticsAlertMetrics();
  const rules = useAnalyticsAlertRules();
  const [editing, setEditing] = useState<Draft | null>(null);
  const flash = useFlash();
  const roleLabel = (role: string): string => ((SUGGESTED_ROLES as readonly string[]).includes(role) ? t(`roles.${role}`) : role);
  const infoOf = (metric: string) => metrics.data?.metrics.find((m) => m.metric === metric);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="analytics.alerts.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setEditing({ ...EMPTY })}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <Notice kind="info">{t("deliveryNote")}</Notice>
      {flash.node}
      {rules.isPending && rules.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {rules.isError ? <ErrorBlock error={rules.error} onRetry={() => void rules.refetch()} /> : null}
      {rules.data ? (
        <Section id="rules-list" title={t("list.title")}>
          <DataTable
            caption={t("list.caption")}
            columns={[
              {
                id: "label",
                header: t("list.rule"),
                rowHeader: true,
                cell: (r) => (
                  <div>
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{t(`metrics.${r.metric}`)}</div>
                  </div>
                ),
              },
              {
                id: "thresholds",
                header: t("list.thresholds"),
                cell: (r) => (
                  <div className="text-sm tabular-nums">
                    {r.warningValue === null ? null : <div>{t("list.warning", { value: measure(r.unit, r.warningValue), direction: t(`direction.${r.comparator}`) })}</div>}
                    {r.criticalValue === null ? null : <div>{t("list.critical", { value: measure(r.unit, r.criticalValue), direction: t(`direction.${r.comparator}`) })}</div>}
                  </div>
                ),
              },
              { id: "roles", header: t("list.roles"), cell: (r) => r.recipientRoles.map(roleLabel).join(", "), className: "hidden md:table-cell" },
              { id: "frequency", header: t("list.frequency"), cell: (r) => t(`frequency.${r.frequency}`), className: "hidden lg:table-cell" },
              { id: "state", header: t("list.state"), cell: (r) => <StatusBadge label={r.enabled ? t("list.enabled") : t("list.disabled")} tone={r.enabled ? "success" : "neutral"} /> },
              {
                id: "last",
                header: t("list.last"),
                cell: (r) => (
                  <span className="text-sm">
                    {r.lastEvaluatedAt ? `${t(`outcome.${r.lastOutcome ?? "NOT_MEASURED"}`)} · ${date.instant(r.lastEvaluatedAt)}` : t("list.neverEvaluated")}
                  </span>
                ),
                className: "hidden lg:table-cell",
              },
              {
                id: "actions",
                header: t("list.actions"),
                align: "right",
                cell: (r) => (
                  <Can permission="analytics.alerts.manage">
                    <button type="button" className={buttonClass.secondary} onClick={() => setEditing(toDraft(r, infoOf(r.metric)?.unit ?? "COUNT"))}>
                      {t("list.edit")}
                    </button>
                  </Can>
                ),
              },
            ]}
            rows={rules.data.rules}
            getRowId={(r) => r.id}
            emptyTitle={t("list.empty")}
          />
        </Section>
      ) : null}
      {editing ? <RuleForm key={editing.id ?? "new"} draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash.show(t("saved")); }} /> : null}
    </div>
  );
}

function toDraft(r: AnalyticsAlertRule, unit: "BPS" | "AMOUNT" | "COUNT"): Draft {
  const suggested = r.recipientRoles.filter((x) => (SUGGESTED_ROLES as readonly string[]).includes(x));
  return {
    id: r.id,
    rowVersion: r.rowVersion,
    label: r.label,
    metric: r.metric,
    warning: thresholdToInput(unit, r.warningValue),
    critical: thresholdToInput(unit, r.criticalValue),
    windowDays: r.windowDays === null ? "" : String(r.windowDays),
    institutionId: r.institutionId ?? "",
    campusId: r.campusId ?? "",
    roles: suggested,
    extraRoles: r.recipientRoles.filter((x) => !suggested.includes(x)).join(", "),
    frequency: r.frequency,
    enabled: r.enabled,
  };
}

function RuleForm({ draft: initial, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2Analytics.rules.form");
  const tm = useTranslations("v2Analytics.rules");
  const metrics = useAnalyticsAlertMetrics();
  const scopes = useAnalyticsScopes();
  const create = useAnalyticsCreateAlertRule();
  const update = useAnalyticsUpdateAlertRule();
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Partial<Record<"label" | "metric" | "warning" | "critical" | "windowDays" | "roles" | "campusId", string>>>({});
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const info = metrics.data?.metrics.find((m) => m.metric === draft.metric);
  const institutions = scopes.data?.data.institutions ?? [];
  const campuses = useMemo(() => (scopes.data?.data.campuses ?? []).filter((c) => !draft.institutionId || c.institutionId === draft.institutionId), [scopes.data, draft.institutionId]);
  const pending = create.isPending || update.isPending;
  const failure = create.error ?? update.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const label = draft.label.trim();
    if (label.length < ANALYTICS_ALERT_LIMITS.labelMin || label.length > ANALYTICS_ALERT_LIMITS.labelMax) next.label = t("errors.label");
    if (!info) next.metric = t("errors.metric");
    const unit = info?.unit ?? "COUNT";
    const warning = parseThreshold(unit, draft.warning);
    const critical = parseThreshold(unit, draft.critical);
    if (!warning.ok) next.warning = t(`errors.${warning.reason === "range" ? "range" : "number"}`);
    if (!critical.ok) next.critical = t(`errors.${critical.reason === "range" ? "range" : "number"}`);
    if (warning.ok && critical.ok) {
      if (warning.value === null && critical.value === null) next.warning = t("errors.oneThreshold");
      else if (warning.value !== null && critical.value !== null && info) {
        if (info.comparator === "BELOW" && critical.value > warning.value) next.critical = t("errors.criticalBelow");
        if (info.comparator === "ABOVE" && critical.value < warning.value) next.critical = t("errors.criticalAbove");
      }
    }
    let windowDays: number | null = null;
    if (info?.windowed) {
      const raw = draft.windowDays.trim();
      windowDays = raw === "" ? info.defaultWindowDays : /^\d{1,3}$/.test(raw) ? Number(raw) : null;
      if (windowDays === null || windowDays < 1 || windowDays > ANALYTICS_ALERT_LIMITS.windowMax) next.windowDays = t("errors.window");
    }
    const extra = draft.extraRoles.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const roles = [...new Set([...draft.roles, ...extra])];
    if (roles.length === 0 || roles.length > ANALYTICS_ALERT_LIMITS.recipientRolesMax || roles.some((x) => !ROLE_RE.test(x))) next.roles = t("errors.roles", { max: ANALYTICS_ALERT_LIMITS.recipientRolesMax });
    if (info?.campusScoped && draft.institutionId && !draft.campusId && campuses.length > 1) next.campusId = t("errors.campus");
    setErrors(next);
    if (Object.keys(next).length > 0 || !warning.ok || !critical.ok || !info) return;
    const body: AnalyticsAlertRuleCreate = {
      label,
      metric: info.metric,
      warningValue: warning.value,
      criticalValue: critical.value,
      windowDays: info.windowed ? windowDays : null,
      institutionId: draft.institutionId || null,
      campusId: draft.campusId || null,
      recipientRoles: roles,
      frequency: draft.frequency,
      enabled: draft.enabled,
    };
    if (draft.id) update.mutate({ id: draft.id, body: { ...body, rowVersion: draft.rowVersion } }, { onSuccess: onSaved });
    else create.mutate(body, { onSuccess: onSaved });
  }

  return (
    <Section id="rules-form" title={draft.id ? t("editTitle") : t("newTitle")}>
      <form className="space-y-5" noValidate onSubmit={submit} aria-label={draft.id ? t("editTitle") : t("newTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("label")} required error={errors.label ?? null}>
            {(c) => <TextControl {...c} value={draft.label} onChange={(v) => set({ label: v })} maxLength={ANALYTICS_ALERT_LIMITS.labelMax} />}
          </FormField>
          <FormField label={t("metric")} required error={errors.metric ?? null} hint={info ? t("direction", { direction: tm(`direction.${info.comparator}`) }) : undefined}>
            {(c) => (
              <NativeSelect
                {...c}
                value={draft.metric}
                onChange={(v) => set({ metric: v, warning: "", critical: "", windowDays: "" })}
                placeholder={t("choose")}
                disabled={draft.id !== null}
                options={(metrics.data?.metrics ?? []).map((m) => ({ value: m.metric, label: tm(`metrics.${m.metric}`) }))}
              />
            )}
          </FormField>
        </div>

        {info ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t("warning")} error={errors.warning ?? null} hint={t(`unitHint.${info.unit}`)}>
              {(c) => <TextControl {...c} inputMode="decimal" value={draft.warning} onChange={(v) => set({ warning: v })} />}
            </FormField>
            <FormField label={t("critical")} error={errors.critical ?? null} hint={t("criticalHint")}>
              {(c) => <TextControl {...c} inputMode="decimal" value={draft.critical} onChange={(v) => set({ critical: v })} />}
            </FormField>
            {info.windowed ? (
              <FormField label={t("window")} error={errors.windowDays ?? null} hint={t("windowHint", { days: info.defaultWindowDays ?? 30 })}>
                {(c) => <TextControl {...c} inputMode="numeric" value={draft.windowDays} onChange={(v) => set({ windowDays: v })} placeholder={String(info.defaultWindowDays ?? "")} />}
              </FormField>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {institutions.length > 1 ? (
            <FormField label={t("institution")} hint={t("scopeHint")}>
              {(c) => <NativeSelect {...c} value={draft.institutionId} onChange={(v) => set({ institutionId: v, campusId: "" })} placeholder={t("everywhere")} options={institutions.map((i) => ({ value: i.id, label: i.label }))} />}
            </FormField>
          ) : null}
          {campuses.length > 1 ? (
            <FormField label={t("campus")} error={errors.campusId ?? null} hint={info?.campusScoped ? t("campusRequiredHint") : undefined}>
              {(c) => <NativeSelect {...c} value={draft.campusId} onChange={(v) => set({ campusId: v })} placeholder={t("everywhere")} options={campuses.map((i) => ({ value: i.id, label: i.label }))} />}
            </FormField>
          ) : null}
          <FormField label={t("frequency")} hint={t("frequencyHint")}>
            {(c) => <NativeSelect {...c} value={draft.frequency} onChange={(v) => set({ frequency: v as Draft["frequency"] })} options={ANALYTICS_ALERT_FREQUENCIES.map((f) => ({ value: f, label: tm(`frequency.${f}`) }))} />}
          </FormField>
        </div>

        <fieldset className="space-y-1" aria-describedby={errors.roles ? "roles-error" : undefined}>
          <legend className="text-sm font-medium">{t("roles")}</legend>
          <p className="text-xs text-muted-foreground">{t("rolesHint")}</p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {SUGGESTED_ROLES.map((role) => (
              <CheckControl key={role} checked={draft.roles.includes(role)} onChange={(on) => set({ roles: on ? [...draft.roles, role] : draft.roles.filter((x) => x !== role) })} label={tm(`roles.${role}`)} />
            ))}
          </div>
          <FormField label={t("extraRoles")} hint={t("extraRolesHint")}>
            {(c) => <TextControl {...c} value={draft.extraRoles} onChange={(v) => set({ extraRoles: v })} autoComplete="off" />}
          </FormField>
          {errors.roles ? (
            <p id="roles-error" role="alert" className="text-xs font-medium text-destructive">
              {errors.roles}
            </p>
          ) : null}
        </fieldset>

        <CheckControl checked={draft.enabled} onChange={(v) => set({ enabled: v })} label={t("enabled")} hint={t("enabledHint")} />

        {failure ? <ErrorBlock error={failure} /> : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass.primary} disabled={pending}>
            {t("save")}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      </form>
    </Section>
  );
}
