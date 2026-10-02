"use client";

import React, { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Layout } from './Layout';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Pages qui ne doivent pas avoir le layout principal (pages publiques)
// Peut être un chemin exact ou un préfixe pour exclure toute une section
// '/offline' : page du service worker (public/sw.js), affichée sans réseau ; ne doit pas attendre la session.
// '/v2' : écrans v2 (coquille propre : app/v2/**, platform/admin/shell, pages d'authentification V2). '/auth/' : liens e-mail IAM.
const NO_LAYOUT_PAGES = ['/login', '/register', '/offline'];
const NO_LAYOUT_PREFIXES = ['/rso/formateur', '/super-admin', '/live', '/v2', '/auth/'];

export function AppLayout({ children }: AppLayoutProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Si on est sur une page sans layout (comme login)
  const shouldExcludeLayout = 
    NO_LAYOUT_PAGES.includes(pathname) ||
    NO_LAYOUT_PREFIXES.some(prefix => pathname.startsWith(prefix));
  
  if (shouldExcludeLayout) {
    return <>{children}</>;
  }

  // Si on est en train de charger la session
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-emerald-600 rounded-2xl flex items-center justify-center shadow-xl animate-pulse">
            <span className="text-white font-bold text-lg">ED</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Si pas de session, on rend juste le contenu (la page de login va se charger)
  if (!session) {
    return <>{children}</>;
  }

  // Si on a une session, on applique le layout principal
  return <Layout>{children}</Layout>;
}
