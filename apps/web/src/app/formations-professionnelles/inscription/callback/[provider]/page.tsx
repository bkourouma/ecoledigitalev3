"use client";

import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { usePaymentStatus } from "@/lib/hooks/use-inscriptions-pro";

export default function PaymentCallbackPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const resolvedParams = use(params);
  const provider = resolvedParams.provider;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [paymentId, setPaymentId] = useState<string | null>(null);

  // Extract payment ID from query params or URL
  useEffect(() => {
    const tx = searchParams.get("tx");
    const paymentIdParam = searchParams.get("payment_id");
    const inscriptionId = searchParams.get("inscription_id");

    // Try to get payment ID from various sources
    if (paymentIdParam) {
      setPaymentId(paymentIdParam);
    } else if (tx) {
      // If we have transaction ID, we might need to look it up
      // For now, use it as payment ID (this should be improved)
      setPaymentId(tx);
    } else if (inscriptionId) {
      // If we have inscription ID, redirect to payment page
      router.push(`/formations-professionnelles/inscription/paiement/${inscriptionId}`);
    }
  }, [searchParams, router]);

  const { data: statusData, isLoading, error } = usePaymentStatus(
    paymentId,
    paymentId ? { refetchInterval: 5000, enabled: true } : { enabled: false }
  );

  useEffect(() => {
    // If payment is validated, redirect to confirmation page
    if (statusData?.statut === "valide" && statusData?.inscription?.id) {
      setTimeout(() => {
        router.push(
          `/formations-professionnelles/inscription/confirmation/${statusData.inscription.id}`
        );
      }, 2000);
    }

    // If payment failed, show error and allow retry
    if (statusData?.statut === "echoue") {
      // Stay on page to show error
    }
  }, [statusData, router]);

  if (!paymentId) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Chargement des informations de paiement...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardContent className="py-12">
          {isLoading && (
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Vérification du statut du paiement...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center">
              <XCircle className="w-8 h-8 text-destructive mb-4" />
              <p className="text-destructive font-semibold mb-2">Erreur</p>
              <p className="text-muted-foreground text-sm text-center">
                {error.message || "Une erreur est survenue lors de la vérification du paiement"}
              </p>
            </div>
          )}

          {statusData && (
            <div className="flex flex-col items-center justify-center">
              {statusData.statut === "valide" && (
                <>
                  <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
                  <p className="text-lg font-semibold mb-2 text-green-600 dark:text-green-400">
                    Paiement confirmé !
                  </p>
                  <p className="text-muted-foreground text-sm text-center mb-4">
                    Votre paiement a été validé avec succès. Vous allez être redirigé vers la page
                    de confirmation...
                  </p>
                </>
              )}

              {statusData.statut === "en_attente" && (
                <>
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                  <p className="text-lg font-semibold mb-2">Paiement en attente</p>
                  <p className="text-muted-foreground text-sm text-center">
                    Nous vérifions votre paiement. Veuillez patienter...
                  </p>
                </>
              )}

              {statusData.statut === "echoue" && (
                <>
                  <XCircle className="w-12 h-12 text-destructive mb-4" />
                  <p className="text-lg font-semibold mb-2 text-destructive">
                    Paiement échoué
                  </p>
                  <p className="text-muted-foreground text-sm text-center mb-4">
                    Votre paiement n'a pas pu être validé. Veuillez réessayer.
                  </p>
                  {statusData.inscription?.id && (
                    <button
                      onClick={() =>
                        router.push(
                          `/formations-professionnelles/inscription/paiement/${statusData.inscription.id}`
                        )
                      }
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                    >
                      Réessayer le paiement
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

