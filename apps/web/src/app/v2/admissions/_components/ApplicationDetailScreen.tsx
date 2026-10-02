"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AdmissionsAllowedTransitionDto, AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { useApplication, useTransitionApplication } from "@/platform/v2/admissions";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { DecisionDialog } from "./DecisionDialog";
import { DossierDocuments } from "./DossierDocuments";
import { DossierInterviews } from "./DossierInterviews";
import { DossierDuplicates, DossierGuardians, DossierHistory, DossierPrivacy } from "./DossierMisc";
import { DossierOffers } from "./DossierOffers";
import { fullName, statusTone } from "./admissions-utils";

/**
 * Dossier d'une candidature. Les actions proposées sont EXACTEMENT celles que l'API annonce (`allowedTransitions` : transitions
 * déclarées par le workflow et permises à l'utilisateur) ; l'écran ne recalcule aucune règle d'admission.
 */
export function ApplicationDetailScreen({ applicationId }: { applicationId: string }) {
  const t = useTranslations("v2Admissions.detail");
  const query = useApplication(applicationId);
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return <Dossier application={query.data} backLabel={t("back")} />;
}

function Dossier({ application, backLabel }: { application: AdmissionsApplicationDetailDto; backLabel: string }) {
  const t = useTranslations("v2Admissions.detail");
  const ts = useTranslations("v2Admissions.status");
  const fmt = useDateFormat();
  const flash = useFlash();
  const name = application.anonymized ? t("anonymized") : fullName(application);

  return (
    <div className="space-y-4">
      <Link href="/v2/admissions/applications" className="inline-block text-sm text-primary hover:underline">
        ← {backLabel}
      </Link>
      <PageHeader
        title={name}
        description={t("subtitle", { number: application.applicationNumber, grade: application.desiredGradeLevelCode })}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge label={application.stageLabel} tone="neutral" />
            <StatusBadge label={ts(application.status)} tone={statusTone(application.status)} />
            {application.overdue ? <StatusBadge label={t("overdue")} tone="danger" /> : null}
          </span>
        }
      />
      {flash.node}
      {application.missingDocuments.length > 0 ? (
        <Notice kind="warning">{t("missingDocuments", { list: application.missingDocuments.join(", ") })}</Notice>
      ) : null}
      {application.duplicates.some((d) => d.status === "OPEN") ? <Notice kind="warning">{t("openDuplicates")}</Notice> : null}

      <Actions application={application} onDone={flash.show} />
      <EnrollmentStatus application={application} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="dossier-info" className="rounded-lg border p-4">
          <h2 id="dossier-info" className="mb-3 text-base font-semibold">
            {t("info")}
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <Info label={t("birthDate")} value={fmt.civil(application.applicantBirthDate)} />
            <Info label={t("birthPlace")} value={application.applicantBirthPlace} />
            <Info label={t("nationality")} value={application.applicantNationality} />
            <Info label={t("previousSchool")} value={application.previousSchool} />
            <Info label={t("repeating")} value={application.isRepeating ? t("yes") : t("no")} />
            <Info label={t("funding")} value={application.fundingTypeRequested} />
            <Info label={t("assignment")} value={application.assignmentReference} />
            <Info label={t("priority")} value={application.priorityClassCode} />
            <Info label={t("source")} value={application.referrerLabel ? `${application.sourceChannel} (${application.referrerLabel})` : application.sourceChannel} />
            <Info label={t("submitted")} value={fmt.instant(application.submittedAt)} />
            <Info label={t("stageSince")} value={fmt.instant(application.stageEnteredAt)} />
            <Info label={t("seatsLeft")} value={application.seatsLeft === null ? t("noCapacity") : String(application.seatsLeft)} />
          </dl>
        </section>
        <DossierGuardians application={application} />
      </div>

      <DossierDocuments application={application} />
      <DossierInterviews application={application} />
      <DossierOffers application={application} />
      <DossierDuplicates application={application} />
      <DossierHistory applicationId={application.id} />
      <DossierPrivacy application={application} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value && value !== "" ? value : "—"}</dd>
    </div>
  );
}

