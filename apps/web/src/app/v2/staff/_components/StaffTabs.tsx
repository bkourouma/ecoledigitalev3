"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  peopleAvailabilityInputSchema,
  peopleContractBodySchema,
  peopleQualificationBodySchema,
  type PeopleAvailabilityDto,
  type PeopleContractDto,
  type PeopleQualificationDto,
} from "@ecoledigitale/contracts/v2/people";
import { useAcademicYears, useReference } from "@/platform/v2/academic";
import {
  useAddQualification,
  useContractTypes,
  useCreateContract,
  useEndContract,
  useExpiringQualifications,
  useRemoveQualification,
  useSetAvailabilities,
  useSetCompetencies,
  useStaffAssignments,
  useStaffAvailabilities,
  useStaffCompetencies,
  useStaffContracts,
  useStaffLoad,
  useStaffQualifications,
} from "@/platform/v2/people";
import { useSubjectOptions } from "@/platform/v2/lookups";
import { useSubjects } from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ClassroomLabel } from "../../enrollments/_components/labels";

// ---------------------------------------------------------------------------
// Contrats (ni tarif ni salaire : la paie est un autre module)
// ---------------------------------------------------------------------------

export function ContractsTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.contracts");
  const tStatus = useTranslations("v2Staff.contractStatus");
  const date = useDateFormat();
  const list = useStaffContracts(staffId);
  const types = useContractTypes();
  const end = useEndContract();
  const flash = useFlash();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const typeLabel = (code: string) => (types.data ?? []).find((x) => x.code === code)?.label ?? code;

  const columns: DataTableColumn<PeopleContractDto>[] = [
    { id: "type", header: t("columns.type"), rowHeader: true, cell: (c) => <span className="font-medium">{typeLabel(c.contractTypeCode)}</span> },
    { id: "period", header: t("columns.period"), cell: (c) => `${date.civil(c.startsOn)} → ${c.endsOn ? date.civil(c.endsOn) : t("openEnded")}` },
    { id: "hours", header: t("columns.hours"), cell: (c) => (c.committedHours === null ? "—" : t(c.committedHoursUnit === "PER_YEAR" ? "perYear" : "perWeek", { value: c.committedHours })), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (c) => <StatusBadge label={tStatus(c.status)} tone={c.status === "ACTIVE" ? "success" : c.status === "DRAFT" ? "info" : "neutral"} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (c) => (
        <Can permission="staff.contract.manage">
          {c.status === "ACTIVE" || c.status === "DRAFT" ? (
            <button
              type="button"
              className={buttonClass.ghost}
              disabled={end.isPending}
              aria-label={`${t("end")} — ${typeLabel(c.contractTypeCode)}`}
              onClick={() => {
                setError(null);
                void end.mutateAsync({ staffId, contractId: c.id }).then(() => flash.show(t("ended"))).catch(setError);
              }}
            >
              {t("end")}
            </button>
          ) : null}
        </Can>
      ),
    },
  ];

  return (
    <section aria-labelledby="staff-contracts" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="staff-contracts" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="staff.contract.manage">
          <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
            {t("add")}
          </button>
        </Can>
      </div>
      <p className="text-xs text-muted-foreground">{t("noSalary")}</p>
      {flash.node}
      {error ? <ErrorBlock error={error} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(c) => c.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} />
      {creating ? <ContractDialog staffId={staffId} onClose={() => setCreating(false)} onDone={() => flash.show(t("added"))} /> : null}
    </section>
  );
}

