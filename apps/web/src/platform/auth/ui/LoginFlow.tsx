"use client";

/**
 * Connexion V2 (module iam) : identifiants -> (défi MFA | enrôlement MFA + codes de secours) -> espace du rôle.
 *
 * Tout passe par NextAuth (`signIn`) : les jetons d'étape (défi, enrôlement) sont courts et à usage unique, aucune
 * session partielle n'existe, et le refresh token reste côté serveur. Voir platform/auth/iam-next-auth.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { saveToken } from "@/lib/jwt-storage";
import { activeRoleOf, routeForRole } from "@/lib/role-landing";
import { resolveBrowserTenant } from "@/platform/tenant/browser";
import { AuthShell, FormAlert } from "./AuthShell";
import { TextField } from "./fields";
import { IamClientError, explainIamError, iamApi } from "./iam-api";

type Step =
  | { kind: "credentials" }
  | { kind: "challenge"; token: string }
  | { kind: "enroll"; token: string; secret: string; uri: string; qr: string }
  | { kind: "recovery"; codes: string[] };

const GENERIC_ERROR = "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe.";

/** Traduit l'erreur renvoyée par NextAuth (`result.error`) : jamais plus d'information que l'API n'en donne. */
export function describeSignInError(error: string): { message: string; step?: "challenge" | "enroll"; token?: string } {
  if (error.startsWith("MFA_REQUIRED:")) return { message: "", step: "challenge", token: error.slice("MFA_REQUIRED:".length) };
  if (error.startsWith("MFA_ENROLLMENT_REQUIRED:")) return { message: "", step: "enroll", token: error.slice("MFA_ENROLLMENT_REQUIRED:".length) };
  if (error.startsWith("RATE_LIMITED:")) {
    const minutes = Math.max(1, Math.ceil(Number(error.slice("RATE_LIMITED:".length)) / 60) || 1);
    return { message: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.` };
  }
  if (error === "NO_ACCESS") return { message: "Aucun accès actif pour cet établissement." };
  if (error === "UNREACHABLE" || error === "UNAVAILABLE") return { message: "Service d'authentification indisponible. Réessayez dans un instant." };
  return { message: GENERIC_ERROR };
}

export function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { update, status } = useSession();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLDivElement>(null);
  const expired = params?.get("expired") === "1";
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

  // Le focus suit l'étape (lecteurs d'écran et clavier) : le conteneur de l'étape reçoit le focus à chaque changement.
  useEffect(() => {
    heading.current?.focus();
  }, [step.kind]);

  const finish = useCallback(async () => {
    const session = await getSession();
    const s = session as unknown as { jwtToken?: string; requiresRoleSelection?: boolean } | null;
    if (s?.jwtToken) {
      saveToken(s.jwtToken);
      localStorage.removeItem("superAdminToken");
      localStorage.removeItem("superAdminEmail");
      localStorage.removeItem("superAdminSelectedTenant");
    }
    router.replace(s?.requiresRoleSelection ? "/select-role" : routeForRole(activeRoleOf(session)));
    router.refresh();
  }, [router]);

  const afterSignIn = useCallback(
    async (result: Awaited<ReturnType<typeof signIn>>) => {
      if (!result) return setError(GENERIC_ERROR);
      if (result.error) {
        const info = describeSignInError(result.error);
        if (info.step === "challenge" && info.token) {
          setCode("");
          setUseRecovery(false);
          return setStep({ kind: "challenge", token: info.token });
        }
        if (info.step === "enroll" && info.token) {
          const enrollment = await iamApi.beginMfaEnrollment(info.token);
          const qr = await QRCode.toDataURL(enrollment.otpauthUri, { margin: 1, width: 192 });
          setCode("");
          return setStep({ kind: "enroll", token: info.token, secret: enrollment.secret, uri: enrollment.otpauthUri, qr });
        }
        return setError(info.message);
      }
      const session = (await getSession()) as unknown as { recoveryCodes?: string[] } | null;
      if (session?.recoveryCodes && session.recoveryCodes.length > 0) {
        setStep({ kind: "recovery", codes: session.recoveryCodes });
        return;
      }
      await finish();
    },
    [finish],
  );

  // Retour de la connexion Google (voir iam-next-auth.ts, `createGoogleSignIn`) : la session est ouverte (`social=1`), ou une
  // étape MFA / une erreur est portée par l'URL. Les jetons d'étape sont retirés de la barre d'adresse dès leur lecture.
  useEffect(() => {
    const mfa = params?.get("mfa");
    const enroll = params?.get("enroll");
    const err = params?.get("error");
    if (mfa || enroll || err) window.history.replaceState(window.history.state, "", window.location.pathname);
    if (mfa) {
      setStep({ kind: "challenge", token: mfa });
    } else if (enroll) {
      void (async () => {
        try {
          const enrollment = await iamApi.beginMfaEnrollment(enroll);
          const qr = await QRCode.toDataURL(enrollment.otpauthUri, { margin: 1, width: 192 });
          setStep({ kind: "enroll", token: enroll, secret: enrollment.secret, uri: enrollment.otpauthUri, qr });
        } catch (e) {
          setError(explainIamError(e));
        }
      })();
    } else if (err) {
      setError(
        err === "NO_ACCESS"
          ? "Aucun compte actif n'est associé à cette adresse Google. Contactez votre établissement."
          : err === "RATE_LIMITED"
            ? "Trop de tentatives. Réessayez dans quelques minutes."
            : err === "GOOGLE_UNVERIFIED"
              ? "Votre adresse Google n'est pas vérifiée."
              : "La connexion avec Google a échoué. Réessayez.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params?.get("social") === "1" && status === "authenticated") void finish();
  }, [params, status, finish]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof IamClientError ? explainIamError(e) : "Erreur de connexion. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // Le sous-domaine (ou NEXT_PUBLIC_TENANT_SLUG) désigne l'établissement visé quand l'identité en a plusieurs.
      const tenant = resolveBrowserTenant();
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        ...(tenant?.slug && (tenant.source === "subdomain" || tenant.source === "custom-domain" || tenant.source === "env") ? { tenantSlug: tenant.slug } : {}),
        redirect: false,
      });
      setPassword("");
      await afterSignIn(result);
    });
  };

  const submitChallenge = (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "challenge") return;
    void run(async () => {
      const value = code.trim();
      const result = await signIn("iam-mfa", {
        challengeToken: step.token,
        ...(useRecovery ? { recoveryCode: value } : { code: value.replace(/\s+/g, "") }),
        redirect: false,
      });
      if (result?.error) {
        const info = describeSignInError(result.error);
        setError(info.message === GENERIC_ERROR ? (useRecovery ? "Code de secours invalide." : "Code invalide. Vérifiez l'heure de votre téléphone.") : info.message);
        return;
      }
      await afterSignIn(result);
    });
  };

  const submitEnrollment = (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "enroll") return;
    void run(async () => {
      const result = await signIn("iam-enroll", { enrollmentToken: step.token, code: code.replace(/\s+/g, ""), redirect: false });
      if (result?.error) {
        setError("Code invalide. Vérifiez l'heure de votre téléphone et réessayez.");
        return;
      }
      await afterSignIn(result);
    });
  };

  const acknowledgeCodes = () =>
    void run(async () => {
      await update({ action: "ack-recovery-codes" });
      await finish();
    });

  if (step.kind === "recovery") {
    return (
      <AuthShell title="Codes de secours" description="Conservez ces codes en lieu sûr. Chacun ne sert qu'une fois si vous perdez l'accès à votre application d'authentification.">
        <div ref={heading} tabIndex={-1} className="outline-none">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Codes de secours">
            {step.codes.map((c) => (
              <li key={c} className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-sm tracking-wider">
                {c}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">Ils ne seront plus affichés.</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>J&apos;ai noté mes codes de secours dans un endroit sûr.</span>
        </label>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Button type="button" className="h-11 w-full" disabled={!saved || busy} onClick={acknowledgeCodes}>
          {busy ? "Un instant…" : "Continuer"}
        </Button>
      </AuthShell>
    );
  }

  if (step.kind === "enroll") {
    return (
      <AuthShell title="Activer la vérification en deux étapes" description="Votre rôle l'exige. Scannez le QR code avec une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…), puis saisissez le code à 6 chiffres.">
        <div ref={heading} tabIndex={-1} className="flex flex-col items-center gap-3 outline-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.qr} width={192} height={192} alt="QR code à scanner avec votre application d'authentification" className="rounded-md border bg-white p-2" />
          <details className="w-full text-sm">
            <summary className="cursor-pointer py-1">Saisie manuelle de la clé</summary>
            <p className="mt-2 break-all rounded-md bg-muted p-2 font-mono text-xs" data-testid="mfa-secret">
              {step.secret}
            </p>
          </details>
        </div>
        <form onSubmit={submitEnrollment} className="space-y-4" noValidate>
          <TextField label="Code à 6 chiffres" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || code.replace(/\s+/g, "").length !== 6}>
            {busy ? "Vérification…" : "Activer et continuer"}
          </Button>
        </form>
      </AuthShell>
    );
  }

  if (step.kind === "challenge") {
    return (
      <AuthShell title="Vérification en deux étapes" description={useRecovery ? "Saisissez l'un de vos codes de secours." : "Saisissez le code à 6 chiffres de votre application d'authentification."}>
        <form onSubmit={submitChallenge} className="space-y-4" noValidate>
          <div ref={heading} tabIndex={-1} className="outline-none">
            <TextField
              label={useRecovery ? "Code de secours" : "Code à 6 chiffres"}
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="off"
              maxLength={useRecovery ? 16 : 7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || code.trim().length < 6}>
            {busy ? "Vérification…" : "Valider"}
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" className="min-h-11 text-primary underline-offset-4 hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(""); }}>
              {useRecovery ? "Utiliser mon application" : "Utiliser un code de secours"}
            </button>
            <button type="button" className="min-h-11 text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setStep({ kind: "credentials" }); setError(""); }}>
              Recommencer
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Connexion" description="Accédez à votre espace éducatif.">
      <form onSubmit={submitCredentials} className="space-y-4" noValidate>
        <div ref={heading} tabIndex={-1} className="outline-none">
          {expired ? <FormAlert kind="info">Votre session a pris fin. Reconnectez-vous.</FormAlert> : null}
        </div>
        <TextField label="Adresse e-mail" type="email" autoComplete="username" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Button type="submit" className="h-11 w-full" disabled={busy || !email || !password}>
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
        {googleEnabled ? (
          <Button type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={() => void signIn("google", { callbackUrl: "/login?social=1" })}>
            Continuer avec Google
          </Button>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link href="/v2/forgot-password" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
            Mot de passe oublié ?
          </Link>
          <Link href="/register" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
            S&apos;inscrire en ligne
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
