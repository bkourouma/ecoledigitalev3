"use client";

import { PaiementProMethod } from "@ecoledigitale/contracts/src/paiements-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { CreditCard, Smartphone, Wallet, Building2 } from "lucide-react";
import { useState } from "react";

interface PaymentMethodOption {
  value: PaiementProMethod;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresPhone: boolean;
}

const paymentMethods: PaymentMethodOption[] = [
  {
    value: "orange_money",
    label: "Orange Money",
    description: "Payer avec votre compte Orange Money",
    icon: Smartphone,
    requiresPhone: true,
  },
  {
    value: "mtn_money",
    label: "MTN Money",
    description: "Payer avec votre compte MTN Money",
    icon: Smartphone,
    requiresPhone: true,
  },
  {
    value: "wave",
    label: "Wave",
    description: "Payer avec l'application Wave",
    icon: Wallet,
    requiresPhone: false,
  },
  {
    value: "carte_bancaire",
    label: "Carte Bancaire",
    description: "Payer par carte bancaire (Visa, Mastercard)",
    icon: CreditCard,
    requiresPhone: false,
  },
  {
    value: "tresorpay",
    label: "TresorPay",
    description: "Payer via TresorPay",
    icon: Building2,
    requiresPhone: false,
  },
];

interface PaymentMethodSelectorProps {
  selectedMethod: PaiementProMethod | null;
  onSelectMethod: (method: PaiementProMethod) => void;
}

export function PaymentMethodSelector({
  selectedMethod,
  onSelectMethod,
}: PaymentMethodSelectorProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Choisissez votre méthode de paiement</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {paymentMethods.map((method) => {
          const Icon = method.icon;
          const isSelected = selectedMethod === method.value;

          return (
            <Card
              key={method.value}
              className={`cursor-pointer transition-all hover:border-primary ${
                isSelected ? "border-primary border-2" : ""
              }`}
              onClick={() => onSelectMethod(method.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-start space-x-4">
                  <div
                    className={`p-3 rounded-lg ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1">{method.label}</h4>
                    <p className="text-sm text-muted-foreground">{method.description}</p>
                    {method.requiresPhone && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Numéro de téléphone requis
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

