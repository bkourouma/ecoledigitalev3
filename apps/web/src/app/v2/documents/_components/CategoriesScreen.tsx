"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, ShieldCheck } from "lucide-react";
import { DOCUMENT_KINDS, DOCUMENT_CONFIDENTIALITIES, type DocumentCategoryDto, type DocumentKind } from "@ecoledigitale/contracts/v2/documents";
import {
  useCategoryGrants,
  useCreateCategory,
  useDocumentCategories,
  useGrantCategory,
  useMyDocumentsContext,
  usePeopleOptions,
  useRevokeCategoryGrant,
  useSetCategoryArchived,
  useUpdateCategory,
} from "@/platform/v2/documents";
import { useDateFormat } from "@/platform/ui/format";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { bytesToMiB, confidentialityTone, mibToBytes, parseAlertDays } from "./documents-utils";

// ---------------------------------------------------------------------------
// Formulaire d'une catégorie (création et modification)
// ---------------------------------------------------------------------------

function CategoryDialog({ open, onOpenChange, category, extensions }: { open: boolean; onOpenChange: (o: boolean) => void; category: DocumentCategoryDto | null; extensions: readonly string[] }) {
  const t = useTranslations("v2Documents.categories.form");
  const create = useCreateCategory();
  const update = useUpdateCategory(category?.id ?? "none");
  const mutation = category ? update : create;
  const [code, setCode] = useState(category?.code ?? "");
  const [kind, setKind] = useState<DocumentKind>(category?.kind ?? "STUDENT");
  const [label, setLabel] = useState(category?.label ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [confidentiality, setConfidentiality] = useState(category?.confidentiality ?? "RESTRICTED");
  const [selected, setSelected] = useState<string[]>(category ? [...category.allowedExtensions] : ["pdf", "jpg", "jpeg", "png"]);
  const [maxMiB, setMaxMiB] = useState(category?.maxBytes ? bytesToMiB(category.maxBytes) : "");
  const [audienceOwner, setAudienceOwner] = useState(category?.audienceOwner ?? false);
  const [audienceGuardians, setAudienceGuardians] = useState(category?.audienceGuardians ?? false);
  const [ownerUpload, setOwnerUpload] = useState(category?.ownerUpload ?? false);
  const [requiresExpiry, setRequiresExpiry] = useState(category?.requiresExpiry ?? false);
  const [alertText, setAlertText] = useState(category?.alertDays?.join(", ") ?? "");
  const [retention, setRetention] = useState(category?.retentionDays === null || category?.retentionDays === undefined ? "" : String(category.retentionDays));
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);

  const maxBytes = maxMiB.trim() ? mibToBytes(maxMiB) : null;
  const alertDays = alertText.trim() ? parseAlertDays(alertText) : null;
  const problems = {
    code: !category && !/^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? t("errors.code") : null,
    label: !label.trim() ? t("errors.label") : null,
    extensions: selected.length === 0 ? t("errors.extensions") : null,
    max: maxMiB.trim() && maxBytes === null ? t("errors.max") : null,
    alert: alertText.trim() && alertDays === null ? t("errors.alert") : null,
  };
  const invalid = Object.values(problems).some(Boolean);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    const common = {
      label: label.trim(),
      description: description.trim() ? description.trim() : null,
      confidentiality,
      allowedExtensions: selected as never,
      maxBytes,
      audienceOwner,
      audienceGuardians,
      ownerUpload,
      requiresExpiry,
      alertDays,
      retentionDays: retention.trim() ? Number(retention) : null,
    };
    if (category) update.mutate(common as never, { onSuccess: () => onOpenChange(false) });
    else create.mutate({ ...common, code, kind } as never, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={category ? t("editTitle") : t("createTitle")} description={t("description")} className="sm:max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4">
        {!category ? (
          <>
            <FormField label={t("code")} required hint={t("codeHint")} error={submitted ? problems.code : (errors.code ?? null)}>{(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={40} />}</FormField>
            <FormField label={t("kind")} required hint={t("kindHint")}>
              {(c) => <NativeSelect {...c} value={kind} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} onChange={(v) => setKind(v as DocumentKind)} />}
            </FormField>
          </>
        ) : null}
        <FormField label={t("label")} required error={submitted ? problems.label : (errors.label ?? null)}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={120} />}</FormField>
        <FormField label={t("descriptionLabel")}>{(c) => <TextAreaControl {...c} value={description} onChange={setDescription} rows={2} maxLength={2000} />}</FormField>
        <FormField label={t("confidentiality")} hint={t("confidentialityHint")}>
          {(c) => <NativeSelect {...c} value={confidentiality} options={DOCUMENT_CONFIDENTIALITIES.map((x) => ({ value: x, label: t(`levels.${x}`) }))} onChange={(v) => setConfidentiality(v as typeof confidentiality)} />}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t("extensions")}
            <span className="sr-only"> ({t("required")})</span>
          </legend>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {extensions.map((ext) => (
              <CheckControl key={ext} label={`.${ext}`} checked={selected.includes(ext)} onChange={(on) => setSelected((cur) => (on ? [...cur, ext] : cur.filter((x) => x !== ext)))} />
            ))}
          </div>
          {submitted && problems.extensions ? <p role="alert" className="text-xs font-medium text-destructive">{problems.extensions}</p> : <p className="text-xs text-muted-foreground">{t("extensionsHint")}</p>}
        </fieldset>
        <FormField label={t("maxMiB")} hint={t("maxHint")} error={submitted ? problems.max : null}>{(c) => <TextControl {...c} inputMode="decimal" value={maxMiB} onChange={setMaxMiB} />}</FormField>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("audiences")}</legend>
          <CheckControl label={t("audienceOwner")} hint={t("audienceOwnerHint")} checked={audienceOwner} onChange={setAudienceOwner} disabled={kind === "INSTITUTION"} />
          <CheckControl label={t("audienceGuardians")} hint={t("audienceGuardiansHint")} checked={audienceGuardians} onChange={setAudienceGuardians} disabled={kind === "INSTITUTION" || kind === "TEACHER"} />
          <CheckControl label={t("ownerUpload")} hint={t("ownerUploadHint")} checked={ownerUpload} onChange={setOwnerUpload} disabled={kind === "INSTITUTION"} />
        </fieldset>
        <CheckControl label={t("requiresExpiry")} hint={t("requiresExpiryHint")} checked={requiresExpiry} onChange={setRequiresExpiry} />
        <FormField label={t("alertDays")} hint={t("alertDaysHint")} error={submitted ? problems.alert : null}>{(c) => <TextControl {...c} value={alertText} onChange={setAlertText} placeholder="30, 7, 1" />}</FormField>
        <FormField label={t("retention")} hint={t("retentionHint")}>{(c) => <TextControl {...c} type="number" min={0} max={3650} value={retention} onChange={setRetention} />}</FormField>
        {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass.secondary}>{t("cancel")}</button>
          <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>{mutation.isPending ? t("saving") : t("save")}</button>
        </div>
      </form>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------
