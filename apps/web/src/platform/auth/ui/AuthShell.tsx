"use client";

import { useEffect, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useShellMenu } from "@/platform/shell/context";

/**
 * Cadre commun des pages d'authentification V2 : une colonne centrée, mobile d'abord, un seul `<main>` et un seul
 * `<h1>`. Le conteneur racine de l'application masque le défilement (`overflow-hidden`) : on le rétablit ici, comme
 * le fait la page de connexion historique, pour que le formulaire reste atteignable sur un petit écran / clavier ouvert.
 */
export function AuthShell({ title, description, children, wide = false }: { title: string; description?: string; children: ReactNode; wide?: boolean }) {
  // Dans la coque de navigation (sécurité du compte, membres : pages ouvertes depuis le menu), la page n'a ni son propre
  // `<main>` ni sa colonne plein écran : c'est la coque qui les fournit.
  const inShell = useShellMenu() !== null;
  useEffect(() => {
    if (inShell) return;
    const html = document.documentElement.style;
    const body = document.body.style;
    const saved = { hOverflow: html.overflow, hHeight: html.height, bOverflow: body.overflow, bOverflowY: body.overflowY, bHeight: body.height };
    html.overflow = "auto";
    html.height = "auto";
    body.overflow = "auto";
    body.overflowY = "auto";
    body.height = "auto";
    return () => {
      html.overflow = saved.hOverflow;
      html.height = saved.hHeight;
      body.overflow = saved.bOverflow;
      body.overflowY = saved.bOverflowY;
      body.height = saved.bHeight;
    };
  }, [inShell]);

  if (inShell) {
    return (
      <div className={`mx-auto w-full space-y-6 ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <Card variant="glass">
          <CardHeader>
            <h1 className="gradient-text text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-start justify-center bg-background px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <div className={`w-full space-y-6 ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <div className="flex items-center justify-center gap-3" aria-hidden="true">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-emerald-600 shadow-lg">
            <span className="text-lg font-bold text-white">ED</span>
          </div>
        </div>
        <Card variant="glass">
          <CardHeader>
            <h1 className="gradient-text text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

/** Message d'erreur / d'état annoncé aux lecteurs d'écran. */
export function FormAlert({ kind = "error", children, id }: { kind?: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const color = kind === "error" ? "text-red-700 bg-red-50 border-red-200" : kind === "success" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-blue-800 bg-blue-50 border-blue-200";
  return (
    <div id={id} role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"} className={`rounded-md border px-3 py-2 text-sm ${color}`}>
      {children}
    </div>
  );
}
