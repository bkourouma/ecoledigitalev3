"use client";

import { useMemo, useState } from "react";
import { Archive, CalendarRange, CheckCircle2, DoorOpen, Lock, Pencil, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AcademicPeriodDto, AcademicYearDto } from "@ecoledigitale/contracts/v2/academic";
import { academicCreatePeriodBodySchema, academicCreateYearBodySchema } from "@ecoledigitale/contracts/v2/academic";
import {
  useAcademicYears,
  useApplyPeriodPlan,
  useCloseYear,
  useCreatePeriod,
  useCreateYear,
  useDeletePeriod,
  usePeriodAction,
  useReference,
  useReopenPeriod,
  useUpdatePeriod,
  useUpdateYear,
  useYearAction,
  useYearPeriods,
  type PeriodAction,
  type YearAction,
} from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { InstitutionField, toneOf, useDefaultInstitutionId } from "./shared";

/** Boutons proposés selon l'état d'une année (affordance d'écran) ; la transition elle-même est décidée par l'API. */
const YEAR_ACTIONS: Record<string, YearAction[]> = { DRAFT: ["open"], OPEN: ["set-current"], CLOSED: ["archive"], ARCHIVED: [] };
const YEAR_ACTION_ICONS: Record<YearAction, LucideIcon> = { open: DoorOpen, "set-current": CheckCircle2, archive: Archive };
const ICON_BUTTON = "w-10 px-0 sm:w-9";
const PERIOD_ACTIONS: Record<string, PeriodAction[]> = { PLANNED: ["open"], OPEN: ["close-grading", "close"], GRADING_CLOSED: ["close"], CLOSED: [] };

