"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { EXAM_FEE_APPLIES_TO, type ExamFeeAppliesTo } from "@ecoledigitale/contracts/v2/examinations";
import { usePermission } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useFeeCatalog, useFeeItems, useSetFeeItems } from "@/platform/v2/examinations-fees";

interface Draft {
  feeId: string;
  label: string;
  appliesTo: ExamFeeAppliesTo;
  active: boolean;
}

/**
 * Barème des frais d'examen d'un type (Q-E13) : les frais du catalogue « examens » de la comptabilité qui s'appliquent aux candidats
 * (élèves, libres ou tous). VIDE par défaut : sans barème, l'inscription ne génère aucune facture. Les MONTANTS ne sont pas ici : ils
 * restent dans le catalogue et les barèmes de la comptabilité.
 */
export function ExamFeeItemsPanel({ typeId }: { typeId: string }) {
  const t = useTranslations("v2ExaminationsFees.items");
  const items = useFeeItems(typeId);
  const manage = useSetFeeItems(typeId);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    if (items.data && !dirty) setDraft(items.data.map((i) => ({ feeId: i.feeId, label: i.label ?? i.feeId, appliesTo: i.appliesTo, active: i.active })));
  }, [items.data, dirty]);

  // Le catalogue de la comptabilité exige le droit de gérer le barème : jamais appelé pour une simple consultation.
  const canManage = usePermission("exam.fee.manage").allowed;
  const catalog = useFeeCatalog(canManage);
  const available = (catalog.data ?? []).filter((c) => !draft.some((d) => d.feeId === c.feeId));
  const update = (feeId: string, patch: Partial<Draft>) => {
    setDirty(true);
    setDraft((prev) => prev.map((d) => (d.feeId === feeId ? { ...d, ...patch } : d)));
  };

  async function save() {
    try {
      await manage.mutateAsync({ items: draft.map((d) => ({ feeId: d.feeId, appliesTo: d.appliesTo, active: d.active })) });
      setDirty(false);
    } catch {
      /* erreur affichée */
    }
  }

  return (
    <section aria-labelledby={`fees-${typeId}`} className="space-y-2">
      <h3 id={`fees-${typeId}`} className="font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {items.isPending ? <LoadingBlock /> : items.isError ? <ErrorBlock error={items.error} onRetry={() => void items.refetch()} /> : (
        <>
          {draft.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="fee-items-empty">{t("empty")}</p> : (
            <ul className="space-y-2">
              {draft.map((d) => (
                <li key={d.feeId} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-end sm:justify-between">
                  <p className="font-medium">{d.label}</p>
                  <Can permission="exam.fee.manage" fallback={<p className="text-sm text-muted-foreground">{t(`appliesTo.${d.appliesTo}` as never)}{d.active ? "" : ` — ${t("inactive")}`}</p>}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <FormField label={t("appliesToLabel")}>
                        {(c) => <NativeSelect {...c} value={d.appliesTo} options={EXAM_FEE_APPLIES_TO.map((v) => ({ value: v, label: t(`appliesTo.${v}` as never) }))} onChange={(v) => update(d.feeId, { appliesTo: v as ExamFeeAppliesTo })} />}
                      </FormField>
                      <CheckControl checked={d.active} onChange={(v) => update(d.feeId, { active: v })} label={t("active")} />
                    </div>
                  </Can>
                </li>
              ))}
            </ul>
          )}
          <Can permission="exam.fee.manage">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <FormField label={t("add")} className="sm:w-80">
                {(c) => <NativeSelect {...c} value={adding} placeholder={catalog.isError ? t("catalogUnavailable") : t("choose")} options={available.map((a) => ({ value: a.feeId, label: a.label }))} onChange={setAdding} />}
              </FormField>
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={!adding}
                onClick={() => {
                  const entry = available.find((a) => a.feeId === adding);
                  if (!entry) return;
                  setDirty(true);
                  setDraft((prev) => [...prev, { feeId: entry.feeId, label: entry.label, appliesTo: "ALL", active: true }]);
                  setAdding("");
                }}
              >
                {t("addAction")}
              </button>
              <button type="button" className={buttonClass.primary} disabled={!dirty || manage.isPending} onClick={() => void save()}>{t("save")}</button>
            </div>
            {catalog.isError ? <Notice kind="warning">{t("catalogUnavailableHint")}</Notice> : null}
            {manage.isError ? <ErrorBlock error={manage.error} /> : null}
          </Can>
        </>
      )}
    </section>
  );
}
