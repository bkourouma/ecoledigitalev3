"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { COUNCIL_WISH_SOURCES, councilsWishInputSchema, type CouncilsOrientationFileDto } from "@ecoledigitale/contracts/v2/councils";
import { usePrograms, useReference } from "@/platform/v2/academic";
import { useAddWish, useRecordConsent } from "@/platform/v2/councils";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { EnumLabel, useEnumText } from "./shared";

const CLOSED = new Set(["APPLIED", "CLOSED", "CANCELLED"]);

/** Un dossier clos ou appliqué n'accepte plus de vœux (l'API refuse : on évite d'offrir l'action). */
export const canExpressWishes = (file: CouncilsOrientationFileDto) => !CLOSED.has(file.status);

/**
 * Formulaire de vœu d'orientation : rang, série et niveau souhaités, origine du vœu (famille, élève, personnel, conseiller),
 * commentaire. Un vœu au même rang remplace le précédent (l'API le retire). Le consentement du tuteur peut être consigné
 * dans la foulée ; il reste modifiable depuis la liste tant que le dossier n'est pas appliqué.
 */
export function WishDialog({ file, onClose, onDone }: { file: CouncilsOrientationFileDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2CouncilsExtra.wish");
  const text = useEnumText();
  const programs = usePrograms();
  const grades = useReference("grade-levels");
  const addWish = useAddWish();
  const consent = useRecordConsent();
  const active = file.wishes.filter((w) => w.withdrawnAt === null);
  const nextRank = Math.min(20, active.reduce((m, w) => Math.max(m, w.rank), 0) + 1);
  const [rank, setRank] = useState(String(nextRank));
  const [toProgramId, setProgram] = useState("");
  const [toGradeLevelId, setGrade] = useState("");
  const [source, setSource] = useState<string>("GUARDIAN");
  const [comment, setComment] = useState("");
  const [consentChoice, setConsentChoice] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const clashing = active.find((w) => String(w.rank) === rank);
  const pending = addWish.isPending || consent.isPending;
  function finish() {
    onDone();
    onClose();
  }
  function submit() {
    const v = validateWith(councilsWishInputSchema, compact({ rank: Number(rank), toProgramId, toGradeLevelId, source, comment: comment.trim() }));
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    addWish.mutate(
      { id: file.id, wish: v.data },
      {
        onSuccess: () => {
          if (consentChoice === "GIVEN" || consentChoice === "REFUSED") consent.mutate({ id: file.id, state: consentChoice }, { onSuccess: finish, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
          else finish();
        },
        onError: (e) => setErrors(apiErrorToFieldErrors(e)),
      },
    );
  }
  const error = addWish.error ?? consent.error;
  const general = error && Object.keys(apiErrorToFieldErrors(error)).length === 0 ? error : undefined;
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name: file.studentName ?? "—" })} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={pending} error={general} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("rank")} required hint={clashing ? t("rankReplaces") : t("rankHint")} error={errors.rank ?? null}>
          {(c) => <TextControl {...c} type="number" value={rank} onChange={setRank} />}
        </FormField>
        <FormField label={t("source")} required error={errors.source ?? null}>
          {(c) => <NativeSelect {...c} value={source} onChange={setSource} options={COUNCIL_WISH_SOURCES.map((s) => ({ value: s, label: text("wishSource", s) }))} />}
        </FormField>
        <FormField label={t("program")} required error={errors.toProgramId ?? null}>
          {(c) => <NativeSelect {...c} value={toProgramId} placeholder={t("choose")} onChange={setProgram} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("grade")} required error={errors.toGradeLevelId ?? null}>
          {(c) => <NativeSelect {...c} value={toGradeLevelId} placeholder={t("choose")} onChange={setGrade} options={(grades.data ?? []).filter((g) => g.active).map((g) => ({ value: g.id, label: g.label }))} />}
        </FormField>
      </div>
      <FormField label={t("comment")} error={errors.comment ?? null}>
        {(c) => <TextAreaControl {...c} value={comment} onChange={setComment} rows={3} maxLength={1000} />}
      </FormField>
      <FormField label={t("consent")} hint={t("consentHint")}>
        {(c) => (
          <NativeSelect
            {...c}
            value={consentChoice}
            placeholder={t("consentNone")}
            onChange={setConsentChoice}
            options={[
              { value: "GIVEN", label: text("consent", "GIVEN") },
              { value: "REFUSED", label: text("consent", "REFUSED") },
            ]}
          />
        )}
      </FormField>
      <p className="text-xs text-muted-foreground">
        {t("currentConsent")} : <EnumLabel group="consent" value={file.guardianConsent} />
      </p>
    </FormDialog>
  );
}
