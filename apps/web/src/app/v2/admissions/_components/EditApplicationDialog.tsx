"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ADMISSION_FUNDING_TYPES, admissionsUpdateApplicationBodySchema, type AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { ApiError } from "@/platform/api/errors";
import { useAdmissionsLookups, useUpdateApplication } from "@/platform/v2/admissions";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

/** Code d'erreur de l'API quand le dossier a changé depuis la lecture de l'écran (HTTP 409). */
export const VERSION_CONFLICT_CODE = "admissions.version_conflict";

export const isVersionConflict = (e: unknown): boolean => e instanceof ApiError && (e.code === VERSION_CONFLICT_CODE || (e.status === 409 && /version|modifi/i.test(e.message)));

/** Ne retient que les champs réellement modifiés : l'API reçoit un PATCH minimal, jamais le dossier entier. */
export function buildPatch(app: AdmissionsApplicationDetailDto, f: Record<string, string | boolean>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const text = (key: string, current: string | null, value: string, nullable: boolean) => {
    const next = value.trim();
    if (next === (current ?? "")) return;
    patch[key] = next === "" ? (nullable ? null : next) : next;
  };
  text("applicantFirstName", app.applicantFirstName, String(f["first"]), false);
  text("applicantLastName", app.applicantLastName, String(f["last"]), false);
  text("applicantBirthDate", app.applicantBirthDate, String(f["birth"]), false);
  text("applicantBirthPlace", app.applicantBirthPlace, String(f["birthPlace"]), true);
  text("previousSchool", app.previousSchool, String(f["previous"]), true);
  text("desiredGradeLevelCode", app.desiredGradeLevelCode, String(f["grade"]), false);
  text("fundingTypeRequested", app.fundingTypeRequested, String(f["funding"]), false);
  text("assignmentReference", app.assignmentReference, String(f["assignment"]), true);
  if (String(f["gender"]) !== (app.applicantGender ?? "")) patch["applicantGender"] = f["gender"] === "" ? null : f["gender"];
  if (f["repeating"] !== app.isRepeating) patch["isRepeating"] = f["repeating"];
  return patch;
}

/**
 * Modification d'une candidature existante. Validation de forme par le contrat Zod (PATCH minimal) ; contrôle d'édition
 * concurrente par `rowVersion` : si quelqu'un a modifié le dossier entre-temps l'API refuse (409) et l'écran propose de
 * recharger la dernière version sans écraser silencieusement le travail de l'autre personne.
 */
export function EditApplicationDialog({ application, onClose, onSaved, onReload }: { application: AdmissionsApplicationDetailDto; onClose: () => void; onSaved: () => void; onReload: () => void }) {
  const t = useTranslations("v2AdmissionsEdit");
  const tn = useTranslations("v2Admissions.newApplication");
  const tc = useTranslations("v2Admissions.common");
  const tf = useTranslations("v2Admissions.funding");
  const lookups = useAdmissionsLookups();
  const update = useUpdateApplication(application.id);
  const [first, setFirst] = useState(application.applicantFirstName);
  const [last, setLast] = useState(application.applicantLastName);
  const [birth, setBirth] = useState(application.applicantBirthDate);
  const [birthPlace, setBirthPlace] = useState(application.applicantBirthPlace ?? "");
  const [gender, setGender] = useState<string>(application.applicantGender ?? "");
  const [previous, setPrevious] = useState(application.previousSchool ?? "");
  const [grade, setGrade] = useState(application.desiredGradeLevelCode);
  const [funding, setFunding] = useState<string>(application.fundingTypeRequested);
  const [assignment, setAssignment] = useState(application.assignmentReference ?? "");
  const [repeating, setRepeating] = useState(application.isRepeating);
  const [errors, setErrors] = useState<FieldErrors>({});
  const conflict = isVersionConflict(update.error);
  const apiErrors = conflict ? {} : apiErrorToFieldErrors(update.error);
  const shown = { ...apiErrors, ...errors };

  function submit() {
    const patch = buildPatch(application, { first, last, birth, birthPlace, previous, grade, funding, assignment, repeating, gender });
    if (funding === "STATE_ASSIGNED" && assignment.trim() === "") return setErrors({ assignmentReference: t("assignmentRequired") });
    if (Object.keys(patch).length === 0) return setErrors({ _form: t("nothingChanged") });
    const checked = validateWith(admissionsUpdateApplicationBodySchema, { ...patch, rowVersion: application.rowVersion });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    update.mutate(checked.data, {
      onSuccess: () => {
        onSaved();
        onClose();
      },
    });
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description", { number: application.applicationNumber })}
      submitLabel={t("submit")}
      onSubmit={submit}
      isPending={update.isPending}
      error={!conflict && update.error && Object.keys(apiErrors).length === 0 ? update.error : undefined}
      wide
    >
      {conflict ? (
        <Notice kind="warning">
          <p>{t("conflict")}</p>
          <button
            type="button"
            className={`${buttonClass.secondary} mt-2`}
            onClick={() => {
              onReload();
              onClose();
            }}
          >
            {t("reload")}
          </button>
        </Notice>
      ) : null}
      {shown["_form"] ? <Notice kind="info">{shown["_form"]}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tn("firstName")} required error={shown["applicantFirstName"]}>
          {(c) => <TextControl {...c} value={first} onChange={setFirst} maxLength={100} autoComplete="off" />}
        </FormField>
        <FormField label={tn("lastName")} required error={shown["applicantLastName"]}>
          {(c) => <TextControl {...c} value={last} onChange={setLast} maxLength={100} autoComplete="off" />}
        </FormField>
        <FormField label={tn("birthDate")} required error={shown["applicantBirthDate"]}>
          {(c) => <TextControl {...c} type="date" value={birth} onChange={setBirth} />}
        </FormField>
        <FormField label={tn("birthPlace")} error={shown["applicantBirthPlace"]}>
          {(c) => <TextControl {...c} value={birthPlace} onChange={setBirthPlace} maxLength={120} />}
        </FormField>
        <FormField label={tn("gender")} error={shown["applicantGender"]}>
          {(c) => <NativeSelect {...c} value={gender} onChange={setGender} placeholder={tn("unspecified")} options={[{ value: "FEMALE", label: tn("female") }, { value: "MALE", label: tn("male") }]} />}
        </FormField>
        <FormField label={tn("previousSchool")} error={shown["previousSchool"]}>
          {(c) => <TextControl {...c} value={previous} onChange={setPrevious} maxLength={160} />}
        </FormField>
        <FormField label={tc("grade")} required error={shown["desiredGradeLevelCode"]}>
          {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={tn("choose")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
        </FormField>
        <FormField label={tn("funding")} error={shown["fundingTypeRequested"]}>
          {(c) => <NativeSelect {...c} value={funding} onChange={setFunding} options={ADMISSION_FUNDING_TYPES.map((f) => ({ value: f, label: tf(f) }))} />}
        </FormField>
        {funding === "STATE_ASSIGNED" ? (
          <FormField label={tn("assignmentReference")} required error={shown["assignmentReference"]}>
            {(c) => <TextControl {...c} value={assignment} onChange={setAssignment} maxLength={100} />}
          </FormField>
        ) : null}
      </div>
      <CheckControl checked={repeating} onChange={setRepeating} label={tn("repeating")} />
    </FormDialog>
  );
}