function EnrollmentStatus({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.detail");
  const fmt = useDateFormat();
  if (!application.enrollmentId) return null;
  return (
    <section aria-labelledby="dossier-enrollment" className="rounded-lg border p-4">
      <h2 id="dossier-enrollment" className="mb-2 text-base font-semibold">
        {t("enrollment")}
      </h2>
      <p className="text-sm" role="status">
        {application.enrolledAt ? t("enrolled", { date: fmt.instant(application.enrolledAt) }) : t("enrollmentPending")}
      </p>
      <p className="mt-1 flex flex-wrap gap-3 text-sm">
        {application.studentId ? (
          <Link href={`/v2/students/${application.studentId}`} className="text-primary hover:underline">
            {t("studentFile")}
          </Link>
        ) : null}
        {application.enrollmentId ? (
          <Link href={`/v2/enrollments/${application.enrollmentId}`} className="text-primary hover:underline">
            {t("enrollmentFile")}
          </Link>
        ) : null}
      </p>
    </section>
  );
}

function Actions({ application, onDone }: { application: AdmissionsApplicationDetailDto; onDone: (message: string) => void }) {
  const t = useTranslations("v2Admissions.detail");
  const ts = useTranslations("v2Admissions.status");
  const describe = useDescribeError();
  const move = useTransitionApplication();
  const [deciding, setDeciding] = useState<AdmissionsAllowedTransitionDto | null>(null);
  const [reasoning, setReasoning] = useState<AdmissionsAllowedTransitionDto | null>(null);
  const actions = application.allowedTransitions.filter((x) => !x.isAutomatic);
  if (application.anonymized) return null;

  function run(tr: AdmissionsAllowedTransitionDto) {
    if (tr.requiresDecision) return setDeciding(tr);
    if (tr.requiresReason) return setReasoning(tr);
    move.mutate({ id: application.id, body: { toStageId: tr.toStageId, rowVersion: application.rowVersion } }, { onSuccess: () => onDone(t("moved", { stage: tr.toStageLabel })) });
  }

  return (
    <section aria-labelledby="dossier-actions" className="rounded-lg border p-4">
      <h2 id="dossier-actions" className="mb-2 text-base font-semibold">
        {t("actions")}
      </h2>
      {actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAction")}</p> : null}
      {move.error ? <Notice kind="error" className="mb-2">{describe(move.error)}</Notice> : null}
      <ul className="flex flex-wrap gap-2">
        {actions.map((tr) => (
          <li key={tr.transitionId}>
            <button type="button" className={tr.requiresDecision ? buttonClass.primary : buttonClass.secondary} disabled={move.isPending} onClick={() => run(tr)} aria-label={t("moveTo", { stage: tr.toStageLabel, status: ts(tr.toStatus) })}>
              {tr.toStageLabel}
            </button>
          </li>
        ))}
      </ul>
      {deciding ? <DecisionDialog application={application} transition={deciding} onClose={() => setDeciding(null)} onDone={(m) => { setDeciding(null); onDone(m); }} /> : null}
      {reasoning ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setReasoning(null) : undefined)}
          title={t("moveTo", { stage: reasoning.toStageLabel, status: ts(reasoning.toStatus) })}
          reasonLabel={t("reason")}
          confirmLabel={t("confirmMove")}
          minLength={3}
          isPending={move.isPending}
          error={move.error}
          onConfirm={(reason) =>
            move.mutate(
              { id: application.id, body: { toStageId: reasoning.toStageId, reason, rowVersion: application.rowVersion } },
              {
                onSuccess: () => {
                  setReasoning(null);
                  onDone(t("moved", { stage: reasoning.toStageLabel }));
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}
