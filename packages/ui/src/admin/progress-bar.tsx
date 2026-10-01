import * as React from "react";
import { cn } from "../utils";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pourcentage 0-100. */
  value: number;
  /** Libellé accessible (obligatoire). */
  label: string;
}

/** Barre de progression accessible (`role="progressbar"` avec `aria-valuenow`, texte alternatif obligatoire). */
export function ProgressBar({ value, label, className, ...props }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped} %`}
      className={cn("h-3 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div className="h-full bg-primary transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}
