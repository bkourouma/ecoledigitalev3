"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useTeacherPaymentConfig, useUpdateTeacherPaymentConfig } from "@/lib/hooks/use-teacher-payment-configs";
import { AntdTeacherPaymentConfigForm } from "@/components/payments/AntdTeacherPaymentConfigForm";
import { UpdateTeacherPaymentConfig } from "@ecoledigitale/contracts";

export default function EditTeacherPaymentConfigPage() {
  const router = useRouter();
  const params = useParams();
  const configId = params.id as string;
  const { data: config, isLoading, error } = useTeacherPaymentConfig(configId);
  const updateConfigMutation = useUpdateTeacherPaymentConfig();

  const handleSubmit = async (data: UpdateTeacherPaymentConfig) => {
    try {
      await updateConfigMutation.mutateAsync({
        id: configId,
        data,
      });
      router.push("/payments/teacher-configs");
    } catch (error) {
      console.error("Error updating teacher payment config:", error);
    }
  };

  const handleCancel = () => {
    router.push("/payments/teacher-configs");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de la configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Configuration introuvable</h3>
                <p className="text-muted-foreground">
                  La configuration demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/payments/teacher-configs")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
            Modifier la Configuration de Paiement
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de la configuration de paiement
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la configuration</CardTitle>
          <CardDescription>
            Modifiez les informations de la configuration de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AntdTeacherPaymentConfigForm
            config={config}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateConfigMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

