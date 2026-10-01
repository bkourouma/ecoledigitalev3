"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { AuthShell, FormAlert } from "./AuthShell";
import { explainIamError, iamApi } from "./iam-api";
import { useIamSession } from "./useIamSession";

type SessionRow = Awaited<ReturnType<typeof iamApi.listSessions>>["sessions"][number];

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dateFormat.format(t) : "—";
};

/** Résumé lisible du navigateur sans exposer la chaîne brute (déjà bornée et nettoyée par l'API). */
export function describeDevice(row: Pick<SessionRow, "deviceName" | "userAgent">): string {
  if (row.deviceName) return row.deviceName;
  const ua = row.userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "appareil inconnu";
  return `${browser} sur ${os}`;
}

/** « Mes sessions actives » : liste, révocation d'une session, déconnexion de tous les appareils. */
export function SessionsPage() {
  const { status } = useIamSession();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await iamApi.listSessions()).sessions);
      setError("");
    } catch (e) {
      setError(explainIamError(e));
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const revoke = async (row: SessionRow) => {
    setBusy(row.id);
    setNotice("");
    try {
      if (row.current) {
        // Déconnexion de CET appareil : `signOut` révoque la session IAM côté serveur (events.signOut) puis efface le cookie.
        // Révoquer d'abord par l'API laisserait des requêtes en vol avec un jeton mort (redirection brutale avant l'effacement du cookie).
        await signOut({ callbackUrl: "/login" });
        return;
      }
      await iamApi.revokeSession(row.id);
      setNotice("Session révoquée.");
      await load();
    } catch (e) {
      setError(explainIamError(e));
    } finally {
      setBusy(null);
    }
  };

  const revokeAll = async () => {
    setBusy("all");
    try {
      await iamApi.logoutAll();
      await signOut({ callbackUrl: "/login" });
    } catch (e) {
      setError(explainIamError(e));
      setBusy(null);
    }
  };

  return (
    <AuthShell title="Mes sessions actives" description="Appareils connectés à votre compte dans cet établissement. Révoquez ceux que vous ne reconnaissez pas." wide>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {notice ? <FormAlert kind="success">{notice}</FormAlert> : null}
      {rows === null && !error ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      <ul className="space-y-3" aria-label="Sessions actives">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="session-row">
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="font-medium">
                {describeDevice(row)}
                {row.current ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Cet appareil</span> : null}
                {row.kind === "impersonation" ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Assistance</span> : null}
              </p>
              <p className="text-muted-foreground">
                {row.ip ?? "adresse inconnue"} · rôle {row.activeRole}
                {row.mfaVerified ? " · 2 étapes" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Connecté le {when(row.createdAt)} · actif le {when(row.lastSeenAt)}
              </p>
            </div>
            <Button type="button" variant={row.current ? "outline" : "destructive"} className="h-11 shrink-0" disabled={busy !== null} onClick={() => void revoke(row)}>
              {busy === row.id ? "…" : row.current ? "Me déconnecter" : "Révoquer"}
              <span className="sr-only"> la session {describeDevice(row)}</span>
            </Button>
          </li>
        ))}
      </ul>
      {rows && rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune session active.</p> : null}
      <Button type="button" variant="outline" className="h-11 w-full" disabled={busy !== null} onClick={() => void revokeAll()}>
        {busy === "all" ? "Déconnexion…" : "Déconnecter tous mes appareils"}
      </Button>
    </AuthShell>
  );
}
