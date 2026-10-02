"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PAYROLL_CONFIG_TYPES, payrollConfigBodySchema, payrollConfigUpdateBodySchema, payrollRateBodySchema } from "@ecoledigitale/contracts/v2/payroll";
import type { z } from "zod";
import type { payrollConfigDtoSchema, payrollRateDtoSchema } from "@ecoledigitale/contracts/v2/payroll";
import { useStaffOptions } from "@/platform/v2/lookups";
import {
  useCreateHourlyRate,
  useCreatePayConfig,
  useCurrentPayConfig,
  useDeleteHourlyRate,
  useHourlyRates,
  usePayConfigs,
  usePayrollSettings,
  useResolveRate,
  useUpdateHourlyRate,
  useUpdatePayConfig,
  useUpdatePayrollSettings,
  type PayConfigInput,
} from "@/platform/v2/payroll";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, parseMultiplierToPermille, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SectionNav } from "@/platform/ui/SectionNav";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { NodePicker, useCurriculumNodes } from "./NodePicker";
import { MoneyField, shortId, useAmountErrors, useStaffLabels, useValidator } from "./shared";

type PayConfig = z.infer<typeof payrollConfigDtoSchema>;
type Rate = z.infer<typeof payrollRateDtoSchema>;

const todayIso = () => new Date().toISOString().slice(0, 10);
const useTeacherOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { canTeach: true });

