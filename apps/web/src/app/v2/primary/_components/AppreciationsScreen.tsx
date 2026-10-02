"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PRIMARY_PHRASE_SCOPES, primaryCreatePhraseBodySchema, type PrimaryPhraseDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useCreatePrimaryPhrase, useMyPrimaryClassrooms, usePrimaryPhrases, usePrimaryScales, useUpdatePrimaryPhrase } from "@/platform/v2/primary";
import { PrimaryError, RuleBanner, useCodeLabels } from "./shared";

/**
 * Banque d'appréciations. Une phrase PROPOSE du texte : elle est copiée dans un champ que l'instituteur relit et valide, jamais
 * appliquée seule. L'écriture de l'appréciation générale se fait dans le module Résultats (`results.appreciations`).
 */
export function AppreciationsScreen() {
  const t = useTranslations("v2PrimaryAppreciations");
  const label = useCodeLabels();
  const canManage = usePermission("primary.phrase.manage").allowed;
  const [scope, setScope] = useState("");
  const [ratingLevelCode, setRatingLevelCode] = useState("");
  const [gradeLevelCode, setGradeLevelCode] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const phrases = usePrimaryPhrases({ scope, ratingLevelCode, gradeLevelCode, includeInactive: canManage && includeInactive });
  const scales = usePrimaryScales();
  const classes = useMyPrimaryClassrooms();
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [creating, setCreating] = useState(false);
  const flash = useFlash();
  const update = useUpdatePrimaryPhrase();

  const levelCodes = useMemo(() => [...new Set((scales.data ?? []).flatMap((s) => s.levels.map((l) => l.code)))], [scales.data]);
  const gradeCodes = useMemo(() => [...new Set((classes.data ?? []).map((c) => c.gradeLevelCode).filter((c): c is string => Boolean(c)))], [classes.data]);

  function insert(phrase: PrimaryPhraseDto) {
    // La phrase est AJOUTÉE au champ : l'instituteur la relit, la modifie et la valide (case « relu ») avant de la copier.
    setDraft((d) => (d.trim() === "" ? phrase.body : `${d.trimEnd()} ${phrase.body}`));
    setReviewed(false);
    flash.show(null);
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      flash.show(t("draft.copied"));
    } catch {
      flash.show(t("draft.copyFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage ? (
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create.open")}
            </button>
          ) : undefined
        }
      />
      <RuleBanner />
      {flash.node}

      <section aria-label={t("draft.label")} className="space-y-3 rounded-lg border p-3">
        <h2 className="text-base font-semibold">{t("draft.title")}</h2>
        <FormField label={t("draft.field")} hint={t("draft.hint")}>
          {(c) => (
            <TextAreaControl
              {...c}
              value={draft}
              onChange={(v) => {
                setDraft(v);
                setReviewed(false);
              }}
              rows={4}
              maxLength={1000}
            />
          )}
        </FormField>
        <CheckControl checked={reviewed} onChange={setReviewed} label={t("draft.reviewed")} disabled={draft.trim() === ""} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.primary} disabled={!reviewed || draft.trim() === ""} onClick={() => void copyDraft()}>
            {t("draft.copy")}
          </button>
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={draft === ""}
            onClick={() => {
              setDraft("");
              setReviewed(false);
            }}
          >
            {t("draft.clear")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("draft.notice")}</p>
      </section>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("filters.legend")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("filters.scope")}>
            {(c) => <NativeSelect {...c} value={scope} onChange={setScope} placeholder={t("filters.all")} options={PRIMARY_PHRASE_SCOPES.map((s) => ({ value: s, label: label("phraseScope", s) }))} />}
          </FormField>
          <FormField label={t("filters.level")}>
            {(c) => <NativeSelect {...c} value={ratingLevelCode} onChange={setRatingLevelCode} placeholder={t("filters.all")} options={levelCodes.map((code) => ({ value: code, label: code }))} />}
          </FormField>
          <FormField label={t("filters.grade")}>
            {(c) => <NativeSelect {...c} value={gradeLevelCode} onChange={setGradeLevelCode} placeholder={t("filters.all")} options={gradeCodes.map((code) => ({ value: code, label: code }))} />}
          </FormField>
        </div>
        {canManage ? <CheckControl checked={includeInactive} onChange={setIncludeInactive} label={t("filters.inactive")} /> : null}
      </fieldset>

      <QueryBoundary query={phrases} isEmpty={(phrases.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-3" aria-label={t("list")}>
          {(phrases.data ?? []).map((p) => (
            <li key={p.id} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm">{p.body}</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={label("phraseScope", p.scope)} tone="neutral" />
                {p.ratingLevelCode ? <StatusBadge label={t("levelBadge", { code: p.ratingLevelCode })} tone="neutral" /> : null}
                {p.gradeLevelCode ? <StatusBadge label={t("gradeBadge", { code: p.gradeLevelCode })} tone="neutral" /> : null}
                {p.sourceKind === "placeholder" ? <StatusBadge label={t("placeholder")} tone="warning" /> : null}
                {!p.active ? <StatusBadge label={t("inactive")} tone="danger" /> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.secondary} disabled={!p.active} onClick={() => insert(p)} aria-label={t("insert", { code: p.code })}>
                  {t("insertShort")}
                </button>
                {canManage ? (
                  <button type="button" className={buttonClass.ghost} disabled={update.isPending} onClick={() => update.mutate({ id: p.id, active: !p.active })}>
                    {p.active ? t("deactivate") : t("activate")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {update.isError ? <PrimaryError error={update.error} /> : null}
      {!canManage ? <Notice kind="info">{t("readOnly")}</Notice> : null}
      {creating ? <CreatePhraseDialog levelCodes={levelCodes} gradeCodes={gradeCodes} onClose={() => setCreating(false)} onCreated={() => flash.show(t("create.done"))} /> : null}
    </div>
  );
}

function CreatePhraseDialog({ levelCodes, gradeCodes, onClose, onCreated }: { levelCodes: string[]; gradeCodes: string[]; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("v2PrimaryAppreciations.create");
  const label = useCodeLabels();
  const create = useCreatePrimaryPhrase();
  const [form, setForm] = useState({ code: "", scope: "PERIOD", body: "", ratingLevelCode: "", gradeLevelCode: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    const v = validateWith(primaryCreatePhraseBodySchema, {
      code: form.code.trim().toUpperCase(),
      scope: form.scope,
      body: form.body,
      ...(form.ratingLevelCode ? { ratingLevelCode: form.ratingLevelCode } : {}),
      ...(form.gradeLevelCode ? { gradeLevelCode: form.gradeLevelCode } : {}),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await create.mutateAsync(v.data);
      onCreated();
      onClose();
    } catch {
      /* affichée par FormDialog */
    }
  }
  const apiErrors = apiErrorToFieldErrors(create.error);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error}>
      <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? apiErrors.code}>
        {(c) => <TextControl {...c} value={form.code} onChange={(v) => set({ code: v })} maxLength={60} />}
      </FormField>
      <FormField label={t("scope")} required error={errors.scope}>
        {(c) => <NativeSelect {...c} value={form.scope} onChange={(v) => set({ scope: v })} options={PRIMARY_PHRASE_SCOPES.map((s) => ({ value: s, label: label("phraseScope", s) }))} />}
      </FormField>
      <FormField label={t("body")} required hint={t("bodyHint")} error={errors.body}>
        {(c) => <TextAreaControl {...c} value={form.body} onChange={(v) => set({ body: v })} maxLength={300} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("level")}>
          {(c) => <NativeSelect {...c} value={form.ratingLevelCode} onChange={(v) => set({ ratingLevelCode: v })} placeholder={t("any")} options={levelCodes.map((code) => ({ value: code, label: code }))} />}
        </FormField>
        <FormField label={t("grade")}>
          {(c) => <NativeSelect {...c} value={form.gradeLevelCode} onChange={(v) => set({ gradeLevelCode: v })} placeholder={t("any")} options={gradeCodes.map((code) => ({ value: code, label: code }))} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
