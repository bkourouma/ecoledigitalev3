"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Message affiché DANS la page à la place d'une alerte native du navigateur.
 *
 * Une alerte `window.alert` bloque l'onglet, ne se lit pas par un lecteur d'écran
 * autrement qu'à la volée, et ne peut être ni copiée ni relue une fois fermée. Ici
 * le message reste affiché jusqu'à la prochaine action, et la page défile
 * jusqu'à lui : sur un long formulaire, l'erreur ne se cache pas hors de l'écran.
 *
 * `variant="error"` est annoncé comme une alerte (`role="alert"`), les autres
 * comme un simple statut.
 */
export function FormMessage({
  message,
  variant = "error",
  className,
}: {
  message: string | null | undefined;
  variant?: "error" | "success" | "warning";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [message]);

  if (!message) return null;

  const styles = {
    error: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
    success: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  }[variant];

  return (
    <div
      ref={ref}
      role={variant === "error" ? "alert" : "status"}
      className={cn("whitespace-pre-line rounded-md border px-4 py-3 text-sm", styles, className)}
    >
      {message}
    </div>
  );
}
