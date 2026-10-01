"use client";

import { useTranslations } from "next-intl";
import { useRelationshipTypes } from "@/platform/v2/people";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";

/** Drapeaux d'un lien élève-tuteur. Valeurs par défaut PRUDENTES (retrait et autorité à faux), comme le contrat. */
export interface LinkFlags {
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  isFinancialResponsible: boolean;
  hasLegalCustody: boolean;
  canPickup: boolean;
  portalAccess: boolean;
}

export const defaultFlags = (): LinkFlags => ({ isPrimaryContact: false, isEmergencyContact: false, isFinancialResponsible: false, hasLegalCustody: false, canPickup: false, portalAccess: true });

export const FLAG_KEYS = ["isPrimaryContact", "isEmergencyContact", "isFinancialResponsible", "hasLegalCustody", "canPickup", "portalAccess"] as const satisfies ReadonlyArray<keyof LinkFlags>;

export function RelationshipSelect({ value, onChange, error }: { value: string; onChange: (code: string) => void; error?: string | null }) {
  const t = useTranslations("v2Students.guardianForm");
  const types = useRelationshipTypes();
  // Un lien de tutelle exige un type de nature « tuteur » (les autres natures servent aux contacts d'urgence).
  const options = (types.data ?? []).filter((x) => x.active && x.kind === "GUARDIAN").sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <FormField label={t("relationship")} required error={error}>
      {(c) => <NativeSelect {...c} value={value} onChange={onChange} placeholder={t("choose")} options={options.map((o) => ({ value: o.code, label: o.label }))} />}
    </FormField>
  );
}

export function FlagsFields({ value, onChange }: { value: LinkFlags; onChange: (next: LinkFlags) => void }) {
  const t = useTranslations("v2Students.guardianForm");
  return (
    <fieldset className="grid gap-x-6 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">{t("flags")}</legend>
      {FLAG_KEYS.map((k) => (
        <CheckControl key={k} checked={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} label={t(`flag.${k}`)} hint={t(`flagHint.${k}`)} />
      ))}
    </fieldset>
  );
}
