"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";

interface PaymentRecapCardProps {
  enrollmentNumber: string;
  formationTitle: string;
  sessionCode: string;
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
  promoCode?: string | null;
}

export function PaymentRecapCard({
  enrollmentNumber,
  formationTitle,
  sessionCode,
  baseAmount,
  discountAmount,
  finalAmount,
  promoCode,
}: PaymentRecapCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Récapitulatif du paiement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="font-semibold mb-2">Inscription</h4>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Numéro:</span> {enrollmentNumber}
            </p>
            <p>
              <span className="text-muted-foreground">Formation:</span> {formationTitle}
            </p>
            <p>
              <span className="text-muted-foreground">Session:</span> {sessionCode}
            </p>
          </div>
        </div>

        <div className="border-t pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Prix de base:</span>
            <span>{baseAmount.toFixed(2)} FCFA</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
              <span>Réduction {promoCode ? `(${promoCode})` : ""}:</span>
              <span>-{discountAmount.toFixed(2)} FCFA</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-lg pt-2 border-t">
            <span>Total à payer:</span>
            <span>{finalAmount.toFixed(2)} FCFA</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

