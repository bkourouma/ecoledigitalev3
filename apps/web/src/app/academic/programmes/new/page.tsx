"use client";

import { useRouter } from "next/navigation";
import { Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { FiliereForm } from "@/components/academic/FiliereForm";
import { useCreateFiliere } from "@/lib/hooks/use-filieres";

export default function NewFilierePage() {
  const router = useRouter();
  const createMutation = useCreateFiliere();

  async function handleSubmit(data: { name: string; domaine: string | null }) {
    await createMutation.mutateAsync(data);
    router.push("/academic/programmes");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/academic/programmes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent">
            Nouvelle filière
          </h1>
          <p className="text-muted-foreground mt-1">
            Créez une nouvelle filière de formation
          </p>
        </div>
      </div>

      <FiliereForm
        onSubmit={handleSubmit}
        onCancel={() => router.push("/academic/programmes")}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}
