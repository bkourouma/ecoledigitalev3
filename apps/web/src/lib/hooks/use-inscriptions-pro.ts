/**
 * use-inscriptions-pro.ts
 * 
 * React hooks for professional training enrollment management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AvailabilityCheckRequest,
  AvailabilityCheckResponse,
  IndividualEnrollmentRequest,
  CompanyEnrollmentRequest,
  CompanySearchRequest,
  CompanySearchResponse,
  EnrollmentCreationResponse,
  EnrollmentHistoryQuerySchema,
  EnrollmentHistoryResponseSchema,
} from "@ecoledigitale/contracts/src/inscriptions-pro";
import {
  PromoCodeValidationRequest,
  PromoCodeValidationResponse,
} from "@ecoledigitale/contracts/src/codes-promo";
import {
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentStatusResponse,
} from "@ecoledigitale/contracts/src/paiements-pro";
import { createApiHeaders } from "@/lib/api-utils";
import { z } from "zod";

/**
 * Hook to check session availability
 */
export function useCheckAvailability(sessionId: string | null, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery<AvailabilityCheckResponse>({
    queryKey: ["inscriptions-pro", "availability", sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error("Session ID is required");

      const response = await fetch("/api/v1/inscriptions-pro/verifier-disponibilite", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to check availability");
      }

      const data = await response.json();
      return data.data;
    },
    enabled: options?.enabled !== false && !!sessionId,
    refetchInterval: options?.refetchInterval,
    staleTime: 0, // Always fetch fresh data for availability
  });
}

/**
 * Hook to search companies
 */
export function useSearchCompanies(
  query: string,
  options?: { enabled?: boolean }
) {
  return useQuery<CompanySearchResponse>({
    queryKey: ["entreprises", "search", query],
    queryFn: async () => {
      if (!query || query.length < 2) {
        return { entreprises: [] };
      }

      const response = await fetch(
        `/api/v1/entreprises/rechercher?query=${encodeURIComponent(query)}`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to search companies");
      }

      const data = await response.json();
      return data.data;
    },
    enabled: options?.enabled !== false && query.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });
}

/**
 * Hook to create enrollment (individual or company)
 */
export function useCreateEnrollment() {
  const queryClient = useQueryClient();

  return useMutation<
    EnrollmentCreationResponse,
    Error,
    IndividualEnrollmentRequest | CompanyEnrollmentRequest
  >({
    mutationFn: async (request) => {
      const response = await fetch("/api/v1/inscriptions-pro/creer", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create enrollment");
      }

      const data = await response.json();
      return data.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate availability query to refresh data
      queryClient.invalidateQueries({ queryKey: ["inscriptions-pro", "availability"] });
      
      // Invalidate session availability for the enrolled session
      if (variables.session_id) {
        queryClient.invalidateQueries({ 
          queryKey: ["sessions-pro", "availability", variables.session_id] 
        });
      }
      
      // Invalidate session detail and list queries to refresh places
      queryClient.invalidateQueries({ queryKey: ["sessions-pro"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "list"] });
    },
  });
}

/**
 * Hook to cancel enrollment
 */
export function useCancelEnrollment() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; message: string; refundInitiated: boolean },
    Error,
    string
  >({
    mutationFn: async (inscriptionId: string) => {
      const response = await fetch(`/api/v1/inscriptions-pro/${inscriptionId}/annuler`, {
        method: "PATCH",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to cancel enrollment");
      }

      const data = await response.json();
      return data.data;
    },
    onSuccess: () => {
      // Invalidate enrollment history to refresh the list
      queryClient.invalidateQueries({ queryKey: ["inscriptions-pro", "history"] });
      queryClient.invalidateQueries({ queryKey: ["inscriptions-pro", "mon-compte"] });
    },
  });
}

/**
 * Hook to validate promotional code
 */
export function useValidatePromoCode() {
  return useMutation<PromoCodeValidationResponse, Error, PromoCodeValidationRequest>({
    mutationFn: async (request) => {
      const response = await fetch("/api/v1/codes-promo/valider", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to validate promotional code");
      }

      const data = await response.json();
      return data.data;
    },
  });
}

/**
 * Hook to fetch enrollment confirmation data
 */
