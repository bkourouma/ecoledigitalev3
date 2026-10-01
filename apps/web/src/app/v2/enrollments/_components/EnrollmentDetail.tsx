"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AcademicCatalogItemDto, AcademicEnrollmentCourseDto, AcademicEnrollmentDto, AcademicHistoryEntryDto } from "@ecoledigitale/contracts/v2/academic";
import { academicChangeFundingBodySchema } from "@ecoledigitale/contracts/v2/academic";
import {
  useAcademicSettings,
  useAddEnrollmentCourse,
  useCancelEnrollmentCourse,
  useCatalog,
  useChangeEnrollmentFunding,
  useConfirmEnrollmentCourse,
  useEnrollmentAction,
  useEnrollmentCourses,
  useEnrollmentDetail,
  useEnrollmentHistory,
  useReference,
  useTransferEnrollment,
  type EnrollmentAction,
} from "@/platform/v2/academic";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useFeature } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOf } from "../../academic/_components/shared";
import { ClassroomLabel, enrollmentTone, StudentLabel } from "./labels";

/** Actions proposées selon l'état (affordance d'écran) ; les transitions réelles sont décidées par l'API. */
const ACTIONS: Record<string, EnrollmentAction[]> = {
  PENDING: ["confirm", "cancel"],
  ACTIVE: ["suspend", "complete", "withdraw", "cancel"],
  SUSPENDED: ["resume", "withdraw"],
  COMPLETED: ["reopen"],
};
const NEEDS_REASON: ReadonlySet<EnrollmentAction> = new Set(["suspend", "withdraw", "cancel", "reopen"]);

