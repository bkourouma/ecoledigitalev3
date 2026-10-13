"use client";

import { percent } from "./import-utils";

/** Barre de progression accessible (`role="progressbar"`) : la valeur est annoncée en texte à côté. */
export function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const value = percent(done, total);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {done} / {total} ({value} %)
        </span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-400 transition-[width] duration-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
