"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AdmissionsApplicationDetailDto, AdmissionsOfferDto } from "@ecoledigitale/contracts/v2/admissions";
import { admissionsIssueOfferBodySchema } from "@ecoledigitale/contracts/v2/admissions";
import { useAcceptOnBehalf, useAdmissionsSettings, useCampaigns, useClassrooms, useIssueOffer, useSetOfferClassroom, useWithdrawOffer } from "@/platform/v2/admissions";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CopyableValue } from "./AdmissionsShell";
import { hasPendingOffer, offerLink, parseInteger } from "./admissions-utils";

const TONE: Record<AdmissionsOfferDto["status"], Tone> = { PENDING: "info", ACCEPTED: "success", DECLINED: "danger", EXPIRED: "warning", WITHDRAWN: "neutral" };

function useClassroomChoices(application: AdmissionsApplicationDetailDto) {
  const campaigns = useCampaigns(undefined, true);
  const yearId = campaigns.data?.items.find((c) => c.id === application.campaignId)?.academicYearId ?? null;
  const rooms = useClassrooms(yearId ? { institutionId: application.institutionId, academicYearId: yearId, gradeLevelCode: application.desiredGradeLevelCode } : null);
  return (rooms.data?.items ?? []).filter((r) => r.open).map((r) => ({ value: r.id, label: r.label }));
}