export function EnrollmentDetail({ id }: { id: string }) {
  const t = useTranslations("v2Enrollments.detail");
  const tStatus = useTranslations("v2Enrollments.status");
  const tMode = useTranslations("v2Enrollments.mode");
  const tFunding = useTranslations("v2Enrollments.funding");
  const date = useDateFormat();
  const detail = useEnrollmentDetail(id);
  const history = useEnrollmentHistory(id);
  const settings = useAcademicSettings(detail.data?.enrollment.institutionId ?? null);
  const action = useEnrollmentAction();
  const flash = useFlash();
  const [pending, setPending] = useState<EnrollmentAction | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [changingFunding, setChangingFunding] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  if (detail.isPending && detail.fetchStatus !== "idle") return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return null;
  const { enrollment: e, placements } = detail.data;

  async function run(a: EnrollmentAction, reason?: string) {
    setActionError(null);
    try {
      await action.mutateAsync({ id: e.id, action: a, reason });
      flash.show(t(`done.${a}`));
      setPending(null);
    } catch (err) {
      setActionError(err);
    }
  }

  const placementColumns: DataTableColumn<(typeof placements)[number]>[] = [
    { id: "classroom", header: t("placements.classroom"), rowHeader: true, cell: (p) => <ClassroomLabel classroomId={p.classroomId} /> },
    { id: "period", header: t("placements.period"), cell: (p) => `${date.civil(p.startsOn)} → ${p.endsOn ? date.civil(p.endsOn) : t("placements.ongoing")}` },
    { id: "reason", header: t("placements.reason"), cell: (p) => p.reason ?? "—", className: "hidden sm:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title", { registration: e.registrationNumber ?? t("noRegistration") })}
        description={undefined}
        actions={
          <>
            <Link href="/v2/enrollments" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="enrollment.update">
              {(ACTIONS[e.status] ?? []).map((a) => (
                <button key={a} type="button" className={a === "cancel" || a === "withdraw" ? buttonClass.danger : buttonClass.secondary} onClick={() => (NEEDS_REASON.has(a) ? setPending(a) : void run(a))} disabled={action.isPending}>
                  {t(`actions.${a}`)}
                </button>
              ))}
              {e.status === "ACTIVE" || e.status === "SUSPENDED" ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setTransferring(true)}>
                  {t("actions.transfer")}
                </button>
              ) : null}
            </Can>
          </>
        }
      />
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}

      <section aria-labelledby="enr-summary" className="rounded-lg border p-4">
        <h2 id="enr-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")}
          <StatusBadge label={tStatus(e.status)} tone={enrollmentTone(e.status)} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label={t("student")}>
            <StudentLabel studentId={e.studentId} />
          </Item>
          <Item label={t("classroom")}>
            <ClassroomLabel classroomId={e.classroomId} />
          </Item>
          <Item label={t("mode")}>{tMode(e.mode)}</Item>
          <Item label={t("enrolledOn")}>{date.civil(e.enrolledOn)}</Item>
          <Item label={t("endedOn")}>{e.endedOn ? `${date.civil(e.endedOn)}${e.endReason ? ` — ${e.endReason}` : ""}` : "—"}</Item>
          <Item label={t("flags")}>{[e.isRepeating ? t("repeating") : null, e.isTransferIn ? t("transferIn", { school: e.originSchool ?? "—" }) : null].filter(Boolean).join(" · ") || "—"}</Item>
        </dl>
      </section>

      <section aria-labelledby="enr-confirm" className="space-y-2 rounded-lg border p-4">
        <h2 id="enr-confirm" className="text-lg font-semibold">
          {t("confirmation.title")}
        </h2>
        {settings.data ? <p className="text-sm">{t("confirmation.policy", { policy: t(`confirmation.policies.${settings.data.enrollmentConfirmationPolicy}`) })}</p> : null}
        {e.status === "PENDING" ? <Notice kind="info">{t("confirmation.pending")}</Notice> : null}
        {e.confirmedAt ? <p className="text-sm">{t("confirmation.confirmedAt", { date: date.instant(e.confirmedAt) })}</p> : null}
        {e.cancelledAt ? <p className="text-sm">{t("confirmation.cancelledAt", { date: date.instant(e.cancelledAt) })}</p> : null}
        <p className="text-xs text-muted-foreground">{t("confirmation.feesNote")}</p>
      </section>

      <section aria-labelledby="enr-funding" className="space-y-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="enr-funding" className="text-lg font-semibold">
            {t("funding.title")}
          </h2>
          <Can permission="enrollment.funding.update">
            <button type="button" className={buttonClass.secondary} onClick={() => setChangingFunding(true)}>
              {t("funding.change")}
            </button>
          </Can>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Item label={t("funding.type")}>{["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"].includes(e.fundingType) ? tFunding(e.fundingType) : e.fundingType}</Item>
          <Item label={t("funding.reference")}>{e.assignmentReference ?? "—"}</Item>
          <Item label={t("funding.issuedOn")}>{e.assignmentIssuedOn ? date.civil(e.assignmentIssuedOn) : "—"}</Item>
          <Item label={t("funding.funder")}>{e.funderLabel ?? "—"}</Item>
        </dl>
        {e.fundingNotes ? <p className="text-sm text-muted-foreground">{e.fundingNotes}</p> : null}
      </section>

      <CoursesSection enrollment={e} courses={detail.data.courses} onFlash={flash.show} />

      <section aria-labelledby="enr-placements" className="space-y-2">
        <h2 id="enr-placements" className="text-lg font-semibold">
          {t("placements.title")}
        </h2>
        <DataTable caption={t("placements.caption")} columns={placementColumns} rows={placements} getRowId={(p) => p.id} emptyTitle={t("placements.empty")} />
      </section>

      <section aria-labelledby="enr-history" className="space-y-2">
        <h2 id="enr-history" className="text-lg font-semibold">
          {t("history.title")}
        </h2>
        {history.isPending && history.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {history.isError ? <ErrorBlock error={history.error} onRetry={() => void history.refetch()} /> : null}
        {history.data && history.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("history.empty")}</p> : null}
        {history.data && history.data.length > 0 ? (
          <ol className="divide-y rounded-md border text-sm" aria-label={t("history.title")}>
            {[...history.data].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((h) => (
              <HistoryRow key={h.id} entry={h} />
            ))}
          </ol>
        ) : null}
      </section>

      {pending ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t(`reasonTitle.${pending}`)}
          description={t(`reasonDescription.${pending}`)}
          reasonLabel={t("reason")}
          confirmLabel={t(`actions.${pending}`)}
          destructive={pending === "cancel" || pending === "withdraw"}
          isPending={action.isPending}
          error={actionError}
          onConfirm={(reason) => run(pending, reason)}
        />
      ) : null}
      {transferring ? <TransferDialog enrollment={e} onClose={() => setTransferring(false)} onDone={() => flash.show(t("done.transfer"))} /> : null}
      {changingFunding ? <FundingDialog enrollment={e} onClose={() => setChangingFunding(false)} onDone={() => flash.show(t("done.funding"))} /> : null}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function HistoryRow({ entry }: { entry: AcademicHistoryEntryDto }) {
  const t = useTranslations("v2Enrollments.detail.history");
  const date = useDateFormat();
  return (
    <li className="space-y-0.5 p-3">
      <p className="font-medium">
        {t(`kind.${entry.kind}`)} <span className="font-normal text-muted-foreground">· {date.instant(entry.occurredAt)}</span>
      </p>
      {entry.fromValue !== null || entry.toValue !== null ? (
        <p className="text-muted-foreground">
          {summarize(entry.fromValue)} → {summarize(entry.toValue)}
        </p>
      ) : null}
      {entry.reason ? <p>{entry.reason}</p> : null}
    </li>
  );
}

