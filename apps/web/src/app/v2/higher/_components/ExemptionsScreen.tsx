"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { HigherExemptionDto } from "@ecoledigitale/contracts/v2/higher";
import { HIGHER_EXEMPTION_CREDIT_POLICIES, higherGrantExemptionBodySchema } from "@ecoledigitale/contracts/v2/higher";
import { useFeature, usePermission } from "@/platform/access";
import { useClassroomNodes, useEnrollments, useReference, useYearPeriods } from "@/platform/v2/academic";
import { useExemptions, useExemptionSettings, useGrantExemption, useRevokeExemption, useSetExemptionPolicy, type ExemptionCreditPolicy } from "@/platform/v2/higher-annual-exemptions";
import { useStudentOptions } from "@/platform/v2/lookups";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { StudentName, shortId } from "./shared";

/**
 * Décision O-14 — dispense d'UE manuelle avec motif (direction). Liste des dispenses (accordées / révoquées), octroi motivé,
 * révocation motivée, et paramètre d'établissement qui dit si une dispense inscrit les crédits de l'UE au registre. Aucune
 * règle ici : le serveur applique la politique et refuse ce qui est invalide.
 */
export function ExemptionsScreen() {
  const t = useTranslations("v2HigherExemptions");
  const tErrors = useTranslations("errors");
  const read = usePermission("higher.exemption.read");
  const feature = useFeature("higher.diplomas");
  const body = (() => {
    if (read.isLoading || feature.isLoading) return <LoadingBlock />;
    if (!read.allowed) return <Notice kind="warning">{tErrors("forbidden")}</Notice>;
    if (!feature.allowed && !feature.isUnavailable) return <FeatureNotice>{t("featureOff")}</FeatureNotice>;
    return <ExemptionsContent />;
  })();
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {body}
    </div>
  );
}

