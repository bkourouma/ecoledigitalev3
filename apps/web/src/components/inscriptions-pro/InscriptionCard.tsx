"use client";

import { useState } from "react";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { Badge } from "@ecoledigitale/ui";
import { Download, CreditCard, Eye, X, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { EnrollmentHistoryItemSchema } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useCancelEnrollment } from "@/lib/hooks/use-inscriptions-pro";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import toast from "react-hot-toast";

interface InscriptionCardProps {
  inscription: z.infer<typeof EnrollmentHistoryItemSchema>;
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  en_attente: { label: "En attente", variant: "outline" },
  confirmee: { label: "Confirmée", variant: "default" },
  annulee: { label: "Annulée", variant: "destructive" },
  terminee: { label: "Terminée", variant: "secondary" },
};

const paymentStatusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  en_attente: { label: "Paiement en attente", variant: "outline" },
  valide: { label: "Payé", variant: "default" },
  echoue: { label: "Échoué", variant: "destructive" },
  rembourse: { label: "Remboursé", variant: "secondary" },
  annule: { label: "Annulé", variant: "destructive" },
};

export function InscriptionCard({ inscription }: InscriptionCardProps) {
  const router = useRouter();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const cancelEnrollment = useCancelEnrollment();

  const status = statusConfig[inscription.statut] || {
    label: inscription.statut,
    variant: "outline" as const,
  };

  const paymentStatus = inscription.paiement_statut
    ? paymentStatusConfig[inscription.paiement_statut]
    : null;

  // Check if cancellation is allowed
  const canCancel = 
    (inscription.statut === "en_attente" || inscription.statut === "confirmee") &&
    new Date(inscription.session.date_debut) > new Date();

  const handleDownloadInvoice = () => {
    window.open(`/api/v1/inscriptions-pro/${inscription.id}/facture`, "_blank");
  };

  const handleViewDetails = () => {
    router.push(`/formations-professionnelles/inscription/confirmation/${inscription.id}`);
  };

  const handleCompletePayment = () => {
    router.push(`/formations-professionnelles/inscription/paiement/${inscription.id}`);
  };

  const handleCancel = async () => {
    try {
      const result = await cancelEnrollment.mutateAsync(inscription.id);
      toast.success(result.message || "Inscription annulée avec succès");
      setShowCancelDialog(false);
      // Refresh the page to update the list
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Erreur lors de l'annulation");
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  {inscription.session.formation.titre}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Session: {inscription.session.code_session}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                {paymentStatus && (
                  <Badge variant={paymentStatus.variant} className="text-xs">
                    {paymentStatus.label}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Numéro d'inscription</p>
                <p className="font-medium">{inscription.numero_inscription}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Date d'inscription</p>
                <p className="font-medium">
                  {format(new Date(inscription.date_inscription), "dd MMM yyyy", { locale: fr })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Dates de formation</p>
                <p className="font-medium">
                  {format(new Date(inscription.session.date_debut), "dd MMM", { locale: fr })} -{" "}
                  {format(new Date(inscription.session.date_fin), "dd MMM yyyy", { locale: fr })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Montant</p>
                <p className="font-medium">
                  {inscription.montant_ttc.toFixed(2)} FCFA
                  {inscription.reduction_appliquee > 0 && (
                    <span className="text-green-600 text-xs ml-1">
                      (-{inscription.reduction_appliquee.toFixed(2)} FCFA)
                    </span>
                  )}
                </p>
              </div>
            </div>

            {inscription.code_promo_utilise && (
              <div className="text-sm">
                <span className="text-muted-foreground">Code promo utilisé: </span>
                <span className="font-medium">{inscription.code_promo_utilise}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 md:min-w-[200px]">
            <Button variant="outline" size="sm" onClick={handleViewDetails} className="w-full">
              <Eye className="h-4 w-4 mr-2" />
              Voir les détails
            </Button>

            {inscription.statut === "confirmee" && inscription.facture_numero && (
              <Button variant="outline" size="sm" onClick={handleDownloadInvoice} className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Télécharger la facture
              </Button>
            )}

            {inscription.statut === "en_attente" && inscription.paiement_statut !== "valide" && (
              <Button size="sm" onClick={handleCompletePayment} className="w-full">
                <CreditCard className="h-4 w-4 mr-2" />
                Compléter le paiement
              </Button>
            )}

            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                className="w-full"
                disabled={cancelEnrollment.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Annuler l'inscription
            </AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir annuler cette inscription ?
              <br />
              <br />
              <strong>Conséquences :</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Votre place sera libérée</li>
                {inscription.paiement_statut === "valide" && (
                  <li>Un remboursement sera initié (traitement manuel par l'administration)</li>
                )}
                <li>Vous recevrez un email de confirmation</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Non, garder l'inscription</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelEnrollment.isPending}
            >
              {cancelEnrollment.isPending ? "Annulation..." : "Oui, annuler"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

