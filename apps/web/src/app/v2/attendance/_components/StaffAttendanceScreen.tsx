"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ATTENDANCE_LEAVE_STATUSES, attendanceRequestLeaveBodySchema, type attendanceLeaveDtoSchema, type attendanceStaffRecordDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import type { z } from "zod";
import { useFeature } from "@/platform/access";
import {
  useLeaveDecision,
  useLeaveTypes,
  useMarkStaffAttendance,
  useMyStaffAttendance,
  useRejectLeave,
  useRequestLeave,
  useStaffAttendanceSummary,
  useStaffCheckIn,
  useStaffCheckOut,
  useStaffLeaves,
  useStaffRecords,
  useStatusDefinitions,
} from "@/platform/v2/attendance";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useStaffDirectory } from "@/platform/v2/directory";
import { useStaffOptions } from "@/platform/v2/lookups";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

type Leave = z.infer<typeof attendanceLeaveDtoSchema>;
type StaffRecord = z.infer<typeof attendanceStaffRecordDtoSchema>;

/** Types de congé du modèle d'établissement : repli quand le référentiel n'est pas lisible par l'utilisateur. */
const FALLBACK_LEAVE_TYPES = ["ANNUAL", "SICK", "MATERNITY", "UNPAID", "AUTHORIZED_ABSENCE"] as const;
const FALLBACK_STAFF_STATUSES = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"] as const;

const leaveTone = (s: string): Tone => (s === "APPROVED" ? "success" : s === "REQUESTED" ? "warning" : s === "REJECTED" ? "danger" : "neutral");

/** Présence et congés du personnel : vue direction (`manage`) ou espace personnel (`own`). Fonction `attendance.staff`. */
export function StaffAttendanceScreen({ mode }: { mode: "manage" | "own" }) {
  const t = useTranslations("v2Attendance.staff");
  const feature = useFeature("attendance.staff");
  if (!feature.isLoading && !feature.allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title={mode === "own" ? t("ownTitle") : t("title")} description={t("description")} />
        <FeatureNotice>{t("featureOff")}</FeatureNotice>
      </div>
    );
  }
  return mode === "own" ? <OwnView /> : <ManageView />;
}

// ---------------------------------------------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------------------------------------------

