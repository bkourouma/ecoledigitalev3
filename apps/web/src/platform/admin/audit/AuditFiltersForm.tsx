"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Field, Input } from "@ecoledigitale/ui";
import {
  AUDIT_EXPORT_MAX_DAYS,
  EMPTY_FILTERS,
  SEVERITIES,
  validateFilters,
  type AuditFilterErrors,
  type AuditFilterState,
  type AuditSeverity,
} from "./filters";

export interface AuditFiltersFormProps {
  /** Filtres actuellement appliqués. */
  value: AuditFilterState;
  onApply: (next: AuditFilterState) => void;
  /** Erreurs supplémentaires (export) à afficher sur les champs. */
  externalErrors?: AuditFilterErrors;
}

/** Formulaire de filtres : validation locale à l'envoi, un seul `onApply` (pas de requête à chaque frappe). */
export function AuditFiltersForm({ value, onApply, externalErrors }: AuditFiltersFormProps) {
  const t = useTranslations("audit.filters");
  const tSeverity = useTranslations("audit.severity");
  const [draft, setDraft] = useState<AuditFilterState>(value);
  const [errors, setErrors] = useState<AuditFilterErrors>({});

  const shown = { ...errors, ...externalErrors };
  const errorText = (key: keyof AuditFilterErrors) => {
    const code = shown[key];
    return code ? t(`errors.${code}` as never, { days: AUDIT_EXPORT_MAX_DAYS } as never) : undefined;
  };
  const set = <K extends keyof AuditFilterState>(key: K, next: AuditFilterState[K]) => setDraft((d) => ({ ...d, [key]: next }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateFilters(draft);
    setErrors(found);
    if (Object.keys(found).length === 0) onApply(draft);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setErrors({});
    onApply(EMPTY_FILTERS);
  };

  const toggleSeverity = (severity: AuditSeverity, checked: boolean) =>
    set("severity", checked ? [...draft.severity, severity] : draft.severity.filter((s) => s !== severity));

  return (
    <form onSubmit={submit} noValidate aria-label={t("legend")} className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("action")} hint={t("actionHint")} error={errorText("action")}>
          {(c) => <Input {...c} value={draft.action} onChange={(e) => set("action", e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
        <Field label={t("entity")} hint={t("entityHint")} error={errorText("entity")}>
          {(c) => <Input {...c} value={draft.entity} onChange={(e) => set("entity", e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
        <Field label={t("entityId")}>
          {(c) => <Input {...c} value={draft.entityId} onChange={(e) => set("entityId", e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
        <Field label={t("actorId")} hint={t("actorIdHint")} error={errorText("actorId")}>
          {(c) => <Input {...c} value={draft.actorId} onChange={(e) => set("actorId", e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
        <Field label={t("from")} error={errorText("from")}>
          {(c) => <Input {...c} type="datetime-local" value={draft.from} onChange={(e) => set("from", e.target.value)} />}
        </Field>
        <Field label={t("to")} error={errorText("to")}>
          {(c) => <Input {...c} type="datetime-local" value={draft.to} onChange={(e) => set("to", e.target.value)} />}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("severity")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {SEVERITIES.map((severity) => {
            const id = `audit-severity-${severity}`;
            return (
              <div key={severity} className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={id}
                  checked={draft.severity.includes(severity)}
                  onCheckedChange={(checked) => toggleSeverity(severity, checked === true)}
                />
                <label htmlFor={id} className="cursor-pointer text-sm">
                  {tSeverity(severity)}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className="min-h-11 sm:min-h-10">
          {t("apply")}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={reset}>
          {t("reset")}
        </Button>
      </div>
    </form>
  );
}
