"use client";

/**
 * Élévation d'authentification (step-up MFA) : `POST /api/v1/iam/mfa/step-up` (contrat
 * `MfaStepUpRequestSchema` / `MfaStepUpResponseSchema`). Le code TOTP n'est ni conservé, ni journalisé, ni mis en cache :
 * il n'existe que le temps de l'appel. Le serveur marque la SESSION comme élevée pour une fenêtre courte (aucun jeton
 * n'est renvoyé : la fenêtre est lue en base à chaque requête).
 */

import { MfaStepUpResponseSchema, type MfaStepUpResponse } from "@ecoledigitale/contracts/v2/iam";
import { useApiAction } from "./actions";

export const STEP_UP_PATH = "/api/v1/iam/mfa/step-up";

export function useStepUpVerify() {
  return useApiAction<MfaStepUpResponse, { code: string }>({
    path: STEP_UP_PATH,
    body: (v) => ({ code: v.code }),
    schema: MfaStepUpResponseSchema,
  });
}

export type { MfaStepUpResponse };
