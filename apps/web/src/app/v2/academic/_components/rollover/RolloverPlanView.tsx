"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ACADEMIC_OUTCOME_KINDS, type AcademicRolloverPlanDto, type AcademicRolloverWarning } from "@ecoledigitale/contracts/v2/academic";
import { useReference } from "@/platform/v2/academic";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { anomalyHref, capped, WARNING_LINKS, type RolloverAnomaly } from "./labels";

/** Avertissements de l'aperçu ou du rapport : bien visibles (`role="alert"`), avec un lien vers l'écran de correction. */
export function RolloverWarnings({ warnings, titleKey = "plan" }: { warnings: ReadonlyArray<AcademicRolloverWarning>; titleKey?: "plan" | "report" }) {
  const t = useTranslations("v2Rollover.warnings");
  const tStep = useTranslations("v2Rollover.step");
  if (warnings.length === 0) return null;
  return (
    <Notice kind="warning">
      <p className="font-semibold">{t(`title.${titleKey}`, { count: warnings.length })}</p>
      <ul className="mt-2 space-y-2">
        {warnings.map((w, i) => {
          const href = WARNING_LINKS[w.code];
          return (
            <li key={`${w.code}-${i}`} className="space-y-0.5">
              <p>
                <span className="font-medium">{t(`code.${w.code}`)}</span>
                {w.step ? <span className="text-xs"> ({tStep(w.step)})</span> : null}
              </p>
              <p>{w.message}</p>
              {href ? (
                <Link href={href} className="text-sm font-medium underline underline-offset-4">
                  {t("fix")}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  const { number } = useDateFormat();
  return (
    <div className={`rounded-md border p-3 ${tone === "warning" && value > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold">{number(value)}</dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border p-4">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function More({ count }: { count: number }) {
  const t = useTranslations("v2Rollover.plan");
  return count > 0 ? <p className="text-xs text-muted-foreground">{t("more", { count })}</p> : null;
}

/** Anomalies regroupées par code (compteur + premières lignes, chacune avec un lien vers l'inscription ou la classe). */
export function AnomalyGroups({ anomalies }: { anomalies: ReadonlyArray<RolloverAnomaly> }) {
  const t = useTranslations("v2Rollover.anomalies");
  if (anomalies.length === 0) return null;
  const groups = new Map<RolloverAnomaly["code"], RolloverAnomaly[]>();
  for (const a of anomalies) groups.set(a.code, [...(groups.get(a.code) ?? []), a]);
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([code, list]) => {
        const { shown, more } = capped(list, 15);
        return (
          <div key={code} className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm">
            <p className="font-medium">{t("group", { label: t(`code.${code}`), count: list.length })}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {shown.map((a, i) => {
                const href = anomalyHref(a);
                return (
                  <li key={`${code}-${i}`}>
                    {a.message}{" "}
                    {href ? (
                      <Link href={href} className="font-medium underline underline-offset-4">
                        {a.enrollmentId ? t("openEnrollment") : t("openClassroom")}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {more > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("more", { count: more })}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Répartition par issue de fin d'année : le libellé vient du référentiel (par code) ou de la nature (ADVANCE…) ; sinon la clé brute. */
function OutcomeBreakdown({ byOutcome }: { byOutcome: Record<string, number> }) {
  const t = useTranslations("v2Rollover.plan.enrollments");
  const outcomes = useReference("enrollment-outcomes");
  const entries = Object.entries(byOutcome);
  if (entries.length === 0) return null;
  const labelOf = (key: string) => {
    const hit = (outcomes.data ?? []).find((o) => o.code === key);
    if (hit) return hit.label;
    return (ACADEMIC_OUTCOME_KINDS as readonly string[]).includes(key) ? t(`kind.${key as (typeof ACADEMIC_OUTCOME_KINDS)[number]}`) : key;
  };
  return (
    <div>
      <p className="text-sm font-medium">{t("byOutcome")}</p>
      <ul className="mt-1 flex flex-wrap gap-2" aria-label={t("byOutcome")}>
        {entries.map(([key, count]) => (
          <li key={key}>
            <StatusBadge label={`${labelOf(key)} : ${count}`} tone="info" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Aperçu complet de la reconduction (`GET .../rollover/plan`) : compteurs et listes par étape, avertissements, anomalies. */
export function RolloverPlanView({ plan }: { plan: AcademicRolloverPlanDto }) {
  const t = useTranslations("v2Rollover.plan");
  const tStep = useTranslations("v2Rollover.step");
  const tAction = useTranslations("v2Rollover.plan.curriculum.action");
  const tStatus = useTranslations("v2Academic.status.version");
  const tKind = useTranslations("v2Rollover.holidayKind");
  const date = useDateFormat();
  const has = (s: AcademicRolloverPlanDto["steps"][number]) => plan.steps.includes(s);

  const periods = capped(plan.periods.toCreate);
  const holidays = capped(plan.holidays.toCreate);
  const classrooms = capped(plan.classrooms.toCreate);

  const periodColumns: DataTableColumn<(typeof plan.periods.toCreate)[number]>[] = [
    { id: "label", header: t("periods.label"), rowHeader: true, cell: (p) => <span className={p.parentCode ? "pl-4" : "font-medium"}>{p.label}</span> },
    { id: "code", header: t("periods.code"), cell: (p) => p.code, className: "hidden sm:table-cell" },
    { id: "dates", header: t("periods.dates"), cell: (p) => `${date.civil(p.startsOn)} → ${date.civil(p.endsOn)}` },
  ];
  const holidayColumns: DataTableColumn<(typeof plan.holidays.toCreate)[number]>[] = [
    { id: "label", header: t("holidays.label"), rowHeader: true, cell: (h) => h.label },
    { id: "kind", header: t("holidays.kind"), cell: (h) => tKind(h.kind), className: "hidden sm:table-cell" },
    { id: "dates", header: t("holidays.dates"), cell: (h) => (h.startsOn === h.endsOn ? date.civil(h.startsOn) : `${date.civil(h.startsOn)} → ${date.civil(h.endsOn)}`) },
  ];
  const curriculumColumns: DataTableColumn<(typeof plan.curriculum.items)[number]>[] = [
    { id: "program", header: t("curriculum.program"), rowHeader: true, cell: (c) => <span className="font-medium">{c.programLabel}</span> },
    { id: "source", header: t("curriculum.source"), cell: (c) => (c.sourceStatus ? tStatus(c.sourceStatus) : "—"), className: "hidden sm:table-cell" },
    { id: "nodes", header: t("curriculum.nodes"), align: "right", cell: (c) => date.number(c.nodeCount), className: "hidden sm:table-cell" },
    { id: "action", header: t("curriculum.actionLabel"), cell: (c) => <StatusBadge label={tAction(c.action)} tone={c.action === "CLONE" ? "success" : c.action === "EXISTS" ? "neutral" : "warning"} /> },
  ];
  const classroomColumns: DataTableColumn<(typeof plan.classrooms.toCreate)[number]>[] = [
    { id: "name", header: t("classrooms.name"), rowHeader: true, cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: "code", header: t("classrooms.code"), cell: (c) => c.code },
    { id: "capacity", header: t("classrooms.capacity"), align: "right", cell: (c) => date.number(c.capacity), className: "hidden sm:table-cell" },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      <RolloverWarnings warnings={plan.warnings} />

      {has("PERIODS") ? (
        <Section id="plan-periods" title={tStep("PERIODS")}>
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Counter label={t("toCreate")} value={plan.periods.toCreate.length} />
            <Counter label={t("existing")} value={plan.periods.existing} />
          </dl>
          {plan.periods.toCreate.length > 0 ? <DataTable caption={t("periods.caption")} columns={periodColumns} rows={periods.shown} getRowId={(p) => p.code} /> : null}
          <More count={periods.more} />
        </Section>
      ) : null}

      {has("HOLIDAYS") ? (
        <Section id="plan-holidays" title={tStep("HOLIDAYS")}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:max-w-xl">
            <Counter label={t("toCreate")} value={plan.holidays.toCreate.length} />
            <Counter label={t("existing")} value={plan.holidays.existing} />
            <Counter label={t("holidays.notRecurring")} value={plan.holidays.notRecurring} tone="warning" />
          </dl>
          {plan.holidays.notRecurring > 0 ? (
            <p className="text-sm text-amber-900">
              {t("holidays.notRecurringHint", { count: plan.holidays.notRecurring })}{" "}
              <Link href="/v2/academic/settings?tab=calendar" className="font-medium underline underline-offset-4">
                {t("holidays.openCalendar")}
              </Link>
            </p>
          ) : null}
          {plan.holidays.toCreate.length > 0 ? <DataTable caption={t("holidays.caption")} columns={holidayColumns} rows={holidays.shown} getRowId={(h) => `${h.label}-${h.startsOn}-${h.endsOn}`} /> : null}
          <More count={holidays.more} />
        </Section>
      ) : null}

      {has("CURRICULUM") ? (
        <Section id="plan-curriculum" title={tStep("CURRICULUM")}>
          <DataTable caption={t("curriculum.caption")} columns={curriculumColumns} rows={plan.curriculum.items} getRowId={(c) => c.programId} emptyTitle={t("curriculum.empty")} />
        </Section>
      ) : null}

      {has("CLASSROOMS") ? (
        <Section id="plan-classrooms" title={tStep("CLASSROOMS")}>
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Counter label={t("toCreate")} value={plan.classrooms.toCreate.length} />
            <Counter label={t("existing")} value={plan.classrooms.existing} />
          </dl>
          {plan.classrooms.toCreate.length > 0 ? <DataTable caption={t("classrooms.caption")} columns={classroomColumns} rows={classrooms.shown} getRowId={(c) => c.sourceClassroomId} /> : null}
          <More count={classrooms.more} />
        </Section>
      ) : null}

      {has("OFFERINGS") ? (
        <Section id="plan-offerings" title={tStep("OFFERINGS")}>
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Counter label={t("toCreate")} value={plan.offerings.toCreate} />
            <Counter label={t("existing")} value={plan.offerings.existing} />
          </dl>
        </Section>
      ) : null}

      {has("ENROLLMENTS") && plan.enrollments ? (
        <Section id="plan-enrollments" title={tStep("ENROLLMENTS")}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter label={t("enrollments.toCreate")} value={plan.enrollments.enrollmentsToCreate.length} />
            <Counter label={t("enrollments.alreadyRolledOver")} value={plan.enrollments.alreadyRolledOver} />
            <Counter label={t("enrollments.classroomsToCreate")} value={plan.enrollments.classroomsToCreate.length} />
            <Counter label={t("enrollments.anomalies")} value={plan.enrollments.anomalies.length} tone="warning" />
          </dl>
          <OutcomeBreakdown byOutcome={plan.enrollments.byOutcome} />
          <AnomalyGroups anomalies={plan.enrollments.anomalies} />
        </Section>
      ) : null}
    </div>
  );
}
