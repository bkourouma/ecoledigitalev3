"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { REPORTCARDS_STATUSES, type ReportcardsDocumentKind } from "@ecoledigitale/contracts/v2/reportcards";
import type { z } from "zod";
import type { reportcardsReportCardDtoSchema } from "@ecoledigitale/contracts/v2/reportcards";
import { usePermission } from "@/platform/access";
import { cardDownloadPath, usePublishCard, usePublishMany, useReissueCard, useRenderCard, useReportCards, useRevokeCard, useWithdrawCard } from "@/platform/v2/reportcards";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";
import { toneOfStatus } from "../../assessments/_components/shared";
import { ClassPeriodSelector, useClassPeriodSelection } from "../../results/_components/shared";
import { DownloadButton } from "./shared";

export type ReportCard = z.infer<typeof reportcardsReportCardDtoSchema>;

export function CardsScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Reportcards.list");
  const tStatus = useTranslations("v2Reportcards.status");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [live, setLive] = useState(true);
  const [needsReissue, setNeedsReissue] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const query = useReportCards({ classroomId: sel.classroomId || undefined, academicPeriodId: sel.periodId || undefined, status: status || undefined, kind: kind || undefined, live: live || undefined, needsReissue: needsReissue || undefined });
  const publishMany = usePublishMany();
  const canPublish = usePermission("reportcard.publish");
  const flash = useFlash();
  const [bulkError, setBulkError] = useState<unknown>(null);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function bulkPublish() {
    setBulkError(null);
    try {
      const r = await publishMany.mutateAsync({ reportCardIds: [...selected] });
      flash.show(t("bulkDone", { published: r.published, already: r.alreadyPublished, skipped: r.skipped.length }));
      setSelected(new Set());
    } catch (e) {
      setBulkError(e);
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={REPORTCARDS_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("kind")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={kind}
              onChange={setKind}
              placeholder={t("allKinds")}
              options={(["REPORT_CARD", "TRANSCRIPT"] as ReportcardsDocumentKind[]).map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
            />
          )}
        </FormField>
        <CheckControl checked={live} onChange={setLive} label={t("liveOnly")} hint={t("liveOnlyHint")} />
        <CheckControl checked={needsReissue} onChange={setNeedsReissue} label={t("needsReissue")} hint={t("needsReissueHint")} />
      </form>
      {flash.node}
      {bulkError ? <ErrorBlock error={bulkError} /> : null}
      {canPublish.allowed && selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm" role="region" aria-label={t("bulkBar")}>
          <span>{t("selected", { count: selected.size })}</span>
          <button type="button" className={buttonClass.primary} onClick={() => void bulkPublish()} disabled={publishMany.isPending}>
            {t("publishSelected")}
          </button>
          <button type="button" className={buttonClass.ghost} onClick={() => setSelected(new Set())}>
            {t("clearSelection")}
          </button>
        </div>
      ) : null}

      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && rows.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {rows.length > 0 ? (
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {canPublish.allowed ? (
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">{t("columns.select")}</span>
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("columns.document")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.render")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((card) => (
                <CardRow key={card.id} card={card} selectable={canPublish.allowed} checked={selected.has(card.id)} onToggle={(on) => toggle(card.id, on)} onMessage={flash.show} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {query.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CardRow({ card, selectable, checked, onToggle, onMessage }: { card: ReportCard; selectable: boolean; checked: boolean; onToggle: (on: boolean) => void; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Reportcards.list");
  const tStatus = useTranslations("v2Reportcards.status");
  const tRender = useTranslations("v2Reportcards.renderStatus");
  const date = useDateFormat();
  const name = card.studentName;
  return (
    <tr className="border-t align-top">
      {selectable ? (
        <td className="px-3 py-2">
          <input type="checkbox" checked={checked} disabled={card.status !== "ISSUED"} onChange={(e) => onToggle(e.target.checked)} aria-label={t("selectOf", { name })} className="h-4 w-4 accent-primary" />
        </td>
      ) : null}
      <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">
        <Link href={`/v2/reportcards/${card.id}`} className="text-primary underline-offset-4 hover:underline">
          {name}
        </Link>
        <span className="block text-xs font-normal text-muted-foreground">{t("versionLine", { version: card.version })}</span>
      </th>
      <td className="hidden px-3 py-2 md:table-cell">
        <span className="block">{card.title}</span>
        <span className="block text-xs text-muted-foreground">{t("issuedAt", { date: date.instant(card.issuedAt) })}</span>
      </td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tStatus(card.status)} tone={toneOfStatus(card.status)} />
          {card.provisional ? <StatusBadge label={t("provisional")} tone="warning" /> : null}
          {card.needsReissue ? <StatusBadge label={t("outdated")} tone="warning" /> : null}
        </span>
      </td>
      <td className="hidden px-3 py-2 sm:table-cell">
        <StatusBadge label={tRender(card.renderStatus)} tone={toneOfStatus(card.renderStatus)} />
      </td>
      <td className="px-3 py-2 text-right">
        <CardActions card={card} onMessage={onMessage} />
      </td>
    </tr>
  );
}

/** Actions d'un bulletin selon son état et les permissions ; l'API décide (rendu prêt, droit, transition légale). */
export function CardActions({ card, onMessage }: { card: ReportCard; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Reportcards.list");
  const canPublish = usePermission("reportcard.publish");
  const canGenerate = usePermission("reportcard.generate");
  const canRevoke = usePermission("reportcard.revoke");
  const publish = usePublishCard();
  const withdraw = useWithdrawCard();
  const render = useRenderCard();
  const reissue = useReissueCard();
  const revoke = useRevokeCard();
  // Actes refusés en `reportcards.mfa_required` : confirmation d'identité (TOTP) puis relance unique.
  const stepUp = useStepUp();
  const [dialog, setDialog] = useState<"reissue" | "revoke" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const name = card.studentName;

  async function run(fn: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await stepUp.run(fn);
      onMessage(message);
    } catch (e) {
      setError(e);
    }
  }

  const live = card.status === "ISSUED" || card.status === "PUBLISHED";
  return (
    <>
      <span className="flex flex-wrap justify-end gap-1">
          {card.renderStatus === "RENDERED" && live ? <DownloadButton path={cardDownloadPath(card.id)} label={t("download")} ariaLabel={t("downloadOf", { name })} variant="ghost" /> : null}
          {card.status === "ISSUED" && !card.provisional && canPublish.allowed ? (
            <button type="button" className={buttonClass.secondary} onClick={() => void run(() => publish.mutateAsync({ id: card.id }), t("published", { name }))} disabled={publish.isPending || card.renderStatus !== "RENDERED"} aria-label={t("publishOf", { name })} title={card.renderStatus !== "RENDERED" ? t("notRendered") : undefined}>
              {t("publish")}
            </button>
          ) : null}
          {card.status === "PUBLISHED" && canPublish.allowed ? (
            <button type="button" className={buttonClass.secondary} onClick={() => void run(() => withdraw.mutateAsync({ id: card.id }), t("withdrawn", { name }))} disabled={withdraw.isPending} aria-label={t("withdrawOf", { name })}>
              {t("withdraw")}
            </button>
          ) : null}
          {card.renderStatus === "FAILED" && canGenerate.allowed ? (
            <button type="button" className={buttonClass.secondary} onClick={() => void run(() => render.mutateAsync({ id: card.id }), t("renderRequested", { name }))} disabled={render.isPending} aria-label={t("renderOf", { name })}>
              {t("render")}
            </button>
          ) : null}
          {live && canGenerate.allowed ? (
            <button type="button" className={buttonClass.ghost} onClick={() => setDialog("reissue")} aria-label={t("reissueOf", { name })}>
              {t("reissue")}
            </button>
          ) : null}
          {live && canRevoke.allowed ? (
            <button type="button" className={buttonClass.danger} onClick={() => setDialog("revoke")} aria-label={t("revokeOf", { name })}>
              {t("revoke")}
            </button>
          ) : null}
        </span>
      {error ? <ErrorBlock error={error} className="mt-2 max-w-xs" /> : null}
      {dialog === "reissue" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("reissueTitle", { name })}
          description={t("reissueDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("reissue")}
          isPending={reissue.isPending}
          error={reissue.error}
          onConfirm={async (reason) => {
            try {
              await stepUp.run(() => reissue.mutateAsync({ id: card.id, reason }));
              onMessage(t("reissued", { name }));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {dialog === "revoke" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("revokeTitle", { name })}
          description={t("revokeDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("revoke")}
          destructive
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={async (reason) => {
            try {
              await stepUp.run(() => revoke.mutateAsync({ id: card.id, reason }));
              onMessage(t("revoked", { name }));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      <StepUpDialog {...stepUp.dialogProps} />
    </>
  );
}
