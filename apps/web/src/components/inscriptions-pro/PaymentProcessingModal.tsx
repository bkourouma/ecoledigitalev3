"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ecoledigitale/ui";
import { Loader2, CheckCircle2, XCircle, QrCode, ExternalLink } from "lucide-react";
import { PaiementProMethod, PaymentInitiationResponse } from "@ecoledigitale/contracts/src/paiements-pro";
import { Button } from "@ecoledigitale/ui";
import Image from "next/image";
import { usePaymentStatus } from "@/lib/hooks/use-inscriptions-pro";
import { useEffect, useState } from "react";

interface PaymentProcessingModalProps {
  isOpen: boolean;
  method: PaiementProMethod | null;
  response: PaymentInitiationResponse | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRedirect?: () => void;
  onPaymentValidated?: () => void;
}

export function PaymentProcessingModal({
  isOpen,
  method,
  response,
  isLoading,
  error,
  onClose,
  onRedirect,
  onPaymentValidated,
}: PaymentProcessingModalProps) {
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [pollingTimeout, setPollingTimeout] = useState<NodeJS.Timeout | null>(null);

  // Start polling when payment is initiated (for mobile money methods)
  useEffect(() => {
    if (response?.paiement_id && (method === "orange_money" || method === "mtn_money" || method === "wave")) {
      setPollingEnabled(true);
      
      // Stop polling after 5 minutes
      const timeout = setTimeout(() => {
        setPollingEnabled(false);
      }, 5 * 60 * 1000); // 5 minutes
      
      setPollingTimeout(timeout);
      
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }
  }, [response?.paiement_id, method]);

  // Poll payment status
  const { data: statusData } = usePaymentStatus(
    response?.paiement_id || null,
    pollingEnabled ? { refetchInterval: 5000, enabled: true } : { enabled: false }
  );

  // Stop polling when payment is validated or failed
  useEffect(() => {
    if (statusData?.statut === "valide" || statusData?.statut === "echoue") {
      setPollingEnabled(false);
      if (pollingTimeout) {
        clearTimeout(pollingTimeout);
        setPollingTimeout(null);
      }
      
      if (statusData.statut === "valide" && onPaymentValidated) {
        onPaymentValidated();
      }
    }
  }, [statusData?.statut, onPaymentValidated, pollingTimeout]);

  if (!isOpen) return null;

  const showQRCode = method === "wave" && response?.qr_code;
  const showRedirect = response?.redirect_url;
  const showUSSD = (method === "orange_money" || method === "mtn_money") && response?.ussd_code;
  const isPolling = pollingEnabled && (statusData?.statut === "en_attente");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Traitement du paiement</DialogTitle>
          <DialogDescription>
            Suivez les instructions pour compléter votre paiement
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Initialisation du paiement...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-8">
              <XCircle className="w-12 h-12 text-destructive mb-4" />
              <p className="text-destructive font-semibold mb-2">Erreur</p>
              <p className="text-sm text-muted-foreground text-center">{error}</p>
              <Button onClick={onClose} className="mt-4">
                Fermer
              </Button>
            </div>
          )}

          {response && !isLoading && !error && (
            <>
              {/* Payment status from polling */}
              {isPolling && (
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <p className="text-sm text-blue-600 dark:text-blue-400">
                      Vérification du paiement en cours...
                    </p>
                  </div>
                </div>
              )}

              {statusData?.statut === "valide" && (
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <p className="text-sm text-green-600 dark:text-green-400 font-semibold">
                      Paiement confirmé !
                    </p>
                  </div>
                </div>
              )}

              {statusData?.statut === "echoue" && (
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Le paiement a échoué. Veuillez réessayer.
                    </p>
                  </div>
                </div>
              )}

              {showQRCode && (
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-4 bg-white rounded-lg">
                    <Image
                      src={response.qr_code}
                      alt="QR Code Wave"
                      width={200}
                      height={200}
                      className="rounded"
                    />
                  </div>
                  <p className="text-sm text-center text-muted-foreground">
                    Scannez ce QR code avec l'application Wave
                  </p>
                </div>
              )}

              {showUSSD && (
                <div className="space-y-4">
                  <div className="bg-muted p-4 rounded-lg text-center">
                    <p className="text-2xl font-mono font-bold">{response.ussd_code}</p>
                  </div>
                  <p className="text-sm text-center text-muted-foreground">
                    Composez ce code sur votre téléphone et suivez les instructions
                  </p>
                  {isPolling && (
                    <p className="text-xs text-center text-muted-foreground">
                      Nous vérifions automatiquement votre paiement...
                    </p>
                  )}
                </div>
              )}

              {response.instructions && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm">{response.instructions}</p>
                </div>
              )}

              {showRedirect && (
                <div className="space-y-4">
                  <Button
                    onClick={() => {
                      if (onRedirect) {
                        onRedirect();
                      } else {
                        window.location.href = response.redirect_url!;
                      }
                    }}
                    className="w-full"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Continuer vers la page de paiement
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Vous allez être redirigé vers une page sécurisée
                  </p>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4 border-t">
                <Button variant="outline" onClick={onClose}>
                  Fermer
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

