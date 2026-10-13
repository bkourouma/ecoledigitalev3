"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { attendanceAbsenceRowDtoSchema, attendanceJustificationDtoSchema, attendanceSummaryCountsDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import { usePermission } from "@/platform/access";
import { useChildAttendance, useMyAttendance, useWithdrawJustification } from "@/platform/v2/attendance";
import { useMyChildren } from "@/platform/v2/people";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { statusTone } from "./call-utils";
import { JustificationForm } from "./JustificationForm";
import { justificationTone } from "./JustificationsScreen";

type Row = z.infer<typeof attendanceAbsenceRowDtoSchema>;
type Justification = z.infer<typeof attendanceJustificationDtoSchema>;
type Counts = z.infer<typeof attendanceSummaryCountsDtoSchema>;

/** Mes enfants (parent) : liste des enfants liés au compte, chacun menant à ses absences. */
export function ChildrenAttendanceList() {
  const t = useTranslations("v2Attendance.portal");
  const children = useMyChildren();
  return (
    <div className="space-y-6">
      <PageHeader title={t("childrenTitle")} description={t("childrenDescription")} />
      {children.isPending ? (
        <LoadingBlock />
      ) : children.isError ? (
        <ErrorBlock error={children.error} onRetry={() => void children.refetch()} />
      ) : children.data.length === 0 ? (
        <EmptyBlock title={t("noChildren")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {children.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card/40 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">{c.currentEnrollment?.classroomName ?? c.studentNumber}</p>
              </div>
              <Link href={`/v2/attendance/children/${c.id}`} className={buttonClass.secondary}>
                {t("seeAbsences")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Absences d'un élève (`self`) ou d'un enfant (`child`) : récapitulatif, absences à justifier, justificatifs, dépôt. */
export function PortalScreen({ via, studentId }: { via: "self" | "child"; studentId?: string }) {
  const t = useTranslations("v2Attendance.portal");
  const tPart = useTranslations("v2AttendanceHalfDays.sessionPart");
  const tStatus = useTranslations("v2Attendance.status");
  const date = useDateFormat();
  const flash = useFlash();
  const own = useMyAttendance({}, via === "self");
  const child = useChildAttendance(via === "child" ? (studentId ?? null) : null, {});
  const q = via === "self" ? own : child;
  const canJustify = usePermission(via === "self" ? "attendance.self.justify" : "attendance.child.justify").allowed;
  const withdraw = useWithdrawJustification();
  const [justify, setJustify] = useState<{ from: string; to: string } | null>(null);

  const label = (code: string) => (["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"].includes(code) ? tStatus(code) : code);

  const columns: DataTableColumn<Row>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (r) => (r.dayPart === "FULL" ? date.civil(r.sessionDate) : `${date.civil(r.sessionDate)} · ${tPart(r.dayPart)}`) },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={label(r.statusCode)} tone={statusTone(r.statusCode)} /> },
    { id: "minutes", header: t("columns.minutes"), align: "right", cell: (r) => (r.statusCode === "LATE" ? (r.minutesLate ?? "—") : (r.countedMinutes ?? "—")), className: "hidden sm:table-cell" },
    { id: "excused", header: t("columns.justification"), cell: (r) => (r.excused ? <StatusBadge label={t("excused")} tone="info" /> : <StatusBadge label={t("toJustify")} tone="warning" />) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) =>
        !r.excused && canJustify ? (
          <button type="button" className={buttonClass.ghost} onClick={() => setJustify({ from: r.sessionDate, to: r.sessionDate })}>
            {t("justify")}
          </button>
        ) : null,
    },
  ];

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title={via === "self" ? t("meTitle") : t("childTitle")}
        description={t("description")}
        actions={
          canJustify ? (
            <button type="button" className={buttonClass.primary} onClick={() => setJustify({ from: "", to: "" })}>
              {t("deposit")}
            </button>
          ) : null
        }
      />
      {flash.node}
      {data.summary ? <SummaryCards counts={data.summary.effective} overridden={data.summary.overridden} /> : null}
      <section aria-labelledby="portal-records" className="space-y-2">
        <h2 id="portal-records" className="text-lg font-semibold">
          {t("records")}
        </h2>
        <DataTable caption={t("recordsCaption")} columns={columns} rows={data.records} getRowId={(r) => r.recordId} emptyTitle={t("noRecords")} emptyDescription={t("noRecordsHint")} />
      </section>
      <section aria-labelledby="portal-justifs" className="space-y-2">
        <h2 id="portal-justifs" className="text-lg font-semibold">
          {t("justifications")}
        </h2>
        {data.justifications.length === 0 ? (
          <EmptyBlock title={t("noJustifications")} />
        ) : (
          <ul className="space-y-2">
            {data.justifications.map((j) => (
              <JustificationCard key={j.id} j={j} canWithdraw={canJustify} onWithdraw={() => withdraw.mutate({ id: j.id }, { onSuccess: () => flash.show(t("withdrawn")) })} pending={withdraw.isPending} />
            ))}
          </ul>
        )}
        {withdraw.error ? <Notice kind="error">{withdraw.error.message}</Notice> : null}
      </section>
      {justify && (via === "self" || studentId) ? (
        <JustificationForm
          studentId={via === "self" ? data.studentId : studentId}
          defaultFrom={justify.from}
          defaultTo={justify.to}
          onClose={() => setJustify(null)}
          onDone={() => flash.show(t("deposited"))}
        />
      ) : null}
    </div>
  );
}

export function SummaryCards({ counts, overridden }: { counts: Counts; overridden: boolean }) {
  const t = useTranslations("v2Attendance.portal.summary");
  const items: Array<[string, number]> = [
    [t("sessions"), counts.sessionsTotal],
    [t("absent"), counts.absentCount],
    [t("excused"), counts.excusedCount],
    [t("late"), counts.lateCount],
    [t("early"), counts.earlyLeaveCount],
  ];
  return (
    <section aria-labelledby="summary-title" className="space-y-2">
      <h2 id="summary-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-card/40 p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {overridden ? <p className="text-xs text-muted-foreground">{t("overridden")}</p> : null}
    </section>
  );
}

function JustificationCard({ j, canWithdraw, onWithdraw, pending }: { j: Justification; canWithdraw: boolean; onWithdraw: () => void; pending: boolean }) {
  const t = useTranslations("v2Attendance.portal");
  const tStatus = useTranslations("v2Attendance.justifications.status");
  const date = useDateFormat();
  return (
    <li className="space-y-1 rounded-2xl border border-white/10 bg-card/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{j.fromDate === j.toDate ? date.civil(j.fromDate) : t("window", { from: date.civil(j.fromDate), to: date.civil(j.toDate) })}</span>
        <StatusBadge label={tStatus(j.status)} tone={justificationTone(j.status)} />
      </div>
      <p className="text-muted-foreground">{t("reasonLine", { reason: j.reasonCode })}</p>
      {j.comment ? <p className="whitespace-pre-wrap">{j.comment}</p> : null}
      {j.decisionNote ? <p>{t("decisionNote", { note: j.decisionNote })}</p> : null}
      {j.revocationReason ? <p>{t("revocationNote", { note: j.revocationReason })}</p> : null}
      {canWithdraw && j.status === "PENDING" ? (
        <button type="button" className={buttonClass.ghost} disabled={pending} onClick={onWithdraw}>
          {t("withdraw")}
        </button>
      ) : null}
    </li>
  );
}
