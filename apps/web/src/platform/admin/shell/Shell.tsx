"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { Notice } from "@ecoledigitale/ui";
import { PlatformSidebar, type SidebarGrouping } from "@/platform/navigation/PlatformSidebar";
import type { MenuItem } from "@/platform/navigation/types";

export interface ShellProps {
  items: readonly MenuItem[];
  isLoading?: boolean;
  /** Le menu n'a pas pu être chargé (le contenu reste utilisable). */
  navUnavailable?: boolean;
  navLabel: string;
  /** Marque affichée dans la barre du haut (nom de l'établissement, « Console plateforme »…). */
  title: ReactNode;
  /** Entre la marque et la zone de droite : changement de module. */
  headerCenter?: ReactNode;
  /** Zone à droite de la barre du haut (compte, déconnexion…). */
  headerRight?: ReactNode;
  /** Fil d'Ariane, au-dessus du contenu. */
  breadcrumb?: ReactNode;
  /** Menu latéral regroupé par module (coque de gestion). */
  grouping?: SidebarGrouping;
  /** Contenu plus large (écrans de gestion à tableaux) : 7xl au lieu de 6xl. */
  wide?: boolean;
  children: ReactNode;
  /** Surcharge du chemin courant (tests). */
  activePath?: string | null;
}

/**
 * Coque commune des écrans v2 : barre du haut, menu latéral (tiroir en mobile), contenu.
 *
 * Accessibilité : lien d'évitement, `nav` nommée, bouton du tiroir avec `aria-expanded`/`aria-controls`, Échap ferme le
 * tiroir et rend le focus au bouton, tiroir fermé = `visibility: hidden` (hors tabulation). À chaque changement de page le
 * focus passe au contenu (`main`, qui revient aussi en haut) : le lecteur d'écran annonce la nouvelle page et le clavier ne
 * reste pas dans le menu. Mobile-first : menu masqué sous `md`, cibles tactiles >= 44 px, aucun défilement horizontal.
 * Impression : barre, menu et fil d'Ariane sont masqués, le contenu s'imprime en pleine page (reçus, factures, bulletins).
 *
 * Le corps de `<html>` est en `overflow: hidden` (layout racine) : la coquille gère donc elle-même le défilement.
 */
export function Shell({ items, isLoading, navUnavailable, navLabel, title, headerCenter, headerRight, breadcrumb, grouping, wide, children, activePath }: ShellProps) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

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

  // Nouvelle page : retour en haut du contenu et focus sur `main` (pas au premier rendu : on ne vole pas le focus au chargement).
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setOpen(false);
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible" data-testid="v2-shell">
      <a
        href="#v2-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-16 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus:outline focus:outline-2 print:hidden"
      >
        {t("skipToContent")}
      </a>

      {open ? <div className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-hidden="true" onClick={() => close(false)} /> : null}

      <aside
        id="v2-sidebar"
        ref={drawerRef}
        className={`fixed inset-y-0 left-0 z-40 w-72 shrink-0 transition-transform md:static md:visible md:translate-x-0 print:hidden ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <PlatformSidebar
          items={items}
          label={navLabel}
          isLoading={isLoading}
          activePath={activePath}
          grouping={grouping}
          onNavigate={() => close(false)}
          onClose={() => close(true)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-6 print:hidden" style={{ borderBottomColor: "var(--brand-primary, currentColor)" }}>
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
          {headerCenter ? <div className="flex shrink-0 items-center">{headerCenter}</div> : null}
          {headerRight ? <div className="flex shrink-0 items-center gap-1 sm:gap-2">{headerRight}</div> : null}
        </header>

        <main ref={mainRef} id="v2-main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-4 focus:outline-none sm:p-6 print:overflow-visible print:p-0">
          <div className={`mx-auto w-full ${wide ? "max-w-7xl" : "max-w-6xl"}`}>
            {breadcrumb}
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
