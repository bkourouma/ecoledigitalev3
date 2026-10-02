"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ExamSessionDetailDto, ExamSessionStatus } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { useDescribeError } from "@/platform/ui/errors";
import { useExamSession, useInstantiateSession, useTransitionSession } from "@/platform/v2/examinations";
import { DemoBanner, Phases, sessionTone, StatusPill, useExamLabels } from "./shared";

function Counts({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.sessionDetail.counts");
  const entries: Array<[string, number]> = [
    ["candidates", session.counts.candidates],
    ["registered", session.counts.registered],
    ["withdrawn", session.counts.withdrawn],
    ["eligible", session.counts.eligible],
    ["assigned", session.counts.assigned],
    ["withResult", session.counts.withResult],
    ["published", session.counts.published],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label={t("label")}>
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">{t(key as never)}</dt>
          <dd className="text-xl font-semibold" data-testid={`count-${key}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Détail d'une session : parcours, effectifs, épreuves figées, blocages de chaque transition et accès aux écrans de la session. */
export function SessionDetailScreen({ id }: { id: string }) {
  const t = useTranslations("v2Examinations.sessionDetail");
  const labels = useExamLabels();
  const date = useDateFormat();
  const describe = useDescribeError();
  const flash = useFlash();
  const query = useExamSession(id);
  const instantiate = useInstantiateSession(id);
  const transition = useTransitionSession(id);
  const [confirm, setConfirm] = useState<ExamSessionStatus | null>(null);

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const s = query.data;
  const locked = s.definitionLockedAt !== null;

  async function runTransition(to: ExamSessionStatus) {
    flash.show(null);
    try {
      await transition.mutateAsync({ to });
      setConfirm(null);
      flash.show(t("transitioned", { status: labels.sessionStatus(to) }));
    } catch {
      /* l'erreur de l'API est affichée sous les actions */
    }
  }

  async function runInstantiate() {
    flash.show(null);
    try {
      const out = await instantiate.mutateAsync();
      flash.show(t("instantiated", { count: out.paperCount }));
    } catch {
      /* idem */
    }
  }

  const links: Array<{ href: string; label: string; show: boolean }> = [
    { href: "/v2/examinations/candidates", label: t("links.candidates"), show: true },
    { href: "/v2/examinations/assignments", label: t("links.assignments"), show: true },
    { href: "/v2/examinations/results", label: t("links.results"), show: true },
    { href: "/v2/examinations/imports", label: t("links.imports"), show: s.sessionKind === "OFFICIAL" },
    { href: "/v2/examinations/mock", label: t("links.mock"), show: s.sessionKind === "MOCK" },
    { href: "/v2/examinations/statistics", label: t("links.statistics"), show: true },
    { href: "/v2/examinations/corrections", label: t("links.corrections"), show: true },
    { href: "/v2/examinations/exports", label: t("links.exports"), show: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.label}
        description={`${s.examTypeLabel} ${s.sessionYear} — ${labels.sessionKind(s.sessionKind)}`}
        actions={
          <Link href="/v2/examinations" className={buttonClass.secondary}>
            {t("back")}
          </Link>
        }
      />
      <DemoBanner visible={s.demoRules} />
      {flash.node}
      <section aria-labelledby="phases-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="phases-title" className="text-lg font-semibold">
            {t("phases")}
          </h2>
          <StatusPill label={labels.sessionStatus(s.status)} tone={sessionTone(s.status)} />
        </div>
        <Phases status={s.status} />
      </section>

      <section aria-labelledby="counts-title" className="space-y-3">
        <h2 id="counts-title" className="text-lg font-semibold">
          {t("countsTitle")}
        </h2>
        <Counts session={s} />
      </section>

      <section aria-labelledby="dates-title" className="space-y-3">
        <h2 id="dates-title" className="text-lg font-semibold">
          {t("dates")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["registrationOpensOn", s.registrationOpensOn],
              ["registrationClosesOn", s.registrationClosesOn],
              ["startsOn", s.startsOn],
              ["endsOn", s.endsOn],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{t(`date.${key}` as never)}</dt>
              <dd className="font-medium">{date.civil(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Can permission="exam.session.manage">
        <section aria-labelledby="actions-title" className="space-y-3">
          <h2 id="actions-title" className="text-lg font-semibold">
            {t("actions")}
          </h2>
          {!locked ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t("notLocked")}</p>
              <button type="button" className={buttonClass.primary} disabled={instantiate.isPending} onClick={() => void runInstantiate()}>
                {t("instantiate")}
              </button>
              {instantiate.isError ? <ErrorBlock error={instantiate.error} /> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("locked", { date: date.instant(s.definitionLockedAt) })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {s.progress.allowedNext.map((to) => {
              const blockers = s.blockers[to] ?? [];
              return (
                <div key={to} className="flex flex-col gap-1">
                  <button type="button" className={to === "PUBLISHED" ? buttonClass.danger : buttonClass.secondary} disabled={transition.isPending || blockers.length > 0} onClick={() => (to === "PUBLISHED" ? setConfirm(to) : void runTransition(to))}>
                    {t("moveTo", { status: labels.sessionStatus(to) })}
                  </button>
                  {blockers.length > 0 ? (
                    <ul aria-label={t("blockers", { status: labels.sessionStatus(to) })} className="max-w-xs list-disc pl-5 text-xs text-muted-foreground">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
          {s.progress.allowedNext.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTransition")}</p> : null}
          {transition.isError ? <Notice kind="error">{describe(transition.error)}</Notice> : null}
        </section>
      </Can>

      <section aria-labelledby="papers-title" className="space-y-3">
        <h2 id="papers-title" className="text-lg font-semibold">
          {t("papers")}
        </h2>
        {s.papers.length === 0 ? (
          <EmptyBlock title={t("noPapers")} description={t("noPapersHint")} />
        ) : (
          <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("papers")}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t("papers")}</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("paper.code")}</th>
                  <th scope="col" className="px-3 py-2">{t("paper.label")}</th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("paper.track")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("paper.coefficient")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("paper.scaleMax")}</th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("paper.source")}</th>
                </tr>
              </thead>
              <tbody>
                {s.papers.map((p) => (
                  <tr key={p.id} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{p.code}</th>
                    <td className="px-3 py-2">
                      {p.label}
                      {p.isOptional ? <span className="ml-2 text-xs text-muted-foreground">({t("paper.optional")})</span> : null}
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">{p.trackCode ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{showDecimal(p.coefficient)}</td>
                    <td className="px-3 py-2 text-right">{showDecimal(p.scaleMax)}</td>
                    <td className="hidden px-3 py-2 md:table-cell">{labels.source(p.sourceKind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="links-title" className="space-y-3">
        <h2 id="links-title" className="text-lg font-semibold">
          {t("linksTitle")}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <li key={l.href}>
                <Link href={`${l.href}?session=${s.id}`} className={buttonClass.secondary}>
                  {l.label}
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <ModalDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} title={t("publishConfirm.title")} description={t("publishConfirm.body", { count: s.counts.withResult })}>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass.secondary} onClick={() => setConfirm(null)}>
            {t("publishConfirm.cancel")}
          </button>
          <button type="button" className={buttonClass.danger} disabled={transition.isPending} onClick={() => confirm && void runTransition(confirm)}>
            {t("publishConfirm.confirm")}
          </button>
        </div>
        {transition.isError ? <Notice kind="error" className="mt-3">{describe(transition.error)}</Notice> : null}
      </ModalDialog>
    </div>
  );
}
