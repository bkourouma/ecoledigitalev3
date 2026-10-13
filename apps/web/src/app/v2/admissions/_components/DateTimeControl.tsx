"use client";

import type { FieldControlProps } from "@/platform/ui/FormField";

/** Champ date + heure natif (sélecteur du système sur mobile) ; la valeur est celle du `datetime-local` (heure de l'appareil). */
export function DateTimeControl({ value, onChange, ...aria }: { value: string; onChange: (value: string) => void } & Partial<FieldControlProps>) {
  return (
    <input
      {...aria}
      type="datetime-local"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
    />
  );
}
