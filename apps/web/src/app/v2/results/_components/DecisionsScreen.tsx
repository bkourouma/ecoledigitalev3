"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { resultsAppreciationBodySchema, resultsDecisionConfirmBodySchema, resultsDeliberationCreateBodySchema, type resultsDecisionDtoSchema, type ResultsStateDto } from "@ecoledigitale/contracts/v2/results";
import type { z } from "zod";
import { useFeature, usePermission } from "@/platform/access";
import {
  useAppreciations,
  useClassMatrix,
  useConfirmDecision,
  useCreateDeliberation,
  useDecisions,
  useDeliberations,
  useUpdateDeliberation,
  useWriteAppreciation,
  type ClassMatrix,
} from "@/platform/v2/results";
import { useStaffOptions } from "@/platform/v2/lookups";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOfStatus, useStudentNames } from "../../assessments/_components/shared";
import { ClassPeriodSelector, DECISION_RULE, useClassPeriodSelection, useCodeLabels, useRuleCodeOptions } from "./shared";

type Tab = "decisions" | "deliberations" | "appreciations";
type Decision = z.infer<typeof resultsDecisionDtoSchema>;

export function DecisionsScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Results.decisions");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const matrix = useClassMatrix(sel.classroomId || null, sel.periodId || null);
  const [tab, setTab] = useState<Tab>("decisions");
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  const tabs: Tab[] = ["decisions", "deliberations", "appreciations"];
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      {!hasSelection ? (
        <Notice kind="info">{t("choose")}</Notice>
      ) : (
        <QueryBoundary query={matrix}>
          {matrix.data ? (
            <div className="space-y-4">
              <div role="tablist" aria-label={t("tabs")} className="flex gap-1 overflow-x-auto border-b">
                {tabs.map((id) => (
                  <button
                    key={id}
                    id={`tab-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    onClick={() => setTab(id)}
                    className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {t(`tab.${id}`)}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                {tab === "decisions" ? <DecisionsTab matrix={matrix.data} classroomId={sel.classroomId} /> : null}
                {tab === "deliberations" ? <DeliberationsTab state={matrix.data.state} /> : null}
                {tab === "appreciations" ? <AppreciationsTab matrix={matrix.data} classroomId={sel.classroomId} /> : null}
              </div>
            </div>
          ) : null}
        </QueryBoundary>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------

function DecisionsTab({ matrix, classroomId }: { matrix: ClassMatrix; classroomId: string }) {
  const t = useTranslations("v2Results.decisions");
  const tStatus = useTranslations("v2Results.decisionStatus");
  const stateId = matrix.state.id;
  const decisions = useDecisions(stateId);
  const { names } = useStudentNames(classroomId);
  const label = useCodeLabels(matrix.state.ruleVersionId);
  const canRecord = usePermission("decision.record");
  const canApprove = usePermission("decision.approve");
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const flash = useFlash();
  const studentOfEnrollment = useMemo(() => new Map(matrix.rows.map((r) => [r.header.enrollmentId, r.header.studentId] as const)), [matrix.rows]);
  const nameOf = (enrollmentId: string) => {
    const studentId = studentOfEnrollment.get(enrollmentId);
    return (studentId && names.get(studentId)?.name) || t("studentFallback", { id: enrollmentId.slice(0, 4) });
  };
  const items = decisions.data ?? [];
  return (
    <div className="space-y-3">
      {flash.node}
      <QueryBoundary query={decisions} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.kind")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.proposed")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.final")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const name = nameOf(d.enrollmentId);
                return (
                  <tr key={d.id} className="border-t align-top">
                    <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">{name}</th>
                    <td className="hidden px-3 py-2 sm:table-cell">{d.kind}</td>
                    <td className="px-3 py-2">{label(d.proposedCode, DECISION_RULE)}</td>
                    <td className="px-3 py-2">
                      {d.finalCode ? label(d.finalCode, DECISION_RULE) : "—"}
                      {d.justification ? <span className="mt-1 block max-w-[16rem] text-xs text-muted-foreground">{d.justification}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={tStatus(d.status)} tone={toneOfStatus(d.status)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {d.status === "PROPOSED" && (canRecord.allowed || canApprove.allowed) ? (
                        <button type="button" className={buttonClass.secondary} onClick={() => setConfirming(d)} aria-label={t("confirmOf", { name })}>
                          {t("confirm")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
      {confirming ? (
        <ConfirmDialog
          decision={confirming}
          name={nameOf(confirming.enrollmentId)}
          state={matrix.state}
          canChange={canApprove.allowed}
          onClose={() => setConfirming(null)}
          onDone={() => flash.show(t("confirmed"))}
        />
      ) : null}
    </div>
  );
}

function ConfirmDialog({ decision, name, state, canChange, onClose, onDone }: { decision: Decision; name: string; state: ResultsStateDto; canChange: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.decisions");
  const confirm = useConfirmDecision();
  const label = useCodeLabels(state.ruleVersionId);
  const options = useRuleCodeOptions(state.ruleVersionId, DECISION_RULE);
  const deliberations = useDeliberations(state.id);
  const [change, setChange] = useState(false);
  const [finalCode, setFinalCode] = useState("");
  const [justification, setJustification] = useState("");
  const [deliberationId, setDeliberationId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const body = compact({ finalCode: change ? finalCode : "", justification: change ? justification : "", deliberationId });
    const v = validateWith(resultsDecisionConfirmBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    if (change && !finalCode) return setErrors({ finalCode: t("finalCodeRequired") });
    if (change && finalCode === decision.proposedCode) return setErrors({ finalCode: t("sameAsProposal") });
    if (change && justification.trim().length < 20) return setErrors({ justification: t("justificationTooShort") });
    setErrors({});
    try {
      await confirm.mutateAsync({ id: decision.id, ...v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("confirmTitle", { name })} description={t("confirmDescription")} submitLabel={t("confirmSubmit")} onSubmit={() => void submit()} isPending={confirm.isPending} error={Object.keys(errors).length === 0 ? confirm.error : null}>
      <p className="text-sm">{t("proposal", { value: label(decision.proposedCode, DECISION_RULE) })}</p>
      {canChange ? (
        <label className="flex min-h-[2.75rem] items-center gap-2 text-sm">
          <input type="checkbox" checked={change} onChange={(e) => setChange(e.target.checked)} className="h-4 w-4 accent-primary" />
          {t("changeDecision")}
        </label>
      ) : null}
      {change ? (
        <>
          <FormField label={t("finalCode")} required error={errors.finalCode}>
            {(c) =>
              options.length > 0 ? (
                <NativeSelect {...c} value={finalCode} onChange={setFinalCode} placeholder={t("chooseDecision")} options={options} />
              ) : (
                <TextControl {...c} value={finalCode} onChange={(v) => setFinalCode(v.toUpperCase())} maxLength={41} />
              )
            }
          </FormField>
          <FormField label={t("justification")} required error={errors.justification} hint={t("justificationHint")}>
            {(c) => <TextAreaControl {...c} value={justification} onChange={setJustification} maxLength={1000} />}
          </FormField>
        </>
      ) : null}
      {(deliberations.data ?? []).length > 0 ? (
        <FormField label={t("deliberation")} hint={t("deliberationHint")} error={errors.deliberationId}>
          {(c) => <NativeSelect {...c} value={deliberationId} onChange={setDeliberationId} placeholder={t("noDeliberation")} options={(deliberations.data ?? []).map((d) => ({ value: d.id, label: `${t(`kind.${d.kind}`)}${d.heldOn ? ` — ${d.heldOn}` : ""}` }))} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Délibérations
// ---------------------------------------------------------------------------

function participantsOf(value: unknown): Array<{ staffId: string; role: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is { staffId: string; role: string } => Boolean(p) && typeof p === "object" && typeof (p as { staffId?: unknown }).staffId === "string");
}

function useParticipantOptions(search: string, enabled: boolean) {
  return useStaffOptions(search, enabled, { status: "ACTIVE" });
}

function DeliberationsTab({ state }: { state: ResultsStateDto }) {
  const t = useTranslations("v2Results.deliberations");
  const tStatus = useTranslations("v2Results.deliberationStatus");
  const feature = useFeature("results.deliberation");
  const canRecord = usePermission("decision.record");
  const list = useDeliberations(state.id, feature.allowed);
  const update = useUpdateDeliberation();
  const date = useDateFormat();
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const flash = useFlash();
  if (feature.isLoading) return <LoadingBlock />;
  if (!feature.allowed) return <FeatureNotice />;
  const items = list.data ?? [];

  async function setStatus(id: string, status: "HELD" | "SIGNED" | "CANCELLED") {
    setActionError(null);
    try {
      await update.mutateAsync({ id, patch: { status } });
      flash.show(t(`done.${status}`));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div className="space-y-3">
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {canRecord.allowed ? (
        <div>
          <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
            {t("create")}
          </button>
        </div>
      ) : null}
      <QueryBoundary query={list} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {items.map((d) => {
            const participants = participantsOf(d.participants);
            return (
              <li key={d.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {t(`kind.${d.kind}`)}
                    {d.heldOn ? ` — ${date.civil(d.heldOn)}` : ""}
                  </p>
                  <StatusBadge label={tStatus(d.status)} tone={toneOfStatus(d.status === "SIGNED" ? "CLOSED" : d.status)} />
                </div>
                <p className="text-muted-foreground">{participants.length > 0 ? t("participants", { count: participants.length }) : t("noParticipants")}</p>
                {participants.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {participants.map((p) => (
                      <li key={p.staffId}>
                        {p.role} · <span className="font-mono">{p.staffId.slice(0, 8)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canRecord.allowed && (d.status === "PLANNED" || d.status === "HELD") ? (
                  <div className="flex flex-wrap gap-2">
                    {d.status === "PLANNED" ? (
                      <button type="button" className={buttonClass.secondary} onClick={() => void setStatus(d.id, "HELD")} disabled={update.isPending}>
                        {t("actions.HELD")}
                      </button>
                    ) : (
                      <button type="button" className={buttonClass.secondary} onClick={() => void setStatus(d.id, "SIGNED")} disabled={update.isPending}>
                        {t("actions.SIGNED")}
                      </button>
                    )}
                    <button type="button" className={buttonClass.ghost} onClick={() => void setStatus(d.id, "CANCELLED")} disabled={update.isPending}>
                      {t("actions.CANCELLED")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </QueryBoundary>
      {creating ? <CreateDeliberationDialog stateId={state.id} onClose={() => setCreating(false)} onDone={() => flash.show(t("created"))} /> : null}
    </div>
  );
}

function CreateDeliberationDialog({ stateId, onClose, onDone }: { stateId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.deliberations");
  const create = useCreateDeliberation();
  const [kind, setKind] = useState<"COUNCIL" | "JURY">("COUNCIL");
  const [heldOn, setHeldOn] = useState("");
  const [rows, setRows] = useState<Array<{ key: number; staff: SelectOption | null; role: string }>>([{ key: 1, staff: null, role: "" }]);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const participants = rows.filter((r) => r.staff).map((r) => ({ staffId: r.staff!.value, role: r.role }));
    const body = { stateId, kind, ...compact({ heldOn }), ...(participants.length > 0 ? { participants } : {}) };
    const v = validateWith(resultsDeliberationCreateBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await create.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={t("createTitle")} description={t("createDescription")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("kindLabel")} required error={errors.kind}>
          {(c) => (
            <NativeSelect
              {...c}
              value={kind}
              onChange={(v) => setKind(v as "COUNCIL" | "JURY")}
              options={[
                { value: "COUNCIL", label: t("kind.COUNCIL") },
                { value: "JURY", label: t("kind.JURY") },
              ]}
            />
          )}
        </FormField>
        <FormField label={t("heldOn")} error={errors.heldOn} hint={t("heldOnHint")}>
          {(c) => <TextControl {...c} type="date" value={heldOn} onChange={setHeldOn} />}
        </FormField>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("participantsLegend")}</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
            <FormField label={t("participant", { n: i + 1 })} error={errors[`participants.${i}.staffId`]}>
              {(c) => <SelectAsync {...c} value={r.staff} onChange={(o) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, staff: o } : x)))} useOptions={useParticipantOptions} placeholder={t("participantPlaceholder")} />}
            </FormField>
            <FormField label={t("role", { n: i + 1 })} error={errors[`participants.${i}.role`]}>
              {(c) => <TextControl {...c} value={r.role} onChange={(v) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, role: v } : x)))} maxLength={60} />}
            </FormField>
            <div className="flex items-end">
              <button type="button" className={buttonClass.ghost} onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={t("removeParticipant", { n: i + 1 })}>
                {t("remove")}
              </button>
            </div>
          </div>
        ))}
        <button type="button" className={buttonClass.secondary} onClick={() => setRows((l) => [...l, { key: Math.max(0, ...l.map((x) => x.key)) + 1, staff: null, role: "" }])}>
          {t("addParticipant")}
        </button>
      </fieldset>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Appréciations
// ---------------------------------------------------------------------------

function AppreciationsTab({ matrix, classroomId }: { matrix: ClassMatrix; classroomId: string }) {
  const t = useTranslations("v2Results.appreciations");
  const tRole = useTranslations("v2Results.authorRole");
  const list = useAppreciations(matrix.state.id);
  const write = useWriteAppreciation();
  const canWrite = usePermission("appreciation.write");
  const { names } = useStudentNames(classroomId);
  const date = useDateFormat();
  const flash = useFlash();
  const [enrollmentId, setEnrollmentId] = useState("");
  const [role, setRole] = useState<"TEACHER" | "COUNCIL" | "DIRECTOR">("COUNCIL");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const nameOf = (enrollment: string) => {
    const row = matrix.rows.find((r) => r.header.enrollmentId === enrollment);
    return (row && names.get(row.header.studentId)?.name) || t("studentFallback", { id: enrollment.slice(0, 4) });
  };
  const students = matrix.rows.map((r) => ({ value: r.header.enrollmentId, label: names.get(r.header.studentId)?.name ?? t("studentFallback", { id: r.header.enrollmentId.slice(0, 4) }) })).sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
  const items = list.data ?? [];

  async function submit() {
    const payload = { stateId: matrix.state.id, enrollmentId, authorRole: role, body };
    const v = validateWith(resultsAppreciationBodySchema, payload);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await write.mutateAsync({ stateId: v.data.stateId, enrollmentId: v.data.enrollmentId, authorRole: v.data.authorRole, body: v.data.body });
      flash.show(t("saved"));
      setBody("");
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <div className="space-y-4">
      {flash.node}
      {canWrite.allowed ? (
        <form
          noValidate
          aria-label={t("formLabel")}
          className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("student")} required error={errors.enrollmentId}>
              {(c) => <NativeSelect {...c} value={enrollmentId} onChange={setEnrollmentId} placeholder={t("chooseStudent")} options={students} />}
            </FormField>
            <FormField label={t("role")} required error={errors.authorRole}>
              {(c) => <NativeSelect {...c} value={role} onChange={(v) => setRole(v as typeof role)} options={(["TEACHER", "COUNCIL", "DIRECTOR"] as const).map((r) => ({ value: r, label: tRole(r) }))} />}
            </FormField>
          </div>
          <FormField label={t("body")} required error={errors.body ?? errors.stateId} hint={t("bodyHint")}>
            {(c) => <TextAreaControl {...c} value={body} onChange={setBody} maxLength={1000} />}
          </FormField>
          {write.error && Object.keys(errors).length === 0 ? <ErrorBlock error={write.error} /> : null}
          <button type="submit" className={buttonClass.primary} disabled={write.isPending}>
            {t("submit")}
          </button>
        </form>
      ) : null}
      <QueryBoundary query={list} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} />}>
        <ul className="space-y-2" aria-label={t("listLabel")}>
          {items.map((a) => (
            <li key={a.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
              <p className="font-medium">
                {nameOf(a.enrollmentId)} · {tRole(a.authorRole)}
              </p>
              <p>{a.body}</p>
              <p className="text-xs text-muted-foreground">{t("updatedAt", { date: date.instant(a.updatedAt) })}</p>
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </div>
  );
}
