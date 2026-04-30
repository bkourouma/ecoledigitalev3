/**
 * useDocuments Hook
 * 
 * React hooks for document generation and management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DocumentListQuery,
  DocumentListResponse,
  GenerateConventionRequest,
  GenerateAttestationPresenceRequest,
  GenerateAttestationReussiteRequest,
  GenerateDevisRequest,
  BatchGenerateRequest,
  DocumentResponse,
  BatchGenerateResponse,
  ResendDocumentRequest,
} from "@ecoledigitale/contracts/src/documents";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { toast } from "sonner";

/**
 * Hook to fetch documents list
 */
export function useDocumentsList(query: DocumentListQuery) {
  return useQuery<DocumentListResponse>({
    queryKey: ["documents", "list", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      const response = await fetch(`/api/v1/admin/documents?${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch documents");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to generate convention
 */
export function useGenerateConvention() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: GenerateConventionRequest) => {
      const response = await fetch("/api/v1/admin/documents/convention/generer", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate convention");
      }

      const rawData = await response.json();
      return rawData.data as DocumentResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Convention générée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Hook to generate attendance certificate
 */
export function useGenerateAttestationPresence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: GenerateAttestationPresenceRequest) => {
      const response = await fetch("/api/v1/admin/documents/attestation-presence/generer", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate attendance certificate");
      }

      const rawData = await response.json();
      return rawData.data as DocumentResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Attestation de présence générée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Hook to generate success certificate
 */
export function useGenerateAttestationReussite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: GenerateAttestationReussiteRequest) => {
      const response = await fetch("/api/v1/admin/documents/attestation-reussite/generer", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate success certificate");
      }

      const rawData = await response.json();
      return rawData.data as DocumentResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Attestation de réussite générée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Hook to generate quote
 */
export function useGenerateDevis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: GenerateDevisRequest) => {
      const response = await fetch("/api/v1/admin/documents/devis/generer", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate quote");
      }

      const rawData = await response.json();
      return rawData.data as DocumentResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Devis généré avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Hook to batch generate documents
 */
export function useBatchGenerateDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: BatchGenerateRequest) => {
      const response = await fetch("/api/v1/admin/documents/batch-generate", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to batch generate documents");
      }

      const rawData = await response.json();
      return rawData.data as BatchGenerateResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(`${data.nb_generes} document(s) généré(s) avec succès`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Hook to resend document
 */
export function useResendDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, email }: { documentId: string; email: string }) => {
      const request: ResendDocumentRequest = { email };
      const response = await fetch(`/api/v1/admin/documents/${documentId}/resend`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to resend document");
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("Document envoyé avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'envoi");
    },
  });
}

/**
 * Hook to delete document
 */
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const response = await fetch(`/api/v1/admin/documents/${documentId}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete document");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document supprimé avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la suppression");
    },
  });
}

/**
 * Helper to download document
 */
export function downloadDocument(documentId: string) {
  window.open(`/api/v1/admin/documents/${documentId}`, "_blank");
}
