"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ACADEMIC_CLASSROOM_STATUSES, academicCreateClassroomBodySchema, type AcademicClassroomDto } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears, useClassrooms, useCreateClassroom, useCurriculumVersions, usePrograms, useReference } from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { InstitutionField, toneOf, useDefaultInstitutionId } from "./shared";

const PAGE_SIZES = [20, 50, 100] as const;

export function ClassroomsScreen() {
  const t = useTranslations("v2Academic.classrooms");
  const tStatus = useTranslations("v2Academic.status.classroom");
  const years = useAcademicYears();
  const programs = usePrograms();
  const grades = useReference("grade-levels");
  const flash = useFlash();
  const [filters, setFilters] = useState({ academicYearId: "", programId: "", status: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [creating, setCreating] = useState(false);

  const list = useClassrooms({
    academicYearId: filters.academicYearId || undefined,
    programId: filters.programId || undefined,
    status: filters.status || undefined,
    page,
    pageSize,
  });

  const programLabel = useMemo(() => new Map((programs.data ?? []).map((p) => [p.id, p.label])), [programs.data]);
  const gradeLabel = useMemo(() => new Map((grades.data ?? []).map((g) => [g.id, g.label])), [grades.data]);
  const setFilter = (k: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const columns: DataTableColumn<AcademicClassroomDto>[] = [
    { id: "name", header: t("columns.name"), rowHeader: true, cell: (c) => (<Link href={`/v2/academic/classrooms/${c.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{c.name}</Link>) },
    { id: "code", header: t("columns.code"), cell: (c) => c.code, className: "hidden sm:table-cell" },
    { id: "program", header: t("columns.program"), cell: (c) => programLabel.get(c.programId) ?? "—", className: "hidden md:table-cell" },
    { id: "grade", header: t("columns.gradeLevel"), cell: (c) => gradeLabel.get(c.gradeLevelId) ?? "—" },
    { id: "enrolled", header: t("columns.enrolled"), align: "right", cell: (c) => (c.capacity ? t("enrolledOf", { count: c.enrolledCount, capacity: c.capacity }) : String(c.enrolledCount)) },
    { id: "status", header: t("columns.status"), cell: (c) => <StatusBadge label={tStatus(c.status)} tone={toneOf(c.status)} /> },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="academic.classroom.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <div role="search" aria-label={t("filters")} className="mb-4 grid gap-3 sm:grid-cols-3">
        <FormField label={t("filterYear")}>
          {(c) => <NativeSelect {...c} value={filters.academicYearId} onChange={setFilter("academicYearId")} placeholder={t("all")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("filterProgram")}>
          {(c) => <NativeSelect {...c} value={filters.programId} onChange={setFilter("programId")} placeholder={t("all")} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("filterStatus")}>
          {(c) => <NativeSelect {...c} value={filters.status} onChange={setFilter("status")} placeholder={t("all")} options={ACADEMIC_CLASSROOM_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </div>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(c) => c.id}
        isLoading={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, pageSizeOptions: PAGE_SIZES, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } } : undefined}
      />
      {creating ? <CreateClassroomDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreateClassroomDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Academic.classrooms");
  const years = useAcademicYears();
  const programs = usePrograms({ status: "ACTIVE" });
  const grades = useReference("grade-levels");
  const create = useCreateClassroom();
  const [institution, setInstitution] = useState("");
  const { institutionId } = useDefaultInstitutionId(institution);
  const [form, setForm] = useState({ academicYearId: "", programId: "", gradeLevelId: "", curriculumVersionId: "", kind: "CLASS", code: "", name: "", capacity: "", capacityIsHard: false, startsOn: "", endsOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const program = (programs.data ?? []).find((p) => p.id === form.programId);
  // Niveaux proposés : ceux que couvre le programme (donnée de l'API).
  const gradeOptions = (grades.data ?? []).filter((g) => program?.gradeLevelIds.includes(g.id));
  const versions = useCurriculumVersions({ programId: form.programId || undefined, yearId: form.academicYearId || undefined, status: "PUBLISHED" }, { enabled: !!form.programId && !!form.academicYearId });

  async function submit() {
    const body = {
      institutionId,
      ...compact({ academicYearId: form.academicYearId, programId: form.programId, gradeLevelId: form.gradeLevelId, curriculumVersionId: form.curriculumVersionId, kind: form.kind, code: form.code, name: form.name, startsOn: form.startsOn, endsOn: form.endsOn }),
      ...(form.capacity ? { capacity: Number(form.capacity), capacityIsHard: form.capacityIsHard } : {}),
    };
    const v = validateWith(academicCreateClassroomBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await create.mutateAsync(v.data);
      onDone(form.name);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("createTitle")} submitLabel={t("create")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error} wide>
      <InstitutionField value={institution} onChange={setInstitution} error={errors.institutionId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.year")} required error={errors.academicYearId}>
          {(c) => <NativeSelect {...c} value={form.academicYearId} onChange={set("academicYearId")} placeholder={t("choose")} options={(years.data ?? []).filter((y) => y.status !== "ARCHIVED").map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("fields.program")} required error={errors.programId}>
          {(c) => <NativeSelect {...c} value={form.programId} onChange={(v) => setForm((f) => ({ ...f, programId: v, gradeLevelId: "", curriculumVersionId: "" }))} placeholder={t("choose")} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("fields.gradeLevel")} required error={errors.gradeLevelId} hint={form.programId && gradeOptions.length === 0 ? t("fields.noGradeLevels") : undefined}>
          {(c) => <NativeSelect {...c} value={form.gradeLevelId} onChange={set("gradeLevelId")} placeholder={t("choose")} options={gradeOptions.map((g) => ({ value: g.id, label: g.label }))} />}
        </FormField>
        <FormField label={t("fields.curriculum")} hint={t("fields.curriculumHint")} error={errors.curriculumVersionId}>
          {(c) => <NativeSelect {...c} value={form.curriculumVersionId} onChange={set("curriculumVersionId")} placeholder={t("none")} options={(versions.data ?? []).map((v, i) => ({ value: v.id, label: t("versionN", { n: i + 1, count: v.nodeCount }) }))} />}
        </FormField>
        <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code")(v.toUpperCase())} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.name")} required error={errors.name}>
          {(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.kind")} error={errors.kind}>
          {(c) => <NativeSelect {...c} value={form.kind} onChange={set("kind")} options={[{ value: "CLASS", label: t("kind.CLASS") }, { value: "COHORT", label: t("kind.COHORT") }]} />}
        </FormField>
        <FormField label={t("fields.capacity")} error={errors.capacity}>
          {(c) => <TextControl {...c} type="number" min={1} inputMode="numeric" value={form.capacity} onChange={set("capacity")} />}
        </FormField>
        <FormField label={t("fields.startsOn")} error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
      </div>
      {form.capacity ? <CheckControl checked={form.capacityIsHard} onChange={set("capacityIsHard")} label={t("fields.capacityIsHard")} hint={t("fields.capacityIsHardHint")} /> : null}
    </FormDialog>
  );
}
