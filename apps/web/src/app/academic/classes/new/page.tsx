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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" onClick={() => router.push("/academic/classes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle classe
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
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
