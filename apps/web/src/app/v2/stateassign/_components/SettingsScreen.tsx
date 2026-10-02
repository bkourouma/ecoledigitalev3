"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CONTROL_KINDS, EXPORT_DATASETS, type ControlKind, type ExportDataset, type ExportFormatDto, type StateassignSettingsDto } from "@ecoledigitale/contracts/v2/stateassign";
import { useInstitutions } from "@/platform/v2/lookups";
import { useCreateExportFormat, useExportCatalog, useExportFormats, useStateassignSettings, useUpdateExportFormat, useUpdateStateassignSettings } from "@/platform/v2/stateassign";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";

function SettingsForm({ settings }: { settings: StateassignSettingsDto }) {
  const t = useTranslations("v2Stateassign.settingsScreen.form");
  const tKind = useTranslations("v2Stateassign.controlKind");
  const money = useMoney();
  const mutation = useUpdateStateassignSettings(settings.institutionId);
  const flash = useFlash();
  const [separate, setSeparate] = useState(settings.requireSeparateVerifier);
  const [tolerance, setTolerance] = useState(String(settings.reconciliationTolerance));
  const [kinds, setKinds] = useState<ControlKind[]>([...settings.requiredControlKinds]);
  const [offset, setOffset] = useState(settings.controlDueOffsetDays === null ? "" : String(settings.controlDueOffsetDays));
  const [grace, setGrace] = useState(String(settings.receivableGraceDays));
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  useEffect(() => {
    setSeparate(settings.requireSeparateVerifier);
    setTolerance(String(settings.reconciliationTolerance));
    setKinds([...settings.requiredControlKinds]);
    setOffset(settings.controlDueOffsetDays === null ? "" : String(settings.controlDueOffsetDays));
    setGrace(String(settings.receivableGraceDays));
  }, [settings]);

  const tol = parseAmountInput(tolerance, { allowZero: true });
  const int = (s: string, max: number): number | null => (/^\d+$/.test(s.trim()) && Number(s) <= max ? Number(s) : null);
  const offsetValue = offset.trim() === "" ? null : int(offset, 366);
  const graceValue = int(grace, 366);
  const problems = {
    tolerance: tol.ok ? null : t("errors.tolerance"),
    offset: offset.trim() !== "" && offsetValue === null ? t("errors.days") : null,
    grace: graceValue === null ? t("errors.days") : null,
    offsetNeeded: kinds.length > 0 && offset.trim() === "" ? t("errors.offsetNeeded") : null,
  };

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(problems).some(Boolean) || !tol.ok || graceValue === null) return;
    mutation.mutate({ requireSeparateVerifier: separate, reconciliationTolerance: tol.amount, requiredControlKinds: kinds, controlDueOffsetDays: offsetValue, receivableGraceDays: graceValue }, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border p-4" aria-labelledby="settings-form-title">
      <h2 id="settings-form-title" className="text-base font-semibold">{t("title")}</h2>
      {settings.isDefault ? <Notice kind="info">{t("defaults")}</Notice> : null}
      {flash.node}
      <CheckControl checked={separate} onChange={setSeparate} label={t("separate")} hint={t("separateHint")} />
      <FormField label={t("tolerance")} hint={t("toleranceHint", { current: money.fmt(settings.reconciliationTolerance) })} error={submitted ? problems.tolerance : (errors.reconciliationTolerance ?? null)}>
        {(c) => <TextControl {...c} inputMode="numeric" value={tolerance} onChange={setTolerance} />}
      </FormField>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("kinds")}</legend>
        <p className="text-xs text-muted-foreground">{t("kindsHint")}</p>
        {CONTROL_KINDS.map((k) => (
          <CheckControl key={k} checked={kinds.includes(k)} onChange={(on) => setKinds((cur) => (on ? [...cur, k] : cur.filter((x) => x !== k)))} label={tKind(k)} />
        ))}
      </fieldset>
      <FormField label={t("offset")} hint={t("offsetHint")} error={submitted ? (problems.offset ?? problems.offsetNeeded) : (errors.controlDueOffsetDays ?? null)}>
        {(c) => <TextControl {...c} inputMode="numeric" value={offset} onChange={setOffset} />}
      </FormField>
      <FormField label={t("grace")} hint={t("graceHint")} error={submitted ? problems.grace : (errors.receivableGraceDays ?? null)}>
        {(c) => <TextControl {...c} inputMode="numeric" value={grace} onChange={setGrace} />}
      </FormField>
      {mutation.isError && Object.keys(errors).length === 0 ? <ErrorBlock error={mutation.error} /> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>{mutation.isPending ? t("saving") : t("save")}</button>
      </div>
    </form>
  );
}

