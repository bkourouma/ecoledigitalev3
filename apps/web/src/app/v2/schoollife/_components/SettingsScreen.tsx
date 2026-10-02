"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  schoollifeEventTypeInputSchema,
  schoollifeScaleCreateSchema,
  schoollifeSeverityInputSchema,
  type SchoolLifeEventTypeDto,
  type SchoolLifeScaleDto,
  type SchoolLifeSeverityDto,
  type SchoolLifeSettingsDto,
} from "@ecoledigitale/contracts/v2/schoollife";
import {
  useConductScales,
  useCreateScale,
  useSchoolLifeReference,
  useScaleAction,
  useSetScaleItems,
  useUpsertEventType,
  useUpsertSettings,
  useUpsertSeverity,
} from "@/platform/v2/schoollife";
import { useInstitutions } from "@/platform/v2/lookups";
import { Can, Feature } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { KindLabel, StatusLabel } from "./shared";

const KINDS = ["INCIDENT", "SANCTION", "WARNING", "ENCOURAGEMENT", "TEMP_EXCLUSION", "OBSERVATION"] as const;

/**
 * Paramètres de la vie scolaire : réglages d'établissement, niveaux de gravité, types d'événements (qui portent le circuit :
 * validation, quatre yeux, recours, partage, confidentialité) et barèmes de points de conduite. TOUT est donnée
 * d'établissement : aucune valeur n'est livrée (listes vides au départ) ; les règles de cohérence sont celles du contrat et de la base.
 */
export function SettingsScreen() {
  const t = useTranslations("v2Schoollife.settings");
  const flash = useFlash();
  const ref = useSchoolLifeReference();
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <Notice kind="info">{t("noDefaults")}</Notice>
      <QueryBoundary query={ref}>
        <InstitutionSettings settings={ref.data?.settings ?? []} onSaved={() => flash.show(t("saved"))} />
        <Severities severities={ref.data?.severityLevels ?? []} onSaved={() => flash.show(t("saved"))} />
        <EventTypes types={ref.data?.eventTypes ?? []} severities={ref.data?.severityLevels ?? []} onSaved={() => flash.show(t("saved"))} />
        <Can permission="schoollife.conduct.manage">
          <Feature feature="schoollife.conduct-points">
            <Scales types={ref.data?.eventTypes ?? []} onSaved={() => flash.show(t("saved"))} />
          </Feature>
        </Can>
      </QueryBoundary>
    </div>
  );
}

