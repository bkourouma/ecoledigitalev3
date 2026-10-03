"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { ModalDialog } from "./ModalDialog";

const CODE = /^\d{6}$/;

/** Clé de message (`v2StepUp.errors.*`) d'un échec de vérification ; jamais le message brut ni le code saisi. */
export function stepUpErrorKey(error: unknown): "invalid" | "locked" | "notEnabled" | "impersonation" | "session" | "network" | "generic" {
  if (!(error instanceof ApiError)) return "generic";
  if (error.code === "iam.mfa_invalid_code") return "invalid";
  if (error.code === "iam.too_many_attempts" || error.status === 429) return "locked";
  if (error.code === "iam.mfa_not_enabled") return "notEnabled";
  if (error.code === "iam.impersonation_forbidden") return "impersonation";
  if (error.status === 401) return "session";
  if (error.code === ClientErrorCode.NETWORK || error.code === ClientErrorCode.TIMEOUT) return "network";
  return "generic";
}

export interface StepUpDialogProps {
  open: boolean;
  /** Vérification en cours (bouton désactivé, annonce « Vérification… »). */
  pending: boolean;
  /** Dernière erreur de vérification (le dialogue reste ouvert pour une nouvelle saisie). */
  error: unknown;
  /** Soumet le code ; le hook ferme le dialogue et rejoue l'action quand la vérification réussit. */
  onSubmit: (code: string) => void;
  onCancel: () => void;
}

/**
 * Fenêtre de confirmation d'identité (code TOTP) affichée quand une action sensible est refusée en `*.mfa_required`.
 *
 * Accessibilité : fenêtre modale Radix (focus piégé, Échap, retour du focus au déclencheur), champ libellé et relié à
 * son aide/erreur, résultat annoncé dans une région `aria-live`, saisie numérique à auto-complétion « code à usage
 * unique ». Le code n'est jamais écrit dans l'URL, le stockage ou les journaux : il vit dans l'état du composant et est
 * effacé à la fermeture et après chaque échec.
 */
export function StepUpDialog({ open, pending, error, onSubmit, onCancel }: StepUpDialogProps) {
  const t = useTranslations("v2StepUp");
  const tActions = useTranslations("actions");
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);

  // Efface le code à la fermeture et après chaque échec (un code est à usage unique : le garder ne sert à rien).
  useEffect(() => {
    if (!open) {
      setCode("");
      setTouched(false);
    }
  }, [open]);
  useEffect(() => {
    if (error) {
      setCode("");
      setTouched(false);
      inputRef.current?.focus();
    }
  }, [error]);

  const normalized = code.replace(/\s+/g, "");
  const formatError = touched && !CODE.test(normalized);
  const errorKey = error ? stepUpErrorKey(error) : null;
  const locked = errorKey === "locked";
  const blocked = errorKey === "notEnabled" || errorKey === "impersonation";

  function submit(e: FormEvent) {
    e.preventDefault();
    // Les événements React traversent les portails : sans cela, l'envoi bubble vers le formulaire de l'écran appelant.
    e.stopPropagation();
    setTouched(true);
    if (!CODE.test(normalized) || pending || locked || blocked) return;
    onSubmit(normalized);
  }

  const inputId = `${uid}-code`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const message = formatError ? t("errors.format") : errorKey ? t(`errors.${errorKey}`) : null;

  return (
    <ModalDialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)} title={t("title")} description={t("description")}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="block text-sm font-medium leading-none">
            {t("codeLabel")}
            <span className="sr-only"> ({t("required")})</span>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            pattern="[0-9 ]*"
            value={code}
            disabled={pending || locked || blocked}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
            aria-required="true"
            aria-invalid={message ? true : undefined}
            aria-describedby={[hintId, message ? errorId : null].filter(Boolean).join(" ")}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tabular-nums tracking-[0.3em] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {t("codeHint")}
          </p>
        </div>

        {/* Région annoncée à chaque changement : erreur de saisie, verrouillage, vérification en cours. */}
        <div id={errorId} role={message ? "alert" : undefined} aria-live="assertive" className={message ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" : "sr-only"}>
          {message}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("verifying") : ""}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={pending} className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {tActions("cancel")}
          </button>
          <button
            type="submit"
            disabled={pending || locked || blocked}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            {t("submit")}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
