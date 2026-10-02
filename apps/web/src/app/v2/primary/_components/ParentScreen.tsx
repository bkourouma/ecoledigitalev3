"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PrimaryAnnualReviewDto, PrimaryCompetencySummaryDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useMyChildren, useMyStudentRecord } from "@/platform/v2/people";
import { useChildPrimaryAnnualReviews, useMyPrimaryAnnualReviews, usePrimaryChildCompetencySummary, usePrimaryCompetencySummary } from "@/platform/v2/primary";
import { PlaceholderNotice, PrimaryError, shortHash, toneOfReview, useCodeLabels } from "./shared";
import { SummaryCounts } from "./SummaryCounts";

/** Compteurs d'un bilan scellé (instantané) : pas de libellés dans l'instantané, les codes s'affichent tels quels. */
const snapshotSummary = (r: PrimaryAnnualReviewDto): PrimaryCompetencySummaryDto => ({ enrollmentId: r.enrollmentId, periodIds: null, summary: r.competencySummary, domainLabels: {}, levelLabels: {}, levelOrder: [] });

/**
 * « Bulletin et compétences de mon enfant » (parent) ou « de mon parcours » (élève) : bilans annuels SCELLÉS et PUBLIÉS, et synthèse
 * de compétences par COMPTEURS des périodes publiées. Aucune moyenne, aucun pourcentage : des comptages et des codes traduits. Hors lien
 * de tutelle, l'API répond 404 : message neutre.
 */
export function ParentScreen() {
  const t = useTranslations("v2PrimaryParent");
  const child = usePermission("primary.bilan.child.read");
  const self = usePermission("primary.bilan.self.read");
  const childRead = child.allowed;
  const selfRead = self.allowed;
  return (
    <div className="space-y-4">
      <PageHeader title={childRead || !selfRead ? t("title") : t("titleSelf")} description={childRead || !selfRead ? t("description") : t("descriptionSelf")} />
      {child.isLoading || self.isLoading ? <LoadingBlock /> : childRead ? <ChildView /> : selfRead ? <SelfView /> : <Notice kind="info">{t("noAccess")}</Notice>}
    </div>
  );
}

function ChildView() {
  const t = useTranslations("v2PrimaryParent");
  const children = useMyChildren();
  const [studentId, setStudentId] = useState("");
  useEffect(() => {
    if (!studentId && children.data && children.data.length === 1) setStudentId(children.data[0]!.id);
  }, [children.data, studentId]);
  const child = children.data?.find((c) => c.id === studentId) ?? null;
  const reviews = useChildPrimaryAnnualReviews(studentId || null);
  const enrollmentId = child?.currentEnrollment?.enrollmentId ?? null;
  const summary = usePrimaryChildCompetencySummary(studentId || null, enrollmentId);

  if (children.isPending) return <LoadingBlock />;
  if (children.isError) return <PrimaryError error={children.error} />;
  if (children.data.length === 0) return <EmptyBlock title={t("noChild")} description={t("noChildHint")} />;
  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <FormField label={t("child")}>
          {(c) => <NativeSelect {...c} value={studentId} onChange={setStudentId} placeholder={t("chooseChild")} options={children.data.map((x) => ({ value: x.id, label: x.currentEnrollment?.classroomName ? `${x.displayName} — ${x.currentEnrollment.classroomName}` : x.displayName }))} />}
        </FormField>
      </div>
      {!studentId ? (
        <Notice kind="info">{t("chooseChildFirst")}</Notice>
      ) : (
        <>
          <ReviewsList query={reviews} />
          {enrollmentId ? <SummaryBlock query={summary} /> : null}
        </>
      )}
    </div>
  );
}

function SelfView() {
  const reviews = useMyPrimaryAnnualReviews();
  const me = useMyStudentRecord();
  const enrollmentId = me.data?.currentEnrollment?.enrollmentId ?? null;
  const summary = usePrimaryCompetencySummary(enrollmentId, null);
  return (
    <div className="space-y-6">
      <ReviewsList query={reviews} />
      {enrollmentId ? <SummaryBlock query={summary} /> : null}
    </div>
  );
}

interface ReviewsQuery {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data?: PrimaryAnnualReviewDto[];
}

function ReviewsList({ query }: { query: ReviewsQuery }) {
  const t = useTranslations("v2PrimaryParent");
  const label = useCodeLabels();
  const dateFmt = useDateFormat();
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <PrimaryError error={query.error} />;
  const items = query.data ?? [];
  return (
    <section aria-labelledby="parent-reviews" className="space-y-3">
      <h2 id="parent-reviews" className="text-lg font-semibold">
        {t("reviews.title")}
      </h2>
      {items.length === 0 ? (
        <EmptyBlock title={t("reviews.empty")} description={t("reviews.emptyHint")} />
      ) : (
        <>
          {items.some((r) => r.ruleSourceKind === "placeholder") ? <PlaceholderNotice compact /> : null}
          <ul className="space-y-4">
            {items.map((r) => (
              <li key={r.id}>
                <article aria-label={t("reviews.articleLabel", { level: r.gradeLevelCode, version: r.version })} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{t("reviews.level", { level: r.gradeLevelCode })}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={label("reviewStatus", r.status)} tone={toneOfReview(r.status)} />
                      <StatusBadge label={t("reviews.version", { n: r.version })} tone="neutral" />
                      {r.ruleSourceKind === "placeholder" ? <StatusBadge label={t("reviews.placeholder")} tone="warning" /> : null}
                    </div>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("reviews.outcome")}</dt>
                      <dd>{label("outcomeCode", r.outcomeCode)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("reviews.sealedAt")}</dt>
                      <dd>{dateFmt.instant(r.sealedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("reviews.hash")}</dt>
                      <dd className="font-mono text-xs" title={r.contentHash ?? undefined}>
                        {shortHash(r.contentHash)}
                      </dd>
                    </div>
                  </dl>
                  <div>
                    <h3 className="mb-1 text-sm font-medium">{t("reviews.competencies")}</h3>
                    <SummaryCounts data={snapshotSummary(r)} />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SummaryBlock({ query }: { query: { isPending: boolean; isError: boolean; error: unknown; data?: PrimaryCompetencySummaryDto } }) {
  const t = useTranslations("v2PrimaryParent");
  return (
    <section aria-labelledby="parent-summary" className="space-y-3">
      <h2 id="parent-summary" className="text-lg font-semibold">
        {t("summary.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("summary.hint")}</p>
      {query.isPending ? <LoadingBlock /> : query.isError ? <PrimaryError error={query.error} /> : query.data ? <SummaryCounts data={query.data} /> : null}
    </section>
  );
}
