"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { FieldControlProps } from "./FormField";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface OptionsResult {
  options: ReadonlyArray<SelectOption>;
  isLoading: boolean;
  error?: unknown;
}

export interface SelectAsyncProps extends Partial<FieldControlProps> {
  /** Option choisie (le libellé reste affiché même si la recherche courante ne la renvoie plus). */
  value: SelectOption | null;
  onChange: (option: SelectOption | null) => void;
  /**
   * Hook de chargement des options pour la recherche saisie (déjà temporisée) ; `enabled` est faux tant que la liste est
   * fermée (aucune requête inutile). Il s'appuie sur les hooks de
   * `platform/api` ; le composant ne connaît ni l'URL ni le client.
   */
  useOptions: (search: string, enabled: boolean) => OptionsResult;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  debounceMs?: number;
  /** Nom accessible quand le champ n'est pas relié à un `<label>`. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Liste de choix avec recherche serveur (motif ARIA « combobox » à liste) : saisie temporisée, flèches haut/bas, Entrée,
 * Échap, état de chargement / erreur / aucun résultat annoncés (`aria-live`).
 */
export function SelectAsync({ value, onChange, useOptions, placeholder, clearable = true, disabled, debounceMs = 250, ariaLabel, className, ...aria }: SelectAsyncProps) {
  const t = useTranslations("v2Ui.select");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);

  // Temporisation de la recherche : une requête par pause de frappe, pas par touche.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(text.trim()), debounceMs);
    return () => clearTimeout(handle);
  }, [text, debounceMs]);

  const result = useOptions(search, open);
  const options = result.options;

  useEffect(() => {
    setActive(0);
  }, [search, options.length]);

  function choose(option: SelectOption) {
    onChange(option);
    setText("");
    setSearch("");
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const showValue = !open && value;
  const activeId = open && options[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <input
          {...aria}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={aria.id ? undefined : ariaLabel}
          autoComplete="off"
          disabled={disabled}
          placeholder={value ? undefined : placeholder ?? t("placeholder")}
          value={showValue ? value.label : text}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-3 pr-16 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {open && result.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
          {clearable && value && !disabled ? (
            <button
              type="button"
              aria-label={t("clear")}
              // `mousedown` : le champ ne doit pas perdre le focus avant le clic.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(null);
                setText("");
                inputRef.current?.focus();
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded text-muted-foreground sm:h-8 sm:w-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <ChevronsUpDown className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label={ariaLabel ?? placeholder ?? t("placeholder")} className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={value?.value === option.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              onMouseEnter={() => setActive(index)}
              className={cn("flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-sm", index === active && "bg-accent text-accent-foreground")}
            >
              <Check className={cn("mt-0.5 h-4 w-4 shrink-0", value?.value === option.value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}
              </span>
            </li>
          ))}
          {!result.isLoading && options.length === 0 && !result.error ? (
            <li role="presentation" className="px-2 py-2 text-sm text-muted-foreground">
              {t("noResults")}
            </li>
          ) : null}
          {result.error ? (
            <li role="presentation" className="px-2 py-2 text-sm text-destructive">
              {t("error")}
            </li>
          ) : null}
        </ul>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {open && !result.isLoading ? t("count", { count: options.length }) : ""}
      </p>
    </div>
  );
}
