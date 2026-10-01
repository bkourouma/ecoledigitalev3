"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useClassroom, useClassroomOfferings, useYearPeriods } from "@/platform/v2/academic";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useStudents } from "@/platform/v2/people";
import { NativeSelect } from "@/platform/ui/FormField";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import type { Tone } from "@/platform/ui/PageHeader";

/** Tonalité d'une pastille d'état (affichage seulement : le sens est porté par le libellé traduit). */
export function toneOfStatus(status: string): Tone {
  switch (status) {
    case "PUBLISHED":
    case "FINAL":
    case "CLOSED":
    case "APPROVED":
    case "ISSUED":
    case "AUTHENTIC":
    case "OBTAINED":
    case "ACQUIRED":
    case "RENDERED":
    case "COMPLETED":
    case "CONFIRMED":
    case "published":
      return "success";
    case "SUBMITTED":
    case "REVIEWED":
    case "REQUESTED":
    case "GRADING_LOCKED":
    case "DELIBERATED":
    case "PROPOSED":
    case "PENDING":
    case "RENDERING":
    case "COMPLETED_WITH_ERRORS":
    case "proposed":
    case "approved":
    case "simulated":
      return "warning";
    case "DRAFT":
    case "OPEN":
    case "draft":
      return "info";
    case "CANCELLED":
    case "REJECTED":
    case "REVOKED":
    case "ERROR":
    case "FAILED":
    case "INVALID":
    case "EXPIRED":
    case "retired":
      return "danger";
    default:
      return "neutral";
  }
}

/** Élèves d'une classe (nom + matricule) pour libeller les lignes ; l'API restreint déjà aux classes autorisées. */
export function useStudentNames(classroomId: string | null) {
  const q = useStudents({ classroomId: classroomId ?? undefined, limit: 200 }, { enabled: classroomId !== null });
  const names = useMemo(() => new Map((q.data?.items ?? []).map((s) => [s.id, { name: s.displayName, number: s.studentNumber }] as const)), [q.data]);
  const byEnrollment = useMemo(() => new Map((q.data?.items ?? []).flatMap((s) => (s.currentEnrollment ? [[s.currentEnrollment.enrollmentId, { name: s.displayName, number: s.studentNumber }] as const] : []))), [q.data]);
  return { names, byEnrollment, isLoading: q.isPending && q.fetchStatus !== "idle", error: q.error, truncated: (q.data?.total ?? 0) > (q.data?.items.length ?? 0) };
}

export function useStudentLabel(names: ReadonlyMap<string, { name: string; number: string }>) {
  const t = useTranslations("v2Assess.common");
  return (studentId: string): string => names.get(studentId)?.name ?? t("studentFallback", { id: studentId.slice(0, 4) });
}

/** Classe choisie : l'identifiant est la valeur ; le libellé est relu si la classe vient de l'adresse (lien profond). */
export function ClassroomPicker({
  value,
  onChange,
  ariaLabel,
  id,
  ...aria
}: {
  value: string;
  onChange: (classroomId: string) => void;
  ariaLabel?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}) {
  const t = useTranslations("v2Assess.common");
  const [chosen, setChosen] = useState<SelectOption | null>(null);
  const fromValue = useClassroom(value && chosen?.value !== value ? value : null);
  const option: SelectOption | null = chosen && chosen.value === value ? chosen : fromValue.data ? { value, label: fromValue.data.name, description: fromValue.data.code } : value ? { value, label: t("classroomFallback", { id: value.slice(0, 4) }) } : null;
  return (
    <SelectAsync
      {...aria}
      id={id}
      ariaLabel={ariaLabel ?? t("classroom")}
      value={option}
      onChange={(o) => {
        setChosen(o);
        onChange(o?.value ?? "");
      }}
      useOptions={useClassroomOptions}
      placeholder={t("classroomPlaceholder")}
    />
  );
}

/** Périodes de l'année de la classe choisie. */
export function usePeriodsOfClassroom(classroomId: string | null) {
  const classroom = useClassroom(classroomId || null);
  const periods = useYearPeriods(classroom.data?.academicYearId ?? null);
  return { classroom: classroom.data ?? null, periods: periods.data ?? [], isLoading: (classroom.isPending && classroom.fetchStatus !== "idle") || (periods.isPending && periods.fetchStatus !== "idle"), error: classroom.error ?? periods.error };
}

export function PeriodPicker({
  classroomId,
  value,
  onChange,
  id,
  ...aria
}: {
  classroomId: string;
  value: string;
  onChange: (periodId: string) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}) {
  const t = useTranslations("v2Assess.common");
  const { periods, isLoading } = usePeriodsOfClassroom(classroomId || null);
  return (
    <NativeSelect
      {...aria}
      id={id}
      value={value}
      onChange={onChange}
      disabled={!classroomId || isLoading}
      placeholder={classroomId ? (isLoading ? t("loading") : t("periodPlaceholder")) : t("chooseClassroomFirst")}
      options={periods.map((p) => ({ value: p.id, label: p.label }))}
    />
  );
}

/** Cours (nœud de curriculum) d'une classe : issus de ses offres. */
export function NodePicker({
  classroomId,
  value,
  onChange,
  id,
  ...aria
}: {
  classroomId: string;
  value: string;
  onChange: (nodeId: string) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}) {
  const t = useTranslations("v2Assess.common");
  const offerings = useClassroomOfferings(classroomId || null);
  const options = useMemo(() => {
    const seen = new Set<string>();
    return (offerings.data ?? []).filter((o) => (seen.has(o.curriculumNodeId) ? false : (seen.add(o.curriculumNodeId), true))).map((o) => ({ value: o.curriculumNodeId, label: o.label }));
  }, [offerings.data]);
  return (
    <NativeSelect
      {...aria}
      id={id}
      value={value}
      onChange={onChange}
      disabled={!classroomId || offerings.isPending}
      placeholder={classroomId ? t("nodePlaceholder") : t("chooseClassroomFirst")}
      options={options}
    />
  );
}

/** Libellés de cours d'une classe (id de nœud -> intitulé). */
export function useNodeLabels(classroomId: string | null) {
  const offerings = useClassroomOfferings(classroomId || null);
  return useMemo(() => new Map((offerings.data ?? []).map((o) => [o.curriculumNodeId, o.label] as const)), [offerings.data]);
}