/** Offres de place : émission (lien de réponse montré UNE seule fois), retrait, classe, acceptation au nom de la famille. */
export function DossierOffers({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.offers");
  const to = useTranslations("v2Admissions.offerStatus");
  const fmt = useDateFormat();
  const manage = usePermission("admission.offer.manage").allowed;
  const enroll = usePermission("admission.enroll").allowed;
  const [issuing, setIssuing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AdmissionsOfferDto | null>(null);
  const [choosing, setChoosing] = useState<AdmissionsOfferDto | null>(null);
  const [accepting, setAccepting] = useState<AdmissionsOfferDto | null>(null);
  const [acceptOutcome, setAcceptOutcome] = useState<"invoiced" | "free" | null>(null);
  const withdraw = useWithdrawOffer();
  const canIssue = manage && application.status === "ACCEPTED" && !hasPendingOffer(application);

  return (
    <section aria-labelledby="dossier-offers" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="dossier-offers" className="text-base font-semibold">
          {t("title")}
        </h2>
        {canIssue ? (
          <button type="button" className={buttonClass.primary} onClick={() => setIssuing(true)}>
            {t("issue")}
          </button>
        ) : null}
      </div>
      {acceptOutcome ? <Notice kind={acceptOutcome === "invoiced" ? "success" : "warning"}>{t(acceptOutcome === "invoiced" ? "acceptedInvoiced" : "acceptedNoInvoice")}</Notice> : null}
      {application.offers.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="divide-y">
        {application.offers.map((o) => (
          <li key={o.id} className="space-y-2 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge label={to(o.status)} tone={TONE[o.status]} />
              <span>{t("expires", { date: fmt.instant(o.expiresAt) })}</span>
              {!o.classroomId ? <span className="text-xs text-amber-300">{t("noClassroom")}</span> : null}
            </p>
            {o.conditions ? <p className="text-xs text-muted-foreground">{t("conditions", { text: o.conditions })}</p> : null}
            {o.status === "PENDING" && manage ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.secondary} onClick={() => setChoosing(o)}>
                  {t("setClassroom")}
                </button>
                {enroll ? (
                  <button type="button" className={buttonClass.secondary} onClick={() => setAccepting(o)}>
                    {t("acceptOnBehalf")}
                  </button>
                ) : null}
                <button type="button" className={buttonClass.secondary} onClick={() => setWithdrawing(o)}>
                  {t("withdraw")}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {issuing ? <IssueDialog application={application} onClose={() => setIssuing(false)} /> : null}
      {choosing ? <ClassroomDialog application={application} offer={choosing} onClose={() => setChoosing(null)} /> : null}
      {accepting ? <AcceptDialog application={application} offer={accepting} onClose={() => setAccepting(null)} onAccepted={(invoiced) => setAcceptOutcome(invoiced ? "invoiced" : "free")} /> : null}
      {withdrawing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setWithdrawing(null) : undefined)}
          title={t("withdrawTitle")}
          description={t("withdrawDescription")}
          reasonLabel={t("withdrawReason")}
          confirmLabel={t("withdraw")}
          destructive
          minLength={3}
          isPending={withdraw.isPending}
          error={withdraw.error}
          onConfirm={(reason) => withdraw.mutate({ offerId: withdrawing.id, reason }, { onSuccess: () => setWithdrawing(null) })}
        />
      ) : null}
    </section>
  );
}

function IssueDialog({ application, onClose }: { application: AdmissionsApplicationDetailDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.offers");
  const issue = useIssueOffer(application.id);
  const settings = useAdmissionsSettings(application.institutionId);
  const rooms = useClassroomChoices(application);
  const [classroom, setClassroom] = useState("");
  const [conditions, setConditions] = useState("");
  const [days, setDays] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(issue.error), ...errors };

  if (issue.data) {
    const slug = settings.data?.publicFormSlug ?? null;
    return (
      <ModalDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("issuedTitle")}>
        <div className="space-y-3">
          <Notice kind={issue.data.notified === "FAILED" ? "warning" : "success"}>{t(`notified.${issue.data.notified}`)}</Notice>
          {slug ? <CopyableValue label={t("responseLink")} value={offerLink(window.location.origin, slug, issue.data.responseToken)} /> : <Notice kind="warning">{t("noPublicLink")}</Notice>}
          <p className="text-xs text-muted-foreground">{t("shownOnce")}</p>
          <button type="button" className={buttonClass.primary} onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </ModalDialog>
    );
  }

  function submit() {
    const d = days.trim() === "" ? undefined : parseInteger(days, 1, 365);
    const body = { ...(classroom ? { classroomId: classroom } : {}), ...(conditions.trim() ? { conditions: conditions.trim() } : {}), ...(d ? { validityDays: d } : {}) };
    const checked = validateWith(admissionsIssueOfferBodySchema, d === null ? { ...body, validityDays: 0 } : body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    issue.mutate(checked.data);
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("issueTitle")} description={t("issueDescription", { days: settings.data?.offerValidityDays ?? 14 })} submitLabel={t("issue")} onSubmit={submit} isPending={issue.isPending} error={Object.keys(apiErrorToFieldErrors(issue.error)).length === 0 ? issue.error : undefined}>
      <FormField label={t("classroom")} hint={t("classroomHint")} error={shown["classroomId"]}>
        {(c) => <NativeSelect {...c} value={classroom} onChange={setClassroom} placeholder={t("classroomLater")} options={rooms} />}
      </FormField>
      <FormField label={t("conditionsLabel")} error={shown["conditions"]}>
        {(c) => <TextAreaControl {...c} value={conditions} onChange={setConditions} maxLength={2000} />}
      </FormField>
      <FormField label={t("validityDays")} error={shown["validityDays"]}>
        {(c) => <TextControl {...c} inputMode="numeric" value={days} onChange={setDays} />}
      </FormField>
    </FormDialog>
  );
}

function ClassroomDialog({ application, offer, onClose }: { application: AdmissionsApplicationDetailDto; offer: AdmissionsOfferDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.offers");
  const set = useSetOfferClassroom();
  const rooms = useClassroomChoices(application);
  const [classroom, setClassroom] = useState(offer.classroomId ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t("setClassroom")}
      submitLabel={t("save")}
      isPending={set.isPending}
      error={set.error}
      onSubmit={() => {
        if (!classroom) return setError(t("classroomRequired"));
        setError(null);
        set.mutate({ offerId: offer.id, classroomId: classroom }, { onSuccess: onClose });
      }}
    >
      <FormField label={t("classroom")} required error={error}>
        {(c) => <NativeSelect {...c} value={classroom} onChange={setClassroom} placeholder={t("choose")} options={rooms} />}
      </FormField>
    </FormDialog>
  );
}

function AcceptDialog({ application, offer, onClose, onAccepted }: { application: AdmissionsApplicationDetailDto; offer: AdmissionsOfferDto; onClose: () => void; onAccepted: (invoiced: boolean) => void }) {
  const t = useTranslations("v2Admissions.offers");
  const accept = useAcceptOnBehalf();
  const rooms = useClassroomChoices(application);
  const consenting = application.guardians.filter((g) => g.canConsent);
  const [guardianId, setGuardianId] = useState(consenting.find((g) => g.isPrimary)?.id ?? consenting[0]?.id ?? "");
  const [evidence, setEvidence] = useState("");
  const [classroom, setClassroom] = useState(offer.classroomId ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit() {
    const next: FieldErrors = {};
    if (!guardianId) next["guardianId"] = t("guardianRequired");
    if (evidence.trim().length < 3) next["evidenceRef"] = t("evidenceRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    accept.mutate({ offerId: offer.id, guardianId, evidenceRef: evidence.trim(), ...(!offer.classroomId && classroom ? { classroomId: classroom } : {}) }, { onSuccess: (r) => { onAccepted(r.invoiceId !== null); onClose(); } });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("acceptTitle")} description={t("acceptDescription")} submitLabel={t("acceptSubmit")} onSubmit={submit} isPending={accept.isPending} error={accept.error}>
      <FormField label={t("guardian")} required error={errors["guardianId"]}>
        {(c) => <NativeSelect {...c} value={guardianId} onChange={setGuardianId} placeholder={t("choose")} options={consenting.map((g) => ({ value: g.id, label: `${g.firstName} ${g.lastName}` }))} />}
      </FormField>
      <FormField label={t("evidence")} hint={t("evidenceHint")} required error={errors["evidenceRef"]}>
        {(c) => <TextControl {...c} value={evidence} onChange={setEvidence} maxLength={300} />}
      </FormField>
      {!offer.classroomId ? (
        <FormField label={t("classroom")} error={errors["classroomId"]}>
          {(c) => <NativeSelect {...c} value={classroom} onChange={setClassroom} placeholder={t("classroomAuto")} options={rooms} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}
