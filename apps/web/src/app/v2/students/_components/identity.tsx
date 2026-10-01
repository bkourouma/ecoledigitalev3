"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PeopleDuplicateCandidateDto, PeoplePersonInput } from "@ecoledigitale/contracts/v2/people";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { Notice } from "@/platform/ui/states";
import { type FieldErrors } from "@/platform/ui/validation";

export interface IdentityValue {
  lastName: string;
  firstName: string;
  otherNames: string;
  sex: "" | "M" | "F";
  birthDate: string;
  birthPlace: string;
  nationality: string;
  email: string;
  phone: string;
  phoneAlt: string;
  addressLine: string;
  city: string;
  residence: string;
}

export const emptyIdentity = (): IdentityValue => ({ lastName: "", firstName: "", otherNames: "", sex: "", birthDate: "", birthPlace: "", nationality: "", email: "", phone: "", phoneAlt: "", addressLine: "", city: "", residence: "" });

export function identityOf(person: Partial<Record<keyof IdentityValue, string | null>>): IdentityValue {
  const base = emptyIdentity();
  for (const key of Object.keys(base) as Array<keyof IdentityValue>) {
    const v = person[key];
    if (typeof v === "string") (base as unknown as Record<string, string>)[key] = v;
  }
  return base;
}

/** Saisie -> `person` du contrat : champs vides absents (les schémas sont `strict()`), nationalité en majuscules. */
export function identityToInput(v: IdentityValue): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    const value = k === "nationality" ? raw.trim().toUpperCase() : raw.trim();
    if (value !== "") out[k] = value;
  }
  return out;
}

/** Modifications d'une fiche existante : `null` efface un champ facultatif vidé, un champ inchangé n'est pas envoyé. */
export function identityPatch(next: IdentityValue, initial: IdentityValue): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(next) as Array<keyof IdentityValue>) {
    const a = key === "nationality" ? next[key].trim().toUpperCase() : next[key].trim();
    if (a === initial[key].trim()) continue;
    patch[key] = a === "" ? null : a;
  }
  return patch;
}

export type PersonInputForWire = PeoplePersonInput;

/**
 * Champs d'identité d'un élève ou d'un tuteur. `errors` est indexé par chemin du contrat (`person.lastName`, ou `lastName`
 * pour une mise à jour via `person`) : le préfixe est passé en `prefix`.
 */
