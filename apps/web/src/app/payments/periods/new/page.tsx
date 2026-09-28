"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreatePaymentPeriod, CreatePaymentPeriod } from "@/lib/hooks/use-payment-periods";
import { PaymentPeriodForm } from "@/components/payments/PaymentPeriodForm";

export default function NewPaymentPeriodPage() {
  const router = useRouter();
  const createPaymentPeriodMutation = useCreatePaymentPeriod();

  const handleSubmit = async (data: CreatePaymentPeriod) => {
    try {
      await createPaymentPeriodMutation.mutateAsync(data);
      router.push("/payments/periods");
    } catch (error) {
      console.error("Error creating payment period:", error);
      // Re-throw error so PaymentPeriodForm can catch and display it
      throw error;
    }
  };

  const handleCancel = () => {
    router.push("/payments/periods");
  };

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
            Nouvelle période de paiement
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez une nouvelle période de paiement pour les enseignants
          </p>
        </div>
      </div>

      <Card className="shadow-lg bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Informations de la période</CardTitle>
          <CardDescription className="text-muted-foreground">
            Remplissez les informations pour créer une nouvelle période de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentPeriodForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createPaymentPeriodMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

