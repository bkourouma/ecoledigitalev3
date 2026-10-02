"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleOwnContactPatchSchema } from "@ecoledigitale/contracts/v2/people";
import { useUpdateOwnContact, type OwnContactKind } from "@/platform/v2/portal";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

const FIELDS = ["email", "phone", "phoneAlt", "addressLine", "city", "residence"] as const;
type Field = (typeof FIELDS)[number];
export type OwnContact = Partial<Record<Field, string | null>>;

/**
 * Coordonnées modifiables par la personne elle-même (e-mail, téléphones, adresse) ; l'identité ne se modifie pas ici. Seuls les champs
 * changés sont envoyés : un champ vidé qui avait une valeur est effacé (`null`), un champ jamais renseigné et resté vide n'est pas envoyé.
 * Quand la valeur actuelle n'est pas lisible (tuteur), `known` est faux : les champs commencent vides et seuls les champs saisis partent.
 */
export function OwnContactForm({ kind, initial, known = true, fields = FIELDS }: { kind: OwnContactKind; initial: OwnContact; known?: boolean; fields?: readonly Field[] }) {
  const t = useTranslations("v2Portal.contact");
  const update = useUpdateOwnContact(kind);
  const flash = useFlash();
  const [form, setForm] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((f) => [f, initial[f] ?? ""])) as Record<Field, string>);
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (f: Field) => (v: string) => setForm((s) => ({ ...s, [f]: v }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    flash.show(null);
    const patch: Record<string, string | null> = {};
    for (const f of fields) {
      const now = form[f].trim();
      const before = (initial[f] ?? "").trim();
      if (now === before) continue;
      patch[f] = now === "" ? null : now;
    }
    if (Object.keys(patch).length === 0) return setErrors({ _form: t("nothingToSave") });
    const v = validateWith(peopleOwnContactPatchSchema, patch);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync(v.data as Record<string, string | null>);
      flash.show(t("saved"));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  const apiErrors = apiErrorToFieldErrors(update.error);
  const err = (f: string) => errors[f] ?? apiErrors[f];
  const formError = errors._form;
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={t("formLabel")} noValidate>
      {known ? null : <Notice kind="info">{t("blankHint")}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.includes("email") ? (
          <FormField label={t("email")} error={err("email")}>
            {(c) => <TextControl {...c} type="email" value={form.email} onChange={set("email")} autoComplete="email" maxLength={320} />}
          </FormField>
        ) : null}
        {fields.includes("phone") ? (
          <FormField label={t("phone")} error={err("phone")}>
            {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={40} />}
          </FormField>
        ) : null}
        {fields.includes("phoneAlt") ? (
          <FormField label={t("phoneAlt")} error={err("phoneAlt")}>
            {(c) => <TextControl {...c} type="tel" value={form.phoneAlt} onChange={set("phoneAlt")} maxLength={40} />}
          </FormField>
        ) : null}
        {fields.includes("addressLine") ? (
          <FormField label={t("addressLine")} error={err("addressLine")}>
            {(c) => <TextControl {...c} value={form.addressLine} onChange={set("addressLine")} autoComplete="street-address" maxLength={300} />}
          </FormField>
        ) : null}
        {fields.includes("city") ? (
          <FormField label={t("city")} error={err("city")}>
            {(c) => <TextControl {...c} value={form.city} onChange={set("city")} autoComplete="address-level2" maxLength={120} />}
          </FormField>
        ) : null}
        {fields.includes("residence") ? (
          <FormField label={t("residence")} error={err("residence")}>
            {(c) => <TextControl {...c} value={form.residence} onChange={set("residence")} maxLength={200} />}
          </FormField>
        ) : null}
      </div>
      {formError ? <Notice kind="warning">{formError}</Notice> : null}
      {update.isError && Object.keys(apiErrors).length === 0 ? <ErrorBlock error={update.error} /> : null}
      {flash.node}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {update.isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