// Droits de catégorie par personne
// ---------------------------------------------------------------------------

function GrantsDialog({ category, open, onOpenChange }: { category: DocumentCategoryDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Documents.categories.grants");
  const date = useDateFormat();
  const grants = useCategoryGrants(category.id);
  const grant = useGrantCategory(category.id);
  const revoke = useRevokeCategoryGrant(category.id);
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [level, setLevel] = useState<"READ" | "WRITE">("READ");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const active = (grants.data?.items ?? []).filter((g) => g.active);
  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title", { label: category.label })} description={t("description")} className="sm:max-w-xl">
      <div className="space-y-4">
        {grants.isPending ? <LoadingBlock /> : grants.isError ? <ErrorBlock error={grants.error} onRetry={() => void grants.refetch()} /> : active.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : (
          <ul aria-label={t("listLabel")} className="space-y-2">
            {active.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium">{g.userName ?? t("unknownPerson")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`levels.${g.level}`)} · {g.expiresAt ? t("until", { date: date.instant(g.expiresAt) }) : t("noEnd")}
                  </p>
                </div>
                <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)} aria-label={t("revokeFor", { name: g.userName ?? t("unknownPerson") })} className={buttonClass.ghost}>
                  {t("revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {revoke.isError ? <ErrorBlock error={revoke.error} /> : null}
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <FormField label={t("person")} className="sm:col-span-2">
            {(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={(s, enabled) => usePeopleOptions("USER", s, enabled)} placeholder={t("personSearch")} />}
          </FormField>
          <FormField label={t("level")}>
            {(c) => <NativeSelect {...c} value={level} options={(["READ", "WRITE"] as const).map((l) => ({ value: l, label: t(`levels.${l}`) }))} onChange={(v) => setLevel(v as typeof level)} />}
          </FormField>
          <FormField label={t("endDate")}>{(c) => <TextControl {...c} type="date" value={until} onChange={setUntil} />}</FormField>
          <FormField label={t("note")} className="sm:col-span-2">{(c) => <TextControl {...c} value={note} onChange={setNote} maxLength={500} />}</FormField>
        </div>
        {grant.isError ? <ErrorBlock error={grant.error} /> : null}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!person || grant.isPending}
            onClick={() => person && grant.mutate({ userId: person.value, level, ...(until ? { expiresAt: new Date(`${until}T23:59:59`).toISOString() } : {}), ...(note.trim() ? { note } : {}) }, { onSuccess: () => { setPerson(null); setNote(""); setUntil(""); } })}
            className={buttonClass.primary}
          >
            {grant.isPending ? t("granting") : t("grant")}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------

/** Catégories configurables du tenant : niveau de confidentialité, extensions, audiences, expiration, rétention, droits par personne. */
export function CategoriesScreen() {
  const t = useTranslations("v2Documents.categories");
  const ctx = useMyDocumentsContext();
  const query = useDocumentCategories({ includeArchived: true });
  const setArchived = useSetCategoryArchived();
  const [editing, setEditing] = useState<DocumentCategoryDto | "new" | null>(null);
  const [granting, setGranting] = useState<DocumentCategoryDto | null>(null);
  const flash = useFlash();
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" onClick={() => setEditing("new")} className={buttonClass.primary}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("create")}
          </button>
        }
      />
      {flash.node}
      {setArchived.isError ? <ErrorBlock error={setArchived.error} /> : null}
      {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} /> : (
        <div className="space-y-6">
          {DOCUMENT_KINDS.map((kind) => {
            const group = items.filter((c) => c.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`kind-${kind}`} className="space-y-2">
                <h2 id={`kind-${kind}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t(`kinds.${kind}`)}</h2>
                <ul aria-label={t(`kinds.${kind}`)} className="space-y-2">
                  {group.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-semibold">
                          {c.label} <span className="font-mono text-xs font-normal text-muted-foreground">{c.code}</span>
                        </p>
                        {c.description ? <p className="text-xs text-muted-foreground">{c.description}</p> : null}
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge label={t(`levels.${c.confidentiality}`)} tone={confidentialityTone(c.confidentiality)} />
                          {c.status === "ARCHIVED" ? <StatusBadge label={t("archived")} tone="warning" /> : null}
                          {c.requiresExpiry ? <StatusBadge label={t("requiresExpiry")} tone="info" /> : null}
                          {c.audienceOwner ? <StatusBadge label={t("audienceOwner")} /> : null}
                          {c.audienceGuardians ? <StatusBadge label={t("audienceGuardians")} /> : null}
                          {c.ownerUpload ? <StatusBadge label={t("ownerUpload")} /> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {c.allowedExtensions.map((e) => `.${e}`).join(" ")}
                          {c.documentCount !== null ? ` · ${t("documents", { count: c.documentCount })}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setEditing(c)} aria-label={t("editFor", { label: c.label })} className={buttonClass.secondary}>{t("edit")}</button>
                        <button type="button" onClick={() => setGranting(c)} aria-label={t("grantsFor", { label: c.label })} className={buttonClass.secondary}>
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          {t("grantsButton")}
                        </button>
                        <button
                          type="button"
                          disabled={setArchived.isPending}
                          onClick={() => setArchived.mutate({ id: c.id, archived: c.status === "ACTIVE" }, { onSuccess: () => flash.show(c.status === "ACTIVE" ? t("archivedDone", { label: c.label }) : t("restoredDone", { label: c.label })) })}
                          aria-label={c.status === "ACTIVE" ? t("archiveFor", { label: c.label }) : t("restoreFor", { label: c.label })}
                          className={buttonClass.ghost}
                        >
                          {c.status === "ACTIVE" ? t("archive") : t("restore")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <Notice kind="info">{t("note")}</Notice>
      {editing !== null && ctx.data ? <CategoryDialog open onOpenChange={(o) => !o && setEditing(null)} category={editing === "new" ? null : editing} extensions={ctx.data.upload.supportedExtensions} /> : null}
      {granting ? <GrantsDialog category={granting} open onOpenChange={(o) => !o && setGranting(null)} /> : null}
    </div>
  );
}
