"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useShellMenu } from "@/platform/shell/context";

/**
 * Le conteneur racine de l'application masque le défilement (`overflow-hidden`) : les pages d'authentification plein
 * écran le rétablissent pour que le formulaire reste atteignable sur un petit écran / clavier ouvert.
 */
export function useScrollableDocument(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
}

/**
 * Quand une page englobante fournit déjà le `<main>`, la colonne plein écran et le défilement (page de connexion à deux
 * colonnes), `AuthShell` ne rend que la marque et la carte.
 */
const AuthEmbeddedContext = createContext(false);
export const AuthEmbeddedProvider = AuthEmbeddedContext.Provider;

/** Marque de l'application : pastille « ED » + nom, sans rôle sémantique (décoratif). */
export function AuthBrand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-emerald-600 shadow-lg shadow-blue-900/30 ring-1 ring-white/10">
        <span className="text-base font-bold tracking-tight text-white">ED</span>
      </div>
      <span className="text-xl font-semibold tracking-tight text-foreground">EcoleDigitale</span>
    </div>
  );
}

/**
 * Cadre commun des pages d'authentification V2 : une colonne centrée, mobile d'abord, un seul `<main>` et un seul
 * `<h1>`.
 */
export function AuthShell({ title, description, children, wide = false, icon }: { title: string; description?: string; children: ReactNode; wide?: boolean; icon?: ReactNode }) {
  // Dans la coque de navigation (sécurité du compte, membres : pages ouvertes depuis le menu), la page n'a ni son propre
  // `<main>` ni sa colonne plein écran : c'est la coque qui les fournit.
  const inShell = useShellMenu() !== null;
  const embedded = useContext(AuthEmbeddedContext);
  useScrollableDocument(!inShell && !embedded);

  const card = (
    <Card variant="glass" className={`shadow-xl shadow-black/20 ${embedded ? "h-full" : ""}`}>
      <CardHeader className="p-6 pb-4 sm:p-8 sm:pb-5">
        <div className="flex items-start gap-4">
          {icon ? (
            <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/20">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <h1 className="gradient-text text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
            {description ? <CardDescription className="leading-relaxed">{description}</CardDescription> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-6 pt-0 sm:p-8 sm:pt-0">{children}</CardContent>
    </Card>
  );

  if (inShell) {
    return <div className={`mx-auto w-full space-y-6 ${wide ? "max-w-3xl" : "max-w-md"}`}>{card}</div>;
  }

  if (embedded) {
    return <div className="h-full w-full">{card}</div>;
  }

  return (
    <main className="min-h-screen flex items-start justify-center bg-background px-4 pb-16 pt-8 sm:px-6 sm:pt-16">
      <div className={`w-full space-y-8 ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <AuthBrand />
        {card}
      </div>
    </main>
  );
}

/** Message d'erreur / d'état annoncé aux lecteurs d'écran. */
export function FormAlert({ kind = "error", children, id }: { kind?: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const color = kind === "error" ? "text-red-700 bg-red-50 border-red-200" : kind === "success" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-blue-800 bg-blue-50 border-blue-200";
  return (
    <div id={id} role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"} className={`rounded-lg border px-3 py-2.5 text-sm ${color}`}>
      {children}
    </div>
  );
}
