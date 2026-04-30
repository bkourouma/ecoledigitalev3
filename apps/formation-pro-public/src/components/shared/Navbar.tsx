"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Accueil" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/a-propos", label: "À propos" },
  { href: "/contact", label: "Contact" },
];

export function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated } = useUser();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-20 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-soft">
            FP
          </div>
          <div>
            <p className="font-display text-base font-semibold">Formation Pro</p>
            <p className="text-xs text-muted-foreground">
              E-learning et sessions certifiantes
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium text-muted-foreground transition hover:text-foreground",
                pathname === link.href && "text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {isAuthenticated ? (
            <>
              {user?.isAdmin ? (
                <Button asChild variant="ghost">
                  <Link href="/affectations">Affectations</Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/compte">Mon compte</Link>
              </Button>
              <Button variant="ghost" onClick={() => signOut({ callbackUrl: "/" })}>
                Déconnexion
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/login">Connexion</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Créer un compte</Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white md:hidden"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <div className="container space-y-3 py-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-2xl px-3 py-3 text-sm font-medium hover:bg-white"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {isAuthenticated ? (
              <>
                {user?.isAdmin ? (
                  <Link
                    href="/affectations"
                    className="block rounded-2xl px-3 py-3 text-sm font-medium hover:bg-white"
                    onClick={() => setOpen(false)}
                  >
                    Affectations
                  </Link>
                ) : null}
                <Link
                  href="/compte"
                  className="block rounded-2xl px-3 py-3 text-sm font-medium hover:bg-white"
                  onClick={() => setOpen(false)}
                >
                  {user?.prenom ? `Bonjour ${user.prenom}` : "Mon compte"}
                </Link>
                <button
                  type="button"
                  className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-medium hover:bg-white"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  Déconnexion
                </button>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 pt-2">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    Connexion
                  </Link>
                </Button>
                <Button asChild className="w-full">
                  <Link href="/register" onClick={() => setOpen(false)}>
                    Créer un compte
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
