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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" onClick={() => router.push("/academic/programmes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle filière
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
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
