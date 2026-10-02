"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { NOTIF_LIMITS, type NotifCatalogEntry, type NotifChannel, type NotifPreviewResponse, type NotifTemplateView } from "@ecoledigitale/contracts/v2/notifications";
import { usePermission } from "@/platform/access";
import { useActivateTemplateVersion, useEnableTemplate, useNotifCatalog, useNotifTemplates, usePreviewTemplate, usePublishTemplate, useTemplateVersions } from "@/platform/v2/notifications";
import { useDateFormat } from "@/platform/ui/format";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { CHANNELS_WITH_SUBJECT, TEMPLATES } from "./notifications-utils";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

function Preview({ preview, channel }: { preview: NotifPreviewResponse; channel: NotifChannel }) {
  const t = useTranslations("v2NotificationsTemplates.preview");
  return (
    <section aria-label={t("title")} className="space-y-3 rounded-lg border bg-muted/30 p-3 sm:p-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      {preview.subject ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t("subject")} </span>
          <strong>{preview.subject}</strong>
        </p>
      ) : null}
      {channel === "EMAIL" && preview.html ? (
        // Rendu HTML isolé : aucun script, aucun accès à la page (sandbox sans autorisation).
        <iframe title={t("htmlFrame")} sandbox="" srcDoc={preview.html} className="h-64 w-full rounded-md border bg-white" />
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-sm">{preview.text}</pre>
      )}
      {preview.segments !== null ? <p className="text-xs text-muted-foreground">{t("segments", { n: preview.segments })}</p> : null}
      {preview.warnings.length > 0 ? (
        <Notice kind="warning">
          <ul className="list-disc pl-4">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </section>
  );
}