export function YearsScreen() {
  const t = useTranslations("v2Academic.years");
  const years = useAcademicYears();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<AcademicYearDto | null>(null);
  const [editing, setEditing] = useState<AcademicYearDto | null>(null);
  const flash = useFlash();
  const date = useDateFormat();
  const tStatus = useTranslations("v2Academic.status.year");

  const yearAction = { open: useYearAction("open"), "set-current": useYearAction("set-current"), archive: useYearAction("archive") } as const;
  const closeYear = useCloseYear();
  const [actionError, setActionError] = useState<unknown>(null);

  const rows = years.data ?? [];
  const selected = rows.find((y) => y.id === selectedId) ?? null;

  async function run(action: YearAction, year: AcademicYearDto) {
    setActionError(null);
    try {
      await yearAction[action].mutateAsync({ id: year.id });
      flash.show(t(`done.${action}`, { label: year.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  const columns: DataTableColumn<AcademicYearDto>[] = [
    { id: "label", header: t("columns.label"), cell: (y) => <span className="font-medium">{y.label}</span>, rowHeader: true, className: "whitespace-nowrap" },
    { id: "code", header: t("columns.code"), cell: (y) => y.code, className: "hidden whitespace-nowrap sm:table-cell" },
    { id: "dates", header: t("columns.dates"), cell: (y) => `${date.civil(y.startsOn)} → ${date.civil(y.endsOn)}`, className: "whitespace-nowrap" },
    {
      id: "status",
      header: t("columns.status"),
      className: "whitespace-nowrap",
      cell: (y) => (
        <span className="flex flex-nowrap items-center gap-1">
          <StatusBadge label={tStatus(y.status)} tone={toneOf(y.status)} />
          {y.isCurrent ? <StatusBadge label={t("current")} tone="success" /> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (y) => (
        <span className="flex flex-nowrap items-center justify-end gap-1">
          <button type="button" className={cn(buttonClass.ghost, ICON_BUTTON)} onClick={() => setSelectedId(y.id)} aria-pressed={selectedId === y.id} aria-label={`${t("periodsOf", { label: y.label })} — ${y.label}`} title={t("periodsOf", { label: y.label })}>
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
          </button>
          <Can permission="academic.year.manage">
            {(YEAR_ACTIONS[y.status] ?? []).map((a) => {
              const Icon = YEAR_ACTION_ICONS[a];
              return (
                <button key={a} type="button" className={cn(buttonClass.ghost, ICON_BUTTON)} onClick={() => void run(a, y)} disabled={yearAction[a].isPending} aria-label={`${t(`actions.${a}`)} — ${y.label}`} title={t(`actions.${a}`)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              );
            })}
            {y.status !== "ARCHIVED" ? (
              <button type="button" className={cn(buttonClass.ghost, ICON_BUTTON)} onClick={() => setEditing(y)} aria-label={`${t("edit")} — ${y.label}`} title={t("edit")}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </Can>
          {y.status === "OPEN" ? (
            <Can permission="academic.year.close">
              <button type="button" className={cn(buttonClass.danger, ICON_BUTTON)} onClick={() => setClosing(y)} aria-label={`${t("actions.close")} — ${y.label}`} title={t("actions.close")}>
                <Lock className="h-4 w-4" aria-hidden="true" />
              </button>
            </Can>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="academic.year.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </Can>
        }
      />
      <div className="space-y-4">
        {flash.node}
        {actionError ? <ErrorBlock error={actionError} /> : null}
        <DataTable
          caption={t("tableCaption")}
          columns={columns}
          rows={rows}
          getRowId={(y) => y.id}
          isLoading={years.isPending && years.fetchStatus !== "idle"}
          error={years.error}
          onRetry={() => void years.refetch()}
          emptyTitle={t("empty")}
          emptyDescription={t("emptyHint")}
        />
        {selected ? <PeriodsPanel year={selected} /> : rows.length > 0 ? <p className="text-sm text-muted-foreground">{t("selectYear")}</p> : null}
      </div>

      {creating ? <CreateYearDialog onClose={() => setCreating(false)} onDone={(label) => flash.show(t("created", { label }))} /> : null}
      {editing ? <EditYearDialog year={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("updated"))} /> : null}
      {closing ? (
        <CloseYearDialog
          year={closing}
          mutation={closeYear}
          onClose={() => setClosing(null)}
          onDone={() => flash.show(t("done.close", { label: closing.label }))}
        />
      ) : null}
    </div>
  );
}

function CloseYearDialog({ year, mutation, onClose, onDone }: { year: AcademicYearDto; mutation: ReturnType<typeof useCloseYear>; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.years");
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("closeTitle", { label: year.label })}
      description={t("closeDescription")}
      reasonLabel={t("reason")}
      reasonRequired={false}
      confirmLabel={t("actions.close")}
      destructive
      isPending={mutation.isPending}
      error={mutation.error}
      onConfirm={async (reason) => {
        try {
          await mutation.mutateAsync({ id: year.id, reason: reason || undefined });
          onDone();
          onClose();
        } catch {
          /* l'erreur est affichée par la boîte de dialogue */
        }
      }}
    />
  );
}

function CreateYearDialog({ onClose, onDone }: { onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2Academic.years");
  const [institution, setInstitution] = useState("");
  const [form, setForm] = useState({ code: "", label: "", startsOn: "", endsOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateYear();
  const { institutionId } = useDefaultInstitutionId(institution);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body = { institutionId, ...compact(form) };
    const v = validateWith(academicCreateYearBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await create.mutateAsync(v.data);
      onDone(created.label);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("createTitle")} submitLabel={t("create")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error}>
      <InstitutionField value={institution} onChange={setInstitution} error={errors.institutionId} />
      <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
        {(c) => <TextControl {...c} value={form.code} onChange={set("code")} placeholder="2026-2027" maxLength={20} />}
      </FormField>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} hint={t("fields.endsOnHint")} error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

function EditYearDialog({ year, onClose, onDone }: { year: AcademicYearDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.years");
  const [form, setForm] = useState({ label: year.label, startsOn: year.startsOn, endsOn: year.endsOn });
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateYear();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const patch: Record<string, string> = {};
    if (form.label !== year.label) patch.label = form.label;
    if (form.startsOn !== year.startsOn) patch.startsOn = form.startsOn;
    if (form.endsOn !== year.endsOn) patch.endsOn = form.endsOn;
    if (Object.keys(patch).length === 0) return onClose();
    try {
      await update.mutateAsync({ id: year.id, patch });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { label: year.label })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error}>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} required error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Périodes d'une année
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Frise de l'année : position et largeur de chaque période en pourcentage de la durée de l'année (affichage seulement). */
export function YearTimeline({ year, periods }: { year: AcademicYearDto; periods: ReadonlyArray<AcademicPeriodDto> }) {
  const t = useTranslations("v2Academic.periods");
  const total = Math.max(1, dayNumber(year.endsOn) - dayNumber(year.startsOn) + 1);
  const tStatus = useTranslations("v2Academic.status.period");
  const roots = periods.filter((p) => p.parentPeriodId === null);
  if (roots.length === 0) return null;
  return (
    <figure aria-label={t("timelineLabel")} className="space-y-1">
      <div className="relative h-9 overflow-hidden rounded-md bg-muted" role="list">
        {roots.map((p) => {
          const left = ((dayNumber(p.startsOn) - dayNumber(year.startsOn)) / total) * 100;
          const width = ((dayNumber(p.endsOn) - dayNumber(p.startsOn) + 1) / total) * 100;
          return (
            <div
              key={p.id}
              role="listitem"
              title={`${p.label} — ${tStatus(p.status)}`}
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%` }}
              className={`absolute top-0 flex h-full items-center overflow-hidden border-r border-background px-1 text-xs font-medium ${p.status === "OPEN" ? "bg-emerald-500/80 text-white" : p.status === "CLOSED" ? "bg-slate-400/70" : p.status === "GRADING_CLOSED" ? "bg-amber-400/80" : "bg-blue-300/70"}`}
            >
              <span className="truncate">{p.label}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="text-xs text-muted-foreground">{t("timelineCaption")}</figcaption>
    </figure>
  );
}

function PeriodsPanel({ year }: { year: AcademicYearDto }) {
  const t = useTranslations("v2Academic.periods");
  const tStatus = useTranslations("v2Academic.status.period");
  const periods = useYearPeriods(year.id);
  const types = useReference("period-types");
  const date = useDateFormat();
  const flash = useFlash();
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState<AcademicPeriodDto | null>(null);
  const [reopening, setReopening] = useState<AcademicPeriodDto | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const actions = { open: usePeriodAction("open"), "close-grading": usePeriodAction("close-grading"), close: usePeriodAction("close") } as const;
  const del = useDeletePeriod();
  const reopen = useReopenPeriod();

  const typeLabel = useMemo(() => new Map((types.data ?? []).map((x) => [x.code, x.label])), [types.data]);
  const list = useMemo(() => [...(periods.data ?? [])].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.ordinal - b.ordinal), [periods.data]);

  async function run(action: PeriodAction, p: AcademicPeriodDto) {
    setActionError(null);
    try {
      await actions[action].mutateAsync({ id: p.id });
      flash.show(t(`done.${action}`, { label: p.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  async function remove(p: AcademicPeriodDto) {
    setActionError(null);
    try {
      await del.mutateAsync({ id: p.id });
      flash.show(t("deleted", { label: p.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  const columns: DataTableColumn<AcademicPeriodDto>[] = [
    { id: "label", header: t("columns.label"), cell: (p) => <span className={p.parentPeriodId ? "pl-4" : "font-medium"}>{p.label}</span>, rowHeader: true },
    { id: "type", header: t("columns.type"), cell: (p) => `${typeLabel.get(p.periodTypeCode) ?? p.periodTypeCode} ${p.ordinal}`, className: "hidden sm:table-cell" },
    { id: "dates", header: t("columns.dates"), cell: (p) => `${date.civil(p.startsOn)} → ${date.civil(p.endsOn)}` },
    { id: "status", header: t("columns.status"), cell: (p) => <StatusBadge label={tStatus(p.status)} tone={toneOf(p.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (p) => (
        <span className="flex flex-wrap justify-end gap-1">
          <Can permission="academic.period.close">
            {(PERIOD_ACTIONS[p.status] ?? []).map((a) => (
              <button key={a} type="button" className={buttonClass.secondary} disabled={actions[a].isPending} onClick={() => void run(a, p)} aria-label={`${t(`actions.${a}`)} — ${p.label}`}>
                {t(`actions.${a}`)}
              </button>
            ))}
          </Can>
          {p.status === "CLOSED" ? (
            <Can permission="academic.period.reopen">
              <button type="button" className={buttonClass.secondary} onClick={() => setReopening(p)} aria-label={`${t("actions.reopen")} — ${p.label}`}>
                {t("actions.reopen")}
              </button>
            </Can>
          ) : null}
          <Can permission="academic.period.manage">
            {p.status === "PLANNED" ? (
              <>
                <button type="button" className={buttonClass.ghost} onClick={() => setEditing(p)} aria-label={`${t("edit")} — ${p.label}`}>
                  {t("edit")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => void remove(p)} aria-label={`${t("delete")} — ${p.label}`}>
                  {t("delete")}
                </button>
              </>
            ) : null}
          </Can>
        </span>
      ),
    },
  ];

  return (
    <section aria-labelledby="periods-title" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="periods-title" className="text-lg font-semibold">
          {t("title", { label: year.label })}
        </h2>
        <Can permission="academic.period.manage">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setApplying(true)}>
              {t("applyPlan")}
            </button>
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </div>
        </Can>
      </div>
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {periods.isPending && periods.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {periods.isError ? <ErrorBlock error={periods.error} onRetry={() => void periods.refetch()} /> : null}
      {periods.data ? <YearTimeline year={year} periods={list} /> : null}
      {periods.data ? (
        <DataTable caption={t("tableCaption", { label: year.label })} columns={columns} rows={list} getRowId={(p) => p.id} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      ) : null}

      {creating ? <CreatePeriodDialog year={year} periods={list} onClose={() => setCreating(false)} onDone={(l) => flash.show(t("created", { label: l }))} /> : null}
      {applying ? <ApplyPlanDialog year={year} onClose={() => setApplying(false)} onDone={(n) => flash.show(t("planApplied", { count: n }))} /> : null}
      {editing ? <EditPeriodDialog period={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("updated"))} /> : null}
      {reopening ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setReopening(null)}
          title={t("reopenTitle", { label: reopening.label })}
          description={t("reopenDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("actions.reopen")}
          isPending={reopen.isPending}
          error={reopen.error}
          onConfirm={async (reason) => {
            try {
              await reopen.mutateAsync({ id: reopening.id, reason });
              flash.show(t("done.reopen", { label: reopening.label }));
              setReopening(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </section>
  );
}

function CreatePeriodDialog({ year, periods, onClose, onDone }: { year: AcademicYearDto; periods: ReadonlyArray<AcademicPeriodDto>; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2Academic.periods");
  const types = useReference("period-types");
  const create = useCreatePeriod();
  const [form, setForm] = useState({ periodTypeCode: "", parentPeriodId: "", ordinal: "1", code: "", label: "", startsOn: year.startsOn, endsOn: year.endsOn });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body = { ...compact({ periodTypeCode: form.periodTypeCode, code: form.code, label: form.label, startsOn: form.startsOn, endsOn: form.endsOn }), ordinal: Number(form.ordinal), ...(form.parentPeriodId ? { parentPeriodId: form.parentPeriodId } : {}) };
    const v = validateWith(academicCreatePeriodBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await create.mutateAsync({ yearId: year.id, body: v.data });
      onDone(created.label);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("createTitle", { label: year.label })} submitLabel={t("create")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error}>
      <FormField label={t("fields.type")} required error={errors.periodTypeCode}>
        {(c) => <NativeSelect {...c} value={form.periodTypeCode} onChange={set("periodTypeCode")} placeholder={t("choose")} options={(types.data ?? []).filter((x) => x.active).map((x) => ({ value: x.code, label: x.label }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.ordinal")} required error={errors.ordinal}>
          {(c) => <TextControl {...c} type="number" min={1} max={99} value={form.ordinal} onChange={set("ordinal")} inputMode="numeric" />}
        </FormField>
        <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code")(v.toUpperCase())} maxLength={40} />}
        </FormField>
      </div>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <FormField label={t("fields.parent")} hint={t("fields.parentHint")} error={errors.parentPeriodId}>
        {(c) => <NativeSelect {...c} value={form.parentPeriodId} onChange={set("parentPeriodId")} placeholder={t("noParent")} options={periods.filter((p) => p.parentPeriodId === null).map((p) => ({ value: p.id, label: p.label }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} required error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

function ApplyPlanDialog({ year, onClose, onDone }: { year: AcademicYearDto; onClose: () => void; onDone: (count: number) => void }) {
  const t = useTranslations("v2Academic.periods");
  const plans = useReference("period-plans");
  const apply = useApplyPeriodPlan();
  const [planCode, setPlanCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plan = (plans.data ?? []).find((p) => p.code === planCode);

  async function submit() {
    if (!planCode) return setError(t("planRequired"));
    setError(null);
    try {
      const created = await apply.mutateAsync({ yearId: year.id, planCode });
      onDone(created.items.length);
      onClose();
    } catch {
      /* affichée par la boîte de dialogue */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("applyPlanTitle", { label: year.label })} description={t("applyPlanDescription")} submitLabel={t("applyPlan")} onSubmit={() => void submit()} isPending={apply.isPending} error={apply.error}>
      <FormField label={t("fields.plan")} required error={error}>
        {(c) => <NativeSelect {...c} value={planCode} onChange={setPlanCode} placeholder={t("choose")} options={(plans.data ?? []).filter((p) => p.active).map((p) => ({ value: p.code, label: p.label }))} />}
      </FormField>
      {plan ? (
        <Notice kind="info">
          <p className="font-medium">{t("planSlots", { count: plan.slots.length })}</p>
          <ul className="mt-1 list-disc pl-5">
            {plan.slots.map((s) => (
              <li key={`${s.type}-${s.ordinal}`}>{s.label}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </FormDialog>
  );
}

function EditPeriodDialog({ period, onClose, onDone }: { period: AcademicPeriodDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.periods");
  const update = useUpdatePeriod();
  const [form, setForm] = useState({ label: period.label, startsOn: period.startsOn, endsOn: period.endsOn });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const patch: Record<string, string> = {};
    (Object.keys(form) as Array<keyof typeof form>).forEach((k) => {
      if (form[k] !== period[k]) patch[k] = form[k];
    });
    if (Object.keys(patch).length === 0) return onClose();
    try {
      await update.mutateAsync({ id: period.id, patch });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { label: period.label })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error}>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} required error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