export function IdentityFields({
  value,
  onChange,
  errors,
  prefix = "person",
  sexRequired = true,
  compact = false,
}: {
  value: IdentityValue;
  onChange: (next: IdentityValue) => void;
  errors: FieldErrors;
  prefix?: string;
  sexRequired?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("v2Students.identity");
  const set = <K extends keyof IdentityValue>(k: K) => (v: IdentityValue[K]) => onChange({ ...value, [k]: v });
  const err = (k: keyof IdentityValue) => errors[prefix ? `${prefix}.${k}` : k];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("lastName")} required error={err("lastName")}>
          {(c) => <TextControl {...c} value={value.lastName} onChange={set("lastName")} maxLength={120} autoComplete="family-name" />}
        </FormField>
        <FormField label={t("firstName")} required error={err("firstName")}>
          {(c) => <TextControl {...c} value={value.firstName} onChange={set("firstName")} maxLength={120} autoComplete="given-name" />}
        </FormField>
        <FormField label={t("otherNames")} error={err("otherNames")}>
          {(c) => <TextControl {...c} value={value.otherNames} onChange={set("otherNames")} maxLength={200} />}
        </FormField>
        <FormField label={t("sex")} required={sexRequired} hint={t("sexHint")} error={err("sex")}>
          {(c) => <NativeSelect {...c} value={value.sex} onChange={(v) => set("sex")(v as IdentityValue["sex"])} placeholder={t("choose")} options={[{ value: "F", label: t("sexF") }, { value: "M", label: t("sexM") }]} />}
        </FormField>
        <FormField label={t("birthDate")} error={err("birthDate")}>
          {(c) => <TextControl {...c} type="date" value={value.birthDate} onChange={set("birthDate")} />}
        </FormField>
        <FormField label={t("birthPlace")} error={err("birthPlace")}>
          {(c) => <TextControl {...c} value={value.birthPlace} onChange={set("birthPlace")} maxLength={160} />}
        </FormField>
        <FormField label={t("nationality")} hint={t("nationalityHint")} error={err("nationality")}>
          {(c) => <TextControl {...c} value={value.nationality} onChange={(v) => set("nationality")(v.toUpperCase())} maxLength={2} />}
        </FormField>
      </div>
      {!compact ? (
        <fieldset className="space-y-4 border-t pt-4">
          <legend className="text-sm font-semibold">{t("contact")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("email")} error={err("email")}>
              {(c) => <TextControl {...c} type="email" value={value.email} onChange={set("email")} maxLength={320} autoComplete="email" />}
            </FormField>
            <FormField label={t("phone")} error={err("phone")}>
              {(c) => <TextControl {...c} type="tel" value={value.phone} onChange={set("phone")} maxLength={40} autoComplete="tel" />}
            </FormField>
            <FormField label={t("phoneAlt")} error={err("phoneAlt")}>
              {(c) => <TextControl {...c} type="tel" value={value.phoneAlt} onChange={set("phoneAlt")} maxLength={40} />}
            </FormField>
            <FormField label={t("city")} error={err("city")}>
              {(c) => <TextControl {...c} value={value.city} onChange={set("city")} maxLength={120} />}
            </FormField>
          </div>
          <FormField label={t("addressLine")} error={err("addressLine")}>
            {(c) => <TextAreaControl {...c} rows={2} value={value.addressLine} onChange={set("addressLine")} maxLength={300} />}
          </FormField>
          <FormField label={t("residence")} error={err("residence")}>
            {(c) => <TextControl {...c} value={value.residence} onChange={set("residence")} maxLength={200} />}
          </FormField>
        </fieldset>
      ) : null}
    </div>
  );
}

/**
 * Avertissement de doublon : liste des dossiers proches. Jamais un blocage : l'utilisateur choisit d'ouvrir l'existant ou de
 * confirmer la création avec un motif (le contrat l'exige : `acknowledgeDuplicate` + `duplicateReason`).
 */
export function DuplicateWarning({
  candidates,
  acknowledged,
  onAcknowledge,
  reason,
  onReason,
  reasonError,
  linkTarget = "student",
}: {
  candidates: ReadonlyArray<PeopleDuplicateCandidateDto>;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  reason: string;
  onReason: (v: string) => void;
  reasonError?: string | null;
  linkTarget?: "student" | "none";
}) {
  const t = useTranslations("v2Students.duplicates");
  if (candidates.length === 0) return null;
  return (
    <section aria-labelledby="dup-title" className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <h3 id="dup-title" className="font-semibold">
        {t("title", { count: candidates.length })}
      </h3>
      <p>{t("explain")}</p>
      <ul className="divide-y divide-amber-200 rounded border border-amber-200 bg-white/60">
        {candidates.map((c) => (
          <li key={c.personId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
            <span className="font-medium">{c.displayName}</span>
            <span className="text-xs text-muted-foreground">{c.birthDate ?? t("noBirthDate")}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">{t(`match.${c.match}`)}</span>
            {c.studentNumber ? <span className="text-xs">{c.studentNumber}</span> : null}
            {c.roles.map((r) => (
              <span key={r} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {t(`role.${r}`)}
              </span>
            ))}
            {linkTarget === "student" && c.studentId ? (
              <Link href={`/v2/students/${c.studentId}`} className="ml-auto text-primary underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
                {t("open")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <CheckControl checked={acknowledged} onChange={onAcknowledge} label={t("acknowledge")} />
      {acknowledged ? (
        <FormField label={t("reason")} required error={reasonError}>
          {(ctl) => <TextControl {...ctl} value={reason} onChange={onReason} maxLength={500} />}
        </FormField>
      ) : null}
    </section>
  );
}

export function DuplicateCreatedNotice({ count }: { count: number }) {
  const t = useTranslations("v2Students.duplicates");
  if (count === 0) return null;
  return <Notice kind="warning">{t("created", { count })}</Notice>;
}
