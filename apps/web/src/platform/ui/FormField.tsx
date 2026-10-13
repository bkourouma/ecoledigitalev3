"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { Checkbox, Input, Select } from "antd";
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

/**
 * Contrôles de saisie : composants Ant Design (thème commun posé par `AntdConfigProvider`, voir `lib/antd-config.ts`).
 * Les props restent celles d'avant (`value` / `onChange(valeur)` + attributs ARIA de `FormField`) : les écrans ne changent pas.
 * Les champs de date et d'heure restent des `<input type="date|time">` natifs (sélecteur du système, saisie au clavier) habillés
 * par Ant Design.
 */

/** Le menu d'une liste se rend DANS la fenêtre modale quand il y en a une (Radix piège le focus et bloque le reste de la page). */
const popupParent = (node: HTMLElement): HTMLElement => (node.closest("[role='dialog']") as HTMLElement | null) ?? document.body;

/** Au-delà de ce nombre d'options, la liste devient recherchable. */
const SEARCHABLE_FROM = 8;

/**
 * Les tests d'écrans pilotent les listes comme des `<select>` natifs (`getByRole("option")`, `select.options`, `fireEvent.change`) :
 * leur préparation (`src/platform/test/setup.ts`) pose ce drapeau pour qu'ils gardent ce comportement. Hors tests il n'est jamais
 * posé : l'application affiche toujours la liste Ant Design. `FormField.test.tsx` le retire pour tester la vraie liste.
 */
function useNativeSelectForTests(): boolean {
  return (globalThis as { __NATIVE_SELECT_FOR_TESTS__?: boolean }).__NATIVE_SELECT_FOR_TESTS__ === true;
}

/** Liste déroulante Ant Design ; l'option vide (« Tous », « Choisir… ») reste sélectionnable comme avant. */
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
  const all = placeholder !== undefined ? [{ value: "", label: placeholder, disabled: false }, ...options] : options;
  const { id, "aria-describedby": describedBy, "aria-invalid": invalid, "aria-required": required } = aria;
  if (useNativeSelectForTests()) {
    return (
      <select {...aria} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className}>
        {all.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Select<string>
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      aria-required={required}
      size="large"
      className={cn("w-full", className)}
      status={invalid ? "error" : undefined}
      value={value}
      disabled={disabled}
      onChange={(next) => onChange(next)}
      options={all.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
      showSearch={all.length > SEARCHABLE_FROM}
      optionFilterProp="label"
      getPopupContainer={popupParent}
      notFoundContent={null}
    />
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
  return <Input {...rest} size="large" status={rest["aria-invalid"] ? "error" : undefined} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
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
  return <Input.TextArea {...rest} status={rest["aria-invalid"] ? "error" : undefined} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
}

/** Case à cocher avec libellé cliquable (zone de 44 px sur mobile). */
export function CheckControl({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-[2.75rem] items-start py-1">
      <Checkbox id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined}>
        <span className="text-sm leading-snug">
          {label}
          {hint ? (
            <span id={`${id}-hint`} className="block text-xs text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </span>
      </Checkbox>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// AntSelect : remplace un <select> natif sans réécrire l'écran
// ---------------------------------------------------------------------------------------------------------------------

interface FlatOption {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

function textOfNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOfNode).join("");
  if (isValidElement(node)) return textOfNode((node.props as { children?: ReactNode }).children);
  return "";
}

/** Lit les `<option>` (y compris dans des fragments, des tableaux et des `<optgroup>`) comme le ferait un `<select>`. */
function flattenOptions(children: ReactNode, out: FlatOption[] = []): FlatOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
    if (child.type === Fragment || child.type === "optgroup") flattenOptions(props.children, out);
    else if (child.type === "option") {
      const text = textOfNode(props.children);
      out.push({ value: props.value === undefined ? text : String(props.value), label: props.children ?? text, text, disabled: Boolean(props.disabled) });
    }
  });
  return out;
}

/** Seules les classes de MISE EN PAGE d'un `<select>` natif sont reprises : sa hauteur, sa bordure et ses couleurs viennent du thème Ant Design. */
const LAYOUT_CLASS = /^(?:[a-z0-9-]+:)*(?:w-|min-w-|max-w-|flex-|grow|shrink|basis-|self-|m[trblxy]?-|col-|row-)/;

export type AntSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "size" | "multiple" | "children"> & {
  value?: string | number | null;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
};

/**
 * Liste déroulante Ant Design qui reprend l'API d'un `<select>` (`value`, `onChange(e)` avec `e.target.value`, `<option>` enfants,
 * `disabled`, `id`, attributs ARIA) : le remplacement d'un `<select>` natif se limite au nom de la balise. Les tests d'écrans gardent
 * un vrai `<select>` (voir `useNativeSelectForTests`).
 */
export function AntSelect({ children, value, onChange, className, disabled, id, ...rest }: AntSelectProps) {
  if (useNativeSelectForTests()) {
    return (
      <select {...rest} id={id} value={value ?? undefined} disabled={disabled} onChange={onChange} className={className}>
        {children}
      </select>
    );
  }
  const options = flattenOptions(children);
  const extra: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(rest)) if (key.startsWith("aria-") || key.startsWith("data-")) extra[key] = v;
  const layout = (className ?? "").split(/\s+/).filter((c) => LAYOUT_CLASS.test(c)).join(" ");
  return (
    <Select<string>
      {...extra}
      id={id}
      size="large"
      className={cn("w-full", layout)}
      status={rest["aria-invalid"] ? "error" : undefined}
      value={value === undefined || value === null ? undefined : String(value)}
      disabled={disabled}
      onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } } as unknown as ChangeEvent<HTMLSelectElement>)}
      options={options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled, searchText: o.text }))}
      showSearch={options.length > SEARCHABLE_FROM}
      filterOption={(input, option) => String((option as { searchText?: string } | undefined)?.searchText ?? "").toLowerCase().includes(input.toLowerCase())}
      getPopupContainer={popupParent}
      notFoundContent={null}
    />
  );
}
