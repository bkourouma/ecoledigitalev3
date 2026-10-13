"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { primaryCreateScaleBodySchema } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useCreatePrimaryScale, usePrimaryScales } from "@/platform/v2/primary";

interface LevelRow {
  code: string;
  label: string;
  meetsExpectation: boolean;
}

const emptyLevels = (): LevelRow[] => [
  { code: "", label: "", meetsExpectation: false },
  { code: "", label: "", meetsExpectation: false },
];

/** Échelles d'appréciation (niveaux de maîtrise). Une échelle employée par un référentiel publié est verrouillée. */
export function ScalesSection() {
  const t = useTranslations("v2PrimarySettings.scales");
  const scales = usePrimaryScales();
  const canManage = usePermission("primary.scale.manage").allowed;
  const [creating, setCreating] = useState(false);
  const flash = useFlash();
  return (
    <section aria-labelledby="primary-scales" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="primary-scales" className="text-lg font-semibold">
          {t("title")}
        </h2>
        {canManage ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setCreating(true)}>
            {t("create")}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {flash.node}
      <QueryBoundary query={scales} isEmpty={(scales.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} />}>
        <ul className="space-y-3">
          {(scales.data ?? []).map((s) => (
            <li key={s.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{s.label}</p>
                <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                {s.sourceKind === "placeholder" ? <StatusBadge label={t("placeholder")} tone="warning" /> : null}
                {s.locked ? <StatusBadge label={t("locked")} tone="neutral" /> : null}
                {s.status === "ARCHIVED" ? <StatusBadge label={t("archived")} tone="neutral" /> : null}
              </div>
              <ol className="flex flex-wrap gap-2 text-sm">
                {[...s.levels]
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((l) => (
                    <li key={l.id} className="rounded-md border px-2 py-1">
                      <span className="font-semibold">{l.code}</span> {l.label}
                      {l.meetsExpectation ? <span className="ml-1 text-xs text-muted-foreground">{t("meets")}</span> : null}
                    </li>
                  ))}
              </ol>
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {creating ? <CreateScaleDialog onClose={() => setCreating(false)} onCreated={() => flash.show(t("created"))} /> : null}
    </section>
  );
}

function CreateScaleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("v2PrimarySettings.scales.form");
  const create = useCreatePrimaryScale();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [levels, setLevels] = useState<LevelRow[]>(emptyLevels);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    // L'ordre des niveaux est l'ordre de saisie (ordinal 1, 2, …) ; le contrat valide la forme (2 niveaux au moins).
    const v = validateWith(primaryCreateScaleBodySchema, {
      code: code.trim().toUpperCase(),
      label,
      levels: levels.map((l, i) => ({ code: l.code.trim().toUpperCase(), label: l.label, ordinal: i + 1, meetsExpectation: l.meetsExpectation })),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await create.mutateAsync(v.data);
      onCreated();
      onClose();
    } catch {
      /* affichée par FormDialog */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error} wide>
      <FormField label={t("code")} required hint={t("codeHint")} error={errors.code}>
        {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
      </FormField>
      <FormField label={t("label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}
      </FormField>
      <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <legend className="px-1 text-sm font-medium">{t("levels")}</legend>
        {errors.levels ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.levels}
          </p>
        ) : null}
        {levels.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
            <FormField label={t("levelCode", { n: i + 1 })} error={errors[`levels.${i}.code`]}>
              {(c) => <TextControl {...c} value={l.code} onChange={(v) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, code: v } : x)))} maxLength={40} />}
            </FormField>
            <FormField label={t("levelLabel", { n: i + 1 })} error={errors[`levels.${i}.label`]}>
              {(c) => <TextControl {...c} value={l.label} onChange={(v) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, label: v } : x)))} maxLength={200} />}
            </FormField>
            <CheckControl checked={l.meetsExpectation} onChange={(v) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, meetsExpectation: v } : x)))} label={t("meets")} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setLevels((ls) => [...ls, { code: "", label: "", meetsExpectation: false }])} disabled={levels.length >= 12}>
            {t("addLevel")}
          </button>
          <button type="button" className={buttonClass.ghost} onClick={() => setLevels((ls) => ls.slice(0, -1))} disabled={levels.length <= 2}>
            {t("removeLevel")}
          </button>
        </div>
      </fieldset>
    </FormDialog>
  );
}
