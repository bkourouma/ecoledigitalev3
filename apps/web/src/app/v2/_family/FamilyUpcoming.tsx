"use client";

import { useFormatter, useTranslations } from "next-intl";
import { addDays, todayCivil } from "@/platform/v2/dates";
import type { Directory } from "@/platform/v2/directory";
import { useFamilyLabels, type FamilySubject } from "@/platform/v2/portal";
import { useChildTimetable, useMyTimetable, type OccurrenceDto } from "@/platform/v2/scheduling";
import { PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { OccurrenceCard, type Directories } from "../schedule/_components/OccurrenceCard";

const unknownDirectory: Directory = { name: () => "—", find: () => null, isLoading: false };
const HORIZON_DAYS = 30;

/**
 * Évaluations à venir : les examens et contrôles PLANIFIÉS à l'emploi du temps de l'élève (séances de type « évaluation » des
 * 30 prochains jours). Les devoirs à rendre ne sont pas portés par la nouvelle plateforme : seule la planification est annoncée.
 */
export function FamilyUpcoming({ subject, title }: { subject: FamilySubject; title: string }) {
  const t = useTranslations("v2Portal.family.upcoming");
  const format = useFormatter();
  const labels = useFamilyLabels(subject);
  const today = todayCivil();
  const window = { from: today, to: addDays(today, HORIZON_DAYS) };
  const mine = useMyTimetable(window, subject.kind === "me");
  const child = useChildTimetable(subject.kind === "child" ? subject.id : null, window);
  const query = subject.kind === "me" ? mine : child;
  const dirs: Directories = {
    classrooms: { name: (id) => labels.classroom(id) ?? "—", find: (id) => labels.classroom(id), isLoading: labels.isLoading },
    staff: unknownDirectory,
    rooms: unknownDirectory,
  };
  const exams = (query.data?.items ?? [])
    .filter((o) => o.kind === "EXAM" && o.status !== "CANCELLED")
    .map((o): OccurrenceDto => ({ ...o, title: o.title ?? labels.node(o.curriculumNodeId) }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const dayLabel = (iso: string) => format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={t("description", { days: HORIZON_DAYS })} />
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && exams.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="space-y-3">
        {exams.map((o) => (
          <li key={o.id} className="space-y-1">
            <p className="text-sm font-semibold capitalize">{dayLabel(o.startsAt)}</p>
            <OccurrenceCard o={o} dirs={dirs} />
          </li>
        ))}
      </ul>
      {query.data?.hasMore ? <Notice kind="info">{t("truncated")}</Notice> : null}
      <Notice kind="info">{t("homeworkNote")}</Notice>
    </div>
  );
}
