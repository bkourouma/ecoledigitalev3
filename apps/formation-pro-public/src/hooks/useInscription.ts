"use client";

import { useMutation } from "@tanstack/react-query";
import type { PaymentInitResponse, PaymentRequestPayload } from "@/types/paiement";

export function useInscription() {
  return useMutation<PaymentInitResponse, Error, PaymentRequestPayload>({
    mutationFn: async (payload) => {
      const response = await fetch("/api/paiement/initier", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Le paiement n'a pas pu etre initialise.");
      }

      return response.json();
    },
  });
}
