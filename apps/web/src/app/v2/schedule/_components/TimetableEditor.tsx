"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { schedulingEntryBodySchema, type SchedulingConflictViewDto, type schedulingEntryDtoSchema, type schedulingGenerationReportDtoSchema } from "@ecoledigitale/contracts/v2/scheduling";
import { useFeature, usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import { useClassroom, useCurriculumTree } from "@/platform/v2/academic";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory, useRoomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { useClassroomOptions, useStaffOptions } from "@/platform/v2/lookups";
import {
  useCreateTimetableEntry,
  useGenerateOccurrences,
  usePublishTimetable,
  useRemoveTimetableEntry,
  useRooms,
  useTimetable,
  useTimetableConflicts,
  useUpdateTimetableEntry,
  type TimetableEntryBody,
} from "@/platform/v2/scheduling";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type OptionsResult, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ConflictList, conflictsFromError } from "./OccurrenceCard";
import { timetableTone } from "./TimetablesScreen";

type Entry = z.infer<typeof schedulingEntryDtoSchema>;
type Report = z.infer<typeof schedulingGenerationReportDtoSchema>;
type EntryRole = "LEAD" | "CO_TEACHER" | "SUPERVISOR";
const ENTRY_ROLES: EntryRole[] = ["LEAD", "CO_TEACHER", "SUPERVISOR"];
const ENTRY_KINDS = ["LESSON", "EXAM", "MEETING", "EVENT", "OTHER"] as const;
const useStaffPick = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { status: "ACTIVE" });

