"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ADMISSIONS_HONEYPOT_FIELD, admissionsPublicSubmitBodySchema, type AdmissionsPublicFormDto, type AdmissionsPublicSubmitResultDto } from "@ecoledigitale/contracts/v2/admissions";
import { ApiError } from "@/platform/api/errors";
import { publicSubmit, usePublicForm } from "@/platform/v2/admissions";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";

interface GuardianState {
  relationshipCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}
const emptyGuardian = (): GuardianState => ({ relationshipCode: "", firstName: "", lastName: "", phone: "", email: "" });
const opt = (v: string): string | undefined => (v.trim() === "" ? undefined : v.trim());

/** Message d'erreur NEUTRE selon le statut seulement : jamais le détail d'un refus interne (doublon, effectif, état du dossier). */
export function publicErrorKey(error: unknown): "closed" | "tooMany" | "unavailable" | "invalid" | "generic" {
  if (!(error instanceof ApiError)) return "generic";
  if (error.status === 404) return "closed";
  if (error.status === 429) return "tooMany";
  if (error.status >= 500) return "unavailable";
  if (error.status === 400) return "invalid";
  return "generic";
}

/**
 * Formulaire PUBLIC de candidature (sans authentification, non indexé). Aucune donnée sensible n'est demandée, aucun compte n'est
 * créé. Le texte de consentement parental affiché est celui, versionné, que l'établissement a publié : sans texte publié, le
 * formulaire est fermé côté API. La réponse est toujours neutre : un code de suivi, sans révéler doublon ni places restantes.
 */
export function PublicFormScreen({ school }: { school: string }) {
  const t = useTranslations("v2AdmissionsPublic.form");
  const form = usePublicForm(school);
  const [done, setDone] = useState<AdmissionsPublicSubmitResultDto | null>(null);

  if (form.isPending) return <LoadingBlock />;
  if (form.isError) {
    const key = publicErrorKey(form.error);
    return (
      <Notice kind={key === "unavailable" || key === "tooMany" ? "warning" : "info"}>
        <p className="font-medium">{t(`unavailable.${key}`)}</p>
      </Notice>
    );
  }
  if (done) return <Confirmation school={school} result={done} />;
  return <FormBody school={school} data={form.data} onRefresh={() => void form.refetch()} onDone={setDone} />;
}

function Confirmation({ school, result }: { school: string; result: AdmissionsPublicSubmitResultDto }) {
  const t = useTranslations("v2AdmissionsPublic.confirmation");
  return (
    <div className="space-y-4" role="status">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="text-sm">{result.message}</p>
      <div className="rounded-lg border bg-muted p-4">
        <p className="text-xs text-muted-foreground">{t("codeLabel")}</p>
        <p className="mt-1 select-all font-mono text-xl font-semibold tracking-wider">{result.trackingCode}</p>
      </div>
      <Notice kind="warning">{t("keepCode")}</Notice>
      <Link href={`/v2/apply/${encodeURIComponent(school)}/track`} className={buttonClass.primary}>
        {t("track")}
      </Link>
    </div>
  );
}