/** Valeur d'historique (JSON libre du serveur) en texte lisible : on n'interprète rien, on montre. */
function summarize(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const first = Object.values(value as Record<string, unknown>).find((v) => typeof v === "string" || typeof v === "number");
    return first !== undefined ? String(first) : "…";
  }
  return "—";
}

// ---------------------------------------------------------------------------
// Transfert et changement de financement
// ---------------------------------------------------------------------------

function TransferDialog({ enrollment, onClose, onDone }: { enrollment: AcademicEnrollmentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Enrollments.detail.transfer");
  const transfer = useTransferEnrollment();
  const [target, setTarget] = useState<SelectOption | null>(null);
  const [effectiveOn, setEffectiveOn] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const useOpts = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: enrollment.academicYearId });

  async function submit() {
    const e: FieldErrors = {};
    if (!target) e.toClassroomId = t("targetRequired");
    else if (target.value === enrollment.classroomId) e.toClassroomId = t("sameClassroom");
    if (reason.trim().length < 5) e.reason = t("reasonTooShort");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      await transfer.mutateAsync({ id: enrollment.id, toClassroomId: target!.value, effectiveOn: effectiveOn || undefined, reason: reason.trim() });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={transfer.isPending} error={transfer.error}>
      <FormField label={t("target")} required error={errors.toClassroomId}>
        {(c) => <SelectAsync {...c} value={target} onChange={setTarget} useOptions={useOpts} ariaLabel={t("target")} placeholder={t("targetPlaceholder")} />}
      </FormField>
      <FormField label={t("effectiveOn")} hint={t("effectiveOnHint")} error={errors.effectiveOn}>
        {(c) => <TextControl {...c} type="date" value={effectiveOn} onChange={setEffectiveOn} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

function FundingDialog({ enrollment, onClose, onDone }: { enrollment: AcademicEnrollmentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Enrollments.detail.fundingDialog");
  const types = useReference("funding-types");
  const stateAssigned = useFeature("academic.state-assigned");
  const change = useChangeEnrollmentFunding();
  const [form, setForm] = useState({ fundingType: enrollment.fundingType, assignmentReference: enrollment.assignmentReference ?? "", assignmentIssuedOn: enrollment.assignmentIssuedOn ?? "", funderLabel: enrollment.funderLabel ?? "", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const def = (types.data ?? []).find((x) => x.code === form.fundingType);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, unknown> = { fundingType: form.fundingType, reason: form.reason.trim() };
    if (form.assignmentReference.trim()) body.assignmentReference = form.assignmentReference.trim();
    if (form.assignmentIssuedOn) body.assignmentIssuedOn = form.assignmentIssuedOn;
    if (form.funderLabel.trim()) body.funderLabel = form.funderLabel.trim();
    const v = validateWith(academicChangeFundingBodySchema, body);
    const local: FieldErrors = v.ok ? {} : v.errors;
    if (def?.requiresReference && !form.assignmentReference.trim()) local.assignmentReference = t("referenceRequired");
    if (def?.requiresFunder && !form.funderLabel.trim()) local.funderLabel = t("funderRequired");
    setErrors(local);
    if (!v.ok || Object.keys(local).length > 0) return;
    try {
      await change.mutateAsync({ id: enrollment.id, body: v.data });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={change.isPending} error={change.error}>
      <FormField label={t("type")} required error={errors.fundingType}>
        {(c) => <NativeSelect {...c} value={form.fundingType} onChange={set("fundingType")} options={(types.data ?? []).filter((x) => x.active && (x.code !== "STATE_ASSIGNED" || stateAssigned.allowed || enrollment.fundingType === "STATE_ASSIGNED")).map((x) => ({ value: x.code, label: x.label }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("reference")} required={def?.requiresReference} error={errors.assignmentReference}>
          {(c) => <TextControl {...c} value={form.assignmentReference} onChange={set("assignmentReference")} maxLength={100} />}
        </FormField>
        <FormField label={t("issuedOn")} error={errors.assignmentIssuedOn}>
          {(c) => <TextControl {...c} type="date" value={form.assignmentIssuedOn} onChange={set("assignmentIssuedOn")} />}
        </FormField>
        <FormField label={t("funder")} required={def?.requiresFunder} error={errors.funderLabel}>
          {(c) => <TextControl {...c} value={form.funderLabel} onChange={set("funderLabel")} maxLength={200} />}
        </FormField>
      </div>
      <FormField label={t("reason")} required error={errors.reason}>
        {(c) => <TextAreaControl {...c} value={form.reason} onChange={set("reason")} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Cours (inscription à la carte, options, rattrapages)
// ---------------------------------------------------------------------------

function CoursesSection({ enrollment, courses, onFlash }: { enrollment: AcademicEnrollmentDto; courses: ReadonlyArray<AcademicEnrollmentCourseDto>; onFlash: (message: string) => void }) {
  const t = useTranslations("v2Enrollments.detail.courses");
  const tStatus = useTranslations("v2Enrollments.courseStatus");
  const feature = useFeature("academic.a-la-carte");
  const list = useEnrollmentCourses(enrollment.id);
  const confirm = useConfirmEnrollmentCourse();
  const [cancelling, setCancelling] = useState<AcademicEnrollmentCourseDto | null>(null);
  const [adding, setAdding] = useState(false);
  const cancel = useCancelEnrollmentCourse();
  const [error, setError] = useState<unknown>(null);
  const rows = list.data ?? courses;
  const date = useDateFormat();

  // Une inscription par classe (sans sélection de cours) n'a pas de section « cours » : seulement à la carte / options.
  if (enrollment.mode !== "A_LA_CARTE" && rows.length === 0) return null;

  const columns: DataTableColumn<AcademicEnrollmentCourseDto>[] = [
    { id: "course", header: t("columns.course"), rowHeader: true, cell: (c) => <span className="font-mono text-xs">{c.curriculumNodeId.slice(0, 8)}…</span> },
    { id: "source", header: t("columns.source"), cell: (c) => t(`source.${c.source}`), className: "hidden sm:table-cell" },
    { id: "requested", header: t("columns.requested"), cell: (c) => date.instant(c.requestedAt), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (c) => <StatusBadge label={tStatus(c.status)} tone={toneOf(c.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (c) => (
        <Can permission="enrollment.course.manage">
          <span className="flex justify-end gap-1">
            {c.status === "PENDING" ? (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={confirm.isPending}
                onClick={() => {
                  setError(null);
                  void confirm.mutateAsync({ id: c.id }).then(() => onFlash(t("confirmed"))).catch(setError);
                }}
              >
                {t("confirm")}
              </button>
            ) : null}
            {c.status === "PENDING" || c.status === "CONFIRMED" ? (
              <button type="button" className={buttonClass.ghost} onClick={() => setCancelling(c)}>
                {t("cancel")}
              </button>
            ) : null}
          </span>
        </Can>
      ),
    },
  ];

  return (
    <section aria-labelledby="enr-courses" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="enr-courses" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="enrollment.course.manage">
          {feature.allowed ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setAdding(true)}>
              {t("add")}
            </button>
          ) : null}
        </Can>
      </div>
      {error ? <ErrorBlock error={error} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={rows} getRowId={(c) => c.id} isLoading={list.isFetching} emptyTitle={t("empty")} />
      {cancelling ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setCancelling(null)}
          title={t("cancelTitle")}
          reasonLabel={t("reason")}
          confirmLabel={t("cancel")}
          destructive
          isPending={cancel.isPending}
          error={cancel.error}
          onConfirm={async (reason) => {
            try {
              await cancel.mutateAsync({ id: cancelling.id, reason });
              onFlash(t("cancelled"));
              setCancelling(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {adding ? <AddCourseDialog enrollment={enrollment} onClose={() => setAdding(false)} onDone={() => onFlash(t("added"))} /> : null}
    </section>
  );
}

function AddCourseDialog({ enrollment, onClose, onDone }: { enrollment: AcademicEnrollmentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Enrollments.detail.courses");
  const catalog = useCatalog({ studentId: enrollment.studentId });
  const add = useAddEnrollmentCourse();
  const [offeringId, setOfferingId] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("addTitle")}
      description={t("addDescription")}
      submitLabel={t("add")}
      isPending={add.isPending}
      error={add.error}
      wide
      onSubmit={() => {
        if (!offeringId) return setError(t("offeringRequired"));
        setError(null);
        void add.mutateAsync({ enrollmentId: enrollment.id, offeringId }).then(() => { onDone(); onClose(); }).catch(() => undefined);
      }}
    >
      {catalog.isPending && catalog.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {catalog.isError ? <ErrorBlock error={catalog.error} /> : null}
      {catalog.data && catalog.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("catalogEmpty")}</p> : null}
      <fieldset className="max-h-80 space-y-2 overflow-y-auto">
        <legend className="sr-only">{t("addTitle")}</legend>
        {(catalog.data ?? []).map((item) => (
          <CatalogChoice key={item.offering.id} item={item} selected={offeringId === item.offering.id} onSelect={() => setOfferingId(item.offering.id)} />
        ))}
      </fieldset>
      {error ? <p role="alert" className="text-xs font-medium text-destructive">{error}</p> : null}
    </FormDialog>
  );
}

function CatalogChoice({ item, selected, onSelect }: { item: AcademicCatalogItemDto; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("v2Enrollments.detail.courses");
  // L'éligibilité (prérequis, places, fenêtre) est évaluée par le serveur : on affiche son verdict et ses motifs.
  const blocked = item.eligibility ? !item.eligibility.eligible : false;
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${blocked ? "opacity-60" : ""} ${selected ? "border-primary bg-primary/5" : ""}`}>
      <input type="radio" name="offering" checked={selected} disabled={blocked} onChange={onSelect} className="mt-1 h-4 w-4 accent-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {item.node.label} <span className="font-normal text-muted-foreground">({item.node.code})</span>
        </span>
        <span className="block text-xs text-muted-foreground">
          {item.classroomName}
          {item.remainingPlaces !== null ? ` · ${t("remaining", { count: item.remainingPlaces })}` : ""}
          {item.node.credits ? ` · ${t("credits", { value: item.node.credits.replace(".", ",") })}` : ""}
        </span>
        {blocked && item.eligibility?.message ? <span className="block text-xs font-medium text-destructive">{item.eligibility.message}</span> : null}
        {item.eligibility?.warnings.map((w) => (
          <span key={w.code} className="block text-xs text-amber-700">
            {w.message}
          </span>
        ))}
      </span>
    </label>
  );
}