function ContractDialog({ staffId, onClose, onDone }: { staffId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.contracts");
  const types = useContractTypes();
  const create = useCreateContract();
  const [form, setForm] = useState({ contractTypeCode: "", startsOn: "", endsOn: "", committedHours: "", committedHoursUnit: "PER_WEEK", status: "ACTIVE", note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, unknown> = { contractTypeCode: form.contractTypeCode, startsOn: form.startsOn, status: form.status };
    if (form.endsOn) body.endsOn = form.endsOn;
    if (form.committedHours.trim()) {
      body.committedHours = Number(form.committedHours.replace(",", "."));
      body.committedHoursUnit = form.committedHoursUnit;
    }
    if (form.note.trim()) body.note = form.note.trim();
    const v = validateWith(peopleContractBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await create.mutateAsync({ staffId, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("addTitle")} submitLabel={t("add")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.type")} required error={errors.contractTypeCode}>
          {(c) => <NativeSelect {...c} value={form.contractTypeCode} onChange={set("contractTypeCode")} placeholder={t("choose")} options={(types.data ?? []).filter((x) => x.active).map((x) => ({ value: x.code, label: x.label }))} />}
        </FormField>
        <FormField label={t("fields.status")} error={errors.status}>
          {(c) => <NativeSelect {...c} value={form.status} onChange={set("status")} options={[{ value: "ACTIVE", label: t("fields.statusActive") }, { value: "DRAFT", label: t("fields.statusDraft") }]} />}
        </FormField>
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
        </FormField>
        <FormField label={t("fields.committedHours")} error={errors.committedHours}>
          {(c) => <TextControl {...c} inputMode="decimal" value={form.committedHours} onChange={set("committedHours")} />}
        </FormField>
        <FormField label={t("fields.unit")} error={errors.committedHoursUnit}>
          {(c) => <NativeSelect {...c} value={form.committedHoursUnit} onChange={set("committedHoursUnit")} options={[{ value: "PER_WEEK", label: t("fields.perWeek") }, { value: "PER_YEAR", label: t("fields.perYear") }]} />}
        </FormField>
      </div>
      <FormField label={t("fields.note")} error={errors.note}>
        {(c) => <TextControl {...c} value={form.note} onChange={set("note")} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Qualifications (alerte d'expiration)
// ---------------------------------------------------------------------------

export function QualificationsTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.qualifications");
  const date = useDateFormat();
  const list = useStaffQualifications(staffId);
  const expiring = useExpiringQualifications();
  const remove = useRemoveQualification();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // L'alerte vient du serveur (seuil de préavis configuré par l'établissement), pas d'un calcul d'écran.
  const alerts = useMemo(() => new Map((expiring.data ?? []).map((e) => [e.qualificationId, e.daysLeft])), [expiring.data]);

  const columns: DataTableColumn<PeopleQualificationDto>[] = [
    { id: "label", header: t("columns.label"), rowHeader: true, cell: (q) => <span><span className="font-medium">{q.label}</span><span className="block text-xs text-muted-foreground">{t(`kind.${q.kind}`)}</span></span> },
    { id: "issuer", header: t("columns.issuer"), cell: (q) => q.issuer ?? "—", className: "hidden sm:table-cell" },
    { id: "obtained", header: t("columns.obtainedOn"), cell: (q) => (q.obtainedOn ? date.civil(q.obtainedOn) : "—"), className: "hidden md:table-cell" },
    {
      id: "expires",
      header: t("columns.expiresOn"),
      cell: (q) => {
        const left = alerts.get(q.id);
        return (
          <span className="flex flex-wrap items-center gap-1">
            {q.expiresOn ? date.civil(q.expiresOn) : t("noExpiry")}
            {left !== undefined ? <StatusBadge label={left < 0 ? t("expired") : t("expiresSoon", { count: left })} tone={left < 0 ? "danger" : "warning"} /> : null}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (q) => (
        <Can permission="staff.qualification.manage">
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={remove.isPending}
            aria-label={`${t("remove")} — ${q.label}`}
            onClick={() => {
              setError(null);
              void remove.mutateAsync({ staffId, qualificationId: q.id }).then(() => flash.show(t("removed"))).catch(setError);
            }}
          >
            {t("remove")}
          </button>
        </Can>
      ),
    },
  ];

  return (
    <section aria-labelledby="staff-quals" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="staff-quals" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="staff.qualification.manage">
          <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        </Can>
      </div>
      {flash.node}
      {error ? <ErrorBlock error={error} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(q) => q.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} />
      {adding ? <QualificationDialog staffId={staffId} onClose={() => setAdding(false)} onDone={() => flash.show(t("added"))} /> : null}
    </section>
  );
}

function QualificationDialog({ staffId, onClose, onDone }: { staffId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.qualifications");
  const add = useAddQualification();
  const [form, setForm] = useState({ kind: "DIPLOMA", label: "", issuer: "", obtainedOn: "", expiresOn: "", note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) if (v.trim() !== "") body[k] = v.trim();
    const v = validateWith(peopleQualificationBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await add.mutateAsync({ staffId, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("addTitle")} submitLabel={t("add")} onSubmit={() => void submit()} isPending={add.isPending} error={add.error} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.kind")} required error={errors.kind}>
          {(c) => <NativeSelect {...c} value={form.kind} onChange={set("kind")} options={(["DIPLOMA", "CERTIFICATION", "AUTHORIZATION", "OTHER"] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.issuer")} error={errors.issuer}>
          {(c) => <TextControl {...c} value={form.issuer} onChange={set("issuer")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.obtainedOn")} error={errors.obtainedOn}>
          {(c) => <TextControl {...c} type="date" value={form.obtainedOn} onChange={set("obtainedOn")} />}
        </FormField>
        <FormField label={t("fields.expiresOn")} hint={t("fields.expiresOnHint")} error={errors.expiresOn}>
          {(c) => <TextControl {...c} type="date" value={form.expiresOn} onChange={set("expiresOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Compétences
// ---------------------------------------------------------------------------

export function CompetenciesTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.competencies");
  const list = useStaffCompetencies(staffId);
  const subjects = useSubjects({});
  const grades = useReference("grade-levels");
  const set = useSetCompetencies();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const subjectLabel = (id: string) => (subjects.data ?? []).find((s) => s.id === id)?.label ?? id.slice(0, 8);
  const gradeLabel = (code: string) => (grades.data ?? []).find((g) => g.code === code)?.label ?? code;
  const current = list.data ?? [];

  function save(next: Array<{ subjectId: string; gradeLevelCodes?: string[] }>, message: string) {
    setError(null);
    void set.mutateAsync({ staffId, competencies: next }).then(() => flash.show(message)).catch(setError);
  }

  return (
    <section aria-labelledby="staff-comp" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="staff-comp" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="staff.update">
          <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        </Can>
      </div>
      {flash.node}
      {error ? <ErrorBlock error={error} /> : null}
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="divide-y rounded-md border text-sm" aria-label={t("title")}>
        {current.map((c) => (
          <li key={c.subjectId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <span className="font-medium">{subjectLabel(c.subjectId)}</span>
            <span className="text-muted-foreground">{c.gradeLevelCodes.length === 0 ? t("allLevels") : c.gradeLevelCodes.map(gradeLabel).join(", ")}</span>
            <Can permission="staff.update">
              <button type="button" className={`${buttonClass.ghost} ml-auto`} disabled={set.isPending} aria-label={`${t("remove")} — ${subjectLabel(c.subjectId)}`} onClick={() => save(current.filter((x) => x.subjectId !== c.subjectId).map((x) => ({ subjectId: x.subjectId, gradeLevelCodes: x.gradeLevelCodes })), t("removed"))}>
                {t("remove")}
              </button>
            </Can>
          </li>
        ))}
      </ul>
      {adding ? (
        <AddCompetencyDialog
          existing={current.map((c) => c.subjectId)}
          onClose={() => setAdding(false)}
          onSubmit={(subjectId, codes) => {
            save([...current.map((x) => ({ subjectId: x.subjectId, gradeLevelCodes: x.gradeLevelCodes })), { subjectId, gradeLevelCodes: codes }], t("added"));
            setAdding(false);
          }}
        />
      ) : null}
    </section>
  );
}

function AddCompetencyDialog({ existing, onClose, onSubmit }: { existing: string[]; onClose: () => void; onSubmit: (subjectId: string, codes: string[]) => void }) {
  const t = useTranslations("v2Staff.competencies");
  const grades = useReference("grade-levels");
  const [subject, setSubject] = useState<SelectOption | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("addTitle")}
      description={t("addDescription")}
      submitLabel={t("add")}
      onSubmit={() => {
        if (!subject) return setError(t("subjectRequired"));
        if (existing.includes(subject.value)) return setError(t("alreadyListed"));
        onSubmit(subject.value, codes);
      }}
    >
      <FormField label={t("subject")} required error={error}>
        {(c) => <SelectAsync {...c} value={subject} onChange={setSubject} useOptions={useSubjectOptions} placeholder={t("subjectPlaceholder")} ariaLabel={t("subject")} />}
      </FormField>
      <fieldset className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
        <legend className="px-1 text-sm font-medium">{t("levels")}</legend>
        <p className="px-1 text-xs text-muted-foreground">{t("levelsHint")}</p>
        {(grades.data ?? []).filter((g) => g.active).map((g) => (
          <CheckControl key={g.id} checked={codes.includes(g.code)} onChange={(on) => setCodes((prev) => (on ? [...prev, g.code] : prev.filter((x) => x !== g.code)))} label={g.label} />
        ))}
      </fieldset>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Disponibilités (grille hebdomadaire)
// ---------------------------------------------------------------------------

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Créneau DTO -> entrée du contrat (champs nuls omis, heure `HH:MM`). */
export function availabilityInput(a: PeopleAvailabilityDto): Record<string, unknown> {
  const out: Record<string, unknown> = { weekday: a.weekday, startTime: a.startTime.slice(0, 5), endTime: a.endTime.slice(0, 5), kind: a.kind };
  if (a.campusId) out.campusId = a.campusId;
  if (a.validFrom) out.validFrom = a.validFrom;
  if (a.validTo) out.validTo = a.validTo;
  if (a.reason) out.reason = a.reason;
  return out;
}

export function AvailabilityGrid({
  slots,
  canEdit,
  isSaving,
  error,
  onSave,
}: {
  slots: ReadonlyArray<PeopleAvailabilityDto>;
  canEdit: boolean;
  isSaving: boolean;
  error: unknown;
  /** Remplace TOUS les créneaux (l'API remplace la liste entière). */
  onSave: (next: Array<Record<string, unknown>>) => Promise<unknown>;
}) {
  const t = useTranslations("v2Staff.availabilities");
  const [adding, setAdding] = useState(false);
  const byDay = useMemo(() => WEEKDAYS.map((d) => ({ day: d, items: slots.filter((s) => s.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime)) })), [slots]);

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        </div>
      ) : null}
      {error ? <ErrorBlock error={error} /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label={t("gridLabel")}>
        {byDay.map(({ day, items }) => (
          <section key={day} role="listitem" aria-labelledby={`wd-${day}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
            <h3 id={`wd-${day}`} className="mb-1 text-sm font-semibold">
              {t(`weekday.${day}`)}
            </h3>
            {items.length === 0 ? <p className="text-xs text-muted-foreground">{t("none")}</p> : null}
            <ul className="space-y-1">
              {items.map((s) => (
                <li key={s.id} className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-xs ${s.kind === "AVAILABLE" ? "bg-emerald-400/10 text-emerald-200" : "bg-red-400/10 text-red-200"}`}>
                  <span>
                    {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)} · {t(`kind.${s.kind}`)}
                    {s.reason ? ` — ${s.reason}` : ""}
                  </span>
                  {canEdit ? (
                    <button type="button" className="rounded px-1 font-medium underline-offset-2 hover:underline" disabled={isSaving} aria-label={`${t("remove")} — ${t(`weekday.${day}`)} ${s.startTime.slice(0, 5)}`} onClick={() => void onSave(slots.filter((x) => x.id !== s.id).map(availabilityInput))}>
                      {t("remove")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {adding ? <AvailabilityDialog onClose={() => setAdding(false)} onSubmit={(slot) => onSave([...slots.map(availabilityInput), slot]).then(() => setAdding(false))} isSaving={isSaving} error={error} /> : null}
    </div>
  );
}

function AvailabilityDialog({ onClose, onSubmit, isSaving, error }: { onClose: () => void; onSubmit: (slot: Record<string, unknown>) => Promise<unknown>; isSaving: boolean; error: unknown }) {
  const t = useTranslations("v2Staff.availabilities");
  const [form, setForm] = useState({ weekday: "1", startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const slot: Record<string, unknown> = { weekday: Number(form.weekday), startTime: form.startTime, endTime: form.endTime, kind: form.kind };
    if (form.reason.trim()) slot.reason = form.reason.trim();
    const v = validateWith(peopleAvailabilityInputSchema, slot);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await onSubmit(v.data as Record<string, unknown>);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("addTitle")} description={t("addDescription")} submitLabel={t("add")} onSubmit={() => void submit()} isPending={isSaving} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.weekday")} required error={errors.weekday}>
          {(c) => <NativeSelect {...c} value={form.weekday} onChange={set("weekday")} options={WEEKDAYS.map((d) => ({ value: String(d), label: t(`weekday.${d}`) }))} />}
        </FormField>
        <FormField label={t("fields.kind")} required error={errors.kind}>
          {(c) => <NativeSelect {...c} value={form.kind} onChange={set("kind")} options={[{ value: "UNAVAILABLE", label: t("kind.UNAVAILABLE") }, { value: "AVAILABLE", label: t("kind.AVAILABLE") }]} />}
        </FormField>
        <FormField label={t("fields.startTime")} required error={errors.startTime}>
          {(c) => <TextControl {...c} type="time" value={form.startTime} onChange={set("startTime")} />}
        </FormField>
        <FormField label={t("fields.endTime")} required error={errors.endTime ?? errors[""]}>
          {(c) => <TextControl {...c} type="time" value={form.endTime} onChange={set("endTime")} />}
        </FormField>
      </div>
      <FormField label={t("fields.reason")} error={errors.reason}>
        {(c) => <TextControl {...c} value={form.reason} onChange={set("reason")} maxLength={300} />}
      </FormField>
    </FormDialog>
  );
}

export function AvailabilitiesTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.availabilities");
  const list = useStaffAvailabilities(staffId);
  const set = useSetAvailabilities();
  const flash = useFlash();
  return (
    <section aria-labelledby="staff-avail" className="space-y-3">
      <h2 id="staff-avail" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {flash.node}
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <Can permission="staff.availability.manage" fallback={<AvailabilityGrid slots={list.data} canEdit={false} isSaving={false} error={null} onSave={async () => undefined} />}>
          <AvailabilityGrid
            slots={list.data}
            canEdit
            isSaving={set.isPending}
            error={set.error}
            onSave={(next) => set.mutateAsync({ staffId, availabilities: next }).then(() => flash.show(t("saved")))}
          />
        </Can>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Charge horaire et affectations
// ---------------------------------------------------------------------------

export function LoadTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.load");
  const tRoles = useTranslations("v2Staff.roles");
  const date = useDateFormat();
  const years = useAcademicYears();
  const [yearId, setYearId] = useState("");
  useEffect(() => {
    if (yearId || !years.data) return;
    const current = years.data.find((y) => y.isCurrent) ?? years.data.find((y) => y.status === "OPEN") ?? years.data[0];
    if (current) setYearId(current.id);
  }, [years.data, yearId]);
  const load = useStaffLoad(staffId, yearId || null);
  const assignments = useStaffAssignments(staffId, yearId || undefined);

  type Row = NonNullable<typeof assignments.data>[number];
  const columns: DataTableColumn<Row>[] = [
    { id: "classroom", header: t("columns.classroom"), rowHeader: true, cell: (a) => <ClassroomLabel classroomId={a.classroomId} /> },
    { id: "role", header: t("columns.role"), cell: (a) => tRoles(a.roleCode) },
    { id: "scope", header: t("columns.scope"), cell: (a) => (a.coversAllSubjects ? t("allSubjects") : a.curriculumNodeId ? t("oneSubject") : "—"), className: "hidden sm:table-cell" },
    { id: "hours", header: t("columns.hours"), align: "right", cell: (a) => (a.plannedHours === null ? "—" : t("hours", { value: a.plannedHours })) },
    { id: "period", header: t("columns.period"), cell: (a) => `${date.civil(a.startsOn)} → ${a.endsOn ? date.civil(a.endsOn) : "…"}`, className: "hidden md:table-cell" },
  ];

  return (
    <section aria-labelledby="staff-load" className="space-y-4">
      <h2 id="staff-load" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <div className="max-w-xs">
        <FormField label={t("year")}>{(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}</FormField>
      </div>
      {load.isPending && load.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {load.isError ? <ErrorBlock error={load.error} onRetry={() => void load.refetch()} /> : null}
      {load.data ? (
        <dl className="grid gap-4 rounded-2xl border border-white/10 bg-card/40 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("planned")}</dt>
            <dd className="text-xl font-semibold">{t("hours", { value: load.data.plannedHours })}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("contractualWeek")}</dt>
            <dd className="text-xl font-semibold">{load.data.contractualHoursPerWeek === null ? "—" : t("hours", { value: load.data.contractualHoursPerWeek })}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("contractualYear")}</dt>
            <dd className="text-xl font-semibold">{load.data.contractualHoursPerYear === null ? "—" : t("hours", { value: load.data.contractualHoursPerYear })}</dd>
          </div>
        </dl>
      ) : null}
      {load.data && load.data.contractualHoursPerWeek !== null && load.data.contractualHoursPerYear === null ? <Notice kind="info">{t("noWeeks")}</Notice> : null}
      <DataTable caption={t("caption")} columns={columns} rows={assignments.data ?? []} getRowId={(a) => a.id} isLoading={assignments.isFetching} error={assignments.error} onRetry={() => void assignments.refetch()} emptyTitle={t("empty")} />
      <p className="text-sm">
        <Link href="/v2/staff/assignments" className="text-primary underline-offset-4 hover:underline">
          {t("manage")}
        </Link>
      </p>
    </section>
  );
}
