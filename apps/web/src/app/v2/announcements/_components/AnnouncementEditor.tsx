"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MESSAGING_AUDIENCES, messagingCreateAnnouncementBodySchema, type MessagingAnnouncementDto, type MessagingAttachmentDto, type MessagingAudience } from "@ecoledigitale/contracts/v2/messaging";
import { useAnnouncement, useAudiencePreview, useCreateAnnouncement, usePublishAnnouncement, useUpdateAnnouncement } from "@/platform/v2/messaging";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { AttachmentPicker } from "../../messages/_components/AttachmentPicker";
import { isoToLocal, localToIso, PRIORITIES } from "../../messages/_components/messaging-utils";
import { TargetsEditor, type TargetItem } from "./TargetsEditor";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

function EditorForm({ existing }: { existing: MessagingAnnouncementDto | null }) {
  const t = useTranslations("v2MessagingAnnouncements");
  const tp = useTranslations("v2Messaging.priority");
  const router = useRouter();
  const describe = useDescribeError();
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const publishExisting = usePublishAnnouncement();
  const preview = useAudiencePreview();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>(existing?.priority ?? "NORMAL");
  const [targets, setTargets] = useState<TargetItem[]>(() => (existing?.targets ?? []).map((tg) => ({ kind: tg.kind, ...(tg.ref ? { ref: tg.ref } : {}), label: tg.ref ? `${tg.ref.slice(0, 8)}…` : t(`targets.${tg.kind}`) })));
  const [audiences, setAudiences] = useState<MessagingAudience[]>(existing?.audiences ?? ["STUDENTS", "GUARDIANS"]);
  const [requireAck, setRequireAck] = useState(existing?.requireAck ?? false);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [publishAt, setPublishAt] = useState(isoToLocal(existing?.publishAt));
  const [expiresAt, setExpiresAt] = useState(isoToLocal(existing?.expiresAt));
  const [attachments, setAttachments] = useState<MessagingAttachmentDto[]>(existing?.attachments ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});
  const pending = create.isPending || update.isPending || publishExisting.isPending;
  const apiError = create.error ?? update.error ?? publishExisting.error;

  function draftBody(publish: boolean) {
    return {
      title: title.trim(),
      body,
      priority,
      audience: { targets: targets.map(({ kind, ref }) => ({ kind, ...(ref ? { ref } : {}) })), audiences },
      requireAck,
      pinned,
      ...(localToIso(publishAt) ? { publishAt: localToIso(publishAt) } : {}),
      ...(localToIso(expiresAt) ? { expiresAt: localToIso(expiresAt) } : {}),
      attachmentIds: attachments.map((a) => a.id),
      publish,
    };
  }

  function save(publish: boolean) {
    const checked = validateWith(messagingCreateAnnouncementBodySchema, draftBody(publish));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const onError = (e: unknown) => setErrors(apiErrorToFieldErrors(e));
    if (!existing) {
      create.mutate(checked.data, { onSuccess: (a) => router.push(`/v2/announcements/${a.id}`), onError });
      return;
    }
    const d = checked.data;
    update.mutate(
      { id: existing.id, title: d.title, body: d.body, priority: d.priority, audience: d.audience, requireAck: d.requireAck, pinned: d.pinned, publishAt: d.publishAt ?? null, expiresAt: d.expiresAt ?? null, attachmentIds: d.attachmentIds },
      {
        onSuccess: (a) => (publish ? publishExisting.mutate({ id: a.id, ...(d.publishAt ? { publishAt: d.publishAt } : {}) }, { onSuccess: () => router.push(`/v2/announcements/${a.id}`), onError }) : router.push(`/v2/announcements/${a.id}`)),
        onError,
      },
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save(false);
  }

  const targetsError = errors["audience.targets"] ?? errors["audience"];

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label={existing ? t("editor.editTitle") : t("editor.newTitle")}>
      <PageHeader title={existing ? t("editor.editTitle") : t("editor.newTitle")} description={t("editor.description")} actions={<Link href={existing ? `/v2/announcements/${existing.id}` : "/v2/announcements"} className={buttonClass.secondary}>{t("editor.cancel")}</Link>} />

      <FormField label={t("editor.title")} required error={errors["title"]}>
        {(c) => <input {...c} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />}
      </FormField>
      <FormField label={t("editor.body")} required error={errors["body"]}>
        {(c) => <textarea {...c} rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive" />}
      </FormField>

      <TargetsEditor value={targets} onChange={setTargets} error={targetsError} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("editor.audiences")}</legend>
        <p className="text-xs text-muted-foreground">{t("editor.audiencesHint")}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {MESSAGING_AUDIENCES.map((a) => (
            <label key={a} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={audiences.includes(a)} onChange={(e) => setAudiences((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} /> {t(`audiences.${a}`)}
            </label>
          ))}
        </div>
        {errors["audience.audiences"] ? <p role="alert" className="text-xs font-medium text-destructive">{errors["audience.audiences"]}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass.secondary} disabled={targets.length === 0 || preview.isPending} onClick={() => preview.mutate({ targets: targets.map(({ kind, ref }) => ({ kind, ...(ref ? { ref } : {}) })), audiences })}>
            {t("editor.preview")}
          </button>
          {preview.data ? <span role="status" className="text-sm">{t("editor.previewCount", { count: preview.data.count })}{preview.data.truncated ? ` ${t("editor.previewTruncated")}` : ""}</span> : null}
          {preview.error ? <span role="alert" className="text-sm text-destructive">{describe(preview.error)}</span> : null}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t("editor.priority")}>
          {(c) => (
            <select {...c} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={inputClass}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {tp(p)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={t("editor.publishAt")} hint={t("editor.publishAtHint")} error={errors["publishAt"]}>
          {(c) => <input {...c} type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={inputClass} />}
        </FormField>
        <FormField label={t("editor.expiresAt")} hint={t("editor.expiresAtHint")} error={errors["expiresAt"]}>
          {(c) => <input {...c} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputClass} />}
        </FormField>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={requireAck} onChange={(e) => setRequireAck(e.target.checked)} /> {t("editor.requireAck")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {t("editor.pinned")}
        </label>
      </div>

      <AttachmentPicker value={attachments} onChange={setAttachments} disabled={pending} />

      {apiError && Object.keys(apiErrorToFieldErrors(apiError)).length === 0 ? <Notice kind="error">{describe(apiError)}</Notice> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="submit" className={buttonClass.secondary} disabled={pending}>
          {t("editor.saveDraft")}
        </button>
        <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => save(true)}>
          {publishAt && localToIso(publishAt) && new Date(localToIso(publishAt)!).getTime() > Date.now() ? t("editor.schedule") : t("editor.publish")}
        </button>
      </div>
    </form>
  );
}

/** Création / modification d'une annonce (brouillon ou programmée) : ciblage, audiences, dates, accusé, pièces. */
export function AnnouncementEditor({ announcementId }: { announcementId?: string }) {
  const q = useAnnouncement(announcementId ?? null);
  if (announcementId) {
    if (q.isPending) return <LoadingBlock />;
    if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
    return <EditorForm key={q.data.id} existing={q.data} />;
  }
  return <EditorForm existing={null} />;
}
