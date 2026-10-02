"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { attendanceAbsenceRowDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import { usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import { fetchAbsencesCsv, useAbsencesReport } from "@/platform/v2/attendance";
import { useClassroomDirectory, useStudentDirectory } from "@/platform/v2/directory";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { downloadTextFile } from "@/platform/ui/download";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, useFlash } from "@/platform/ui/states";
import { ClassPeriodPicker, EMPTY_CLASS_PERIOD, type ClassPeriodValue } from "./ClassPeriodPicker";
import { statusTone } from "./call-utils";
import { JustificationForm } from "./JustificationForm";

type Row = z.infer<typeof attendanceAbsenceRowDtoSchema>;

/**
 * Absences et retards, avec « à justifier » par défaut. L'API ne renvoie que des identifiants : les noms viennent de
 * l'annuaire de la classe choisie (sinon l'identifiant abrégé est affiché, avec un lien vers la fiche).
 */
export function AbsencesScreen() {
  const t = useTranslations("v2Attendance.absences");
  const tStatus = useTranslations("v2Attendance.status");
  const date = useDateFormat();
  const flash = useFlash();
  const [filters, setFilters] = useState<ClassPeriodValue>(EMPTY_CLASS_PERIOD);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [excused, setExcused] = useState<"" | "true" | "false">("false");
  const [statusCode, setStatusCode] = useState("");
  const [justify, setJustify] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canExport = usePermission("attendance.report.read").allowed;
  const classroomId = filters.classroom?.value;
  const students = useStudentDirectory(classroomId);
  const classrooms = useClassroomDirectory();

  const query = {
    classroomId,
    from: from || undefined,
    to: to || undefined,
    statusCode: statusCode || undefined,
    excused: excused === "" ? undefined : excused === "true",
    limit: 100,
  };
  const report = useAbsencesReport(query);
  const rows = report.data?.pages.flatMap((p) => p.items) ?? [];

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await fetchAbsencesCsv({ ...query, limit: undefined });
      downloadTextFile("absences.csv", csv, "text/csv", { bom: true });
      flash.show(t("exported"));
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const columns: DataTableColumn<Row>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (r) => date.civil(r.sessionDate) },
    {
      id: "student",
      header: t("columns.student"),
      cell: (r) => (
        <Link href={`/v2/attendance/student/${r.studentId}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {students.name(r.studentId)}
        </Link>
      ),
    },
    { id: "classroom", header: t("columns.classroom"), cell: (r) => classrooms.name(r.classroomId), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={tStatusLabel(r.statusCode)} tone={statusTone(r.statusCode)} /> },
    { id: "minutes", header: t("columns.minutes"), align: "right", cell: (r) => (r.statusCode === "LATE" ? (r.minutesLate ?? "—") : (r.countedMinutes ?? "—")), className: "hidden sm:table-cell" },
    { id: "excused", header: t("columns.excused"), cell: (r) => (r.excused ? <StatusBadge label={t("excused")} tone="info" /> : <StatusBadge label={t("toJustify")} tone="warning" />) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) =>
        r.excused ? null : (
          <Can permission="attendance.justification.submit">
            <button type="button" className={buttonClass.ghost} onClick={() => setJustify(r)}>
              {t("justify")}
            </button>
          </Can>
        ),
    },
  ];

  function tStatusLabel(code: string): string {
    return ["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"].includes(code) ? tStatus(code) : code;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canExport ? (
            <button type="button" className={buttonClass.secondary} disabled={exporting} onClick={() => void exportCsv()}>
              {exporting ? t("exporting") : t("exportCsv")}
            </button>
          ) : null
        }
      />
      {flash.node}
      {exportError ? <Notice kind="error">{exportError}</Notice> : null}
      <ClassPeriodPicker value={filters} onChange={setFilters} withPeriod={false} />
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
        <FormField label={t("justification")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={excused}
              onChange={(v) => setExcused(v as typeof excused)}
              placeholder={t("all")}
              options={[
                { value: "false", label: t("toJustify") },
                { value: "true", label: t("excused") },
              ]}
            />
          )}
        </FormField>
        <FormField label={t("statusFilter")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={statusCode}
              onChange={setStatusCode}
              placeholder={t("all")}
              options={["ABSENT", "LATE", "EARLY_LEAVE", "EXCUSED"].map((s) => ({ value: s, label: tStatus(s) }))}
            />
          )}
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("exportHint")}</p>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.recordId}
        isLoading={report.isFetching && !report.isFetchingNextPage}
        error={report.error}
        onRetry={() => void report.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {report.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} disabled={report.isFetchingNextPage} onClick={() => void report.fetchNextPage()}>
            {report.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </button>
        </div>
      ) : null}
      {justify ? (
        <JustificationForm
          studentId={justify.studentId}
          studentLabel={students.name(justify.studentId)}
          defaultFrom={justify.sessionDate}
          defaultTo={justify.sessionDate}
          onClose={() => setJustify(null)}
          onDone={() => flash.show(t("justifySaved"))}
        />
      ) : null}
    </div>
  );
}
