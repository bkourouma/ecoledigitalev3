"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { apiErrorToFieldErrors } from "./validation";
import { useDescribeError } from "./errors";

/** Fenêtre modale accessible (piège de focus, Échap, retour du focus) avec bouton de fermeture traduit. */
export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("actions");
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto rounded-t-lg border bg-background p-5 shadow-lg focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg",
            className,
          )}
        >
          <DialogPrimitive.Title className="pr-12 text-lg font-semibold leading-tight sm:pr-8">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          <div className="mt-4">{children}</div>
          <DialogPrimitive.Close aria-label={t("close")} className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-3 sm:top-3 sm:h-9 sm:w-9">
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Confirmation avec motif. Les contrats exigent un motif de 5 à 500 caractères pour les actions sensibles (clôture,
 * réouverture, retrait, transfert…) : la règle de forme vient du contrat, la décision reste à l'API.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  confirmLabel,
  destructive = false,
  reasonRequired = true,
  minLength = 5,
  maxLength = 500,
  isPending = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  reasonLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  reasonRequired?: boolean;
  minLength?: number;
  maxLength?: number;
  isPending?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const t = useTranslations("v2Ui.reason");
  const tActions = useTranslations("actions");
  const describe = useDescribeError();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const tooShort = (reasonRequired || trimmed.length > 0) && trimmed.length < minLength;
  const apiFieldError = apiErrorToFieldErrors(error).reason;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (tooShort) return;
    void onConfirm(trimmed);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("");
      setTouched(false);
    }
    onOpenChange(next);
  }

  return (
    <ModalDialog open={open} onOpenChange={handleOpenChange} title={title} description={description}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="reason-input" className="block text-sm font-medium">
            {reasonLabel}
            {reasonRequired ? <span className="sr-only"> ({t("required")})</span> : null}
          </label>
          <textarea
            id="reason-input"
            rows={3}
            maxLength={maxLength}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={(touched && tooShort) || undefined}
            aria-describedby="reason-help"
            className="flex min-h-[5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          />
          <p id="reason-help" className={cn("text-xs", touched && tooShort ? "font-medium text-destructive" : "text-muted-foreground")} role={touched && tooShort ? "alert" : undefined}>
            {touched && tooShort ? t("tooShort", { min: minLength }) : t("hint", { min: minLength, max: maxLength })}
          </p>
          {apiFieldError ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {apiFieldError}
            </p>
          ) : null}
        </div>
        {error && !apiFieldError ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {describe(error)}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => handleOpenChange(false)} disabled={isPending} className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {tActions("cancel")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * Formulaire en fenêtre modale : pied de page Annuler / Valider, état d'envoi, erreur de l'API (message du serveur) au-dessus
 * des boutons. Les erreurs PAR CHAMP sont affichées par les champs eux-mêmes (`FormField`).
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  isPending = false,
  error,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit: () => void;
  isPending?: boolean;
  error?: unknown;
  children: ReactNode;
  wide?: boolean;
}) {
  const tActions = useTranslations("actions");
  const describe = useDescribeError();
  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={title} description={description} className={wide ? "sm:max-w-2xl" : undefined}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        {children}
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {describe(error)}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onOpenChange(false)} disabled={isPending} className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {tActions("cancel")}
          </button>
          <button type="submit" disabled={isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
