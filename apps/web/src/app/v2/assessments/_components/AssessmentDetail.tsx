"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAssessment, useAssessmentTransitions, useAssessmentTypes } from "@/platform/v2/assess";
import { useClassroom } from "@/platform/v2/academic";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { usePermission } from "@/platform/access";
import { toneOfStatus, useNodeLabels, usePeriodsOfClassroom } from "./shared";
import { WorkflowBar } from "./WorkflowBar";
import { RevisionList } from "./RevisionsScreen";

export function AssessmentDetail({ id }: { id: string }) {
  const t = useTranslations("v2Assess.detail");
  const tStatus = useTranslations("v2Assess.status");
  const date = useDateFormat();
  const query = useAssessment(id);
  const a = query.data;
  const classroom = useClassroom(a?.classroomId ?? null);
  const { periods } = usePeriodsOfClassroom(a?.classroomId ?? null);
  const nodeLabels = useNodeLabels(a?.classroomId ?? null);
  const types = useAssessmentTypes();
  const transitions = useAssessmentTransitions(id);
  const flash = useFlash();
  const canSeeRevisions = usePermission("grade.revise.approve");
  const canRequest = usePermission("grade.revise.request");
  const typeLabel = useMemo(() => types.data?.find((x) => x.id === a?.typeId)?.label ?? a?.typeCode ?? "—", [types.data, a]);

  return (
    <QueryBoundary query={query}>
      {a ? (
        <div className="space-y-6">
          <PageHeader
            title={a.title}
            description={[classroom.data?.name, nodeLabels.get(a.curriculumNodeId)].filter(Boolean).join(" · ")}
            actions={
              <>
                <StatusBadge label={tStatus(a.status)} tone={toneOfStatus(a.status)} />
                <Link href={`/v2/assessments/${a.id}/grades`} className={buttonClass.primary}>
                  {a.status === "DRAFT" ? t("enterGrades") : t("viewGrades")}
                </Link>
              </>
            }
          />
          {flash.node}
          {a.returnComment && a.status === "DRAFT" ? <Notice kind="warning">{t("returned", { comment: a.returnComment })}</Notice> : null}
          {a.status === "CANCELLED" ? <Notice kind="warning">{t("cancelled", { reason: a.cancelReason ?? "" })}</Notice> : null}
          {a.fourEyesWaived ? <Notice kind="info">{t("fourEyesWaived")}</Notice> : null}

          <WorkflowBar assessment={a} unsaved={false} onSaveRequest={async () => true} onMessage={flash.show} />

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label={t("type")}>{typeLabel}</Info>
            <Info label={t("date")}>{date.civil(a.assessedOn)}</Info>
            <Info label={t("period")}>{periods.find((p) => p.id === a.academicPeriodId)?.label ?? "—"}</Info>
            <Info label={t("scale")}>{a.scaleMax.replace(".", ",")}</Info>
            <Info label={t("weight")}>{a.weight.replace(".", ",")}</Info>
            <Info label={t("session")}>{a.sessionNo === 2 ? t("session2") : t("session1")}</Info>
          </dl>

          <section aria-labelledby="trail-h">
            <h2 id="trail-h" className="mb-2 text-lg font-semibold">
              {t("trail")}
            </h2>
            {transitions.isPending && transitions.fetchStatus !== "idle" ? (
              <LoadingBlock />
            ) : transitions.isError ? (
              <p className="text-sm text-muted-foreground">{t("trailUnavailable")}</p>
            ) : (transitions.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("trailEmpty")}</p>
            ) : (
              <ol className="space-y-2">
                {(transitions.data ?? []).map((tr) => (
                  <li key={tr.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">
                      {tr.from ? `${tStatus(tr.from)} → ` : ""}
                      {tStatus(tr.to)}
                    </p>
                    <p className="text-muted-foreground">{t("by", { name: tr.actorName ?? "—", date: date.instant(tr.at) })}</p>
                    {tr.comment ? <p>{tr.comment}</p> : null}
                    {tr.fourEyesWaived ? <p className="text-xs text-muted-foreground">{t("fourEyesWaivedShort")}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {a.status === "PUBLISHED" || a.status === "CANCELLED" ? (
            canSeeRevisions.allowed || canRequest.allowed ? (
              <section aria-labelledby="rev-h">
                <h2 id="rev-h" className="mb-2 text-lg font-semibold">
                  {t("revisions")}
                </h2>
                <RevisionList assessmentId={a.id} compact />
              </section>
            ) : null
          ) : null}
        </div>
      ) : null}
    </QueryBoundary>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

