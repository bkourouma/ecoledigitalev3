import * as React from "react";
import { cn } from "../utils";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export interface FieldProps {
  label: React.ReactNode;
  /** Identifiant du contrôle (généré si absent). */
  id?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Mention lue par les lecteurs d'écran après le libellé d'un champ obligatoire. */
  requiredLabel?: string;
  className?: string;
  /** Reçoit les attributs d'accessibilité à poser sur le contrôle (`id`, `aria-describedby`, `aria-invalid`). */
  children: (control: FieldControlProps) => React.ReactNode;
}

/** Champ de formulaire : libellé relié, aide, erreur annoncée (`role="alert"`). */
export function Field({ label, id, hint, error, required, requiredLabel, className, children }: FieldProps) {
  const generated = React.useId();
  const controlId = id ?? `f-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={controlId} className="block text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-1 text-destructive">
            <span aria-hidden="true">*</span>
            {requiredLabel ? <span className="sr-only"> ({requiredLabel})</span> : null}
          </span>
        ) : null}
      </label>
      {children({
        id: controlId,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(required ? { "aria-required": true as const } : {}),
      })}
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
