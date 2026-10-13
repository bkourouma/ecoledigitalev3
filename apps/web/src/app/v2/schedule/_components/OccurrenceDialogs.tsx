"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { SCHEDULING_OCCURRENCE_KINDS, type SchedulingConflictViewDto } from "@ecoledigitale/contracts/v2/scheduling";
import { ApiError } from "@/platform/api/errors";
import { useClassroom, useCurriculumTree } from "@/platform/v2/academic";
import { todayCivil } from "@/platform/v2/dates";
import { minutesToTime } from "@/platform/v2/dates";
import { useClassroomOptions, useStaffOptions } from "@/platform/v2/lookups";
import { useChangeOccurrenceRoom, useCreateOccurrence, useRescheduleOccurrence, useRooms, useSubstituteStaff, useSuggestSubstitutesAction, type OccurrenceDto } from "@/platform/v2/scheduling";
import type { OptionsResult } from "@/platform/ui/SelectAsync";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { ConflictPreviewPanel, useOverrideState } from "./ConflictPreview";
import { conflictsFromError, ConflictList } from "./OccurrenceCard";
import { SlotSuggester } from "./SlotSuggester";

const useStaffPick = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { status: "ACTIVE" });

/** Nœuds de programme (matières, cours) de la classe choisie : options du champ « Cours ». */
function flattenNodes(nodes: ReadonlyArray<{ id: string; code: string; label: string; subjectId: string | null; children?: ReadonlyArray<unknown> }>): SelectOption[] {
  const out: SelectOption[] = [];
  const visit = (list: ReadonlyArray<{ id: string; code: string; label: string; subjectId: string | null; children?: ReadonlyArray<unknown> }>) => {
    for (const n of list) {
      const kids = (n.children ?? []) as typeof list;
      if (n.subjectId !== null || kids.length === 0) out.push({ value: n.id, label: n.label, description: n.code });
      visit(kids);
    }
  };
  visit(nodes);
  return out;
}

