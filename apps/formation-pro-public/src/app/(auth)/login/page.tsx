"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { loginSchema } from "@/lib/schemas";
import { AuthProviderButtons } from "@/components/auth/AuthProviderButtons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { z } from "zod";

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/compte";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues) {
    const result = await signIn("credentials", {
      ...values,
      redirect: false,
    });

    if (result?.error) {
      setError("root", {
        message: "Identifiants invalides ou email non vérifié.",
      });
      return;
    }

    router.push(nextUrl);
    router.refresh();
  }

  return (
    <div className="container flex min-h-[72vh] items-center justify-center py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-3xl">Connexion</CardTitle>
          <CardDescription>
            Connectez-vous avec Google ou avec votre compte email local pour
            retrouver vos commandes et votre espace apprenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthProviderButtons callbackUrl={nextUrl} />

          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>Ou avec votre email</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" {...register("email")} />
              {errors.email ? (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mot de passe</label>
              <Input type="password" {...register("password")} />
              {errors.password ? (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              ) : null}
            </div>
            {errors.root ? (
              <p className="text-sm text-destructive">{errors.root.message}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Connexion..." : "Se connecter"}
            </Button>
          </form>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Mot de passe oublié ?</span>
            <div className="flex gap-3">
              <Link href="/verify" className="text-primary">
                Vérifier un email
              </Link>
              <Link href="/register" className="text-primary">
                Créer un compte
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="container flex min-h-[72vh] items-center justify-center py-10">
      <Card className="w-full max-w-lg">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Chargement de votre espace de connexion...
        </CardContent>
      </Card>
    </div>
  );
}
