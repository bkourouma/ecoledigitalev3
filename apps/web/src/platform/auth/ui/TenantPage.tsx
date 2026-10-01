"use client";

import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveToken } from "@/lib/jwt-storage";
import { activeRoleOf, routeForRole } from "@/lib/role-landing";
import { AuthShell, FormAlert } from "./AuthShell";
import { TextField } from "./fields";
import { explainIamCode } from "./iam-api";
import { useIamSession } from "./useIamSession";

/**
 * Sélecteur d'établissement pour une identité multi-établissements (parent d'élèves dans plusieurs écoles, enseignant
 * vacataire…). Le changement ouvre une NOUVELLE session dans l'établissement choisi et révoque l'ancienne ; la
 * vérification en deux étapes est réévaluée (étape `mfa_required` -> code demandé ici).
 */
export function TenantPage() {
  const router = useRouter();
  const { session, status, update } = useIamSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  const tenants = session?.tenants ?? [];
  const pending = session?.iamPending;

  const land = async () => {
    const fresh = await getSession();
    const s = fresh as unknown as { jwtToken?: string; requiresRoleSelection?: boolean } | null;
    if (s?.jwtToken) saveToken(s.jwtToken);
    router.replace(s?.requiresRoleSelection ? "/select-role" : routeForRole(activeRoleOf(fresh)));
    router.refresh();
  };

  const choose = async (tenantId: string) => {
    setBusy(tenantId);
    setError("");
    try {
      const updated = (await update({ action: "switch-tenant", tenantId })) as unknown as { iamError?: { code: string; retryAfterSec?: number | null }; iamPending?: unknown; tenantId?: string } | null | undefined;
      if (updated?.iamError) {
        const failure = explainIamCode(updated.iamError.code, updated.iamError.retryAfterSec);
        await update({ action: "clear-error" });
        setError(failure);
        return;
      }
      if (updated?.iamPending) return; // le code MFA est demandé ci-dessous
      await land();
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setBusy("mfa");
    setError("");
    try {
      if (pending.kind === "mfa_enrollment_required") {
        setError("Ce rôle exige la vérification en deux étapes : activez-la depuis la page Sécurité de l'établissement d'origine.");
        return;
      }
      const result = await signIn("iam-mfa", { challengeToken: pending.token, code: code.replace(/\s+/g, ""), redirect: false });
      setCode("");
      if (result?.error) setError("Code invalide. Vérifiez l'heure de votre téléphone.");
      else await land();
    } finally {
      setBusy(null);
    }
  };

  if (status !== "authenticated") return <AuthShell title="Mes établissements">{null}</AuthShell>;

  return (
    <AuthShell title="Mes établissements" description="Choisissez l'établissement dans lequel travailler. Votre session actuelle sera remplacée." wide>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {pending && pending.kind === "mfa_required" ? (
        <form onSubmit={verify} className="space-y-3 rounded-lg border p-4" noValidate>
          <p className="text-sm">Ce changement demande votre code de vérification en deux étapes.</p>
          <TextField label="Code à 6 chiffres" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
          <Button type="submit" className="h-11" disabled={busy !== null || code.replace(/\s+/g, "").length !== 6}>
            Valider
          </Button>
        </form>
      ) : null}
      <ul className="space-y-2" aria-label="Établissements">
        {tenants.map((t) => {
          const current = t.id === session?.tenantId;
          return (
            <li key={t.id}>
              <Button type="button" variant={current ? "default" : "outline"} className="h-12 w-full justify-between" disabled={current || busy !== null} onClick={() => void choose(t.id)} aria-current={current ? "true" : undefined}>
                <span className="truncate">{t.name || t.slug}</span>
                <span className="text-xs">{current ? "Actuel" : busy === t.id ? "…" : "Choisir"}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {tenants.length <= 1 ? <p className="text-sm text-muted-foreground">Votre compte n&apos;a accès qu&apos;à un seul établissement.</p> : null}
    </AuthShell>
  );
}