function useNodeOptionsFor(classroomId: string | null) {
  const classroom = useClassroom(classroomId);
  const tree = useCurriculumTree(classroom.data?.curriculumVersionId ?? null);
  const all = flattenNodes((tree.data?.roots ?? []) as never);
  return (search: string, enabled: boolean): OptionsResult => {
    const q = search.trim().toLowerCase();
    return { options: enabled ? all.filter((o) => !q || `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q)) : [], isLoading: tree.isFetching };
  };
}

const ROLES = ["LEAD", "CO_TEACHER", "SUBSTITUTE", "SUPERVISOR"] as const;
type Role = (typeof ROLES)[number];

interface StaffRow {
  person: SelectOption | null;
  role: Role;
}

// ---------------------------------------------------------------------------------------------------------------
// Création d'une séance ponctuelle
// ---------------------------------------------------------------------------------------------------------------

export function OccurrenceFormDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string, warnings: SchedulingConflictViewDto[]) => void }) {
  const t = useTranslations("v2Schedule.form");
  const tKind = useTranslations("v2Schedule.kind");
  const tRole = useTranslations("v2Schedule.staffRole");
  const create = useCreateOccurrence();
  const rooms = useRooms({});
  const { override, setOverride, body: overrideBody, invalid } = useOverrideState();
  const [kind, setKind] = useState<(typeof SCHEDULING_OCCURRENCE_KINDS)[number]>("LESSON");
  const [title, setTitle] = useState("");
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [node, setNode] = useState<SelectOption | null>(null);
  const [roomId, setRoomId] = useState("");
  const [day, setDay] = useState(todayCivil());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [staff, setStaff] = useState<StaffRow[]>([{ person: null, role: "LEAD" }]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const useNodes = useNodeOptionsFor(classroom?.value ?? null);
  const staffIds = staff.map((s) => s.person?.value).filter((x): x is string => Boolean(x));

  const previewInput = {
    kind,
    classroomId: classroom?.value ?? null,
    roomId: roomId || null,
    staff: staff.filter((s) => s.person).map((s) => ({ staffId: s.person!.value, role: s.role })),
    date: day,
    startTime: start,
    endTime: end,
  };

  function submit() {
    const e: FieldErrors = {};
    if (!day) e.date = t("required");
    if (!start) e.startTime = t("required");
    if (!end) e.endTime = t("required");
    if (kind === "LESSON" && !classroom) e.classroomId = t("classroomRequired");
    if (invalid) e.override = t("overrideShort");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    create.mutate(
      {
        kind,
        date: day,
        startTime: start,
        endTime: end,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(classroom ? { classroomId: classroom.value } : {}),
        ...(node ? { curriculumNodeId: node.value } : {}),
        ...(roomId ? { roomId } : {}),
        ...(staff.some((s) => s.person) ? { staff: staff.filter((s) => s.person).map((s) => ({ staffId: s.person!.value, role: s.role })) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...overrideBody,
      },
      {
        onSuccess: (r) => {
          onClose();
          onDone(t("created"), r.warnings);
        },
      },
    );
  }

  const conflicts = conflictsFromError(create.error);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={conflicts.length > 0 ? undefined : create.error} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("kind")} required>
          {(c) => <NativeSelect {...c} value={kind} onChange={(v) => setKind(v as typeof kind)} options={SCHEDULING_OCCURRENCE_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
        </FormField>
        <FormField label={t("titleField")} error={apiErrors.title}>
          {(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={300} />}
        </FormField>
        <FormField label={t("classroom")} required={kind === "LESSON"} error={errors.classroomId ?? apiErrors.classroomId}>
          {(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); setNode(null); }} useOptions={useClassroomOptions} ariaLabel={t("classroom")} placeholder={t("chooseClassroom")} />}
        </FormField>
        <FormField label={t("node")} hint={classroom ? undefined : t("nodeHint")}>
          {(c) => <SelectAsync {...c} value={node} onChange={setNode} useOptions={useNodes} ariaLabel={t("node")} placeholder={t("chooseNode")} disabled={!classroom} />}
        </FormField>
        <FormField label={t("date")} required error={errors.date ?? apiErrors.date}>
          {(c) => <TextControl {...c} type="date" value={day} onChange={setDay} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("start")} required error={errors.startTime ?? apiErrors.startTime}>
            {(c) => <TextControl {...c} type="time" value={start} onChange={setStart} />}
          </FormField>
          <FormField label={t("end")} required error={errors.endTime ?? apiErrors.endTime}>
            {(c) => <TextControl {...c} type="time" value={end} onChange={setEnd} />}
          </FormField>
        </div>
        <FormField label={t("room")}>
          {(c) => <NativeSelect {...c} value={roomId} onChange={setRoomId} placeholder={t("noRoom")} options={(rooms.data ?? []).filter((r) => r.status === "AVAILABLE").map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("staff")}</legend>
        {staff.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
            <FormField label={t("staffMember", { n: i + 1 })}>
              {(c) => <SelectAsync {...c} value={row.person} onChange={(person) => setStaff((l) => l.map((x, j) => (j === i ? { ...x, person } : x)))} useOptions={useStaffPick} ariaLabel={t("staffMember", { n: i + 1 })} placeholder={t("chooseStaff")} />}
            </FormField>
            <FormField label={t("role")}>
              {(c) => <NativeSelect {...c} value={row.role} onChange={(v) => setStaff((l) => l.map((x, j) => (j === i ? { ...x, role: v as Role } : x)))} options={ROLES.map((r) => ({ value: r, label: tRole(r) }))} />}
            </FormField>
            {staff.length > 1 ? (
              <button type="button" className={buttonClass.ghost} aria-label={t("removeStaff", { n: i + 1 })} onClick={() => setStaff((l) => l.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className={buttonClass.ghost} onClick={() => setStaff((l) => [...l, { person: null, role: "CO_TEACHER" }])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> {t("addStaff")}
        </button>
      </fieldset>

      <FormField label={t("notes")}>{(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} maxLength={2000} />}</FormField>

      <ConflictPreviewPanel input={previewInput} override={override} onOverrideChange={setOverride} />
      {errors.override ? <p role="alert" className="text-xs font-medium text-destructive">{errors.override}</p> : null}
      {conflicts.length > 0 ? (
        <>
          <p role="alert" className="text-sm font-medium text-destructive">{create.error?.message}</p>
          <ConflictList conflicts={conflicts} />
        </>
      ) : null}

      <SlotSuggester
        staffIds={staffIds}
        classroomId={classroom?.value ?? null}
        roomId={roomId || null}
        onPick={(s) => {
          setDay(s.date);
          setStart(minutesToTime(s.startMinute));
          setEnd(minutesToTime(s.endMinute));
          if (s.roomId) setRoomId(s.roomId);
        }}
      />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Déplacer
// ---------------------------------------------------------------------------------------------------------------

export function RescheduleDialog({ o, onClose, onDone }: { o: OccurrenceDto; onClose: () => void; onDone: (message: string, warnings: SchedulingConflictViewDto[]) => void }) {
  const t = useTranslations("v2Schedule.reschedule");
  const reschedule = useRescheduleOccurrence();
  const { override, setOverride, body: overrideBody, invalid } = useOverrideState();
  const [day, setDay] = useState(o.occursOn);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const conflicts = conflictsFromError(reschedule.error);

  function submit() {
    if (!day || !start || !end) {
      setError(t("required"));
      return;
    }
    if (invalid) {
      setError(t("overrideShort"));
      return;
    }
    setError(null);
    reschedule.mutate(
      { id: o.id, date: day, startTime: start, endTime: end, ...(reason.trim() ? { reason: reason.trim() } : {}), ...overrideBody },
      {
        onSuccess: (r) => {
          onClose();
          onDone(t("done"), r.warnings);
        },
      },
    );
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={reschedule.isPending} error={conflicts.length > 0 ? undefined : reschedule.error}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("date")} required>
          {(c) => <TextControl {...c} type="date" value={day} onChange={setDay} />}
        </FormField>
        <FormField label={t("start")} required>
          {(c) => <TextControl {...c} type="time" value={start} onChange={setStart} />}
        </FormField>
        <FormField label={t("end")} required error={error}>
          {(c) => <TextControl {...c} type="time" value={end} onChange={setEnd} />}
        </FormField>
      </div>
      <FormField label={t("reason")}>{(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}</FormField>
      <ConflictPreviewPanel input={{ kind: o.kind, classroomId: o.classroomId, roomId: o.roomId, staff: o.staff.map((s) => ({ staffId: s.staffId, role: s.role })), date: day, startTime: start, endTime: end, excludeOccurrenceId: o.id }} override={override} onOverrideChange={setOverride} />
      {conflicts.length > 0 ? (
        <>
          <p role="alert" className="text-sm font-medium text-destructive">{reschedule.error?.message}</p>
          <ConflictList conflicts={conflicts} />
        </>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Changer de salle
// ---------------------------------------------------------------------------------------------------------------

export function RoomDialog({ o, onClose, onDone }: { o: OccurrenceDto; onClose: () => void; onDone: (message: string, warnings: SchedulingConflictViewDto[]) => void }) {
  const t = useTranslations("v2Schedule.room");
  const change = useChangeOccurrenceRoom();
  const rooms = useRooms({});
  const { override, setOverride, body: overrideBody, invalid } = useOverrideState();
  const [roomId, setRoomId] = useState(o.roomId ?? "");
  const [reason, setReason] = useState("");
  const conflicts = conflictsFromError(change.error);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={change.isPending}
      error={conflicts.length > 0 ? undefined : change.error}
      onSubmit={() => {
        if (invalid) return;
        change.mutate(
          { id: o.id, roomId: roomId || null, ...(reason.trim() ? { reason: reason.trim() } : {}), ...overrideBody },
          {
            onSuccess: (r) => {
              onClose();
              onDone(t("done"), r.warnings);
            },
          },
        );
      }}
    >
      <FormField label={t("room")}>
        {(c) => <NativeSelect {...c} value={roomId} onChange={setRoomId} placeholder={t("noRoom")} options={(rooms.data ?? []).filter((r) => r.status === "AVAILABLE" || r.id === o.roomId).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}
      </FormField>
      <FormField label={t("reason")}>{(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}</FormField>
      <ConflictPreviewPanel input={{ kind: o.kind, classroomId: o.classroomId, roomId: roomId || null, staff: o.staff.map((s) => ({ staffId: s.staffId, role: s.role })), startsAt: o.startsAt, endsAt: o.endsAt, excludeOccurrenceId: o.id }} override={override} onOverrideChange={setOverride} />
      {conflicts.length > 0 ? (
        <>
          <p role="alert" className="text-sm font-medium text-destructive">{change.error?.message}</p>
          <ConflictList conflicts={conflicts} />
        </>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Remplacer un intervenant
// ---------------------------------------------------------------------------------------------------------------

export function SubstituteDialog({ o, staffName, onClose, onDone }: { o: OccurrenceDto; staffName: (id: string) => string; onClose: () => void; onDone: (message: string, warnings: SchedulingConflictViewDto[]) => void }) {
  const t = useTranslations("v2Schedule.substitute");
  const format = useFormatter();
  const suggest = useSuggestSubstitutesAction();
  const substitute = useSubstituteStaff();
  const { override, setOverride, body: overrideBody, invalid } = useOverrideState();
  const original = o.staff.find((s) => s.role !== "SUBSTITUTE") ?? o.staff[0];
  const [originalId, setOriginalId] = useState(original?.staffId ?? "");
  const [pick, setPick] = useState<SelectOption | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const conflicts = conflictsFromError(substitute.error);
  const apiErrors = apiErrorToFieldErrors(substitute.error);

  function submit() {
    const e: FieldErrors = {};
    if (!originalId) e.originalStaffId = t("required");
    if (!pick) e.substituteStaffId = t("required");
    if (reason.trim().length < 3) e.reason = t("reasonShort");
    if (invalid) e.override = t("overrideShort");
    setErrors(e);
    if (Object.keys(e).length > 0 || !pick) return;
    substitute.mutate(
      { id: o.id, originalStaffId: originalId, substituteStaffId: pick.value, reason: reason.trim(), ...overrideBody },
      {
        onSuccess: (r) => {
          onClose();
          onDone(t("done"), r.warnings);
        },
      },
    );
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("title")} description={t("description", { time: format.dateTime(new Date(o.startsAt), { dateStyle: "medium", timeStyle: "short" }) })} submitLabel={t("submit")} onSubmit={submit} isPending={substitute.isPending} error={conflicts.length > 0 || Object.keys(apiErrors).length > 0 ? undefined : substitute.error} wide>
      <FormField label={t("original")} required error={errors.originalStaffId}>
        {(c) => <NativeSelect {...c} value={originalId} onChange={setOriginalId} placeholder={t("chooseOriginal")} options={o.staff.map((s) => ({ value: s.staffId, label: staffName(s.staffId) }))} />}
      </FormField>

      <section aria-labelledby="suggest-title" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="suggest-title" className="text-sm font-semibold">
            {t("suggestions")}
          </h3>
          <button type="button" className={buttonClass.secondary} disabled={suggest.isPending} onClick={() => suggest.mutate({ id: o.id, count: 10 })}>
            {suggest.isPending ? t("searching") : t("suggest")}
          </button>
        </div>
        {suggest.isError ? <Notice kind="error">{suggest.error.message}</Notice> : null}
        {suggest.data ? (
          suggest.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSuggestions")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {suggest.data.items.map((s) => (
                <li key={s.staffId} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{s.displayName ?? staffName(s.staffId)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge label={s.eligible ? t("eligible") : t("notEligible")} tone={s.eligible ? "success" : "warning"} />
                      {s.competent === true ? <StatusBadge label={t("competent")} tone="info" /> : null}
                      <StatusBadge label={t("load", { hours: format.number(s.weeklyLoadMinutes / 60, { maximumFractionDigits: 1 }) })} tone="neutral" />
                      {s.reasons.map((r) => (
                        <StatusBadge key={r} label={r} tone="warning" />
                      ))}
                    </div>
                  </div>
                  <button type="button" className={buttonClass.secondary} onClick={() => setPick({ value: s.staffId, label: s.displayName ?? staffName(s.staffId) })}>
                    {t("choose")}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <FormField label={t("substitute")} required error={errors.substituteStaffId ?? apiErrors.substituteStaffId}>
        {(c) => <SelectAsync {...c} value={pick} onChange={setPick} useOptions={useStaffPick} ariaLabel={t("substitute")} placeholder={t("chooseSubstitute")} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason ?? apiErrors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
      {pick ? <ConflictPreviewPanel input={{ kind: o.kind, classroomId: o.classroomId, roomId: o.roomId, staff: [{ staffId: pick.value, role: "SUBSTITUTE" }], startsAt: o.startsAt, endsAt: o.endsAt, excludeOccurrenceId: o.id }} override={override} onOverrideChange={setOverride} /> : null}
      {errors.override ? <p role="alert" className="text-xs font-medium text-destructive">{errors.override}</p> : null}
      {conflicts.length > 0 ? (
        <>
          <p role="alert" className="text-sm font-medium text-destructive">{substitute.error instanceof ApiError ? substitute.error.message : ""}</p>
          <ConflictList conflicts={conflicts} />
        </>
      ) : null}
    </FormDialog>
  );
}
