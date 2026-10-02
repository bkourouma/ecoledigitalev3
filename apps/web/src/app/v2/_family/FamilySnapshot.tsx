"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { todayCivil, addDays } from "@/platform/v2/dates";
import { useChildAttendance, useMyAttendance } from "@/platform/v2/attendance";
import { learnerIdOf, useFamilyLabels, useFamilyResults, useFamilyStatement, type FamilySubject } from "@/platform/v2/portal";
import { useChildTimetable, useMyTimetable } from "@/platform/v2/scheduling";
import { showDecimal, useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { messagingEntry } from "./messaging";

export interface SnapshotLinks {
  results: string;
  attendance: string;
  finance: string;
  schedule: string;
}

function Card({ title, children, href, hrefLabel }: { title: string; children: ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <section aria-label={title} className="flex flex-col justify-between gap-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {children}
      </div>
      {href && hrefLabel ? (
        <Link href={href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {hrefLabel}
        </Link>
      ) : null}
    </section>
  );
}

function Unavailable() {
  const t = useTranslations("v2Portal.family.snapshot");
  return <p className="text-sm text-muted-foreground">{t("unavailable")}</p>;
}

/**
 * Tableau de bord d'un élève ou d'un enfant : dernière moyenne publiée, absences et retards, scolarité restante, prochaines
 * séances, annonces. Chaque carte a ses propres états (chargement, indisponible, vide) et n'apparaît que si le droit de lecture
 * correspondant est accordé ; les chiffres sont ceux de l'API, jamais recalculés ici.
 */
export function FamilySnapshot({ subject, links }: { subject: FamilySubject; links: SnapshotLinks }) {
  const own = subject.kind === "me";
  const canResults = usePermission(own ? "result.self.read" : "result.child.read").allowed;
  const canAttendance = usePermission(own ? "attendance.self.read" : "attendance.child.read").allowed;
  const canFinance = usePermission(own ? "finance.self.read" : "finance.child.read").allowed;
  const canSchedule = usePermission(own ? "schedule.self.read" : "schedule.child.read").allowed;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {canResults ? <AverageCard subject={subject} href={links.results} /> : null}
      {canAttendance ? <AttendanceCard subject={subject} href={links.attendance} /> : null}
      {canFinance ? <OutstandingCard subject={subject} href={links.finance} /> : null}
      {canSchedule ? <UpcomingCard subject={subject} href={links.schedule} /> : null}
    </div>
  );
}

function AverageCard({ subject, href }: { subject: FamilySubject; href: string }) {
  const t = useTranslations("v2Portal.family.snapshot.average");
  const labels = useFamilyLabels(subject);
  const date = useDateFormat();
  const query = useFamilyResults(subject);
  // « La plus récente » est la dernière clôturée (finalisation) parmi les résultats de PÉRIODE : sélection, pas un calcul.
  const latest = useMemo(() => {
    const periods = (query.data ?? []).filter((r) => r.scope === "PERIOD" && r.finalizedAt);
    return [...periods].sort((a, b) => (a.finalizedAt ?? "").localeCompare(b.finalizedAt ?? "")).at(-1) ?? null;
  }, [query.data]);
  return (
    <Card title={t("title")} href={href} hrefLabel={t("details")}>
      {query.isPending ? <LoadingBlock className="py-2" /> : query.isError ? <Unavailable /> : latest ? (
        <>
          <p className="text-3xl font-semibold tabular-nums" title={latest.average ?? undefined}>
            {showDecimal(latest.averageDisplay ?? latest.average)}
          </p>
          <p className="text-sm text-muted-foreground">
            {[labels.period(latest.academicPeriodId), latest.rank !== null && latest.cohortSize !== null ? t("rank", { rank: latest.rank, size: latest.cohortSize }) : null].filter(Boolean).join(" · ")}
          </p>
          {latest.finalizedAt ? <p className="text-xs text-muted-foreground">{t("publishedOn", { date: date.instant(latest.finalizedAt) })}</p> : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
    </Card>
  );
}

function AttendanceCard({ subject, href }: { subject: FamilySubject; href: string }) {
  const t = useTranslations("v2Portal.family.snapshot.attendance");
  const mine = useMyAttendance({}, subject.kind === "me");
  const child = useChildAttendance(subject.kind === "child" ? subject.id : null, {});
  const q = subject.kind === "me" ? mine : child;
  const counts = q.data?.summary?.effective ?? null;
  const toJustify = (q.data?.records ?? []).filter((r) => !r.excused && r.statusCode === "ABSENT").length;
  return (
    <Card title={t("title")} href={href} hrefLabel={t("details")}>
      {q.isPending ? <LoadingBlock className="py-2" /> : q.isError ? <Unavailable /> : counts ? (
        <>
          <p className="text-3xl font-semibold tabular-nums">{counts.absentCount}</p>
          <p className="text-sm text-muted-foreground">{t("absences", { absent: counts.absentCount, late: counts.lateCount })}</p>
          {toJustify > 0 ? <p className="text-sm font-medium text-amber-700">{t("toJustify", { count: toJustify })}</p> : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
    </Card>
  );
}

function OutstandingCard({ subject, href }: { subject: FamilySubject; href: string }) {
  const t = useTranslations("v2Portal.family.snapshot.finance");
  const money = useMoney();
  const statement = useFamilyStatement(learnerIdOf(subject));
  const waiting = learnerIdOf(subject) === null;
  return (
    <Card title={t("title")} href={href} hrefLabel={t("details")}>
      {waiting || statement.isPending ? <LoadingBlock className="py-2" /> : statement.isError ? <Unavailable /> : (
        <>
          <p className="text-3xl font-semibold tabular-nums">{money.of(statement.data.totals.outstanding)}</p>
          <p className="text-sm text-muted-foreground">{t("billed", { amount: money.of(statement.data.totals.billed) })}</p>
        </>
      )}
    </Card>
  );
}

function UpcomingCard({ subject, href }: { subject: FamilySubject; href: string }) {
  const t = useTranslations("v2Portal.family.snapshot.upcoming");
  const format = useFormatter();
  const labels = useFamilyLabels(subject);
  const today = todayCivil();
  const window = { from: today, to: addDays(today, 7) };
  const mine = useMyTimetable(window, subject.kind === "me");
  const child = useChildTimetable(subject.kind === "child" ? subject.id : null, window);
  const q = subject.kind === "me" ? mine : child;
  const now = new Date().toISOString();
  const next = (q.data?.items ?? []).filter((o) => o.status !== "CANCELLED" && o.endsAt >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 3);
  return (
    <Card title={t("title")} href={href} hrefLabel={t("details")}>
      {q.isPending ? <LoadingBlock className="py-2" /> : q.isError ? <Unavailable /> : next.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {next.map((o) => (
            <li key={o.id}>
              <span className="font-medium tabular-nums">{format.dateTime(new Date(o.startsAt), { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span> {o.title ?? labels.node(o.curriculumNodeId) ?? t("session")}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Annonces : le module de messagerie est livré à part ; tant qu'il n'est pas activé, un message l'indique et aucun écran fantôme n'est proposé. */
export function AnnouncementsEntry() {
  const t = useTranslations("v2Portal.family.snapshot.announcements");
  const entry = messagingEntry("announcements");
  return (
    <section aria-label={t("title")} className="rounded-lg border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("title")}</h3>
      {entry ? (
        <Link href={entry} className={`${buttonClass.secondary} mt-2`}>
          {t("open")}
        </Link>
      ) : (
        <Notice kind="info" className="mt-2">
          {t("soon")}
        </Notice>
      )}
    </section>
  );
}