function ManageView() {
  const t = useTranslations("v2Attendance.staff");
  const flash = useFlash();
  const staff = useStaffDirectory();
  const today = todayCivil();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [leaveStatus, setLeaveStatus] = useState<string>("REQUESTED");
  const summary = useStaffAttendanceSummary({ from, to });
  const records = useStaffRecords({ from, to });
  const leaves = useStaffLeaves({ status: (leaveStatus || undefined) as Leave["status"] | undefined });
  const [marking, setMarking] = useState(false);
  const [requesting, setRequesting] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Can permission="attendance.staff.record">
              <button type="button" className={buttonClass.primary} onClick={() => setMarking(true)}>
                {t("mark")}
              </button>
            </Can>
            <Can permission="attendance.leave.request">
              <button type="button" className={buttonClass.secondary} onClick={() => setRequesting(true)}>
                {t("requestLeave")}
              </button>
            </Can>
          </>
        }
      />
      {flash.node}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
      </div>

      <section aria-labelledby="staff-summary" className="space-y-2">
        <h2 id="staff-summary" className="text-lg font-semibold">
          {t("summary")}
        </h2>
        <DataTable
          caption={t("summaryCaption")}
          columns={[
            { id: "staff", header: t("columns.staff"), rowHeader: true, cell: (r: NonNullable<typeof summary.data>["rows"][number]) => staff.name(r.staffId) },
            { id: "days", header: t("columns.days"), align: "right", cell: (r) => r.days },
            {
              id: "byStatus",
              header: t("columns.byStatus"),
              cell: (r) =>
                Object.entries(r.byStatus)
                  .map(([code, n]) => `${code} : ${n}`)
                  .join(" · ") || "—",
              className: "hidden sm:table-cell",
            },
            { id: "late", header: t("columns.lateMinutes"), align: "right", cell: (r) => r.lateMinutes, className: "hidden md:table-cell" },
            { id: "leave", header: t("columns.leaveDays"), align: "right", cell: (r) => r.approvedLeaveDays },
          ]}
          rows={summary.data?.rows ?? []}
          getRowId={(r) => r.staffId}
          isLoading={summary.isFetching}
          error={summary.error}
          onRetry={() => void summary.refetch()}
          emptyTitle={t("emptySummary")}
        />
      </section>

      <section aria-labelledby="staff-records" className="space-y-2">
        <h2 id="staff-records" className="text-lg font-semibold">
          {t("records")}
        </h2>
        <RecordsTable rows={records.data?.items ?? []} isLoading={records.isFetching} error={records.error} onRetry={() => void records.refetch()} nameOf={(id) => staff.name(id)} showStaff />
      </section>

      <section aria-labelledby="staff-leaves" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="staff-leaves" className="text-lg font-semibold">
            {t("leaves")}
          </h2>
          <div className="w-full sm:w-56">
            <FormField label={t("leaveStatusFilter")}>
              {(c) => <NativeSelect {...c} value={leaveStatus} onChange={setLeaveStatus} placeholder={t("all")} options={ATTENDANCE_LEAVE_STATUSES.map((s) => ({ value: s, label: t(`leaveStatus.${s}`) }))} />}
            </FormField>
          </div>
        </div>
        <LeavesTable rows={leaves.data?.items ?? []} isLoading={leaves.isFetching} error={leaves.error} onRetry={() => void leaves.refetch()} nameOf={(id) => staff.name(id)} showStaff manage onDone={(m) => flash.show(m)} />
      </section>

      {marking ? <MarkDialog onClose={() => setMarking(false)} onDone={() => flash.show(t("marked"))} /> : null}
      {requesting ? <LeaveDialog withStaffPicker onClose={() => setRequesting(false)} onDone={() => flash.show(t("leaveRequested"))} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Espace personnel
// ---------------------------------------------------------------------------------------------------------------

function OwnView() {
  const t = useTranslations("v2Attendance.staff");
  const flash = useFlash();
  const me = useMyStaffAttendance();
  const checkIn = useStaffCheckIn();
  const checkOut = useStaffCheckOut();
  const [requesting, setRequesting] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("ownTitle")}
        description={t("ownDescription")}
        actions={
          <Can permission="attendance.leave.request">
            <button type="button" className={buttonClass.secondary} onClick={() => setRequesting(true)}>
              {t("requestLeave")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <Can permission="attendance.own.record">
        <section aria-labelledby="own-clock" className="space-y-3 rounded-lg border p-4">
          <h2 id="own-clock" className="text-lg font-semibold">
            {t("clock")}
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={buttonClass.primary} disabled={checkIn.isPending} onClick={() => checkIn.mutate(undefined, { onSuccess: () => flash.show(t("checkedIn")) })}>
              {t("checkIn")}
            </button>
            <button type="button" className={buttonClass.secondary} disabled={checkOut.isPending} onClick={() => checkOut.mutate(undefined, { onSuccess: () => flash.show(t("checkedOut")) })}>
              {t("checkOut")}
            </button>
          </div>
          {checkIn.error ? <ErrorBlock error={checkIn.error} /> : null}
          {checkOut.error ? <ErrorBlock error={checkOut.error} /> : null}
        </section>
      </Can>
      {me.isPending ? (
        <LoadingBlock />
      ) : me.isError ? (
        <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <>
          <section aria-labelledby="own-records" className="space-y-2">
            <h2 id="own-records" className="text-lg font-semibold">
              {t("records")}
            </h2>
            <RecordsTable rows={me.data.records} isLoading={false} nameOf={() => ""} />
          </section>
          <section aria-labelledby="own-leaves" className="space-y-2">
            <h2 id="own-leaves" className="text-lg font-semibold">
              {t("leaves")}
            </h2>
            <LeavesTable rows={me.data.leaves} isLoading={false} nameOf={() => ""} onDone={(m) => flash.show(m)} />
          </section>
        </>
      )}
      {requesting ? <LeaveDialog onClose={() => setRequesting(false)} onDone={() => flash.show(t("leaveRequested"))} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tableaux et formulaires
// ---------------------------------------------------------------------------------------------------------------

function RecordsTable({ rows, isLoading, error, onRetry, nameOf, showStaff = false }: { rows: StaffRecord[]; isLoading: boolean; error?: unknown; onRetry?: () => void; nameOf: (id: string) => string; showStaff?: boolean }) {
  const t = useTranslations("v2Attendance.staff");
  const tStatus = useTranslations("v2Attendance.status");
  const date = useDateFormat();
  const label = (code: string) => (["PRESENT", "ABSENT", "LATE", "ON_LEAVE"].includes(code) ? tStatus(code) : code);
  const columns: DataTableColumn<StaffRecord>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (r) => date.civil(r.workDate) },
    ...(showStaff ? [{ id: "staff", header: t("columns.staff"), cell: (r: StaffRecord) => nameOf(r.staffId) }] : []),
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={label(r.statusCode)} tone={r.statusCode === "PRESENT" ? "success" : r.statusCode === "ABSENT" ? "danger" : "warning"} /> },
    { id: "in", header: t("columns.checkIn"), cell: (r) => date.instant(r.checkInAt), className: "hidden sm:table-cell" },
    { id: "out", header: t("columns.checkOut"), cell: (r) => date.instant(r.checkOutAt), className: "hidden sm:table-cell" },
    { id: "late", header: t("columns.lateMinutes"), align: "right", cell: (r) => r.minutesLate ?? "—", className: "hidden md:table-cell" },
  ];
  return <DataTable caption={t("recordsCaption")} columns={columns} rows={rows} getRowId={(r) => r.id} isLoading={isLoading} error={error} onRetry={onRetry} emptyTitle={t("emptyRecords")} />;
}

function LeavesTable({ rows, isLoading, error, onRetry, nameOf, showStaff = false, manage = false, onDone }: { rows: Leave[]; isLoading: boolean; error?: unknown; onRetry?: () => void; nameOf: (id: string) => string; showStaff?: boolean; manage?: boolean; onDone: (message: string) => void }) {
  const t = useTranslations("v2Attendance.staff");
  const date = useDateFormat();
  const approve = useLeaveDecision("approve");
  const cancel = useLeaveDecision("cancel");
  const reject = useRejectLeave();
  const [rejecting, setRejecting] = useState<Leave | null>(null);
  const columns: DataTableColumn<Leave>[] = [
    ...(showStaff ? [{ id: "staff", header: t("columns.staff"), rowHeader: true, cell: (l: Leave) => nameOf(l.staffId) }] : []),
    { id: "type", header: t("columns.leaveType"), cell: (l) => l.leaveTypeCode },
    { id: "period", header: t("columns.period"), cell: (l) => t("periodValue", { from: date.civil(l.startsOn), to: date.civil(l.endsOn) }) },
    { id: "status", header: t("columns.status"), cell: (l) => <StatusBadge label={t(`leaveStatus.${l.status}`)} tone={leaveTone(l.status)} /> },
    { id: "reason", header: t("columns.reason"), cell: (l) => l.reason ?? "—", className: "hidden lg:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (l) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          {manage && l.status === "REQUESTED" ? (
            <Can permission="attendance.leave.decide">
              <button type="button" className={buttonClass.ghost} disabled={approve.isPending} onClick={() => approve.mutate({ id: l.id }, { onSuccess: () => onDone(t("leaveApproved")) })}>
                {t("approve")}
              </button>
              <button type="button" className={buttonClass.ghost} onClick={() => setRejecting(l)}>
                {t("reject")}
              </button>
            </Can>
          ) : null}
          {l.status === "REQUESTED" || l.status === "APPROVED" ? (
            <button type="button" className={buttonClass.ghost} disabled={cancel.isPending} onClick={() => cancel.mutate({ id: l.id }, { onSuccess: () => onDone(t("leaveCancelled")) })}>
              {t("cancelLeave")}
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <>
      {approve.error || cancel.error ? <Notice kind="error">{(approve.error ?? cancel.error)?.message}</Notice> : null}
      <DataTable caption={t("leavesCaption")} columns={columns} rows={rows} getRowId={(l) => l.id} isLoading={isLoading} error={error} onRetry={onRetry} emptyTitle={t("emptyLeaves")} />
      {rejecting ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRejecting(null)}
          title={t("rejectTitle")}
          description={t("rejectDescription")}
          reasonLabel={t("rejectReason")}
          confirmLabel={t("reject")}
          destructive
          minLength={3}
          isPending={reject.isPending}
          error={reject.error}
          onConfirm={(note) =>
            reject.mutate(
              { id: rejecting.id, note },
              {
                onSuccess: () => {
                  setRejecting(null);
                  onDone(t("leaveRejected"));
                },
              },
            )
          }
        />
      ) : null}
    </>
  );
}

function MarkDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Attendance.staff.markForm");
  const tStatus = useTranslations("v2Attendance.status");
  const mark = useMarkStaffAttendance();
  const defs = useStatusDefinitions();
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [day, setDay] = useState(todayCivil());
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(mark.error);
  const options = (defs.data ?? []).filter((d) => d.subjectKind === "STAFF" && d.active).map((d) => ({ value: d.code, label: d.label }));
  const statusOptions = options.length > 0 ? options : FALLBACK_STAFF_STATUSES.map((c) => ({ value: c, label: tStatus(c) }));
  const useStaffPick = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { status: "ACTIVE" });

  function submit() {
    const e: FieldErrors = {};
    if (!person) e.staffId = t("required");
    if (!day) e.workDate = t("required");
    if (!status) e.statusCode = t("required");
    setErrors(e);
    if (Object.keys(e).length > 0 || !person) return;
    mark.mutate({ staffId: person.value, workDate: day, statusCode: status, ...(note.trim() ? { note: note.trim() } : {}), ...(override ? { overrideLeave: true } : {}) }, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={mark.isPending} error={Object.keys(apiErrors).length ? undefined : mark.error}>
      <FormField label={t("person")} required error={errors.staffId ?? apiErrors.staffId}>
        {(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={useStaffPick} ariaLabel={t("person")} placeholder={t("choosePerson")} />}
      </FormField>
      <FormField label={t("day")} required error={errors.workDate ?? apiErrors.workDate}>
        {(c) => <TextControl {...c} type="date" value={day} onChange={setDay} />}
      </FormField>
      <FormField label={t("status")} required error={errors.statusCode ?? apiErrors.statusCode}>
        {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("chooseStatus")} options={statusOptions} />}
      </FormField>
      <FormField label={t("note")}>{(c) => <TextAreaControl {...c} value={note} onChange={setNote} maxLength={500} />}</FormField>
      <CheckControl checked={override} onChange={setOverride} label={t("overrideLeave")} hint={t("overrideLeaveHint")} />
    </FormDialog>
  );
}

