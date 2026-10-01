"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { attendanceAbsenceRowDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import { useCertificateData, useJustifications, useStudentRecords, useStudentSummary } from "@/platform/v2/attendance";
import { useStudent } from "@/platform/v2/people";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { ClassPeriodPicker, EMPTY_CLASS_PERIOD, type ClassPeriodValue } from "./ClassPeriodPicker";
import { statusTone } from "./call-utils";
import { JustificationDetail, justificationTone } from "./JustificationsScreen";
import { SummaryCards } from "./PortalScreen";

type Row = z.infer<typeof attendanceAbsenceRowDtoSchema>;

/**
 * Fiche d'absences d'un élève (vie scolaire) : récapitulatif de la période (avec surcharge tracée), pointages,
 * justificatifs, et données de l'attestation d'assiduité (le document PDF relève de la génération documentaire).
 */
export function StudentAttendanceScreen({ studentId, initialPeriodId }: { studentId: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Attendance.student");
  const tStatus = useTranslations("v2Attendance.status");
  const tJ = useTranslations("v2Attendance.justifications.status");
  const date = useDateFormat();
  const student = useStudent(studentId);
  const [filters, setFilters] = useState<ClassPeriodValue>({ ...EMPTY_CLASS_PERIOD, periodId: initialPeriodId ?? "" });
  const periodId = filters.periodId || null;
  const summary = useStudentSummary(studentId, periodId);
  const records = useStudentRecords(studentId);
  const justifications = useJustifications({ studentId, limit: 25 });
  const certificate = useCertificateData(studentId, periodId);
  const [certificateShown, setCertificateShown] = useState(false);
  const [openJustification, setOpenJustification] = useState<string | null>(null);
  const rows = records.data?.pages.flatMap((p) => p.items) ?? [];
  const name = student.data?.displayName ?? `…${studentId.slice(-4)}`;

  const label = (code: string) => (["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"].includes(code) ? tStatus(code) : code);
  const columns: DataTableColumn<Row>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (r) => date.civil(r.sessionDate) },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={label(r.statusCode)} tone={statusTone(r.statusCode)} /> },
    { id: "minutes", header: t("columns.minutes"), align: "right", cell: (r) => (r.statusCode === "LATE" ? (r.minutesLate ?? "—") : (r.countedMinutes ?? "—")), className: "hidden sm:table-cell" },
    { id: "excused", header: t("columns.justification"), cell: (r) => (r.excused ? <StatusBadge label={t("excused")} tone="info" /> : "—") },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title={t("title", { name })} description={t("description")} className="print:hidden" />
      <div className="print:hidden">
        <ClassPeriodPicker value={filters} onChange={setFilters} withClassroom={false} />
      </div>

      <section aria-labelledby="student-summary" className="space-y-2 print:hidden">
        <h2 id="student-summary" className="sr-only">
          {t("summary")}
        </h2>
        {!periodId ? (
          <Notice kind="info">{t("choosePeriod")}</Notice>
        ) : summary.isPending ? (
          <LoadingBlock />
        ) : summary.isError ? (
          <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <>
            <SummaryCards counts={summary.data.effective} overridden={summary.data.overridden} />
            {summary.data.override ? <Notice kind="warning">{t("overrideNote", { reason: summary.data.override.reason, at: date.instant(summary.data.override.setAt) })}</Notice> : null}
          </>
        )}
      </section>

      <section aria-labelledby="student-records" className="space-y-2 print:hidden">
        <h2 id="student-records" className="text-lg font-semibold">
          {t("records")}
        </h2>
        <DataTable caption={t("recordsCaption")} columns={columns} rows={rows} getRowId={(r) => r.recordId} isLoading={records.isFetching && !records.isFetchingNextPage} error={records.error} onRetry={() => void records.refetch()} emptyTitle={t("noRecords")} />
        {records.hasNextPage ? (
          <div className="flex justify-center">
            <button type="button" className={buttonClass.secondary} disabled={records.isFetchingNextPage} onClick={() => void records.fetchNextPage()}>
              {t("loadMore")}
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="student-justifs" className="space-y-2 print:hidden">
        <h2 id="student-justifs" className="text-lg font-semibold">
          {t("justifications")}
        </h2>
        {justifications.isPending ? (
          <LoadingBlock />
        ) : justifications.isError ? (
          <ErrorBlock error={justifications.error} onRetry={() => void justifications.refetch()} />
        ) : (justifications.data?.pages.flatMap((p) => p.items) ?? []).length === 0 ? (
          <EmptyBlock title={t("noJustifications")} />
        ) : (
          <ul className="divide-y rounded-md border">
            {(justifications.data?.pages.flatMap((p) => p.items) ?? []).map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{j.fromDate === j.toDate ? date.civil(j.fromDate) : t("window", { from: date.civil(j.fromDate), to: date.civil(j.toDate) })}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge label={tJ(j.status)} tone={justificationTone(j.status)} />
                  <button type="button" className={buttonClass.ghost} onClick={() => setOpenJustification(j.id)}>
                    {t("openJustification")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Can permission="attendance.report.read">
        <section aria-labelledby="student-cert" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 id="student-cert" className="text-lg font-semibold">
              {t("certificate")}
            </h2>
            <button type="button" className={buttonClass.secondary} disabled={!periodId} onClick={() => setCertificateShown((v) => !v)}>
              {certificateShown ? t("hideCertificate") : t("showCertificate")}
            </button>
          </div>
          {certificateShown && periodId ? (
            certificate.isPending ? (
              <LoadingBlock />
            ) : certificate.isError ? (
              <ErrorBlock error={certificate.error} onRetry={() => void certificate.refetch()} />
            ) : (
              <article aria-label={t("certificateLabel")} className="space-y-3 rounded-lg border p-5">
                <h3 className="text-xl font-bold">{t("certificateTitle")}</h3>
                <p>{t("certificateIntro", { name: certificate.data.displayName ?? name })}</p>
                {certificate.data.windowFrom && certificate.data.windowTo ? <p>{t("certificateWindow", { from: date.civil(certificate.data.windowFrom), to: date.civil(certificate.data.windowTo) })}</p> : null}
                <SummaryCards counts={certificate.data.summary} overridden={certificate.data.overridden} />
                <p className="text-xs text-muted-foreground print:hidden">{t("certificateHint")}</p>
                <button type="button" className={`${buttonClass.primary} print:hidden`} onClick={() => window.print()}>
                  {t("print")}
                </button>
              </article>
            )
          ) : null}
        </section>
      </Can>

      {openJustification ? <JustificationDetail id={openJustification} onClose={() => setOpenJustification(null)} onDone={() => setOpenJustification(null)} /> : null}
    </div>
  );
}
