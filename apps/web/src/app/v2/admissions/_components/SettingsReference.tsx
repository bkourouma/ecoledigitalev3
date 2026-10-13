"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ADMISSION_CONSENT_KINDS,
  ADMISSION_DECISION_KINDS,
  ADMISSION_ACCEPTED_MIME,
  ADMISSION_FUNDING_TYPES,
  admissionsPublishConsentTextBodySchema,
  admissionsUpsertDecisionReasonBodySchema,
  admissionsUpsertDocumentRequirementBodySchema,
  admissionsUpsertPriorityClassBodySchema,
} from "@ecoledigitale/contracts/v2/admissions";
import { useConsentTexts, useDecisionReasons, usePriorityClasses, usePublishConsentText, useRequirements, useRetireConsentText, useUpsertDecisionReason, useUpsertPriorityClass, useUpsertRequirement, useAdmissionsLookups } from "@/platform/v2/admissions";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { parseInteger } from "./admissions-utils";

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="max-w-3xl space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Données de référence de l'établissement : textes de consentement versionnés, pièces à fournir, motifs de décision, classes de priorité. */
export function SettingsReference({ institutionId, consentTextVersion }: { institutionId: string; consentTextVersion: string | null }) {
  return (
    <>
      <ConsentTexts institutionId={institutionId} designated={consentTextVersion} />
      <Requirements institutionId={institutionId} />
      <Reasons institutionId={institutionId} />
      <PriorityClasses institutionId={institutionId} />
    </>
  );
}

