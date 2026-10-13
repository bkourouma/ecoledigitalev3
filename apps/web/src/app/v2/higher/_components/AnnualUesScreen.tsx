"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { higherDeclareAnnualUeBodySchema, type HigherAnnualUeDto } from "@ecoledigitale/contracts/v2/higher";
import type { AcademicCurriculumNodeDto } from "@ecoledigitale/contracts/v2/academic";
import { useFeature, usePermission } from "@/platform/access";
import { useAnnualUes, useDeclareAnnualUe, useRemoveAnnualUe } from "@/platform/v2/higher-annual-exemptions";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CurriculumNodePicker, shortId } from "./shared";

/**
 * Décision O-11 — UE annuelle : une UE offerte sur deux semestres (ou plus) avec UN résultat commun. L'écran DÉCLARE l'UE
 * (UE principale + UE de chaque semestre) et liste les déclarations ; le résultat commun (moyenne, validation, état) est
 * calculé par les règles du RuleSet, jamais ici. Une UE annuelle compte pour UNE exigence de diplôme.
 */
export function AnnualUesScreen() {
  const t = useTranslations("v2HigherAnnualUes");
  const tErrors = useTranslations("errors");
  const read = usePermission("higher.diploma.read");
  const feature = useFeature("higher.diplomas");
  const body = (() => {
    if (read.isLoading || feature.isLoading) return <LoadingBlock />;
    if (!read.allowed) return <Notice kind="warning">{tErrors("forbidden")}</Notice>;
    if (!feature.allowed && !feature.isUnavailable) return <FeatureNotice>{t("featureOff")}</FeatureNotice>;
    return <AnnualUesContent />;
  })();
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {body}
    </div>
  );
}

function AnnualUesContent() {
  const t = useTranslations("v2HigherAnnualUes");
  const date = useDateFormat();
  const list = useAnnualUes();
  const flash = useFlash();
  const [declaring, setDeclaring] = useState(false);
  const [removing, setRemoving] = useState<HigherAnnualUeDto | null>(null);
  const remove = useRemoveAnnualUe();
  const name = (u: { ueNodeId: string; code?: string | null; label?: string | null }) => (u.code ? `${u.code} — ${u.label ?? ""}` : shortId(u.ueNodeId));

  return (
    <div className="space-y-4">
      <Notice kind="info">{t("rulesNote")}</Notice>
      {flash.node}
      <div className="flex justify-end">
        <Can permission="higher.annual_ue.manage">
          <button type="button" className={buttonClass.primary} onClick={() => setDeclaring(true)}>
            {t("declare")}
          </button>
        </Can>
      </div>
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {list.data && list.data.length > 0 ? (
        <ul aria-label={t("listLabel")} className="grid gap-3 md:grid-cols-2">
          {list.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-card/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-base font-medium">{name({ ueNodeId: a.ueNodeId, code: a.ueCode, label: a.ueLabel })}</h3>
                <StatusBadge label={t("semesters", { count: a.partsExpected })} tone="info" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("members")} : {(a.members ?? a.memberNodeIds.map((id) => ({ ueNodeId: id, code: null, label: null }))).map((m) => name(m)).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">{t("declaredOn", { date: date.instant(a.createdAt), reason: a.reason })}</p>
              <Can permission="higher.annual_ue.manage">
                <div className="mt-auto flex gap-1">
                  <button type="button" className={buttonClass.ghost} onClick={() => setRemoving(a)} aria-label={`${t("remove")} — ${name({ ueNodeId: a.ueNodeId, code: a.ueCode, label: a.ueLabel })}`}>
                    {t("remove")}
                  </button>
                </div>
              </Can>
            </li>
          ))}
        </ul>
      ) : null}
      {declaring ? <DeclareDialog onClose={() => setDeclaring(false)} onDone={() => flash.show(t("declared"))} /> : null}
      {removing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("removeTitle")}
          description={t("removeDescription")}
          reasonLabel={t("reasonLabel")}
          confirmLabel={t("remove")}
          destructive
          isPending={remove.isPending}
          error={remove.error}
          onConfirm={async (reason) => {
            try {
              await remove.mutateAsync({ id: removing.id, reason });
              flash.show(t("removed"));
              setRemoving(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DeclareDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2HigherAnnualUes.dialog");
  const declare = useDeclareAnnualUe();
  const [main, setMain] = useState<{ nodeId: string; node: AcademicCurriculumNodeDto | null }>({ nodeId: "", node: null });
  const [second, setSecond] = useState<{ nodeId: string; node: AcademicCurriculumNodeDto | null }>({ nodeId: "", node: null });
  const [parts, setParts] = useState("2");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const members = second.node && second.node.lineageId !== main.node?.lineageId ? [second.node.lineageId] : [];
    const body = { ueNodeId: main.node?.lineageId ?? "", memberNodeIds: members, partsExpected: Number(parts), reason: reason.trim() };
    const v = validateWith(higherDeclareAnnualUeBodySchema, body);
    const local: FieldErrors = v.ok ? {} : v.errors;
    if (!main.node) local.ueNodeId = t("mainRequired");
    setErrors(local);
    if (!v.ok || Object.keys(local).length > 0) return;
    try {
      await declare.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={declare.isPending} error={declare.error} wide>
      <CurriculumNodePicker label={t("mainUe")} value={main.nodeId} onChange={(nodeId, node) => setMain({ nodeId, node })} error={errors.ueNodeId} hint={t("mainHint")} />
      <CurriculumNodePicker label={t("secondUe")} value={second.nodeId} onChange={(nodeId, node) => setSecond({ nodeId, node })} hint={t("secondHint")} />
      <FormField label={t("parts")} hint={t("partsHint")} error={errors.partsExpected}>
        {(c) => <NativeSelect {...c} value={parts} onChange={setParts} options={["2", "3", "4"].map((n) => ({ value: n, label: t("partsOption", { count: Number(n) }) }))} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}
