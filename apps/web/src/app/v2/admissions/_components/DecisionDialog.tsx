"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { admissionsDecisionBodySchema, type AdmissionsAllowedTransitionDto, type AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { useDecideApplication, useDecisionReasons } from "@/platform/v2/admissions";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

/**
 * Décision FORMELLE (acceptation, refus, mise en liste d'attente, retrait, réexamen) : journalisée par l'API dans la même
 * transaction que le changement d'étape. La nature de la décision est dictée par la transition choisie ; l'écran ne la déduit pas.
 */
export function DecisionDialog({ application, transition, onClose, onDone }: { application: AdmissionsApplicationDetailDto; transition: AdmissionsAllowedTransitionDto; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Admissions.decision");
  const tk = useTranslations("v2Admissions.decisionKind");
  const decide = useDecideApplication();
  const reasons = useDecisionReasons();
  const canOverride = usePermission("admission.capacity.override").allowed;
  const kind = transition.decisionKind ?? "ACCEPT";
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [conditions, setConditions] = useState("");
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(decide.error), ...errors };
  const options = (reasons.data?.items ?? []).filter((r) => r.active && r.kind === kind).map((r) => ({ value: r.code, label: r.label }));
  const needsReason = kind === "REJECT" || kind === "WITHDRAW";
  const noSeat = application.seatsLeft !== null && application.seatsLeft <= 0;

  function submit() {
    const body = {
      toStageId: transition.toStageId,
      kind,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}),
      ...(conditions.trim() ? { conditions: conditions.trim() } : {}),
      overrideCapacity: override,
      rowVersion: application.rowVersion,
    };
    const checked = validateWith(admissionsDecisionBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    decide.mutate({ id: application.id, body: checked.data }, { onSuccess: () => onDone(t("done", { kind: tk(kind), stage: transition.toStageLabel })) });
  }

  return (
    <FormDialog open onOpenChange={(open) => (!open ? onClose() : undefined)} title={t("title", { kind: tk(kind) })} description={t("description", { stage: transition.toStageLabel })} submitLabel={t("confirm", { kind: tk(kind) })} onSubmit={submit} isPending={decide.isPending} error={Object.keys(apiErrorToFieldErrors(decide.error)).length === 0 ? decide.error : undefined}>
      <FormField label={t("reason")} required={needsReason} error={shown["reasonCode"]}>
        {(c) => <NativeSelect {...c} value={reasonCode} onChange={setReasonCode} placeholder={t("noReason")} options={options} />}
      </FormField>
      <FormField label={t("reasonText")} hint={t("reasonTextHint")} error={shown["reasonText"]}>
        {(c) => <TextAreaControl {...c} value={reasonText} onChange={setReasonText} maxLength={2000} />}
      </FormField>
      {kind === "ACCEPT" ? (
        <FormField label={t("conditions")} hint={t("conditionsHint")} error={shown["conditions"]}>
          {(c) => <TextAreaControl {...c} value={conditions} onChange={setConditions} maxLength={2000} />}
        </FormField>
      ) : null}
      {kind === "ACCEPT" && noSeat ? <Notice kind="warning">{t("noSeat")}</Notice> : null}
      {kind === "ACCEPT" && canOverride ? <CheckControl checked={override} onChange={setOverride} label={t("override")} hint={t("overrideHint")} /> : null}
    </FormDialog>
  );
}