function FormBody({ school, data, onRefresh, onDone }: { school: string; data: AdmissionsPublicFormDto; onRefresh: () => void; onDone: (r: AdmissionsPublicSubmitResultDto) => void }) {
  const t = useTranslations("v2AdmissionsPublic.form");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [birth, setBirth] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [gender, setGender] = useState("");
  const [previous, setPrevious] = useState("");
  const [grade, setGrade] = useState("");
  const [funding, setFunding] = useState("PRIVATE");
  const [assignment, setAssignment] = useState("");
  const [guardians, setGuardians] = useState<GuardianState[]>([emptyGuardian()]);
  const [consenting, setConsenting] = useState("0");
  const [accepted, setAccepted] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof publicErrorKey> | null>(null);

  const patchGuardian = (i: number, p: Partial<GuardianState>) => setGuardians((list) => list.map((g, k) => (k === i ? { ...g, ...p } : g)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    const body = {
      formToken: data.formToken,
      ...(trap ? { [ADMISSIONS_HONEYPOT_FIELD]: trap } : {}),
      applicantFirstName: first,
      applicantLastName: last,
      applicantBirthDate: birth,
      ...(opt(birthPlace) ? { applicantBirthPlace: opt(birthPlace) } : {}),
      ...(gender ? { applicantGender: gender } : {}),
      ...(opt(previous) ? { previousSchool: opt(previous) } : {}),
      desiredGradeLevelCode: grade,
      fundingTypeRequested: funding,
      ...(opt(assignment) ? { assignmentReference: opt(assignment) } : {}),
      guardians: guardians.map((g, i) => ({
        relationshipCode: g.relationshipCode,
        firstName: g.firstName,
        lastName: g.lastName,
        ...(opt(g.phone) ? { phone: opt(g.phone) } : {}),
        ...(opt(g.email) ? { email: opt(g.email) } : {}),
        isPrimary: i === 0,
        isFinancialResponsible: i === 0,
        canConsent: true,
      })),
      consent: { accepted, textVersion: data.consent.version, guardianIndex: Number(consenting) },
    };
    const checked = validateWith(admissionsPublicSubmitBodySchema, body);
    const problems: FieldErrors = checked.ok ? {} : { ...checked.errors };
    if (!accepted) problems["consent.accepted"] = t("consentRequired");
    if (funding === "STATE_ASSIGNED" && !opt(assignment)) problems["assignmentReference"] = t("assignmentRequired");
    if (!checked.ok || Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      onDone(await publicSubmit(school, checked.data));
    } catch (error) {
      setFailure(publicErrorKey(error));
      // Le jeton de formulaire est à usage unique : un nouveau est demandé, la saisie est conservée.
      onRefresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title", { school: data.institutionName })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <form noValidate onSubmit={(e) => void submit(e)} className="space-y-8" aria-label={t("title", { school: data.institutionName })}>
        {/* Champ leurre : invisible pour une personne (hors écran, hors tabulation), rempli par un robot. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
          <label>
            {ADMISSIONS_HONEYPOT_FIELD}
            <input type="text" name={ADMISSIONS_HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </label>
        </div>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("child")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("firstName")} required error={errors["applicantFirstName"]}>
              {(c) => <TextControl {...c} value={first} onChange={setFirst} maxLength={100} autoComplete="off" />}
            </FormField>
            <FormField label={t("lastName")} required error={errors["applicantLastName"]}>
              {(c) => <TextControl {...c} value={last} onChange={setLast} maxLength={100} autoComplete="off" />}
            </FormField>
            <FormField label={t("birthDate")} required error={errors["applicantBirthDate"]}>
              {(c) => <TextControl {...c} type="date" value={birth} onChange={setBirth} />}
            </FormField>
            <FormField label={t("birthPlace")} error={errors["applicantBirthPlace"]}>
              {(c) => <TextControl {...c} value={birthPlace} onChange={setBirthPlace} maxLength={120} autoComplete="off" />}
            </FormField>
            <FormField label={t("gender")}>
              {(c) => <NativeSelect {...c} value={gender} onChange={setGender} placeholder={t("unspecified")} options={[{ value: "FEMALE", label: t("female") }, { value: "MALE", label: t("male") }]} />}
            </FormField>
            <FormField label={t("previousSchool")} error={errors["previousSchool"]}>
              {(c) => <TextControl {...c} value={previous} onChange={setPrevious} maxLength={160} autoComplete="off" />}
            </FormField>
            <FormField label={t("grade")} required error={errors["desiredGradeLevelCode"]}>
              {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("choose")} options={data.grades.map((g) => ({ value: g.code, label: g.label }))} />}
            </FormField>
            <FormField label={t("funding")} error={errors["fundingTypeRequested"]}>
              {(c) => <NativeSelect {...c} value={funding} onChange={setFunding} options={[{ value: "PRIVATE", label: t("fundingPrivate") }, { value: "STATE_ASSIGNED", label: t("fundingState") }]} />}
            </FormField>
            {funding === "STATE_ASSIGNED" ? (
              <FormField label={t("assignmentReference")} required error={errors["assignmentReference"]}>
                {(c) => <TextControl {...c} value={assignment} onChange={setAssignment} maxLength={100} autoComplete="off" />}
              </FormField>
            ) : null}
          </div>
        </fieldset>

        {guardians.map((g, i) => (
          <fieldset key={i} className="space-y-4">
            <legend className="text-base font-semibold">{t("guardianN", { n: i + 1 })}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("relationship")} required error={errors[`guardians.${i}.relationshipCode`]}>
                {(c) => <NativeSelect {...c} value={g.relationshipCode} onChange={(v) => patchGuardian(i, { relationshipCode: v })} placeholder={t("choose")} options={data.relationships.map((r) => ({ value: r.code, label: r.label }))} />}
              </FormField>
              <span className="hidden sm:block" />
              <FormField label={t("firstName")} required error={errors[`guardians.${i}.firstName`]}>
                {(c) => <TextControl {...c} value={g.firstName} onChange={(v) => patchGuardian(i, { firstName: v })} maxLength={100} autoComplete="given-name" />}
              </FormField>
              <FormField label={t("lastName")} required error={errors[`guardians.${i}.lastName`]}>
                {(c) => <TextControl {...c} value={g.lastName} onChange={(v) => patchGuardian(i, { lastName: v })} maxLength={100} autoComplete="family-name" />}
              </FormField>
              <FormField label={t("phone")} hint={t("contactHint")} error={errors[`guardians.${i}.phone`]}>
                {(c) => <TextControl {...c} type="tel" value={g.phone} onChange={(v) => patchGuardian(i, { phone: v })} maxLength={24} autoComplete="tel" />}
              </FormField>
              <FormField label={t("email")} error={errors[`guardians.${i}.email`]}>
                {(c) => <TextControl {...c} type="email" value={g.email} onChange={(v) => patchGuardian(i, { email: v })} maxLength={200} autoComplete="email" />}
              </FormField>
            </div>
            {i > 0 ? (
              <button type="button" className={buttonClass.ghost} onClick={() => setGuardians((list) => list.filter((_, k) => k !== i))}>
                {t("removeGuardian", { n: i + 1 })}
              </button>
            ) : null}
          </fieldset>
        ))}
        {guardians.length < 2 ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setGuardians((list) => [...list, emptyGuardian()])}>
            {t("addGuardian")}
          </button>
        ) : null}

        <section aria-labelledby="consent-title" className="space-y-3 rounded-lg border p-4">
          <h2 id="consent-title" className="text-base font-semibold">
            {t("consent")}
          </h2>
          <div tabIndex={0} role="region" aria-label={t("consentText")} className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {data.consent.body}
          </div>
          <p className="text-xs text-muted-foreground">{t("consentVersion", { version: data.consent.version })}</p>
          {guardians.length > 1 ? (
            <FormField label={t("consentBy")}>
              {(c) => <NativeSelect {...c} value={consenting} onChange={setConsenting} options={guardians.map((g, i) => ({ value: String(i), label: `${g.firstName} ${g.lastName}`.trim() || t("guardianN", { n: i + 1 }) }))} />}
            </FormField>
          ) : null}
          <CheckControl checked={accepted} onChange={setAccepted} label={t("accept")} />
          {errors["consent.accepted"] ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors["consent.accepted"]}
            </p>
          ) : null}
        </section>

        <Notice kind="info">{t("noSensitive")}</Notice>
        {failure ? <Notice kind={failure === "unavailable" || failure === "tooMany" ? "warning" : "error"}>{t(`failure.${failure}`)}</Notice> : null}
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {t("submit")}
        </button>
      </form>
    </div>
  );
}
