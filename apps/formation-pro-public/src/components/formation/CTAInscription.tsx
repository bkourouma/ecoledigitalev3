"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import type { FormationDetailData } from "@/types/formation";
import { Button } from "@/components/ui/button";
import { PaiementModal } from "@/components/paiement/PaiementModal";
import { useCartStore } from "@/stores/cartStore";
import { formatCurrency } from "@/lib/utils";

export function CTAInscription({
  formation,
  hasAccess,
}: {
  formation: FormationDetailData;
  hasAccess: boolean;
}) {
  const { status, data } = useSession();
  const [open, setOpen] = useState(false);
  const { selectedSessionId, setSelectedSessionId, setTelephone } = useCartStore();

  const isAuthenticated = status === "authenticated";

  function openPayment() {
    if (!isAuthenticated) return;
    setTelephone(data?.user?.telephone || "");
    setOpen(true);
  }

  return (
    <>
      <section className="space-y-4 rounded-[1.75rem] border border-border/70 bg-white/85 p-5 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Inscription
            </p>
            <p className="font-display text-2xl font-semibold">
              {formatCurrency(formation.prix)}
            </p>
          </div>
          {hasAccess ? (
            <Button asChild>
              <Link href="/mes-formations">Accéder à la formation</Link>
            </Button>
          ) : isAuthenticated ? (
            <Button onClick={openPayment}>Finaliser mon inscription</Button>
          ) : (
            <Button asChild>
              <Link href={`/login?next=/catalogue/${formation.slug}`}>
                Se connecter pour continuer
              </Link>
            </Button>
          )}
        </div>

        {formation.sessions.length ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Choisir une session</label>
            <select
              value={selectedSessionId || ""}
              onChange={(event) => setSelectedSessionId(event.target.value || null)}
              className="h-11 w-full rounded-2xl border border-input bg-white px-4"
            >
              <option value="">Prochaine session disponible</option>
              {formation.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.codeSession} • {new Date(session.dateDebut).toLocaleDateString("fr-FR")} • {session.mode}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden">
        <div className="container flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Inscription
            </p>
            <p className="font-semibold">{formatCurrency(formation.prix)}</p>
          </div>
          {hasAccess ? (
            <Button asChild>
              <Link href="/mes-formations">Accéder</Link>
            </Button>
          ) : isAuthenticated ? (
            <Button onClick={openPayment}>Je m’inscris</Button>
          ) : (
            <Button asChild>
              <Link href={`/login?next=/catalogue/${formation.slug}`}>Connexion</Link>
            </Button>
          )}
        </div>
      </div>

      <PaiementModal formation={formation} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
