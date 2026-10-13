"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ResponsiveTable, type Column } from "@ecoledigitale/ui";
import type { PrimaryAnnualReviewDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { useMyPrimaryClassrooms, usePreparePrimaryReviews, usePrimaryAnnualReviews, useReissuePrimaryReview, useSealPrimaryReview } from "@/platform/v2/primary";
import { classLabel, ConfirmActionDialog, FeatureGate, PlaceholderNotice, PrimaryError, RuleBanner, shortHash, toneOfReview, useCodeLabels, useYearOptions } from "./shared";

/**
 * Bilans annuels (direction) : préparer les brouillons d'une classe et d'une année, suivre leur statut, SCELLER (acte sensible, les
 * manques renvoyés par l'API en 409 sont affichés) et RÉÉMETTRE (version n+1 avec motif). Aucune décision n'est calculée ici : le
 * bilan reprend le résultat d'année et la décision du conseil.
 */
export function ReviewsScreen() {
  return (
    <FeatureGate feature="primary.annual-review">
      <ReviewsBody />
    </FeatureGate>
  );
}

function ReviewsBody() {
  const t = useTranslations("v2PrimaryReviews");
  const label = useCodeLabels();
  const dateFmt = useDateFormat();
  const classes = useMyPrimaryClassrooms();
  const years = useYearOptions(classes.data ?? []);
  const canPrepare = usePermission("primary.bilan.prepare").allowed;
  const canSeal = usePermission("primary.bilan.seal").allowed;
  const canReissue = usePermission("primary.bilan.reissue").allowed;
  const [yearId, setYearId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const list = useMemo(() => (classes.data ?? []).filter((c) => !yearId || c.academicYearId === yearId), [classes.data, yearId]);
  const reviews = usePrimaryAnnualReviews({ classroomId, yearId }, Boolean(classroomId && yearId));
  const prepare = usePreparePrimaryReviews();
  const seal = useSealPrimaryReview();
  const reissue = useReissuePrimaryReview();
  const [sealing, setSealing] = useState<PrimaryAnnualReviewDto | null>(null);
  const [reissuing, setReissuing] = useState<PrimaryAnnualReviewDto | null>(null);
  const flash = useFlash();

  useEffect(() => {
    if (!yearId && years.length === 1) setYearId(years[0]!.value);
  }, [years, yearId]);
  useEffect(() => {
    if (classroomId && !list.some((c) => c.classroomId === classroomId)) setClassroomId("");
    if (!classroomId && list.length === 1) setClassroomId(list[0]!.classroomId);
  }, [list, classroomId]);

  async function doPrepare() {
    flash.show(null);
    try {
      const r = await prepare.mutateAsync({ classroomId, academicYearId: yearId });
      flash.show(t("prepared", { created: r.created, refreshed: r.refreshed, skipped: r.skippedSealed }));
    } catch {
      /* affichée sous le bouton */
    }
  }

  async function doSeal() {
    if (!sealing) return;
    try {
      await seal.mutateAsync({ id: sealing.id });
      flash.show(t("sealed", { name: sealing.studentName ?? sealing.studentId.slice(0, 8) }));
      setSealing(null);
    } catch {
      /* le refus (manques) reste affiché dans la fenêtre */
    }
  }

  const rows = reviews.data ?? [];
  const hasPlaceholder = rows.some((r) => r.ruleSourceKind === "placeholder");

  const columns: Column<PrimaryAnnualReviewDto>[] = [
    { key: "student", header: t("columns.student"), label: t("columns.student"), cell: (r) => <span className="font-medium">{r.studentName ?? r.studentId.slice(0, 8)}</span> },
    { key: "version", header: t("columns.version"), label: t("columns.version"), cell: (r) => t("version", { n: r.version }) },
    { key: "status", header: t("columns.status"), label: t("columns.status"), cell: (r) => <StatusBadge label={label("reviewStatus", r.status)} tone={toneOfReview(r.status)} /> },
    { key: "outcome", header: t("columns.outcome"), label: t("columns.outcome"), cell: (r) => label("outcomeCode", r.outcomeCode) },
    {
      key: "hash",
      header: t("columns.hash"),
      label: t("columns.hash"),
      cell: (r) => (
        <span className="font-mono text-xs" title={r.contentHash ?? undefined}>
          {shortHash(r.contentHash)}
          {r.sealedAt ? <span className="block font-sans text-muted-foreground">{t("sealedAt", { date: dateFmt.instant(r.sealedAt) })}</span> : null}
        </span>
      ),
    },
    {
      key: "rules",
      header: t("columns.rules"),
      label: t("columns.rules"),
      cell: (r) => (r.ruleSourceKind === "placeholder" ? <StatusBadge label={t("placeholder")} tone="warning" /> : <span className="text-muted-foreground">—</span>),
      hideOnMobile: false,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      label: t("columns.actions"),
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          {canSeal && (r.status === "DRAFT" || r.status === "READY") ? (
            <button type="button" className={buttonClass.primary} onClick={() => setSealing(r)} aria-label={t("sealFor", { name: r.studentName ?? r.studentId.slice(0, 8) })}>
              {t("seal")}
            </button>
          ) : null}
          {canReissue && r.status === "SEALED" ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setReissuing(r)} aria-label={t("reissueFor", { name: r.studentName ?? r.studentId.slice(0, 8) })}>
              {t("reissue")}
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner classroomId={classroomId || null} />
      {flash.node}
      <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <legend className="px-1 text-sm font-medium">{t("pickers")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("year")}>
            {(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} placeholder={t("chooseYear")} options={years} />}
          </FormField>
          <FormField label={t("classroom")}>
            {(c) => <NativeSelect {...c} value={classroomId} onChange={setClassroomId} placeholder={t("chooseClassroom")} options={list.map((x) => ({ value: x.classroomId, label: classLabel(x) }))} />}
          </FormField>
        </div>
        {canPrepare ? (
          <div className="space-y-2">
            <button type="button" className={buttonClass.primary} disabled={!classroomId || !yearId || prepare.isPending} onClick={() => void doPrepare()}>
              {prepare.isPending ? t("preparing") : t("prepare")}
            </button>
            <p className="text-xs text-muted-foreground">{t("prepareHint")}</p>
            <PrimaryError error={prepare.error} />
          </div>
        ) : null}
      </fieldset>

      {!classroomId || !yearId ? (
        <Notice kind="info">{t("chooseBoth")}</Notice>
      ) : (
        <>
          {hasPlaceholder ? <PlaceholderNotice compact /> : null}
          <QueryBoundary query={reviews} isEmpty={rows.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
            <ResponsiveTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("caption")} />
          </QueryBoundary>
        </>
      )}

      <ConfirmActionDialog
        open={sealing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setSealing(null);
            seal.reset();
          }
        }}
        title={t("sealDialog.title")}
        description={t("sealDialog.description")}
        confirmLabel={t("sealDialog.confirm")}
        isPending={seal.isPending}
        error={seal.error}
        onConfirm={() => void doSeal()}
      >
        <p className="text-sm font-medium">{sealing ? (sealing.studentName ?? sealing.studentId.slice(0, 8)) : ""}</p>
      </ConfirmActionDialog>

      <ReasonDialog
        open={reissuing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setReissuing(null);
            reissue.reset();
          }
        }}
        title={t("reissueDialog.title")}
        description={t("reissueDialog.description")}
        reasonLabel={t("reissueDialog.reason")}
        confirmLabel={t("reissueDialog.confirm")}
        minLength={10}
        maxLength={1000}
        isPending={reissue.isPending}
        error={reissue.error}
        onConfirm={async (reason) => {
          if (!reissuing) return;
          try {
            await reissue.mutateAsync({ id: reissuing.id, reason });
            flash.show(t("reissued", { name: reissuing.studentName ?? reissuing.studentId.slice(0, 8) }));
            setReissuing(null);
          } catch {
            /* le refus reste affiché dans la fenêtre */
          }
        }}
      />
    </div>
  );
}
