"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { AuthShell, FormAlert } from "./AuthShell";
import { TextField } from "./fields";
import { explainIamCode, explainIamError, iamApi, type MfaEnrollment } from "./iam-api";
import { useIamSession } from "./useIamSession";

type Panel = "idle" | "enroll" | "codes" | "disable";

/** Sécurité du compte : changement de mot de passe, activation / désactivation de la vérification en deux étapes. */
export function SecurityPage() {
  const { session, status, update } = useIamSession();
  const [panel, setPanel] = useState<Panel>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Mot de passe
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  // MFA
  const [enrollPassword, setEnrollPassword] = useState("");
  const [enrollment, setEnrollment] = useState<(MfaEnrollment & { qr: string }) | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const token = session?.jwtToken;
  const mfaEnabled = session?.mfaEnabled === true;

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(explainIamError(e));
    } finally {
      setBusy(false);
    }
  };

  /** Les actions de session (`update`) rapportent leur erreur dans la session : on la lit et on l'efface. */
  const outcome = async (data: Record<string, unknown>): Promise<string | null> => {
    const updated = (await update(data)) as unknown as { iamError?: { code: string; retryAfterSec?: number | null } } | null | undefined;
    const err = updated?.iamError;
    if (err) {
      await update({ action: "clear-error" });
      return explainIamCode(err.code, err.retryAfterSec);
    }
    return null;
  };

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const failure = await outcome({ action: "change-password", currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      if (failure) setError(failure);
      else setNotice("Mot de passe modifié. Vos autres appareils ont été déconnectés.");
    });
  };

  const beginEnrollment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    void guard(async () => {
      const result = await iamApi.beginMfaEnrollment(token, enrollPassword);
      setEnrollPassword("");
      setEnrollment({ ...result, qr: await QRCode.toDataURL(result.otpauthUri, { margin: 1, width: 192 }) });
      setCode("");
      setPanel("enroll");
    });
  };

  const confirmEnrollment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    void guard(async () => {
      const result = await iamApi.confirmMfaEnrollment(token, code.replace(/\s+/g, ""));
      setCodes(result.recoveryCodes);
      setEnrollment(null);
      setPanel("codes");
      await update({ action: "mfa-enabled" });
    });
  };

  const disable = (e: React.FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const value = disableCode.replace(/\s+/g, "");
      const failure = await outcome({ action: "disable-mfa", password: disablePassword, ...(useRecovery ? { recoveryCode: disableCode.trim() } : { code: value }) });
      setDisablePassword("");
      setDisableCode("");
      if (failure) setError(failure);
      else {
        setNotice("Vérification en deux étapes désactivée. Vos autres appareils ont été déconnectés.");
        setPanel("idle");
      }
    });
  };

  if (status !== "authenticated") return <AuthShell title="Sécurité du compte">{null}</AuthShell>;

  return (
    <AuthShell title="Sécurité du compte" description="Mot de passe et vérification en deux étapes." wide>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {notice ? <FormAlert kind="success">{notice}</FormAlert> : null}

      <section aria-labelledby="sec-password" className="space-y-3 rounded-lg border p-4">
        <h2 id="sec-password" className="text-lg font-medium">
          Mot de passe
        </h2>
        <form onSubmit={changePassword} className="space-y-3" noValidate>
          <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" hint="12 caractères minimum, différent de l'ancien." value={next} onChange={(e) => setNext(e.target.value)} required />
          <TextField label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" error={confirm && confirm !== next ? "Les mots de passe ne correspondent pas." : null} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button type="submit" className="h-11 w-full sm:w-auto" disabled={busy || !current || !next || next !== confirm}>
            Changer le mot de passe
          </Button>
        </form>
      </section>

      <section aria-labelledby="sec-mfa" className="space-y-3 rounded-lg border p-4">
        <h2 id="sec-mfa" className="text-lg font-medium">
          Vérification en deux étapes
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="mfa-status">
          {mfaEnabled ? "Activée : un code de votre application d'authentification est demandé à chaque connexion." : "Désactivée. Elle est obligatoire pour certains rôles (propriétaire, administrateur…)."}
        </p>

        {panel === "idle" && !mfaEnabled ? (
          <form onSubmit={beginEnrollment} className="space-y-3" noValidate>
            <TextField label="Votre mot de passe (pour confirmer)" type="password" autoComplete="current-password" value={enrollPassword} onChange={(e) => setEnrollPassword(e.target.value)} required />
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={busy || !enrollPassword}>
              Activer
            </Button>
          </form>
        ) : null}

        {panel === "enroll" && enrollment ? (
          <form onSubmit={confirmEnrollment} className="space-y-3" noValidate>
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrollment.qr} width={192} height={192} alt="QR code à scanner avec votre application d'authentification" className="rounded-md border bg-white p-2" />
              <details className="w-full text-sm">
                <summary className="cursor-pointer py-1">Saisie manuelle de la clé</summary>
                <p className="mt-2 break-all rounded-md bg-muted p-2 font-mono text-xs">{enrollment.secret}</p>
              </details>
            </div>
            <TextField label="Code à 6 chiffres" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={busy || code.replace(/\s+/g, "").length !== 6}>
              Confirmer l&apos;activation
            </Button>
          </form>
        ) : null}

        {panel === "codes" ? (
          <div className="space-y-3">
            <FormAlert kind="success">Vérification en deux étapes activée. Conservez vos codes de secours : ils ne seront plus affichés.</FormAlert>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Codes de secours">
              {codes.map((c) => (
                <li key={c} className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-sm tracking-wider">
                  {c}
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" className="h-11" onClick={() => { setCodes([]); setPanel("idle"); }}>
              J&apos;ai noté mes codes
            </Button>
          </div>
        ) : null}

        {panel === "idle" && mfaEnabled ? (
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setPanel("disable")}>
            Désactiver…
          </Button>
        ) : null}

        {panel === "disable" ? (
          <form onSubmit={disable} className="space-y-3" noValidate>
            <TextField label="Votre mot de passe" type="password" autoComplete="current-password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
            <TextField label={useRecovery ? "Code de secours" : "Code à 6 chiffres"} inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 16 : 7} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} required />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" className="h-11" disabled={busy || !disablePassword || disableCode.trim().length < 6}>
                Désactiver la vérification
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => { setUseRecovery(!useRecovery); setDisableCode(""); }}>
                {useRecovery ? "Utiliser mon application" : "Utiliser un code de secours"}
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setPanel("idle")}>
                Annuler
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </AuthShell>
  );
}
