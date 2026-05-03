import Link from "next/link";
import { ResendVerificationForm } from "@/components/auth/ResendVerificationForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { consumeVerificationToken } from "@/lib/verification";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;
  let state: "idle" | "success" | "expired" | "invalid" | "already-verified" = "idle";
  let emailHint = email || "";

  if (token) {
    const result = await consumeVerificationToken(token);
    state = result.state;
    emailHint = result.email || emailHint;
  }

  const title =
    state === "success"
      ? "Adresse vérifiée"
      : state === "already-verified"
        ? "Compte déjà actif"
        : state === "expired"
          ? "Lien expiré"
          : state === "invalid"
            ? "Lien invalide"
            : "Vérification email";

  const description =
    state === "success"
      ? "Votre compte est maintenant actif. Vous pouvez vous connecter et accéder à votre espace apprenant."
      : state === "already-verified"
        ? "Votre adresse était déjà vérifiée. Vous pouvez vous connecter sans attendre."
        : state === "expired"
          ? "Le lien reçu a expiré. Demandez simplement un nouveau lien de vérification."
          : state === "invalid"
            ? "Le lien reçu ne correspond plus à un token valide. Vous pouvez en demander un nouveau."
            : "Ouvrez le lien reçu par email pour confirmer votre compte et activer la connexion par mot de passe.";

  const showResend = state === "idle" || state === "expired" || state === "invalid";

  return (
    <div className="container flex min-h-[72vh] items-center justify-center py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-3xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showResend ? <ResendVerificationForm initialEmail={emailHint} /> : null}

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login">
                {state === "success" ? "Se connecter" : "Aller à la connexion"}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">Retour à l&apos;inscription</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
