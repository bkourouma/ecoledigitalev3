"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AdmissionsApplicationSummaryDto, AdmissionsBoardDto, AdmissionsStageDto } from "@ecoledigitale/contracts/v2/admissions";
import { useAdmissionsLookups, useBoard, useTransitionApplication } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { CampaignPicker, useSelectedCampaign } from "./AdmissionsShell";
import { fullName, statusTone } from "./admissions-utils";

type Column = AdmissionsBoardDto["columns"][number];

/**
 * Pipeline des candidatures (kanban). Chaque colonne est une ÉTAPE du workflow de l'établissement ; le statut canonique est
 * affiché en pastille. Le déplacement se fait par le bouton « Déplacer » de chaque carte (clavier, lecteur d'écran, tactile) :
 * les destinations viennent des transitions DÉCLARÉES par le workflow, la permission de chaque transition est contrôlée par l'API.
 */
export function PipelineScreen() {
  const t = useTranslations("v2Admissions.pipeline");
  const tc = useTranslations("v2Admissions.common");
  const { query: campaignsQuery, campaigns, campaignId, select } = useSelectedCampaign();
  const [grade, setGrade] = useState("");
  const lookups = useAdmissionsLookups();
  const board = useBoard({ campaignId, grade: grade || undefined });
  const [moving, setMoving] = useState<{ card: AdmissionsApplicationSummaryDto; column: Column } | null>(null);
  const flash = useFlash();

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="admission.create">
            <Link href="/v2/admissions/applications/new" className={buttonClass.primary}>
              {t("new")}
            </Link>
          </Can>
        }
      />
      {flash.node}
      {campaignsQuery.isPending ? <LoadingBlock /> : null}
      {campaignsQuery.isError ? <ErrorBlock error={campaignsQuery.error} onRetry={() => void campaignsQuery.refetch()} /> : null}
      {campaignsQuery.isSuccess && campaigns.length === 0 ? (
        <EmptyBlock
          title={t("noCampaign")}
          description={t("noCampaignHint")}
          action={
            <Can permission="admission.campaign.manage">
              <Link href="/v2/admissions/campaigns" className={buttonClass.primary}>
                {t("createCampaign")}
              </Link>
            </Can>
          }
        />
      ) : null}
      {campaigns.length > 0 ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <CampaignPicker campaigns={campaigns} value={campaignId} onChange={select} />
            <FormField label={tc("grade")}>
              {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={tc("allGrades")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
            </FormField>
          </div>
          {board.isPending ? <LoadingBlock /> : null}
          {board.isError ? <ErrorBlock error={board.error} onRetry={() => void board.refetch()} /> : null}
          {board.isSuccess ? (
            <div className="-mx-4 overflow-x-auto px-4 pb-4" role="region" aria-label={t("boardLabel")} tabIndex={0}>
              <ul className="flex min-w-max items-start gap-3">
                {board.data.columns.map((column) => (
                  <ColumnView key={column.stage.id} column={column} onMove={(card) => setMoving({ card, column })} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      {moving && board.data ? (
        <MoveDialog
          board={board.data}
          card={moving.card}
          column={moving.column}
          onClose={() => setMoving(null)}
          onMoved={(label) => {
            setMoving(null);
            flash.show(t("moved", { stage: label }));
          }}
        />
      ) : null}
    </div>
  );
}

function ColumnView({ column, onMove }: { column: Column; onMove: (card: AdmissionsApplicationSummaryDto) => void }) {
  const t = useTranslations("v2Admissions.pipeline");
  const ts = useTranslations("v2Admissions.status");
  const headingId = `col-${column.stage.id}`;
  return (
    <li className="w-72 shrink-0 rounded-lg border bg-muted/30">
      <section aria-labelledby={headingId}>
        <header className="flex items-start justify-between gap-2 border-b p-3">
          <div className="min-w-0">
            <h2 id={headingId} className="truncate text-sm font-semibold">
              {column.stage.label}
            </h2>
            <StatusBadge className="mt-1" label={ts(column.stage.canonicalStatus)} tone={statusTone(column.stage.canonicalStatus)} />
          </div>
          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium" aria-label={t("count", { count: column.total })}>
            {column.total}
          </span>
        </header>
        <ul className="space-y-2 p-2">
          {column.cards.length === 0 ? <li className="px-1 py-3 text-center text-xs text-muted-foreground">{t("emptyColumn")}</li> : null}
          {column.cards.map((card) => (
            <li key={card.id} className="rounded-md border bg-background p-3 text-sm shadow-sm">
              <Link href={`/v2/admissions/applications/${card.id}`} className="block font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {fullName(card)}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {card.applicationNumber} · {card.desiredGradeLevelCode}
              </p>
              {card.overdue ? <StatusBadge className="mt-1.5" label={t("overdue")} tone="danger" /> : null}
              <button type="button" className={`${buttonClass.secondary} mt-2 w-full`} onClick={() => onMove(card)} aria-label={t("moveAria", { name: fullName(card) })}>
                {t("move")}
              </button>
            </li>
          ))}
          {column.total > column.cards.length ? <li className="px-1 py-2 text-center text-xs text-muted-foreground">{t("more", { count: column.total - column.cards.length })}</li> : null}
        </ul>
      </section>
    </li>
  );
}

function MoveDialog({ board, card, column, onClose, onMoved }: { board: AdmissionsBoardDto; card: AdmissionsApplicationSummaryDto; column: Column; onClose: () => void; onMoved: (stageLabel: string) => void }) {
  const t = useTranslations("v2Admissions.pipeline");
  const ts = useTranslations("v2Admissions.status");
  const describe = useDescribeError();
  const action = useTransitionApplication();
  const stages = new Map<string, AdmissionsStageDto>(board.columns.map((c) => [c.stage.id, c.stage]));
  const options = board.transitions
    .filter((tr) => tr.fromStageId === column.stage.id && !tr.isAutomatic)
    .map((tr) => ({ transition: tr, stage: stages.get(tr.toStageId) }))
    .filter((o): o is { transition: (typeof board.transitions)[number]; stage: AdmissionsStageDto } => o.stage !== undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const current = options.find((o) => o.stage.id === picked) ?? null;
  const reasonMissing = current?.transition.requiresReason === true && reason.trim().length < 3;

  function confirm() {
    if (!current) return;
    setTouched(true);
    if (reasonMissing) return;
    action.mutate(
      { id: card.id, body: { toStageId: current.stage.id, ...(reason.trim() ? { reason: reason.trim() } : {}) } },
      { onSuccess: () => onMoved(current.stage.label) },
    );
  }

  return (
    <ModalDialog open onOpenChange={(open) => (!open ? onClose() : undefined)} title={t("moveTitle", { name: fullName(card) })} description={t("moveDescription", { stage: column.stage.label })}>
      {options.length === 0 ? <Notice kind="info">{t("noDestination")}</Notice> : null}
      <ul className="space-y-2">
        {options.map(({ transition, stage }) => (
          <li key={transition.id}>
            {stage.requiresDecision ? (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {stage.label} <StatusBadge label={ts(stage.canonicalStatus)} tone={statusTone(stage.canonicalStatus)} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("needsDecision")}</p>
                <Link href={`/v2/admissions/applications/${card.id}`} className={`${buttonClass.secondary} mt-2`}>
                  {t("openToDecide")}
                </Link>
              </div>
            ) : (
              <button
                type="button"
                aria-pressed={picked === stage.id}
                onClick={() => setPicked(stage.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border p-3 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${picked === stage.id ? "border-primary bg-accent" : ""}`}
              >
                <span className="font-medium">{stage.label}</span>
                <StatusBadge label={ts(stage.canonicalStatus)} tone={statusTone(stage.canonicalStatus)} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {current?.transition.requiresReason ? (
        <FormField className="mt-3" label={t("reason")} required error={touched && reasonMissing ? t("reasonRequired") : null}>
          {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
        </FormField>
      ) : null}
      {action.error ? (
        <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {describe(action.error)}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonClass.secondary} onClick={onClose}>
          {t("cancel")}
        </button>
        <button type="button" className={buttonClass.primary} disabled={!current || action.isPending} onClick={confirm}>
          {t("confirmMove")}
        </button>
      </div>
    </ModalDialog>
  );
}