function FormatDialog({ institutionId, open, onOpenChange }: { institutionId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Stateassign.settingsScreen.formats.form");
  const tDataset = useTranslations("v2Stateassign.dataset");
  const catalog = useExportCatalog();
  const mutation = useCreateExportFormat();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [dataset, setDataset] = useState<ExportDataset>("ASSIGNMENTS");
  const [delimiter, setDelimiter] = useState<";" | "," | "\t">(";");
  const [includeBom, setIncludeBom] = useState(true);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const columns = useMemo(() => catalog.data?.datasets.find((d) => d.dataset === dataset)?.columns ?? [], [catalog.data, dataset]);
  const chosen = columns.filter((c) => selected[c.key] !== undefined);
  const problems = { code: /^[a-z][a-z0-9_-]{1,39}$/.test(code) ? null : t("errors.code"), label: label.trim() ? null : t("errors.label"), columns: chosen.length > 0 ? null : t("errors.columns") };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      wide
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(problems).some(Boolean)) return;
        mutation.mutate({ institutionId, code, label: label.trim(), dataset, delimiter, includeBom, columns: chosen.map((c) => ({ key: c.key, header: (selected[c.key] ?? "").trim() || c.label })) }, { onSuccess: () => onOpenChange(false) });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("code")} required hint={t("codeHint")} error={submitted ? problems.code : (errors.code ?? null)}>{(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}</FormField>
        <FormField label={t("label")} required error={submitted ? problems.label : (errors.label ?? null)}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={120} />}</FormField>
        <FormField label={t("dataset")}>{(c) => <NativeSelect {...c} value={dataset} onChange={(v) => { setDataset(EXPORT_DATASETS.find((d) => d === v) ?? "ASSIGNMENTS"); setSelected({}); }} options={EXPORT_DATASETS.map((d) => ({ value: d, label: tDataset(d) }))} />}</FormField>
        <FormField label={t("delimiter")}>{(c) => <NativeSelect {...c} value={delimiter} onChange={(v) => setDelimiter(v === "," ? "," : v === "\t" ? "\t" : ";")} options={[{ value: ";", label: t("delimiters.semicolon") }, { value: ",", label: t("delimiters.comma") }, { value: "\t", label: t("delimiters.tab") }]} />}</FormField>
      </div>
      <CheckControl checked={includeBom} onChange={setIncludeBom} label={t("bom")} hint={t("bomHint")} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("columns")}</legend>
        <p className="text-xs text-muted-foreground">{t("columnsHint")}</p>
        {submitted && problems.columns ? <p role="alert" className="text-xs font-medium text-destructive">{problems.columns}</p> : null}
        <ul className="space-y-2">
          {columns.map((col) => (
            <li key={col.key} className="grid items-center gap-2 sm:grid-cols-2">
              <CheckControl checked={selected[col.key] !== undefined} onChange={(on) => setSelected((cur) => { const next = { ...cur }; if (on) next[col.key] = col.label; else delete next[col.key]; return next; })} label={col.label} />
              {selected[col.key] !== undefined ? (
                <TextControl value={selected[col.key] ?? ""} onChange={(v) => setSelected((cur) => ({ ...cur, [col.key]: v }))} aria-describedby={undefined} maxLength={100} placeholder={t("headerPlaceholder")} />
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>
    </FormDialog>
  );
}

function Formats({ institutionId }: { institutionId: string }) {
  const t = useTranslations("v2Stateassign.settingsScreen.formats");
  const tDataset = useTranslations("v2Stateassign.dataset");
  const formats = useExportFormats({ institutionId });
  const toggle = useUpdateExportFormat();
  const [creating, setCreating] = useState(false);
  return (
    <section aria-labelledby="formats-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="formats-title" className="text-base font-semibold">{t("title")}</h2>
        <button type="button" onClick={() => setCreating(true)} className={buttonClass.secondary}>{t("create")}</button>
      </div>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      <QueryBoundary query={formats} isEmpty={(formats.data?.length ?? 0) === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="divide-y rounded-md border" aria-label={t("list")}>
          {(formats.data ?? []).map((f: ExportFormatDto) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{f.label} <span className="text-xs text-muted-foreground">({f.code})</span></p>
                <p className="text-xs text-muted-foreground">{tDataset(f.dataset)} · {t("columnsCount", { count: f.columns.length })}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={f.active ? t("active") : t("inactive")} tone={f.active ? "success" : "neutral"} />
                <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: f.id, active: !f.active })} className={buttonClass.ghost}>
                  {f.active ? t("deactivate") : t("activate")}
                  <span className="sr-only"> — {f.label}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {toggle.isError ? <ErrorBlock error={toggle.error} /> : null}
      {creating ? <FormatDialog institutionId={institutionId} open onOpenChange={(o) => !o && setCreating(false)} /> : null}
    </section>
  );
}

/** Réglages d'établissement : valeurs prudentes par défaut (aucune règle officielle livrée) ; formats d'export en données. */
export function SettingsScreen() {
  const t = useTranslations("v2Stateassign.settingsScreen");
  const institutions = useInstitutions();
  const items = useMemo(() => institutions.data ?? [], [institutions.data]);
  const [institutionId, setInstitutionId] = useState("");
  useEffect(() => {
    if (!institutionId && items.length >= 1) setInstitutionId(items[0]!.id);
  }, [items, institutionId]);
  const settings = useStateassignSettings(institutionId || null);
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("noOfficialRules")}</Notice>
      {institutions.isPending ? <LoadingBlock /> : null}
      {institutions.isError ? <ErrorBlock error={institutions.error} onRetry={() => void institutions.refetch()} /> : null}
      {items.length > 1 ? (
        <FormField label={t("institution")} className="max-w-sm">
          {(c) => <NativeSelect {...c} value={institutionId} onChange={setInstitutionId} options={items.map((i) => ({ value: i.id, label: i.name }))} />}
        </FormField>
      ) : null}
      {institutionId ? (
        <>
          <QueryBoundary query={settings}>{settings.data ? <SettingsForm settings={settings.data} /> : null}</QueryBoundary>
          <Formats institutionId={institutionId} />
        </>
      ) : null}
    </div>
  );
}
