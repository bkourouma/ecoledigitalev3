"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PEOPLE_ASSIGNMENT_ROLES, peopleCreateAssignmentBodySchema, type PeopleAssignmentDto, type PeopleAssignmentRole } from "@ecoledigitale/contracts/v2/people";
import type { AcademicEnrollmentNodeView } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears, useClassroom, useClassroomNodes, useYearPeriods } from "@/platform/v2/academic";
import { useClassroomOptions, useStaffOptions } from "@/platform/v2/lookups";
import { useClassroomAssignments, useCreateAssignment, useEndAssignment, useReplaceAssignment, useUnstaffedNodes } from "@/platform/v2/people";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadTab } from "./StaffTabs";

const today = () => new Date().toISOString().slice(0, 10);
const useTeachingStaffOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { canTeach: true, status: "ACTIVE" });

export function AssignmentsScreen({ initialClassroomId }: { initialClassroomId?: string }) {
  const t = useTranslations("v2Staff.assignments");
  const [staff, setStaff] = useState<SelectOption | null>(null);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="classroom">
        <TabsList>
          <TabsTrigger value="classroom">{t("tabs.classroom")}</TabsTrigger>
          <TabsTrigger value="teacher">{t("tabs.teacher")}</TabsTrigger>
        </TabsList>
        <TabsContent value="classroom">
          <ByClassroom initialClassroomId={initialClassroomId} />
        </TabsContent>
        <TabsContent value="teacher">
          <div className="mb-4 max-w-xl">
            <FormField label={t("teacher")}>
              {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeachingStaffOptions} placeholder={t("teacherPlaceholder")} ariaLabel={t("teacher")} />}
            </FormField>
          </div>
          {staff ? <LoadTab staffId={staff.value} /> : <EmptyBlock title={t("pickTeacher")} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ByClassroom({ initialClassroomId }: { initialClassroomId?: string }) {
  const t = useTranslations("v2Staff.assignments");
  const years = useAcademicYears();
  const [yearId, setYearId] = useState("");
  const [classroom, setClassroom] = useState<SelectOption | null>(initialClassroomId ? { value: initialClassroomId, label: initialClassroomId } : null);
  const useClassOptions = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: yearId || undefined });

  useEffect(() => {
    if (yearId || !years.data || initialClassroomId) return;
    const current = years.data.find((y) => y.isCurrent) ?? years.data.find((y) => y.status === "OPEN");
    if (current) setYearId(current.id);
  }, [years.data, yearId, initialClassroomId]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("year")}>
          {(c) => <NativeSelect {...c} value={yearId} onChange={(v) => { setYearId(v); setClassroom(null); }} placeholder={t("allYears")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("classroom")} required>
          {(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassOptions} placeholder={t("classroomPlaceholder")} ariaLabel={t("classroom")} />}
        </FormField>
      </div>
      {classroom ? <Matrix classroomId={classroom.value} /> : <EmptyBlock title={t("pickClassroom")} />}
    </div>
  );
}

type DialogState = { kind: "assign"; node: AcademicEnrollmentNodeView | null; role: PeopleAssignmentRole } | { kind: "replace"; assignment: PeopleAssignmentDto } | { kind: "end"; assignment: PeopleAssignmentDto } | null;

