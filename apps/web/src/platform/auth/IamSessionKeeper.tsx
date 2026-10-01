"use client";

/**
 * Garde la session IAM vivante côté navigateur (`NEXT_PUBLIC_AUTH_V2=1`) :
 *  - renouvelle le jeton d'accès avant son échéance (rotation du refresh faite par le SERVEUR via `update()`,
 *    sérialisée entre onglets : lib/iam-session.ts) ;
 *  - déconnecte proprement quand la session IAM n'existe plus (révoquée depuis un autre appareil, refresh réutilisé,
 *    accès suspendu) : le serveur ne peut plus la renouveler, ou le fetch-interceptor a signalé `ed:iam-session-ended`.
 * Ne rend rien. Sans effet hors V2 et pour une session ouverte avec un jeton legacy.
 */
import { useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { IAM_REFRESH_SKEW_SEC, expiresWithin, readSession, runExclusive } from "@/lib/iam-session";
import { saveToken } from "@/lib/jwt-storage";
import { isAuthV2 } from "./iam-config";

const RETRY_MS = 15_000;

export function IamSessionKeeper(): null {
  const { data: session, status, update } = useSession();
  const s = session as unknown as { jwtToken?: string; jwtExpiresAt?: string; iamExpired?: boolean; authVersion?: number } | null;

  // Session IAM terminée : retour à la connexion (le serveur révoque ce qui reste via `events.signOut`).
  useEffect(() => {
    if (!isAuthV2() || status !== "authenticated") return;
    if (s?.iamExpired) void signOut({ callbackUrl: "/login?expired=1" });
  }, [status, s?.iamExpired]);

  useEffect(() => {
    if (!isAuthV2()) return;
    const onEnded = () => void signOut({ callbackUrl: "/login?expired=1" });
    window.addEventListener("ed:iam-session-ended", onEnded);
    return () => window.removeEventListener("ed:iam-session-ended", onEnded);
  }, []);

  // Renouvellement planifié, toujours sous le verrou inter-onglets.
  useEffect(() => {
    if (!isAuthV2() || status !== "authenticated" || s?.authVersion !== 2 || s.iamExpired) return;
    const expiresAt = s.jwtExpiresAt ? Date.parse(s.jwtExpiresAt) : NaN;
    if (!Number.isFinite(expiresAt)) return;
    const delay = Math.max(1_000, expiresAt - Date.now() - IAM_REFRESH_SKEW_SEC * 1000);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await runExclusive(async () => {
          // Un autre onglet a pu renouveler entre-temps : on relit le cookie et on adopte son état sans tourner.
          const current = await readSession();
          if (current?.jwtToken && !expiresWithin(current, IAM_REFRESH_SKEW_SEC)) {
            saveToken(current.jwtToken);
            if (!cancelled) await update();
          } else if (!cancelled) {
            await update({ action: "refresh" });
          }
        });
      } catch {
        // Panne passagère : le prochain rendu (ou l'intercepteur) réessaiera.
        window.setTimeout(() => !cancelled && void update(), RETRY_MS);
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, s?.authVersion, s?.jwtExpiresAt, s?.iamExpired, update]);

  return null;
}
