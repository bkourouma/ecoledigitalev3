"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Panneau déroulant de l'en-tête (changement de module, menu du compte) : motif « disclosure » ARIA, pas un `role="menu"`.
 * Le bouton porte `aria-expanded` / `aria-controls` ; Échap ferme et rend le focus au bouton ; un clic ou le focus hors du
 * panneau le ferme ; le contenu reste atteignable au clavier dans l'ordre naturel (liens et boutons ordinaires).
 */
export function HeaderPopover({
  label,
  icon,
  children,
  align = "left",
  className,
  buttonClassName,
  hideLabelOnMobile = false,
}: {
  /** Texte du bouton (toujours lu par les lecteurs d'écran). */
  label: string;
  icon?: ReactNode;
  /** Reçoit `close()` pour fermer après une action. */
  children: (api: { close: () => void }) => ReactNode;
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
  hideLabelOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: MouseEvent | FocusEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("focusin", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("focusin", onPointer);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${buttonClassName ?? ""}`}
      >
        {icon}
        <span className={hideLabelOnMobile ? "sr-only sm:not-sr-only" : undefined}>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className={`absolute z-50 mt-1 max-h-[70vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border bg-background p-2 text-foreground shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children({ close: () => close(false) })}
        </div>
      ) : null}
    </div>
  );
}
