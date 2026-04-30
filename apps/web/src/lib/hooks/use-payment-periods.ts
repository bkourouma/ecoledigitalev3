"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface PaymentPeriod {
  id: string;
  tenantId?: string;
  academicYearId?: string | null;
  name: string;
  description?: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "active" | "closed" | "archived";
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePaymentPeriod {
  name: string;
  description?: string;
  periodStart: string; // ISO date string (YYYY-MM-DD)
  periodEnd: string; // ISO date string (YYYY-MM-DD)
}

interface UsePaymentPeriodsOptions {
  status?: "draft" | "active" | "closed" | "archived";
  year?: number;
  academicYearScopeKey?: string;
  limit?: number;
  cursor?: string;
}

export function usePaymentPeriods(options: UsePaymentPeriodsOptions = {}) {
  return useQuery<{ data: PaymentPeriod[]; pagination?: any }>({
    queryKey: ["payment-periods", options],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (options.status) queryParams.append("status", options.status);
      if (options.year) queryParams.append("year", options.year.toString());
      if (options.limit) queryParams.append("limit", options.limit.toString());
      if (options.cursor) queryParams.append("cursor", options.cursor);

      const url = `/api/v1/payment-periods${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json"
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to fetch payment periods");
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useSimplePaymentPeriods() {
  return useQuery<{ data: PaymentPeriod[] }>({
    queryKey: ["simple-payment-periods"],
    queryFn: async () => {
      const response = await fetch("/api/v1/simple-payment-periods", {
        headers: {
          "Content-Type": "application/json"
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to fetch payment periods");
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUpdatePaymentPeriodStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/v1/payment-periods/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to update payment period status");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch payment periods
      queryClient.invalidateQueries({ queryKey: ["payment-periods"] });
      queryClient.invalidateQueries({ queryKey: ["simple-payment-periods"] });
    },
  });
}

export function useCreatePaymentPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePaymentPeriod) => {
      const response = await fetch("/api/v1/payment-periods", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Failed to create payment period");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch payment periods
      queryClient.invalidateQueries({ queryKey: ["payment-periods"] });
      queryClient.invalidateQueries({ queryKey: ["simple-payment-periods"] });
    },
  });
}

export function useDeletePaymentPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, cascade = false }: { id: string; cascade?: boolean }) => {
      const url = `/api/v1/payment-periods/${id}${cascade ? "?cascade=true" : ""}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorObj = new Error(error.message || "Failed to delete payment period");
        (errorObj as any).paymentCount = error.paymentCount;
        throw errorObj;
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch payment periods
      queryClient.invalidateQueries({ queryKey: ["payment-periods"] });
      queryClient.invalidateQueries({ queryKey: ["simple-payment-periods"] });
    },
  });
}
