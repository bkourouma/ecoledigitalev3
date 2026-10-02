"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportJobDto, ImportOnExisting, ImportOptionDef, ImportUploadResult, ImporterDescriptor } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, LoadingBlock, Notice, useDescribeError } from "@/platform/ui";
import { useCreateTemplate, useMappingTemplates, useOptionChoices, useSetMapping, useValidateImport } from "@/platform/v2/imports";
import { INPUT_CLASS } from "./import-utils";

const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function OptionField({ importer, def, value, onChange, error }: { importer: ImporterDescriptor; def: ImportOptionDef; value: string; onChange: (v: string) => void; error: string | null }) {
  const choices = useOptionChoices(importer.key, def.key, def.kind === "choice" && !def.choices);
  const t = useTranslations("v2Imports.mapping");
  const id = `option-${def.key}`;
  const items = def.choices ?? choices.data?.items ?? [];
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {def.label}
        {def.required ? <span className="sr-only"> ({t("required")})</span> : null}
        {def.required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {def.kind === "choice" ? (
        <select id={id} className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}>
          <option value="">{choices.isLoading ? t("loadingChoices") : t("choose")}</option>
          {items.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} type="text" className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
      )}
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
        {def.help}
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Étape 2 — Colonnes : chaque champ du modèle est associé à une colonne du fichier (proposition automatique modifiable), modèles
 * de mapping du tenant, options de l'importeur, politique « existant ». Enregistre, puis demande la validation (worker).
 */
export function MappingStep({ job, importer, suggestion }: { job: ImportJobDto; importer: ImporterDescriptor; suggestion?: ImportUploadResult | null }) {
  const t = useTranslations("v2Imports.mapping");
  const describe = useDescribeError();
  const setMapping = useSetMapping(job.id);
  const validate = useValidateImport(job.id);
  const createTemplate = useCreateTemplate();
  const templates = useMappingTemplates(importer.key);
  const initial = useMemo<Record<string, string>>(() => {
    const source = job.mapping ?? suggestion?.suggestedMapping ?? {};
    return Object.fromEntries(importer.columns.map((c) => [c.key, source[c.key] ?? ""]));
  }, [job.mapping, suggestion, importer.columns]);
  const [mapping, setMappingState] = useState<Record<string, string>>(initial);
  const [options, setOptions] = useState<Record<string, string>>(() => Object.fromEntries(importer.options.map((o) => [o.key, String(job.options[o.key] ?? (o.choices?.[0]?.value ?? ""))])));
  const [onExisting, setOnExisting] = useState<ImportOnExisting>(job.onExisting);
  const [templateId, setTemplateId] = useState<string>(job.mappingTemplateId ?? suggestion?.suggestedTemplateId ?? "");
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const used = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) if (header) used.set(header, field);
  const missing = importer.columns.filter((c) => c.required && !mapping[c.key]);
  const optionErrors = Object.fromEntries(importer.options.filter((o) => o.required && !options[o.key]?.trim()).map((o) => [o.key, t("optionRequired")]));
  const templateNameError = saveTemplate && !templateName.trim() ? t("templateNameRequired") : null;
  const invalid = missing.length > 0 || Object.keys(optionErrors).length > 0 || Boolean(templateNameError);
  const busy = setMapping.isPending || validate.isPending || createTemplate.isPending;

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.data?.items.find((x) => x.id === id);
    if (!tpl) return;
    const byNorm = new Map(job.headers.map((h) => [norm(h), h]));
    setMappingState(Object.fromEntries(importer.columns.map((c) => [c.key, byNorm.get(norm(tpl.mapping[c.key] ?? "")) ?? ""])));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    const body = {
      mapping: Object.fromEntries(importer.columns.map((c) => [c.key, mapping[c.key] ? mapping[c.key]! : null])) as Record<string, string | null>,
      options: Object.fromEntries(Object.entries(options).filter(([, v]) => v.trim() !== "")),
      runMode: job.runMode,
      onExisting,
      ...(templateId ? { templateId } : {}),
    };
    try {
      await setMapping.mutateAsync(body);
      if (saveTemplate) await createTemplate.mutateAsync({ importerKey: importer.key, name: templateName.trim(), mapping: body.mapping, headers: job.headers });
      await validate.mutateAsync();
    } catch {
      /* l'erreur est affichée ci-dessous (mutation en échec) */
    }
  }

  const error = setMapping.error ?? createTemplate.error ?? validate.error;

  return (
    <form onSubmit={submit} noValidate aria-label={t("title")} className="space-y-6">
      {job.warnings.length > 0 ? (
        <ul className="space-y-2">
          {job.warnings.map((w) => (
            <li key={w.code + w.message}>
              <Notice kind="warning">{w.message}</Notice>
            </li>
          ))}
        </ul>
      ) : null}

      {templates.data && templates.data.items.length > 0 ? (
        <div className="max-w-md">
          <label htmlFor="mapping-template" className="mb-1 block text-sm font-medium">
            {t("applyTemplate")}
          </label>
          <select id="mapping-template" className={INPUT_CLASS} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">{t("noTemplate")}</option>
            {templates.data.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <section aria-labelledby="mapping-columns" className="space-y-3">
        <h2 id="mapping-columns" className="text-base font-semibold">
          {t("columnsTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("columnsHint", { count: job.headers.length })}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {importer.columns.map((c) => {
            const id = `map-${c.key}`;
            const error = submitted && c.required && !mapping[c.key] ? t("columnRequired") : null;
            return (
              <div key={c.key}>
                <label htmlFor={id} className="mb-1 block text-sm font-medium">
                  {c.label}
                  {c.required ? (
                    <>
                      <span aria-hidden="true" className="ml-0.5 text-destructive">
                        *
                      </span>
                      <span className="sr-only"> ({t("required")})</span>
                    </>
                  ) : null}
                </label>
                <select
                  id={id}
                  className={INPUT_CLASS}
                  value={mapping[c.key] ?? ""}
                  onChange={(e) => setMappingState((m) => ({ ...m, [c.key]: e.target.value }))}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
                >
                  <option value="">{t("doNotImport")}</option>
                  {job.headers.map((h) => (
                    <option key={h} value={h} disabled={used.has(h) && used.get(h) !== c.key}>
                      {h}
                      {used.has(h) && used.get(h) !== c.key ? ` — ${t("alreadyUsed")}` : ""}
                    </option>
                  ))}
                </select>
                <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
                  {c.description}
                  {c.example ? ` ${t("example", { value: c.example })}` : ""}
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
      </section>

      {suggestion && suggestion.sample.length > 0 ? (
        <section aria-labelledby="mapping-sample" className="space-y-2">
          <h2 id="mapping-sample" className="text-base font-semibold">
            {t("sampleTitle")}
          </h2>
          <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("sampleTitle")}>
            <table className="min-w-full text-left text-xs">
              <thead className="bg-muted">
                <tr>
                  {job.headers.map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suggestion.sample.map((row, i) => (
                  <tr key={i} className="border-t">
                    {job.headers.map((h, j) => (
                      <td key={h} className="whitespace-nowrap px-2 py-1">
                        {row[j] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {importer.options.length > 0 ? (
        <section aria-labelledby="mapping-options" className="space-y-3">
          <h2 id="mapping-options" className="text-base font-semibold">
            {t("optionsTitle")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {importer.options.map((o) => (
              <OptionField key={o.key} importer={importer} def={o} value={options[o.key] ?? ""} onChange={(v) => setOptions((p) => ({ ...p, [o.key]: v }))} error={submitted ? (optionErrors[o.key] ?? null) : null} />
            ))}
          </div>
        </section>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-base font-semibold">{t("existingTitle")}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="onExisting" checked={onExisting === "SKIP"} onChange={() => setOnExisting("SKIP")} className="mt-1 h-4 w-4" />
          <span>
            <span className="font-medium">{t("existingSkip")}</span>
            <span className="block text-muted-foreground">{t("existingSkipHint")}</span>
          </span>
        </label>
        <label className={`flex items-start gap-2 text-sm ${importer.supportsUpdate ? "" : "opacity-60"}`}>
          <input type="radio" name="onExisting" checked={onExisting === "UPDATE"} disabled={!importer.supportsUpdate} onChange={() => setOnExisting("UPDATE")} className="mt-1 h-4 w-4" />
          <span>
            <span className="font-medium">{t("existingUpdate")}</span>
            <span className="block text-muted-foreground">{importer.supportsUpdate ? t("existingUpdateHint") : t("existingUpdateUnavailable")}</span>
          </span>
        </label>
      </fieldset>

      <section aria-labelledby="mapping-save" className="space-y-2">
        <h2 id="mapping-save" className="sr-only">
          {t("saveTemplate")}
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="h-4 w-4" />
          {t("saveTemplate")}
        </label>
        {saveTemplate ? (
          <div className="max-w-md">
            <label htmlFor="mapping-template-name" className="mb-1 block text-sm font-medium">
              {t("templateName")}
            </label>
            <input id="mapping-template-name" type="text" className={INPUT_CLASS} value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} aria-invalid={submitted && templateNameError ? true : undefined} aria-describedby={submitted && templateNameError ? "mapping-template-name-error" : undefined} />
            {submitted && templateNameError ? (
              <p id="mapping-template-name-error" role="alert" className="mt-1 text-sm text-destructive">
                {templateNameError}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {submitted && missing.length > 0 ? (
        <Notice kind="error">
          {t("missingRequired", { fields: missing.map((c) => c.label).join(", ") })}
        </Notice>
      ) : null}
      {error ? <Notice kind="error">{describe(error)}</Notice> : null}
      {busy ? <LoadingBlock label={t("saving")} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass.primary} disabled={busy}>
          {t("submit")}
        </button>
      </div>
    </form>
  );
}
