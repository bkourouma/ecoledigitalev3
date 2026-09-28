"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { InscriptionWizard } from "@/components/inscriptions-pro/InscriptionWizard";
import { SessionDisponibiliteChecker } from "@/components/inscriptions-pro/SessionDisponibiliteChecker";
import { useCreateEnrollment } from "@/lib/hooks/use-inscriptions-pro";
import { IndividualEnrollmentRequest } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

export default function InscriptionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const createEnrollment = useCreateEnrollment();

  const handleEnrollmentComplete = async (data: IndividualEnrollmentRequest) => {
    try {
      const result = await createEnrollment.mutateAsync(data);
      toast.success("Inscription créée avec succès!");
      // Redirect to payment page
      router.push(`/formations-professionnelles/inscription/paiement/${result.inscription.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la création de l'inscription");
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="font-bold mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">Inscription à la formation</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">Remplissez le formulaire ci-dessous pour vous inscrire</p>
      </div>

      <SessionDisponibiliteChecker sessionId={sessionId} />

      {createEnrollment.isPending ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Création de l'inscription en cours...</p>
            </div>
          </CardContent>
        </Card>
      ) : createEnrollment.isError ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <AlertCircle className="w-8 h-8 text-destructive mb-4" />
              <p className="text-destructive font-semibold mb-2">Erreur</p>
              <p className="text-muted-foreground text-sm">
                {createEnrollment.error?.message || "Une erreur est survenue"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <InscriptionWizard
          mode="session"
          sessionId={sessionId}
          onComplete={handleEnrollmentComplete}
          onCancel={() => router.back()}
        />
      )}
    </div>
  );
}

