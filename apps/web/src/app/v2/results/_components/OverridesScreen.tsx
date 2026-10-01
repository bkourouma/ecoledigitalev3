"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RESULTS_LEVELS, resultsOverrideCreateBodySchema, type resultsOverrideDtoSchema } from "@ecoledigitale/contracts/v2/results";
import type { z } from "zod";
import { usePermission } from "@/platform/access";
import { useApproveOverride, useClassMatrix, useOverrides, useRejectOverride, useRequestOverride, useRevokeOverride, type ClassMatrix } from "@/platform/v2/results";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { NodePicker, toneOfStatus, useStudentNames } from "../../assessments/_components/shared";
import { ClassPeriodSelector, useClassPeriodSelection } from "./shared";

type Override = z.infer<typeof resultsOverrideDtoSchema>;
const STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "REVOKED"] as const;

export function OverridesScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Results.overrides");
  const tStatus = useTranslations("v2Results.overrideStatus");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const matrix = useClassMatrix(sel.classroomId || null, sel.periodId || null);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const canRequest = usePermission("result.override.request");
  const stateId = matrix.data?.state.id;
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  const list = useOverrides({ stateId, status }, { enabled: !hasSelection || stateId !== undefined });
  const { names } = useStudentNames(sel.classroomId || null);
  const flash = useFlash();
  const items = list.data ?? [];
  const nameOf = useMemo(() => {
    const byEnrollment = new Map((matrix.data?.rows ?? []).map((r) => [r.header.enrollmentId, names.get(r.header.studentId)?.name] as const));
    return (enrollmentId: string) => byEnrollment.get(enrollmentId) ?? t("studentFallback", { id: enrollmentId.slice(0, 4) });
  }, [matrix.data, names, t]);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canRequest.allowed ? (
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)} disabled={!matrix.data}>
              {t("create")}
            </button>
          ) : null
        }
      />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      <form className="mb-4 max-w-xs" onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </form>
      {!hasSelection ? <Notice kind="info">{t("selectionHint")}</Notice> : null}
      <div className="space-y-3">
        {flash.node}
        <QueryBoundary query={list} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
          <ul className="space-y-3" aria-label={t("listLabel")}>
            {items.map((o) => (
              <li key={o.id}>
                <OverrideCard override={o} name={nameOf(o.enrollmentId)} onMessage={flash.show} />
              </li>
            ))}
          </ul>
        </QueryBoundary>
      </div>
      {creating && matrix.data ? <CreateOverrideDialog matrix={matrix.data} classroomId={sel.classroomId} onClose={() => setCreating(false)} onDone={() => flash.show(t("created"))} /> : null}
    </div>
  );
}

