"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { fr } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";

// Helpers de conversion
function toISO(date: Date | undefined): string {
  if (!date) return "";
  return format(date, "yyyy-MM-dd");
}

function fromISO(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  // value attendu: YYYY-MM-DD
  try {
    const [y, m, d] = value.split("-").map((v) => parseInt(v, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  } catch {
    return undefined;
  }
}

export type DatePickerFrProps = {
  value?: string; // ISO (YYYY-MM-DD)
  onChange?: (iso: string) => void;
  name?: string; // pour formulaires HTML (FormData)
  placeholder?: string;
  min?: string; // ISO
  max?: string; // ISO
  disabled?: boolean;
  id?: string;
  className?: string;
  usePortal?: boolean;
};

export function DatePickerFr({
  value,
  onChange,
  name,
  placeholder = "jj/mm/aaaa",
  min,
  max,
  disabled,
  id,
  className,
  usePortal = true,
}: DatePickerFrProps) {
  const [open, setOpen] = React.useState(false);
  const [internalIso, setInternalIso] = React.useState<string | undefined>(value);
  const [popoverPos, setPopoverPos] = React.useState({ top: 0, left: 0, width: 0 });
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setInternalIso(value);
  }, [value]);

  const date = React.useMemo(() => fromISO(internalIso), [internalIso]);
  const minDate = React.useMemo(() => fromISO(min), [min]);
  const maxDate = React.useMemo(() => fromISO(max), [max]);

  const updatePopoverPosition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const minW = 288;
    let left = r.left;
    const width = Math.max(r.width, minW);
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad);
    }
    // Hauteur approximative du mois (évite de couper le bas près du bord fenêtre)
    const estimatedCalendarH = 340;
    let top = r.bottom + pad;
    if (top + estimatedCalendarH > window.innerHeight - pad && r.top > estimatedCalendarH + pad) {
      top = r.top - estimatedCalendarH - pad;
    }
    setPopoverPos({ top, left, width });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const display = date ? format(date, "dd/MM/yyyy") : "";

  const calendar = open ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      data-datepicker-popover="true"
      className={
        usePortal
          ? "fixed z-[200] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-border"
          : "absolute left-0 top-[calc(100%+8px)] z-[200] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-border"
      }
      style={
        usePortal
          ? {
              top: popoverPos.top,
              left: popoverPos.left,
              width: popoverPos.width || undefined,
              minWidth: 280,
            }
          : {
              minWidth: 280,
            }
      }
    >
      <DayPicker
        mode="single"
        locale={fr}
        weekStartsOn={1}
        className="text-sm"
        classNames={{
          months: "flex flex-col",
          month: "space-y-3",
          caption: "flex justify-center items-center relative pt-1",
          caption_label: "text-sm font-semibold text-foreground",
          nav: "flex items-center gap-1",
          nav_button:
            "h-7 w-7 bg-transparent p-0 opacity-80 hover:opacity-100 hover:bg-accent rounded-md",
          head_row: "flex",
          head_cell: "w-9 text-[0.75rem] font-medium text-muted-foreground",
          row: "flex w-full mt-1",
          cell: "h-9 w-9 text-center text-sm p-0 relative",
          day: "h-9 w-9 rounded-md hover:bg-accent hover:text-accent-foreground",
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
          day_today: "border border-primary text-foreground",
          day_outside: "text-muted-foreground opacity-50",
          day_disabled: "text-muted-foreground opacity-40",
        }}
        selected={date}
        onSelect={(d) => {
          if (!d) return;
          const iso = toISO(d);
          setInternalIso(iso);
          onChange?.(iso);
          setOpen(false);
        }}
        fromDate={minDate}
        toDate={maxDate}
      />
    </div>
  ) : null;

  return (
    <div className={`relative ${className || ""}`} ref={triggerRef} id={id}>
      {name && (
        <input type="hidden" name={name} value={internalIso || ""} />
      )}
      <input
        type="text"
        value={display}
        onChange={() => {}}
        onFocus={() => {
          setOpen(true);
          requestAnimationFrame(() => updatePopoverPosition());
        }}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => updatePopoverPosition());
        }}
        placeholder={placeholder}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        readOnly
        aria-haspopup="dialog"
      />

      {calendar
        ? (typeof document !== "undefined" && usePortal
            ? createPortal(calendar, document.body)
            : calendar)
        : null}
    </div>
  );
}

export default DatePickerFr;

