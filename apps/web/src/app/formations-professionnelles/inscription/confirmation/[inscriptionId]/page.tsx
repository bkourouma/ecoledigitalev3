"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, Download } from "lucide-react";
import { useEnrollmentConfirmation } from "@/lib/hooks/use-inscriptions-pro";
import { SuccessHeader } from "@/components/inscriptions-pro/SuccessHeader";
import { InscriptionRecapCard } from "@/components/inscriptions-pro/InscriptionRecapCard";
import { NextStepsCard } from "@/components/inscriptions-pro/NextStepsCard";
import { Button } from "@ecoledigitale/ui";

export default function ConfirmationPage({
  params,
}: {
  params: Promise<{ inscriptionId: string }>;
}) {
  const resolvedParams = use(params);
  const inscriptionId = resolvedParams.inscriptionId;
  const router = useRouter();

  const { data: confirmationData, isLoading, error } = useEnrollmentConfirmation(inscriptionId);

  const handleDownloadInvoice = () => {
    if (confirmationData?.data?.inscription?.facture_numero) {
      window.open(`/api/v1/inscriptions-pro/${inscriptionId}/facture`, "_blank");
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Chargement de la confirmation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !confirmationData?.data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <AlertCircle className="w-8 h-8 text-destructive mb-4" />
              <p className="text-destructive font-semibold mb-2">Erreur</p>
              <p className="text-muted-foreground text-sm text-center">
                {error?.message || "Impossible de charger les détails de l'inscription"}
              </p>
              <Button onClick={() => router.push("/formations-professionnelles/sessions")} className="mt-4">
                Retour aux formations
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { inscription, session, formation, apprenant, paiement } = confirmationData.data;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <SuccessHeader enrollmentNumber={inscription.numero_inscription} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-6">
          <InscriptionRecapCard
            inscription={inscription}
            session={session}
            formation={formation}
            apprenant={apprenant}
            paiement={paiement}
          />

          {inscription.facture_numero && (
            <Card>
              <CardHeader>
                <CardTitle>Facture</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Numéro de facture</p>
                    <p className="font-semibold">{inscription.facture_numero}</p>
                  </div>
                  <Button onClick={handleDownloadInvoice} variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Télécharger la facture
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <NextStepsCard session={session} formation={formation} />
        </div>
      </div>
    </div>
  );
}

