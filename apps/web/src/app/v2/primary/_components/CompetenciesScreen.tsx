"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { PageHeader } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { usePrimaryCompetencySheet } from "@/platform/v2/primary";
import { GridWorkspace } from "./CompetencyGrid";
import { ClassPeriodPicker, FeatureGate, PrimaryError, RuleBanner, useClassSelection } from "./shared";

/** « Compétences » : choix classe -> période -> référentiel, puis grille élèves × compétences. */
export function CompetenciesScreen({ initialClassroomId }: { initialClassroomId?: string | null }) {
  return (
    <FeatureGate feature="primary.competencies">
      <CompetenciesBody initialClassroomId={initialClassroomId ?? null} />
    </FeatureGate>
  );
}

function CompetenciesBody({ initialClassroomId }: { initialClassroomId: string | null }) {
  const t = useTranslations("v2PrimaryCompetencies");
  const sel = useClassSelection(initialClassroomId);
  const [frameworkId, setFrameworkId] = useState("");
  const [dirty, setDirty] = useState(0);
  const sheet = usePrimaryCompetencySheet(sel.classroomId || null, sel.periodId || null, frameworkId || null);
  const data = sheet.data;
  const frameworks = data?.frameworks ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner classroomId={sel.classroomId || null} />
      {sel.classes.isPending ? <LoadingBlock /> : null}
      {sel.classes.isError ? <PrimaryError error={sel.classes.error} /> : null}
      {sel.classes.data && sel.list.length === 0 ? <Notice kind="info">{t("noClassroom")}</Notice> : null}
      {sel.list.length > 0 ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" disabled={dirty > 0}>
          <legend className="px-1 text-sm font-medium">{t("pickers")}</legend>
          <ClassPeriodPicker
            classes={sel.list}
            classroomId={sel.classroomId}
            periodId={sel.periodId}
            onClassroom={(id) => {
              setFrameworkId("");
              sel.setClassroomId(id);
            }}
            onPeriod={(id) => {
              setFrameworkId("");
              sel.setPeriodId(id);
            }}
          />
          {frameworks.length > 1 ? (
            <FormField label={t("framework")}>
              {(c) => <NativeSelect {...c} value={frameworkId || data?.framework?.id || ""} onChange={setFrameworkId} options={frameworks.map((f) => ({ value: f.id, label: `${f.label} (v${f.version})` }))} />}
            </FormField>
          ) : null}
          {dirty > 0 ? <p className="text-xs text-muted-foreground">{t("pickersLocked")}</p> : null}
        </fieldset>
      ) : null}
      {sel.classroomId && !sel.periodId ? <Notice kind="info">{t("choosePeriod")}</Notice> : null}
      {sel.periodId ? (
        sheet.isPending ? (
          <LoadingBlock />
        ) : sheet.isError ? (
          <PrimaryError error={sheet.error} />
        ) : data ? (
          <GridWorkspace
            key={`${data.classroomId}-${data.periodId}-${data.framework?.id ?? "none"}`}
            sheet={data}
            onReload={async () => (await sheet.refetch()).data}
            onDirtyChange={setDirty}
          />
        ) : null
      ) : null}
    </div>
  );
}
