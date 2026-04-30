"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PaymentMethodSelector } from "@/components/inscriptions-pro/PaymentMethodSelector";
import { PaymentDetailsForm } from "@/components/inscriptions-pro/PaymentDetailsForm";
import { PaymentRecapCard } from "@/components/inscriptions-pro/PaymentRecapCard";
import { PaymentProcessingModal } from "@/components/inscriptions-pro/PaymentProcessingModal";
import { useInitiatePayment } from "@/lib/hooks/use-inscriptions-pro";
import { PaiementProMethod, PaymentInitiationRequest } from "@ecoledigitale/contracts/src/paiements-pro";
import { Button, Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ inscriptionId: string }>;
}) {
  const resolvedParams = use(params);
  const inscriptionId = resolvedParams.inscriptionId;
  const router = useRouter();

  const [selectedMethod, setSelectedMethod] = useState<PaiementProMethod | null>(null);
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);

  const initiatePayment = useInitiatePayment();

  // TODO: Fetch enrollment details to get amount and other info
  // For now, using placeholder data
  const enrollmentData = {
    enrollmentNumber: "INS-DATA-20250101-001",
    formationTitle: "Formation Data Science",
    sessionCode: "SESS-2025-001",
    baseAmount: 150000,
    discountAmount: 0,
    finalAmount: 150000,
    promoCode: null,
  };

  const handleMethodSelect = (method: PaiementProMethod) => {
    setSelectedMethod(method);
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!selectedMethod) {
      toast.error("Veuillez sélectionner une méthode de paiement");
      return false;
    }

    if (
      (selectedMethod === "orange_money" || selectedMethod === "mtn_money") &&
      !phone.trim()
    ) {
      newErrors.phone = "Le numéro de téléphone est requis";
      setErrors(newErrors);
      return false;
    }

    if (newErrors.phone) {
      setErrors(newErrors);
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    if (!selectedMethod) {
      return;
    }

    setShowModal(true);

    try {
      const request: PaymentInitiationRequest = {
        inscription_id: inscriptionId,
        methode_paiement: selectedMethod,
        montant: enrollmentData.finalAmount,
        ...(phone && { telephone: phone }),
        return_url: `${window.location.origin}/formations-professionnelles/inscription/callback/${selectedMethod}`,
      };

      const result = await initiatePayment.mutateAsync(request);

      // Handle redirect for bank card and TresorPay
      if (
        (selectedMethod === "carte_bancaire" || selectedMethod === "tresorpay") &&
        result.redirect_url
      ) {
        window.location.href = result.redirect_url;
        return; // Don't show modal for redirect methods
      }

      // For mobile money and Wave, keep modal open for polling
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'initiation du paiement"
      );
      setShowModal(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Paiement de l'inscription</h1>
        <p className="text-muted-foreground">
          Choisissez votre méthode de paiement et complétez votre inscription
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main payment form */}
        <div className="lg:col-span-2 space-y-6">
          <PaymentMethodSelector
            selectedMethod={selectedMethod}
            onSelectMethod={handleMethodSelect}
          />

          {selectedMethod && (
            <Card>
              <CardContent className="p-6 space-y-4">
                <PaymentDetailsForm
                  method={selectedMethod}
                  phone={phone}
                  onPhoneChange={setPhone}
                  errors={errors}
                />

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={handleSubmit}
                    disabled={initiatePayment.isPending}
                  >
                    {initiatePayment.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Traitement...
                      </>
                    ) : (
                      <>
                        Procéder au paiement
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Payment recap */}
        <div className="lg:col-span-1">
          <PaymentRecapCard
            enrollmentNumber={enrollmentData.enrollmentNumber}
            formationTitle={enrollmentData.formationTitle}
            sessionCode={enrollmentData.sessionCode}
            baseAmount={enrollmentData.baseAmount}
            discountAmount={enrollmentData.discountAmount}
            finalAmount={enrollmentData.finalAmount}
            promoCode={enrollmentData.promoCode}
          />
        </div>
      </div>

      {/* Payment processing modal */}
      <PaymentProcessingModal
        isOpen={showModal}
        method={selectedMethod}
        response={initiatePayment.data || null}
        isLoading={initiatePayment.isPending}
        error={initiatePayment.error?.message || null}
        onClose={() => setShowModal(false)}
        onRedirect={() => {
          if (initiatePayment.data?.redirect_url) {
            window.location.href = initiatePayment.data.redirect_url;
          }
        }}
        onPaymentValidated={() => {
          // Redirect to confirmation page when payment is validated
          if (initiatePayment.data?.paiement_id) {
            // Get inscription ID from enrollment data (would need to fetch it)
            // For now, redirect to callback page
            router.push(
              `/formations-professionnelles/inscription/callback/${selectedMethod}?payment_id=${initiatePayment.data.paiement_id}`
            );
          }
        }}
      />
    </div>
  );
}

