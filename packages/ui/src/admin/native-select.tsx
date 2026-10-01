import * as React from "react";
import { cn } from "../utils";

export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * `<select>` natif stylé comme `Input` : meilleur choix en mobile-first (sélecteur du système, clavier et lecteurs
 * d'écran gratuits) et simple à tester. À utiliser quand la liste est courte et sans contenu riche.
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10",
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
