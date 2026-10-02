"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMISSION_FUNDING_TYPES, admissionsCreateApplicationBodySchema } from "@ecoledigitale/contracts/v2/admissions";
import { useAdmissionsLookups, useCreateApplication } from "@/platform/v2/admissions";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CampaignPicker, useSelectedCampaign } from "./AdmissionsShell";
import { blankToUndefined } from "./admissions-utils";

interface GuardianForm {
  relationshipCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  isFinancialResponsible: boolean;
}

const emptyGuardian = (primary: boolean): GuardianForm => ({ relationshipCode: "", firstName: "", lastName: "", phone: "", email: "", isPrimary: primary, isFinancialResponsible: primary });

/**
 * Saisie d'une candidature par le secrétariat. La validation de FORME vient du contrat (Zod) ; les règles d'admission (consentement,
 * doublons, capacité) sont celles de l'API, dont les refus s'affichent champ par champ ou en message d'ensemble.
 */
export function NewApplicationScreen() {
  const t = useTranslations("v2Admissions.newApplication");
  const tc = useTranslations("v2Admissions.common");
  const tf = useTranslations("v2Admissions.funding");
  const router = useRouter();
  const describe = useDescribeError();
  const { campaigns, campaignId, select } = useSelectedCampaign();
  const lookups = useAdmissionsLookups();
  const create = useCreateApplication();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [birth, setBirth] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [gender, setGender] = useState("");
  const [previous, setPrevious] = useState("");
  const [grade, setGrade] = useState("");
  const [funding, setFunding] = useState("PRIVATE");
  const [assignment, setAssignment] = useState("");
  const [repeating, setRepeating] = useState(false);
  const [guardians, setGuardians] = useState<GuardianForm[]>([emptyGuardian(true)]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const shown = { ...apiErrors, ...errors };

  function patchGuardian(index: number, patch: Partial<GuardianForm>) {
    setGuardians((list) => list.map((g, i) => (i === index ? { ...g, ...patch } : patch.isPrimary ? { ...g, isPrimary: false } : g)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      campaignId: campaignId ?? "",
      applicantFirstName: first,
      applicantLastName: last,
      applicantBirthDate: birth,
      ...(blankToUndefined(birthPlace) ? { applicantBirthPlace: birthPlace.trim() } : {}),
      ...(gender ? { applicantGender: gender } : {}),
      ...(blankToUndefined(previous) ? { previousSchool: previous.trim() } : {}),
      isRepeating: repeating,
      desiredGradeLevelCode: grade,
      fundingTypeRequested: funding,
      ...(blankToUndefined(assignment) ? { assignmentReference: assignment.trim() } : {}),
      guardians: guardians.map((g) => ({
        relationshipCode: g.relationshipCode,
        firstName: g.firstName,
        lastName: g.lastName,
        ...(blankToUndefined(g.phone) ? { phone: g.phone.trim() } : {}),
        ...(blankToUndefined(g.email) ? { email: g.email.trim() } : {}),
        isPrimary: g.isPrimary,
        isFinancialResponsible: g.isFinancialResponsible,
        canConsent: true,
      })),
    };
    const checked = validateWith(admissionsCreateApplicationBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data, { onSuccess: (created) => router.push(`/v2/admissions/applications/${created.id}`) });
  }

  if (lookups.isPending) return <LoadingBlock />;
  const relationships = lookups.data?.relationships ?? [];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form noValidate onSubmit={submit} className="max-w-3xl space-y-8" aria-label={t("title")}>
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("applicant")}</legend>
          <CampaignPicker campaigns={campaigns} value={campaignId} onChange={select} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("firstName")} required error={shown["applicantFirstName"]}>
              {(c) => <TextControl {...c} value={first} onChange={setFirst} maxLength={100} autoComplete="off" />}
            </FormField>
            <FormField label={t("lastName")} required error={shown["applicantLastName"]}>
              {(c) => <TextControl {...c} value={last} onChange={setLast} maxLength={100} autoComplete="off" />}
            </FormField>
            <FormField label={t("birthDate")} required error={shown["applicantBirthDate"]}>
              {(c) => <TextControl {...c} type="date" value={birth} onChange={setBirth} />}
            </FormField>
            <FormField label={t("birthPlace")} error={shown["applicantBirthPlace"]}>
              {(c) => <TextControl {...c} value={birthPlace} onChange={setBirthPlace} maxLength={120} />}
            </FormField>
            <FormField label={t("gender")} error={shown["applicantGender"]}>
              {(c) => (
                <NativeSelect {...c} value={gender} onChange={setGender} placeholder={t("unspecified")} options={[{ value: "FEMALE", label: t("female") }, { value: "MALE", label: t("male") }]} />
              )}
            </FormField>
            <FormField label={t("previousSchool")} error={shown["previousSchool"]}>
              {(c) => <TextControl {...c} value={previous} onChange={setPrevious} maxLength={160} />}
            </FormField>
            <FormField label={tc("grade")} required error={shown["desiredGradeLevelCode"]}>
              {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("choose")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
            </FormField>
            <FormField label={t("funding")} error={shown["fundingTypeRequested"]}>
              {(c) => <NativeSelect {...c} value={funding} onChange={setFunding} options={ADMISSION_FUNDING_TYPES.map((f) => ({ value: f, label: tf(f) }))} />}
            </FormField>
            {funding === "STATE_ASSIGNED" ? (
              <FormField label={t("assignmentReference")} required error={shown["assignmentReference"]}>
                {(c) => <TextControl {...c} value={assignment} onChange={setAssignment} maxLength={100} />}
              </FormField>
            ) : null}
          </div>
          <CheckControl checked={repeating} onChange={setRepeating} label={t("repeating")} />
        </fieldset>

        {guardians.map((g, i) => (
          <fieldset key={i} className="space-y-4" aria-label={t("guardianN", { n: i + 1 })}>
            <legend className="text-base font-semibold">{t("guardianN", { n: i + 1 })}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("relationship")} required error={shown[`guardians.${i}.relationshipCode`]}>
                {(c) => <NativeSelect {...c} value={g.relationshipCode} onChange={(v) => patchGuardian(i, { relationshipCode: v })} placeholder={t("choose")} options={relationships.map((r) => ({ value: r.code, label: r.label }))} />}
              </FormField>
              <span className="hidden sm:block" />
              <FormField label={t("firstName")} required error={shown[`guardians.${i}.firstName`]}>
                {(c) => <TextControl {...c} value={g.firstName} onChange={(v) => patchGuardian(i, { firstName: v })} maxLength={100} />}
              </FormField>
              <FormField label={t("lastName")} required error={shown[`guardians.${i}.lastName`]}>
                {(c) => <TextControl {...c} value={g.lastName} onChange={(v) => patchGuardian(i, { lastName: v })} maxLength={100} />}
              </FormField>
              <FormField label={t("phone")} hint={t("contactHint")} error={shown[`guardians.${i}.phone`]}>
                {(c) => <TextControl {...c} type="tel" value={g.phone} onChange={(v) => patchGuardian(i, { phone: v })} maxLength={24} autoComplete="off" />}
              </FormField>
              <FormField label={t("email")} error={shown[`guardians.${i}.email`]}>
                {(c) => <TextControl {...c} type="email" value={g.email} onChange={(v) => patchGuardian(i, { email: v })} maxLength={200} autoComplete="off" />}
              </FormField>
            </div>
            <CheckControl checked={g.isPrimary} onChange={(v) => patchGuardian(i, { isPrimary: v })} label={t("primary")} />
            <CheckControl checked={g.isFinancialResponsible} onChange={(v) => patchGuardian(i, { isFinancialResponsible: v })} label={t("financial")} />
            {guardians.length > 1 ? (
              <button type="button" className={buttonClass.ghost} onClick={() => setGuardians((list) => list.filter((_, k) => k !== i))}>
                {t("removeGuardian", { n: i + 1 })}
              </button>
            ) : null}
          </fieldset>
        ))}
        {guardians.length < 4 ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setGuardians((list) => [...list, emptyGuardian(false)])}>
            {t("addGuardian")}
          </button>
        ) : null}

        <Notice kind="info">{t("consentNote")}</Notice>
        {shown["guardians"] ? <Notice kind="error">{shown["guardians"]}</Notice> : null}
        {create.error && Object.keys(apiErrors).length === 0 ? <Notice kind="error">{describe(create.error)}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className={buttonClass.secondary} onClick={() => router.push("/v2/admissions/applications")}>
            {tc("cancel")}
          </button>
          <button type="submit" className={buttonClass.primary} disabled={create.isPending || campaignId === null}>
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
