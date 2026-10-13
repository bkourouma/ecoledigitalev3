"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { HIGHER_SLOT_KEYS, higherAssignSlotBodySchema } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { useAssignSlot, useSlots } from "@/platform/v2/higher";
import { useSignatories } from "@/platform/v2/reportcards";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { shortId } from "./shared";

/**
 * Signataires datés des documents officiels : chaque emplacement (diplôme gauche/droite, attestations) est confié à un
 * signataire pour une période ; l'historique est conservé (jamais de suppression), les périodes ne se chevauchent pas.
 */
export function SlotsScreen() {
  const t = useTranslations("v2Higher.slots");
  const tKey = useTranslations("v2Higher.slotKey");
  const date = useDateFormat();
  const slots = useSlots();
  const signatories = useSignatories();
  const canManage = usePermission("higher.slot.manage");
  const [assigning, setAssigning] = useState<string | null>(null);
  const flash = useFlash();
  const names = useMemo(() => new Map((signatories.data ?? []).map((s) => [s.id, [s.fullName, s.title].filter(Boolean).join(" — ")] as const)), [signatories.data]);
  const today = new Date().toISOString().slice(0, 10);

  if (slots.isPending && slots.fetchStatus !== "idle") return <LoadingBlock />;
  const all = slots.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      {slots.isError ? <ErrorBlock error={slots.error} onRetry={() => void slots.refetch()} /> : null}
      {signatories.isError ? <Notice kind="info">{t("namesUnavailable")}</Notice> : null}
      {HIGHER_SLOT_KEYS.map((key) => {
        const list = all.filter((s) => s.slotKey === key).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
        return (
          <section key={key} aria-label={tKey(key)} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{tKey(key)}</h2>
              {canManage.allowed ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setAssigning(key)} aria-label={t("assignOf", { slot: tKey(key) })}>
                  {t("assign")}
                </button>
              ) : null}
            </div>
            {list.length === 0 ? (
              <EmptyBlock title={t("none")} />
            ) : (
              <ul className="space-y-1 text-sm">
                {list.map((s) => {
                  const current = s.validFrom <= today && (!s.validTo || s.validTo >= today);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/30 px-3 py-2">
                      <span>{names.get(s.signatoryId) ?? t("signatoryFallback", { id: shortId(s.signatoryId) })}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {t("period", { from: date.civil(s.validFrom), to: s.validTo ? date.civil(s.validTo) : t("openEnded") })}
                        {current ? <StatusBadge label={t("current")} tone="success" /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {assigning ? <AssignDialog slotKey={assigning} signatories={(signatories.data ?? []).filter((s) => s.active)} onClose={() => setAssigning(null)} onDone={() => flash.show(t("assigned"))} /> : null}
    </div>
  );
}

function AssignDialog({ slotKey, signatories, onClose, onDone }: { slotKey: string; signatories: Array<{ id: string; fullName: string; title: string | null }>; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Higher.slots");
  const tKey = useTranslations("v2Higher.slotKey");
  const assign = useAssignSlot();
  const [form, setForm] = useState({ signatoryId: "", validFrom: "", validTo: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const body = { slotKey, signatoryId: form.signatoryId, validFrom: form.validFrom, ...(form.validTo ? { validTo: form.validTo } : {}) };
    const v = validateWith(higherAssignSlotBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await assign.mutateAsync({ slotKey: v.data.slotKey, signatoryId: v.data.signatoryId, validFrom: v.data.validFrom, validTo: v.data.validTo });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("assignTitle", { slot: tKey(slotKey as (typeof HIGHER_SLOT_KEYS)[number]) })} description={t("assignDescription")} submitLabel={t("assignSubmit")} onSubmit={() => void submit()} isPending={assign.isPending} error={Object.keys(errors).length === 0 ? assign.error : null}>
      <FormField label={t("signatory")} required error={errors.signatoryId}>
        {(c) => <NativeSelect {...c} value={form.signatoryId} onChange={(v) => setForm((f) => ({ ...f, signatoryId: v }))} placeholder={t("chooseSignatory")} options={signatories.map((s) => ({ value: s.id, label: [s.fullName, s.title].filter(Boolean).join(" — ") }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("validFrom")} required error={errors.validFrom}>
          {(c) => <TextControl {...c} type="date" value={form.validFrom} onChange={(v) => setForm((f) => ({ ...f, validFrom: v }))} />}
        </FormField>
        <FormField label={t("validTo")} error={errors.validTo} hint={t("validToHint")}>
          {(c) => <TextControl {...c} type="date" value={form.validTo} onChange={(v) => setForm((f) => ({ ...f, validTo: v }))} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