export function useEnrollmentConfirmation(inscriptionId: string | null) {
  return useQuery<{
    inscription: any;
    session: any;
    formation: any;
    apprenant: any;
    paiement: any;
  }>(
    {
      queryKey: ["enrollment-confirmation", inscriptionId],
      queryFn: async () => {
        if (!inscriptionId) throw new Error("Inscription ID is required");

        const response = await fetch(`/api/v1/inscriptions-pro/${inscriptionId}/confirmation`, {
          method: "GET",
          headers: createApiHeaders(),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to get enrollment confirmation");
        }

        const data = await response.json();
        return data.data;
      },
      enabled: !!inscriptionId,
    }
  );
}

/**
 * Hook to poll payment status
 */
export function usePaymentStatus(
  paymentId: string | null,
  options?: { refetchInterval?: number; enabled?: boolean }
) {
  return useQuery<PaymentStatusResponse & { inscription?: { id: string; numero_inscription: string; statut: string } }>(
    {
      queryKey: ["payment-status", paymentId],
      queryFn: async () => {
        if (!paymentId) throw new Error("Payment ID is required");

        const response = await fetch(`/api/v1/paiements-pro/${paymentId}/statut`, {
          method: "GET",
          headers: createApiHeaders(),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to get payment status");
        }

        const data = await response.json();
        return data.data;
      },
      enabled: (options?.enabled !== false) && !!paymentId,
      refetchInterval: options?.refetchInterval || false,
      staleTime: 0, // Always fetch fresh data for payment status
    }
  );
}

/**
 * Hook to initiate payment
 */
export function useInitiatePayment() {
  return useMutation<PaymentInitiationResponse, Error, PaymentInitiationRequest>({
    mutationFn: async (request) => {
      const response = await fetch("/api/v1/paiements-pro/initier", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to initiate payment");
      }

      const data = await response.json();
      return data.data;
    },
  });
}

/**
 * Hook to fetch enrollment history with filtering and pagination
 */
export function useEnrollmentHistory(
  query: z.infer<typeof EnrollmentHistoryQuerySchema> = {}
) {
  return useQuery<z.infer<typeof EnrollmentHistoryResponseSchema>>(
    {
      queryKey: ["enrollment-history", query],
      queryFn: async () => {
        const searchParams = new URLSearchParams();
        if (query.statut) searchParams.append("statut", query.statut);
        if (query.date_debut) searchParams.append("date_debut", query.date_debut);
        if (query.date_fin) searchParams.append("date_fin", query.date_fin);
        if (query.search) searchParams.append("search", query.search);
        searchParams.append("page", (query.page || 1).toString());
        searchParams.append("limit", (query.limit || 10).toString());

        const response = await fetch(
          `/api/v1/mon-compte/inscriptions-pro?${searchParams.toString()}`,
          {
            method: "GET",
            headers: createApiHeaders(),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to get enrollment history");
        }

        const data = await response.json();
        return data.data;
      },
    }
  );
}

/**
 * Hook to fetch all enrollments (admin only) with filtering and pagination
 */
export function useAllEnrollments(filters: {
  statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
  session_id?: string;
  date_debut?: string;
  date_fin?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return useQuery<{
    inscriptions: Array<{
      id: string;
      numero_inscription: string;
      session: {
        id: string;
        code_session: string;
        date_debut: string;
        date_fin: string;
        formation: {
          id: string;
          titre: string;
          slug: string;
        };
      };
      apprenant: {
        id: string;
        nom: string;
        prenom: string;
        email: string;
        telephone?: string;
      };
      entreprise?: {
        id: string;
        nom: string;
      };
      type_inscription: 'individuelle' | 'entreprise';
      statut: string;
      montant_ht: number;
      montant_ttc: number;
      reduction_appliquee: number;
      code_promo_utilise: string | null;
      date_inscription: string;
      facture_numero: string | null;
      facture_url: string | null;
      paiement_statut: string | null;
      paiement_methode: string | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>({
    queryKey: ["admin", "inscriptions-pro", filters],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (filters.statut) searchParams.append("statut", filters.statut);
      if (filters.session_id) searchParams.append("session_id", filters.session_id);
      if (filters.date_debut) searchParams.append("date_debut", filters.date_debut);
      if (filters.date_fin) searchParams.append("date_fin", filters.date_fin);
      if (filters.search) searchParams.append("search", filters.search);
      searchParams.append("page", (filters.page || 1).toString());
      searchParams.append("limit", (filters.limit || 20).toString());

      const response = await fetch(
        `/api/v1/admin/inscriptions-pro?${searchParams.toString()}`,
        {
          method: "GET",
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to get enrollments");
      }

      const responseText = await response.text();
      console.log('[useAllEnrollments] Raw response:', responseText.substring(0, 500));
      const data = JSON.parse(responseText);
      const inscriptions = data.data?.inscriptions || [];
      console.log('[useAllEnrollments] Parsed data:', {
        success: data.success,
        hasData: !!data.data,
        dataKeys: data.data ? Object.keys(data.data) : [],
        inscriptionsCount: inscriptions.length,
        inscriptionsType: Array.isArray(inscriptions) ? 'array' : typeof inscriptions,
        firstInscriptionType: typeof inscriptions[0],
        firstInscriptionKeys: inscriptions[0] ? Object.keys(inscriptions[0]) : [],
        firstInscriptionId: inscriptions[0]?.id || null,
        firstInscriptionHasApprenant: !!inscriptions[0]?.apprenant,
        fullFirstInscription: JSON.stringify(inscriptions[0] || null, null, 2),
        pagination: data.data?.pagination,
      });
      return data.data;
    },
  });
}