"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AssessmentDto } from "@ecoledigitale/contracts/v2/assess";
import { ASSESS_STATUSES } from "@ecoledigitale/contracts/v2/assess";
import { useAssessments, useAssessmentTypes } from "@/platform/v2/assess";
import { useTeachingContext } from "@/platform/v2/teaching";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { toneOfStatus } from "../../assessments/_components/shared";
import { teacherHref } from "./hrefs";

/**
 * « Mes évaluations » : évaluations de SES classes (l'API ne renvoie que celles que l'enseignant a le droit de voir), filtrées par
 * classe et état, avec accès direct à la grille de notes. Les noms de classes et de matières viennent de « mes classes ».
 */
export function TeacherAssessments({ initialClassroomId = "" }: { initialClassroomId?: string }) {
  const t = useTranslations("v2Portal.teacher.assessments");
  const tList = useTranslations("v2Assess.list");
  const tStatus = useTranslations("v2Assess.status");
  const date = useDateFormat();
  const ctx = useTeachingContext();
  const [classroomId, setClassroomId] = useState(initialClassroomId);
  const [status, setStatus] = useState("");
  const query = useAssessments({ classroomId: classroomId || undefined, status: status || undefined });
  const types = useAssessmentTypes();
  const typeLabels = useMemo(() => new Map((types.data ?? []).map((x) => [x.id, x.label] as const)), [types.data]);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const columns: DataTableColumn<AssessmentDto>[] = [
    {
      id: "title",
      header: tList("columns.title"),
      rowHeader: true,
      cell: (a) => (
        <Link href={teacherHref.assessment(a.id)} className="font-medium text-primary underline-offset-4 hover:underline">
          {a.title}
        </Link>
      ),
    },
    { id: "classroom", header: tList("columns.classroom"), cell: (a) => ctx.classroomName(a.classroomId) ?? "—", className: "hidden sm:table-cell" },
    { id: "subject", header: t("columns.subject"), cell: (a) => ctx.nodeLabel(a.curriculumNodeId) ?? "—", className: "hidden lg:table-cell" },
    { id: "type", header: tList("columns.type"), cell: (a) => typeLabels.get(a.typeId) ?? a.typeCode ?? "—", className: "hidden md:table-cell" },
    { id: "date", header: tList("columns.date"), cell: (a) => date.civil(a.assessedOn) },
    {
      id: "status",
      header: tList("columns.status"),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tStatus(a.status)} tone={toneOfStatus(a.status)} />
          {a.sessionNo === 2 ? <StatusBadge label={tList("session2")} tone="info" /> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{tList("columns.actions")}</span>,
      align: "right",
      cell: (a) => (
        <Link href={teacherHref.grades(a.id)} className={buttonClass.secondary} aria-label={tList("enterOf", { title: a.title })}>
          {a.status === "DRAFT" ? tList("enter") : tList("view")}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="assessment.create">
            <Link href={`${teacherHref.assessments()}/new`} className={buttonClass.primary}>
              {tList("create")}
            </Link>
          </Can>
        }
      />
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={tList("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={tList("classroom")}>
          {(c) => <NativeSelect {...c} value={classroomId} onChange={setClassroomId} placeholder={t("allClasses")} options={ctx.classes.map((k) => ({ value: k.classroomId, label: k.classroomName ?? k.classroomId.slice(0, 8) }))} />}
        </FormField>
        <FormField label={tList("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={tList("allStatuses")} options={ASSESS_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </form>
      {!ctx.isLoading && ctx.classes.length === 0 ? <Notice kind="info">{t("noClasses")}</Notice> : null}
      <DataTable
        caption={tList("tableCaption")}
        columns={columns}
        rows={rows}
        getRowId={(a) => a.id}
        isLoading={query.isPending && query.fetchStatus !== "idle"}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={tList("empty")}
        emptyDescription={tList("emptyHint")}
      />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {tList("more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