function OverrideCard({ override: o, name, onMessage }: { override: Override; name: string; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Results.overrides");
  const tStatus = useTranslations("v2Results.overrideStatus");
  const tLevel = useTranslations("v2Results.levels");
  const date = useDateFormat();
  const canApprove = usePermission("result.override.approve");
  const approve = useApproveOverride();
  const reject = useRejectOverride();
  const revoke = useRevokeOverride();
  const [dialog, setDialog] = useState<"approve" | "reject" | "revoke" | null>(null);

  const valueText = o.kind === "VALUE" ? (o.overrideValue ?? "—").replace(".", ",") : o.overrideFlag ? t("flagTrue") : t("flagFalse");
  const originalText = o.kind === "VALUE" ? (o.originalValue ?? "—").replace(".", ",") : o.originalValue === null ? "—" : o.originalValue;

  return (
    <article className="space-y-2 rounded-md border p-3 text-sm" aria-label={t("cardLabel", { name })}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {name} · <span className="font-mono text-xs">{o.ruleKey}</span>
        </h3>
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tLevel(o.level)} tone="neutral" />
          <StatusBadge label={tStatus(o.status)} tone={toneOfStatus(o.status)} />
          {o.fourEyesWaived ? <StatusBadge label={t("waived")} tone="info" /> : null}
        </span>
      </header>
      <p className="text-base font-medium tabular-nums">
        {t("fromTo", { from: originalText, to: valueText })}
      </p>
      <p>{o.justification}</p>
      <p className="text-muted-foreground">{t("requestedBy", { name: o.requestedByName, date: date.instant(o.requestedAt) })}</p>
      {o.decidedByName ? (
        <p className="text-muted-foreground">
          {t("decidedBy", { name: o.decidedByName, date: date.instant(o.decidedAt) })}
          {o.decisionComment ? ` — ${o.decisionComment}` : ""}
        </p>
      ) : null}
      {o.revokedReason ? <p className="text-muted-foreground">{t("revokedBecause", { reason: o.revokedReason })}</p> : null}
      {canApprove.allowed && (o.status === "REQUESTED" || o.status === "APPROVED") ? (
        <div className="flex flex-wrap gap-2">
          {o.status === "REQUESTED" ? (
            <>
              <button type="button" className={buttonClass.primary} onClick={() => setDialog("approve")} aria-label={t("approveOf", { name })}>
                {t("approve")}
              </button>
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("reject")} aria-label={t("rejectOf", { name })}>
                {t("reject")}
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass.danger} onClick={() => setDialog("revoke")} aria-label={t("revokeOf", { name })}>
              {t("revoke")}
            </button>
          )}
        </div>
      ) : null}
      {dialog === "approve" ? (
        <ReasonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          title={t("approveTitle", { name })}
          description={t("approveDescription")}
          reasonLabel={t("commentOptional")}
          reasonRequired={false}
          maxLength={1000}
          confirmLabel={t("approve")}
          isPending={approve.isPending}
          error={approve.error}
          onConfirm={async (comment) => {
            try {
              await approve.mutateAsync({ id: o.id, comment: comment || undefined });
              onMessage(t("approved"));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {dialog === "reject" ? (
        <ReasonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          title={t("rejectTitle", { name })}
          reasonLabel={t("rejectReason")}
          maxLength={1000}
          confirmLabel={t("reject")}
          destructive
          isPending={reject.isPending}
          error={reject.error}
          onConfirm={async (comment) => {
            try {
              await reject.mutateAsync({ id: o.id, comment });
              onMessage(t("rejected"));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {dialog === "revoke" ? (
        <ReasonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          title={t("revokeTitle", { name })}
          description={t("revokeDescription")}
          reasonLabel={t("revokeReason")}
          minLength={10}
          maxLength={1000}
          confirmLabel={t("revoke")}
          destructive
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={async (reason) => {
            try {
              await revoke.mutateAsync({ id: o.id, reason });
              onMessage(t("revoked"));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </article>
  );
}

function CreateOverrideDialog({ matrix, classroomId, onClose, onDone }: { matrix: ClassMatrix; classroomId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.overrides");
  const tLevel = useTranslations("v2Results.levels");
  const request = useRequestOverride();
  const { names } = useStudentNames(classroomId);
  const [form, setForm] = useState({ enrollmentId: "", level: "UE", curriculumNodeId: "", ruleKey: "", kind: "VALUE", value: "", flag: "", justification: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const students = matrix.rows
    .map((r) => ({ value: r.header.enrollmentId, label: names.get(r.header.studentId)?.name ?? t("studentFallback", { id: r.header.enrollmentId.slice(0, 4) }) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));

  async function submit() {
    const body = {
      stateId: matrix.state.id,
      enrollmentId: form.enrollmentId,
      level: form.level,
      ...compact({ curriculumNodeId: form.curriculumNodeId }),
      ruleKey: form.ruleKey.trim(),
      kind: form.kind,
      ...(form.kind === "VALUE" ? compact({ value: form.value.trim().replace(",", ".") }) : form.flag ? { flag: form.flag === "true" } : {}),
      justification: form.justification,
    };
    const v = validateWith(resultsOverrideCreateBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await request.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={t("createTitle")} description={t("createDescription")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={request.isPending} error={Object.keys(errors).length === 0 ? request.error : null}>
      <FormField label={t("student")} required error={errors.enrollmentId}>
        {(c) => <NativeSelect {...c} value={form.enrollmentId} onChange={set("enrollmentId")} placeholder={t("chooseStudent")} options={students} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("level")} required error={errors.level}>
          {(c) => <NativeSelect {...c} value={form.level} onChange={set("level")} options={RESULTS_LEVELS.map((l) => ({ value: l, label: tLevel(l) }))} />}
        </FormField>
        <FormField label={t("node")} error={errors.curriculumNodeId} hint={t("nodeHint")}>
          {(c) => <NodePicker {...c} classroomId={classroomId} value={form.curriculumNodeId} onChange={set("curriculumNodeId")} />}
        </FormField>
      </div>
      <FormField label={t("ruleKey")} required error={errors.ruleKey} hint={t("ruleKeyHint")}>
        {(c) => <TextControl {...c} value={form.ruleKey} onChange={set("ruleKey")} maxLength={64} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("kind")} required error={errors.kind}>
          {(c) => (
            <NativeSelect
              {...c}
              value={form.kind}
              onChange={set("kind")}
              options={[
                { value: "VALUE", label: t("kinds.VALUE") },
                { value: "VALIDATION", label: t("kinds.VALIDATION") },
              ]}
            />
          )}
        </FormField>
        {form.kind === "VALUE" ? (
          <FormField label={t("value")} required error={errors.value} hint={t("valueHint")}>
            {(c) => <TextControl {...c} value={form.value} onChange={set("value")} inputMode="decimal" />}
          </FormField>
        ) : (
          <FormField label={t("flag")} required error={errors.flag}>
            {(c) => (
              <NativeSelect
                {...c}
                value={form.flag}
                onChange={set("flag")}
                placeholder={t("chooseFlag")}
                options={[
                  { value: "true", label: t("flagTrue") },
                  { value: "false", label: t("flagFalse") },
                ]}
              />
            )}
          </FormField>
        )}
      </div>
      <FormField label={t("justification")} required error={errors.justification} hint={t("justificationHint")}>
        {(c) => <TextAreaControl {...c} value={form.justification} onChange={set("justification")} maxLength={1000} />}
      </FormField>
      <Notice kind="info">{t("fourEyes")}</Notice>
      {request.error && Object.keys(errors).length > 0 ? <ErrorBlock error={request.error} /> : null}
    </FormDialog>
  );
}
