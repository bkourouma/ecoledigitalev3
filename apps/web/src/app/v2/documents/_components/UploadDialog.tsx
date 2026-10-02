"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DocumentCategoryDto, DocumentMyContextDto } from "@ecoledigitale/contracts/v2/documents";
import { usePeopleOptions, useMyDocumentsContext, useDocumentCategories, useUploadDocument, type UploadFields } from "@/platform/v2/documents";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { buttonClass } from "@/platform/ui/PageHeader";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { UploadDropzone } from "@/platform/ui/UploadDropzone";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { parseTags } from "./documents-utils";

type OwnerType = "STUDENT" | "STAFF" | "NONE";

export interface OwnerPlan {
  /** Le propriétaire peut-il être choisi (recherche), est-il imposé (compte de l'appelant), ou aucun ? */
  type: OwnerType;
  mode: "none" | "search" | "children" | "self";
  /** Types proposables quand la catégorie n'impose rien (documents académiques et financiers déposés par le personnel). */
  choices: OwnerType[];
  fixedId: string | null;
  fixedName: string | null;
  children: Array<{ id: string; displayName: string }>;
}

/** Qui est le propriétaire du document déposé : imposé par le type de catégorie et par les liens de l'appelant (l'API revérifie). */
export function ownerPlan(category: DocumentCategoryDto | null, ctx: DocumentMyContextDto, chosenType: OwnerType): OwnerPlan {
  const staffLike = ctx.caps.upload || ctx.caps.manage;
  const base: OwnerPlan = { type: "NONE", mode: "none", choices: [], fixedId: null, fixedName: null, children: [] };
  if (!category) return base;
  const forStudent = (): OwnerPlan => {
    if (staffLike) return { ...base, type: "STUDENT", mode: "search" };
    if (ctx.caps.childUpload && ctx.links.children.length > 0) return { ...base, type: "STUDENT", mode: "children", children: ctx.links.children, fixedId: ctx.links.children[0]?.id ?? null };
    if (ctx.caps.selfUpload && ctx.links.studentId) return { ...base, type: "STUDENT", mode: "self", fixedId: ctx.links.studentId, fixedName: ctx.links.studentName };
    return base;
  };
  const forStaff = (): OwnerPlan => {
    if (staffLike) return { ...base, type: "STAFF", mode: "search" };
    if (ctx.caps.ownUpload && ctx.links.staffId) return { ...base, type: "STAFF", mode: "self", fixedId: ctx.links.staffId, fixedName: ctx.links.staffName };
    return base;
  };
  switch (category.kind) {
    case "STUDENT":
      return forStudent();
    case "TEACHER":
      return forStaff();
    case "INSTITUTION":
      return base;
    default: {
      if (staffLike) {
        const plan = chosenType === "STUDENT" ? forStudent() : chosenType === "STAFF" ? forStaff() : base;
        return { ...plan, choices: ["NONE", "STUDENT", "STAFF"] };
      }
      const own = forStudent();
      return own.mode !== "none" ? own : forStaff();
    }
  }
}

