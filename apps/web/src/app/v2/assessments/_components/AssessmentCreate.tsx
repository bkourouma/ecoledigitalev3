"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { assessmentBulkCreateBodySchema, assessmentCreateBodySchema, type AssessmentDto } from "@ecoledigitale/contracts/v2/assess";
import { usePermission, useFeature } from "@/platform/access";
import { useAssessmentTypes, useBulkCreateAssessments, useCreateAssessment } from "@/platform/v2/assess";
import { useStaffOptions } from "@/platform/v2/lookups";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ClassroomPicker, NodePicker, PeriodPicker } from "./shared";

function useTeacherOptions(search: string, enabled: boolean) {
  return useStaffOptions(search, enabled, { canTeach: true, status: "ACTIVE" });
}

interface Target {
  key: number;
  classroomId: string;
  curriculumNodeId: string;
  /** Enseignant de la ligne (direction) : sans lui, l'API refuse « Indiquez l'enseignant de l'évaluation » (L-40). */
  teacher: SelectOption | null;
}

export function AssessmentCreate({ initialClassroomId = "", basePath = "/v2/assessments" }: { initialClassroomId?: string; basePath?: string }) {
  const t = useTranslations("v2Assess.create");
  const types = useAssessmentTypes();
  const create = useCreateAssessment();
  const bulkCreate = useBulkCreateAssessments();
  const manage = usePermission("assessment.manage");
  const session2 = useFeature("assess.session2");
  const [bulk, setBulk] = useState(false);
  const [form, setForm] = useState({ typeId: "", title: "", assessedOn: "", scaleMax: "", weight: "", sessionNo: "" });
  const [classroomId, setClassroomId] = useState(initialClassroomId);
  const [curriculumNodeId, setNodeId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [teacher, setTeacher] = useState<SelectOption | null>(null);
  const [targets, setTargets] = useState<Target[]>([{ key: 1, classroomId: "", curriculumNodeId: "", teacher: null }]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<AssessmentDto[] | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const type = types.data?.find((x) => x.id === form.typeId);
  const mutation = bulk ? bulkCreate : create;

  async function submit() {
    const common = { typeId: form.typeId, academicPeriodId: periodId, title: form.title, assessedOn: form.assessedOn, ...compact({ scaleMax: form.scaleMax, weight: form.weight }), ...(form.sessionNo ? { sessionNo: Number(form.sessionNo) } : {}) };
    if (bulk) {
      const body = { ...common, targets: targets.filter((x) => x.classroomId || x.curriculumNodeId).map((x) => ({ classroomId: x.classroomId, curriculumNodeId: x.curriculumNodeId, ...(x.teacher ? { teacherId: x.teacher.value } : {}) })) };
      const v = validateWith(assessmentBulkCreateBodySchema, body);
      if (!v.ok) return setErrors(v.errors);
      setErrors({});
      try {
        const out = await bulkCreate.mutateAsync(v.data);
        setCreated(out.items);
      } catch (e) {
        setErrors(apiErrorToFieldErrors(e));
      }
      return;
    }
    const body = { ...common, classroomId, curriculumNodeId, ...(teacher ? { teacherId: teacher.value } : {}) };
    const v = validateWith(assessmentCreateBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      setCreated([await create.mutateAsync(v.data)]);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  if (created) {
    return (
      <div>
        <PageHeader title={t("doneTitle")} />
        <Notice kind="success">{t("done", { count: created.length })}</Notice>
        <ul className="mt-4 space-y-2">
          {created.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <span className="font-medium">{a.title}</span>
              <Link href={`${basePath}/${a.id}/grades`} className={buttonClass.primary}>
                {t("enterGrades")}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4">
          <button type="button" className={buttonClass.secondary} onClick={() => setCreated(null)}>
            {t("another")}
          </button>
        </p>
      </div>
    );
  }

  if (types.isPending && types.fetchStatus !== "idle") return <LoadingBlock />;

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form
        noValidate
        className="max-w-2xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {types.isError ? <ErrorBlock error={types.error} onRetry={() => void types.refetch()} /> : null}
        <FormField label={t("type")} required error={errors.typeId}>
          {(c) => (
            <NativeSelect {...c} value={form.typeId} onChange={set("typeId")} placeholder={t("typePlaceholder")} options={(types.data ?? []).filter((x) => x.active).map((x) => ({ value: x.id, label: x.label }))} />
          )}
        </FormField>
        <FormField label={t("titleField")} required error={errors.title}>
          {(c) => <TextControl {...c} value={form.title} onChange={set("title")} maxLength={160} />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("assessedOn")} required error={errors.assessedOn}>
            {(c) => <TextControl {...c} type="date" value={form.assessedOn} onChange={set("assessedOn")} />}
          </FormField>
          <FormField label={t("scaleMax")} error={errors.scaleMax} hint={type ? t("defaultFromType", { value: type.defaultScaleMax.replace(".", ",") }) : t("scaleHint")}>
            {(c) => <TextControl {...c} value={form.scaleMax} onChange={set("scaleMax")} inputMode="decimal" />}
          </FormField>
          <FormField label={t("weight")} error={errors.weight} hint={type ? t("defaultFromType", { value: type.defaultWeight.replace(".", ",") }) : undefined}>
            {(c) => <TextControl {...c} value={form.weight} onChange={set("weight")} inputMode="decimal" />}
          </FormField>
          {type?.allowsSession2 && session2.allowed ? (
            <FormField label={t("session")} error={errors.sessionNo}>
              {(c) => (
                <NativeSelect
                  {...c}
                  value={form.sessionNo}
                  onChange={set("sessionNo")}
                  placeholder={t("session1")}
                  options={[
                    { value: "1", label: t("session1") },
                    { value: "2", label: t("session2") },
                  ]}
                />
              )}
            </FormField>
          ) : null}
        </div>

        <CheckControl checked={bulk} onChange={setBulk} label={t("bulk")} hint={t("bulkHint")} />

        {!bulk ? (
          <>
            <FormField label={t("classroom")} required error={errors.classroomId}>
              {(c) => (
                <ClassroomPicker
                  {...c}
                  value={classroomId}
                  onChange={(v) => {
                    setClassroomId(v);
                    setNodeId("");
                    setPeriodId("");
                  }}
                />
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("node")} required error={errors.curriculumNodeId}>
                {(c) => <NodePicker {...c} classroomId={classroomId} value={curriculumNodeId} onChange={setNodeId} />}
              </FormField>
              <FormField label={t("period")} required error={errors.academicPeriodId}>
                {(c) => <PeriodPicker {...c} classroomId={classroomId} value={periodId} onChange={setPeriodId} />}
              </FormField>
            </div>
            {manage.allowed ? (
              <FormField label={t("teacher")} hint={t("teacherHint")} error={errors.teacherId}>
                {(c) => <SelectAsync {...c} value={teacher} onChange={setTeacher} useOptions={useTeacherOptions} placeholder={t("teacherPlaceholder")} />}
              </FormField>
            ) : null}
          </>
        ) : (
          <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <legend className="px-1 text-sm font-medium">{t("targets")}</legend>
            {targets.map((target, i) => (
              <div key={target.key} className="grid gap-3 rounded-md bg-white/[0.04] p-3 sm:grid-cols-[1fr_1fr_auto]">
                <FormField label={t("targetClassroom", { n: i + 1 })} error={errors[`targets.${i}.classroomId`]}>
                  {(c) => <ClassroomPicker {...c} value={target.classroomId} onChange={(v) => setTargets((l) => l.map((x) => (x.key === target.key ? { ...x, classroomId: v, curriculumNodeId: "" } : x)))} />}
                </FormField>
                <FormField label={t("targetNode", { n: i + 1 })} error={errors[`targets.${i}.curriculumNodeId`]}>
                  {(c) => <NodePicker {...c} classroomId={target.classroomId} value={target.curriculumNodeId} onChange={(v) => setTargets((l) => l.map((x) => (x.key === target.key ? { ...x, curriculumNodeId: v } : x)))} />}
                </FormField>
                {manage.allowed ? (
                  <div className="sm:col-span-3">
                    <FormField label={t("targetTeacher", { n: i + 1 })} hint={t("teacherHint")} error={errors[`targets.${i}.teacherId`]}>
                      {(c) => <SelectAsync {...c} value={target.teacher} onChange={(v) => setTargets((l) => l.map((x) => (x.key === target.key ? { ...x, teacher: v } : x)))} useOptions={useTeacherOptions} placeholder={t("teacherPlaceholder")} />}
                    </FormField>
                  </div>
                ) : null}
                <div className="flex items-end">
                  <button type="button" className={buttonClass.ghost} onClick={() => setTargets((l) => l.filter((x) => x.key !== target.key))} disabled={targets.length === 1} aria-label={t("removeTarget", { n: i + 1 })}>
                    {t("remove")}
                  </button>
                </div>
              </div>
            ))}
            {errors.targets ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {errors.targets}
              </p>
            ) : null}
            <button type="button" className={buttonClass.secondary} onClick={() => setTargets((l) => [...l, { key: Math.max(0, ...l.map((x) => x.key)) + 1, classroomId: "", curriculumNodeId: "", teacher: null }])}>
              {t("addTarget")}
            </button>
            <FormField label={t("period")} required error={errors.academicPeriodId} hint={t("bulkPeriodHint")}>
              {(c) => <PeriodPicker {...c} classroomId={targets[0]?.classroomId ?? ""} value={periodId} onChange={setPeriodId} />}
            </FormField>
          </fieldset>
        )}

        {mutation.error && Object.keys(errors).length === 0 ? <ErrorBlock error={mutation.error} /> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link href={basePath} className={buttonClass.secondary}>
            {t("cancel")}
          </Link>
          <button type="submit" className={buttonClass.primary} disabled={mutation.isPending}>
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
