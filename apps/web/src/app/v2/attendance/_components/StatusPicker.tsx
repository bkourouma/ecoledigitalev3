"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";

export interface StatusOption {
  code: string;
  label: string;
}

/**
 * Choix d'un statut pour un élève (feuille en bas d'écran sur mobile). Les options viennent des définitions de statuts
 * de l'établissement (ou des cinq statuts système) : l'écran n'en invente aucun. Le retard accepte des minutes ;
 * la politique d'appel de l'établissement dit si elles sont obligatoires (l'API le refuse sinon et le message s'affiche).
 */
export function StatusPicker({
  open,
  onOpenChange,
  studentName,
  options,
  current,
  currentMinutes,
  canJustify,
  onPick,
  onJustify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  options: ReadonlyArray<StatusOption>;
  current: string;
  currentMinutes?: number | null;
  /** Peut enregistrer une absence justifiée (permission de décision) : option « Absence justifiée… » (en ligne). */
  canJustify: boolean;
  onPick: (statusCode: string, minutesLate?: number) => void;
  onJustify: () => void;
}) {
  const t = useTranslations("v2Attendance.picker");
  const [selected, setSelected] = useState(current);
  const [minutes, setMinutes] = useState(currentMinutes ? String(currentMinutes) : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(current);
      setMinutes(currentMinutes ? String(currentMinutes) : "");
      setError(null);
    }
  }, [open, current, currentMinutes]);

  function apply() {
    const trimmed = minutes.trim();
    let late: number | undefined;
    if (selected === "LATE" && trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > 1440) {
        setError(t("minutesInvalid"));
        return;
      }
      late = n;
    }
    onPick(selected, late);
    onOpenChange(false);
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title", { name: studentName })} description={t("description")}>
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="sr-only">{t("legend")}</legend>
          {options.map((o) => (
            <label key={o.code} className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="status" value={o.code} checked={selected === o.code} onChange={() => setSelected(o.code)} className="h-4 w-4 accent-primary" />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        {selected === "LATE" ? (
          <FormField label={t("minutesLate")} hint={t("minutesHint")} error={error}>
            {(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} max={1440} value={minutes} onChange={setMinutes} />}
          </FormField>
        ) : null}
        {canJustify ? (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onJustify();
            }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("justify")}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("excusedHint")}</p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass.secondary}>
            {t("cancel")}
          </button>
          <button type="button" onClick={apply} className={buttonClass.primary}>
            {t("apply")}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