/** Éditeur de patrons récurrents d'un emploi du temps : créneaux par jour, alternance A/B, conflits, publication, génération. */
export function TimetableEditor({ id }: { id: string }) {
  const t = useTranslations("v2Schedule.editor");
  const tDay = useTranslations("v2Schedule.weekdayLong");
  const tKind = useTranslations("v2Schedule.kind");
  const date = useDateFormat();
  const flash = useFlash();
  const manage = usePermission("schedule.manage").allowed;
  const generationFeature = useFeature("scheduling.generation");
  const q = useTimetable(id);
  const conflicts = useTimetableConflicts(id);
  const publish = usePublishTimetable("publish");
  const archive = usePublishTimetable("archive");
  const remove = useRemoveTimetableEntry();
  const dirs = { classrooms: useClassroomDirectory(), staff: useStaffDirectory(), rooms: useRoomDirectory() };
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [entryWarnings, setEntryWarnings] = useState<SchedulingConflictViewDto[]>([]);

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const { timetable, entries } = q.data;
  const draft = timetable.status === "DRAFT";
  const byDay = new Map<number, Entry[]>();
  for (const e of [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime))) byDay.set(e.weekday, [...(byDay.get(e.weekday) ?? []), e]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={timetable.name}
        description={t("subtitle", { from: date.civil(timetable.validFrom), to: date.civil(timetable.validTo) })}
        actions={
          <>
            <Link href="/v2/schedule/timetables" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <StatusBadge label={t(`status.${timetable.status}`)} tone={timetableTone(timetable.status)} className="self-center" />
            {manage && draft ? (
              <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
                {t("addEntry")}
              </button>
            ) : null}
            <Can permission="schedule.publish">
              {draft ? (
                <button type="button" className={buttonClass.secondary} disabled={publish.isPending} onClick={() => publish.mutate({ id }, { onSuccess: () => flash.show(t("published")) })}>
                  {t("publish")}
                </button>
              ) : null}
              {timetable.status === "PUBLISHED" ? (
                <button type="button" className={buttonClass.secondary} disabled={archive.isPending} onClick={() => archive.mutate({ id }, { onSuccess: () => flash.show(t("archived")) })}>
                  {t("archive")}
                </button>
              ) : null}
            </Can>
            {manage && generationFeature.allowed && timetable.status === "PUBLISHED" ? (
              <button type="button" className={buttonClass.secondary} onClick={() => setGenerating(true)}>
                {t("generate")}
              </button>
            ) : null}
          </>
        }
      />
      {flash.node}
      {publish.error ? <Notice kind="error">{publish.error.message}</Notice> : null}
      {archive.error ? <Notice kind="error">{archive.error.message}</Notice> : null}
      {remove.error ? <Notice kind="error">{remove.error.message}</Notice> : null}
      {!draft ? <Notice kind="info">{t("readOnly")}</Notice> : null}
      {entryWarnings.length > 0 ? <ConflictList conflicts={entryWarnings} title={t("warningsTitle")} /> : null}
      {report ? <GenerationReport report={report} onClose={() => setReport(null)} /> : null}

      <section aria-labelledby="patterns-title" className="space-y-3">
        <h2 id="patterns-title" className="text-lg font-semibold">
          {t("patterns")}
        </h2>
        {entries.length === 0 ? (
          <EmptyBlock title={t("emptyEntries")} description={t("emptyEntriesHint")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7]
              .filter((d) => byDay.has(d))
              .map((d) => (
                <section key={d} aria-labelledby={`wd-${d}`} className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-2">
                  <h3 id={`wd-${d}`} className="text-sm font-semibold">
                    {tDay(String(d))}
                  </h3>
                  <ul className="space-y-2">
                    {(byDay.get(d) ?? []).map((e) => (
                      <li key={e.id} className="space-y-1 rounded-xl border border-white/10 bg-card p-2 text-sm">
                        <p className="font-semibold tabular-nums">
                          {e.startTime} – {e.endTime}
                        </p>
                        <p className="font-medium">{e.title ?? tKind(e.kind)}</p>
                        <p className="text-muted-foreground">{[e.classroomId ? dirs.classrooms.find(e.classroomId) : null, e.roomId ? dirs.rooms.find(e.roomId) : null].filter(Boolean).join(" · ")}</p>
                        <p className="text-muted-foreground">{e.staff.map((s) => dirs.staff.find(s.staffId)).filter(Boolean).join(", ")}</p>
                        <div className="flex flex-wrap gap-1">
                          {e.weekPattern !== "EVERY" ? <StatusBadge label={t(`pattern.${e.weekPattern}`)} tone="info" /> : null}
                          {e.validFrom || e.validTo ? <StatusBadge label={t("bounded")} tone="neutral" /> : null}
                        </div>
                        {manage && draft ? (
                          <div className="flex gap-1 pt-1">
                            <button type="button" className={buttonClass.ghost} onClick={() => setEditing(e)}>
                              {t("edit")}
                            </button>
                            <button type="button" className={buttonClass.ghost} aria-label={t("removeEntry", { time: e.startTime })} disabled={remove.isPending} onClick={() => remove.mutate({ timetableId: id, entryId: e.id }, { onSuccess: () => flash.show(t("removed")) })}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </section>

      <section aria-labelledby="draft-conflicts" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="draft-conflicts" className="text-lg font-semibold">
            {t("conflictsTitle")}
          </h2>
          <button type="button" className={buttonClass.secondary} onClick={() => void conflicts.refetch()} disabled={conflicts.isFetching}>
            {t("refreshConflicts")}
          </button>
        </div>
        {conflicts.isPending ? <LoadingBlock /> : conflicts.isError ? <ErrorBlock error={conflicts.error} onRetry={() => void conflicts.refetch()} /> : conflicts.data.length === 0 ? <p className="text-sm text-emerald-300">{t("noConflicts")}</p> : <ConflictList conflicts={conflicts.data} />}
      </section>

      {editing ? (
        <EntryDialog
          timetableId={id}
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(message, warnings) => {
            flash.show(message);
            setEntryWarnings(warnings);
            void conflicts.refetch();
          }}
        />
      ) : null}
      {generating ? <GenerateDialog id={id} defaultFrom={timetable.validFrom > todayCivil() ? timetable.validFrom : todayCivil()} defaultTo={addDays(todayCivil(), 28)} onClose={() => setGenerating(false)} onDone={(r) => setReport(r)} /> : null}
    </div>
  );
}

function GenerationReport({ report, onClose }: { report: Report; onClose: () => void }) {
  const t = useTranslations("v2Schedule.editor.report");
  const date = useDateFormat();
  return (
    <section aria-labelledby="report-title" className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 id="report-title" className="text-lg font-semibold">
          {t("title", { from: date.civil(report.from), to: date.civil(report.to) })}
        </h2>
        <button type="button" className={buttonClass.ghost} onClick={onClose}>
          {t("close")}
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["created", report.created],
            ["skippedExisting", report.skippedExisting],
            ["skippedBlocked", report.skippedBlocked],
            ["skippedConflict", report.skippedConflict],
            ["skippedCapped", report.skippedCapped],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
            <dt className="text-xs text-muted-foreground">{t(k)}</dt>
            <dd className="text-xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {report.conflicts.length > 0 ? (
        <div role="status" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-amber-200">
          <p className="font-medium">{t("conflicts", { count: report.conflicts.length })}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.conflicts.slice(0, 30).map((c, i) => (
              <li key={i}>
                {date.civil(c.date)} : {c.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {report.warnings.slice(0, 30).map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function GenerateDialog({ id, defaultFrom, defaultTo, onClose, onDone }: { id: string; defaultFrom: string; defaultTo: string; onClose: () => void; onDone: (r: Report) => void }) {
  const t = useTranslations("v2Schedule.editor.generateDialog");
  const generate = useGenerateOccurrences();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [cap, setCap] = useState(false);
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          generate.mutate(
            { id, from, to, ...(cap ? { capByNodeHours: true } : {}) },
            {
              onSuccess: (r) => {
                onClose();
                onDone(r);
              },
            },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("from")} required>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
          <FormField label={t("to")} required>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={cap} onChange={(e) => setCap(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            {t("cap")}
            <span className="block text-xs text-muted-foreground">{t("capHint")}</span>
          </span>
        </label>
        {generate.error ? <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{generate.error.message}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className={buttonClass.primary} disabled={generate.isPending}>
            {generate.isPending ? t("running") : t("run")}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Créneau récurrent
// ---------------------------------------------------------------------------------------------------------------

interface StaffRow {
  person: SelectOption | null;
  role: EntryRole;
}

function flatten(nodes: ReadonlyArray<{ id: string; code: string; label: string; subjectId: string | null; children?: ReadonlyArray<unknown> }>): SelectOption[] {
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

function EntryDialog({ timetableId, entry, onClose, onDone }: { timetableId: string; entry: Entry | null; onClose: () => void; onDone: (message: string, warnings: SchedulingConflictViewDto[]) => void }) {
  const t = useTranslations("v2Schedule.entry");
  const tDay = useTranslations("v2Schedule.weekdayLong");
  const tKind = useTranslations("v2Schedule.kind");
  const tRole = useTranslations("v2Schedule.staffRole");
  const create = useCreateTimetableEntry();
  const update = useUpdateTimetableEntry();
  const rooms = useRooms({});
  const classrooms = useClassroomDirectory();
  const staffDir = useStaffDirectory();
  const canOverride = usePermission("schedule.conflict.override").allowed;
  const [kind, setKind] = useState<(typeof ENTRY_KINDS)[number]>(entry?.kind ?? "LESSON");
  const [classroom, setClassroom] = useState<SelectOption | null>(entry?.classroomId ? { value: entry.classroomId, label: classrooms.name(entry.classroomId) } : null);
  const [node, setNode] = useState<SelectOption | null>(entry?.curriculumNodeId ? { value: entry.curriculumNodeId, label: entry.curriculumNodeId } : null);
  const [weekday, setWeekday] = useState(String(entry?.weekday ?? 1));
  const [start, setStart] = useState(entry?.startTime ?? "");
  const [end, setEnd] = useState(entry?.endTime ?? "");
  const [roomId, setRoomId] = useState(entry?.roomId ?? "");
  const [pattern, setPattern] = useState<string>(entry?.weekPattern ?? "EVERY");
  const [validFrom, setValidFrom] = useState(entry?.validFrom ?? "");
  const [validTo, setValidTo] = useState(entry?.validTo ?? "");
  const [delivery, setDelivery] = useState<string>(entry?.deliveryMode ?? "IN_PERSON");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [staff, setStaff] = useState<StaffRow[]>(entry && entry.staff.length > 0 ? entry.staff.map((s) => ({ person: { value: s.staffId, label: staffDir.name(s.staffId) }, role: s.role })) : [{ person: null, role: "LEAD" }]);
  const [propagate, setPropagate] = useState("NONE");
  const [overrideReason, setOverrideReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const classroomQuery = useClassroom(classroom?.value ?? null);
  const tree = useCurriculumTree(classroomQuery.data?.curriculumVersionId ?? null);
  const nodeOptions = flatten((tree.data?.roots ?? []) as never);
  const useNodes = (search: string, enabled: boolean): OptionsResult => {
    const s = search.trim().toLowerCase();
    return { options: enabled ? nodeOptions.filter((o) => !s || `${o.label} ${o.description ?? ""}`.toLowerCase().includes(s)) : [], isLoading: tree.isFetching };
  };
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const conflicts = conflictsFromError(error);
  const apiErrors = apiErrorToFieldErrors(error);

  function submit() {
    const body: TimetableEntryBody = {
      kind,
      weekday: Number(weekday),
      startTime: start,
      endTime: end,
      weekPattern: pattern as "EVERY" | "WEEK_A" | "WEEK_B",
      deliveryMode: delivery as "IN_PERSON" | "ONLINE" | "HYBRID",
      classroomId: classroom?.value ?? null,
      curriculumNodeId: node?.value ?? null,
      roomId: roomId || null,
      validFrom: validFrom || null,
      validTo: validTo || null,
      title: title.trim() || null,
      staff: staff.filter((s) => s.person).map((s) => ({ staffId: s.person!.value, role: s.role })),
      ...(entry ? { propagate: propagate as "NONE" | "FUTURE_PLANNED" } : {}),
      ...(overrideReason.trim().length >= 5 ? { overrideReason: overrideReason.trim() } : {}),
    };
    const v = validateWith(schedulingEntryBodySchema, body);
    const e: FieldErrors = v.ok ? {} : v.errors;
    if (kind === "LESSON" && !classroom) e.classroomId = t("classroomRequired");
    if (overrideReason.trim().length > 0 && overrideReason.trim().length < 5) e.overrideReason = t("overrideShort");
    setErrors(e);
    if (!v.ok || Object.keys(e).length > 0) return;
    const done = (r: { warnings: SchedulingConflictViewDto[] }) => {
      onClose();
      onDone(entry ? t("updated") : t("created"), r.warnings);
    };
    if (entry) update.mutate({ timetableId, entryId: entry.id, entry: body }, { onSuccess: done });
    else create.mutate({ timetableId, entry: body }, { onSuccess: done });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={entry ? t("editTitle") : t("addTitle")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={pending} error={conflicts.length > 0 || Object.keys(apiErrors).length > 0 ? undefined : error} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("kind")} required>{(c) => <NativeSelect {...c} value={kind} onChange={(v) => setKind(v as typeof kind)} options={ENTRY_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}</FormField>
        <FormField label={t("titleField")}>{(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={300} />}</FormField>
        <FormField label={t("classroom")} required={kind === "LESSON"} error={errors.classroomId ?? apiErrors.classroomId}>
          {(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); setNode(null); }} useOptions={useClassroomOptions} ariaLabel={t("classroom")} placeholder={t("chooseClassroom")} />}
        </FormField>
        <FormField label={t("node")} hint={classroom ? undefined : t("nodeHint")}>
          {(c) => <SelectAsync {...c} value={node} onChange={setNode} useOptions={useNodes} ariaLabel={t("node")} placeholder={t("chooseNode")} disabled={!classroom} />}
        </FormField>
        <FormField label={t("weekday")} required error={errors.weekday ?? apiErrors.weekday}>
          {(c) => <NativeSelect {...c} value={weekday} onChange={setWeekday} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: tDay(String(d)) }))} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("start")} required error={errors.startTime ?? apiErrors.startTime}>{(c) => <TextControl {...c} type="time" value={start} onChange={setStart} />}</FormField>
          <FormField label={t("end")} required error={errors.endTime ?? apiErrors.endTime}>{(c) => <TextControl {...c} type="time" value={end} onChange={setEnd} />}</FormField>
        </div>
        <FormField label={t("room")}>
          {(c) => <NativeSelect {...c} value={roomId} onChange={setRoomId} placeholder={t("noRoom")} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}
        </FormField>
        <FormField label={t("pattern")} hint={t("patternHint")}>
          {(c) => <NativeSelect {...c} value={pattern} onChange={setPattern} options={(["EVERY", "WEEK_A", "WEEK_B"] as const).map((p) => ({ value: p, label: t(`patterns.${p}`) }))} />}
        </FormField>
        <FormField label={t("validFrom")} error={errors.validFrom ?? apiErrors.validFrom}>{(c) => <TextControl {...c} type="date" value={validFrom} onChange={setValidFrom} />}</FormField>
        <FormField label={t("validTo")} error={errors.validTo ?? apiErrors.validTo}>{(c) => <TextControl {...c} type="date" value={validTo} onChange={setValidTo} />}</FormField>
        <FormField label={t("delivery")}>
          {(c) => <NativeSelect {...c} value={delivery} onChange={setDelivery} options={(["IN_PERSON", "ONLINE", "HYBRID"] as const).map((d) => ({ value: d, label: t(`deliveryModes.${d}`) }))} />}
        </FormField>
        {entry ? (
          <FormField label={t("propagate")} hint={t("propagateHint")}>
            {(c) => <NativeSelect {...c} value={propagate} onChange={setPropagate} options={(["NONE", "FUTURE_PLANNED"] as const).map((p) => ({ value: p, label: t(`propagation.${p}`) }))} />}
          </FormField>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("staff")}</legend>
        {staff.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
            <FormField label={t("staffMember", { n: i + 1 })}>
              {(c) => <SelectAsync {...c} value={row.person} onChange={(person) => setStaff((l) => l.map((x, j) => (j === i ? { ...x, person } : x)))} useOptions={useStaffPick} ariaLabel={t("staffMember", { n: i + 1 })} placeholder={t("chooseStaff")} />}
            </FormField>
            <FormField label={t("role")}>
              {(c) => <NativeSelect {...c} value={row.role} onChange={(v) => setStaff((l) => l.map((x, j) => (j === i ? { ...x, role: v as EntryRole } : x)))} options={ENTRY_ROLES.map((r) => ({ value: r, label: tRole(r) }))} />}
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

      {conflicts.length > 0 ? (
        <>
          <p role="alert" className="text-sm font-medium text-destructive">{error instanceof ApiError ? error.message : ""}</p>
          <ConflictList conflicts={conflicts} />
          {canOverride ? (
            <FormField label={t("overrideReason")} hint={t("overrideHint")} error={errors.overrideReason}>
              {(c) => <TextAreaControl {...c} value={overrideReason} onChange={setOverrideReason} maxLength={500} />}
            </FormField>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noOverride")}</p>
          )}
        </>
      ) : null}
    </FormDialog>
  );
}