function Versions({ code, channel, canEdit, onLoad }: { code: string; channel: NotifChannel; canEdit: boolean; onLoad: (v: { subject: string | null; body: string }) => void }) {
  const t = useTranslations("v2NotificationsTemplates.versions");
  const fmt = useDateFormat();
  const describe = useDescribeError();
  const flash = useFlash();
  const versions = useTemplateVersions(code, channel);
  const activate = useActivateTemplateVersion();
  return (
    <section aria-labelledby="versions-title" className="space-y-3">
      <h3 id="versions-title" className="text-sm font-semibold">
        {t("title")}
      </h3>
      {flash.node}
      {activate.error ? <Notice kind="error">{describe(activate.error)}</Notice> : null}
      {versions.isPending ? (
        <LoadingBlock />
      ) : versions.isError ? (
        <ErrorBlock error={versions.error} onRetry={() => void versions.refetch()} />
      ) : versions.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-2">
          {versions.data.items.map((v) => (
            <li key={v.version} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t("version", { n: v.version })}
                  {v.active ? <StatusBadge label={t("active")} tone="success" /> : null}
                </p>
                <p className="text-xs text-muted-foreground">{fmt.instant(v.createdAt)}</p>
                {v.note ? <p className="text-xs">{v.note}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.ghost} onClick={() => onLoad({ subject: v.subject, body: v.body })}>
                  {t("load")}
                </button>
                {canEdit && !v.active ? (
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    disabled={activate.isPending}
                    onClick={() => activate.mutate({ code, channel, version: v.version }, { onSuccess: () => flash.show(t("activated", { n: v.version })) })}
                  >
                    {t("activate")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <button type="button" className={buttonClass.ghost} disabled={activate.isPending} onClick={() => activate.mutate({ code, channel, version: 0 }, { onSuccess: () => flash.show(t("shippedRestored")) })}>
          {t("backToShipped")}
        </button>
      ) : null}
    </section>
  );
}

function Editor({ entry, view, canEdit }: { entry: NotifCatalogEntry; view: NotifTemplateView; canEdit: boolean }) {
  const t = useTranslations("v2NotificationsTemplates");
  const describe = useDescribeError();
  const flash = useFlash();
  const publish = usePublishTemplate();
  const enable = useEnableTemplate();
  const previewAction = usePreviewTemplate();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const hasSubject = CHANNELS_WITH_SUBJECT.includes(view.channel);
  const [subject, setSubject] = useState(view.subject ?? "");
  const [body, setBody] = useState(view.body);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<NotifPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maxBody = view.channel === "SMS" ? NOTIF_LIMITS.smsBodyMax : NOTIF_LIMITS.bodyMax;

  function insertVariable(name: string) {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) return setBody((b) => `${b}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
  }

  function runPreview() {
    setError(null);
    previewAction.mutate({ code: view.code, channel: view.channel, ...(hasSubject ? { subject } : {}), body }, { onSuccess: setPreview });
  }

  function submit() {
    if (body.trim() === "") return setError(t("bodyRequired"));
    if (hasSubject && subject.trim() === "") return setError(t("subjectRequired"));
    setError(null);
    publish.mutate(
      { code: view.code, channel: view.channel, ...(hasSubject ? { subject: subject.trim() } : {}), body: body.trim(), ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: (r) => {
          setNote("");
          flash.show(t("published", { n: r.version }));
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={view.source === "SHIPPED" ? t("shipped") : t("tenantVersion", { n: view.version })} tone={view.source === "SHIPPED" ? "neutral" : "info"} />
          <StatusBadge label={view.enabled ? t("enabled") : t("disabled")} tone={view.enabled ? "success" : "warning"} />
        </div>
        {canEdit ? (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={enable.isPending}
            onClick={() => enable.mutate({ code: view.code, channel: view.channel, enabled: !view.enabled }, { onSuccess: () => flash.show(view.enabled ? t("nowDisabled") : t("nowEnabled")) })}
          >
            {view.enabled ? t("disable") : t("enable")}
          </button>
        ) : null}
      </div>
      {!view.enabled ? <Notice kind="warning">{t("disabledHint")}</Notice> : null}

      <form
        className="space-y-4"
        aria-label={t("editor")}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        {hasSubject ? (
          <FormField label={t("subject")} required>
            {(c) => <input {...c} type="text" maxLength={NOTIF_LIMITS.subjectMax} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} className={inputClass} />}
          </FormField>
        ) : null}
        <FormField label={t("body")} required hint={t("bodyHint", { max: maxBody })}>
          {(c) => (
            <textarea
              {...c}
              ref={bodyRef}
              rows={view.channel === "EMAIL" ? 10 : 5}
              maxLength={maxBody}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("variables")}</legend>
          <ul className="flex flex-wrap gap-2">
            {entry.variables.map((v) => (
              <li key={v.name}>
                <button type="button" disabled={!canEdit} onClick={() => insertVariable(v.name)} title={`${v.label} — ${v.sample}`} className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2 font-mono text-xs hover:bg-accent disabled:opacity-50">
                  {`{{${v.name}}}`}
                  {v.required ? <span className="text-destructive">*</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("variablesHint")}</p>
        </fieldset>
        {canEdit ? (
          <FormField label={t("note")} hint={t("noteHint")}>
            {(c) => <input {...c} type="text" maxLength={NOTIF_LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />}
          </FormField>
        ) : null}
        {flash.node}
        {error ? <Notice kind="error">{error}</Notice> : null}
        {publish.error ? <Notice kind="error">{describe(publish.error)}</Notice> : null}
        {enable.error ? <Notice kind="error">{describe(enable.error)}</Notice> : null}
        {previewAction.error ? <Notice kind="error">{describe(previewAction.error)}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.secondary} onClick={runPreview} disabled={previewAction.isPending}>
            {t("preview.run")}
          </button>
          {canEdit ? (
            <button type="submit" className={buttonClass.primary} disabled={publish.isPending}>
              {t("publish")}
            </button>
          ) : null}
        </div>
      </form>

      {preview ? <Preview preview={preview} channel={view.channel} /> : null}

      <Versions
        code={view.code}
        channel={view.channel}
        canEdit={canEdit}
        onLoad={(v) => {
          setSubject(v.subject ?? "");
          setBody(v.body);
          setPreview(null);
        }}
      />
    </div>
  );
}

/** Gabarits par établissement : édition, aperçu, publication d'une nouvelle version, retour arrière, activation. */
export function TemplatesScreen() {
  const t = useTranslations("v2NotificationsTemplates");
  const canEdit = usePermission(TEMPLATES).allowed;
  const catalog = useNotifCatalog();
  const templates = useNotifTemplates();
  const [code, setCode] = useState<string | null>(null);
  const [channel, setChannel] = useState<NotifChannel | null>(null);

  const entries = catalog.data?.items ?? [];
  const items = templates.data?.items ?? [];
  const current = entries.find((e) => e.code === code) ?? entries[0];
  const channelsOfCurrent = current ? items.filter((i) => i.code === current.code).map((i) => i.channel) : [];
  const activeChannel = channel && channelsOfCurrent.includes(channel) ? channel : (channelsOfCurrent[0] ?? null);
  const view = current && activeChannel ? items.find((i) => i.code === current.code && i.channel === activeChannel) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {catalog.isPending || templates.isPending ? (
        <LoadingBlock />
      ) : catalog.isError ? (
        <ErrorBlock error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : templates.isError ? (
        <ErrorBlock error={templates.error} onRetry={() => void templates.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("template")}>
              {(c) => (
                <select
                  {...c}
                  value={current?.code ?? ""}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setChannel(null);
                  }}
                  className={inputClass}
                >
                  {entries.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {current ? <p className="self-end pb-2 text-sm text-muted-foreground">{current.description}</p> : null}
          </div>
          <div role="tablist" aria-label={t("channels")} className="flex flex-wrap gap-2">
            {channelsOfCurrent.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === activeChannel} onClick={() => setChannel(c)} className={c === activeChannel ? buttonClass.primary : buttonClass.secondary}>
                {t(`channelNames.${c}`)}
              </button>
            ))}
          </div>
          {current && view ? (
            <Editor key={`${view.code}-${view.channel}-${view.version}-${view.updatedAt ?? "shipped"}`} entry={current} view={view} canEdit={canEdit} />
          ) : (
            <EmptyBlock title={t("noChannel")} />
          )}
        </>
      )}
    </div>
  );
}