function ExemptionsContent() {
  const t = useTranslations("v2HigherExemptions");
  const date = useDateFormat();
  const flash = useFlash();
  const [status, setStatus] = useState<"" | "ACTIVE" | "REVOKED">("ACTIVE");
  const list = useExemptions(status ? { status } : {});
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<HigherExemptionDto | null>(null);
  const revoke = useRevokeExemption();

  const columns: DataTableColumn<HigherExemptionDto>[] = [
    { id: "student", header: t("columns.student"), rowHeader: true, cell: (e) => <StudentName studentId={e.studentId} /> },
    { id: "ue", header: t("columns.ue"), cell: (e) => (e.ueCode ? `${e.ueCode} — ${e.ueLabel ?? ""}` : shortId(e.ueNodeId)) },
    { id: "credits", header: t("columns.credits"), cell: (e) => (e.creditPolicy === "GRANT_CREDITS" ? t("creditsGranted", { value: e.credits }) : t("creditsNone")), className: "hidden sm:table-cell" },
    { id: "reason", header: t("columns.reason"), cell: (e) => <span className="line-clamp-2">{e.reason}{e.status === "REVOKED" && e.revokeReason ? ` — ${t("revokedBecause", { reason: e.revokeReason })}` : ""}</span>, className: "hidden md:table-cell" },
    { id: "date", header: t("columns.date"), cell: (e) => date.instant(e.grantedAt), className: "hidden lg:table-cell" },
    { id: "status", header: t("columns.status"), cell: (e) => <StatusBadge label={t(`status.${e.status}`)} tone={e.status === "ACTIVE" ? "success" : "neutral"} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (e) =>
        e.status === "ACTIVE" ? (
          <Can permission="higher.exemption.grant">
            <button type="button" className={buttonClass.ghost} onClick={() => setRevoking(e)} aria-label={t("revokeFor", { name: e.ueCode ?? shortId(e.ueNodeId) })}>
              {t("revoke")}
            </button>
          </Can>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PolicyCard />
      {flash.node}
      <section aria-labelledby="exemptions-list" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="exemptions-list" className="text-lg font-semibold">
            {t("listTitle")}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t("filter")} className="w-44">
              {(c) => (
                <NativeSelect
                  {...c}
                  value={status}
                  onChange={(v) => setStatus(v as "" | "ACTIVE" | "REVOKED")}
                  options={[
                    { value: "", label: t("status.ALL") },
                    { value: "ACTIVE", label: t("status.ACTIVE") },
                    { value: "REVOKED", label: t("status.REVOKED") },
                  ]}
                />
              )}
            </FormField>
            <Can permission="higher.exemption.grant">
              <button type="button" className={buttonClass.primary} onClick={() => setGranting(true)}>
                {t("grant")}
              </button>
            </Can>
          </div>
        </div>
        <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(e) => e.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} />
      </section>
      {granting ? <GrantDialog onClose={() => setGranting(false)} onDone={() => flash.show(t("granted"))} /> : null}
      {revoking ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={t("revokeTitle")}
          description={t("revokeDescription")}
          reasonLabel={t("reasonLabel")}
          confirmLabel={t("revoke")}
          destructive
          minLength={10}
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={async (reason) => {
            try {
              await revoke.mutateAsync({ id: revoking.id, reason });
              flash.show(t("revoked"));
              setRevoking(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** Paramètre d'établissement : une dispense inscrit-elle les crédits de l'UE au registre ? (modifiable avec `higher.settings.manage`). */
function PolicyCard() {
  const t = useTranslations("v2HigherExemptions.policy");
  const manage = usePermission("higher.settings.manage");
  const settings = useExemptionSettings(manage.allowed);
  const set = useSetExemptionPolicy();
  const current = settings.data?.exemptionCreditPolicy;
  return (
    <section aria-labelledby="exemption-policy" className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 id="exemption-policy" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {manage.allowed ? (
        <>
          {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
          <FormField label={t("label")} hint={current ? t(`hint.${current}`) : undefined} className="max-w-xl">
            {(c) => (
              <NativeSelect
                {...c}
                value={current ?? ""}
                disabled={!settings.data || set.isPending}
                onChange={(v) => void set.mutateAsync({ exemptionCreditPolicy: v as ExemptionCreditPolicy }).catch(() => undefined)}
                options={HIGHER_EXEMPTION_CREDIT_POLICIES.map((p) => ({ value: p, label: t(`options.${p}`) }))}
              />
            )}
          </FormField>
          {set.error ? <ErrorBlock error={set.error} /> : null}
          <p className="text-xs text-muted-foreground">{t("frozen")}</p>
        </>
      ) : null}
    </section>
  );
}

function GrantDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2HigherExemptions.dialog");
  const grant = useGrantExemption();
  const [student, setStudent] = useState<SelectOption | null>(null);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [ueNodeId, setUeNodeId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const enrollments = useEnrollments({ studentId: student?.value, status: "ACTIVE", pageSize: 20 });
  const mine = student ? (enrollments.data?.items ?? []).filter((e) => e.studentId === student.value) : [];
  const enrollment = mine.find((e) => e.id === enrollmentId) ?? null;
  const nodes = useClassroomNodes(enrollment?.classroomId ?? null);
  const periods = useYearPeriods(enrollment?.academicYearId ?? null);
  const nodeTypes = useReference("node-types");
  const ueOptions = useMemo(() => {
    const all = nodes.data ?? [];
    const creditTypes = nodeTypes.data ? new Set(nodeTypes.data.filter((x) => x.allowsCredits).map((x) => x.code)) : null;
    const candidates = creditTypes ? all.filter((n) => creditTypes.has(n.nodeTypeCode)) : all;
    // Une UE est un élément à crédits qui a des sous-éléments (ECUE) ; sans cette structure, tous les éléments à crédits sont proposés.
    const parents = new Set(all.map((n) => n.parentId).filter((id): id is string => id !== null));
    const ues = candidates.filter((n) => parents.has(n.nodeId));
    return (ues.length > 0 ? ues : candidates).map((n) => ({ value: n.lineageId, label: `${n.code} — ${n.label}` }));
  }, [nodes.data, nodeTypes.data]);

  async function submit() {
    const body = { studentId: student?.value ?? "", enrollmentId, ueNodeId, academicPeriodId: periodId, reason: reason.trim() };
    const v = validateWith(higherGrantExemptionBodySchema, body);
    const local: FieldErrors = v.ok ? {} : v.errors;
    if (!student) local.studentId = t("studentRequired");
    setErrors(local);
    if (!v.ok || Object.keys(local).length > 0) return;
    try {
      await grant.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={grant.isPending} error={grant.error} wide>
      <FormField label={t("student")} required error={errors.studentId}>
        {(c) => (
          <SelectAsync
            {...c}
            value={student}
            onChange={(o) => {
              setStudent(o);
              setEnrollmentId("");
              setUeNodeId("");
              setPeriodId("");
            }}
            useOptions={useStudentOptions}
            ariaLabel={t("student")}
            placeholder={t("studentPlaceholder")}
          />
        )}
      </FormField>
      {student ? (
        <FormField label={t("enrollment")} required error={errors.enrollmentId} hint={mine.length === 0 && !enrollments.isFetching ? t("noEnrollment") : undefined}>
          {(c) => (
            <NativeSelect
              {...c}
              value={enrollmentId}
              placeholder={t("chooseEnrollment")}
              onChange={(v) => {
                setEnrollmentId(v);
                setUeNodeId("");
                setPeriodId("");
              }}
              options={mine.map((e) => ({ value: e.id, label: `${e.registrationNumber ?? shortId(e.id)} · ${e.enrolledOn}` }))}
            />
          )}
        </FormField>
      ) : null}
      {enrollment ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("ue")} required error={errors.ueNodeId} hint={ueOptions.length === 0 && !nodes.isFetching ? t("noUe") : undefined}>
            {(c) => <NativeSelect {...c} value={ueNodeId} placeholder={t("chooseUe")} onChange={setUeNodeId} options={ueOptions} />}
          </FormField>
          <FormField label={t("period")} required error={errors.academicPeriodId} hint={t("periodHint")}>
            {(c) => <NativeSelect {...c} value={periodId} placeholder={t("choosePeriod")} onChange={setPeriodId} options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
          </FormField>
        </div>
      ) : null}
      <FormField label={t("reason")} required hint={t("reasonHint")} error={errors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}
