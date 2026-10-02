"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RECONCILIATION_STATUSES, type AssignmentDto, type ReconciliationStatus } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useControlsDue, useReconcileAssignment, useReconciliationReport } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { CONTROL_TONE, PERM, RECONCILIATION_TONE, ScopeFilters, scopeQuery, type Scope } from "./stateassign-utils";

function Counter({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "danger" }) {
  const palette = { neutral: "border-border", success: "border-emerald-300", danger: "border-red-300" }[tone];
  return (
    <div className={`rounded-lg border p-3 ${palette}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );
}

/** Contrôles à faire et anomalies : lecture seule (le résultat d'un contrôle est consigné sur la fiche du dossier, par un humain). */
function ControlsDue({ scope }: { scope: Scope }) {
  const t = useTranslations("v2Stateassign.reconciliationScreen.controls");
  const tKind = useTranslations("v2Stateassign.controlKind");
  const tStatus = useTranslations("v2Stateassign.controlStatus");
  const date = useDateFormat();
  const [onlyOverdue, setOnlyOverdue] = useState(true);
  const query = useControlsDue({ ...scopeQuery(scope), status: "PENDING", overdueOnly: onlyOverdue, pageSize: 20 });
  const anomalies = useControlsDue({ ...scopeQuery(scope), status: "ANOMALY", pageSize: 20 });
  const Row = ({ r }: { r: NonNullable<typeof query.data>["items"][number] }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{r.studentName ?? r.assignmentReference}</p>
        <p className="text-xs text-muted-foreground">
          {tKind(r.control.kind)} · {t("dueOn", { date: date.civil(r.control.dueOn) })} · {r.assignmentReference}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge label={tStatus(r.control.status)} tone={CONTROL_TONE[r.control.status]} />
        <Link href={`/v2/stateassign/${r.control.assignmentId}`} className={buttonClass.ghost}>
          {t("open")}
          <span className="sr-only"> — {r.assignmentReference}</span>
        </Link>
      </div>
    </li>
  );
  return (
    <section aria-labelledby="controls-due-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="controls-due-title" className="text-base font-semibold">{t("title")}</h2>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="h-4 w-4" />
        {t("onlyOverdue")}
      </label>
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      <h3 className="text-sm font-medium">{t("pending", { count: query.data?.total ?? 0 })}</h3>
      {query.data && query.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("nonePending")}</p> : null}
      <ul className="divide-y rounded-md border empty:hidden" aria-label={t("pendingList")}>{(query.data?.items ?? []).map((r) => <Row key={r.control.id} r={r} />)}</ul>
      <h3 className="text-sm font-medium">{t("anomalies", { count: anomalies.data?.total ?? 0 })}</h3>
      {anomalies.data && anomalies.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noneAnomalies")}</p> : null}
      <ul className="divide-y rounded-md border empty:hidden" aria-label={t("anomaliesList")}>{(anomalies.data?.items ?? []).map((r) => <Row key={r.control.id} r={r} />)}</ul>
    </section>
  );
}

/** Rapprochement : les écarts (facturé − déclaré) par dossier, calculés par l'API ; le statut est celui de la base (tolérance de l'établissement). */
export function ReconciliationScreen() {
  const t = useTranslations("v2Stateassign.reconciliationScreen");
  const tRecon = useTranslations("v2Stateassign.reconciliation");
  const money = useMoney();
  const flash = useFlash();
  const canReconcile = usePermission(PERM.reconcile).allowed;
  const reconcile = useReconcileAssignment();
  const [scope, setScope] = useState<Scope>({ institutionId: "", academicYearId: "" });
  const [status, setStatus] = useState<ReconciliationStatus>("DISCREPANCY");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const query = useReconciliationReport({ ...scopeQuery(scope), reconciliationStatus: status, page, pageSize });

  const columns = useMemo<DataTableColumn<AssignmentDto>[]>(
    () => [
      {
        id: "reference",
        header: t("columns.reference"),
        rowHeader: true,
        cell: (a) => (
          <Link href={`/v2/stateassign/${a.id}`} className="font-medium underline-offset-2 hover:underline">
            {a.reference}
          </Link>
        ),
      },
      { id: "student", header: t("columns.student"), cell: (a) => a.studentName ?? "—" },
      { id: "state", header: t("columns.state"), align: "right", cell: (a) => `${money.of(a.reconciliation.stateBilled)} / ${money.of(a.declaredState)}` },
      { id: "stateDelta", header: t("columns.stateDelta"), align: "right", cell: (a) => money.of(a.reconciliation.stateDelta) },
      { id: "parent", header: t("columns.parent"), align: "right", className: "hidden lg:table-cell", cell: (a) => `${money.of(a.reconciliation.parentBilled)} / ${money.of(a.declaredParent)}` },
      { id: "parentDelta", header: t("columns.parentDelta"), align: "right", cell: (a) => money.of(a.reconciliation.parentDelta) },
      { id: "status", header: t("columns.status"), cell: (a) => <StatusBadge label={tRecon(a.reconciliation.status)} tone={RECONCILIATION_TONE[a.reconciliation.status]} /> },
      {
        id: "actions",
        header: <span className="sr-only">{t("columns.actions")}</span>,
        cell: (a) =>
          canReconcile ? (
            <button type="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate(a.id, { onSuccess: () => flash.show(t("reconciled", { reference: a.reference })) })} className={buttonClass.ghost}>
              {t("reconcile")}
              <span className="sr-only"> — {a.reference}</span>
            </button>
          ) : null,
      },
    ],
    [t, tRecon, money, canReconcile, reconcile, flash],
  );

  const counts = query.data?.counts;
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("explain")}</Notice>
      <ScopeFilters value={scope} onChange={(s) => { setScope(s); setPage(1); }} />
      {counts ? (
        <dl className="grid gap-3 sm:grid-cols-3" aria-label={t("counts")}>
          <Counter label={tRecon("NEVER")} value={counts.never} tone="neutral" />
          <Counter label={tRecon("BALANCED")} value={counts.balanced} tone="success" />
          <Counter label={tRecon("DISCREPANCY")} value={counts.discrepancy} tone="danger" />
        </dl>
      ) : null}
      <FormField label={t("show")} className="max-w-xs">
        {(c) => <NativeSelect {...c} value={status} onChange={(v) => { setStatus(RECONCILIATION_STATUSES.find((s) => s === v) ?? "DISCREPANCY"); setPage(1); }} options={RECONCILIATION_STATUSES.map((s) => ({ value: s, label: tRecon(s) }))} />}
      </FormField>
      {flash.node}
      {reconcile.isError ? <ErrorBlock error={reconcile.error} /> : null}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(a) => a.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        pagination={{ page, pageSize, total: query.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
      />
      <ControlsDue scope={scope} />
    </div>
  );
}
