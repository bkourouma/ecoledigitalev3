"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { ClasseForm, type ClasseFormValues } from "@/components/academic/ClasseForm";
import { useCreateProgramme } from "@/lib/hooks/use-programmes";

export default function NewClassePage() {
  return (
    <Suspense fallback={null}>
      <NewClassePageContent />
    </Suspense>
  );
}

function NewClassePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createMutation = useCreateProgramme();

  // Arrivée depuis la fiche d'une filière : elle est pré-sélectionnée.
  const defaultFiliereId = searchParams?.get("filiereId") ?? undefined;

  async function handleSubmit(data: ClasseFormValues) {
    await createMutation.mutateAsync({
      name: data.name,
      code: data.code,
      cycleId: data.cycleId,
      filiereId: data.filiereId,
    });
    router.push("/academic/classes");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/academic/classes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Nouvelle classe
          </h1>
          <p className="text-muted-foreground mt-1">
            Créez une nouvelle classe rattachée à une filière
          </p>
        </div>
      </div>

      <ClasseForm
        defaultFiliereId={defaultFiliereId}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/academic/classes")}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}
