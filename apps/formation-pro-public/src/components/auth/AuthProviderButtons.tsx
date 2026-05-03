"use client";

import { useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AuthProviderButtons({
  callbackUrl,
  registerTone = false,
}: {
  callbackUrl: string;
  registerTone?: boolean;
}) {
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getProviders()
      .then((providers) => {
        if (active) {
          setGoogleEnabled(Boolean(providers?.google));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Button variant="outline" className="w-full" disabled>
        Chargement des options de connexion...
      </Button>
    );
  }

  if (!googleEnabled) {
    return (
      <p className="rounded-[1.5rem] border border-dashed border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        La connexion Google n&apos;est pas encore configurée sur cet environnement.
      </p>
    );
  }

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={() => signIn("google", { callbackUrl })}
    >
      {registerTone ? "M’inscrire avec Google" : "Continuer avec Google"}
    </Button>
  );
}
