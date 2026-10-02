"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AnalyticsAlert, AnalyticsAlertMetric, AnalyticsAlertSeverity, AnalyticsAlertStatus } from "@ecoledigitale/contracts/v2/analytics";
import { ANALYTICS_ALERT_METRICS, ANALYTICS_ALERT_SEVERITIES, ANALYTICS_ALERT_STATUSES } from "@ecoledigitale/contracts/v2/analytics";
import { useAnalyticsAcknowledgeAlert, useAnalyticsAlert, useAnalyticsAlerts } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { ExportButton, FeatureGuard, KpiCard, KpiGrid, Section } from "../../owner/_components/kit";
import { useMeasure } from "./measure";

const SEVERITY_TONE: Record<AnalyticsAlertSeverity, Tone> = { WARNING: "warning", CRITICAL: "danger" };
const STATUS_TONE: Record<AnalyticsAlertStatus, Tone> = { OPEN: "danger", ACKNOWLEDGED: "info", RESOLVED: "success" };

export function AlertsScreen() {
  return (
    <FeatureGuard>
      <Alerts />
    </FeatureGuard>
  );
}

/**
 * Alertes de direction : actives d'abord, historique conservé (alertes résolues), accusé de réception avec note, détail des
 * notifications émises. L'état et la gravité sont dits en toutes lettres (jamais la couleur seule). Aucune donnée d'élève.
 */
function Alerts() {
  const t = useTranslations("v2Analytics.alerts");
  const date = useDateFormat();
  const [status, setStatus] = useState<AnalyticsAlertStatus | "">("");
  const [severity, setSeverity] = useState<AnalyticsAlertSeverity | "">("");
  const [metric, setMetric] = useState<AnalyticsAlertMetric | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);
  const query = useAnalyticsAlerts({ ...(status ? { status } : {}), ...(severity ? { severity } : {}), ...(metric ? { metric } : {}), limit: 100 });
  const data = query.data;
  const measure = useMeasure();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <Link href="/v2/analytics/alertes/regles" className={buttonClass.secondary}>
              {t("rulesLink")}
            </Link>
            <ExportButton dataset="alerts-history" />
          </div>
        }
      />
      <form className="grid gap-3 sm:grid-cols-3" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("filters.label")}>
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={(v) => setStatus(v as AnalyticsAlertStatus | "")} placeholder={t("filters.allStatuses")} options={ANALYTICS_ALERT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />}
        </FormField>
        <FormField label={t("filters.severity")}>
          {(c) => <NativeSelect {...c} value={severity} onChange={(v) => setSeverity(v as AnalyticsAlertSeverity | "")} placeholder={t("filters.allSeverities")} options={ANALYTICS_ALERT_SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) }))} />}
        </FormField>
        <FormField label={t("filters.metric")}>
          {(c) => <NativeSelect {...c} value={metric} onChange={(v) => setMetric(v as AnalyticsAlertMetric | "")} placeholder={t("filters.allMetrics")} options={ANALYTICS_ALERT_METRICS.map((m) => ({ value: m, label: t(`metrics.${m}`) }))} />}
        </FormField>
      </form>

      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("counts.open")} value={date.number(data.counts.open)} detail={data.counts.open > 0 ? t("counts.openDetail") : undefined} />
            <KpiCard label={t("counts.acknowledged")} value={date.number(data.counts.acknowledged)} />
            <KpiCard label={t("counts.resolved")} value={date.number(data.counts.resolved)} detail={t("counts.resolvedDetail")} />
          </KpiGrid>
          <Section id="alerts-list" title={t("list.title")}>
            <DataTable
              caption={t("list.caption")}
              columns={[
                { id: "severity", header: t("list.severity"), rowHeader: true, cell: (a) => <StatusBadge label={t(`severity.${a.severity}`)} tone={SEVERITY_TONE[a.severity]} /> },
                {
                  id: "metric",
                  header: t("list.metric"),
                  cell: (a) => (
                    <div>
                      <div className="font-medium">{t(`metrics.${a.metric}`)}</div>
                      <div className="text-xs text-muted-foreground">{a.ruleLabel}</div>
                    </div>
                  ),
                },
                {
                  id: "value",
                  header: t("list.value"),
                  align: "right",
                  cell: (a) => (
                    <div className="tabular-nums">
                      <div className="font-medium">{measure(a.unit, a.value, a.currency)}</div>
                      <div className="text-xs text-muted-foreground">{t(a.comparator === "BELOW" ? "list.below" : "list.above", { threshold: measure(a.unit, a.threshold, a.currency) })}</div>
                    </div>
                  ),
                },
                { id: "status", header: t("list.status"), cell: (a) => <StatusBadge label={t(`status.${a.status}`)} tone={STATUS_TONE[a.status]} /> },
                { id: "raised", header: t("list.raised"), cell: (a) => date.instant(a.raisedAt), className: "hidden md:table-cell" },
                { id: "notified", header: t("list.notified"), align: "right", cell: (a) => <span className="tabular-nums">{a.notifyCount}</span>, className: "hidden lg:table-cell" },
                {
                  id: "actions",
                  header: t("list.actions"),
                  align: "right",
                  cell: (a) => (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className={buttonClass.secondary} aria-expanded={selected === a.id} onClick={() => setSelected(selected === a.id ? null : a.id)}>
                        {t("list.details")}
                      </button>
                      {a.status === "OPEN" ? (
                        <Can permission="analytics.alerts.acknowledge">
                          <button type="button" className={buttonClass.primary} onClick={() => setAcking(acking === a.id ? null : a.id)}>
                            {t("list.acknowledge")}
                          </button>
                        </Can>
                      ) : null}
                    </div>
                  ),
                },
              ]}
              rows={data.alerts}
              getRowId={(a) => a.id}
              emptyTitle={t("list.empty")}
            />
          </Section>
          {acking ? <AcknowledgePanel alert={data.alerts.find((a) => a.id === acking)} onDone={() => setAcking(null)} /> : null}
          {selected ? <AlertDetail id={selected} /> : null}
        </>
      ) : null}
    </div>
  );
}

