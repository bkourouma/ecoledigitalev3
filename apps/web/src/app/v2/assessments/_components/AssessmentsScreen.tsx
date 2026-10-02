"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AssessmentDto } from "@ecoledigitale/contracts/v2/assess";
import { ASSESS_STATUSES } from "@ecoledigitale/contracts/v2/assess";
import { usePermission } from "@/platform/access";
import { useAssessments, useAssessmentTypes } from "@/platform/v2/assess";
import { useClassrooms } from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, CheckControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ClassroomPicker, PeriodPicker, toneOfStatus } from "./shared";

export function AssessmentsScreen({ initialClassroomId = "", initialStatus = "" }: { initialClassroomId?: string; initialStatus?: string }) {
  const t = useTranslations("v2Assess.list");
  const tStatus = useTranslations("v2Assess.status");
  const date = useDateFormat();
  const [classroomId, setClassroomId] = useState(initialClassroomId);
  const [periodId, setPeriodId] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [mine, setMine] = useState(false);
  const manage = usePermission("assessment.manage");

  const query = useAssessments({ classroomId: classroomId || undefined, academicPeriodId: periodId || undefined, status: status || undefined, mine: mine || undefined });
  const types = useAssessmentTypes();
  const classrooms = useClassrooms({ pageSize: 200 });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const classroomNames = useMemo(() => new Map((classrooms.data?.items ?? []).map((c) => [c.id, c.name] as const)), [classrooms.data]);
  const typeLabels = useMemo(() => new Map((types.data ?? []).map((x) => [x.id, x.label] as const)), [types.data]);

  const columns: DataTableColumn<AssessmentDto>[] = [
    {
      id: "title",
      header: t("columns.title"),
      rowHeader: true,
      cell: (a) => (
        <Link href={`/v2/assessments/${a.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {a.title}
        </Link>
      ),
    },
    { id: "classroom", header: t("columns.classroom"), cell: (a) => classroomNames.get(a.classroomId) ?? "—", className: "hidden sm:table-cell" },
    { id: "type", header: t("columns.type"), cell: (a) => typeLabels.get(a.typeId) ?? a.typeCode ?? "—", className: "hidden md:table-cell" },
    { id: "date", header: t("columns.date"), cell: (a) => date.civil(a.assessedOn) },
    {
      id: "scale",
      header: t("columns.scale"),
      cell: (a) => `/${a.scaleMax.replace(".", ",")}`,
      align: "right",
      className: "hidden md:table-cell",
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tStatus(a.status)} tone={toneOfStatus(a.status)} />
          {a.sessionNo === 2 ? <StatusBadge label={t("session2")} tone="info" /> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (a) => (
        <Link href={`/v2/assessments/${a.id}/grades`} className={buttonClass.secondary} aria-label={t("enterOf", { title: a.title })}>
          {a.status === "DRAFT" ? t("enter") : t("view")}
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="assessment.create">
            <Link href="/v2/assessments/new" className={buttonClass.primary}>
              {t("create")}
            </Link>
          </Can>
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("classroom")}>
          {(c) => (
            <ClassroomPicker
              {...c}
              value={classroomId}
              onChange={(v) => {
                setClassroomId(v);
                setPeriodId("");
              }}
            />
          )}
        </FormField>
        <FormField label={t("period")}>{(c) => <PeriodPicker {...c} classroomId={classroomId} value={periodId} onChange={setPeriodId} />}</FormField>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={ASSESS_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        {manage.allowed ? <CheckControl checked={mine} onChange={setMine} label={t("mineOnly")} /> : null}
      </form>

      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={rows}
        getRowId={(a) => a.id}
        isLoading={query.isPending && query.fetchStatus !== "idle"}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {query.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