/** Dépôt d'un document : fichier (glisser-déposer ou sélecteur), catégorie, propriétaire, descripteurs, échéance. */
export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("v2Documents.upload");
  const router = useRouter();
  const ctx = useMyDocumentsContext(open);
  const categories = useDocumentCategories({}, open);
  const mutation = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [chosenType, setChosenType] = useState<OwnerType>("NONE");
  const [owner, setOwner] = useState<SelectOption | null>(null);
  const [childId, setChildId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [visibility, setVisibility] = useState<"INHERIT" | "STAFF_ONLY" | "PRIVATE">("INHERIT");
  const [submitted, setSubmitted] = useState(false);

  const uploadable = useMemo(() => (categories.data?.items ?? []).filter((c) => c.canUpload && c.status === "ACTIVE"), [categories.data]);
  const category = uploadable.find((c) => c.id === categoryId) ?? null;
  const plan = ctx.data ? ownerPlan(category, ctx.data, chosenType) : null;
  const effectiveOwnerId = plan ? (plan.mode === "search" ? (owner?.value ?? null) : plan.mode === "children" ? (childId || plan.fixedId) : plan.fixedId) : null;
  const staffLike = Boolean(ctx.data?.caps.upload || ctx.data?.caps.manage);
  const effectiveTitle = title.trim() || (file ? file.name.replace(/\.[^.]+$/, "") : "");
  const apiErrors = apiErrorToFieldErrors(mutation.error);

  const problems = {
    file: !file ? t("errors.file") : null,
    category: !category ? t("errors.category") : null,
    owner: plan && plan.type !== "NONE" && !effectiveOwnerId ? t("errors.owner") : null,
    expiry: category?.requiresExpiry && !expiresOn ? t("errors.expiry") : null,
  };
  const invalid = Object.values(problems).some(Boolean);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || !file || !category || !plan) return;
    const fields: UploadFields = {
      categoryId: category.id,
      title: effectiveTitle,
      ownerType: plan.type,
      ownerId: plan.type === "NONE" ? null : effectiveOwnerId,
      ...(description.trim() ? { description } : {}),
      ...(parseTags(tagsText).length > 0 ? { tags: parseTags(tagsText) } : {}),
      ...(expiresOn ? { expiresOn } : {}),
      ...(staffLike && visibility !== "INHERIT" ? { visibility } : {}),
    };
    mutation.mutate({ fields, file }, { onSuccess: (doc) => { onOpenChange(false); router.push(`/v2/documents/${doc.id}`); } });
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} className="sm:max-w-xl">
      {ctx.isPending || categories.isPending ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">{t("loading")}</p>
      ) : ctx.isError || categories.isError ? (
        <ErrorBlock error={ctx.error ?? categories.error} onRetry={() => { void ctx.refetch(); void categories.refetch(); }} />
      ) : uploadable.length === 0 ? (
        <Notice kind="info">{t("noCategory")}</Notice>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormField label={t("category")} required error={submitted ? problems.category : null}>
            {(c) => (
              <NativeSelect
                {...c}
                value={categoryId}
                placeholder={t("categoryPlaceholder")}
                options={uploadable.map((x) => ({ value: x.id, label: x.label }))}
                onChange={(v) => {
                  setCategoryId(v);
                  setOwner(null);
                  setChosenType("NONE");
                }}
              />
            )}
          </FormField>

          <div>
            <p className="mb-1.5 text-sm font-medium">
              {t("file")}
              <span className="sr-only"> ({t("required")})</span>
            </p>
            <UploadDropzone
              onFile={(f) => setFile(f)}
              extensions={category?.allowedExtensions}
              maxBytes={Math.min(category?.maxBytes ?? ctx.data.upload.defaultMaxBytes, ctx.data.upload.hardMaxBytes)}
              busy={mutation.isPending}
              selectedName={file?.name ?? null}
            />
            {submitted && problems.file ? <p role="alert" className="text-xs font-medium text-destructive">{problems.file}</p> : null}
            {apiErrors.file ? <p role="alert" className="text-xs font-medium text-destructive">{apiErrors.file}</p> : null}
          </div>

          {plan && plan.choices.length > 0 ? (
            <FormField label={t("ownerType")}>
              {(c) => (
                <NativeSelect
                  {...c}
                  value={chosenType}
                  options={plan.choices.map((x) => ({ value: x, label: t(`ownerTypes.${x}`) }))}
                  onChange={(v) => {
                    setChosenType(v as OwnerType);
                    setOwner(null);
                  }}
                />
              )}
            </FormField>
          ) : null}
          {plan?.mode === "search" ? (
            <FormField label={plan.type === "STUDENT" ? t("ownerStudent") : t("ownerStaff")} required error={submitted ? problems.owner : null}>
              {(c) => <SelectAsync {...c} value={owner} onChange={setOwner} useOptions={(s, enabled) => usePeopleOptions(plan.type === "STUDENT" ? "STUDENT" : "STAFF", s, enabled)} placeholder={t("ownerSearch")} />}
            </FormField>
          ) : null}
          {plan?.mode === "children" ? (
            <FormField label={t("ownerChild")} required>
              {(c) => <NativeSelect {...c} value={childId || plan.fixedId || ""} options={plan.children.map((x) => ({ value: x.id, label: x.displayName }))} onChange={setChildId} />}
            </FormField>
          ) : null}
          {plan?.mode === "self" ? (
            <p className="text-sm">
              <span className="font-medium">{t("ownerSelf")}</span> {plan.fixedName ?? ""}
            </p>
          ) : null}

          <FormField label={t("titleLabel")} hint={t("titleHint")} error={apiErrors.title ?? null}>
            {(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={200} />}
          </FormField>
          <FormField label={t("descriptionLabel")}>{(c) => <TextAreaControl {...c} value={description} onChange={setDescription} maxLength={2000} rows={2} />}</FormField>
          <FormField label={t("tags")} hint={t("tagsHint")}>{(c) => <TextControl {...c} value={tagsText} onChange={setTagsText} />}</FormField>
          <FormField label={t("expiresOn")} required={Boolean(category?.requiresExpiry)} hint={category?.requiresExpiry ? t("expiryRequiredHint") : t("expiryHint")} error={submitted ? problems.expiry : (apiErrors.expiresOn ?? null)}>
            {(c) => <TextControl {...c} type="date" value={expiresOn} onChange={setExpiresOn} />}
          </FormField>
          {staffLike ? (
            <FormField label={t("visibility")} hint={t("visibilityHint")}>
              {(c) => (
                <NativeSelect
                  {...c}
                  value={visibility}
                  options={[
                    { value: "INHERIT", label: t("visibilities.INHERIT") },
                    { value: "STAFF_ONLY", label: t("visibilities.STAFF_ONLY") },
                    { value: "PRIVATE", label: t("visibilities.PRIVATE") },
                  ]}
                  onChange={(v) => setVisibility(v as typeof visibility)}
                />
              )}
            </FormField>
          ) : null}

          {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className={buttonClass.secondary}>
              {t("cancel")}
            </button>
            <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>
              {mutation.isPending ? t("submitting") : t("submit")}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
