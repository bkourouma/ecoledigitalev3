"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { MESSAGING_ATTACHMENT_TYPES, MESSAGING_STUDENT_POLICIES, type MessagingSettingsDto, type MessagingSystemTemplateDto } from "@ecoledigitale/contracts/v2/messaging";
import { useMessagingSettings, useSystemTemplates, useUpdateMessagingSettings, useUpdateSystemTemplate } from "@/platform/v2/messaging";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

const NUMBERS = [
  ["maxMessagesPerHour", 1, 10000],
  ["maxNewConversationsPerDay", 1, 10000],
  ["maxGroupParticipants", 2, 5000],
  ["maxBroadcastParticipants", 2, 20000],
  ["messageMaxLength", 100, 20000],
  ["attachmentMaxPerItem", 1, 20],
  ["notificationRetentionDays", 7, 3650],
] as const;

function SettingsForm({ settings }: { settings: MessagingSettingsDto }) {
  const t = useTranslations("v2MessagingSettings");
  const describe = useDescribeError();
  const flash = useFlash();
  const update = useUpdateMessagingSettings();
  const [draft, setDraft] = useState<MessagingSettingsDto>(settings);
  const [roles, setRoles] = useState(settings.adminContactRoles.join(", "));
  const [mb, setMb] = useState(String(Math.round((settings.attachmentMaxBytes / (1024 * 1024)) * 10) / 10));
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const adminContactRoles = roles.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean);
    const attachmentMaxBytes = Math.round(Number(mb.replace(",", ".")) * 1024 * 1024);
    if (!Number.isFinite(attachmentMaxBytes) || attachmentMaxBytes < 1 || attachmentMaxBytes > 25 * 1024 * 1024) return setError(t("sizeInvalid"));
    if (draft.maxGroupParticipants > draft.maxBroadcastParticipants) return setError(t("groupAboveBroadcast"));
    setError(null);
    update.mutate(
      {
        studentPolicy: draft.studentPolicy,
        adminContactRoles,
        attachmentsEnabled: draft.attachmentsEnabled,
        attachmentMaxBytes,
        attachmentMaxPerItem: draft.attachmentMaxPerItem,
        allowedAttachmentTypes: draft.allowedAttachmentTypes,
        maxMessagesPerHour: draft.maxMessagesPerHour,
        maxNewConversationsPerDay: draft.maxNewConversationsPerDay,
        maxGroupParticipants: draft.maxGroupParticipants,
        maxBroadcastParticipants: draft.maxBroadcastParticipants,
        messageMaxLength: draft.messageMaxLength,
        notificationRetentionDays: draft.notificationRetentionDays,
      },
      { onSuccess: () => flash.show(t("saved")) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label={t("title")}>
      <FormField label={t("studentPolicy")} hint={t("studentPolicyHint")}>
        {(c) => (
          <select {...c} value={draft.studentPolicy} onChange={(e) => setDraft({ ...draft, studentPolicy: e.target.value as MessagingSettingsDto["studentPolicy"] })} className={inputClass}>
            {MESSAGING_STUDENT_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(`policies.${p}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={t("adminContactRoles")} hint={t("adminContactRolesHint")}>
        {(c) => <input {...c} type="text" value={roles} onChange={(e) => setRoles(e.target.value)} className={inputClass} />}
      </FormField>
      <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
        <legend className="px-1 text-sm font-semibold">{t("attachments")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.attachmentsEnabled} onChange={(e) => setDraft({ ...draft, attachmentsEnabled: e.target.checked })} /> {t("attachmentsEnabled")}
        </label>
        <FormField label={t("attachmentMaxMb")}>{(c) => <input {...c} type="text" inputMode="decimal" value={mb} onChange={(e) => setMb(e.target.value)} className={inputClass} />}</FormField>
        <div className="flex flex-wrap gap-4 text-sm">
          {MESSAGING_ATTACHMENT_TYPES.map((m) => (
            <label key={m} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.allowedAttachmentTypes.includes(m)}
                onChange={(e) => setDraft({ ...draft, allowedAttachmentTypes: e.target.checked ? [...draft.allowedAttachmentTypes, m] : draft.allowedAttachmentTypes.filter((x) => x !== m) })}
              />{" "}
              {t(`mime.${m.replace("/", "_")}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {NUMBERS.map(([key, min, max]) => (
          <FormField key={key} label={t(`numbers.${key}`)} hint={t("range", { min, max })}>
            {(c) => <input {...c} type="number" min={min} max={max} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} className={inputClass} />}
          </FormField>
        ))}
      </div>
      {flash.node}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}

function TemplateCard({ tpl }: { tpl: MessagingSystemTemplateDto }) {
  const t = useTranslations("v2MessagingSettings.templates");
  const describe = useDescribeError();
  const flash = useFlash();
  const update = useUpdateSystemTemplate();
  const [title, setTitle] = useState(tpl.title);
  const [body, setBody] = useState(tpl.body);
  const [enabled, setEnabled] = useState(tpl.enabled);
  return (
    <form
      className="space-y-3 rounded-lg border p-3 sm:p-4"
      aria-label={t(`names.${tpl.code}`)}
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ code: tpl.code, title, body, enabled }, { onSuccess: () => flash.show(t("saved")) });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t(`names.${tpl.code}`)}</h3>
        {tpl.customized ? <StatusBadge label={t("customized")} tone="info" /> : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("enabled")}
      </label>
      <FormField label={t("title")}>{(c) => <input {...c} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />}</FormField>
      <FormField label={t("body")} hint={t("variables", { list: tpl.variables.map((v) => `{{${v}}}`).join(" ") })}>
        {(c) => <textarea {...c} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />}
      </FormField>
      {flash.node}
      {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}

/** Paramètres de la messagerie de l'établissement et gabarits des messages système. */
export function SettingsScreen() {
  const t = useTranslations("v2MessagingSettings");
  const settings = useMessagingSettings();
  const templates = useSystemTemplates();
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {settings.isPending ? <LoadingBlock /> : settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} />}
      <section aria-labelledby="tpl-title" className="space-y-3">
        <h2 id="tpl-title" className="text-lg font-semibold">
          {t("templates.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("templates.description")}</p>
        {templates.isPending ? (
          <LoadingBlock />
        ) : templates.isError ? (
          <ErrorBlock error={templates.error} onRetry={() => void templates.refetch()} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.data.map((tpl) => (
              <TemplateCard key={`${tpl.code}-${tpl.title}-${tpl.enabled}`} tpl={tpl} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
