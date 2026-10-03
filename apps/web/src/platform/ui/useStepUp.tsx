"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/platform/api/errors";
import { useStepUpVerify } from "@/platform/v2/step-up";
import type { StepUpDialogProps } from "./StepUpDialog";

/** L'API refuse une action sensible faute de MFA satisfaite : `rbac.mfa_required`, `imports.mfa_required`, `iam.mfa_required`… */
export function isMfaRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code.endsWith("mfa_required");
}

interface Pending<T> {
  action: () => Promise<T>;
  original: unknown;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface UseStepUp {
  /**
   * Exécute `action`. Si l'API la refuse en `*.mfa_required`, demande un code TOTP, vérifie l'identité puis REJOUE
   * l'action UNE seule fois ; si cette relance échoue (même en `mfa_required`), son erreur est renvoyée telle quelle.
   * Annuler le dialogue renvoie l'erreur d'origine (l'écran garde son message habituel). Toute autre erreur passe sans
   * changement. Une seule élévation à la fois : une 2e action refusée pendant que le dialogue est ouvert reçoit son erreur.
   */
  run<T>(action: () => Promise<T>): Promise<T>;
  /** À étaler sur `<StepUpDialog {...dialogProps} />`. */
  dialogProps: StepUpDialogProps;
}

/**
 * Élévation d'authentification (step-up MFA) à brancher autour d'une action sensible :
 *
 *   const stepUp = useStepUp();
 *   await stepUp.run(() => replay.mutateAsync(vars));
 *   …
 *   <StepUpDialog {...stepUp.dialogProps} />
 *
 * Les permissions ne changent pas : le web ne décide de rien, il rejoue la même requête, que l'API autorise ou non.
 */
export function useStepUp(): UseStepUp {
  const verify = useStepUpVerify();
  const verifyAsync = verify.mutateAsync;
  const pendingRef = useRef<Pending<never> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Écran démonté pendant l'attente : on libère l'appelant avec l'erreur d'origine.
      const p = pendingRef.current;
      pendingRef.current = null;
      p?.reject(p.original);
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (e) {
      if (!isMfaRequiredError(e) || pendingRef.current) throw e;
      return new Promise<T>((resolve, reject) => {
        pendingRef.current = { action, original: e, resolve, reject } as unknown as Pending<never>;
        setError(null);
        setBusy(false);
        setOpen(true);
      });
    }
  }, []);

  const cancel = useCallback(() => {
    const p = pendingRef.current;
    if (!p || busy) return;
    pendingRef.current = null;
    setOpen(false);
    setError(null);
    p.reject(p.original);
  }, [busy]);

  const submit = useCallback(
    (code: string) => {
      const p = pendingRef.current;
      if (!p || busy) return;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          await verifyAsync({ code });
        } catch (e) {
          if (mounted.current) {
            setBusy(false);
            setError(e);
          }
          return; // le dialogue reste ouvert : nouvelle saisie possible
        }
        // Identité confirmée : on ferme, puis on rejoue l'action initiale UNE fois.
        pendingRef.current = null;
        if (mounted.current) {
          setBusy(false);
          setOpen(false);
        }
        try {
          p.resolve(await p.action());
        } catch (e) {
          p.reject(e);
        }
      })();
    },
    [busy, verifyAsync],
  );

  return { run, dialogProps: { open, pending: busy, error, onSubmit: submit, onCancel: cancel } };
}