function ConsentTexts({ institutionId, designated }: { institutionId: string; designated: string | null }) {
  const t = useTranslations("v2Admissions.consentTexts");
  const tk = useTranslations("v2Admissions.consentKind");
  const fmt = useDateFormat();
  const describe = useDescribeError();
  const list = useConsentTexts(institutionId);
  const publish = usePublishConsentText();
  const retire = useRetireConsentText();
  const flash = useFlash();
  const [kind, setKind] = useState("DATA_PROCESSING");
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [designate, setDesignate] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(publish.error), ...errors };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateWith(admissionsPublishConsentTextBodySchema, { institutionId, kind, version: version.trim(), language: "fr", body });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    publish.mutate(
      { ...checked.data, designate: designate && kind === "DATA_PROCESSING" },
      {
        onSuccess: () => {
          flash.show(t("published"));
          setVersion("");
          setBody("");
        },
      },
    );
  }

  return (
    <Block id="consent-texts" title={t("title")} hint={t("description")}>
      {flash.node}
      {!designated ? <Notice kind="warning">{t("noneDesignated")}</Notice> : null}
      {retire.error ? <Notice kind="error">{describe(retire.error)}</Notice> : null}
      <ul className="divide-y text-sm">
        {(list.data?.items ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {tk(c.kind)} · v{c.version} · {fmt.instant(c.publishedAt)}
            </span>
            <span className="flex items-center gap-2">
              {c.kind === "DATA_PROCESSING" && c.version === designated ? <StatusBadge label={t("designated")} tone="success" /> : null}
              {c.retiredAt ? (
                <StatusBadge label={t("retired")} tone="neutral" />
              ) : (
                <button type="button" className={buttonClass.ghost} disabled={retire.isPending} onClick={() => retire.mutate({ institutionId, kind: c.kind, version: c.version })} aria-label={t("retireAria", { version: c.version })}>
                  {t("retire")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={submit} aria-label={t("newTitle")} className="space-y-3 border-t pt-3">
        <h3 className="text-sm font-semibold">{t("newTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("kind")} error={shown["kind"]}>
            {(c) => <NativeSelect {...c} value={kind} onChange={setKind} options={ADMISSION_CONSENT_KINDS.map((k) => ({ value: k, label: tk(k) }))} />}
          </FormField>
          <FormField label={t("version")} required error={shown["version"]}>
            {(c) => <TextControl {...c} value={version} onChange={setVersion} maxLength={20} />}
          </FormField>
        </div>
        <FormField label={t("body")} hint={t("bodyHint")} required error={shown["body"]}>
          {(c) => <TextAreaControl {...c} rows={6} value={body} onChange={setBody} maxLength={20000} />}
        </FormField>
        {kind === "DATA_PROCESSING" ? <CheckControl checked={designate} onChange={setDesignate} label={t("designate")} hint={t("designateHint")} /> : null}
        {publish.error && Object.keys(apiErrorToFieldErrors(publish.error)).length === 0 ? <Notice kind="error">{describe(publish.error)}</Notice> : null}
        <button type="submit" className={buttonClass.primary} disabled={publish.isPending}>
          {t("publish")}
        </button>
      </form>
    </Block>
  );
}

function Requirements({ institutionId }: { institutionId: string }) {
  const t = useTranslations("v2Admissions.requirements");
  const tf = useTranslations("v2Admissions.funding");
  const describe = useDescribeError();
  const list = useRequirements(institutionId);
  const lookups = useAdmissionsLookups(institutionId);
  const upsert = useUpsertRequirement();
  const flash = useFlash();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [grade, setGrade] = useState("");
  const [funding, setFunding] = useState("");
  const [required, setRequired] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(upsert.error), ...errors };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateWith(admissionsUpsertDocumentRequirementBodySchema, {
      institutionId,
      code: code.trim().toUpperCase(),
      label,
      ...(grade ? { gradeLevelCode: grade } : {}),
      ...(funding ? { appliesToFunding: funding } : {}),
      required,
      acceptsMime: [...ADMISSION_ACCEPTED_MIME],
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    upsert.mutate(checked.data, {
      onSuccess: () => {
        flash.show(t("saved"));
        setCode("");
        setLabel("");
      },
    });
  }

  return (
    <Block id="requirements" title={t("title")} hint={t("description")}>
      {flash.node}
      <ul className="divide-y text-sm">
        {(list.data?.items ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {r.label} <span className="text-xs text-muted-foreground">({r.code}{r.gradeLevelCode ? ` · ${r.gradeLevelCode}` : ""}{r.appliesToFunding ? ` · ${tf(r.appliesToFunding)}` : ""})</span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge label={r.required ? t("required") : t("optional")} tone={r.required ? "info" : "neutral"} />
              {!r.active ? <StatusBadge label={t("inactive")} tone="neutral" /> : null}
              <button type="button" className={buttonClass.ghost} disabled={upsert.isPending} onClick={() => upsert.mutate({ institutionId, code: r.code, label: r.label, gradeLevelCode: r.gradeLevelCode, appliesToFunding: r.appliesToFunding, required: r.required, active: !r.active })} aria-label={r.active ? t("deactivateAria", { label: r.label }) : t("activateAria", { label: r.label })}>
                {r.active ? t("deactivate") : t("activate")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={submit} aria-label={t("newTitle")} className="space-y-3 border-t pt-3">
        <h3 className="text-sm font-semibold">{t("newTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("code")} required error={shown["code"]}>
            {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
          </FormField>
          <FormField label={t("label")} required error={shown["label"]}>
            {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}
          </FormField>
          <FormField label={t("grade")} error={shown["gradeLevelCode"]}>
            {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("allGrades")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
          </FormField>
          <FormField label={t("funding")} error={shown["appliesToFunding"]}>
            {(c) => <NativeSelect {...c} value={funding} onChange={setFunding} placeholder={t("allFundings")} options={ADMISSION_FUNDING_TYPES.map((f) => ({ value: f, label: tf(f) }))} />}
          </FormField>
        </div>
        <CheckControl checked={required} onChange={setRequired} label={t("requiredLabel")} />
        {upsert.error && Object.keys(apiErrorToFieldErrors(upsert.error)).length === 0 ? <Notice kind="error">{describe(upsert.error)}</Notice> : null}
        <button type="submit" className={buttonClass.primary} disabled={upsert.isPending}>
          {t("add")}
        </button>
      </form>
    </Block>
  );
}

function Reasons({ institutionId }: { institutionId: string }) {
  const t = useTranslations("v2Admissions.reasons");
  const tk = useTranslations("v2Admissions.decisionKind");
  const describe = useDescribeError();
  const list = useDecisionReasons(institutionId);
  const upsert = useUpsertDecisionReason();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("REJECT");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(upsert.error), ...errors };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateWith(admissionsUpsertDecisionReasonBodySchema, { institutionId, code: code.trim().toUpperCase(), kind, label });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    upsert.mutate(checked.data, { onSuccess: () => { setCode(""); setLabel(""); } });
  }

  return (
    <Block id="reasons" title={t("title")} hint={t("description")}>
      <ul className="divide-y text-sm">
        {(list.data?.items ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {r.label} <span className="text-xs text-muted-foreground">({r.code} · {tk(r.kind)})</span>
            </span>
            <button type="button" className={buttonClass.ghost} disabled={upsert.isPending} onClick={() => upsert.mutate({ institutionId, code: r.code, kind: r.kind, label: r.label, active: !r.active })} aria-label={r.active ? t("deactivateAria", { label: r.label }) : t("activateAria", { label: r.label })}>
              {r.active ? t("deactivate") : t("activate")}
            </button>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={submit} aria-label={t("newTitle")} className="space-y-3 border-t pt-3">
        <h3 className="text-sm font-semibold">{t("newTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("kind")} error={shown["kind"]}>
            {(c) => <NativeSelect {...c} value={kind} onChange={setKind} options={ADMISSION_DECISION_KINDS.map((k) => ({ value: k, label: tk(k) }))} />}
          </FormField>
          <FormField label={t("code")} required error={shown["code"]}>
            {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
          </FormField>
          <FormField label={t("label")} required error={shown["label"]}>
            {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}
          </FormField>
        </div>
        {upsert.error && Object.keys(apiErrorToFieldErrors(upsert.error)).length === 0 ? <Notice kind="error">{describe(upsert.error)}</Notice> : null}
        <button type="submit" className={buttonClass.primary} disabled={upsert.isPending}>
          {t("add")}
        </button>
      </form>
    </Block>
  );
}

function PriorityClasses({ institutionId }: { institutionId: string }) {
  const t = useTranslations("v2Admissions.priority");
  const describe = useDescribeError();
  const list = usePriorityClasses(institutionId);
  const upsert = useUpsertPriorityClass();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [rank, setRank] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(upsert.error), ...errors };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateWith(admissionsUpsertPriorityClassBodySchema, { institutionId, code: code.trim().toUpperCase(), label, rank: parseInteger(rank, 1, 1000) ?? 0 });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    upsert.mutate(checked.data, { onSuccess: () => { setCode(""); setLabel(""); setRank(""); } });
  }

  return (
    <Block id="priority" title={t("title")} hint={t("description")}>
      <ol className="divide-y text-sm">
        {[...(list.data?.items ?? [])].sort((a, b) => a.rank - b.rank).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {p.rank}. {p.label} <span className="text-xs text-muted-foreground">({p.code})</span>
            </span>
            <button type="button" className={buttonClass.ghost} disabled={upsert.isPending} onClick={() => upsert.mutate({ institutionId, code: p.code, label: p.label, rank: p.rank, active: !p.active })} aria-label={p.active ? t("deactivateAria", { label: p.label }) : t("activateAria", { label: p.label })}>
              {p.active ? t("deactivate") : t("activate")}
            </button>
          </li>
        ))}
      </ol>
      <form noValidate onSubmit={submit} aria-label={t("newTitle")} className="space-y-3 border-t pt-3">
        <h3 className="text-sm font-semibold">{t("newTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("code")} required error={shown["code"]}>
            {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
          </FormField>
          <FormField label={t("label")} required error={shown["label"]}>
            {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={120} />}
          </FormField>
          <FormField label={t("rank")} hint={t("rankHint")} required error={shown["rank"]}>
            {(c) => <TextControl {...c} inputMode="numeric" value={rank} onChange={setRank} />}
          </FormField>
        </div>
        {upsert.error && Object.keys(apiErrorToFieldErrors(upsert.error)).length === 0 ? <Notice kind="error">{describe(upsert.error)}</Notice> : null}
        <button type="submit" className={buttonClass.primary} disabled={upsert.isPending}>
          {t("add")}
        </button>
      </form>
    </Block>
  );
}
