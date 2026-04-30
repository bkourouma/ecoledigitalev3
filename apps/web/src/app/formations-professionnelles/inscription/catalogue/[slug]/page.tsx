"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { InscriptionWizard } from "@/components/inscriptions-pro/InscriptionWizard";
import { FormationDisponibiliteChecker } from "@/components/inscriptions-pro/FormationDisponibiliteChecker";
import { useCreateEnrollment } from "@/lib/hooks/use-inscriptions-pro";
import { IndividualEnrollmentRequest } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { useFormationDetail } from "@/lib/hooks/use-formations-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

export default function InscriptionCataloguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = use(params);
  const slug = decodeURIComponent(resolvedParams.slug || "");
  const router = useRouter();
  const createEnrollment = useCreateEnrollment();
  const { data: formationResponse, isLoading } = useFormationDetail(slug || null);
  const formation = formationResponse?.data as { id?: string } | undefined;
  const formationId = formation?.id;

  const handleEnrollmentComplete = async (data: IndividualEnrollmentRequest) => {
    try {
      const result = await createEnrollment.mutateAsync(data);
      toast.success("Inscription créée avec succès!");
      router.push(`/formations-professionnelles/inscription/paiement/${result.inscription.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la création de l'inscription");
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement...
      </div>
    );
  }

  if (!formationId) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Formation introuvable.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Achat de la formation</h1>
        <p className="text-muted-foreground">Remplissez le formulaire pour vous inscrire et payer</p>
      </div>

      <FormationDisponibiliteChecker formationProId={formationId} />

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
          mode="catalogue"
          formationProId={formationId}
          formationSlug={slug}
          onComplete={handleEnrollmentComplete}
          onCancel={() => router.back()}
        />
      )}
    </div>
  );
}
