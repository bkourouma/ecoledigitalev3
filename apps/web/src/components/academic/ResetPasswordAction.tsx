"use client";

import { useState } from "react";
import { Button, Alert, AlertTitle, AlertDescription } from "@ecoledigitale/ui";
import { KeyRound, Copy, Check, Loader2, AlertCircle } from "lucide-react";

/**
 * Réinitialisation du mot de passe d'un compte, depuis la fiche de la personne.
 *
 * Les comptes créés depuis l'administration reçoivent un mot de passe généré,
 * envoyé par e-mail. Quand l'envoi échoue — SMTP non configuré, adresse
 * invalide, boîte inaccessible — le compte devenait définitivement
 * inutilisable : l'API savait réinitialiser depuis toujours, mais aucun écran
 * n'appelait cette route.
 *
 * Le mot de passe n'est montré qu'une fois, juste après la réinitialisation.
 * Pour le revoir, il faut en générer un nouveau.
 */

type Props = {
  /** Déclenche la réinitialisation et renvoie le nouveau mot de passe. */
  onReset: () => Promise<string>;
  /** Nom de la personne, affiché dans la demande de confirmation. */
  personLabel: string;
  className?: string;
};

export function ResetPasswordAction({ onReset, personLabel, className }: Props) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "loading" | "done">("idle");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const lancer = async () => {
    setPhase("loading");
    setError("");
    try {
      setPassword(await onReset());
      setPhase("done");
    } catch (e: any) {
      setError(e?.message || "Impossible de réinitialiser le mot de passe.");
      setPhase("idle");
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le mot de passe reste lisible à l'écran.
    }
  };

  if (phase === "done") {
    return (
      <Alert className={className}>
        <KeyRound className="h-4 w-4" />
        <AlertTitle>Nouveau mot de passe</AlertTitle>
        <AlertDescription>
          <div className="flex items-center gap-2 mt-2">
            <code className="px-2 py-1 rounded bg-muted font-mono text-sm select-all">
              {password}
            </code>
            <Button variant="outline" size="sm" onClick={copier}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="ml-2">{copied ? "Copié" : "Copier"}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Notez-le maintenant et transmettez-le à {personLabel} : il ne sera plus
            affiché. L&apos;ancien mot de passe ne fonctionne plus.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === "confirm") {
    return (
      <Alert className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Réinitialiser le mot de passe de {personLabel} ?</AlertTitle>
        <AlertDescription>
          <p className="text-sm">
            Un nouveau mot de passe sera généré et affiché une seule fois.
            L&apos;ancien cessera immédiatement de fonctionner.
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={lancer}>
              Réinitialiser
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
              Annuler
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        size="sm"
        disabled={phase === "loading"}
        onClick={() => setPhase("confirm")}
      >
        {phase === "loading" ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <KeyRound className="h-4 w-4 mr-2" />
        )}
        Réinitialiser le mot de passe
      </Button>
      {error ? <p className="text-sm text-destructive mt-2">{error}</p> : null}
    </div>
  );
}
