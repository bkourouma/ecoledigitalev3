"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCreateCycle } from "@/lib/hooks/use-cycles";
import { CreateCycle, UpdateCycle } from "@ecoledigitale/contracts";
import { AntdCycleForm } from "@/components/academic/AntdCycleForm";

export default function NewCyclePage() {
  const router = useRouter();
  const createCycleMutation = useCreateCycle();

  const handleSubmit = async (data: CreateCycle | UpdateCycle) => {
    try {
      await createCycleMutation.mutateAsync(data as CreateCycle);
      router.push("/academic/cycles");
    } catch (error) {
      console.error("Error creating cycle:", error);
      // Re-throw the error so the form can handle it
      throw error;
    }
  };

  const handleCancel = () => {
    router.push("/academic/cycles");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/cycles")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Nouveau cycle
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez un nouveau cycle de formation
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations du cycle</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer un nouveau cycle
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AntdCycleForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createCycleMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