function LeaveDialog({ withStaffPicker = false, onClose, onDone }: { withStaffPicker?: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Attendance.staff.leaveForm");
  const tFallback = useTranslations("v2Attendance.leaveFallback");
  const request = useRequestLeave();
  const types = useLeaveTypes();
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [type, setType] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [halfStart, setHalfStart] = useState(false);
  const [halfEnd, setHalfEnd] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(request.error);
  const typeOptions = types.data && types.data.length > 0 ? types.data.filter((x) => x.active).map((x) => ({ value: x.code, label: x.label })) : FALLBACK_LEAVE_TYPES.map((c) => ({ value: c, label: tFallback(c) }));
  const useStaffPick = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { status: "ACTIVE" });

  function submit() {
    const body = {
      ...(withStaffPicker && person ? { staffId: person.value } : {}),
      leaveTypeCode: type,
      startsOn: starts,
      endsOn: ends || starts,
      ...(halfStart ? { halfDayStart: true } : {}),
      ...(halfEnd ? { halfDayEnd: true } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    const v = validateWith(attendanceRequestLeaveBodySchema, body);
    const e: FieldErrors = v.ok ? {} : v.errors;
    if (withStaffPicker && !person) e.staffId = t("required");
    setErrors(e);
    if (!v.ok || Object.keys(e).length > 0) return;
    request.mutate(v.data, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={request.isPending} error={Object.keys(apiErrors).length ? undefined : request.error} wide>
      {withStaffPicker ? (
        <FormField label={t("person")} required error={errors.staffId ?? apiErrors.staffId}>
          {(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={useStaffPick} ariaLabel={t("person")} placeholder={t("choosePerson")} />}
        </FormField>
      ) : null}
      <FormField label={t("type")} required error={errors.leaveTypeCode ?? apiErrors.leaveTypeCode}>
        {(c) => <NativeSelect {...c} value={type} onChange={setType} placeholder={t("chooseType")} options={typeOptions} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("starts")} required error={errors.startsOn ?? apiErrors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={starts} onChange={setStarts} />}
        </FormField>
        <FormField label={t("ends")} required error={errors.endsOn ?? apiErrors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={ends} onChange={setEnds} />}
        </FormField>
      </div>
      <CheckControl checked={halfStart} onChange={setHalfStart} label={t("halfStart")} />
      <CheckControl checked={halfEnd} onChange={setHalfEnd} label={t("halfEnd")} />
      <FormField label={t("reason")}>{(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}</FormField>
    </FormDialog>
  );
}