function Matrix({ classroomId }: { classroomId: string }) {
  const t = useTranslations("v2Staff.assignments");
  const tRoles = useTranslations("v2Staff.roles");
  const classroom = useClassroom(classroomId);
  const nodes = useClassroomNodes(classroomId);
  const assignments = useClassroomAssignments(classroomId);
  const yearId = classroom.data?.academicYearId ?? null;
  const unstaffed = useUnstaffedNodes({ yearId, classroomId });
  const periods = useYearPeriods(yearId);
  const flash = useFlash();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);

  const active = useMemo(() => (assignments.data ?? []).filter((a) => a.status === "ACTIVE"), [assignments.data]);
  const periodLabel = (id: string | null) => (id ? ((periods.data ?? []).find((p) => p.id === id)?.label ?? null) : null);
  // Lignes : les matières (nœuds rattachés à une matière) ; à défaut, tous les nœuds du curriculum de la classe.
  const rows = useMemo(() => {
    const all = nodes.data ?? [];
    const withSubject = all.filter((n) => n.subjectId !== null);
    return (withSubject.length > 0 ? withSubject : all).sort((a, b) => a.code.localeCompare(b.code));
  }, [nodes.data]);
  const unstaffedIds = useMemo(() => new Set((unstaffed.data ?? []).map((u) => u.curriculumNodeId)), [unstaffed.data]);
  const homeroom = active.filter((a) => a.roleCode === "HOMEROOM");
  const generalists = active.filter((a) => a.coversAllSubjects);

  if ((classroom.isPending && classroom.fetchStatus !== "idle") || (assignments.isPending && assignments.fetchStatus !== "idle")) return <LoadingBlock />;
  if (classroom.isError) return <ErrorBlock error={classroom.error} onRetry={() => void classroom.refetch()} />;
  if (assignments.isError) return <ErrorBlock error={assignments.error} onRetry={() => void assignments.refetch()} />;

  const forNode = (nodeId: string, role: PeopleAssignmentRole) => active.filter((a) => a.curriculumNodeId === nodeId && a.roleCode === role);

  const renderChips = (items: PeopleAssignmentDto[]) => (
      <ul className="flex flex-wrap gap-1">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs">
            <span className="font-medium">{a.staffDisplayName ?? a.staffId.slice(0, 8)}</span>
            {periodLabel(a.periodId) ? <span className="text-muted-foreground">· {periodLabel(a.periodId)}</span> : null}
            <Can permission="teaching.assign">
              <button type="button" className="rounded px-1 underline-offset-2 hover:underline" onClick={() => setDialog({ kind: "replace", assignment: a })} aria-label={`${t("replace")} — ${a.staffDisplayName ?? ""}`}>
                {t("replace")}
              </button>
              <button type="button" className="rounded px-1 text-destructive underline-offset-2 hover:underline" onClick={() => setDialog({ kind: "end", assignment: a })} aria-label={`${t("end")} — ${a.staffDisplayName ?? ""}`}>
                {t("end")}
              </button>
            </Can>
          </li>
        ))}
      </ul>
  );

  return (
    <section aria-labelledby="matrix-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="matrix-title" className="text-lg font-semibold">
          {t("matrixTitle", { name: classroom.data?.name ?? "" })}
        </h2>
        {unstaffed.data ? <StatusBadge label={unstaffed.data.length === 0 ? t("allStaffed") : t("unstaffedCount", { count: unstaffed.data.length })} tone={unstaffed.data.length === 0 ? "success" : "warning"} /> : null}
      </div>
      {flash.node}
      {warnings.length > 0 ? (
        <Notice kind="warning">
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {unstaffed.isError ? <Notice kind="info">{t("unstaffedUnavailable")}</Notice> : null}
      {nodes.isError ? <ErrorBlock error={nodes.error} /> : null}

      <div role="region" aria-label={t("matrixCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">{t("matrixCaption")}</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("columns.subject")}
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tRoles("LEAD")}
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tRoles("CO_TEACHER")}
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tRoles("SUBSTITUTE")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-muted/20">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {tRoles("HOMEROOM")}
              </th>
              <td className="px-3 py-2" colSpan={2}>
                {homeroom.length === 0 ? <span className="text-muted-foreground">{t("none")}</span> : renderChips(homeroom)}
              </td>
              <td className="px-3 py-2">
                <Can permission="teaching.assign">
                  <button type="button" className={buttonClass.ghost} onClick={() => setDialog({ kind: "assign", node: null, role: "HOMEROOM" })}>
                    {t("assignHomeroom")}
                  </button>
                </Can>
              </td>
            </tr>
            {generalists.length > 0 ? (
              <tr className="border-t bg-muted/20">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {t("generalist")}
                </th>
                <td className="px-3 py-2" colSpan={3}>
                  {renderChips(generalists)}
                </td>
              </tr>
            ) : null}
            {nodes.isPending && nodes.fetchStatus !== "idle" ? (
              <tr>
                <td colSpan={4}>
                  <LoadingBlock />
                </td>
              </tr>
            ) : null}
            {rows.map((n) => {
              const lead = forNode(n.nodeId, "LEAD");
              const missing = unstaffedIds.has(n.nodeId) && lead.length === 0 && generalists.length === 0;
              return (
                <tr key={n.nodeId} className="border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <span>{n.label}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{n.code}</span>
                    {missing ? <StatusBadge label={t("noLead")} tone="warning" className="mt-1" /> : null}
                  </th>
                  <td className="px-3 py-2">
                    {renderChips(lead)}
                    <Can permission="teaching.assign">
                      <button type="button" className={buttonClass.ghost} onClick={() => setDialog({ kind: "assign", node: n, role: "LEAD" })} aria-label={`${t("assign")} — ${n.label}`}>
                        {t("assign")}
                      </button>
                    </Can>
                  </td>
                  <td className="px-3 py-2">
                    {renderChips(forNode(n.nodeId, "CO_TEACHER"))}
                    <Can permission="teaching.assign">
                      <button type="button" className={buttonClass.ghost} onClick={() => setDialog({ kind: "assign", node: n, role: "CO_TEACHER" })} aria-label={`${t("addCo")} — ${n.label}`}>
                        {t("addCo")}
                      </button>
                    </Can>
                  </td>
                  <td className="px-3 py-2">
                    {renderChips(forNode(n.nodeId, "SUBSTITUTE"))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {nodes.data && rows.length === 0 ? <EmptyBlock title={t("noSubjects")} description={t("noSubjectsHint")} /> : null}

      {dialog?.kind === "assign" && classroom.data ? (
        <AssignDialog
          classroomId={classroomId}
          yearId={classroom.data.academicYearId}
          node={dialog.node}
          role={dialog.role}
          periods={periods.data ?? []}
          onClose={() => setDialog(null)}
          onDone={(w) => {
            setWarnings(w);
            flash.show(t("assigned"));
          }}
        />
      ) : null}
      {dialog?.kind === "replace" ? <ReplaceDialog assignment={dialog.assignment} onClose={() => setDialog(null)} onDone={() => flash.show(t("replaced"))} /> : null}
      {dialog?.kind === "end" ? <EndDialog assignment={dialog.assignment} onClose={() => setDialog(null)} onDone={() => flash.show(t("ended"))} /> : null}
    </section>
  );
}

function AssignDialog({
  classroomId,
  yearId,
  node,
  role: initialRole,
  periods,
  onClose,
  onDone,
}: {
  classroomId: string;
  yearId: string;
  node: AcademicEnrollmentNodeView | null;
  role: PeopleAssignmentRole;
  periods: ReadonlyArray<{ id: string; label: string }>;
  onClose: () => void;
  onDone: (warnings: Array<{ code: string; message: string }>) => void;
}) {
  const t = useTranslations("v2Staff.assignments");
  const tRoles = useTranslations("v2Staff.roles");
  const create = useCreateAssignment();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [form, setForm] = useState({ roleCode: initialRole as string, periodId: "", plannedHours: "", startsOn: today(), endsOn: "", note: "", coversAllSubjects: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, unknown> = { staffId: staff?.value ?? "", academicYearId: yearId, classroomId, roleCode: form.roleCode, startsOn: form.startsOn };
    if (node) body.curriculumNodeId = node.nodeId;
    if (form.periodId) body.periodId = form.periodId;
    if (form.plannedHours.trim()) body.plannedHours = Number(form.plannedHours.replace(",", "."));
    if (form.endsOn) body.endsOn = form.endsOn;
    if (form.note.trim()) body.note = form.note.trim();
    if (form.coversAllSubjects && !node) body.coversAllSubjects = true;
    const v = validateWith(peopleCreateAssignmentBodySchema, body);
    const local: FieldErrors = v.ok ? {} : v.errors;
    if (!staff) local.staffId = t("staffRequired");
    setErrors(local);
    if (!v.ok || !staff) return;
    try {
      const result = await create.mutateAsync(v.data);
      onDone(result.warnings);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={node ? t("assignTitle", { subject: node.label }) : t("assignHomeroomTitle")} description={t("assignDescription")} submitLabel={t("assign")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error} wide>
      <FormField label={t("staff")} required error={errors.staffId}>
        {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeachingStaffOptions} placeholder={t("staffPlaceholder")} ariaLabel={t("staff")} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("role")} required error={errors.roleCode}>
          {(c) => <NativeSelect {...c} value={form.roleCode} onChange={set("roleCode")} options={PEOPLE_ASSIGNMENT_ROLES.map((r) => ({ value: r, label: tRoles(r) }))} />}
        </FormField>
        <FormField label={t("period")} hint={t("periodHint")} error={errors.periodId}>
          {(c) => <NativeSelect {...c} value={form.periodId} onChange={set("periodId")} placeholder={t("wholeYear")} options={periods.map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("endsOn")} error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
        <FormField label={t("plannedHours")} error={errors.plannedHours}>
          {(c) => <TextControl {...c} inputMode="decimal" value={form.plannedHours} onChange={set("plannedHours")} />}
        </FormField>
      </div>
      {!node && form.roleCode === "LEAD" ? <CheckControl checked={form.coversAllSubjects} onChange={set("coversAllSubjects")} label={t("coversAll")} hint={t("coversAllHint")} /> : null}
      <FormField label={t("note")} error={errors.note}>
        {(c) => <TextControl {...c} value={form.note} onChange={set("note")} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}

function ReplaceDialog({ assignment, onClose, onDone }: { assignment: PeopleAssignmentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.assignments");
  const replace = useReplaceAssignment();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const e: FieldErrors = {};
    if (!staff) e.newStaffId = t("staffRequired");
    else if (staff.value === assignment.staffId) e.newStaffId = t("sameStaff");
    if (!effectiveOn) e.effectiveOn = t("dateRequired");
    if (reason.trim().length === 0) e.reason = t("reasonRequired");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      await replace.mutateAsync({ id: assignment.id, newStaffId: staff!.value, effectiveOn, reason: reason.trim() });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("replaceTitle", { name: assignment.staffDisplayName ?? "" })} description={t("replaceDescription")} submitLabel={t("replace")} onSubmit={() => void submit()} isPending={replace.isPending} error={replace.error}>
      <FormField label={t("newStaff")} required error={errors.newStaffId}>
        {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeachingStaffOptions} placeholder={t("staffPlaceholder")} ariaLabel={t("newStaff")} />}
      </FormField>
      <FormField label={t("effectiveOn")} required error={errors.effectiveOn}>
        {(c) => <TextControl {...c} type="date" value={effectiveOn} onChange={setEffectiveOn} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason}>
        {(c) => <TextControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

function EndDialog({ assignment, onClose, onDone }: { assignment: PeopleAssignmentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.assignments");
  const end = useEndAssignment();
  const [endsOn, setEndsOn] = useState(today());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    try {
      await end.mutateAsync({ id: assignment.id, endsOn: endsOn || undefined, reason: reason.trim() || undefined });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("endTitle", { name: assignment.staffDisplayName ?? "" })} description={t("endDescription")} submitLabel={t("end")} onSubmit={() => void submit()} isPending={end.isPending} error={end.error}>
      <FormField label={t("endsOn")} error={errors.endsOn}>
        {(c) => <TextControl {...c} type="date" value={endsOn} onChange={setEndsOn} />}
      </FormField>
      <FormField label={t("reasonOptional")} error={errors.reason}>
        {(c) => <TextControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}
