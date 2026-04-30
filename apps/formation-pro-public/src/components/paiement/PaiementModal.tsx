"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { FormationDetailData } from "@/types/formation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInscription } from "@/hooks/useInscription";
import { useCartStore } from "@/stores/cartStore";
import { formatCurrency } from "@/lib/utils";

export function PaiementModal({
  formation,
  open,
  onClose,
}: {
  formation: FormationDetailData;
  open: boolean;
  onClose: () => void;
}) {
  const { selectedSessionId, telephone, setTelephone } = useCartStore();
  const paymentMutation = useInscription();
  const [error, setError] = useState("");

  if (!open) return null;

  const selectedSession = formation.sessions.find(
    (session) => session.id === selectedSessionId
  );

  async function handlePay() {
    setError("");

    try {
      const result = await paymentMutation.mutateAsync({
        formationId: formation.id,
        sessionId: selectedSessionId,
        telephone,
      });

      window.location.href = result.url;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Le paiement n'a pas pu être lancé."
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-3 sm:items-center">
      <div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-lift">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Paiement sécurisé
            </p>
            <h3 className="mt-2 font-display text-2xl font-semibold">
              Finaliser votre inscription
            </h3>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] bg-muted p-4 text-sm">
            <p className="font-semibold">{formation.titre}</p>
            <p className="mt-1 text-muted-foreground">
              {selectedSession
                ? `Session ${selectedSession.codeSession} • ${new Date(selectedSession.dateDebut).toLocaleDateString("fr-FR")}`
                : "Aucune session sélectionnée, la prochaine session sera attribuée."}
            </p>
            <p className="mt-3 text-lg font-semibold">{formatCurrency(formation.prix)}</p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Téléphone</label>
            <Input
              value={telephone}
              onChange={(event) => setTelephone(event.target.value)}
              placeholder="Votre numéro pour la transaction"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button
            className="w-full"
            onClick={handlePay}
            disabled={paymentMutation.isPending}
          >
            {paymentMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirection vers PayHubSecure...
              </>
            ) : (
              "Payer maintenant"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
