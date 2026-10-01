"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { Notice } from "@ecoledigitale/ui";
import { PlatformSidebar } from "@/platform/navigation/PlatformSidebar";
import type { MenuItem } from "@/platform/navigation/types";

export interface ShellProps {
  items: readonly MenuItem[];
  isLoading?: boolean;
  /** Le menu n'a pas pu être chargé (le contenu reste utilisable). */
  navUnavailable?: boolean;
  navLabel: string;
  /** Marque affichée dans la barre du haut (nom de l'établissement, « Console plateforme »…). */
  title: ReactNode;
  /** Zone à droite de la barre du haut (compte, déconnexion…). */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Surcharge du chemin courant (tests). */
  activePath?: string | null;
}

/**
 * Coquille commune des écrans v2 : barre du haut, menu latéral (tiroir en mobile), contenu.
 *
 * Accessibilité : lien d'évitement, `nav` nommée, bouton du tiroir avec `aria-expanded`/`aria-controls`, Échap ferme le
 * tiroir et rend le focus au bouton, tiroir fermé = `visibility: hidden` (hors tabulation). Mobile-first : menu masqué
 * sous `md`, cibles tactiles >= 44 px, aucun défilement horizontal de la page.
 *
 * Le corps de `<html>` est en `overflow: hidden` (layout racine) : la coquille gère donc elle-même le défilement.
 */
export function Shell({ items, isLoading, navUnavailable, navLabel, title, headerRight, children, activePath }: ShellProps) {
  const t = useTranslations("admin.shell");
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const first = drawerRef.current?.querySelector<HTMLElement>("a[href], button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground" data-testid="v2-shell">
      <a
        href="#v2-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus:outline focus:outline-2"
      >
        {t("skipToContent")}
      </a>

      {open ? <div className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-hidden="true" onClick={() => close(false)} /> : null}

      <aside
        id="v2-sidebar"
        ref={drawerRef}
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 transition-transform md:static md:visible md:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <PlatformSidebar
          items={items}
          label={navLabel}
          isLoading={isLoading}
          activePath={activePath}
          onNavigate={() => close(false)}
          onClose={() => close(true)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-6" style={{ borderBottomColor: "var(--brand-primary, currentColor)" }}>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:hidden"
            aria-label={t("openMenu")}
            aria-expanded={open}
            aria-controls="v2-sidebar"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
          {headerRight ? <div className="flex shrink-0 items-center gap-2">{headerRight}</div> : null}
        </header>

        <main id="v2-main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-4 focus:outline-none sm:p-6">
          <div className="mx-auto w-full max-w-6xl">
            {navUnavailable ? (
              <Notice tone="warning" className="mb-4">
                {t("navUnavailable")}
              </Notice>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
