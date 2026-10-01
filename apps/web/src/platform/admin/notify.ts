"use client";

/**
 * Notifications de retour d'action. Pas de nouvelle bibliothèque : `sonner` est déjà monté dans `app/providers.tsx`
 * (`<SonnerToaster />`). Les erreurs restent AUSSI affichées dans l'écran (bandeau `role="alert"`) : un toast
 * disparaît, un message d'erreur de formulaire non.
 */

import { toast } from "sonner";

export function notifySuccess(message: string): void {
  toast.success(message);
}

export function notifyError(message: string): void {
  toast.error(message);
}
