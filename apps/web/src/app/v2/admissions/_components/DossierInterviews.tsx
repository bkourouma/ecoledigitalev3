"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ADMISSION_INTERVIEW_KINDS, ADMISSION_INTERVIEW_RESULTS, ADMISSION_INTERVIEW_STATUSES, type AdmissionsApplicationDetailDto, type AdmissionsInterviewDto } from "@ecoledigitale/contracts/v2/admissions";
import { useCreateInterview, useUpdateInterview } from "@/platform/v2/admissions";
import { useFeature, usePermission } from "@/platform/access";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { DateTimeControl } from "./DateTimeControl";
import { localInputToInstant } from "./admissions-utils";

/** Tests et entretiens (fonctionnalité optionnelle `admissions.interviews`) : planification, présence, note et résultat. */
export function DossierInterviews({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.interviews");
  const tk = useTranslations("v2Admissions.interviewKind");
  const tst = useTranslations("v2Admissions.interviewStatus");
  const fmt = useDateFormat();
  const enabled = useFeature("admissions.interviews").allowed;
  const manage = usePermission("admission.interview.manage").allowed;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdmissionsInterviewDto | null>(null);
  if (!enabled && application.interviews.length === 0) return null;

  return (
    <section aria-labelledby="dossier-interviews" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="dossier-interviews" className="text-base font-semibold">
          {t("title")}
        </h2>
        {enabled && manage ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setCreating(true)}>
            {t("schedule")}
          </button>
        ) : null}
      </div>
      {application.interviews.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="divide-y">
        {application.interviews.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                {tk(i.kind)} · {fmt.instant(i.scheduledAt)}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge label={tst(i.status)} tone={i.status === "DONE" ? "success" : i.status === "SCHEDULED" ? "info" : "warning"} />
                {i.venue ? <span>{i.venue}</span> : null}
                {i.score !== null ? <span>{t("score", { score: i.score, max: i.scaleMax ?? "?" })}</span> : null}
                {i.resultCode ? <span>{t(`result.${i.resultCode}`)}</span> : null}
              </p>
              {i.notes ? <p className="mt-1 text-xs">{i.notes}</p> : null}
            </div>
            {enabled && manage ? (
              <button type="button" className={buttonClass.secondary} onClick={() => setEditing(i)} aria-label={t("updateAria", { date: fmt.instant(i.scheduledAt) })}>
                {t("update")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {creating ? <CreateDialog applicationId={application.id} onClose={() => setCreating(false)} /> : null}
      {editing ? <UpdateDialog applicationId={application.id} interview={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function CreateDialog({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const t = useTranslations("v2Admissions.interviews");
  const tk = useTranslations("v2Admissions.interviewKind");
  const create = useCreateInterview(applicationId);
  const [kind, setKind] = useState<"TEST" | "INTERVIEW">("INTERVIEW");
  const [when, setWhen] = useState("");
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const at = localInputToInstant(when);
    if (!at) {
      setError(t("whenRequired"));
      return;
    }
    setError(null);
    create.mutate({ kind, scheduledAt: at, ...(venue.trim() ? { venue: venue.trim() } : {}) }, { onSuccess: onClose });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("scheduleTitle")} submitLabel={t("scheduleSubmit")} onSubmit={submit} isPending={create.isPending} error={create.error}>
      <FormField label={t("kind")}>
        {(c) => <NativeSelect {...c} value={kind} onChange={(v) => setKind(v as "TEST" | "INTERVIEW")} options={ADMISSION_INTERVIEW_KINDS.map((k) => ({ value: k, label: tk(k) }))} />}
      </FormField>
      <FormField label={t("when")} required error={error}>
        {(c) => <DateTimeControl {...c} value={when} onChange={setWhen} />}
      </FormField>
      <FormField label={t("venue")}>{(c) => <TextControl {...c} value={venue} onChange={setVenue} maxLength={160} />}</FormField>
    </FormDialog>
  );
}

function UpdateDialog({ applicationId, interview, onClose }: { applicationId: string; interview: AdmissionsInterviewDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.interviews");
  const tst = useTranslations("v2Admissions.interviewStatus");
  const update = useUpdateInterview(applicationId);
  const [status, setStatus] = useState<string>(interview.status);
  const [result, setResult] = useState<string>(interview.resultCode ?? "");
  const [score, setScore] = useState(interview.score ?? "");
  const [scale, setScale] = useState(interview.scaleMax ?? "");
  const [notes, setNotes] = useState(interview.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const patch: Record<string, unknown> = { status, notes: notes.trim() || null, resultCode: result || null };
    if (score.trim() !== "") {
      const n = Number(score.replace(",", "."));
      const m = Number((scale || "20").toString().replace(",", "."));
      if (!Number.isFinite(n) || !Number.isFinite(m) || m <= 0 || n < 0) {
        setError(t("scoreInvalid"));
        return;
      }
      patch["score"] = n;
      patch["scaleMax"] = m;
    }
    setError(null);
    update.mutate({ interviewId: interview.id, patch }, { onSuccess: onClose });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("updateTitle")} submitLabel={t("save")} onSubmit={submit} isPending={update.isPending} error={update.error}>
      <FormField label={t("status")}>
        {(c) => <NativeSelect {...c} value={status} onChange={setStatus} options={ADMISSION_INTERVIEW_STATUSES.map((s) => ({ value: s, label: tst(s) }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("scoreLabel")} error={error}>
          {(c) => <TextControl {...c} inputMode="decimal" value={score} onChange={setScore} />}
        </FormField>
        <FormField label={t("scale")}>{(c) => <TextControl {...c} inputMode="decimal" value={scale} onChange={setScale} placeholder="20" />}</FormField>
      </div>
      <FormField label={t("resultLabel")}>
        {(c) => <NativeSelect {...c} value={result} onChange={setResult} placeholder={t("noResult")} options={ADMISSION_INTERVIEW_RESULTS.map((r) => ({ value: r, label: t(`result.${r}`) }))} />}
      </FormField>
      <FormField label={t("notes")}>{(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} maxLength={2000} />}</FormField>
    </FormDialog>
  );
}
