"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthShell, FormAlert } from "./AuthShell";
import { TextField } from "./fields";
import { explainIamError, iamApi } from "./iam-api";

/** « Mot de passe oublié » : réponse identique que le compte existe ou non (l'API renvoie toujours 202). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await iamApi.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(explainIamError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Mot de passe oublié" description="Saisissez votre adresse e-mail : si un compte existe, un lien de réinitialisation valable 30 minutes vous sera envoyé.">
      {sent ? (
        <FormAlert kind="success">Si un compte existe pour cette adresse, un e-mail vient d&apos;être envoyé. Pensez à vérifier vos courriers indésirables.</FormAlert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField label="Adresse e-mail" type="email" autoComplete="username" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || !email}>
            {busy ? "Envoi…" : "Envoyer le lien"}
          </Button>
        </form>
      )}
      <Link href="/login" className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
        Retour à la connexion
      </Link>
    </AuthShell>
  );
}

/**
 * Définir un mot de passe avec un jeton : réinitialisation (`/v2/reset-password`, `/auth/reset-password`) ou
 * invitation d'un nouveau membre (`/auth/invitation`) — même route d'API (`POST /iam/password/reset`).
 * Le jeton vient du lien reçu par e-mail (`?token=`) ; il est retiré de l'URL dès la lecture.
 */
export function SetPasswordPage({ mode }: { mode: "reset" | "invitation" }) {
  const params = useSearchParams();
  const [token] = useState(() => params?.get("token") ?? "");
  // Le jeton ne doit pas rester dans la barre d'adresse, l'historique ni un en-tête Referer : on l'en retire dès le montage.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return;
    setBusy(true);
    setError("");
    try {
      await iamApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(explainIamError(err));
    } finally {
      setPassword("");
      setConfirm("");
      setBusy(false);
    }
  };

  const title = mode === "invitation" ? "Activer votre compte" : "Nouveau mot de passe";
  if (!token && !done) {
    return (
      <AuthShell title={title}>
        <FormAlert>Ce lien est incomplet ou n&apos;est plus valable.</FormAlert>
        <Link href="/v2/forgot-password" className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
          Demander un nouveau lien
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} description={mode === "invitation" ? "Choisissez le mot de passe de votre compte." : "Choisissez un nouveau mot de passe. Vos autres appareils seront déconnectés."}>
      {done ? (
        <>
          <FormAlert kind="success">Mot de passe enregistré. Vous pouvez vous connecter.</FormAlert>
          <Link href="/login" className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Se connecter
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" hint="12 caractères minimum. Une phrase de passe est idéale." value={password} onChange={(e) => setPassword(e.target.value)} required />
          <TextField label="Confirmer le mot de passe" type="password" autoComplete="new-password" error={mismatch ? "Les mots de passe ne correspondent pas." : null} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || password.length === 0 || password !== confirm}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
