"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useCycle, useUpdateCycle } from "@/lib/hooks/use-cycles";
import { AntdCycleForm } from "@/components/academic/AntdCycleForm";
import { UpdateCycle } from "@ecoledigitale/contracts";

export default function EditCyclePage() {
  const router = useRouter();
  const params = useParams();
  const cycleId = params.id as string;
  const { data: cycle, isLoading, error } = useCycle(cycleId);
  const updateCycleMutation = useUpdateCycle();

  const handleSubmit = async (data: UpdateCycle) => {
    try {
      await updateCycleMutation.mutateAsync({
        id: cycleId,
        data,
      });
      router.push("/academic/cycles");
    } catch (error) {
      console.error("Error updating cycle:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/cycles");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations du cycle...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Cycle introuvable</h3>
                <p className="text-muted-foreground">
                  Le cycle demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/cycles")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-6 md:px-6 md:py-8">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/cycles")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>
        <h1 className="whitespace-nowrap bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text font-bold leading-tight text-transparent text-2xl md:text-3xl">
          Modifier le cycle
        </h1>
        <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
          Modifiez les informations de {cycle.name}
        </p>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations du cycle</CardTitle>
          <CardDescription>
            Modifiez les informations du cycle
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AntdCycleForm
            cycle={cycle}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateCycleMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
