"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FINANCE_FEE_CATEGORIES,
  financeCreateDiscountBodySchema,
  financeCreateFeeBodySchema,
  financeCreateFeeScheduleBodySchema,
  financeCreatePlanBodySchema,
  type FinanceFeeDto,
  type FinanceFeeScheduleDto,
} from "@ecoledigitale/contracts/v2/finance";
import { useReference } from "@/platform/v2/academic";
import {
  useCreateDiscount,
  useCreateFee,
  useCreateFeeSchedule,
  useCreatePlan,
  useDiscounts,
  useFeeSchedules,
  useFees,
  useInstallmentPlans,
  useResolveFee,
  useSetFeeStatus,
} from "@/platform/v2/finance";
import { useInstitutions } from "@/platform/v2/lookups";
import { useFeature } from "@/platform/access";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, parsePercentToBps, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { SectionNav } from "@/platform/ui/SectionNav";
import { apiErrorToFieldErrors, compact, type FieldErrors } from "@/platform/ui/validation";
import { AcademicYearField, MoneyField, useAmountErrors, useCampusIndex, useValidator } from "./shared";

export function CatalogNav() {
  const t = useTranslations("v2Finance.catalog.nav");
  return (
    <SectionNav
      persistent
      label={t("label")}
      items={[
        { href: "/v2/finance/fees", label: t("fees"), exact: true },
        { href: "/v2/finance/fees/schedules", label: t("schedules") },
        { href: "/v2/finance/fees/plans", label: t("plans") },
        { href: "/v2/finance/fees/discounts", label: t("discounts") },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Frais
// ---------------------------------------------------------------------------

export function FeesScreen() {
  const t = useTranslations("v2Finance.catalog.fees");
  const tCat = useTranslations("v2Finance.category");
  const [category, setCategory] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const fees = useFees({ category: category || undefined, activeOnly: activeOnly || undefined });
  const setStatus = useSetFeeStatus();
  const flash = useFlash();
  const [creating, setCreating] = useState(false);

  const columns: DataTableColumn<FinanceFeeDto>[] = [
    { id: "code", header: t("columns.code"), rowHeader: true, cell: (f) => <span className="font-mono text-xs">{f.code}</span> },
    { id: "name", header: t("columns.name"), cell: (f) => f.name },
    { id: "category", header: t("columns.category"), cell: (f) => tCat(f.category), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (f) => <StatusBadge label={f.active ? t("active") : t("inactive")} tone={f.active ? "success" : "neutral"} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (f) => (
        <Can permission="finance.fee.manage">
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: f.id, active: !f.active }, { onSuccess: () => flash.show(f.active ? t("deactivated", { name: f.name }) : t("activated", { name: f.name })) })}
          >
            {f.active ? t("deactivate") : t("activate")}
            <span className="sr-only"> — {f.name}</span>
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
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <CatalogNav />
      {flash.node}
      {setStatus.isError ? <ErrorBlock error={setStatus.error} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField label={t("filters.category")} className="sm:w-60">
          {(c) => <NativeSelect {...c} value={category} onChange={setCategory} placeholder={t("filters.allCategories")} options={FINANCE_FEE_CATEGORIES.map((v) => ({ value: v, label: tCat(v) }))} />}
        </FormField>
        <CheckControl checked={activeOnly} onChange={setActiveOnly} label={t("filters.activeOnly")} />
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={fees.data ?? []}
        getRowId={(f) => f.id}
        isLoading={fees.isPending && fees.fetchStatus !== "idle"}
        error={fees.error}
        onRetry={() => void fees.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {creating ? <CreateFeeDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreateFeeDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Finance.catalog.fees.form");
  const tCat = useTranslations("v2Finance.category");
  const create = useCreateFee();
  const validate = useValidator();
  const [form, setForm] = useState({ code: "", name: "", category: "TUITION", description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const apiErrors = apiErrorToFieldErrors(create.error);

  function submit() {
    const result = validate(financeCreateFeeBodySchema, compact(form));
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data, {
      onSuccess: (fee) => {
        onDone(fee.name);
        onClose();
      },
    });
  }

  const err = (k: string) => errors[k] ?? apiErrors[k];
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <FormField label={t("code")} required error={err("code")} hint={t("codeHint")}>
        {(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={40} />}
      </FormField>
      <FormField label={t("name")} required error={err("name")}>
        {(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={200} />}
      </FormField>
      <FormField label={t("category")} required error={err("category")}>
        {(c) => <NativeSelect {...c} value={form.category} onChange={set("category")} options={FINANCE_FEE_CATEGORIES.map((v) => ({ value: v, label: tCat(v) }))} />}
      </FormField>
      <FormField label={t("descriptionLabel")} error={err("description")}>
        {(c) => <TextAreaControl {...c} value={form.description} onChange={set("description")} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Barèmes
// ---------------------------------------------------------------------------

export function SchedulesScreen() {
  const t = useTranslations("v2Finance.catalog.schedules");
  const money = useMoney();
  const date = useDateFormat();
  const fees = useFees();
  const institutions = useInstitutions();
  const campuses = useCampusIndex();
  const [feeId, setFeeId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const schedules = useFeeSchedules({ feeId: feeId || undefined, academicYear: academicYear || undefined, activeOnly: activeOnly || undefined });
  const flash = useFlash();
  const [creating, setCreating] = useState(false);

  const feeName = useMemo(() => new Map((fees.data ?? []).map((f) => [f.id, f.name])), [fees.data]);
  const institutionName = useMemo(() => new Map((institutions.data ?? []).map((i) => [i.id, i.name])), [institutions.data]);

  function scopeText(s: FinanceFeeScheduleDto): string {
    const parts = [
      s.scope.institutionId ? institutionName.get(s.scope.institutionId) ?? t("scope.institution") : null,
      s.scope.campusId ? campuses.byId.get(s.scope.campusId) ?? t("scope.campus") : null,
      s.scope.levelKey ? t("scope.level", { value: s.scope.levelKey }) : null,
      s.scope.trackKey ? t("scope.track", { value: s.scope.trackKey }) : null,
      s.scope.learnerType ? t("scope.learnerType", { value: s.scope.learnerType }) : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : t("scope.all");
  }

  const columns: DataTableColumn<FinanceFeeScheduleDto>[] = [
    { id: "fee", header: t("columns.fee"), rowHeader: true, cell: (s) => feeName.get(s.feeId) ?? s.feeId.slice(0, 8) },
    { id: "year", header: t("columns.year"), cell: (s) => s.academicYear },
    { id: "scope", header: t("columns.scope"), cell: (s) => scopeText(s), className: "hidden md:table-cell" },
    { id: "amount", header: t("columns.amount"), align: "right", cell: (s) => <span className="font-medium tabular-nums">{money.of(s.amount)}</span> },
    { id: "validity", header: t("columns.validity"), cell: (s) => (s.effectiveTo ? t("validRange", { from: date.civil(s.effectiveFrom), to: date.civil(s.effectiveTo) }) : t("validFrom", { from: date.civil(s.effectiveFrom) })), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={s.active ? t("active") : t("inactive")} tone={s.active ? "success" : "neutral"} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <CatalogNav />
      {flash.node}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.fee")}>
          {(c) => <NativeSelect {...c} value={feeId} onChange={setFeeId} placeholder={t("filters.allFees")} options={(fees.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />}
        </FormField>
        <AcademicYearField label={t("filters.year")} value={academicYear} onChange={setAcademicYear} allowEmpty />
        <CheckControl checked={activeOnly} onChange={setActiveOnly} label={t("filters.activeOnly")} />
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={schedules.data ?? []}
        getRowId={(s) => s.id}
        isLoading={schedules.isPending && schedules.fetchStatus !== "idle"}
        error={schedules.error}
        onRetry={() => void schedules.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      <FeeResolver fees={fees.data ?? []} />
      {creating ? <CreateScheduleDialog onClose={() => setCreating(false)} onDone={() => flash.show(t("created"))} /> : null}
    </div>
  );
}

const SCOPE_EMPTY = { institutionId: "", campusId: "", levelKey: "", trackKey: "", learnerType: "" };

function ScopeFields({
  value,
  onChange,
  errors,
}: {
  value: typeof SCOPE_EMPTY;
  onChange: (patch: Partial<typeof SCOPE_EMPTY>) => void;
  errors: FieldErrors;
}) {
  const t = useTranslations("v2Finance.catalog.scope");
  const institutions = useInstitutions();
  const campuses = useCampusIndex();
  const levels = useReference("grade-levels");
  const levelListId = "finance-level-keys";
  const campusOptions = campuses.campuses.filter((c) => !value.institutionId || c.institutionId === value.institutionId);
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("legend")}</legend>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <FormField label={t("institutionLabel")} error={errors.institutionId}>
        {(c) => (
          <NativeSelect
            {...c}
            value={value.institutionId}
            onChange={(v) => onChange({ institutionId: v, campusId: "" })}
            placeholder={t("all")}
            options={(institutions.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
          />
        )}
      </FormField>
      <FormField label={t("campusLabel")} error={errors.campusId}>
        {(c) => <NativeSelect {...c} value={value.campusId} onChange={(v) => onChange({ campusId: v })} placeholder={t("all")} options={campusOptions.map((x) => ({ value: x.id, label: x.name }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("levelLabel")} error={errors.levelKey}>
          {(c) => (
            <>
              <TextControl {...c} value={value.levelKey} onChange={(v) => onChange({ levelKey: v })} maxLength={60} />
              <datalist id={levelListId}>
                {(levels.data ?? []).map((l) => (
                  <option key={l.id} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </FormField>
        <FormField label={t("trackLabel")} error={errors.trackKey}>
          {(c) => <TextControl {...c} value={value.trackKey} onChange={(v) => onChange({ trackKey: v })} maxLength={60} />}
        </FormField>
        <FormField label={t("learnerTypeLabel")} error={errors.learnerType}>
          {(c) => <TextControl {...c} value={value.learnerType} onChange={(v) => onChange({ learnerType: v })} maxLength={60} />}
        </FormField>
      </div>
    </fieldset>
  );
}

function CreateScheduleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.catalog.schedules.form");
  const describeAmount = useAmountErrors();
  const fees = useFees({ activeOnly: true });
  const plans = useInstallmentPlans();
  const create = useCreateFeeSchedule();
  const validate = useValidator();
  const [form, setForm] = useState({ feeId: "", academicYear: "", amount: "", effectiveFrom: "", effectiveTo: "", planId: "", ...SCOPE_EMPTY });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const apiErrors = apiErrorToFieldErrors(create.error);

  function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const result = validate(financeCreateFeeScheduleBodySchema, compact({ ...form, amount: amount.amount }));
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data, {
      onSuccess: () => {
        onDone();
        onClose();
      },
    });
  }

  const err = (k: string) => errors[k] ?? apiErrors[k];
  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <FormField label={t("fee")} required error={err("feeId")}>
        {(c) => <NativeSelect {...c} value={form.feeId} onChange={set("feeId")} placeholder={t("choose")} options={(fees.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <AcademicYearField label={t("year")} value={form.academicYear} onChange={set("academicYear")} required error={err("academicYear")} />
        <MoneyField label={t("amount")} value={form.amount} onChange={set("amount")} required error={err("amount")} allowZero />
        <FormField label={t("from")} required error={err("effectiveFrom")}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveFrom} onChange={set("effectiveFrom")} />}
        </FormField>
        <FormField label={t("to")} error={err("effectiveTo")}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveTo} onChange={set("effectiveTo")} />}
        </FormField>
      </div>
      <ScopeFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} errors={errors} />
      <FormField label={t("plan")} error={err("planId")} hint={t("planHint")}>
        {(c) => <NativeSelect {...c} value={form.planId} onChange={set("planId")} placeholder={t("noPlan")} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />}
      </FormField>
    </FormDialog>
  );
}

/** « Quel montant s'applique ? » — la résolution (le barème le plus spécifique gagne) est faite par l'API. */
function FeeResolver({ fees }: { fees: ReadonlyArray<FinanceFeeDto> }) {
  const t = useTranslations("v2Finance.catalog.resolver");
  const money = useMoney();
  const [form, setForm] = useState({ feeId: "", academicYear: "", onDate: "", ...SCOPE_EMPTY });
  const [submitted, setSubmitted] = useState<Parameters<typeof useResolveFee>[0]>(null);
  const resolved = useResolveFee(submitted);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <section aria-labelledby="fee-resolver" className="space-y-3 rounded-lg border p-4">
      <h2 id="fee-resolver" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.feeId || !form.academicYear) return;
          setSubmitted({
            feeId: form.feeId,
            academicYear: form.academicYear,
            ...(form.onDate ? { onDate: form.onDate } : {}),
            ...(form.institutionId ? { institutionId: form.institutionId } : {}),
            ...(form.campusId ? { campusId: form.campusId } : {}),
            ...(form.levelKey ? { levelKey: form.levelKey } : {}),
            ...(form.trackKey ? { trackKey: form.trackKey } : {}),
            ...(form.learnerType ? { learnerType: form.learnerType } : {}),
          });
        }}
      >
        <FormField label={t("fee")} required>
          {(c) => <NativeSelect {...c} value={form.feeId} onChange={set("feeId")} placeholder={t("choose")} options={fees.map((f) => ({ value: f.id, label: f.name }))} />}
        </FormField>
        <AcademicYearField label={t("year")} value={form.academicYear} onChange={set("academicYear")} required />
        <FormField label={t("level")}>{(c) => <TextControl {...c} value={form.levelKey} onChange={set("levelKey")} />}</FormField>
        <FormField label={t("track")}>{(c) => <TextControl {...c} value={form.trackKey} onChange={set("trackKey")} />}</FormField>
        <FormField label={t("learnerType")}>{(c) => <TextControl {...c} value={form.learnerType} onChange={set("learnerType")} />}</FormField>
        <FormField label={t("date")}>{(c) => <TextControl {...c} type="date" value={form.onDate} onChange={set("onDate")} />}</FormField>
        <div className="flex items-end">
          <button type="submit" className={buttonClass.secondary} disabled={!form.feeId || !form.academicYear}>
            {t("submit")}
          </button>
        </div>
      </form>
      {submitted && resolved.isPending && resolved.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {resolved.isError ? <ErrorBlock error={resolved.error} /> : null}
      {resolved.data ? (
        <Notice kind="info">
          {t("result", { amount: money.of(resolved.data.amount), year: resolved.data.academicYear })}
        </Notice>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plans d'échéancier
// ---------------------------------------------------------------------------

type StepForm = { label: string; shareKind: "FIXED" | "WEIGHT"; share: string; dueKind: "DATE" | "OFFSET_DAYS" | "MONTH_DAY"; date: string; days: string; month: string; day: string };
const EMPTY_STEP: StepForm = { label: "", shareKind: "WEIGHT", share: "1", dueKind: "OFFSET_DAYS", date: "", days: "0", month: "", day: "" };

export function PlansScreen() {
  const t = useTranslations("v2Finance.catalog.plans");
  const money = useMoney();
  const date = useDateFormat();
  const plans = useInstallmentPlans();
  const installments = useFeature("finance.installments");
  const flash = useFlash();
  const [creating, setCreating] = useState(false);
  // Fonction de l'offre : le bouton de création n'est proposé que si elle est incluse (l'API refuse sinon, 403).
  const featureOff = !installments.isLoading && !installments.allowed && !installments.isUnavailable;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="finance.fee.manage">
            {installments.allowed ? (
              <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
                {t("new")}
              </button>
            ) : null}
          </Can>
        }
      />
      <CatalogNav />
      {featureOff ? <FeatureNotice>{t("featureOff")}</FeatureNotice> : null}
      {flash.node}
      {plans.isPending && plans.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {plans.isError ? <ErrorBlock error={plans.error} onRetry={() => void plans.refetch()} /> : null}
      {plans.data && plans.data.length === 0 ? <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="grid gap-4 lg:grid-cols-2" aria-label={t("listLabel")}>
        {(plans.data ?? []).map((plan) => (
          <li key={plan.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{plan.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
            </div>
            <ol className="mt-3 divide-y text-sm">
              {plan.steps.map((s, index) => (
                <li key={`${plan.id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground">
                    {s.share.kind === "FIXED" ? t("shareFixed", { amount: money.fmt(s.share.amount, plan.currency) }) : t("shareWeight", { weight: s.share.weight })}
                    {" · "}
                    {s.due.type === "DATE" ? t("dueDate", { date: date.civil(s.due.date) }) : s.due.type === "OFFSET_DAYS" ? t("dueOffset", { days: s.due.days }) : t("dueMonthDay", { day: s.due.day, month: s.due.month })}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
      {creating ? <CreatePlanDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreatePlanDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Finance.catalog.plans.form");
  const describeAmount = useAmountErrors();
  const create = useCreatePlan();
  const validate = useValidator();
  const [head, setHead] = useState({ code: "", name: "" });
  const [steps, setSteps] = useState<StepForm[]>([{ ...EMPTY_STEP, label: "" }]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);

  const patchStep = (index: number, patch: Partial<StepForm>) => setSteps((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function submit() {
    const built: Array<Record<string, unknown>> = [];
    const stepErrors: FieldErrors = {};
    steps.forEach((s, i) => {
      let share: Record<string, unknown>;
      if (s.shareKind === "FIXED") {
        const amount = parseAmountInput(s.share);
        if (!amount.ok) stepErrors[`steps.${i}.share`] = describeAmount(amount) ?? "";
        share = { kind: "FIXED", amount: amount.ok ? amount.amount : 0 };
      } else {
        share = { kind: "WEIGHT", weight: Number(s.share) };
      }
      const due =
        s.dueKind === "DATE" ? { type: "DATE", date: s.date } : s.dueKind === "OFFSET_DAYS" ? { type: "OFFSET_DAYS", days: Number(s.days) } : { type: "MONTH_DAY", month: Number(s.month), day: Number(s.day) };
      built.push({ label: s.label.trim(), share, due });
    });
    if (Object.keys(stepErrors).length > 0) return setErrors(stepErrors);
    const result = validate(financeCreatePlanBodySchema, { code: head.code.trim(), name: head.name.trim(), steps: built });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data, {
      onSuccess: (plan) => {
        onDone(plan.name);
        onClose();
      },
    });
  }

  const err = (k: string) => errors[k] ?? apiErrors[k];
  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("code")} required error={err("code")}>
          {(c) => <TextControl {...c} value={head.code} onChange={(v) => setHead((h) => ({ ...h, code: v }))} maxLength={40} />}
        </FormField>
        <FormField label={t("name")} required error={err("name")}>
          {(c) => <TextControl {...c} value={head.name} onChange={(v) => setHead((h) => ({ ...h, name: v }))} maxLength={200} />}
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("sharesHint")}</p>
      {err("steps") ? <p role="alert" className="text-xs font-medium text-destructive">{err("steps")}</p> : null}
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("step", { n: i + 1 })}</h3>
              {steps.length > 1 ? (
                <button type="button" className={buttonClass.ghost} onClick={() => setSteps((all) => all.filter((_, idx) => idx !== i))}>
                  {t("removeStep")}
                  <span className="sr-only"> {i + 1}</span>
                </button>
              ) : null}
            </div>
            <FormField label={t("stepLabel")} required error={err(`steps.${i}.label`)}>
              {(c) => <TextControl {...c} value={s.label} onChange={(v) => patchStep(i, { label: v })} maxLength={120} />}
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t("shareKind")} required>
                {(c) => (
                  <NativeSelect
                    {...c}
                    value={s.shareKind}
                    onChange={(v) => patchStep(i, { shareKind: v as StepForm["shareKind"], share: v === "WEIGHT" ? "1" : "" })}
                    options={[
                      { value: "WEIGHT", label: t("kinds.WEIGHT") },
                      { value: "FIXED", label: t("kinds.FIXED") },
                    ]}
                  />
                )}
              </FormField>
              {s.shareKind === "FIXED" ? (
                <MoneyField label={t("shareAmount")} value={s.share} onChange={(v) => patchStep(i, { share: v })} required error={err(`steps.${i}.share`) ?? err(`steps.${i}.share.amount`)} />
              ) : (
                <FormField label={t("shareWeight")} required error={err(`steps.${i}.share.weight`)}>
                  {(c) => <TextControl {...c} type="number" min={1} step={1} inputMode="numeric" value={s.share} onChange={(v) => patchStep(i, { share: v })} />}
                </FormField>
              )}
              <FormField label={t("dueKind")} required>
                {(c) => (
                  <NativeSelect
                    {...c}
                    value={s.dueKind}
                    onChange={(v) => patchStep(i, { dueKind: v as StepForm["dueKind"] })}
                    options={[
                      { value: "OFFSET_DAYS", label: t("dues.OFFSET_DAYS") },
                      { value: "DATE", label: t("dues.DATE") },
                      { value: "MONTH_DAY", label: t("dues.MONTH_DAY") },
                    ]}
                  />
                )}
              </FormField>
              {s.dueKind === "DATE" ? (
                <FormField label={t("dueDate")} required error={err(`steps.${i}.due.date`)}>
                  {(c) => <TextControl {...c} type="date" value={s.date} onChange={(v) => patchStep(i, { date: v })} />}
                </FormField>
              ) : s.dueKind === "OFFSET_DAYS" ? (
                <FormField label={t("dueDays")} required error={err(`steps.${i}.due.days`)} hint={t("dueDaysHint")}>
                  {(c) => <TextControl {...c} type="number" min={0} step={1} inputMode="numeric" value={s.days} onChange={(v) => patchStep(i, { days: v })} />}
                </FormField>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t("dueMonth")} required error={err(`steps.${i}.due.month`)}>
                    {(c) => <TextControl {...c} type="number" min={1} max={12} step={1} inputMode="numeric" value={s.month} onChange={(v) => patchStep(i, { month: v })} />}
                  </FormField>
                  <FormField label={t("dueDay")} required error={err(`steps.${i}.due.day`)}>
                    {(c) => <TextControl {...c} type="number" min={1} max={31} step={1} inputMode="numeric" value={s.day} onChange={(v) => patchStep(i, { day: v })} />}
                  </FormField>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className={buttonClass.secondary} onClick={() => setSteps((all) => [...all, { ...EMPTY_STEP }])} disabled={steps.length >= 60}>
        {t("addStep")}
      </button>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Remises
// ---------------------------------------------------------------------------

export function DiscountsScreen() {
  const t = useTranslations("v2Finance.catalog.discounts");
  const tCat = useTranslations("v2Finance.category");
  const money = useMoney();
  const discounts = useDiscounts();
  const flash = useFlash();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("new")}
            </button>
          </Can>
        }
      />
      <CatalogNav />
      {flash.node}
      <DataTable
        caption={t("caption")}
        columns={[
          { id: "code", header: t("columns.code"), rowHeader: true, cell: (d) => <span className="font-mono text-xs">{d.code}</span> },
          { id: "name", header: t("columns.name"), cell: (d) => d.name },
          { id: "value", header: t("columns.value"), align: "right", cell: (d) => (d.kind === "PERCENT" ? money.bps(d.bps) : money.of(d.amount)) },
          { id: "cap", header: t("columns.cap"), align: "right", cell: (d) => (d.capAmount ? money.of(d.capAmount) : "—"), className: "hidden md:table-cell" },
          { id: "categories", header: t("columns.categories"), cell: (d) => (d.categories ? d.categories.map((c) => tCat(c)).join(", ") : t("allCategories")), className: "hidden lg:table-cell" },
          { id: "stackable", header: t("columns.stackable"), cell: (d) => (d.stackable ? t("yes") : t("no")), className: "hidden sm:table-cell" },
          { id: "status", header: t("columns.status"), cell: (d) => <StatusBadge label={d.active ? t("active") : t("inactive")} tone={d.active ? "success" : "neutral"} /> },
        ]}
        rows={discounts.data ?? []}
        getRowId={(d) => d.id}
        isLoading={discounts.isPending && discounts.fetchStatus !== "idle"}
        error={discounts.error}
        onRetry={() => void discounts.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {creating ? <CreateDiscountDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreateDiscountDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Finance.catalog.discounts.form");
  const tCat = useTranslations("v2Finance.category");
  const describeAmount = useAmountErrors();
  const create = useCreateDiscount();
  const validate = useValidator();
  const [form, setForm] = useState({ code: "", name: "", kind: "PERCENT", value: "", cap: "", stackable: false });
  const [categories, setCategories] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const set = (k: "code" | "name" | "kind" | "value" | "cap") => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const body: Record<string, unknown> = { code: form.code.trim(), name: form.name.trim(), kind: form.kind, stackable: form.stackable };
    const local: FieldErrors = {};
    if (form.kind === "PERCENT") {
      const pct = parsePercentToBps(form.value);
      if (!pct.ok) local.value = t(`percentErrors.${pct.reason}`);
      else body.bps = pct.bps;
    } else {
      const amount = parseAmountInput(form.value);
      if (!amount.ok) local.value = describeAmount(amount) ?? "";
      else body.amount = amount.amount;
    }
    if (form.cap.trim() !== "") {
      const cap = parseAmountInput(form.cap);
      if (!cap.ok) local.cap = describeAmount(cap) ?? "";
      else body.capAmount = cap.amount;
    }
    if (categories.length > 0) body.categories = categories;
    if (Object.keys(local).length > 0) return setErrors(local);
    const result = validate(financeCreateDiscountBodySchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data, {
      onSuccess: (d) => {
        onDone(d.name);
        onClose();
      },
    });
  }

  const err = (k: string) => errors[k] ?? apiErrors[k];
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <FormField label={t("code")} required error={err("code")}>
        {(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={40} />}
      </FormField>
      <FormField label={t("name")} required error={err("name")}>
        {(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={200} />}
      </FormField>
      <FormField label={t("kind")} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={form.kind}
            onChange={(v) => setForm((f) => ({ ...f, kind: v, value: "" }))}
            options={[
              { value: "PERCENT", label: t("kinds.PERCENT") },
              { value: "AMOUNT", label: t("kinds.AMOUNT") },
            ]}
          />
        )}
      </FormField>
      {form.kind === "PERCENT" ? (
        <FormField label={t("percent")} required error={err("value") ?? err("bps")} hint={t("percentHint")}>
          {(c) => <TextControl {...c} value={form.value} onChange={set("value")} inputMode="decimal" />}
        </FormField>
      ) : (
        <MoneyField label={t("amount")} value={form.value} onChange={set("value")} required error={err("value") ?? err("amount")} />
      )}
      <MoneyField label={t("cap")} value={form.cap} onChange={set("cap")} error={err("cap") ?? err("capAmount")} hint={t("capHint")} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("categories")}</legend>
        <p className="text-xs text-muted-foreground">{t("categoriesHint")}</p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {FINANCE_FEE_CATEGORIES.map((c) => (
            <CheckControl key={c} checked={categories.includes(c)} onChange={(on) => setCategories((all) => (on ? [...all, c] : all.filter((x) => x !== c)))} label={tCat(c)} />
          ))}
        </div>
      </fieldset>
      <CheckControl checked={form.stackable} onChange={(v) => setForm((f) => ({ ...f, stackable: v }))} label={t("stackable")} hint={t("stackableHint")} />
    </FormDialog>
  );
}
