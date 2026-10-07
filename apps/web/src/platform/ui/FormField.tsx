"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
}

export interface FormFieldProps {
  label: string;
  /** Message d'erreur (issu de Zod ou de l'API) ; rend le champ invalide et l'annonce (`role="alert"`). */
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Identifiant imposé (sinon généré). */
  id?: string;
  /** Rend le contrôle : l'objet reçu porte `id`, `aria-describedby`, `aria-invalid`, `aria-required`. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Libellé -> fragment d'identifiant (minuscules, sans accents ni ponctuation). */
export function slugOfLabel(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "champ";
}

/**
 * Champ de formulaire accessible : libellé relié au contrôle, aide et erreur reliées par `aria-describedby`,
 * marqueur « obligatoire » lisible (pas seulement un astérisque coloré).
 */
export function FormField({ label, error, hint, required, className, id: forcedId, children }: FormFieldProps) {
  const t = useTranslations("v2Ui.form");
  const generated = useId();
  const base = `f-${slugOfLabel(label)}`;
  const [unique, setUnique] = useState(false);
  // Identifiant DÉRIVÉ DU LIBELLÉ (déterministe : identique au rendu serveur et au premier rendu client). `useId` encode la
  // position dans l'arbre : dès que l'arbre diffère entre serveur et client (écran protégé, fournisseur monté après coup), le
  // `htmlFor` généré divergeait et l'hydratation signalait une erreur (constat QA : /v2/higher/credits, /v2/academic/curriculum).
  // Deux champs de même libellé sur une page (lignes répétées) reçoivent, APRÈS montage, un suffixe `useId` pour rester uniques.
  useEffect(() => {
    if (forcedId) return;
    if (document.querySelectorAll(`[id="${base}"]`).length > 1) setUnique(true);
  }, [forcedId, base]);
  const id = forcedId ?? (unique ? `${base}-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}` : base);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium leading-none">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
            {" "}
            <span className="sr-only">({t("required")})</span>
          </>
        ) : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive";

/** Liste déroulante native : la meilleure expérience mobile (sélecteur du système) et accessible par défaut. */
export function NativeSelect({
  options,
  value,
  onChange,
  placeholder,
  className,
  disabled,
  ...aria
}: {
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
} & Partial<FieldControlProps>) {
  return (
    <select {...aria} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(CONTROL, "pr-8", className)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextControl({
  value,
  onChange,
  type = "text",
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "date" | "number" | "search" | "time";
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  maxLength?: number;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search";
} & Partial<FieldControlProps>) {
  return <input {...rest} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cn(CONTROL, className)} />;
}

export function TextAreaControl({
  value,
  onChange,
  className,
  rows = 3,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
} & Partial<FieldControlProps>) {
  return <textarea {...rest} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cn(CONTROL, "h-auto min-h-[5rem]", className)} />;
}

/** Case à cocher avec libellé cliquable (zone de 44 px sur mobile). */
export function CheckControl({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-[2.75rem] items-start gap-3 py-1">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id} className="text-sm leading-snug">
        {label}
        {hint ? (
          <span id={`${id}-hint`} className="block text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
