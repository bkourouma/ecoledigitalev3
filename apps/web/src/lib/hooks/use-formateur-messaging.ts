/**
 * use-formateur-messaging.ts
 * 
 * React hooks for trainer group messaging
 * Uses TanStack Query for mutations
 */

"use client";

import { useMutation } from "@tanstack/react-query";
import {
  GroupMessageSchema,
  GroupMessageResponseSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders } from "@/lib/api-utils";
import { toast } from "sonner";

export function useSendGroupMessage() {
  return useMutation({
    mutationFn: async ({
      sessionId,
      messageData,
    }: {
      sessionId: string;
      messageData: {
        sujet: string;
        message: string;
        type: "email" | "sms" | "both";
        destinataires?: "tous" | "presents" | "absents";
      };
    }) => {
      const validated = GroupMessageSchema.parse(messageData);
      const response = await fetch(`/api/v1/formateur/sessions/${sessionId}/message-groupe`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validated),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to send group message");
      }

      const rawData = await response.json();
      return GroupMessageResponseSchema.parse(rawData);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'envoi du message"
      );
    },
  });
}

