"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
  Separator,
} from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CreditCard,
  Smartphone,
  Building,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";

interface PaymentFormProps {
  selectedPayment: {
    feeType?: string;
    installment?: any;
    type: "immediate" | "tuition";
  } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentForm({ selectedPayment, onClose, onSuccess }: PaymentFormProps) {
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>("");

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getFeeTypeLabel = (feeType: string) => {
    switch (feeType) {
      case "inscription":
        return "Frais d'Inscription";
      case "scolarite":
        return "Frais de Scolarité";
      case "annexes":
        return "Frais Annexes";
      case "autres":
        return "Autres Frais";
      default:
        return feeType;
    }
  };

  const getPaymentAmount = () => {
    if (!selectedPayment) return 0;

    if (selectedPayment.type === "immediate" && selectedPayment.feeType) {
      // For immediate fees, return the full amount (mock data)
      const amounts = {
        inscription: 50000,
        annexes: 25000,
        autres: 10000,
      };
      return amounts[selectedPayment.feeType as keyof typeof amounts] || 0;
    }

    if (selectedPayment.type === "tuition" && selectedPayment.installment) {
      return selectedPayment.installment.amount - selectedPayment.installment.amountPaid;
    }

    return 0;
  };

  const canUsePartialPayment = () => {
    return selectedPayment?.type === "tuition";
  };

  const paymentMethods = [
    {
      id: "orange_money",
      name: "Orange Money",
      icon: <Smartphone className="h-5 w-5" />,
      description: "Paiement via Orange Money",
      requiresPhone: true,
    },
    {
      id: "mtn_money",
      name: "MTN Mobile Money",
      icon: <Smartphone className="h-5 w-5" />,
      description: "Paiement via MTN Mobile Money",
      requiresPhone: true,
    },
    {
      id: "moov_money",
      name: "Moov Money",
      icon: <Smartphone className="h-5 w-5" />,
      description: "Paiement via Moov Money",
      requiresPhone: true,
    },
    {
      id: "card",
      name: "Carte Bancaire",
      icon: <CreditCard className="h-5 w-5" />,
      description: "Visa, Mastercard",
      requiresPhone: false,
    },
    {
      id: "bank_transfer",
      name: "Virement Bancaire",
      icon: <Building className="h-5 w-5" />,
      description: "Virement bancaire",
      requiresPhone: false,
    },
  ];

  const selectedMethodData = paymentMethods.find(m => m.id === paymentMethod);
  const defaultAmount = getPaymentAmount();
  const paymentAmount = customAmount ? parseFloat(customAmount) : defaultAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!paymentMethod) {
      setError("Veuillez sélectionner une méthode de paiement");
      return;
    }

    if (selectedMethodData?.requiresPhone && !phoneNumber) {
      setError("Veuillez saisir votre numéro de téléphone");
      return;
    }

    if (paymentAmount <= 0) {
      setError("Le montant doit être supérieur à 0");
      return;
    }

    if (!canUsePartialPayment() && paymentAmount !== defaultAmount) {
      setError("Ce type de frais doit être payé en totalité");
      return;
    }

    setIsProcessing(true);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock success
      onSuccess();
    } catch (error) {
      setError("Erreur lors du traitement du paiement. Veuillez réessayer.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!selectedPayment) return null;

  return (
    <AnimatePresence>
      <Dialog open={!!selectedPayment} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Effectuer un Paiement
            </DialogTitle>
            <DialogDescription>
              Choisissez votre méthode de paiement et confirmez le montant
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Payment Details */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold text-foreground">Détails du Paiement</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type de frais:</span>
                    <span className="font-medium text-foreground">
                      {selectedPayment.type === "immediate" 
                        ? getFeeTypeLabel(selectedPayment.feeType || "")
                        : selectedPayment.installment?.installmentLabel
                      }
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Montant à payer:</span>
                    <span className="font-bold text-lg text-foreground">
                      {formatCurrency(defaultAmount)}
                    </span>
                  </div>
                  {selectedPayment.type === "tuition" && selectedPayment.installment?.lateFee > 0 && (
                    <div className="flex justify-between text-amber-400">
                      <span>Frais de retard:</span>
                      <span className="font-medium">
                        {formatCurrency(selectedPayment.installment.lateFee)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Custom Amount (for tuition only) */}
            {canUsePartialPayment() && (
              <div className="space-y-3">
                <Label htmlFor="amount">Montant personnalisé (optionnel)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder={`Montant par défaut: ${defaultAmount}`}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  min="1"
                  max={defaultAmount}
                />
                <p className="text-sm text-muted-foreground">
                  Vous pouvez effectuer un paiement partiel pour les frais de scolarité
                </p>
              </div>
            )}

            {/* Payment Methods */}
            <div className="space-y-3">
              <Label>Méthode de Paiement</Label>
              <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                <div className="grid grid-cols-1 gap-3">
                  {paymentMethods.map((method) => (
                    <motion.div
                      key={method.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Label
                        htmlFor={method.id}
                        className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-4 transition-colors ${
                          paymentMethod === method.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-muted-foreground/40"
                        }`}
                      >
                        <RadioGroupItem value={method.id} id={method.id} />
                        <div className="flex items-center gap-3 flex-1">
                          <div className={`rounded-full p-2 ${
                            paymentMethod === method.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {method.icon}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{method.name}</p>
                            <p className="text-sm text-muted-foreground">{method.description}</p>
                          </div>
                        </div>
                      </Label>
                    </motion.div>
                  ))}
                </div>
              </RadioGroup>
            </div>

            {/* Phone Number (for mobile money) */}
            {selectedMethodData?.requiresPhone && (
              <div className="space-y-3">
                <Label htmlFor="phone">Numéro de Téléphone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="Ex: +225 07 12 34 56 78"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Numéro associé à votre compte {selectedMethodData.name}
                </p>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Separator />

            {/* Summary */}
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <h4 className="mb-2 font-semibold text-foreground">Résumé</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Montant à payer:</span>
                  <span className="font-medium text-foreground">{formatCurrency(paymentAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Méthode:</span>
                  <span className="font-medium text-foreground">
                    {selectedMethodData?.name || "Non sélectionnée"}
                  </span>
                </div>
                {selectedMethodData?.requiresPhone && phoneNumber && (
                  <div className="flex justify-between">
                    <span>Téléphone:</span>
                    <span className="font-medium text-foreground">{phoneNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isProcessing}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={isProcessing || !paymentMethod}
                className="flex-1"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Traitement...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Confirmer le Paiement
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AnimatePresence>
  );
}
