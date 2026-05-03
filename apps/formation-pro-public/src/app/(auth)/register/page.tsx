"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { registerSchema } from "@/lib/schemas";
import { AuthProviderButtons } from "@/components/auth/AuthProviderButtons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RegisterValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterContent />
    </Suspense>
  );
}

function RegisterContent() {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/compte";
  const [successMessage, setSuccessMessage] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  async function onSubmit(values: RegisterValues) {
    setSuccessMessage("");
    setRegisteredEmail("");

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError("root", { message: payload?.error || "Création du compte impossible." });
      return;
    }

    reset();
    setRegisteredEmail(values.email);
    setSuccessMessage(payload?.message || "Compte créé.");
  }

  return (
    <div className="container flex min-h-[72vh] items-center justify-center py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-3xl">Créer un compte apprenant</CardTitle>
          <CardDescription>
            Choisissez Google pour un accès immédiat ou créez un compte email local
            que vous confirmerez par email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthProviderButtons callbackUrl={nextUrl} registerTone />

          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>Ou créer un compte email</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Prénom</label>
              <Input {...register("prenom")} />
              {errors.prenom ? <p className="text-sm text-destructive">{errors.prenom.message}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nom</label>
              <Input {...register("nom")} />
              {errors.nom ? <p className="text-sm text-destructive">{errors.nom.message}</p> : null}
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" {...register("email")} />
              {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Téléphone</label>
              <Input {...register("telephone")} />
              {errors.telephone ? <p className="text-sm text-destructive">{errors.telephone.message}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mot de passe</label>
              <Input type="password" {...register("password")} />
              {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : null}
            </div>
            {errors.root ? <p className="text-sm text-destructive md:col-span-2">{errors.root.message}</p> : null}
            {successMessage ? <p className="text-sm text-emerald-700 md:col-span-2">{successMessage}</p> : null}
            <Button type="submit" className="md:col-span-2" disabled={isSubmitting}>
              {isSubmitting ? "Création..." : "Créer mon compte"}
            </Button>
          </form>

          {registeredEmail ? (
            <div className="rounded-[1.5rem] bg-muted p-4 text-sm text-muted-foreground">
              <p>
                Compte créé pour <span className="font-medium text-foreground">{registeredEmail}</span>.
                Ouvrez votre email de vérification ou demandez un nouveau lien si besoin.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link href={`/verify?email=${encodeURIComponent(registeredEmail)}`}>
                    Vérifier mon email
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/login">Aller à la connexion</Link>
                </Button>
              </div>
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Déjà inscrit ? <Link href="/login" className="text-primary">Connectez-vous</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterFallback() {
  return (
    <div className="container flex min-h-[72vh] items-center justify-center py-10">
      <Card className="w-full max-w-2xl">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Chargement de la page d&apos;inscription...
        </CardContent>
      </Card>
    </div>
  );
}
