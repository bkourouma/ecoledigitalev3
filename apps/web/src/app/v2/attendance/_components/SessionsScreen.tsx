"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ATTENDANCE_SESSION_STATUSES, type attendanceSessionDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import type { z } from "zod";
import { ApiError } from "@/platform/api/errors";
import { useAttendanceSessionsInfinite, useCancelAttendanceSession, useReopenAttendanceSession, useValidateAttendanceSession } from "@/platform/v2/attendance";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice, useFlash } from "@/platform/ui/states";

type Session = z.infer<typeof attendanceSessionDtoSchema>;

function tone(status: string) {
  return status === "OPEN" ? "info" : status === "SUBMITTED" ? "warning" : status === "VALIDATED" ? "success" : "neutral";
}

/** Suivi des appels : séances ouvertes, soumises, validées ; validation (une ou plusieurs), réouverture et annulation motivées. */
export function SessionsScreen() {
  const t = useTranslations("v2Attendance.sessions");
  const date = useDateFormat();
  const flash = useFlash();
  const classrooms = useClassroomDirectory();
  const staff = useStaffDirectory();
  const today = todayCivil();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState("");
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reopen, setReopen] = useState<Session | null>(null);
  const [cancel, setCancel] = useState<Session | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);

  const list = useAttendanceSessionsInfinite({ from, to, status: (status || undefined) as Session["status"] | undefined, classroomId: classroom?.value, limit: 100 });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const validate = useValidateAttendanceSession();
  const reopenMut = useReopenAttendanceSession();
  const cancelMut = useCancelAttendanceSession();

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function validateSelected() {
    setBatching(true);
    setBatchErrors([]);
    const errors: string[] = [];
    let ok = 0;
    // Une requête par appel : l'API valide séance par séance (chaque échec est rapporté, les autres passent).
    for (const id of selected) {
      try {
        await validate.mutateAsync({ sessionId: id });
        ok += 1;
      } catch (e) {
        errors.push(`${e instanceof ApiError ? e.message : t("batchFailed")}`);
      }
    }
    validate.reset();
    setBatchErrors(errors);
    setSelected(new Set());
    setBatching(false);
    if (ok > 0) flash.show(t("validatedCount", { count: ok }));
  }

  const hrefOf = (s: Session) => (s.occurrenceId ? `/v2/attendance/call/occurrence/${s.occurrenceId}` : `/v2/attendance/call/daily/${s.classroomId}?date=${s.sessionDate}`);

  const columns: DataTableColumn<Session>[] = [
    {
      id: "select",
      header: <span className="sr-only">{t("columns.select")}</span>,
      cell: (s) =>
        s.status === "SUBMITTED" ? (
          <Can permission="attendance.validate">
            <input type="checkbox" aria-label={t("selectOne", { classroom: classrooms.name(s.classroomId), date: date.civil(s.sessionDate) })} checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-5 w-5 accent-primary" />
          </Can>
        ) : null,
    },
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (s) => date.civil(s.sessionDate) },
    { id: "classroom", header: t("columns.classroom"), cell: (s) => classrooms.name(s.classroomId) },
    { id: "kind", header: t("columns.kind"), cell: (s) => t(`scope.${s.scope}`), className: "hidden md:table-cell" },
    { id: "by", header: t("columns.by"), cell: (s) => staff.name(s.takenByStaffId), className: "hidden lg:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={t(`status.${s.status}`)} tone={tone(s.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (s) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          <Link href={hrefOf(s)} className={buttonClass.ghost}>
            {t("open")}
          </Link>
          {s.status === "SUBMITTED" ? (
            <Can permission="attendance.validate">
              <button type="button" className={buttonClass.ghost} disabled={validate.isPending} onClick={() => validate.mutate({ sessionId: s.id }, { onSuccess: () => flash.show(t("validated")) })}>
                {t("validate")}
              </button>
            </Can>
          ) : null}
          {s.status === "VALIDATED" ? (
            <Can permission="attendance.session.reopen">
              <button type="button" className={buttonClass.ghost} onClick={() => setReopen(s)}>
                {t("reopen")}
              </button>
            </Can>
          ) : null}
          {s.status === "OPEN" || s.status === "SUBMITTED" ? (
            <button type="button" className={buttonClass.ghost} onClick={() => setCancel(s)}>
              {t("cancel")}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          selected.size > 0 ? (
            <button type="button" className={buttonClass.primary} disabled={batching} onClick={() => void validateSelected()}>
              {t("validateSelected", { count: selected.size })}
            </button>
          ) : null
        }
      />
      {flash.node}
      {validate.error && !batching ? <Notice kind="error">{validate.error.message}</Notice> : null}
      {batchErrors.length > 0 ? (
        <Notice kind="error">
          <p className="font-medium">{t("batchErrors", { count: batchErrors.length })}</p>
          <ul className="list-disc pl-5">
            {batchErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
        <FormField label={t("statusFilter")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("all")} options={ATTENDANCE_SESSION_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />}
        </FormField>
        <FormField label={t("classroomFilter")}>
          {(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassroomOptions} ariaLabel={t("classroomFilter")} placeholder={t("anyClassroom")} />}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        isLoading={list.isFetching && !list.isFetchingNextPage}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t("loadMore")}
          </button>
        </div>
      ) : null}
      {reopen ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setReopen(null)}
          title={t("reopenTitle")}
          description={t("reopenDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("reopen")}
          destructive
          isPending={reopenMut.isPending}
          error={reopenMut.error}
          onConfirm={(reason) =>
            reopenMut.mutate(
              { sessionId: reopen.id, reason },
              {
                onSuccess: () => {
                  setReopen(null);
                  flash.show(t("reopened"));
                },
              },
            )
          }
        />
      ) : null}
      {cancel ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setCancel(null)}
          title={t("cancelTitle")}
          description={t("cancelDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("cancel")}
          destructive
          isPending={cancelMut.isPending}
          error={cancelMut.error}
          onConfirm={(reason) =>
            cancelMut.mutate(
              { sessionId: cancel.id, reason },
              {
                onSuccess: () => {
                  setCancel(null);
                  flash.show(t("cancelled"));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
