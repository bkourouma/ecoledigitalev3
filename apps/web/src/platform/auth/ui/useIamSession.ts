"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export interface IamSessionView {
  jwtToken?: string;
  jwtExpiresAt?: string;
  tenantId?: string;
  tenantSlug?: string;
  activeRole?: string;
  availableRoles?: string[];
  iamRoles?: string[];
  iamActiveRole?: string;
  tenants?: Array<{ id: string; slug: string; name: string }>;
  mfaEnabled?: boolean;
  recoveryCodes?: string[];
  iamPending?: { kind: "mfa_required" | "mfa_enrollment_required"; token: string };
  iamError?: { action: string; code: string; retryAfterSec?: number | null };
  iamExpired?: boolean;
  authVersion?: number;
}

/** Session NextAuth V2 : redirige vers la connexion si l'utilisateur n'est pas authentifié. */
export function useIamSession() {
  const router = useRouter();
  const { data, status, update } = useSession();
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);
  return { session: (data ?? null) as unknown as IamSessionView | null, status, update };
}
