"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import {
  MESSAGING_AUDIENCES,
  MESSAGING_CLASS_INCLUDES,
  messagingCreateConversationBodySchema,
  type MessagingAttachmentDto,
  type MessagingAudience,
  type MessagingClassInclude,
  type MessagingRecipientDto,
} from "@ecoledigitale/contracts/v2/messaging";
import { useCreateConversation, useMyAudience, useRecipients } from "@/platform/v2/messaging";
import { useMyChildren } from "@/platform/v2/people";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useDebounced } from "@/platform/ui/useDebounced";
import { AttachmentPicker } from "./AttachmentPicker";
import { newClientId, PRIORITIES } from "./messaging-utils";

type Kind = "DIRECT" | "GROUP" | "BROADCAST";

interface ClassBlock {
  classroomId: string;
  label: string;
  include: MessagingClassInclude[];
}

/** Classes actives (administration : toute l'école). */
const useActiveClassroomOptions = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { status: "ACTIVE" });

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

/** Composition : l'API ne propose (`/recipients`) que les personnes que l'utilisateur a le droit d'écrire. */
export function ComposeScreen() {
  const t = useTranslations("v2Messaging.compose");
  const tc = useTranslations("v2Messaging");
  const router = useRouter();
  const describe = useDescribeError();
  const audience = useMyAudience();
  const create = useCreateConversation();
  const children = useMyChildren(audience.data?.isGuardian === true);
  const [kind, setKind] = useState<Kind>("DIRECT");
  const [recipients, setRecipients] = useState<MessagingRecipientDto[]>([]);
  const [blocks, setBlocks] = useState<ClassBlock[]>([]);
  const [pickClass, setPickClass] = useState<SelectOption | null>(null);
  const [pickInclude, setPickInclude] = useState<MessagingClassInclude[]>(["GUARDIANS"]);
  const [toAdministration, setToAdministration] = useState(false);
  const [wholeSchool, setWholeSchool] = useState(false);
  const [wholeAudiences, setWholeAudiences] = useState<MessagingAudience[]>(["GUARDIANS"]);
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("NORMAL");
  const [body, setBody] = useState("");
  const [allowReplies, setAllowReplies] = useState(true);
  const [aboutStudentId, setAboutStudentId] = useState("");
  const [attachments, setAttachments] = useState<MessagingAttachmentDto[]>([]);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [clientId] = useState(newClientId);
  const q = useDebounced(search.trim(), 300);
  const suggestions = useRecipients({ q }, audience.data?.canSend === true);

  const me = audience.data;
  const canBroadcast = me ? me.canSendAny || me.isStaff : false;
  const canBlocks = me ? me.canSendAny || (me.isStaff && me.classrooms.length > 0) : false;
  const kinds: Kind[] = me ? (["DIRECT", "GROUP", ...(canBroadcast ? (["BROADCAST"] as const) : [])] as Kind[]) : ["DIRECT"];
  const staffClassOptions = useMemo(() => (me?.classrooms ?? []).map((c) => ({ value: c.id, label: c.name })), [me]);

  if (audience.isPending) return <LoadingBlock />;
  if (audience.isError) return <ErrorBlock error={audience.error} onRetry={() => void audience.refetch()} />;
  if (!me!.canSend) return <Notice kind="warning">{me!.restricted ? tc("inbox.restricted") : t("cannotSend")}</Notice>;

  function addRecipient(r: MessagingRecipientDto) {
    setRecipients((cur) => (kind === "DIRECT" ? [r] : cur.some((x) => x.userId === r.userId) ? cur : [...cur, r]));
    setSearch("");
  }

  function addBlock() {
    if (!pickClass || pickInclude.length === 0) return;
    setBlocks((cur) => (cur.some((b) => b.classroomId === pickClass.value) ? cur : [...cur, { classroomId: pickClass.value, label: pickClass.label, include: pickInclude }]));
    setPickClass(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const draft = {
      kind,
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      priority,
      body,
      recipients: {
        userIds: recipients.map((r) => r.userId),
        classrooms: kind === "DIRECT" ? [] : blocks.map((b) => ({ classroomId: b.classroomId, include: b.include })),
        ...(wholeSchool && kind !== "DIRECT" ? { audience: { targets: [{ kind: "TENANT" as const }], audiences: wholeAudiences } } : {}),
        toAdministration: kind === "GROUP" && toAdministration,
      },
      ...(aboutStudentId ? { aboutStudentId } : {}),
      ...(kind === "GROUP" ? { allowReplies } : {}),
      attachmentIds: attachments.map((a) => a.id),
      clientId,
    };
    const checked = validateWith(messagingCreateConversationBodySchema, draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data, {
      onSuccess: (r) => router.push(r.conversation ? `/v2/messages/${r.conversation.id}` : "/v2/messages?folder=sent"),
      onError: (err) => setErrors(apiErrorToFieldErrors(err)),
    });
  }

  const recipientsError = errors["recipients"] ?? errors["recipients.userIds"];
  const directSelected = kind === "DIRECT" && recipients.length === 1;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label={t("title")}>
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/v2/messages" className={buttonClass.secondary}>{tc("common.cancel")}</Link>} />

      {me!.canSendAnyFamily ? (
        <div data-testid="any-family-notice">
          <Notice kind="info">{t("anyFamilyNotice")}</Notice>
        </div>
      ) : null}

      {kinds.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("kind")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {kinds.map((k) => (
              <label key={k} className="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => { setKind(k); if (k === "DIRECT") { setRecipients((cur) => cur.slice(0, 1)); setBlocks([]); setWholeSchool(false); setToAdministration(false); } }} />
                <span>
                  <span className="block font-medium">{t(`kinds.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`kindHints.${k}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <section aria-labelledby="compose-recipients" className="space-y-3">
        <h2 id="compose-recipients" className="text-base font-semibold">
          {t("recipients")}
        </h2>
        {recipients.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("selected")}>
            {recipients.map((r) => (
              <li key={r.userId} className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm">
                <span>
                  {r.displayName} <span className="text-xs text-muted-foreground">· {r.relation}</span>
                </span>
                <button type="button" aria-label={t("removeRecipient", { name: r.displayName })} className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setRecipients((cur) => cur.filter((x) => x.userId !== r.userId))}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!directSelected ? (
          <div className="space-y-2">
            <FormField label={t("search")} hint={t("searchHint")} error={recipientsError}>
              {(c) => <input {...c} type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={selectClass} autoComplete="off" />}
            </FormField>
            {suggestions.isError ? (
              <ErrorBlock error={suggestions.error} onRetry={() => void suggestions.refetch()} />
            ) : (
              <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-1 sm:grid-cols-2" aria-label={t("suggestions")} aria-busy={suggestions.isFetching}>
                {(suggestions.data ?? [])
                  .filter((s) => !recipients.some((r) => r.userId === s.userId))
                  .map((s) => (
                    <li key={s.userId}>
                      <button type="button" className="flex w-full flex-col rounded px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => addRecipient(s)}>
                        <span className="font-medium">{s.displayName}</span>
                        <span className="text-xs text-muted-foreground">{s.relation}</span>
                      </button>
                    </li>
                  ))}
                {!suggestions.isFetching && (suggestions.data ?? []).length === 0 ? <li className="px-2 py-3 text-sm text-muted-foreground">{q ? t("noPerson") : t("noSuggestion")}</li> : null}
              </ul>
            )}
          </div>
        ) : null}

        {kind !== "DIRECT" && canBlocks ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{t("classes")}</p>
            {blocks.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {blocks.map((b) => (
                  <li key={b.classroomId} className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm">
                    {b.label} · {b.include.map((i) => t(`includes.${i}`)).join(", ")}
                    <button type="button" aria-label={t("removeClass", { name: b.label })} onClick={() => setBlocks((cur) => cur.filter((x) => x.classroomId !== b.classroomId))} className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <FormField label={t("classLabel")}>
                {(c) =>
                  me!.canSendAny ? (
                    <SelectAsync {...c} value={pickClass} onChange={setPickClass} useOptions={useActiveClassroomOptions} placeholder={t("classPlaceholder")} />
                  ) : (
                    <select {...c} value={pickClass?.value ?? ""} onChange={(e) => setPickClass(staffClassOptions.find((o) => o.value === e.target.value) ?? null)} className={selectClass}>
                      <option value="">{t("classPlaceholder")}</option>
                      {staffClassOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )
                }
              </FormField>
              <button type="button" className={buttonClass.secondary} disabled={!pickClass || pickInclude.length === 0} onClick={addBlock}>
                {t("addClass")}
              </button>
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">{t("include")}</legend>
              {MESSAGING_CLASS_INCLUDES.map((i) => (
                <label key={i} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={pickInclude.includes(i)} onChange={(e) => setPickInclude((cur) => (e.target.checked ? [...cur, i] : cur.filter((x) => x !== i)))} /> {t(`includes.${i}`)}
                </label>
              ))}
            </fieldset>
          </div>
        ) : null}

        {kind !== "DIRECT" && me!.canSendAny ? (
          <div className="space-y-2 rounded-lg border p-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={wholeSchool} onChange={(e) => setWholeSchool(e.target.checked)} /> {t("wholeSchool")}
            </label>
            {wholeSchool ? (
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">{t("audiences")}</legend>
                {MESSAGING_AUDIENCES.map((a) => (
                  <label key={a} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={wholeAudiences.includes(a)} onChange={(e) => setWholeAudiences((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} /> {t(`audience.${a}`)}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
        ) : null}

        {kind === "GROUP" ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={toAdministration} onChange={(e) => setToAdministration(e.target.checked)} /> {t("toAdministration")}
          </label>
        ) : null}
        {kind === "BROADCAST" ? <Notice kind="info">{t("broadcastHint")}</Notice> : null}
      </section>

      {me!.isGuardian ? (
        <FormField label={t("aboutStudent")} hint={t("aboutStudentHint")} error={errors["aboutStudentId"]}>
          {(c) => (
            <select {...c} value={aboutStudentId} onChange={(e) => setAboutStudentId(e.target.value)} className={selectClass}>
              <option value="">{t("noStudent")}</option>
              {(children.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <FormField label={t("subject")} required={kind !== "DIRECT"} error={errors["subject"]}>
          {(c) => <input {...c} type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={selectClass} />}
        </FormField>
        <FormField label={t("priority")}>
          {(c) => (
            <select {...c} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={selectClass}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {tc(`priority.${p}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      <FormField label={t("body")} required error={errors["body"]}>
        {(c) => <textarea {...c} rows={7} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive" />}
      </FormField>

      <AttachmentPicker value={attachments} onChange={setAttachments} disabled={create.isPending} />

      {kind === "GROUP" ? (
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} /> {t("allowReplies")}
        </label>
      ) : null}

      {create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? (
        <Notice kind="error">{describe(create.error)}</Notice>
      ) : null}
      {Object.keys(errors).length > 0 && !errors["subject"] && !errors["body"] && !recipientsError && !errors["aboutStudentId"] ? <Notice kind="error">{Object.values(errors)[0]}</Notice> : null}

      <div className="flex justify-end gap-2">
        <button type="submit" className={buttonClass.primary} disabled={create.isPending}>
          {create.isPending ? tc("common.sending") : tc("common.send")}
        </button>
      </div>
    </form>
  );
}
