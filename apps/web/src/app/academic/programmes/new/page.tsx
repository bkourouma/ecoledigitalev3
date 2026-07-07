"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateProgramme, CreateProgramme } from "@/lib/hooks/use-programmes";
import { ProgrammeForm } from "@/components/academic/ProgrammeForm";

type CreateProgrammeSubmission = Partial<CreateProgramme> & {
  cycleId?: string;
  bulkProgrammes?: Array<{ name: string; code: string; domaine?: string }>;
};

export default function NewProgrammePage() {
  const router = useRouter();
  const createProgrammeMutation = useCreateProgramme();
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  const handleSubmit = async (data: CreateProgrammeSubmission) => {
    try {
      setIsBulkSubmitting(true);

      const programmesToCreate =
        data.bulkProgrammes && data.bulkProgrammes.length > 0
          ? data.bulkProgrammes
          : data.name && data.code
            ? [{ name: data.name.trim(), code: data.code.trim(), domaine: data.domaine }]
            : [];

      if (programmesToCreate.length === 0) {
        throw new Error("Ajoutez au moins une filière à créer (nom et code).");
      }

      const cycleId = data.cycleId === "no-cycles" ? undefined : data.cycleId;
      if (!cycleId) {
        throw new Error("Veuillez sélectionner un cycle.");
      }

      const failedLabels: string[] = [];

      for (const p of programmesToCreate) {
        const name = p.name?.trim();
        const code = p.code?.trim();
        if (!name || !code) {
          continue;
        }

        const domaine = p.domaine?.trim();
        const payload: CreateProgramme = {
          name,
          code,
          cycleId,
          status: "active",
          ...(domaine ? { domaine } : {}),
        };

        try {
          await createProgrammeMutation.mutateAsync(payload);
        } catch (error) {
          failedLabels.push(`${name} (${code})`);
          console.error(`[Programmes/New] Erreur création "${name}":`, error);
        }
      }

      if (failedLabels.length > 0) {
        throw new Error(
          `${failedLabels.length} filière(s) n'ont pas pu être créées : ${failedLabels.join(", ")}`
        );
      }

      router.push("/academic/programmes");
    } catch (error) {
      console.error("Error creating programme:", error);
      alert(error instanceof Error ? error.message : "Erreur lors de la création des filières.");
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleCancel = () => {
    router.push("/academic/programmes");
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/academic/programmes")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent">
              Nouvelles filières
            </h1>
            <p className="text-muted-foreground mt-2">
              Choisissez un cycle puis ajoutez une ou plusieurs filières (statut : actif)
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Filières par cycle</CardTitle>
            <CardDescription>
              Même cycle pour toutes les filières de la liste ; chaque ligne a son nom et son code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProgrammeForm
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isLoading={createProgrammeMutation.isPending || isBulkSubmitting}
              allowBulkCreation
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
