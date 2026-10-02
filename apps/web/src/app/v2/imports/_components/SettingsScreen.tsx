"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportSettingsDto } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, Notice, PageHeader, QueryBoundary, useDescribeError, useFlash } from "@/platform/ui";
import { useImportSettings, useUpdateImportSettings } from "@/platform/v2/imports";
import { INPUT_CLASS } from "./import-utils";

type Field = "maxRows" | "maxColumns" | "maxFileMb" | "batchSize" | "allOrNothingMaxRows" | "maxActiveJobs" | "maxJobsPerDay" | "retentionDays";
const FIELDS: ReadonlyArray<{ key: Field; min: number; max: (s: ImportSettingsDto) => number }> = [
  { key: "maxRows", min: 1, max: (s) => s.hardLimits.maxRows },
  { key: "maxColumns", min: 1, max: (s) => s.hardLimits.maxColumns },
  { key: "maxFileMb", min: 1, max: (s) => Math.floor(s.hardLimits.maxFileBytes / 1048576) },
  { key: "batchSize", min: 1, max: () => 500 },
  { key: "allOrNothingMaxRows", min: 1, max: (s) => s.hardLimits.maxRows },
  { key: "maxActiveJobs", min: 1, max: () => 50 },
  { key: "maxJobsPerDay", min: 1, max: () => 1000 },
  { key: "retentionDays", min: 1, max: () => 365 },
];

const toForm = (s: ImportSettingsDto): Record<Field, string> => ({
  maxRows: String(s.maxRows),
  maxColumns: String(s.maxColumns),
  maxFileMb: String(Math.max(1, Math.round(s.maxFileBytes / 1048576))),
  batchSize: String(s.batchSize),
  allOrNothingMaxRows: String(s.allOrNothingMaxRows),
  maxActiveJobs: String(s.maxActiveJobs),
  maxJobsPerDay: String(s.maxJobsPerDay),
  retentionDays: String(s.retentionDays),
});

/** Plafonds et quotas du module pour l'établissement (`imports.manage`) ; les limites absolues du produit sont affichées. */
export function SettingsScreen() {
  const t = useTranslations("v2Imports.settings");
  const describe = useDescribeError();
  const settings = useImportSettings();
  const update = useUpdateImportSettings();
  const flash = useFlash();
  const [form, setForm] = useState<Record<Field, string> | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (settings.data && form === null) setForm(toForm(settings.data));
  }, [settings.data, form]);

  const errors: Partial<Record<Field, string>> = {};
  if (settings.data && form) {
    for (const f of FIELDS) {
      const n = Number(form[f.key]);
      const max = f.max(settings.data);
      if (!Number.isInteger(n) || n < f.min || n > max) errors[f.key] = t("range", { min: f.min, max });
    }
    if (!errors.allOrNothingMaxRows && Number(form.allOrNothingMaxRows) > Number(form.maxRows)) errors.allOrNothingMaxRows = t("allOrNothingTooHigh");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    flash.show(null);
    if (!form || Object.keys(errors).length > 0) return;
    const res = await update
      .mutateAsync({
        maxRows: Number(form.maxRows),
        maxColumns: Number(form.maxColumns),
        maxFileBytes: Number(form.maxFileMb) * 1048576,
        batchSize: Number(form.batchSize),
        allOrNothingMaxRows: Number(form.allOrNothingMaxRows),
        maxActiveJobs: Number(form.maxActiveJobs),
        maxJobsPerDay: Number(form.maxJobsPerDay),
        retentionDays: Number(form.retentionDays),
      })
      .catch(() => null);
    if (res) {
      flash.show(t("saved"));
      setForm(toForm(res));
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <QueryBoundary query={settings}>
        {form && settings.data ? (
          <form onSubmit={submit} noValidate aria-label={t("title")} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              {FIELDS.map((f) => {
                const id = `set-${f.key}`;
                const error = submitted ? (errors[f.key] ?? null) : null;
                return (
                  <div key={f.key}>
                    <label htmlFor={id} className="mb-1 block text-sm font-medium">
                      {t(`fields.${f.key}`)}
                    </label>
                    <input id={id} type="number" inputMode="numeric" min={f.min} max={f.max(settings.data)} className={INPUT_CLASS} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
                    <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
                      {t(`hints.${f.key}`)} {t("max", { max: f.max(settings.data) })}
                    </p>
                    {error ? (
                      <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {update.isError ? <Notice kind="error">{describe(update.error)}</Notice> : null}
            {flash.node}
            <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
              {t("save")}
            </button>
          </form>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
