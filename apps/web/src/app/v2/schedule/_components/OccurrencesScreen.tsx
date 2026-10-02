"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SCHEDULING_OCCURRENCE_KINDS, SCHEDULING_OCCURRENCE_STATUSES, type SchedulingConflictViewDto } from "@ecoledigitale/contracts/v2/scheduling";
import { usePermission } from "@/platform/access";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory, useRoomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useCancelOccurrence, useHoldOccurrence, useOccurrences, useRestoreOccurrence, type OccurrenceDto } from "@/platform/v2/scheduling";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice, useFlash } from "@/platform/ui/states";
import { ConflictList, useTimeRange } from "./OccurrenceCard";
import { OccurrenceFormDialog, RescheduleDialog, RoomDialog, SubstituteDialog } from "./OccurrenceDialogs";

const PAGE = 50;

/**
 * Séances ponctuelles : examens, réunions, réservations de salle, cours ajoutés ; report, changement de salle,
 * remplacement, annulation et rétablissement motivés. Chaque écriture est contrôlée par l'API (conflits imposés par la base).
 */
export function OccurrencesScreen() {
  const t = useTranslations("v2Schedule.occurrences");
  const tKind = useTranslations("v2Schedule.kind");
  const tStatus = useTranslations("v2Schedule.status");
  const date = useDateFormat();
  const range = useTimeRange();
  const flash = useFlash();
  const manage = usePermission("schedule.manage").allowed;
  const canHold = usePermission("schedule.occurrence.hold").allowed;
  const canCreate = [manage, usePermission("schedule.room.book").allowed, usePermission("schedule.occurrence.declare").allowed].some(Boolean);
  const dirs = { classrooms: useClassroomDirectory(), staff: useStaffDirectory(), rooms: useRoomDirectory() };
  const today = todayCivil();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 13));
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [warnings, setWarnings] = useState<SchedulingConflictViewDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<OccurrenceDto | null>(null);
  const [roomFor, setRoomFor] = useState<OccurrenceDto | null>(null);
  const [substituting, setSubstituting] = useState<OccurrenceDto | null>(null);
  const [cancelling, setCancelling] = useState<OccurrenceDto | null>(null);
  const [restoring, setRestoring] = useState<OccurrenceDto | null>(null);

  const list = useOccurrences({
    from,
    to,
    classroomId: classroom?.value,
    status: (status || undefined) as OccurrenceDto["status"] | undefined,
    kind: kind || undefined,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const cancel = useCancelOccurrence();
  const restore = useRestoreOccurrence();
  const hold = useHoldOccurrence();
  const done = (message: string, w: SchedulingConflictViewDto[] = []) => {
    flash.show(message);
    setWarnings(w);
  };
  const filter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const columns: DataTableColumn<OccurrenceDto>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (o) => date.civil(o.occursOn) },
    { id: "time", header: t("columns.time"), cell: (o) => range(o) },
    { id: "title", header: t("columns.title"), cell: (o) => o.title ?? tKind(o.kind) },
    { id: "classroom", header: t("columns.classroom"), cell: (o) => (o.classroomId ? dirs.classrooms.name(o.classroomId) : "—"), className: "hidden md:table-cell" },
    { id: "room", header: t("columns.room"), cell: (o) => (o.roomId ? dirs.rooms.name(o.roomId) : "—"), className: "hidden lg:table-cell" },
    { id: "staff", header: t("columns.staff"), cell: (o) => o.staff.map((s) => dirs.staff.name(s.staffId)).join(", ") || "—", className: "hidden lg:table-cell" },
    {
      id: "status",
      header: t("columns.status"),
      cell: (o) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tStatus(o.status)} tone={o.status === "CANCELLED" ? "neutral" : o.status === "HELD" ? "success" : "info"} />
          {o.needsReplacement && o.status !== "CANCELLED" ? <StatusBadge label={t("needsReplacement")} tone="warning" /> : null}
          {o.validatedAt ? <StatusBadge label={t("validated")} tone="neutral" /> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (o) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          {o.status !== "CANCELLED" ? (
            <>
              <Can permission="schedule.manage">
                <button type="button" className={buttonClass.ghost} onClick={() => setMoving(o)}>
                  {t("move")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setRoomFor(o)}>
                  {t("changeRoom")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setSubstituting(o)}>
                  {t("substitute")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setCancelling(o)}>
                  {t("cancel")}
                </button>
              </Can>
              {canHold && o.status === "PLANNED" ? (
                <button type="button" className={buttonClass.ghost} disabled={hold.isPending} onClick={() => hold.mutate({ id: o.id }, { onSuccess: () => done(t("held")) })}>
                  {t("hold")}
                </button>
              ) : null}
            </>
          ) : (
            <Can permission="schedule.manage">
              <button type="button" className={buttonClass.ghost} onClick={() => setRestoring(o)}>
                {t("restore")}
              </button>
            </Can>
          )}
        </span>
      ),
    },
  ];

  const items = list.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate ? (
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          ) : null
        }
      />
      {flash.node}
      {warnings.length > 0 ? <ConflictList conflicts={warnings} title={t("warningsTitle")} /> : null}
      {hold.error ? <Notice kind="error">{hold.error.message}</Notice> : null}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={filter(setFrom)} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={filter(setTo)} />}</FormField>
        <FormField label={t("classroomFilter")}>
          {(c) => <SelectAsync {...c} value={classroom} onChange={filter(setClassroom)} useOptions={useClassroomOptions} ariaLabel={t("classroomFilter")} placeholder={t("anyClassroom")} />}
        </FormField>
        <FormField label={t("statusFilter")}>
          {(c) => <NativeSelect {...c} value={status} onChange={filter(setStatus)} placeholder={t("all")} options={SCHEDULING_OCCURRENCE_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("kindFilter")}>
          {(c) => <NativeSelect {...c} value={kind} onChange={filter(setKind)} placeholder={t("all")} options={SCHEDULING_OCCURRENCE_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={items}
        getRowId={(o) => o.id}
        isLoading={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total ?? (page - 1) * PAGE + items.length + (list.data.hasMore ? 1 : 0), onPageChange: setPage } : undefined}
      />

      {creating ? <OccurrenceFormDialog onClose={() => setCreating(false)} onDone={done} /> : null}
      {moving ? <RescheduleDialog o={moving} onClose={() => setMoving(null)} onDone={done} /> : null}
      {roomFor ? <RoomDialog o={roomFor} onClose={() => setRoomFor(null)} onDone={done} /> : null}
      {substituting ? <SubstituteDialog o={substituting} staffName={(id) => dirs.staff.name(id)} onClose={() => setSubstituting(null)} onDone={done} /> : null}
      {cancelling ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setCancelling(null)}
          title={t("cancelTitle")}
          description={t("cancelDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("cancel")}
          destructive
          minLength={3}
          isPending={cancel.isPending}
          error={cancel.error}
          onConfirm={(reason) =>
            cancel.mutate(
              { id: cancelling.id, reason },
              {
                onSuccess: () => {
                  setCancelling(null);
                  done(t("cancelled"));
                },
              },
            )
          }
        />
      ) : null}
      {restoring ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRestoring(null)}
          title={t("restoreTitle")}
          description={t("restoreDescription")}
          reasonLabel={t("reasonOptional")}
          confirmLabel={t("restore")}
          reasonRequired={false}
          isPending={restore.isPending}
          error={restore.error}
          onConfirm={(reason) =>
            restore.mutate(
              { id: restoring.id, ...(reason ? { reason } : {}) },
              {
                onSuccess: (r) => {
                  setRestoring(null);
                  done(t("restored"), r.warnings);
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
