"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { reportcardsPutTemplateConfigBodySchema, REPORTCARDS_PACKS, type ReportcardsDocumentKind } from "@ecoledigitale/contracts/v2/reportcards";
import type { z } from "zod";
import type { reportcardsTemplateConfigDtoSchema, reportcardsTemplateDtoSchema } from "@ecoledigitale/contracts/v2/reportcards";
import { usePreviewTemplate, usePutTemplateConfig, useSignatories, useTemplateConfigs, useTemplates } from "@/platform/v2/reportcards";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

type Template = z.infer<typeof reportcardsTemplateDtoSchema>;
type Config = z.infer<typeof reportcardsTemplateConfigDtoSchema>;
type Option = { type: "boolean" | "string" | "number"; title: string; enum?: string[]; description?: string };

/** Options d'un gabarit : lues du schéma JSON du gabarit (types simples seulement ; le serveur revalide tout). */
export function optionsOf(schema: Record<string, unknown>): Record<string, Option> {
  const props = schema.properties;
  if (!props || typeof props !== "object") return {};
  const out: Record<string, Option> = {};
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { type?: unknown; title?: unknown; enum?: unknown; description?: unknown };
    const type = p.type === "boolean" ? "boolean" : p.type === "integer" || p.type === "number" ? "number" : p.type === "string" ? "string" : null;
    if (!type) continue;
    out[key] = { type, title: typeof p.title === "string" ? p.title : key, ...(Array.isArray(p.enum) ? { enum: p.enum.filter((x): x is string => typeof x === "string") } : {}), ...(typeof p.description === "string" ? { description: p.description } : {}) };
  }
  return out;
}

