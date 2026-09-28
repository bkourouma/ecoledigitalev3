"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateTeacherPaymentConfig } from "@/lib/hooks/use-teacher-payment-configs";
import { CreateTeacherPaymentConfig } from "@ecoledigitale/contracts";
import { AntdTeacherPaymentConfigForm } from "@/components/payments/AntdTeacherPaymentConfigForm";

export default function NewTeacherPaymentConfigPage() {
  const router = useRouter();
  const createConfigMutation = useCreateTeacherPaymentConfig();

  const handleSubmit = async (data: CreateTeacherPaymentConfig) => {
    try {
      await createConfigMutation.mutateAsync(data);
      router.push("/payments/teacher-configs");
    } catch (error) {
      console.error("Error creating teacher payment config:", error);
    }
  };

  const handleCancel = () => {
    router.push("/payments/teacher-configs");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/payments/teacher-configs")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle Configuration de Paiement
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez une nouvelle configuration de paiement pour un enseignant
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la configuration</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer une nouvelle configuration de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AntdTeacherPaymentConfigForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createConfigMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