function Section({ id, title, hint, action, children }: { id: string; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Réglages par établissement
// ---------------------------------------------------------------------------

function InstitutionSettings({ settings, onSaved }: { settings: readonly SchoolLifeSettingsDto[]; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.institution");
  const institutions = useInstitutions();
  return (
    <Section id="sl-set-inst" title={t("title")} hint={t("hint")}>
      <QueryBoundary query={institutions} isEmpty={(institutions.data ?? []).length === 0} empty={<EmptyBlock title={t("none")} />}>
        <ul className="space-y-3">
          {(institutions.data ?? []).map((i) => (
            <li key={i.id} className="rounded-lg border p-4">
              <InstitutionCard institutionId={i.id} name={i.name} current={settings.find((s) => s.institutionId === i.id) ?? null} onSaved={onSaved} />
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </Section>
  );
}

function InstitutionCard({ institutionId, name, current, onSaved }: { institutionId: string; name: string; current: SchoolLifeSettingsDto | null; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.institution");
  const save = useUpsertSettings();
  const [conduct, setConduct] = useState(current?.conductPointsEnabled ?? false);
  const [purpose, setPurpose] = useState(current?.confidentialReadRequiresPurpose ?? true);
  const [retention, setRetention] = useState(current?.retentionDays?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const days = retention.trim() === "" ? null : Number(retention);
        if (days !== null && (!Number.isInteger(days) || days < 1)) return setError(t("retentionInvalid"));
        setError(null);
        save.mutate({ institutionId, conductPointsEnabled: conduct, confidentialReadRequiresPurpose: purpose, retentionDays: days }, { onSuccess: onSaved });
      }}
    >
      <h3 className="font-medium">{name}</h3>
      <CheckControl checked={conduct} onChange={setConduct} label={t("conduct")} hint={t("conductHint")} />
      <CheckControl checked={purpose} onChange={setPurpose} label={t("purpose")} hint={t("purposeHint")} />
      <FormField label={t("retention")} hint={t("retentionHint")} error={error}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" value={retention} onChange={setRetention} min={1} className="max-w-xs" />}
      </FormField>
      <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
        {t("save")}
      </button>
      {save.error ? <Notice kind="error">{apiErrorToFieldErrors(save.error).institutionId ?? (save.error as Error).message}</Notice> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Niveaux de gravité
// ---------------------------------------------------------------------------

function Severities({ severities, onSaved }: { severities: readonly SchoolLifeSeverityDto[]; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.severity");
  const [editing, setEditing] = useState<SchoolLifeSeverityDto | "new" | null>(null);
  return (
    <Section
      id="sl-set-sev"
      title={t("title")}
      hint={t("hint")}
      action={
        <button type="button" className={buttonClass.secondary} onClick={() => setEditing("new")}>
          {t("add")}
        </button>
      }
    >
      {severities.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {severities.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="w-10 text-center font-semibold tabular-nums">{s.rank}</span>
              <span className="min-w-0 flex-1">
                {s.label} <span className="text-xs text-muted-foreground">({s.code})</span>
              </span>
              {s.active ? null : <StatusBadge label={t("inactive")} tone="neutral" />}
              <button type="button" className={buttonClass.ghost} onClick={() => setEditing(s)}>
                {t("edit")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <SeverityDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={onSaved} /> : null}
    </Section>
  );
}

function SeverityDialog({ initial, onClose, onSaved }: { initial: SchoolLifeSeverityDto | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.severity.dialog");
  const save = useUpsertSeverity();
  const [code, setCode] = useState(initial?.code ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [rank, setRank] = useState(initial?.rank.toString() ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? t("editTitle") : t("addTitle")}
      submitLabel={t("save")}
      isPending={save.isPending}
      error={save.error && Object.keys(apiErrorToFieldErrors(save.error)).length === 0 ? save.error : undefined}
      onSubmit={() => {
        const v = validateWith(schoollifeSeverityInputSchema, { code, label, rank: rank === "" ? undefined : Number(rank), active });
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        save.mutate(v.data, { onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
      }}
    >
      <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? null}>
        {(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} disabled={initial !== null} maxLength={40} />}
      </FormField>
      <FormField label={t("label")} required error={errors.label ?? null}>
        {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={120} />}
      </FormField>
      <FormField label={t("rank")} required hint={t("rankHint")} error={errors.rank ?? null}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" value={rank} onChange={setRank} min={1} />}
      </FormField>
      <CheckControl checked={active} onChange={setActive} label={t("active")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Types d'événements : le type porte le circuit
// ---------------------------------------------------------------------------

function EventTypes({ types, severities, onSaved }: { types: readonly SchoolLifeEventTypeDto[]; severities: readonly SchoolLifeSeverityDto[]; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.types");
  const [editing, setEditing] = useState<SchoolLifeEventTypeDto | "new" | null>(null);
  return (
    <Section
      id="sl-set-types"
      title={t("title")}
      hint={t("hint")}
      action={
        <button type="button" className={buttonClass.secondary} onClick={() => setEditing("new")}>
          {t("add")}
        </button>
      }
    >
      {types.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {types.map((x) => (
            <li key={x.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <KindLabel kind={x.kind} />
                <span className="font-medium">{x.label}</span>
                <span className="text-xs text-muted-foreground">({x.code})</span>
                {x.isPlaceholder ? <StatusBadge label={t("placeholder")} tone="warning" /> : null}
                {x.active ? null : <StatusBadge label={t("inactive")} tone="neutral" />}
                <button type="button" className={`${buttonClass.ghost} ml-auto`} onClick={() => setEditing(x)}>
                  {t("edit")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  x.requiresValidation ? t("flags.validation") : t("flags.direct"),
                  x.requiresFourEyes ? t("flags.fourEyes") : null,
                  x.appealable ? t("flags.appealable") : null,
                  x.notifyGuardians ? t("flags.notify") : null,
                  x.visibleToGuardians ? t("flags.visible") : t("flags.hidden"),
                  x.confidentialityDefault !== "STANDARD" ? t(`flags.confidentiality.${x.confidentialityDefault}`) : null,
                  x.requiresDates ? t("flags.dates") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editing ? <TypeDialog initial={editing === "new" ? null : editing} severities={severities} onClose={() => setEditing(null)} onSaved={onSaved} /> : null}
    </Section>
  );
}

function TypeDialog({ initial, severities, onClose, onSaved }: { initial: SchoolLifeEventTypeDto | null; severities: readonly SchoolLifeSeverityDto[]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.types.dialog");
  const tk = useTranslations("v2Schoollife.kind");
  const tc = useTranslations("v2Schoollife.confidentiality");
  const save = useUpsertEventType();
  const [code, setCode] = useState(initial?.code ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<string>(initial?.kind ?? "INCIDENT");
  const [severity, setSeverity] = useState(initial?.defaultSeverityCode ?? "");
  const [validation, setValidation] = useState(initial?.requiresValidation ?? false);
  const [fourEyes, setFourEyes] = useState(initial?.requiresFourEyes ?? false);
  const [approver, setApprover] = useState(initial?.approverPermission ?? "");
  const [notify, setNotify] = useState(initial?.notifyGuardians ?? false);
  const [visible, setVisible] = useState(initial?.visibleToGuardians ?? true);
  const [confidentiality, setConfidentiality] = useState<string>(initial?.confidentialityDefault ?? "STANDARD");
  const [appealable, setAppealable] = useState(initial?.appealable ?? false);
  const [placeholder, setPlaceholder] = useState(initial?.isPlaceholder ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const isMeasure = kind === "SANCTION" || kind === "TEMP_EXCLUSION" || kind === "WARNING";
  const exclusion = kind === "TEMP_EXCLUSION";
  return (
    <FormDialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={initial ? t("editTitle") : t("addTitle")}
      description={t("description")}
      submitLabel={t("save")}
      isPending={save.isPending}
      error={save.error && Object.keys(apiErrorToFieldErrors(save.error)).length === 0 ? save.error : undefined}
      onSubmit={() => {
        const payload = compact({
          code,
          label,
          kind,
          defaultSeverityCode: severity,
          requiresValidation: isMeasure ? (exclusion ? true : validation) : false,
          requiresFourEyes: isMeasure && (exclusion || validation) ? fourEyes : false,
          approverPermission: isMeasure ? approver : "",
          notifyGuardians: isMeasure ? notify : false,
          visibleToGuardians: visible,
          confidentialityDefault: confidentiality,
          appealable: kind === "SANCTION" || exclusion ? appealable : false,
          isPlaceholder: placeholder,
          active,
        });
        const v = validateWith(schoollifeEventTypeInputSchema, payload);
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        save.mutate(v.data, { onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? null}>
          {(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} disabled={initial !== null} maxLength={40} />}
        </FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>
          {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}
        </FormField>
      </div>
      <FormField label={t("kind")} required hint={t("kindHint")} error={errors.kind ?? null}>
        {(c) => <NativeSelect {...c} value={kind} onChange={setKind} disabled={initial !== null} options={KINDS.map((k) => ({ value: k, label: tk(k) }))} />}
      </FormField>
      {isMeasure ? (
        <>
          <CheckControl checked={exclusion ? true : validation} disabled={exclusion} onChange={setValidation} label={t("validation")} hint={exclusion ? t("exclusionAlways") : t("validationHint")} />
          <CheckControl checked={fourEyes} onChange={setFourEyes} label={t("fourEyes")} hint={t("fourEyesHint")} disabled={!(exclusion || validation)} />
          <FormField label={t("approver")} hint={t("approverHint")} error={errors.approverPermission ?? null}>
            {(c) => <TextControl {...c} value={approver} onChange={setApprover} placeholder="schoollife.measure.validate" />}
          </FormField>
          {kind !== "WARNING" ? <CheckControl checked={appealable} onChange={setAppealable} label={t("appealable")} hint={t("appealableHint")} /> : null}
          <CheckControl checked={notify} onChange={setNotify} label={t("notify")} hint={t("notifyHint")} />
        </>
      ) : null}
      <FormField label={t("severity")} error={errors.defaultSeverityCode ?? null}>
        {(c) => <NativeSelect {...c} value={severity} placeholder={t("noSeverity")} onChange={setSeverity} options={severities.filter((s) => s.active).map((s) => ({ value: s.code, label: s.label }))} />}
      </FormField>
      <FormField label={t("confidentiality")} hint={t("confidentialityHint")} required>
        {(c) => <NativeSelect {...c} value={confidentiality} onChange={setConfidentiality} options={(["STANDARD", "RESTRICTED", "CONFIDENTIAL"] as const).map((l) => ({ value: l, label: tc(l) }))} />}
      </FormField>
      <CheckControl checked={visible} onChange={setVisible} label={t("visible")} hint={t("visibleHint")} />
      <CheckControl checked={placeholder} onChange={setPlaceholder} label={t("placeholder")} hint={t("placeholderHint")} />
      <CheckControl checked={active} onChange={setActive} label={t("active")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Barèmes de points de conduite (paramètres figés une fois actifs)
// ---------------------------------------------------------------------------

function Scales({ types, onSaved }: { types: readonly SchoolLifeEventTypeDto[]; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.scales");
  const scales = useConductScales();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SchoolLifeScaleDto | null>(null);
  const action = useScaleAction("activate");
  const retire = useScaleAction("retire");
  return (
    <Section
      id="sl-set-scales"
      title={t("title")}
      hint={t("hint")}
      action={
        <button type="button" className={buttonClass.secondary} onClick={() => setCreating(true)}>
          {t("add")}
        </button>
      }
    >
      <QueryBoundary query={scales} isEmpty={(scales.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="divide-y rounded-lg border">
          {(scales.data ?? []).map((s) => (
            <li key={s.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusLabel status={s.status} />
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">({s.code})</span>
                {s.isPlaceholder ? <StatusBadge label={t("placeholder")} tone="warning" /> : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("summary", { initial: s.initialPoints, min: s.minPoints ?? "—", max: s.maxPoints ?? "—", reset: t(`reset.${s.resetScope}`), from: s.effectiveFrom })}</p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {s.items.map((i) => (
                  <li key={i.eventTypeId} className="rounded-full border px-2 py-0.5">
                    {i.eventTypeLabel ?? "—"} <span className="font-semibold tabular-nums">{i.pointsDelta > 0 ? `+${i.pointsDelta}` : i.pointsDelta}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {s.status === "DRAFT" ? (
                  <>
                    <button type="button" className={buttonClass.secondary} onClick={() => setEditing(s)}>
                      {t("editItems")}
                    </button>
                    <button type="button" className={buttonClass.primary} disabled={action.isPending || s.items.length === 0} onClick={() => action.mutate({ id: s.id }, { onSuccess: onSaved })}>
                      {t("activate")}
                    </button>
                  </>
                ) : null}
                {s.status === "ACTIVE" ? (
                  <button type="button" className={buttonClass.ghost} disabled={retire.isPending} onClick={() => retire.mutate({ id: s.id }, { onSuccess: onSaved })}>
                    {t("retire")}
                  </button>
                ) : null}
              </div>
              {action.error ? <Notice kind="error">{(action.error as Error).message}</Notice> : null}
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {creating ? <ScaleDialog onClose={() => setCreating(false)} onSaved={onSaved} /> : null}
      {editing ? <ItemsDialog scale={editing} types={types} onClose={() => setEditing(null)} onSaved={onSaved} /> : null}
    </Section>
  );
}

function ScaleDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.scales.dialog");
  const tr = useTranslations("v2Schoollife.settings.scales.reset");
  const ts = useTranslations("v2Schoollife.settings.scales.sourceKind");
  const institutions = useInstitutions();
  const create = useCreateScale();
  const [institutionId, setInstitutionId] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [initial, setInitial] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [reset, setReset] = useState("YEAR");
  const [from, setFrom] = useState("");
  const [source, setSource] = useState("institution");
  const [errors, setErrors] = useState<FieldErrors>({});
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  return (
    <FormDialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("save")}
      isPending={create.isPending}
      error={create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}
      onSubmit={() => {
        const v = validateWith(schoollifeScaleCreateSchema, compact({ institutionId, code, label, initialPoints: num(initial), minPoints: num(min), maxPoints: num(max), resetScope: reset, effectiveFrom: from, sourceKind: source }));
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        create.mutate(v.data, { onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
      }}
    >
      <FormField label={t("institution")} required error={errors.institutionId ?? null}>
        {(c) => <NativeSelect {...c} value={institutionId} placeholder={t("chooseInstitution")} onChange={setInstitutionId} options={(institutions.data ?? []).map((i) => ({ value: i.id, label: i.name }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? null}>
          {(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={40} />}
        </FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>
          {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}
        </FormField>
        <FormField label={t("initial")} required error={errors.initialPoints ?? null}>
          {(c) => <TextControl {...c} type="number" inputMode="numeric" value={initial} onChange={setInitial} />}
        </FormField>
        <FormField label={t("effectiveFrom")} required error={errors.effectiveFrom ?? null}>
          {(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}
        </FormField>
        <FormField label={t("min")} hint={t("boundHint")} error={errors.minPoints ?? null}>
          {(c) => <TextControl {...c} type="number" inputMode="numeric" value={min} onChange={setMin} />}
        </FormField>
        <FormField label={t("max")} hint={t("boundHint")} error={errors.maxPoints ?? null}>
          {(c) => <TextControl {...c} type="number" inputMode="numeric" value={max} onChange={setMax} />}
        </FormField>
        <FormField label={t("reset")} required error={errors.resetScope ?? null}>
          {(c) => <NativeSelect {...c} value={reset} onChange={setReset} options={(["PERIOD", "YEAR", "NEVER"] as const).map((r) => ({ value: r, label: tr(r) }))} />}
        </FormField>
        <FormField label={t("source")} required hint={t("sourceHint")} error={errors.sourceKind ?? null}>
          {(c) => <NativeSelect {...c} value={source} onChange={setSource} options={(["institution", "regulation", "placeholder"] as const).map((r) => ({ value: r, label: ts(r) }))} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

function ItemsDialog({ scale, types, onClose, onSaved }: { scale: SchoolLifeScaleDto; types: readonly SchoolLifeEventTypeDto[]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2Schoollife.settings.scales.items");
  const save = useSetScaleItems();
  // Seuls les mesures et les encouragements ont une valeur en points (ni incident, ni observation : refus de la base).
  const eligible = types.filter((x) => x.active && x.kind !== "INCIDENT" && x.kind !== "OBSERVATION");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(scale.items.map((i) => [i.eventTypeId, String(i.pointsDelta)])));
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { label: scale.label })}
      description={t("description")}
      submitLabel={t("save")}
      isPending={save.isPending}
      error={save.error}
      onSubmit={() => {
        const items: Array<{ eventTypeId: string; pointsDelta: number }> = [];
        for (const [eventTypeId, raw] of Object.entries(values)) {
          if (raw.trim() === "") continue;
          const n = Number(raw);
          if (!Number.isInteger(n) || n === 0) return setError(t("invalid"));
          items.push({ eventTypeId, pointsDelta: n });
        }
        setError(null);
        save.mutate({ id: scale.id, items }, { onSuccess: () => { onSaved(); onClose(); } });
      }}
    >
      {eligible.length === 0 ? <EmptyBlock title={t("noTypes")} /> : null}
      {eligible.map((x) => (
        <FormField key={x.id} label={`${x.label} (${x.code})`} hint={t("hint")}>
          {(c) => <TextControl {...c} type="number" inputMode="numeric" value={values[x.id] ?? ""} onChange={(v) => setValues({ ...values, [x.id]: v })} className="max-w-[10rem]" />}
        </FormField>
      ))}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </FormDialog>
  );
}