function AcknowledgePanel({ alert, onDone }: { alert: AnalyticsAlert | undefined; onDone: () => void }) {
  const t = useTranslations("v2Analytics.alerts.acknowledge");
  const ack = useAnalyticsAcknowledgeAlert();
  const flash = useFlash();
  const [note, setNote] = useState("");
  if (!alert) return null;
  function submit(e: FormEvent) {
    e.preventDefault();
    ack.mutate({ id: alert!.id, body: note.trim() ? { note: note.trim() } : {} }, { onSuccess: () => { flash.show(t("done")); onDone(); } });
  }
  return (
    <Section id="alerts-ack" title={t("title", { rule: alert.ruleLabel })}>
      <form className="space-y-3" noValidate onSubmit={submit} aria-label={t("form")}>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <FormField label={t("note")} hint={t("noteHint")}>
          {(c) => <TextAreaControl {...c} value={note} onChange={setNote} maxLength={500} rows={3} />}
        </FormField>
        {ack.isError ? <ErrorBlock error={ack.error} /> : null}
        {flash.node}
        <div className="flex gap-2">
          <button type="submit" className={buttonClass.primary} disabled={ack.isPending}>
            {t("confirm")}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={onDone}>
            {t("cancel")}
          </button>
        </div>
      </form>
    </Section>
  );
}

function AlertDetail({ id }: { id: string }) {
  const t = useTranslations("v2Analytics.alerts.detail");
  const date = useDateFormat();
  const measure = useMeasure();
  const query = useAnalyticsAlert(id);
  const a = query.data;
  return (
    <Section id="alerts-detail" title={t("title")}>
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {a ? (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label={t("raisedAt")} value={date.instant(a.raisedAt)} />
            <Row label={t("lastSeenAt")} value={date.instant(a.lastSeenAt)} />
            <Row label={t("asOf")} value={a.asOf ? date.instant(a.asOf) : "—"} />
            <Row label={t("value")} value={measure(a.unit, a.value, a.currency)} />
            <Row label={t("threshold")} value={measure(a.unit, a.threshold, a.currency)} />
            {a.acknowledgedAt ? <Row label={t("acknowledgedAt")} value={date.instant(a.acknowledgedAt)} /> : null}
            {a.acknowledgementNote ? <Row label={t("note")} value={a.acknowledgementNote} /> : null}
            {a.resolvedAt ? <Row label={t("resolvedAt")} value={date.instant(a.resolvedAt)} /> : null}
            {a.resolvedValue !== null ? <Row label={t("resolvedValue")} value={measure(a.unit, a.resolvedValue, a.currency)} /> : null}
          </dl>
          <DataTable
            caption={t("notifications.caption")}
            columns={[
              { id: "at", header: t("notifications.at"), rowHeader: true, cell: (n) => date.instant(n.emittedAt) },
              { id: "reason", header: t("notifications.reason"), cell: (n) => t(`notifications.reasons.${n.reason}`) },
              { id: "severity", header: t("notifications.severity"), cell: (n) => t(`notifications.severities.${n.severity}`), className: "hidden sm:table-cell" },
              { id: "value", header: t("notifications.value"), align: "right", cell: (n) => <span className="tabular-nums">{measure(a.unit, n.value, a.currency)}</span> },
              { id: "roles", header: t("notifications.roles"), cell: (n) => n.recipientRoles.join(", "), className: "hidden md:table-cell" },
            ]}
            rows={a.notifications}
            getRowId={(n) => n.id}
            emptyTitle={t("notifications.empty")}
          />
          <Notice kind="info">{t("deliveryNote")}</Notice>
        </div>
      ) : null}
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
