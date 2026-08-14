"use client";

import { PaiementProMethod } from "@ecoledigitale/contracts/src/paiements-pro";
import { Input } from "@ecoledigitale/ui";
import { Label } from "@ecoledigitale/ui";
import { useState } from "react";

interface PaymentDetailsFormProps {
  method: PaiementProMethod | null;
  phone: string;
  onPhoneChange: (phone: string) => void;
  errors?: Record<string, string>;
}

export function PaymentDetailsForm({
  method,
  phone,
  onPhoneChange,
  errors = {},
}: PaymentDetailsFormProps) {
  const requiresPhone =
    method === "orange_money" || method === "mtn_money";

  if (!requiresPhone) {
    return null;
  }

  const validatePhone = (phoneNumber: string): string | null => {
    if (!phoneNumber.trim()) {
      return "Le numéro de téléphone est requis";
    }

    // Remove spaces and special characters
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, "");

    // Check if it's a valid phone number (8-15 digits, may start with +)
    if (!/^(\+?[0-9]{8,15})$/.test(cleaned)) {
      return "Format de numéro de téléphone invalide";
    }

    // Check operator prefix for Orange Money (07, 05, 01) or MTN (06, 04)
    if (method === "orange_money") {
      const prefix = cleaned.replace(/^\+225/, "").substring(0, 2);
      if (!["07", "05", "01"].includes(prefix)) {
        return "Ce numéro ne semble pas être un numéro Orange Money";
      }
    } else if (method === "mtn_money") {
      const prefix = cleaned.replace(/^\+225/, "").substring(0, 2);
      if (!["06", "04"].includes(prefix)) {
        return "Ce numéro ne semble pas être un numéro MTN Money";
      }
    }

    return null;
  };

  const handlePhoneChange = (value: string) => {
    onPhoneChange(value);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="phone">
        Numéro de téléphone{" "}
        {method === "orange_money" ? "(Orange Money)" : "(MTN Money)"} *
      </Label>
      <Input
        id="phone"
        type="tel"
        value={phone}
        onChange={(e) => handlePhoneChange(e.target.value)}
        placeholder="Ex: +225 07 07 12 34 56"
        isInvalid={!!errors.phone}
        errorMessage={errors.phone}
        required
      />
      <p className="text-xs text-muted-foreground">
        Format: +225 XX XX XX XX XX ou 0X XX XX XX XX
      </p>
    </div>
  );
}