/** Gabarits de documents (modèles de plateforme versionnés) et configuration de l'établissement : options, signataires par emplacement, aperçu. */
export function TemplatesScreen() {
  const t = useTranslations("v2Reportcards.templates");
  const tPack = useTranslations("v2Reportcards.pack");
  const templates = useTemplates();
  const configs = useTemplateConfigs();
  const flash = useFlash();
  const [editing, setEditing] = useState<{ kind: ReportcardsDocumentKind; config: Config | null } | null>(null);
  const [previewOf, setPreviewOf] = useState<Config | null>(null);
  const kinds: ReportcardsDocumentKind[] = ["REPORT_CARD", "TRANSCRIPT"];

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <section aria-labelledby="cfg-h" className="space-y-3">
        <h2 id="cfg-h" className="text-lg font-semibold">
          {t("configs")}
        </h2>
        {configs.isPending && configs.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {configs.isError ? <ErrorBlock error={configs.error} onRetry={() => void configs.refetch()} /> : null}
        <ul className="space-y-3">
          {kinds.map((kind) => {
            const list = (configs.data ?? []).filter((c) => c.documentKind === kind && c.isCurrent);
            return (
              <li key={kind} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{t(`kinds.${kind}`)}</h3>
                  <button type="button" className={buttonClass.secondary} onClick={() => setEditing({ kind, config: list[0] ?? null })} aria-label={t("configureOf", { kind: t(`kinds.${kind}`) })}>
                    {t("configure")}
                  </button>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
                ) : (
                  list.map((c) => (
                    <p key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge label={tPack(c.pack)} tone="neutral" />
                      <span className="font-mono text-xs">{c.templateKey}</span>
                      <span className="text-muted-foreground">{t("versions", { template: c.templateVersion, config: c.configVersion })}</span>
                      <button type="button" className={buttonClass.ghost} onClick={() => setPreviewOf(c)} aria-label={t("previewOf", { kind: t(`kinds.${kind}`) })}>
                        {t("preview")}
                      </button>
                    </p>
                  ))
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="tpl-h" className="space-y-3">
        <h2 id="tpl-h" className="text-lg font-semibold">
          {t("available")}
        </h2>
        {templates.isPending && templates.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {templates.isError ? <ErrorBlock error={templates.error} onRetry={() => void templates.refetch()} /> : null}
        {!templates.isPending && !templates.isError && (templates.data ?? []).length === 0 ? <EmptyBlock title={t("none")} /> : null}
        <ul className="space-y-2">
          {(templates.data ?? []).map((tpl) => (
            <li key={`${tpl.key}-${tpl.version}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {tpl.title} <StatusBadge label={tPack(tpl.pack)} tone="neutral" /> <span className="font-mono text-xs font-normal">{`${tpl.key} · v${tpl.version}`}</span>
              </p>
              <p className="text-xs text-muted-foreground">{tpl.signatureSlots.length > 0 ? t("slots", { labels: tpl.signatureSlots.map((s) => s.label).join(", ") }) : t("noSlots")}</p>
            </li>
          ))}
        </ul>
      </section>

      {editing ? <ConfigDialog kind={editing.kind} config={editing.config} templates={templates.data ?? []} onClose={() => setEditing(null)} onDone={() => flash.show(t("saved"))} /> : null}
      {previewOf ? <PreviewDialog config={previewOf} onClose={() => setPreviewOf(null)} /> : null}
    </div>
  );
}

function ConfigDialog({ kind, config, templates, onClose, onDone }: { kind: ReportcardsDocumentKind; config: Config | null; templates: Template[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Reportcards.templates");
  const tPack = useTranslations("v2Reportcards.pack");
  const put = usePutTemplateConfig();
  const signatories = useSignatories();
  const [pack, setPack] = useState<string>(config?.pack ?? "");
  const [templateKey, setTemplateKey] = useState(config?.templateKey ?? "");
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(Object.entries(config?.options ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v ?? "")])));
  const [assignments, setAssignments] = useState<Record<string, string>>(() => Object.fromEntries((config?.signatureAssignments ?? []).map((a) => [a.slot, a.signatoryId])));
  const [errors, setErrors] = useState<FieldErrors>({});

  const candidates = useMemo(() => templates.filter((x) => x.documentKind === kind && (!pack || x.pack === pack) && x.status === "PUBLISHED"), [templates, kind, pack]);
  const template = candidates.filter((x) => x.key === templateKey).sort((a, b) => b.version - a.version)[0] ?? null;
  const options = template ? optionsOf(template.optionsSchema) : {};

  async function submit() {
    const opts: Record<string, string | number | boolean> = {};
    for (const [k, spec] of Object.entries(options)) {
      const raw = values[k];
      if (raw === undefined || raw === "") continue;
      opts[k] = spec.type === "number" ? Number(String(raw).replace(",", ".")) : spec.type === "boolean" ? raw === true : String(raw);
    }
    const body = {
      documentKind: kind,
      pack,
      templateKey,
      options: opts,
      signatureAssignments: Object.entries(assignments).filter(([, id]) => id).map(([slot, signatoryId]) => ({ slot, signatoryId })),
    };
    const v = validateWith(reportcardsPutTemplateConfigBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await put.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={t("configureTitle", { kind: t(`kinds.${kind}`) })} description={t("configureDescription")} submitLabel={t("save")} onSubmit={() => void submit()} isPending={put.isPending} error={Object.keys(errors).length === 0 ? put.error : null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("pack")} required error={errors.pack}>
          {(c) => (
            <NativeSelect
              {...c}
              value={pack}
              onChange={(v) => {
                setPack(v);
                setTemplateKey("");
              }}
              placeholder={t("choosePack")}
              options={REPORTCARDS_PACKS.map((p) => ({ value: p, label: tPack(p) }))}
            />
          )}
        </FormField>
        <FormField label={t("template")} required error={errors.templateKey}>
          {(c) => (
            <NativeSelect
              {...c}
              value={templateKey}
              onChange={setTemplateKey}
              placeholder={t("chooseTemplate")}
              options={[...new Map(candidates.map((x) => [x.key, x])).values()].map((x) => ({ value: x.key, label: x.title }))}
            />
          )}
        </FormField>
      </div>
      {Object.keys(options).length > 0 ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("options")}</legend>
          {Object.entries(options).map(([key, spec]) =>
            spec.type === "boolean" ? (
              <CheckControl key={key} checked={values[key] === true} onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} label={spec.title} hint={spec.description} />
            ) : spec.enum ? (
              <FormField key={key} label={spec.title} hint={spec.description} error={errors[`options.${key}`]}>
                {(c) => <NativeSelect {...c} value={String(values[key] ?? "")} onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} placeholder={t("defaultOption")} options={spec.enum!.map((e) => ({ value: e, label: e }))} />}
              </FormField>
            ) : (
              <FormField key={key} label={spec.title} hint={spec.description} error={errors[`options.${key}`]}>
                {(c) => <TextControl {...c} value={String(values[key] ?? "")} onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} inputMode={spec.type === "number" ? "decimal" : "text"} />}
              </FormField>
            ),
          )}
        </fieldset>
      ) : null}
      {template && template.signatureSlots.length > 0 ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("signatories")}</legend>
          {template.signatureSlots.map((slot) => (
            <FormField key={slot.slot} label={`${slot.label}${slot.required ? "" : ` (${t("optional")})`}`} required={slot.required} error={errors[`signatureAssignments.${slot.slot}`]}>
              {(c) => (
                <NativeSelect
                  {...c}
                  value={assignments[slot.slot] ?? ""}
                  onChange={(v) => setAssignments((s) => ({ ...s, [slot.slot]: v }))}
                  placeholder={t("chooseSignatory")}
                  options={(signatories.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: [s.fullName, s.title].filter(Boolean).join(" — ") }))}
                />
              )}
            </FormField>
          ))}
          {signatories.isError ? <Notice kind="warning">{t("signatoriesUnavailable")}</Notice> : null}
        </fieldset>
      ) : null}
    </FormDialog>
  );
}

/** Aperçu : le HTML renvoyé est affiché dans un cadre ISOLÉ (`sandbox` sans permission : ni script, ni formulaire, ni accès à la page). */
function PreviewDialog({ config, onClose }: { config: Config; onClose: () => void }) {
  const t = useTranslations("v2Reportcards.templates");
  const preview = usePreviewTemplate();
  const { mutate } = preview;
  useEffect(() => {
    mutate({ documentKind: config.documentKind, pack: config.pack, templateKey: config.templateKey, templateVersion: config.templateVersion, options: config.options, pdf: false });
  }, [mutate, config]);
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("previewTitle")} description={t("previewDescription")} className="sm:max-w-3xl">
      {preview.isPending ? <LoadingBlock /> : null}
      {preview.error ? <ErrorBlock error={preview.error} /> : null}
      {preview.data ? <iframe title={t("previewFrame")} sandbox="" srcDoc={preview.data.html} className="h-[60vh] w-full rounded-md border bg-white" /> : null}
    </ModalDialog>
  );
}
