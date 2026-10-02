"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AssignmentDto } from "@ecoledigitale/contracts/v2/stateassign";
import { useAssignments } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { ASSIGNMENT_TONE, ScopeFilters, scopeQuery, type Scope } from "./stateassign-utils";

/**
 * File de VÉRIFICATION : les dossiers enregistrés qui attendent un humain (puis, au choix, ceux vérifiés qui attendent leur
 * activation). La vérification fixe la référence d'affectation de l'inscription ; elle se fait sur la fiche, pièces sous les yeux,
 * par une autre personne que l'enregistrant (séparation des tâches réglable par l'établissement) : jamais automatiquement.
 */
export function VerificationScreen() {
  const t = useTranslations("v2Stateassign.verification");
  const tStatus = useTranslations("v2Stateassign.status");
  const date = useDateFormat();
  const money = useMoney();
  const [scope, setScope] = useState<Scope>({ institutionId: "", academicYearId: "" });
  const [status, setStatus] = useState<"RECEIVED" | "VERIFIED">("RECEIVED");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const query = useAssignments({ ...scopeQuery(scope), status, page, pageSize });

  const columns = useMemo<DataTableColumn<AssignmentDto>[]>(
    () => [
      { id: "reference", header: t("columns.reference"), rowHeader: true, cell: (a) => `${a.reference} (v${a.version})` },
      { id: "student", header: t("columns.student"), cell: (a) => a.studentName ?? "—" },
      { id: "authority", header: t("columns.authority"), className: "hidden md:table-cell", cell: (a) => a.issuingAuthority ?? "—" },
      { id: "amounts", header: t("columns.amounts"), align: "right", className: "hidden md:table-cell", cell: (a) => `${money.of(a.declaredState)} / ${money.of(a.declaredParent)}` },
      { id: "received", header: t("columns.received"), cell: (a) => date.instant(a.receivedAt) },
      { id: "status", header: t("columns.status"), cell: (a) => <StatusBadge label={tStatus(a.status)} tone={ASSIGNMENT_TONE[a.status]} /> },
      {
        id: "open",
        header: <span className="sr-only">{t("columns.open")}</span>,
        cell: (a) => (
          <Link href={`/v2/stateassign/${a.id}`} className={buttonClass.secondary}>
            {t("examine")}
            <span className="sr-only"> — {a.reference}</span>
          </Link>
        ),
      },
    ],
    [t, tStatus, date, money],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("fourEyes")}</Notice>
      <ScopeFilters value={scope} onChange={(s) => { setScope(s); setPage(1); }} />
      <FormField label={t("show")} className="max-w-xs">
        {(c) => <NativeSelect {...c} value={status} onChange={(v) => { setStatus(v === "VERIFIED" ? "VERIFIED" : "RECEIVED"); setPage(1); }} options={[{ value: "RECEIVED", label: t("toVerify") }, { value: "VERIFIED", label: t("toActivate") }]} />}
      </FormField>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(a) => a.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={status === "RECEIVED" ? t("emptyReceived") : t("emptyVerified")}
        pagination={{ page, pageSize, total: query.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
      />
    </div>
  );
}
