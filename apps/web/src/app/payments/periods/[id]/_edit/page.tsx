"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { usePaymentPeriod, useUpdatePaymentPeriod, UpdatePaymentPeriod } from "@/lib/hooks/use-payment-periods";
import { PaymentPeriodForm } from "@/components/payments/PaymentPeriodForm";

export default function EditPaymentPeriodPage() {
  const router = useRouter();
  const params = useParams();
  const periodId = params.id as string;
  const { data: period, isLoading, error } = usePaymentPeriod(periodId);
  const updatePaymentPeriodMutation = useUpdatePaymentPeriod();

  const handleSubmit = async (data: { name: string; description?: string; periodStart: string; periodEnd: string }) => {
    try {
      await updatePaymentPeriodMutation.mutateAsync({
        id: periodId,
        data: {
          name: data.name,
          description: data.description,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
        },
      });
      router.push("/payments/periods");
    } catch (error) {
      console.error("Error updating payment period:", error);
      // Re-throw error so PaymentPeriodForm can catch and display it
      throw error;
    }
  };

  const handleCancel = () => {
    router.push("/payments/periods");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            </div>
            <p className="text-muted-foreground text-lg">Chargement des informations de la période...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !period) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground">Période introuvable</h3>
                <p className="text-muted-foreground">
                  La période demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/payments/periods")} className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white">
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
          onClick={() => router.push("/payments/periods")}
          className="bg-background hover:bg-accent border-border text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier la période
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de {period.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Informations de la période</CardTitle>
          <CardDescription className="text-muted-foreground">
            Modifiez les informations de la période de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentPeriodForm
            period={period}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updatePaymentPeriodMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

