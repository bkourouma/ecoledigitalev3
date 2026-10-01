"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { attendanceSubmitJustificationBodySchema } from "@ecoledigitale/contracts/v2/attendance";
import { ApiError } from "@/platform/api/errors";
import { readFileAsBase64, useAttachJustificationDocument, useAttendanceSettings, useJustificationReasons, useSubmitJustification } from "@/platform/v2/attendance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

/** Motifs du modèle d'établissement : repli quand l'utilisateur ne peut pas lire le référentiel (parent, élève). */
const FALLBACK_REASONS = ["ILLNESS", "FAMILY_EVENT", "TRANSPORT", "OFFICIAL_ACTIVITY", "OTHER"] as const;

/**
 * Dépôt d'un justificatif d'absence (parent, élève, secrétariat) : fenêtre de dates, motif, commentaire, pièce
 * facultative. Les règles de forme viennent du contrat ; l'acceptation, la couverture des pointages et le type réel de la pièce
 * (octets magiques) sont décidés par l'API et leurs messages affichés tels quels.
 */
export function JustificationForm({
  studentId,
  studentLabel,
  defaultFrom = "",
  defaultTo = "",
  onClose,
  onDone,
}: {
  /** Élève imposé (parent, fiche d'élève) ; absent : choix dans une liste. */
  studentId?: string;
  studentLabel?: string;
  defaultFrom?: string;
  defaultTo?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("v2Attendance.justifyForm");
  const tFallback = useTranslations("v2Attendance.reasonFallback");
  const submit = useSubmitJustification();
  const attach = useAttachJustificationDocument();
  const reasons = useJustificationReasons();
  const settings = useAttendanceSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [student, setStudent] = useState<SelectOption | null>(studentId ? { value: studentId, label: studentLabel ?? studentId } : null);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo || defaultFrom);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attachError, setAttachError] = useState<string | null>(null);
  const apiErrors = apiErrorToFieldErrors(submit.error);

  const reasonOptions =
    reasons.data && reasons.data.length > 0
      ? reasons.data.filter((r) => r.active).map((r) => ({ value: r.code, label: r.label }))
      : FALLBACK_REASONS.map((c) => ({ value: c, label: tFallback(c) }));
  const maxBytes = settings.data?.attachmentMaxBytes ?? null;
  const allowed = settings.data?.allowedAttachmentTypes ?? ["application/pdf", "image/jpeg", "image/png", "image/webp"];

  async function send() {
    setAttachError(null);
    const body = { studentId: student?.value ?? "", fromDate: from, toDate: to, reasonCode: reason, ...(comment.trim() ? { comment: comment.trim() } : {}) };
    const v = validateWith(attendanceSubmitJustificationBodySchema, body);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    if (file && maxBytes !== null && file.size > maxBytes) {
      setErrors({ file: t("fileTooLarge", { max: Math.round(maxBytes / 1024) }) });
      return;
    }
    setErrors({});
    submit.mutate(v.data, {
      onSuccess: async (created) => {
        if (file) {
          try {
            await attach.mutateAsync({ id: created.id, fileName: file.name, contentBase64: await readFileAsBase64(file) });
          } catch (e) {
            // Le justificatif existe déjà : on le dit, la pièce peut être ajoutée depuis sa fiche.
            setAttachError(e instanceof ApiError ? e.message : t("attachFailed"));
            return;
          }
        }
        onClose();
        onDone();
      },
    });
  }

  const useStudents = (search: string, enabled: boolean) => useStudentOptions(search, enabled);

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void send()} isPending={submit.isPending || attach.isPending} error={attachError ? new ApiError({ code: "ATTACH", message: t("attachPartial", { message: attachError }) }) : Object.keys(apiErrors).length ? undefined : submit.error} wide>
      {studentId ? (
        <p className="text-sm">
          <span className="font-medium">{t("student")} : </span>
          {studentLabel ?? studentId}
        </p>
      ) : (
        <FormField label={t("student")} required error={errors.studentId ?? apiErrors.studentId}>
          {(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudents} ariaLabel={t("student")} placeholder={t("chooseStudent")} />}
        </FormField>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("from")} required error={errors.fromDate ?? apiErrors.fromDate}>
          {(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}
        </FormField>
        <FormField label={t("to")} required error={errors.toDate ?? apiErrors.toDate}>
          {(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}
        </FormField>
      </div>
      <FormField label={t("reason")} required error={errors.reasonCode ?? apiErrors.reasonCode}>
        {(c) => <NativeSelect {...c} value={reason} onChange={setReason} placeholder={t("chooseReason")} options={reasonOptions} />}
      </FormField>
      <FormField label={t("comment")} error={errors.comment ?? apiErrors.comment}>
        {(c) => <TextAreaControl {...c} value={comment} onChange={setComment} maxLength={1000} />}
      </FormField>
      <FormField label={t("file")} hint={t("fileHint", { types: allowed.map((x) => x.split("/")[1]).join(", ") })} error={errors.file ?? null}>
        {(c) => (
          <input
            {...c}
            ref={fileRef}
            type="file"
            accept={allowed.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium"
          />
        )}
      </FormField>
    </FormDialog>
  );
}
