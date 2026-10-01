"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAcademicYears, useYearPeriods } from "@/platform/v2/academic";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";

export interface ClassPeriodValue {
  yearId: string;
  classroom: SelectOption | null;
  periodId: string;
}

export const EMPTY_CLASS_PERIOD: ClassPeriodValue = { yearId: "", classroom: null, periodId: "" };

/**
 * Année, période et (facultativement) classe : les trois filtres communs des tableaux d'assiduité. L'année en cours
 * et la première période sont choisies d'office dès que l'API les a renvoyées ; l'utilisateur peut les changer.
 */
export function ClassPeriodPicker({
  value,
  onChange,
  withClassroom = true,
  withPeriod = true,
}: {
  value: ClassPeriodValue;
  onChange: (next: ClassPeriodValue) => void;
  withClassroom?: boolean;
  withPeriod?: boolean;
}) {
  const t = useTranslations("v2Attendance.filters");
  const years = useAcademicYears();
  const periods = useYearPeriods(value.yearId || null);

  const firstYear = (years.data ?? []).find((y) => y.isCurrent) ?? years.data?.[0];
  useEffect(() => {
    if (!value.yearId && firstYear) onChange({ ...value, yearId: firstYear.id });
  }, [value, firstYear, onChange]);
  const firstPeriod = periods.data?.[0];
  useEffect(() => {
    if (withPeriod && value.yearId && !value.periodId && firstPeriod && firstPeriod.academicYearId === value.yearId) onChange({ ...value, periodId: firstPeriod.id });
  }, [value, firstPeriod, withPeriod, onChange]);

  const useOpts = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: value.yearId || undefined });

  return (
    <div role="search" aria-label={t("label")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <FormField label={t("year")}>
        {(c) => <NativeSelect {...c} value={value.yearId} onChange={(yearId) => onChange({ yearId, classroom: null, periodId: "" })} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      {withPeriod ? (
        <FormField label={t("period")}>
          {(c) => <NativeSelect {...c} value={value.periodId} onChange={(periodId) => onChange({ ...value, periodId })} options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
      ) : null}
      {withClassroom ? (
        <FormField label={t("classroom")}>
          {(c) => <SelectAsync {...c} value={value.classroom} onChange={(classroom) => onChange({ ...value, classroom })} useOptions={useOpts} placeholder={t("chooseClassroom")} ariaLabel={t("classroom")} />}
        </FormField>
      ) : null}
    </div>
  );
}