export function ConfigurationNav() {
  const t = useTranslations("v2Payroll.config.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/payroll/configuration", label: t("configs"), permission: "payroll.config.read", exact: true },
        { href: "/v2/payroll/configuration/rates", label: t("rates"), permission: "payroll.rate.read" },
        { href: "/v2/payroll/configuration/settings", label: t("settings"), permission: "payroll.settings.manage" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Configurations de paie (salaire / horaire / mixte)
// ---------------------------------------------------------------------------

export function ConfigsScreen() {
  const t = useTranslations("v2Payroll.config.configs");
  const tType = useTranslations("v2Payroll.configType");
  const money = useMoney();
  const date = useDateFormat();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [activeOn, setActiveOn] = useState("");
  const list = usePayConfigs({ staffId: staff?.value, activeOn: activeOn || undefined, limit: 100 });
  const labels = useStaffLabels(list.data?.items.map((c) => c.staffId) ?? []);
  const flash = useFlash();
  const [editing, setEditing] = useState<PayConfig | "new" | null>(null);

  const columns: DataTableColumn<PayConfig>[] = [
    { id: "staff", header: t("columns.staff"), rowHeader: true, cell: (c) => labels.get(c.staffId) ?? shortId(c.staffId) },
    { id: "type", header: t("columns.type"), cell: (c) => tType(c.type) },
    { id: "monthly", header: t("columns.monthly"), align: "right", cell: (c) => (c.monthlySalary === null ? "—" : <span className="tabular-nums">{money.fmt(c.monthlySalary)}</span>), className: "hidden sm:table-cell" },
    { id: "annual", header: t("columns.annual"), align: "right", cell: (c) => (c.annualSalary === null ? "—" : <span className="tabular-nums">{money.fmt(c.annualSalary)}</span>), className: "hidden xl:table-cell" },
    { id: "hourly", header: t("columns.hourly"), align: "right", cell: (c) => (c.defaultHourlyRate === null ? "—" : <span className="tabular-nums">{money.fmt(c.defaultHourlyRate)}</span>), className: "hidden md:table-cell" },
    { id: "overtime", header: t("columns.overtime"), cell: (c) => t("overtimeValue", { threshold: money.minutes(c.overtimeThresholdMinutes), multiplier: money.permille(c.overtimeMultiplierPermille) }), className: "hidden lg:table-cell" },
    { id: "validity", header: t("columns.validity"), cell: (c) => (c.effectiveTo ? t("validRange", { from: date.civil(c.effectiveFrom), to: date.civil(c.effectiveTo) }) : t("validFrom", { from: date.civil(c.effectiveFrom) })) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (c) => (
        <Can permission="payroll.config.manage">
          <button type="button" className={buttonClass.ghost} onClick={() => setEditing(c)}>
            {t("edit")}
            <span className="sr-only"> — {labels.get(c.staffId) ?? shortId(c.staffId)}</span>
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="payroll.config.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <ConfigurationNav />
      {flash.node}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("filters.staff")}>{(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("filters.staffPlaceholder")} />}</FormField>
        <FormField label={t("filters.activeOn")} hint={t("filters.activeOnHint")}>
          {(c) => <TextControl {...c} type="date" value={activeOn} onChange={setActiveOn} />}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(c) => c.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      <StaffSituation />
      {editing ? <ConfigDialog config={editing === "new" ? null : editing} staffLabel={editing !== "new" ? labels.get(editing.staffId) : undefined} onClose={() => setEditing(null)} onDone={() => flash.show(t("saved"))} /> : null}
    </div>
  );
}

/** « Où en est cet enseignant ? » : état de configuration calculé par l'API (en cours / expirée / à venir / absente). */
function StaffSituation() {
  const t = useTranslations("v2Payroll.config.situation");
  const tState = useTranslations("v2Payroll.configState");
  const tType = useTranslations("v2Payroll.configType");
  const money = useMoney();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const current = useCurrentPayConfig(staff?.value ?? null);
  return (
    <section aria-labelledby="config-situation" className="space-y-3 rounded-lg border p-4">
      <h2 id="config-situation" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <FormField label={t("staff")} className="sm:max-w-md">
        {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("placeholder")} />}
      </FormField>
      {staff && current.isPending ? <LoadingBlock /> : null}
      {current.isError ? <ErrorBlock error={current.error} /> : null}
      {current.data ? (
        <div className="space-y-1 text-sm">
          <p>
            <StatusBadge label={tState(current.data.state)} tone={current.data.state === "ACTIVE" ? "success" : current.data.state === "ABSENT" ? "danger" : "warning"} />
          </p>
          {current.data.config ? (
            <p className="text-muted-foreground">
              {tType(current.data.config.type)}
              {current.data.config.monthlySalary !== null ? ` · ${money.fmt(current.data.config.monthlySalary)}` : ""}
              {current.data.config.defaultHourlyRate !== null ? ` · ${t("perHour", { amount: money.fmt(current.data.config.defaultHourlyRate) })}` : ""}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("none")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ConfigDialog({ config, staffLabel, onClose, onDone }: { config: PayConfig | null; staffLabel?: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Payroll.config.configDialog");
  const tType = useTranslations("v2Payroll.configType");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const create = useCreatePayConfig();
  const update = useUpdatePayConfig();
  const mutation = config ? update : create;
  const [staff, setStaff] = useState<SelectOption | null>(config ? { value: config.staffId, label: staffLabel ?? shortId(config.staffId) } : null);
  const [form, setForm] = useState({
    type: config?.type ?? "SALARY",
    monthlySalary: config?.monthlySalary === null || config?.monthlySalary === undefined ? "" : String(config.monthlySalary),
    annualSalary: config?.annualSalary === null || config?.annualSalary === undefined ? "" : String(config.annualSalary),
    defaultHourlyRate: config?.defaultHourlyRate === null || config?.defaultHourlyRate === undefined ? "" : String(config.defaultHourlyRate),
    thresholdMinutes: config ? String(config.overtimeThresholdMinutes) : "",
    multiplier: config ? String(config.overtimeMultiplierPermille / 1000).replace(".", ",") : "",
    effectiveFrom: config?.effectiveFrom ?? todayIso(),
    effectiveTo: config?.effectiveTo ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(mutation.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const salaried = form.type === "SALARY" || form.type === "MIXED";
  const hourly = form.type === "HOURLY" || form.type === "MIXED";

  function submit() {
    const local: FieldErrors = {};
    const amountOf = (key: "monthlySalary" | "annualSalary" | "defaultHourlyRate", allowZero: boolean): number | null | undefined => {
      if (form[key].trim() === "") return null;
      const parsed = parseAmountInput(form[key], { allowZero });
      if (!parsed.ok) {
        local[key] = describeAmount(parsed) ?? "";
        return undefined;
      }
      return parsed.amount;
    };
    const monthly = salaried ? amountOf("monthlySalary", false) : null;
    const annual = salaried ? amountOf("annualSalary", false) : null;
    // 0 est une valeur (taux nul) ; vide = pas de tarif par défaut.
    const rate = hourly ? amountOf("defaultHourlyRate", true) : null;
    let threshold: number | undefined;
    if (form.thresholdMinutes.trim() !== "") {
      threshold = Number(form.thresholdMinutes);
      if (!Number.isInteger(threshold) || threshold <= 0) local.thresholdMinutes = t("thresholdInvalid");
    }
    let permille: number | undefined;
    if (form.multiplier.trim() !== "") {
      const parsed = parseMultiplierToPermille(form.multiplier);
      if (!parsed.ok) local.multiplier = t(`multiplierErrors.${parsed.reason}`);
      else permille = parsed.permille;
    }
    if (Object.keys(local).length > 0) return setErrors(local);
    const body = {
      ...(config ? {} : { staffId: staff?.value ?? "" }),
      type: form.type,
      monthlySalary: monthly,
      annualSalary: annual,
      defaultHourlyRate: rate,
      ...(threshold !== undefined ? { overtimeThresholdMinutes: threshold } : {}),
      ...(permille !== undefined ? { overtimeMultiplierPermille: permille } : {}),
      effectiveFrom: form.effectiveFrom,
      ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : { effectiveTo: null }),
    };
    const parsed = validate(config ? payrollConfigUpdateBodySchema : payrollConfigBodySchema, body);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    const done = { onSuccess: () => (onDone(), onClose()) };
    if (config) update.mutate({ id: config.id, body: body as PayConfigInput }, done);
    else create.mutate(body as PayConfigInput & { staffId: string }, done);
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={config ? t("editTitle") : t("newTitle")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={mutation.isPending} error={mutation.error && Object.keys(apiErrors).length === 0 ? mutation.error : undefined}>
      <FormField label={t("staff")} required error={err("staffId")}>
        {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("staffPlaceholder")} disabled={config !== null} clearable={config === null} />}
      </FormField>
      <FormField label={t("type")} required error={err("type")}>
        {(c) => <NativeSelect {...c} value={form.type} onChange={set("type")} options={PAYROLL_CONFIG_TYPES.map((v) => ({ value: v, label: tType(v) }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {salaried ? <MoneyField label={t("monthly")} value={form.monthlySalary} onChange={set("monthlySalary")} error={err("monthlySalary")} hint={t("monthlyHint")} /> : null}
        {salaried ? <MoneyField label={t("annual")} value={form.annualSalary} onChange={set("annualSalary")} error={err("annualSalary")} /> : null}
        {hourly ? <MoneyField label={t("hourly")} value={form.defaultHourlyRate} onChange={set("defaultHourlyRate")} error={err("defaultHourlyRate")} allowZero hint={t("hourlyHint")} /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("threshold")} hint={t("thresholdHint")} error={err("thresholdMinutes") ?? err("overtimeThresholdMinutes")}>
          {(c) => <TextControl {...c} type="number" min={1} step={1} inputMode="numeric" value={form.thresholdMinutes} onChange={set("thresholdMinutes")} />}
        </FormField>
        <FormField label={t("multiplier")} hint={t("multiplierHint")} error={err("multiplier") ?? err("overtimeMultiplierPermille")}>
          {(c) => <TextControl {...c} inputMode="decimal" value={form.multiplier} onChange={set("multiplier")} />}
        </FormField>
        <FormField label={t("from")} required error={err("effectiveFrom")}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveFrom} onChange={set("effectiveFrom")} />}
        </FormField>
        <FormField label={t("to")} error={err("effectiveTo")}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveTo} onChange={set("effectiveTo")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Tarifs horaires et simulateur de tarif
// ---------------------------------------------------------------------------

export function RatesScreen() {
  const t = useTranslations("v2Payroll.config.rates");
  const money = useMoney();
  const date = useDateFormat();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [nodeId, setNodeId] = useState("");
  const [kind, setKind] = useState("");
  const list = useHourlyRates({ staffId: staff?.value, nodeId: nodeId || undefined, generic: kind === "" ? undefined : kind === "generic", limit: 100 });
  const labels = useStaffLabels((list.data?.items ?? []).flatMap((r) => (r.staffId ? [r.staffId] : [])));
  const nodes = useCurriculumNodes();
  const flash = useFlash();
  const del = useDeleteHourlyRate();
  const [editing, setEditing] = useState<Rate | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rate | null>(null);

  const columns: DataTableColumn<Rate>[] = [
    { id: "node", header: t("columns.node"), rowHeader: true, cell: (r) => nodes.byId.get(r.curriculumNodeId)?.label ?? shortId(r.curriculumNodeId) },
    { id: "staff", header: t("columns.staff"), cell: (r) => (r.staffId ? labels.get(r.staffId) ?? shortId(r.staffId) : <StatusBadge label={t("generic")} tone="info" />) },
    { id: "rate", header: t("columns.rate"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.fmt(r.rate)}</span> },
    { id: "validity", header: t("columns.validity"), cell: (r) => (r.validTo ? t("validRange", { from: date.civil(r.validFrom), to: date.civil(r.validTo) }) : t("validFrom", { from: date.civil(r.validFrom) })), className: "hidden sm:table-cell" },
    { id: "notes", header: t("columns.notes"), cell: (r) => r.notes ?? "—", className: "hidden lg:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Can permission="payroll.rate.manage">
          <div className="flex justify-end gap-1">
            <button type="button" className={buttonClass.ghost} onClick={() => setEditing(r)}>
              {t("edit")}
              <span className="sr-only"> — {nodes.byId.get(r.curriculumNodeId)?.label ?? shortId(r.curriculumNodeId)}</span>
            </button>
            <button type="button" className={buttonClass.ghost} onClick={() => (del.reset(), setDeleting(r))}>
              {t("delete")}
              <span className="sr-only"> — {nodes.byId.get(r.curriculumNodeId)?.label ?? shortId(r.curriculumNodeId)}</span>
            </button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="payroll.rate.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <ConfigurationNav />
      {flash.node}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.staff")}>{(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("filters.staffPlaceholder")} />}</FormField>
        <NodePicker label={t("filters.node")} value={nodeId} onChange={setNodeId} />
        <FormField label={t("filters.kind")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={kind}
              onChange={setKind}
              placeholder={t("filters.all")}
              options={[
                { value: "generic", label: t("filters.generic") },
                { value: "named", label: t("filters.named") },
              ]}
            />
          )}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      <RateSimulator />
      {editing ? <RateDialog rate={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("saved"))} /> : null}
      {deleting ? (
        <ModalDialog open onOpenChange={(o) => !o && !del.isPending && setDeleting(null)} title={t("deleteDialog.title")} description={t("deleteDialog.description")}>
          {del.isError ? <ErrorBlock error={del.error} /> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={del.isPending} onClick={() => setDeleting(null)}>
              {t("deleteDialog.cancel")}
            </button>
            <button type="button" className={buttonClass.danger} disabled={del.isPending} onClick={() => del.mutate({ id: deleting.id }, { onSuccess: () => (setDeleting(null), flash.show(t("deleted"))) })}>
              {t("deleteDialog.confirm")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

function RateDialog({ rate, onClose, onDone }: { rate: Rate | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Payroll.config.rateDialog");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const create = useCreateHourlyRate();
  const update = useUpdateHourlyRate();
  const mutation = rate ? update : create;
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [form, setForm] = useState({ nodeId: rate?.curriculumNodeId ?? "", rate: rate ? String(rate.rate) : "", validFrom: rate?.validFrom ?? todayIso(), validTo: rate?.validTo ?? "", notes: rate?.notes ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(mutation.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const amount = parseAmountInput(form.rate, { allowZero: true });
    if (!amount.ok) return setErrors({ rate: describeAmount(amount) ?? "" });
    const common = { rate: amount.amount, validFrom: form.validFrom, ...(form.validTo ? { validTo: form.validTo } : { validTo: null }), ...(form.notes.trim() ? { notes: form.notes.trim() } : { notes: null }) };
    const body = rate ? common : { curriculumNodeId: form.nodeId, ...(staff ? { staffId: staff.value } : {}), ...common };
    const parsed = validate(rate ? payrollRateBodySchema.pick({ rate: true, validFrom: true, validTo: true, notes: true }) : payrollRateBodySchema, body);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    const done = { onSuccess: () => (onDone(), onClose()) };
    if (rate) update.mutate({ id: rate.id, body: common }, done);
    else create.mutate(body as Parameters<typeof create.mutate>[0], done);
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={rate ? t("editTitle") : t("newTitle")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={mutation.isPending} error={mutation.error && Object.keys(apiErrors).length === 0 ? mutation.error : undefined}>
      {rate ? (
        <p className="text-sm text-muted-foreground">{t("fixedScope")}</p>
      ) : (
        <>
          <NodePicker label={t("node")} value={form.nodeId} onChange={set("nodeId")} required error={err("curriculumNodeId")} />
          <FormField label={t("staff")} hint={t("staffHint")} error={err("staffId")}>
            {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("staffPlaceholder")} />}
          </FormField>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyField label={t("rate")} value={form.rate} onChange={set("rate")} required allowZero error={err("rate")} hint={t("rateHint")} />
        <FormField label={t("from")} required error={err("validFrom")}>
          {(c) => <TextControl {...c} type="date" value={form.validFrom} onChange={set("validFrom")} />}
        </FormField>
        <FormField label={t("to")} error={err("validTo")}>
          {(c) => <TextControl {...c} type="date" value={form.validTo} onChange={set("validTo")} />}
        </FormField>
      </div>
      <FormField label={t("notes")} error={err("notes")}>
        {(c) => <TextControl {...c} value={form.notes} onChange={set("notes")} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

/** Simulateur : le tarif retenu et son ORIGINE suivent l'ordre figé de l'API (nœud + enseignant, nœud générique, tarif par défaut…). */
function RateSimulator() {
  const t = useTranslations("v2Payroll.config.simulator");
  const tOrigin = useTranslations("v2Payroll.rateOrigin");
  const tState = useTranslations("v2Payroll.configState");
  const money = useMoney();
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [nodeId, setNodeId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [query, setQuery] = useState<{ staffId: string; date: string; nodeId?: string } | null>(null);
  const result = useResolveRate(query);
  return (
    <section aria-labelledby="rate-simulator" className="space-y-3 rounded-lg border p-4">
      <h2 id="rate-simulator" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (staff && date) setQuery({ staffId: staff.value, date, ...(nodeId ? { nodeId } : {}) });
        }}
      >
        <FormField label={t("staff")} required>
          {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("staffPlaceholder")} />}
        </FormField>
        <NodePicker label={t("node")} value={nodeId} onChange={setNodeId} hint={t("nodeHint")} />
        <FormField label={t("date")} required>
          {(c) => <TextControl {...c} type="date" value={date} onChange={setDate} />}
        </FormField>
        <div className="flex items-end">
          <button type="submit" className={buttonClass.secondary} disabled={!staff || !date}>
            {t("submit")}
          </button>
        </div>
      </form>
      {query && result.isPending && result.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {result.isError ? <ErrorBlock error={result.error} /> : null}
      {result.data ? (
        <Notice kind={result.data.rate === null ? "warning" : "info"}>
          {result.data.rate === null ? t("noRate", { state: tState(result.data.configState) }) : t("result", { rate: money.fmt(result.data.rate), origin: result.data.origin ? tOrigin(result.data.origin) : "—", state: tState(result.data.configState) })}
        </Notice>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Réglages de l'établissement
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const t = useTranslations("v2Payroll.config.settings");
  const money = useMoney();
  const settings = usePayrollSettings();
  const update = useUpdatePayrollSettings();
  const describeAmount = useAmountErrors();
  const flash = useFlash();
  const [form, setForm] = useState<{ threshold: string; multiplier: string; separate: boolean; ownerThreshold: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(update.error);

  if (settings.isPending && settings.fetchStatus !== "idle") return <LoadingBlock />;
  if (settings.isError) return <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return null;
  const s = settings.data;
  const f = form ?? {
    threshold: String(s.defaultOvertimeThresholdMinutes),
    multiplier: String(s.defaultOvertimeMultiplierPermille / 1000).replace(".", ","),
    separate: s.requireSeparateApprover,
    ownerThreshold: s.ownerApprovalThreshold === null ? "" : String(s.ownerApprovalThreshold),
  };
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  const err = (k: string) => errors[k] ?? apiErrors[k];

  function submit() {
    const local: FieldErrors = {};
    const threshold = Number(f.threshold);
    if (!Number.isInteger(threshold) || threshold <= 0) local.threshold = t("thresholdInvalid");
    const mult = parseMultiplierToPermille(f.multiplier);
    if (!mult.ok) local.multiplier = t(`multiplierErrors.${mult.reason}`);
    let owner: number | null = null;
    if (f.ownerThreshold.trim() !== "") {
      const parsed = parseAmountInput(f.ownerThreshold);
      if (!parsed.ok) local.ownerThreshold = describeAmount(parsed) ?? "";
      else owner = parsed.amount;
    }
    if (Object.keys(local).length > 0 || !mult.ok) return setErrors(local);
    setErrors({});
    update.mutate(
      { defaultOvertimeThresholdMinutes: threshold, defaultOvertimeMultiplierPermille: mult.permille, requireSeparateApprover: f.separate, ownerApprovalThreshold: owner },
      { onSuccess: () => (setForm(null), flash.show(t("saved"))) },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ConfigurationNav />
      {flash.node}
      <form
        noValidate
        className="max-w-2xl space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("currency", { currency: s.currency })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("threshold")} hint={t("thresholdHint", { hours: money.minutes(Number(f.threshold) || 0) })} error={err("threshold") ?? apiErrors.defaultOvertimeThresholdMinutes}>
            {(c) => <TextControl {...c} type="number" min={1} step={1} inputMode="numeric" value={f.threshold} onChange={(v) => set({ threshold: v })} />}
          </FormField>
          <FormField label={t("multiplier")} hint={t("multiplierHint")} error={err("multiplier") ?? apiErrors.defaultOvertimeMultiplierPermille}>
            {(c) => <TextControl {...c} inputMode="decimal" value={f.multiplier} onChange={(v) => set({ multiplier: v })} />}
          </FormField>
        </div>
        <CheckControl checked={f.separate} onChange={(v) => set({ separate: v })} label={t("separate")} hint={t("separateHint")} />
        <MoneyField label={t("ownerThreshold")} value={f.ownerThreshold} onChange={(v) => set({ ownerThreshold: v })} error={err("ownerThreshold") ?? apiErrors.ownerApprovalThreshold} hint={t("ownerThresholdHint")} />
        {update.isError && Object.keys(apiErrors).length === 0 ? <ErrorBlock error={update.error} /> : null}
        <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
          {t("submit")}
        </button>
      </form>
    </div>
  );
}
