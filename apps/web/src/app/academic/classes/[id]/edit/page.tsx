"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, Card, CardContent } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ClasseForm, type ClasseFormValues } from "@/components/academic/ClasseForm";
import { useProgramme, useUpdateProgramme } from "@/lib/hooks/use-programmes";

export default function EditClassePage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const { data: classe, isLoading, error } = useProgramme(id);
  const updateMutation = useUpdateProgramme();

  async function handleSubmit(data: ClasseFormValues) {
    await updateMutation.mutateAsync({
      id,
      data: {
        name: data.name,
        code: data.code,
        cycleId: data.cycleId,
        filiereId: data.filiereId,
      },
    });
    router.push("/academic/classes");
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !classe) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h3 className="text-lg font-medium">Classe introuvable</h3>
        <p className="text-muted-foreground">
          La classe demandée n&apos;existe pas ou vous n&apos;avez pas les
          permissions pour la modifier.
        </p>
        <Button onClick={() => router.push("/academic/classes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux classes
        </Button>
      </div>
    );
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
            Modifier la classe
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">{classe.name}</p>
        </div>
      </div>

      <ClasseForm
        classe={classe}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/academic/classes")}
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}
