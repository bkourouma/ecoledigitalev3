"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResendVerificationForm({
  initialEmail = "",
}: {
  initialEmail?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error || "Impossible de renvoyer le lien pour le moment.");
        return;
      }

      setMessage(
        payload?.message ||
          "Si un compte en attente existe, un nouveau lien vient d'être envoyé."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4 rounded-[1.5rem] bg-muted p-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label htmlFor="resend-email" className="text-sm font-medium">
          Renvoyer un lien de vérification
        </label>
        <Input
          id="resend-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="vous@exemple.com"
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <Button type="submit" variant="outline" disabled={isSubmitting || !email.trim()}>
        {isSubmitting ? "Envoi..." : "Recevoir un nouveau lien"}
      </Button>
    </form>
  );
}
