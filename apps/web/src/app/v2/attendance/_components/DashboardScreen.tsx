"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { attendanceSetOverrideBodySchema, type AttendanceSummaryDto } from "@ecoledigitale/contracts/v2/attendance";
import { useClassroomSummary, useRecomputeSummaries, useRemoveSummaryOverride, useSetSummaryOverride } from "@/platform/v2/attendance";
import { useStudentDirectory } from "@/platform/v2/directory";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { EmptyBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ClassPeriodPicker, EMPTY_CLASS_PERIOD, type ClassPeriodValue } from "./ClassPeriodPicker";

/**
 * Tableau de bord d'assiduité d'une classe sur une période : comptages EFFECTIFS renvoyés par l'API (surcharge sinon
 * dérivé des appels). Aucun calcul ici : la surcharge est une saisie tracée, le recalcul est demandé à l'API.
 */
export function DashboardScreen() {
  const t = useTranslations("v2Attendance.dashboard");
  const format = useFormatter();
  const flash = useFlash();
  const [filters, setFilters] = useState<ClassPeriodValue>(EMPTY_CLASS_PERIOD);
  const classroomId = filters.classroom?.value ?? null;
  const summary = useClassroomSummary(classroomId, filters.periodId || null);
  const students = useStudentDirectory(classroomId);
  const recompute = useRecomputeSummaries();
  const [override, setOverride] = useState<AttendanceSummaryDto | null>(null);
  const [removing, setRemoving] = useState<AttendanceSummaryDto | null>(null);
  const removeOverride = useRemoveSummaryOverride();

  const hours = (minutes: number) => t("hours", { value: format.number(minutes / 60, { maximumFractionDigits: 1 }) });
  const rows = summary.data?.rows ?? [];

  const columns: DataTableColumn<AttendanceSummaryDto>[] = [
    {
      id: "student",
      header: t("columns.student"),
      rowHeader: true,
      cell: (r) =>
        r.studentId ? (
          <Link href={`/v2/attendance/student/${r.studentId}?periodId=${r.periodId}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {students.name(r.studentId)}
          </Link>
        ) : (
          t("unknownStudent")
        ),
    },
    { id: "sessions", header: t("columns.sessions"), align: "right", cell: (r) => r.effective.sessionsTotal, className: "hidden md:table-cell" },
    { id: "absent", header: t("columns.absent"), align: "right", cell: (r) => t("absentOf", { total: r.effective.absentCount, excused: r.effective.excusedCount }) },
    { id: "late", header: t("columns.late"), align: "right", cell: (r) => r.effective.lateCount },
    { id: "early", header: t("columns.early"), align: "right", cell: (r) => r.effective.earlyLeaveCount, className: "hidden lg:table-cell" },
    { id: "unmarked", header: t("columns.unmarked"), align: "right", cell: (r) => r.effective.unmarkedCount, className: "hidden lg:table-cell" },
    { id: "minutes", header: t("columns.minutes"), align: "right", cell: (r) => t("minutesOf", { total: hours(r.effective.absentMinutes), excused: hours(r.effective.excusedMinutes) }), className: "hidden sm:table-cell" },
    {
      id: "state",
      header: t("columns.state"),
      cell: (r) => (r.overridden ? <StatusBadge label={t("overridden")} tone="warning" /> : <StatusBadge label={t("derived")} tone="neutral" />),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Can permission="attendance.summary.override">
          <span className="inline-flex gap-1">
            <button type="button" className={buttonClass.ghost} onClick={() => setOverride(r)}>
              {t("override")}
            </button>
            {r.overridden ? (
              <button type="button" className={buttonClass.ghost} onClick={() => setRemoving(r)}>
                {t("removeOverride")}
              </button>
            ) : null}
          </span>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="attendance.manage">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={!filters.periodId || recompute.isPending}
              onClick={() => recompute.mutate({ periodId: filters.periodId }, { onSuccess: () => flash.show(t("recomputed")) })}
            >
              {t("recompute")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <ClassPeriodPicker value={filters} onChange={setFilters} />
      {!classroomId ? (
        <EmptyBlock title={t("chooseClass")} description={t("chooseClassHint")} />
      ) : (
        <DataTable
          caption={t("caption")}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.enrollmentId}
          isLoading={summary.isFetching}
          error={summary.error}
          onRetry={() => void summary.refetch()}
          emptyTitle={t("empty")}
          emptyDescription={t("emptyHint")}
        />
      )}
      {override ? <OverrideDialog row={override} name={students.name(override.studentId)} onClose={() => setOverride(null)} onDone={() => flash.show(t("overrideSaved"))} /> : null}
      {removing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("removeTitle", { name: students.name(removing.studentId) })}
          description={t("removeDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("removeConfirm")}
          reasonRequired={false}
          isPending={removeOverride.isPending}
          error={removeOverride.error}
          onConfirm={(reason) =>
            removeOverride.mutate(
              { enrollmentId: removing.enrollmentId, periodId: removing.periodId, ...(reason ? { reason } : {}) },
              {
                onSuccess: () => {
                  setRemoving(null);
                  flash.show(t("overrideRemoved"));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function OverrideDialog({ row, name, onClose, onDone }: { row: AttendanceSummaryDto; name: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Attendance.dashboard.overrideForm");
  const set = useSetSummaryOverride();
  const [absent, setAbsent] = useState(String(row.effective.absentMinutes));
  const [excused, setExcused] = useState(String(row.effective.excusedMinutes));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(set.error);

  function submit() {
    const body = { enrollmentId: row.enrollmentId, periodId: row.periodId, absentMinutes: Number(absent), excusedMinutes: Number(excused), reason: reason.trim() };
    // Règles de FORME du contrat (motif ≥ 5 caractères, justifié ≤ absent) ; la décision reste à l'API.
    const v = validateWith(attendanceSetOverrideBodySchema, body);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    set.mutate(v.data, {
      onSuccess: () => {
        onClose();
        onDone();
      },
    });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name })} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={set.isPending} error={Object.keys(apiErrors).length ? undefined : set.error}>
      <FormField label={t("absentMinutes")} required error={errors.absentMinutes ?? apiErrors.absentMinutes}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={absent} onChange={setAbsent} />}
      </FormField>
      <FormField label={t("excusedMinutes")} hint={t("excusedHint")} required error={errors.excusedMinutes ?? apiErrors.excusedMinutes}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={excused} onChange={setExcused} />}
      </FormField>
      <FormField label={t("reason")} hint={t("reasonHint")} required error={errors.reason ?? apiErrors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}
