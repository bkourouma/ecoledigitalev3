"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RulesDeriveVariantBodySchema, type RulesRuleSetDto, type RulesVersionSummaryDto } from "@ecoledigitale/contracts/v2/rules";
import { useFeature, usePermission } from "@/platform/access";
import { useDeriveVariant, useRuleSets } from "@/platform/v2/rules";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOfStatus } from "../../assessments/_components/shared";

/** Catalogue des jeux de règles : nationaux (lecture seule) et variantes de l'établissement. */
export function RuleSetsScreen() {
  const t = useTranslations("v2Rules.catalog");
  const sets = useRuleSets();
  const [origin, setOrigin] = useState("");
  const [text, setText] = useState("");
  const [deriving, setDeriving] = useState<{ set: RulesRuleSetDto; version: RulesVersionSummaryDto } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const items = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (sets.data ?? []).filter((s) => (!origin || s.origin === origin) && (!q || `${s.code} ${s.name}`.toLowerCase().includes(q)));
  }, [sets.data, origin, text]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("search")}>{(c) => <TextControl {...c} type="search" value={text} onChange={setText} />}</FormField>
        <FormField label={t("origin")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={origin}
              onChange={setOrigin}
              placeholder={t("allOrigins")}
              options={[
                { value: "national", label: t("origins.national") },
                { value: "tenant", label: t("origins.tenant") },
              ]}
            />
          )}
        </FormField>
      </form>
      {created ? (
        <Notice kind="success" className="mb-4">
          {t("variantCreated")}{" "}
          <Link href={`/v2/rules/versions/${created}`} className="font-medium underline underline-offset-4">
            {t("openVariant")}
          </Link>
        </Notice>
      ) : null}
      <QueryBoundary query={sets} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-4" aria-label={t("listLabel")}>
          {items.map((s) => (
            <li key={s.id}>
              <RuleSetCard set={s} onDerive={(version) => setDeriving({ set: s, version })} />
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {deriving ? <DeriveDialog set={deriving.set} base={deriving.version} onClose={() => setDeriving(null)} onDone={(id) => setCreated(id)} /> : null}
    </div>
  );
}

function RuleSetCard({ set, onDerive }: { set: RulesRuleSetDto; onDerive: (version: RulesVersionSummaryDto) => void }) {
  const t = useTranslations("v2Rules.catalog");
  const tStatus = useTranslations("v2Rules.status");
  const date = useDateFormat();
  const canDerive = usePermission("rules.version.create");
  const variants = useFeature("rules.variants");
  const versions = [...set.versions].sort((a, b) => b.versionNo - a.versionNo);
  return (
    <article className="space-y-3 rounded-md border p-4" aria-label={set.name}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{set.name}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{set.code}</span>
            {set.regulation ? ` · ${set.regulation}` : ""}
            {set.level ? ` · ${set.level}` : ""} · {set.countryCode}
          </p>
        </div>
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={t(`origins.${set.origin}`)} tone={set.origin === "national" ? "info" : "neutral"} />
          {set.origin === "national" ? <StatusBadge label={t("readOnly")} tone="neutral" /> : null}
        </span>
      </header>
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVersion")}</p>
      ) : (
        <div role="region" aria-label={t("versionsOf", { name: set.name })} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("versionsOf", { name: set.name })}</caption>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.version")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.status")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.effective")}</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("columns.contract")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{t("versionNo", { n: v.versionNo })}</th>
                  <td className="px-3 py-2">
                    <StatusBadge label={tStatus(v.status)} tone={toneOfStatus(v.status)} />
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{t("effective", { from: date.civil(v.effectiveFrom), to: v.effectiveTo ? date.civil(v.effectiveTo) : t("openEnded") })}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{v.contractId}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-1">
                      <Link href={`/v2/rules/versions/${v.id}`} className={buttonClass.ghost} aria-label={t("openVersion", { name: set.name, n: v.versionNo })}>
                        {t("open")}
                      </Link>
                      {set.origin === "national" && v.status === "published" && canDerive.allowed && variants.allowed ? (
                        <button type="button" className={buttonClass.secondary} onClick={() => onDerive(v)} aria-label={t("deriveOf", { name: set.name, n: v.versionNo })}>
                          {t("derive")}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function DeriveDialog({ set, base, onClose, onDone }: { set: RulesRuleSetDto; base: RulesVersionSummaryDto; onClose: () => void; onDone: (versionId: string) => void }) {
  const t = useTranslations("v2Rules.catalog");
  const derive = useDeriveVariant();
  const [form, setForm] = useState({ name: "", effectiveFrom: "", effectiveTo: "", notes: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set_ = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const v = validateWith(RulesDeriveVariantBodySchema, { baseVersionId: base.id, ...compact(form) });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await derive.mutateAsync({ code: set.code, baseVersionId: base.id, name: v.data.name, effectiveFrom: v.data.effectiveFrom, effectiveTo: v.data.effectiveTo ?? undefined, notes: v.data.notes });
      onDone(created.id);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("deriveTitle", { name: set.name })} description={t("deriveDescription", { n: base.versionNo })} submitLabel={t("deriveSubmit")} onSubmit={() => void submit()} isPending={derive.isPending} error={Object.keys(errors).length === 0 ? derive.error : null}>
      <FormField label={t("fields.name")} error={errors.name} hint={t("fields.nameHint")}>
        {(c) => <TextControl {...c} value={form.name} onChange={set_("name")} maxLength={200} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.effectiveFrom")} required error={errors.effectiveFrom}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveFrom} onChange={set_("effectiveFrom")} />}
        </FormField>
        <FormField label={t("fields.effectiveTo")} error={errors.effectiveTo}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveTo} onChange={set_("effectiveTo")} />}
        </FormField>
      </div>
      <FormField label={t("fields.notes")} error={errors.notes}>
        {(c) => <TextAreaControl {...c} value={form.notes} onChange={set_("notes")} maxLength={2000} />}
      </FormField>
      <Notice kind="info">{t("copyNotice")}</Notice>
    </FormDialog>
  );
}
