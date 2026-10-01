"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AssessmentDto } from "@ecoledigitale/contracts/v2/assess";
import { usePermission } from "@/platform/access";
import { useCancelAssessment, useTransitionAssessment, type AssessTransitionTarget } from "@/platform/v2/assess";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock } from "@/platform/ui/states";

const STEPS = ["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "PUBLISHED"] as const;

/**
 * Boutons proposés selon l'état (affordance d'écran) ; la transition elle-même — légalité, séparation des tâches
 * (relecteur et approbateur distincts du saisissant), verrou de période, MFA — est décidée par l'API et son message
 * est affiché tel quel.
 */
const FORWARD: Record<string, { to: AssessTransitionTarget; permission: string } | undefined> = {
  DRAFT: { to: "SUBMITTED", permission: "grade.enter" },
  SUBMITTED: { to: "REVIEWED", permission: "grade.review" },
  REVIEWED: { to: "APPROVED", permission: "grade.validate" },
  APPROVED: { to: "PUBLISHED", permission: "grade.publish" },
};

export function WorkflowBar({ assessment, unsaved, onSaveRequest, onMessage }: { assessment: AssessmentDto; unsaved: boolean; onSaveRequest: () => Promise<boolean>; onMessage: (message: string) => void }) {
  const t = useTranslations("v2Assess.workflow");
  const tStatus = useTranslations("v2Assess.status");
  const transition = useTransitionAssessment();
  const cancel = useCancelAssessment();
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const forward = FORWARD[assessment.status];
  const canForward = usePermission(forward?.permission ?? "__none__");
  const canEnter = usePermission("grade.enter");
  const canReview = usePermission("grade.review");
  const canValidate = usePermission("grade.validate");
  const canPublish = usePermission("grade.publish");
  const canReviseReq = usePermission("grade.revise.request");
  const canUpdate = usePermission("assessment.update");
  const canManage = usePermission("assessment.manage");
  const canReturn = canEnter.allowed || canReview.allowed || canValidate.allowed || canPublish.allowed;
  const canCancel = canReviseReq.allowed || canUpdate.allowed || canManage.allowed;
  const currentIndex = STEPS.indexOf(assessment.status as (typeof STEPS)[number]);

  async function goForward() {
    if (!forward) return;
    setError(null);
    // Les saisies en cours partent d'abord : on ne soumet jamais une feuille dont des cellules ne sont pas enregistrées.
    if (forward.to === "SUBMITTED" && unsaved && !(await onSaveRequest())) return;
    try {
      const r = await transition.mutateAsync({ id: assessment.id, to: forward.to, rowVersion: assessment.rowVersion });
      onMessage(t(r.autoPublished ? "doneAuto" : `done.${forward.to}`));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section aria-label={t("label")} className="space-y-3 rounded-md border p-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label={t("steps")}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={s === assessment.status ? "step" : undefined} className={s === assessment.status ? "font-semibold text-primary" : i < currentIndex ? "text-emerald-700" : "text-muted-foreground"}>
            {i > 0 ? <span aria-hidden="true"> › </span> : null}
            {tStatus(s)}
            {i < currentIndex ? <span className="sr-only"> ({t("passed")})</span> : null}
            {s === assessment.status ? <span className="sr-only"> ({t("current")})</span> : null}
          </li>
        ))}
      </ol>
      {assessment.status === "CANCELLED" ? <p className="text-sm text-muted-foreground">{tStatus("CANCELLED")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {forward && canForward.allowed ? (
          <button type="button" className={buttonClass.primary} onClick={() => void goForward()} disabled={transition.isPending}>
            {t(`action.${forward.to}`)}
          </button>
        ) : null}
        {["SUBMITTED", "REVIEWED", "APPROVED"].includes(assessment.status) && canReturn ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setReturning(true)}>
            {t("action.DRAFT")}
          </button>
        ) : null}
        {assessment.status !== "CANCELLED" && canCancel ? (
          <button type="button" className={buttonClass.danger} onClick={() => setCancelling(true)}>
            {t("cancel")}
          </button>
        ) : null}
      </div>
      {assessment.status === "PUBLISHED" ? <p className="text-xs text-muted-foreground">{t("publishedHint")}</p> : null}
      {error ? <ErrorBlock error={error} /> : null}

      {returning ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setReturning(false)}
          title={t("returnTitle")}
          description={t("returnDescription")}
          reasonLabel={t("comment")}
          confirmLabel={t("action.DRAFT")}
          isPending={transition.isPending}
          error={transition.error}
          onConfirm={async (comment) => {
            try {
              await transition.mutateAsync({ id: assessment.id, to: "DRAFT", comment, rowVersion: assessment.rowVersion });
              onMessage(t("done.DRAFT"));
              setReturning(false);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {cancelling ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setCancelling(false)}
          title={t("cancelTitle")}
          description={t(assessment.status === "PUBLISHED" ? "cancelPublishedDescription" : "cancelDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("cancel")}
          minLength={10}
          destructive
          isPending={cancel.isPending}
          error={cancel.error}
          onConfirm={async (reason) => {
            try {
              const r = await cancel.mutateAsync({ id: assessment.id, reason });
              onMessage(t(r.assessment ? "cancelled" : "cancelRequested"));
              setCancelling(false);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </section>
  );
}
