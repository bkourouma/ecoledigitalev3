"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ATTENDANCE_ALERT_METRICS, attendanceAlertRuleSchema, type AttendanceAlertRuleInput } from "@ecoledigitale/contracts/v2/attendance";
import { useAttendanceSettings, useUpsertAttendanceSettings } from "@/platform/v2/attendance";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl, CheckControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, EmptyBlock, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";

/**
 * Alertes d'assiduité : les RÈGLES (indicateur + seuil) sont des paramètres de l'établissement, jamais des constantes
 * du logiciel. L'API évalue ces règles et publie une alerte au franchissement ; l'écran affiche et édite les règles.
 */
export function AlertsScreen() {
  const t = useTranslations("v2Attendance.alerts");
  const format = useFormatter();
  const flash = useFlash();
  const settings = useAttendanceSettings();
  const save = useUpsertAttendanceSettings();
  const [draft, setDraft] = useState<{ code: string; metric: string; threshold: string; active: boolean }>({ code: "", metric: "", threshold: "", active: true });
  const [errors, setErrors] = useState<FieldErrors>({});

  if (settings.isPending) return <LoadingBlock />;
  if (settings.isError) return <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} />;
  const rules = settings.data.alertRules;

  function persist(next: AttendanceAlertRuleInput[], message: string) {
    save.mutate({ alertRules: next }, { onSuccess: () => flash.show(message) });
  }

  function add() {
    const v = validateWith(attendanceAlertRuleSchema, { code: draft.code.trim().toUpperCase(), metric: draft.metric, threshold: Number(draft.threshold), active: draft.active });
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    if (rules.some((r) => r.code === v.data.code)) {
      setErrors({ code: t("codeExists") });
      return;
    }
    setErrors({});
    persist([...rules, v.data], t("added"));
    setDraft({ code: "", metric: "", threshold: "", active: true });
  }

  const metricLabel = (m: string) => t(`metrics.${m}`);
  const thresholdLabel = (metric: string, value: number) => (metric === "ABSENCE_RATE_BPS" ? format.number(value / 10_000, { style: "percent", maximumFractionDigits: 2 }) : format.number(value));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <Notice kind="info">{t("info")}</Notice>
      <section aria-labelledby="rules-title" className="space-y-3">
        <h2 id="rules-title" className="text-lg font-semibold">
          {t("rules")}
        </h2>
        {rules.length === 0 ? (
          <EmptyBlock title={t("noRules")} description={t("noRulesHint")} />
        ) : (
          <ul className="divide-y rounded-md border">
            {rules.map((r) => (
              <li key={r.code} className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.code} <StatusBadge label={r.active ? t("active") : t("inactive")} tone={r.active ? "success" : "neutral"} />
                  </p>
                  <p className="text-muted-foreground">{t("ruleSummary", { metric: metricLabel(r.metric), threshold: thresholdLabel(r.metric, r.threshold) })}</p>
                </div>
                <Can permission="attendance.settings.manage">
                  <div className="flex gap-2">
                    <button type="button" className={buttonClass.secondary} disabled={save.isPending} onClick={() => persist(rules.map((x) => (x.code === r.code ? { ...x, active: !x.active } : x)), r.active ? t("deactivated") : t("activated"))}>
                      {r.active ? t("deactivate") : t("activate")}
                    </button>
                    <button type="button" className={buttonClass.ghost} disabled={save.isPending} onClick={() => persist(rules.filter((x) => x.code !== r.code), t("removed"))}>
                      {t("remove")}
                    </button>
                  </div>
                </Can>
              </li>
            ))}
          </ul>
        )}
        {save.error ? <ErrorBlock error={save.error} /> : null}
      </section>
      <Can permission="attendance.settings.manage">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4"
          aria-label={t("addTitle")}
        >
          <h2 className="text-lg font-semibold">{t("addTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t("code")} hint={t("codeHint")} required error={errors.code}>
              {(c) => <TextControl {...c} value={draft.code} onChange={(code) => setDraft((d) => ({ ...d, code }))} maxLength={40} />}
            </FormField>
            <FormField label={t("metric")} required error={errors.metric}>
              {(c) => <NativeSelect {...c} value={draft.metric} onChange={(metric) => setDraft((d) => ({ ...d, metric }))} placeholder={t("chooseMetric")} options={ATTENDANCE_ALERT_METRICS.map((m) => ({ value: m, label: metricLabel(m) }))} />}
            </FormField>
            <FormField label={t("threshold")} hint={draft.metric === "ABSENCE_RATE_BPS" ? t("thresholdBps") : undefined} required error={errors.threshold}>
              {(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} value={draft.threshold} onChange={(threshold) => setDraft((d) => ({ ...d, threshold }))} />}
            </FormField>
          </div>
          <CheckControl checked={draft.active} onChange={(active) => setDraft((d) => ({ ...d, active }))} label={t("activeOnCreate")} />
          <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
            {t("add")}
          </button>
        </form>
      </Can>
    </div>
  );
}
